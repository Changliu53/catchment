/**
 * The evaluation suite's own tests.
 *
 * These run on every push and call no model. What they check is that the
 * corpus is well-formed and that the grader actually discriminates — because
 * an eval suite that scores 100% on a broken grader looks exactly like one
 * that scores 100% on a working model, and this repository has already shipped
 * three checks that had quietly stopped checking.
 *
 * The live run is `npm run eval`, which needs an API key. See
 * `evals/README.md` for why that is not on the push path.
 */

import { describe, expect, it } from 'vitest';

import { CASES, fieldsUsed } from '../../../evals/cases';
import { grade, report } from '../../../evals/grade';
import { FIELD_NAMES, PRIMITIVE_OPS } from '@/lib/schema';
import type { Plan } from '@/lib/validate';

const byId = (id: string) => CASES.find((c) => c.id === id)!;

describe('the corpus', () => {
  it('has enough cases to mean something', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(24);
  });

  it('has unique ids', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it('is at least a quarter refusals', () => {
    // A corpus of answerable questions measures willingness, not judgement.
    // The interesting failure of this system is a confident wrong answer, and
    // only a decline case can catch one.
    const declines = CASES.filter((c) => c.expect.outcome === 'decline');
    expect(declines.length / CASES.length).toBeGreaterThanOrEqual(0.25);
  });

  it('exercises every operation the executor has', () => {
    const covered = new Set(
      CASES.flatMap((c) => (c.expect.outcome === 'plan' ? c.expect.ops : [])),
    );
    for (const op of PRIMITIVE_OPS) expect([...covered]).toContain(op);
  });

  it('exercises every field in the dictionary', () => {
    const covered = new Set(
      CASES.flatMap((c) =>
        c.expect.outcome === 'plan'
          ? [...(c.expect.fields ?? []), ...(c.expect.notFields ?? [])]
          : [],
      ),
    );
    for (const f of FIELD_NAMES) expect([...covered]).toContain(f);
  });

  it('asks each question only once', () => {
    const asked = CASES.map((c) => c.question.toLowerCase().replace(/\s+/g, ' ').trim());
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('gives every refusal case a stated reason', () => {
    // The `because` string is what a failing run prints. "Expected decline" is
    // not a thing anyone can act on.
    for (const c of CASES) {
      if (c.expect.outcome === 'decline') expect(c.expect.because.length).toBeGreaterThan(20);
    }
  });
});

const plan = (p: Partial<Plan> & Pick<Plan, 'pipeline' | 'render'>): unknown => ({
  title: 'Test',
  ...p,
});

const DECLINE = {
  unsupported: true,
  reason: 'Commute time needs a road network, which this dataset does not include.',
  suggestion: 'Try: where is park access worst relative to how many people live there?',
};

describe('the grader', () => {
  it('passes a correct plan', () => {
    const g = grade(
      byId('flood-half'),
      plan({ pipeline: [{ op: 'flood_exposure', min_pct: 0.5 }], render: 'choropleth' }),
    );
    expect(g.pass, g.reason).toBe(true);
  });

  it('fails a plan that answers a different question', () => {
    // The 500-year zone case, answered with the 100-year zone. This validates
    // perfectly, draws a real map, and is wrong.
    const g = grade(
      byId('five-hundred-year'),
      plan({
        pipeline: [{ op: 'filter', field: 'flood_pct', comparison: 'gt', value: 0 }],
        render: 'choropleth',
      }),
    );
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('flood_pct');
  });

  it('fails a plan with the right shape and the wrong number', () => {
    // "A kilometre" answered as 1 metre. Passes the schema, passes the
    // semantic validator, returns nothing.
    const g = grade(
      byId('far-from-park'),
      plan({
        pipeline: [{ op: 'resource_gap', poi_type: 'park', max_distance_m: 1 }],
        render: 'choropleth',
      }),
    );
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('1000');
  });

  it('fails a plan whose steps are in the wrong order', () => {
    const g = grade(
      byId('flood-and-grocery'),
      plan({
        pipeline: [
          { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
          { op: 'flood_exposure', min_pct: 0.5 },
        ],
        render: 'choropleth',
      }),
    );
    expect(g.pass).toBe(false);
  });

  it('fails a plan that does not validate at all', () => {
    const g = grade(byId('poorest'), { pipeline: [{ op: 'teleport' }], render: 'choropleth' });
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('did not validate');
  });

  it('passes a refusal of an unanswerable question', () => {
    const g = grade(byId('commute-time'), DECLINE);
    expect(g.pass, g.reason).toBe(true);
  });

  it('fails a refusal with no way forward', () => {
    const g = grade(byId('commute-time'), { ...DECLINE, suggestion: ' ' });
    expect(g.pass).toBe(false);
  });

  it('fails an answer to an unanswerable question, and says which one', () => {
    // The failure mode the decline cases exist for: a straight-line distance
    // offered as an answer about driving.
    const g = grade(
      byId('commute-time'),
      plan({
        pipeline: [{ op: 'rank', measure: 'dist_grocery_m', dir: 'desc', n: 20 }],
        render: 'choropleth',
      }),
    );
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('cannot answer');
  });

  it('fails a refusal of an answerable question', () => {
    const g = grade(byId('poorest'), DECLINE);
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('can answer');
  });

  it('checks render, not just the pipeline', () => {
    const g = grade(
      byId('income-by-flood'),
      plan({
        pipeline: [
          { op: 'compare', measure: 'median_income', split_on: 'flood_pct', threshold: 0.5 },
        ],
        render: 'choropleth',
      }),
    );
    // The semantic validator rejects this before the render check does, which
    // is the correct order — but either way it must not pass.
    expect(g.pass).toBe(false);
  });
});

describe('fieldsUsed', () => {
  it('counts the fields an op implies, not only the ones it names', () => {
    // `flood_exposure` has no field parameter and is entirely about flood_pct;
    // `resource_gap` names a POI type rather than the distance column. Without
    // this the near-miss cases would never fire.
    const used = fieldsUsed({
      title: 't',
      render: 'choropleth',
      pipeline: [
        { op: 'flood_exposure', min_pct: 0.5 },
        { op: 'resource_gap', poi_type: 'park', max_distance_m: 1000 },
      ],
    } as Plan);
    expect(used).toContain('flood_pct');
    expect(used).toContain('dist_park_m');
  });
});

describe('the report', () => {
  it('scores and breaks down by tag', () => {
    const r = report([
      { id: 'a', tag: 'basic', pass: true },
      { id: 'b', tag: 'basic', pass: false, reason: 'x' },
      { id: 'c', tag: 'decline', pass: true },
    ]);
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.byTag['basic']).toEqual({ passed: 1, total: 2 });
    expect(r.byTag['decline']).toEqual({ passed: 1, total: 1 });
  });

  it('scores an empty run as zero rather than as perfect', () => {
    // 0/0 is 100% under the obvious implementation, which would make a run
    // that failed to start look like the best run ever recorded.
    expect(report([]).score).toBe(0);
  });
});
