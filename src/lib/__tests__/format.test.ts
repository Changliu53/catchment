/**
 * Formatting, and the thing it is easy to get wrong about it.
 *
 * A number whose unit the reader has to infer is worse than no number, and a
 * missing value printed as `0` is a lie the interface tells confidently. Both
 * are checked here, along with the property that made this worth moving into
 * the field dictionary: every field has a label and a format, so adding one
 * cannot leave a raw column name in a table header.
 */

import { describe, expect, it } from 'vitest';

import { formatValue, labelFor, NO_VALUE, unitFor } from '@/lib/format';
import { FIELDS } from '@/lib/schema';

describe('every field is presentable', () => {
  // The regression this guards: label and unit knowledge used to live in a
  // hand-maintained map in `format.ts`, so a new field silently formatted as a
  // bare number under its own column name.
  it.each(Object.keys(FIELDS))('%s has a label, a unit and a format', (field) => {
    expect(labelFor(field)).not.toBe(field);
    expect(labelFor(field).length).toBeGreaterThan(3);
    expect(unitFor(field)).toBeTruthy();
    expect(formatValue(field, 1)).not.toBe('');
  });
});

describe('missing values', () => {
  it('are never printed as a number', () => {
    // 273 of 2,830 block groups have no income figure. Showing 0 there would
    // put them at the poor end of every table.
    for (const absent of [null, undefined, NaN, Infinity]) {
      expect(formatValue('median_income', absent)).toBe(NO_VALUE);
    }
  });

  it('are distinguishable from a real zero', () => {
    expect(formatValue('pop', 0)).toBe('0');
    expect(formatValue('pop', null)).toBe(NO_VALUE);
  });
});

describe('units', () => {
  it('reads money as money', () => {
    expect(formatValue('median_income', 63475)).toBe('$63,475');
  });

  it('reads a fraction as a percentage', () => {
    expect(formatValue('flood_pct', 0.5)).toBe('50%');
    expect(formatValue('flood_pct_500', 0.123)).toBe('12.3%');
  });

  it('switches metres to kilometres where metres stop being readable', () => {
    expect(formatValue('dist_grocery_m', 800)).toBe('800 m');
    expect(formatValue('dist_grocery_m', 1000)).toBe('1 km');
    expect(formatValue('dist_park_m', 2500)).toBe('2.5 km');
  });

  it('reads an area in square kilometres, not square metres', () => {
    expect(formatValue('area_m2', 2_500_000)).toBe('2.5 km²');
  });

  it('keeps thousands separators, because these are read at a glance', () => {
    expect(formatValue('pop', 43769)).toBe('43,769');
    expect(formatValue('pop_density', 1234)).toBe('1,234/km²');
  });
});

describe('a field the dictionary has never heard of', () => {
  it('still renders rather than throwing inside a table cell', () => {
    expect(formatValue('invented_field', 1234)).toBe('1,234');
    expect(labelFor('invented_field')).toBe('invented_field');
    expect(unitFor('invented_field')).toBeNull();
  });
});
