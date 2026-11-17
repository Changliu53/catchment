/**
 * The executor: a pure function from (plan, rows) to a result.
 *
 * No I/O, no model, no randomness. The correctness of the system therefore
 * does not depend on the model behaving well — only on the plan surviving
 * validation, which is checked before anything here runs.
 */

import type { FieldName } from './schema';
import type { Plan, Step } from './validate';

/** One census block group with its precomputed attributes. */
export interface BlockGroup {
  geoid: string;
  pop: number;
  median_income: number | null;
  income_topcoded: boolean;
  area_m2: number;
  flood_pct: number;
  flood_pct_500: number;
  dist_grocery_m: number;
  dist_park_m: number;
  pop_density: number;
}

export interface DistributionStats {
  n: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface ComparisonResult {
  measure: FieldName;
  split_on: FieldName;
  threshold: number;
  above: DistributionStats;
  below: DistributionStats;
}

export interface ExecutionResult<T extends BlockGroup = BlockGroup> {
  rows: T[];
  comparison?: ComparisonResult;
  /** Rows surviving after each step, for the "show your work" panel. */
  trace: { op: string; remaining: number }[];
  /** Layer 3: true when the plan ran fine but matched nothing. */
  empty: boolean;
  /**
   * The rows that met every condition, before a closing `rank` cut them down
   * to a top n. Without this the page could only report the rows it drew, and
   * a top-50 view of 196 qualifying block groups read as "50 block groups, and
   * this many people", which understated the answer by a factor of four.
   * Equal to `rows` when the plan does not end in a rank step.
   */
  qualifying: T[];
}

function valueOf(row: BlockGroup, field: FieldName): number | null {
  const v = row[field as keyof BlockGroup];
  return typeof v === 'number' ? v : null;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo];
  const b = sorted[hi];
  if (a === undefined || b === undefined) return null;
  return a + (b - a) * (pos - lo);
}

export function describeDistribution(values: number[]): DistributionStats {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { n: 0, mean: null, median: null, p25: null, p75: null };
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return {
    n: clean.length,
    mean: sum / clean.length,
    median: quantile(clean, 0.5),
    p25: quantile(clean, 0.25),
    p75: quantile(clean, 0.75),
  };
}

const COMPARATORS: Record<string, (a: number, b: number) => boolean> = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

function applyStep<T extends BlockGroup>(
  rows: T[],
  step: Step,
): { rows: T[]; comparison?: ComparisonResult } {
  switch (step.op) {
    case 'filter': {
      const cmp = COMPARATORS[step.comparison];
      if (!cmp) return { rows: [] };
      // Rows with a null measure are excluded rather than coerced to zero:
      // suppressed income is "unknown", not "poor".
      return {
        rows: rows.filter((r) => {
          const v = valueOf(r, step.field);
          return v !== null && cmp(v, step.value);
        }),
      };
    }

    case 'flood_exposure':
      return { rows: rows.filter((r) => r.flood_pct >= step.min_pct) };

    case 'resource_gap': {
      const field = step.poi_type === 'supermarket' ? 'dist_grocery_m' : 'dist_park_m';
      return { rows: rows.filter((r) => r[field] > step.max_distance_m) };
    }

    case 'rank': {
      const sorted = [...rows].sort((a, b) => {
        const av = valueOf(a, step.measure);
        const bv = valueOf(b, step.measure);
        // Nulls sort last in both directions; they are absent, not extreme.
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return step.dir === 'desc' ? bv - av : av - bv;
      });
      return { rows: sorted.slice(0, step.n) };
    }

    case 'compare': {
      const above: number[] = [];
      const below: number[] = [];
      for (const r of rows) {
        const split = valueOf(r, step.split_on);
        const measure = valueOf(r, step.measure);
        if (split === null || measure === null) continue;
        (split >= step.threshold ? above : below).push(measure);
      }
      return {
        rows,
        comparison: {
          measure: step.measure,
          split_on: step.split_on,
          threshold: step.threshold,
          above: describeDistribution(above),
          below: describeDistribution(below),
        },
      };
    }
  }
}

/**
 * Run a plan over rows, returning the rows that survived.
 *
 * Generic in the row type, which is not decoration. Every step here filters,
 * sorts or truncates — none of them construct a row — so whatever came in
 * comes out, including fields this module has never heard of. Typing it as
 * `BlockGroup[]` threw that away and made the one caller that needs geometry
 * cast the result back, which is the kind of cast that stops being true the
 * day the executor starts building rows of its own.
 */
export function execute<T extends BlockGroup>(
  plan: Plan,
  source: readonly T[],
): ExecutionResult<T> {
  let rows: T[] = [...source];
  let comparison: ComparisonResult | undefined;
  const trace: { op: string; remaining: number }[] = [];
  let qualifying: T[] | undefined;

  // Where the trailing run of rank steps begins. Only a rank at the end is a
  // "show me the top n" over rows that already qualified; a rank followed by
  // a filter is part of the conditions, and its input is not the answer.
  let tail = plan.pipeline.length;
  while (tail > 0 && plan.pipeline[tail - 1]?.op === 'rank') tail--;

  for (const [i, step] of plan.pipeline.entries()) {
    if (i === tail) qualifying = rows;
    const out = applyStep(rows, step);
    rows = out.rows;
    if (out.comparison) comparison = out.comparison;
    trace.push({ op: step.op, remaining: rows.length });
  }

  return { rows, comparison, trace, empty: rows.length === 0, qualifying: qualifying ?? rows };
}
