import { describe, expect, it } from 'vitest';
import { describeDistribution, execute } from '../primitives';
import type { Plan } from '../validate';
import { FIXTURE_ROWS, ids } from './fixtures';

const plan = (pipeline: Plan['pipeline'], extra: Partial<Plan> = {}): Plan => ({
  pipeline,
  render: 'choropleth',
  title: 'test',
  ...extra,
});

describe('flood_exposure', () => {
  it('keeps block groups at or above the threshold', () => {
    const r = execute(plan([{ op: 'flood_exposure', min_pct: 0.5 }]), FIXTURE_ROWS);
    expect(ids(r.rows)).toEqual(['A', 'B', 'E']);
  });

  it('is inclusive at the boundary', () => {
    const r = execute(plan([{ op: 'flood_exposure', min_pct: 0.9 }]), FIXTURE_ROWS);
    expect(ids(r.rows)).toEqual(['A']);
  });
});

describe('resource_gap', () => {
  it('keeps block groups farther than the threshold', () => {
    const r = execute(
      plan([{ op: 'resource_gap', poi_type: 'supermarket', max_distance_m: 1000 }]),
      FIXTURE_ROWS,
    );
    expect(ids(r.rows)).toEqual(['A', 'C', 'E']);
  });

  it('routes park queries to the park distance field', () => {
    const r = execute(
      plan([{ op: 'resource_gap', poi_type: 'park', max_distance_m: 1000 }]),
      FIXTURE_ROWS,
    );
    expect(ids(r.rows)).toEqual(['C']);
  });
});

describe('filter', () => {
  it('excludes rows whose measure is null rather than treating them as zero', () => {
    const r = execute(
      plan([{ op: 'filter', field: 'median_income', comparison: 'lt', value: 50_000 }]),
      FIXTURE_ROWS,
    );
    // E has suppressed income; it must not be counted as low-income.
    expect(ids(r.rows)).toEqual(['A', 'C']);
  });
});

describe('rank', () => {
  it('takes the largest n descending', () => {
    const r = execute(plan([{ op: 'rank', measure: 'pop', dir: 'desc', n: 2 }]), FIXTURE_ROWS);
    expect(r.rows.map((x) => x.geoid)).toEqual(['D', 'B']);
  });

  it('sorts nulls last in both directions', () => {
    const asc = execute(
      plan([{ op: 'rank', measure: 'median_income', dir: 'asc', n: 5 }]),
      FIXTURE_ROWS,
    );
    expect(asc.rows[asc.rows.length - 1]?.geoid).toBe('E');

    const desc = execute(
      plan([{ op: 'rank', measure: 'median_income', dir: 'desc', n: 5 }]),
      FIXTURE_ROWS,
    );
    expect(desc.rows[desc.rows.length - 1]?.geoid).toBe('E');
  });
});

describe('normalize', () => {
  it('writes a derived ratio without mutating the source rows', () => {
    const r = execute(plan([{ op: 'normalize', measure: 'pop', by: 'area_m2' }]), FIXTURE_ROWS);
    expect(r.rows[0]?.derived?.['pop_per_area_m2']).toBeCloseTo(1000 / 1_000_000, 12);
    expect(FIXTURE_ROWS[0]).not.toHaveProperty('derived');
  });

  it('yields zero instead of Infinity when the denominator is zero', () => {
    const r = execute(plan([{ op: 'normalize', measure: 'pop', by: 'area_m2' }]), [
      { ...FIXTURE_ROWS[0]!, area_m2: 0 },
    ]);
    expect(r.rows[0]?.derived?.['pop_per_area_m2']).toBe(0);
  });
});

describe('pipelines', () => {
  it('composes steps in order and records a trace', () => {
    const r = execute(
      plan([
        { op: 'flood_exposure', min_pct: 0.5 },
        { op: 'resource_gap', poi_type: 'supermarket', max_distance_m: 1000 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 1 },
      ]),
      FIXTURE_ROWS,
    );
    expect(r.rows.map((x) => x.geoid)).toEqual(['A']);
    expect(r.trace).toEqual([
      { op: 'flood_exposure', remaining: 3 },
      { op: 'resource_gap', remaining: 2 },
      { op: 'rank', remaining: 1 },
    ]);
  });

  it('flags an empty result rather than throwing', () => {
    const r = execute(plan([{ op: 'flood_exposure', min_pct: 1 }]), FIXTURE_ROWS);
    expect(r.empty).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe('compare', () => {
  it('splits on the threshold and describes both groups', () => {
    const r = execute(
      plan(
        [{ op: 'compare', measure: 'median_income', split_on: 'flood_pct', threshold: 0.5 }],
        { render: 'comparison' },
      ),
      FIXTURE_ROWS,
    );
    // above: A(40k), B(80k) — E dropped for null income. below: C(25k), D(120k).
    expect(r.comparison?.above.n).toBe(2);
    expect(r.comparison?.above.mean).toBe(60_000);
    expect(r.comparison?.below.n).toBe(2);
    expect(r.comparison?.below.mean).toBe(72_500);
  });
});

describe('describeDistribution', () => {
  it('returns nulls for an empty set instead of NaN', () => {
    expect(describeDistribution([])).toEqual({
      n: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
    });
  });

  it('interpolates quantiles', () => {
    const d = describeDistribution([1, 2, 3, 4]);
    expect(d.median).toBe(2.5);
    expect(d.p25).toBe(1.75);
    expect(d.p75).toBe(3.25);
  });
});
