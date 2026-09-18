import { describe, expect, it } from 'vitest';
import { validatePlan } from '../validate.js';

const base = { render: 'choropleth' as const, title: 'test' };

const ok = (pipeline: unknown, extra: object = {}) =>
  validatePlan({ ...base, ...extra, pipeline });

describe('structural validation', () => {
  it('accepts a well-formed plan', () => {
    const r = ok([{ op: 'flood_exposure', min_pct: 0.5 }]);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown operation', () => {
    const r = ok([{ op: 'drop_table', target: 'users' }]);
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown field name', () => {
    const r = ok([{ op: 'filter', field: 'secret_column', comparison: 'gt', value: 1 }]);
    expect(r.ok).toBe(false);
  });

  it('rejects a pipeline longer than the cap', () => {
    const r = ok(Array.from({ length: 6 }, () => ({ op: 'flood_exposure', min_pct: 0.1 })));
    expect(r.ok).toBe(false);
  });

  it('rejects an empty pipeline', () => {
    expect(ok([]).ok).toBe(false);
  });

  it('rejects a min_pct outside 0-1', () => {
    expect(ok([{ op: 'flood_exposure', min_pct: 50 }]).ok).toBe(false);
  });
});

describe('semantic validation', () => {
  it('rejects a threshold outside the field range (unit hallucination)', () => {
    const r = ok([{ op: 'filter', field: 'flood_pct', comparison: 'gt', value: 50 }]);
    expect(r.ok).toBe(false);
    if (!r.ok && 'errors' in r) {
      expect(r.errors.join(' ')).toContain('plausible range');
    }
  });

  it('rejects normalize placed after rank', () => {
    const r = ok([
      { op: 'rank', measure: 'pop', dir: 'desc', n: 10 },
      { op: 'normalize', measure: 'pop', by: 'area_m2' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok && 'errors' in r) {
      expect(r.errors.join(' ')).toContain('normalize must come before rank');
    }
  });

  it('accepts normalize placed before rank', () => {
    const r = ok([
      { op: 'normalize', measure: 'pop', by: 'area_m2' },
      { op: 'rank', measure: 'pop', dir: 'desc', n: 10 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects normalizing an already-derived rate', () => {
    const r = ok([{ op: 'normalize', measure: 'pop_density', by: 'area_m2' }]);
    expect(r.ok).toBe(false);
  });

  it('rejects compare in a non-terminal position', () => {
    const r = ok(
      [
        { op: 'compare', measure: 'median_income', split_on: 'flood_pct', threshold: 0.5 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 5 },
      ],
      { render: 'comparison' },
    );
    expect(r.ok).toBe(false);
  });

  it('requires the comparison renderer for a compare pipeline', () => {
    const r = ok([
      { op: 'compare', measure: 'median_income', split_on: 'flood_pct', threshold: 0.5 },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects the comparison renderer without a compare step', () => {
    const r = ok([{ op: 'flood_exposure', min_pct: 0.5 }], { render: 'comparison' });
    expect(r.ok).toBe(false);
  });
});

describe('refusals', () => {
  it('recognises a well-formed unsupported response', () => {
    const r = validatePlan({
      unsupported: true,
      reason: 'Commute time needs a road network, which this dataset does not include.',
      suggestion: 'Try: which flooded block groups are farthest from a supermarket?',
    });
    expect(r.ok).toBe(false);
    expect('unsupported' in r).toBe(true);
  });

  it('does not treat malformed output as a refusal', () => {
    const r = validatePlan({ unsupported: true });
    expect(r.ok).toBe(false);
    expect('unsupported' in r).toBe(false);
  });
});

describe('adversarial input', () => {
  it.each([
    null,
    'DROP TABLE block_groups',
    42,
    [],
    { pipeline: 'not an array', render: 'choropleth', title: 'x' },
    { ...base, pipeline: [{ op: 'filter', field: '__proto__', comparison: 'gt', value: 1 }] },
  ])('rejects %j without throwing', (input) => {
    expect(() => validatePlan(input)).not.toThrow();
    expect(validatePlan(input).ok).toBe(false);
  });
});
