import { describe, expect, it } from 'vitest';
import {
  classRanges,
  colorExpression,
  NO_DATA,
  quantileBreaks,
  RAMP,
  SPLIT_OUTLINE,
} from '../ramp';
import { formatValue, labelFor } from '../format';

describe('quantileBreaks', () => {
  it('splits a uniform range into equal-count classes', () => {
    const values = Array.from({ length: 600 }, (_, i) => i);
    const b = quantileBreaks(values, 6);
    expect(b).toHaveLength(5);
    expect(b).toEqual([...b].sort((x, y) => x - y));
  });

  it('collapses duplicate edges instead of emitting identical classes', () => {
    // 90% of rows share one value — the shape of a real skewed field.
    const values = [
      ...Array(90).fill(0),
      ...Array(10)
        .fill(0)
        .map((_, i) => i + 1),
    ];
    const b = quantileBreaks(values, 6);
    expect(new Set(b).size).toBe(b.length);
  });

  it('returns nothing for an empty or all-identical set', () => {
    expect(quantileBreaks([], 6)).toEqual([]);
    expect(quantileBreaks([5, 5, 5, 5], 6)).toEqual([]);
  });

  it('ignores non-finite values', () => {
    expect(quantileBreaks([1, NaN, 2, Infinity, 3], 3).every(Number.isFinite)).toBe(true);
  });
});

describe('classRanges', () => {
  it('covers min to max with no gaps', () => {
    const r = classRanges([10, 20, 30], 0, 40);
    expect(r[0]!.lo).toBe(0);
    expect(r[r.length - 1]!.hi).toBe(40);
    for (let i = 1; i < r.length; i++) expect(r[i]!.lo).toBe(r[i - 1]!.hi);
  });

  it('never runs past the end of the ramp', () => {
    const many = Array.from({ length: 20 }, (_, i) => i);
    for (const c of classRanges(many, 0, 100)) expect(RAMP).toContain(c.color);
  });
});

describe('formatValue', () => {
  it('renders each field in its own unit', () => {
    expect(formatValue('flood_pct', 0.5)).toBe('50%');
    expect(formatValue('median_income', 61234.7)).toBe('$61,235');
    expect(formatValue('dist_grocery_m', 850)).toBe('850 m');
    expect(formatValue('dist_grocery_m', 2500)).toBe('2.5 km');
    expect(formatValue('pop_density', 3327.2)).toBe('3,327/km²');
    expect(formatValue('area_m2', 1_500_000)).toBe('1.5 km²');
  });

  it('shows an em dash rather than a misleading zero for missing values', () => {
    expect(formatValue('median_income', null)).toBe('—');
    expect(formatValue('median_income', NaN)).toBe('—');
    expect(formatValue('pop', undefined)).toBe('—');
  });

  it('labels the two flood fields distinguishably', () => {
    expect(labelFor('flood_pct')).not.toBe(labelFor('flood_pct_500'));
    expect(labelFor('flood_pct')).toContain('100-year');
  });
});

describe('colorExpression', () => {
  it('routes a null value to the no-data colour, not to the ramp', () => {
    const expr = colorExpression('median_income', [40000, 60000]) as unknown[];
    expect(expr[0]).toBe('case');
    // The condition has to compare against null itself. `has` reports an
    // explicit null as present, and a to-number fallback never fires, because
    // to-number turns null into 0 rather than into the fallback — both were
    // checked against MapLibre's evaluator and both are wrong here.
    expect(expr[1]).toEqual(['==', ['get', 'median_income'], null]);
    expect(expr[2]).toBe(NO_DATA);
  });

  it('never coerces a missing value into the lowest class', () => {
    const expr = JSON.stringify(colorExpression('median_income', [40000]));
    // A default of 0 on to-number is exactly how suppressed income became
    // "poorest" on the map.
    expect(expr).not.toContain('["to-number",["get","median_income"],0]');
  });

  it('steps through the ramp on the value branch', () => {
    const expr = colorExpression('pop', [100, 200, 300]) as unknown[];
    const shaded = expr[3] as unknown[];
    expect(shaded[0]).toBe('step');
    expect(shaded[1]).toEqual(['to-number', ['get', 'pop']]);
    expect(shaded.slice(2)).toEqual([RAMP[0], 100, RAMP[1], 200, RAMP[2], 300, RAMP[3]]);
  });

  it('falls back to a flat colour when there is nothing to classify', () => {
    expect(colorExpression(null, [1, 2])).toBe(RAMP[1]);
    const flat = colorExpression('pop', []) as unknown[];
    expect(flat[3]).toBe(RAMP[1]);
  });
});

describe('SPLIT_OUTLINE', () => {
  it('is not one of the ramp colours', () => {
    // A comparison puts two variables on the map: the measure it compares, by
    // fill, and the group it splits on, by outline. If the outline came from
    // the ramp it would read as one more class of the fill rather than as a
    // different kind of statement about the same polygon.
    expect(RAMP).not.toContain(SPLIT_OUTLINE);
    expect(SPLIT_OUTLINE).not.toBe(NO_DATA);
  });
});
