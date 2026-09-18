/**
 * The only endpoint. Everything a visitor can trigger goes through here.
 *
 * Order matters and is deliberate:
 *
 *   preset  -> served from a plan that shipped with the build. No model call,
 *              no key, no rate-limit budget consumed. Most visitors never get
 *              past this branch.
 *   cache   -> a question asked before returns its stored plan.
 *   model   -> only now does anything cost money, and only after the rate
 *              limiter has agreed.
 *
 * A plan from any source is validated identically before it runs. The executor
 * cannot tell where a plan came from, which is what makes the cached and
 * preset paths safe to trust.
 */

import { NextResponse } from 'next/server';

import { countyTotals, loadBlockGroups, type BlockGroupFeature } from '@/lib/db';
import { execute } from '@/lib/primitives';
import { PRESET_BY_ID } from '@/lib/presets';
import { checkRateLimit } from '@/lib/rate-limit';
import { planCache, normaliseQuestion } from '@/lib/cache';
import { OrchestrationError, planFromQuestion } from '@/lib/orchestrate';
import { validatePlan, type Plan } from '@/lib/validate';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_QUESTION_LENGTH = 300;

interface Body {
  presetId?: string;
  question?: string;
}

function clientKey(req: Request): string {
  // Vercel sets x-forwarded-for; fall back to a constant so a missing header
  // shares one bucket rather than bypassing the limiter entirely.
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || 'unknown';
}

async function respondWith(plan: Plan, source: 'preset' | 'cache' | 'model', extra = {}) {
  let rows, totals;
  try {
    [rows, totals] = await Promise.all([loadBlockGroups(), countyTotals()]);
  } catch (err) {
    // Name the likely cause rather than leaving a 500 for the client to guess
    // at. A misconfigured deployment is far more common here than a genuine
    // database fault, and the two need different fixes.
    const detail =
      err instanceof Error && err.message.includes('DATABASE_URL')
        ? 'DATABASE_URL is not set on this deployment. Add it in the project settings and redeploy — environment variables added after a build are not picked up until the next one.'
        : 'The database could not be read. The dataset may not have been loaded yet.';
    console.error('data load failed', err);
    return NextResponse.json({ ok: false, error: 'data unavailable', detail }, { status: 503 });
  }
  const result = execute(plan, rows);
  const matched = result.rows as BlockGroupFeature[];

  return NextResponse.json({
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
        ...(r.derived ?? {}),
      },
    })),
    ...extra,
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'malformed request body' }, { status: 400 });
  }

  // --- preset: free, and the path most visitors take --------------------
  if (body.presetId) {
    const preset = PRESET_BY_ID.get(body.presetId);
    if (!preset) {
      return NextResponse.json({ ok: false, error: 'unknown preset' }, { status: 404 });
    }
    return respondWith(preset.plan, 'preset', { reading: preset.reading });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ ok: false, error: 'question is required' }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `question must be under ${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  // --- cache: a repeated question never costs twice ---------------------
  const key = normaliseQuestion(question);
  const cached = planCache.get(key);
  if (cached) return respondWith(cached, 'cache');

  // --- model: the only branch that spends anything ----------------------
  const limit = checkRateLimit(clientKey(req));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rate limited',
        detail: `This demo allows ${limit.limit} questions an hour per visitor. The preset questions are always free.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await planFromQuestion(question);
  } catch (err) {
    console.error('orchestration failed', err);
    const detail =
      err instanceof OrchestrationError
        ? `${err.hint} The preset questions work regardless — they need no model.`
        : 'The preset questions work regardless — they need no model.';
    return NextResponse.json({ ok: false, error: 'the model call failed', detail }, { status: 502 });
  }

  const verdict = validatePlan(raw);
  if (!verdict.ok) {
    if ('unsupported' in verdict) {
      return NextResponse.json({ ok: false, unsupported: verdict.unsupported });
    }
    console.error('plan failed validation', verdict.errors);
    return NextResponse.json({
      ok: false,
      unsupported: {
        unsupported: true,
        reason: 'That question did not map onto an analysis this dataset supports.',
        suggestion: 'Try one of the preset questions to see the shape of what works.',
      },
    });
  }

  planCache.set(key, verdict.plan);
  return respondWith(verdict.plan, 'model');
}
