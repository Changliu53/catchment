import { describe, expect, it } from 'vitest';

import { classify } from '../classify';

const row = (props: Record<string, unknown>) => ({ properties: props });

describe('classify', () => {
  it('counts missing values instead of coercing them', () => {
    const { values, missing } = classify(
      [
        row({ median_income: 40000 }),
        row({ median_income: null }),
        row({ median_income: 90000 }),
        row({}), // absent, not null
      ],
      'median_income',
    );

    // `Number(null)` and `Number(undefined)` are 0 and NaN. The first would put
    // a suppressed row at the bottom of the distribution and drag every
    // quantile break down with it.
    expect(values).toEqual([40000, 90000]);
    expect(missing).toBe(2);
    expect(values).not.toContain(0);
  });

  it('treats an empty string as missing, not as zero', () => {
    // A CSV round trip is how a null becomes "".
    const { values, missing } = classify([row({ pop: '' }), row({ pop: 12 })], 'pop');
    expect(values).toEqual([12]);
    expect(missing).toBe(1);
  });

  it('keeps a genuine zero', () => {
    // Plenty of block groups really do have no floodplain at all, and that is
    // a measurement, not an absence.
    const { values, missing } = classify([row({ flood_pct: 0 }), row({ flood_pct: 0.4 })], 'flood_pct');
    expect(values).toEqual([0, 0.4]);
    expect(missing).toBe(0);
  });

  it('derives breaks from the values that exist', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row({ pop: i + 1 }));
    const { breaks } = classify(rows, 'pop');
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks).toEqual([...breaks].sort((a, b) => a - b));
    expect(Math.min(...breaks)).toBeGreaterThan(1);
  });

  it('has nothing to say when no field is being shaded', () => {
    expect(classify([row({ pop: 1 })], null)).toEqual({ values: [], breaks: [], missing: 0 });
  });
});
