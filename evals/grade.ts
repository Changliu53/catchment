/**
 * Grading, separated from running.
 *
 * The model call is non-deterministic and costs money; this is neither. It
 * takes a case and whatever the model returned and says pass or fail, so the
 * grader itself is unit-tested offline, on every push, against hand-written
 * plans — including plans that are deliberately wrong.
 *
 * That split is the point. An evaluation suite whose scoring logic is only
 * exercised by live runs has the same problem as every other check in this
 * repository that turned out to have stopped checking: nothing tells you the
 * grader is broken except a score that looks fine.
 */

import { validatePlan } from '@/lib/validate';

import { type EvalCase, fieldsUsed } from './cases';

export interface Grade {
  id: string;
  tag: EvalCase['tag'];
  pass: boolean;
  /** Why it failed, in the terms of the case rather than of the schema. */
  reason?: string;
}

/** Do `needles` appear in `haystack` in this relative order? */
function inOrder(haystack: readonly string[], needles: readonly string[]): boolean {
  let at = 0;
  for (const n of needles) {
    const found = haystack.indexOf(n, at);
    if (found === -1) return false;
    at = found + 1;
  }
  return true;
}

export function grade(testCase: EvalCase, output: unknown): Grade {
  const { id, tag, expect } = testCase;
  const fail = (reason: string): Grade => ({ id, tag, pass: false, reason });

  const verdict = validatePlan(output);
  const declined = !verdict.ok && 'unsupported' in verdict ? verdict.unsupported : null;
  const broken = !verdict.ok && 'errors' in verdict ? verdict.errors : null;

  if (expect.outcome === 'decline') {
    if (declined) {
      // A refusal has to be usable, not just correct. "No" with no way
      // forward, on a page whose whole invitation is to type a question, is a
      // dead end — so the suggestion is graded too.
      if (!declined.suggestion.trim()) {
        return fail('declined without suggesting anything that works');
      }
      if (declined.reason.trim().length < 20) {
        return fail(`declined with no real reason: "${declined.reason}"`);
      }
      return { id, tag, pass: true };
    }
    if (verdict.ok) return fail(`answered a question it cannot answer — ${expect.because}`);
    return fail(`produced neither a plan nor a refusal: ${broken?.join('; ')}`);
  }

  if (!verdict.ok) {
    if (declined) return fail(`declined a question it can answer: ${declined.reason}`);
    // A plan that does not validate is the cheap failure: the visitor sees an
    // error rather than a wrong answer. Still a failure.
    return fail(`plan did not validate: ${broken?.join('; ')}`);
  }

  const plan = verdict.plan;
  const ops = plan.pipeline.map((s) => s.op);

  if (!inOrder(ops, expect.ops)) {
    return fail(`expected ops ${expect.ops.join(' → ')}, got ${ops.join(' → ') || '(none)'}`);
  }

  const used = fieldsUsed(plan);
  for (const f of expect.fields ?? []) {
    if (!used.includes(f)) return fail(`never uses ${f}; uses ${[...new Set(used)].join(', ')}`);
  }
  for (const f of expect.notFields ?? []) {
    if (used.includes(f)) return fail(`uses ${f}, which answers a different question`);
  }

  if (expect.render && plan.render !== expect.render) {
    return fail(`render should be ${expect.render}, got ${plan.render}`);
  }

  const extra = expect.also?.(plan);
  if (extra) return fail(extra);

  return { id, tag, pass: true };
}

export interface Report {
  grades: Grade[];
  passed: number;
  total: number;
  /** Pass rate, 0–1. */
  score: number;
  byTag: Record<string, { passed: number; total: number }>;
}

export function report(grades: Grade[]): Report {
  const byTag: Report['byTag'] = {};
  for (const g of grades) {
    byTag[g.tag] ??= { passed: 0, total: 0 };
    byTag[g.tag]!.total++;
    if (g.pass) byTag[g.tag]!.passed++;
  }

  const passed = grades.filter((g) => g.pass).length;
  return {
    grades,
    passed,
    total: grades.length,
    score: grades.length === 0 ? 0 : passed / grades.length,
    byTag,
  };
}
