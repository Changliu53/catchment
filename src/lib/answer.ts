/**
 * One question in, one answer out.
 *
 * This is the whole analysis path, lifted out of the HTTP handler so it has no
 * opinion about how it was reached. The page calls it directly while rendering
 * on the server; the JSON API calls it and maps the result onto status codes.
 * Both get identical answers because there is only one implementation.
 *
 * Routing order is deliberate and cheapest-first:
 *
 *   preset  -> a plan that shipped with the build. No model call, no API key,
 *              no rate-limit budget. Most visitors never get past this.
 *   cache   -> a question asked before returns its stored plan.
 *   model   -> only now does anything cost money, and only after the rate
 *              limiter has agreed.
 *
 * A plan from any source is validated identically before it runs, so the
 * executor cannot tell where a plan came from — which is what makes the cached
 * and preset paths safe to trust.
 */

import { countyTotals, loadBlockGroups, type BlockGroupFeature } from './db';
import { execute } from './primitives';
import { PRESET_BY_ID } from './presets';
import { checkRateLimit } from './rate-limit';
import { planCache, normaliseQuestion } from './cache';
import { OrchestrationError, planFromQuestion } from './orchestrate';
import { validatePlan, type Plan } from './validate';

export const MAX_QUESTION_LENGTH = 300;

export interface Feature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, number | string | boolean | null>;
}

export interface Answer {
  ok: true;
  source: 'preset' | 'cache' | 'model';
  plan: Plan;
  totals: Awaited<ReturnType<typeof countyTotals>>;
  trace: { op: string; remaining: number }[];
  empty: boolean;
  matched: number;
  matchedPopulation: number;
  comparison: ReturnType<typeof execute>['comparison'] | null;
  features: Feature[];
  reading?: string;
}

/**
 * Every way this can fail, named.
 *
 * A caller decides what a failure looks like — a status code, or a panel on
 * the page — but it never has to guess what went wrong from a string.
 */
export type Failure =
  | { ok: false; kind: 'unknown-preset' }
  | { ok: false; kind: 'no-question' }
  | { ok: false; kind: 'question-too-long'; limit: number }
  | { ok: false; kind: 'rate-limited'; detail: string; retryAfterSeconds: number }
  | { ok: false; kind: 'unsupported'; reason: string; suggestion: string }
  | { ok: false; kind: 'model-failed'; detail: string }
  | { ok: false; kind: 'data-unavailable'; detail: string };

export type Result = Answer | Failure;

export interface Ask {
  presetId?: string;
  question?: string;
  /** Identifies the visitor for rate limiting. One bucket per caller. */
  clientKey: string;
}

async function run(plan: Plan, source: Answer['source'], reading?: string): Promise<Result> {
  let rows: BlockGroupFeature[];
  let totals: Answer['totals'];
  try {
    [rows, totals] = await Promise.all([loadBlockGroups(), countyTotals()]);
  } catch (err) {
    // Name the likely cause rather than leaving a 500 for the caller to guess
    // at. A misconfigured deployment is far more common here than a genuine
    // database fault, and the two need different fixes.
    console.error('data load failed', err);
    return {
      ok: false,
      kind: 'data-unavailable',
      detail:
        err instanceof Error && err.message.includes('DATABASE_URL')
          ? 'DATABASE_URL is not set on this deployment. Add it in the project settings and redeploy — environment variables added after a build are not picked up until the next one.'
          : 'The database could not be read. The dataset may not have been loaded yet.',
    };
  }

  // No cast: `execute` is generic in the row type, so what comes out still
  // carries the geometry that went in.
  const result = execute(plan, rows);
  const matched = result.rows;

  return {
    ok: true,
    source,
    plan,
    totals,
    trace: result.trace,
    empty: result.empty,
    comparison: result.comparison ?? null,
    matched: result.rows.length,
    matchedPopulation: result.rows.reduce((a, r) => a + r.pop, 0),
    // Geometry is only sent for rows that matched, which keeps a typical
    // response well under a megabyte even though the full dataset is larger.
    features: matched.map((r) => ({
      type: 'Feature' as const,
      geometry: r.geometry,
      properties: {
        geoid: r.geoid,
        pop: r.pop,
        median_income: r.median_income,
        income_topcoded: r.income_topcoded,
        pop_density: r.pop_density,
        flood_pct: r.flood_pct,
        flood_pct_500: r.flood_pct_500,
        dist_grocery_m: r.dist_grocery_m,
        dist_park_m: r.dist_park_m,
      },
    })),
    ...(reading ? { reading } : {}),
  };
}

export async function answerFor({ presetId, question, clientKey }: Ask): Promise<Result> {
  // --- preset: free, and the path most visitors take --------------------
  if (presetId) {
    const preset = PRESET_BY_ID.get(presetId);
    if (!preset) return { ok: false, kind: 'unknown-preset' };

    // Presets go through the validator too, and that is not ceremony. The
    // header above claims a plan from any source is validated identically
    // before it runs; it used to be false, because this branch handed
    // `preset.plan` straight to the executor. A claim like that is only worth
    // making if nothing is exempt from it — and the exemption was on the path
    // most visitors take.
    //
    // Reaching the failure branch would mean a preset shipped broken, which is
    // a build-time fault, so `presets.test.ts` asserts every one of them
    // validates. This is the belt: cheap (the validator is pure), and it keeps
    // a malformed plan away from the executor even if the test were deleted.
    const verdict = validatePlan(preset.plan);
    if (!verdict.ok) {
      console.error(`preset "${preset.id}" does not validate`, verdict);
      return {
        ok: false,
        kind: 'unsupported',
        reason: 'This preset question is temporarily unavailable.',
        suggestion: 'Try another preset, or ask the question in your own words.',
      };
    }

    return run(verdict.plan, 'preset', preset.reading);
  }

  const asked = question?.trim();
  if (!asked) return { ok: false, kind: 'no-question' };
  if (asked.length > MAX_QUESTION_LENGTH) {
    return { ok: false, kind: 'question-too-long', limit: MAX_QUESTION_LENGTH };
  }

  // --- cache: a repeated question never costs twice ---------------------
  const key = normaliseQuestion(asked);
  const cached = planCache.get(key);
  if (cached) return run(cached, 'cache');

  // --- model: the only branch that spends anything ----------------------
  const limit = checkRateLimit(clientKey);
  if (!limit.allowed) {
    return {
      ok: false,
      kind: 'rate-limited',
      detail: `This demo allows ${limit.limit} questions an hour per visitor. The preset questions are always free.`,
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  let raw: unknown;
  try {
    raw = await planFromQuestion(asked);
  } catch (err) {
    console.error('orchestration failed', err);
    return {
      ok: false,
      kind: 'model-failed',
      detail:
        err instanceof OrchestrationError
          ? `${err.hint} The preset questions work regardless — they need no model.`
          : 'The preset questions work regardless — they need no model.',
    };
  }

  const verdict = validatePlan(raw);
  if (!verdict.ok) {
    if ('unsupported' in verdict) {
      return {
        ok: false,
        kind: 'unsupported',
        reason: verdict.unsupported.reason,
        suggestion: verdict.unsupported.suggestion,
      };
    }
    console.error('plan failed validation', verdict.errors);
    return {
      ok: false,
      kind: 'unsupported',
      reason: 'That question did not map onto an analysis this dataset supports.',
      suggestion: 'Try one of the preset questions to see the shape of what works.',
    };
  }

  planCache.set(key, verdict.plan);
  return run(verdict.plan, 'model');
}
