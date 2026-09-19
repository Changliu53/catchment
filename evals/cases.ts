/**
 * The evaluation corpus for the model layer.
 *
 * The model's only job is translation: an English question becomes a plan in a
 * closed schema. That makes it testable in a way most model-backed features
 * are not — there is a right answer, or at least a set of wrong ones, and
 * neither depends on judging prose.
 *
 * Two things are being measured, and they are different:
 *
 *   1. Does it produce a plan the validator accepts? A plan that fails
 *      validation is a visible failure — the visitor sees an error — so this
 *      is the cheap half.
 *   2. Does it produce the *right* plan? A plan that validates and answers a
 *      different question is the expensive half, because nothing downstream
 *      can tell. The page will draw it, caption it, and let someone share it.
 *
 * So the expectations here are mostly about the second kind. Several cases
 * exist only to catch a specific near-miss: `flood_pct` where the question
 * said the 500-year zone, metres where the question said kilometres, a
 * straight-line distance offered as an answer to a question about driving.
 *
 * Expectations are structural rather than exact. Many different plans answer
 * "the poorest flood-exposed neighbourhoods" correctly — step order varies,
 * `n` varies, the title is free text — and an exact-match corpus would fail on
 * differences that are not mistakes, which is how an eval suite gets switched
 * off.
 */

import type { FieldName, PrimitiveOp } from '@/lib/schema';
import type { Plan } from '@/lib/validate';

export type Expectation =
  | {
      outcome: 'decline';
      /** What makes this unanswerable. Printed when a run gets it wrong. */
      because: string;
    }
  | {
      outcome: 'plan';
      /** Operations that must appear, in this relative order. */
      ops: PrimitiveOp[];
      /** Fields the plan must reference somewhere. */
      fields?: FieldName[];
      /**
       * Fields the plan must NOT reference. This is where the near-misses
       * live: the wrong flood zone, the wrong measure, the plausible
       * substitute.
       */
      notFields?: FieldName[];
      render?: Plan['render'];
      /** Anything the shape above cannot express. Returns a reason, or null. */
      also?: (plan: Plan) => string | null;
    };

export interface EvalCase {
  id: string;
  question: string;
  /** Loose grouping, for the per-category breakdown in a run's report. */
  tag: 'basic' | 'multi-step' | 'units' | 'near-miss' | 'decline';
  expect: Expectation;
}

/** Every step that names a field, whatever the parameter is called. */
export function fieldsUsed(plan: Plan): string[] {
  const out: string[] = [];
  if (plan.color_by) out.push(plan.color_by);
  for (const s of plan.pipeline) {
    if (s.op === 'filter') out.push(s.field);
    if (s.op === 'rank') out.push(s.measure);
    if (s.op === 'compare') out.push(s.measure, s.split_on);
    if (s.op === 'flood_exposure') out.push('flood_pct');
    if (s.op === 'resource_gap') out.push(s.poi_type === 'park' ? 'dist_park_m' : 'dist_grocery_m');
  }
  return out;
}

const step = (plan: Plan, op: PrimitiveOp) => plan.pipeline.find((s) => s.op === op);

export const CASES: EvalCase[] = [
  // ---------------------------------------------------------------- basic --
  {
    id: 'flood-half',
    question: 'Which neighbourhoods are more than half in the floodplain?',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['flood_exposure'],
      also: (p) => {
        const s = step(p, 'flood_exposure');
        return s?.op === 'flood_exposure' && Math.abs(s.min_pct - 0.5) < 0.01
          ? null
          : `min_pct should be 0.5, got ${s?.op === 'flood_exposure' ? s.min_pct : 'none'}`;
      },
    },
  },
  {
    id: 'poorest',
    question: 'Show me the 20 lowest-income block groups.',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['rank'],
      fields: ['median_income'],
      also: (p) => {
        const s = step(p, 'rank');
        if (s?.op !== 'rank') return 'no rank step';
        if (s.dir !== 'asc') return `lowest income means dir asc, got ${s.dir}`;
        return s.n === 20 ? null : `asked for 20, got n=${s.n}`;
      },
    },
  },
  {
    id: 'densest',
    question: 'Where do the most people live per square kilometre?',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['rank'],
      fields: ['pop_density'],
      // The trap is `pop`: "most people" and "most people per km²" are
      // different questions and the second one names its own field.
      notFields: ['pop'],
      also: (p) => {
        const s = step(p, 'rank');
        return s?.op === 'rank' && s.dir === 'desc' ? null : 'should rank descending';
      },
    },
  },
  {
    id: 'far-from-park',
    question: 'Which areas have no park within a kilometre?',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['resource_gap'],
      also: (p) => {
        const s = step(p, 'resource_gap');
        if (s?.op !== 'resource_gap') return 'no resource_gap step';
        if (s.poi_type !== 'park') return `poi_type should be park, got ${s.poi_type}`;
        return s.max_distance_m === 1000 ? null : `a kilometre is 1000 m, got ${s.max_distance_m}`;
      },
    },
  },
  {
    id: 'grocery-2km',
    question: 'Find block groups more than 2 km from the nearest supermarket.',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['resource_gap'],
      also: (p) => {
        const s = step(p, 'resource_gap');
        if (s?.op !== 'resource_gap') return 'no resource_gap step';
        if (s.poi_type !== 'supermarket')
          return `poi_type should be supermarket, got ${s.poi_type}`;
        return s.max_distance_m === 2000 ? null : `2 km is 2000 m, got ${s.max_distance_m}`;
      },
    },
  },
  {
    id: 'large-population',
    question: 'Which block groups have more than 5,000 residents?',
    tag: 'basic',
    expect: {
      outcome: 'plan',
      ops: ['filter'],
      fields: ['pop'],
      also: (p) => {
        const s = step(p, 'filter');
        if (s?.op !== 'filter') return 'no filter step';
        if (!['gt', 'gte'].includes(s.comparison)) return `"more than" is gt, got ${s.comparison}`;
        return s.value === 5000 ? null : `threshold should be 5000, got ${s.value}`;
      },
    },
  },
  {
    id: 'biggest-area',
    question: 'What are the physically largest block groups in the county?',
    tag: 'basic',
    expect: { outcome: 'plan', ops: ['rank'], fields: ['area_m2'], notFields: ['pop'] },
  },

  // ----------------------------------------------------------- multi-step --
  {
    id: 'flood-and-grocery',
    question:
      'Which flood-exposed neighbourhoods have no supermarket within a kilometre, ' +
      'and which of those are the most populated?',
    tag: 'multi-step',
    expect: {
      outcome: 'plan',
      ops: ['flood_exposure', 'resource_gap', 'rank'],
      fields: ['pop'],
    },
  },
  {
    id: 'poor-and-flooded',
    question: 'Show low-income areas that are also badly flood exposed.',
    tag: 'multi-step',
    expect: { outcome: 'plan', ops: ['flood_exposure'], fields: ['median_income'] },
  },
  {
    id: 'dense-no-park',
    question: 'Where is park access worst relative to how many people live there?',
    tag: 'multi-step',
    expect: {
      outcome: 'plan',
      ops: ['resource_gap', 'rank'],
      fields: ['pop_density'],
    },
  },
  {
    id: 'income-by-flood',
    question: 'Do lower-income areas sit in the floodplain more often?',
    tag: 'multi-step',
    expect: {
      outcome: 'plan',
      ops: ['compare'],
      fields: ['median_income', 'flood_pct'],
      render: 'comparison',
      also: (p) =>
        p.pipeline.at(-1)?.op === 'compare' ? null : 'compare must terminate the pipeline',
    },
  },
  {
    id: 'density-by-grocery',
    question: 'Compare population density between areas near and far from a supermarket.',
    tag: 'multi-step',
    expect: {
      outcome: 'plan',
      ops: ['compare'],
      fields: ['pop_density', 'dist_grocery_m'],
      render: 'comparison',
    },
  },
  {
    id: 'top-flooded-poor',
    question: 'Of the areas over 30% in the floodplain, which ten have the lowest incomes?',
    tag: 'multi-step',
    expect: {
      outcome: 'plan',
      ops: ['flood_exposure', 'rank'],
      fields: ['median_income'],
      also: (p) => {
        const r = step(p, 'rank');
        if (r?.op !== 'rank') return 'no rank step';
        if (r.n !== 10) return `asked for ten, got n=${r.n}`;
        return r.dir === 'asc' ? null : 'lowest incomes means dir asc';
      },
    },
  },

  // ---------------------------------------------------------------- units --
  {
    id: 'flood-70-percent',
    question: 'Which block groups are at least 70% inside the floodplain?',
    tag: 'units',
    expect: {
      outcome: 'plan',
      ops: ['flood_exposure'],
      // The failure this exists for: 70 instead of 0.7. The semantic validator
      // catches it, so it surfaces as an error rather than a wrong map — but
      // an error is still a question the visitor did not get answered.
      also: (p) => {
        const s = step(p, 'flood_exposure');
        if (s?.op !== 'flood_exposure') return 'no flood_exposure step';
        return Math.abs(s.min_pct - 0.7) < 0.01 ? null : `70% is 0.7, got ${s.min_pct}`;
      },
    },
  },
  {
    id: 'park-500m',
    question: 'Which areas are more than 500 metres from a park?',
    tag: 'units',
    expect: {
      outcome: 'plan',
      ops: ['resource_gap'],
      also: (p) => {
        const s = step(p, 'resource_gap');
        if (s?.op !== 'resource_gap') return 'no resource_gap step';
        return s.max_distance_m === 500 ? null : `already metres, got ${s.max_distance_m}`;
      },
    },
  },
  {
    id: 'income-under-40k',
    question: 'Block groups where the median household income is under $40,000.',
    tag: 'units',
    expect: {
      outcome: 'plan',
      ops: ['filter'],
      fields: ['median_income'],
      also: (p) => {
        const s = step(p, 'filter');
        if (s?.op !== 'filter') return 'no filter step';
        // 40 instead of 40000 would be read as forty dollars a year and is
        // inside the plausible range, so the validator cannot catch it.
        return s.value === 40_000 ? null : `$40,000 is 40000, got ${s.value}`;
      },
    },
  },
  {
    id: 'income-quarter-million',
    question: 'Are there any block groups with a median income over a quarter of a million?',
    tag: 'units',
    expect: {
      outcome: 'plan',
      ops: ['filter'],
      fields: ['median_income'],
      also: (p) => {
        const s = step(p, 'filter');
        if (s?.op !== 'filter') return 'no filter step';
        return s.value === 250_000 ? null : `a quarter of a million is 250000, got ${s.value}`;
      },
    },
  },

  // ------------------------------------------------------------- near-miss --
  {
    id: 'five-hundred-year',
    question: 'Which neighbourhoods are in the 500-year flood zone?',
    tag: 'near-miss',
    expect: {
      outcome: 'plan',
      ops: ['filter'],
      fields: ['flood_pct_500'],
      // The whole case. flood_pct_500 is not a superset of flood_pct, and
      // answering with the 100-year zone understates exposure — which is
      // exactly the mistake Harvey made famous.
      notFields: ['flood_pct'],
    },
  },
  {
    id: 'unqualified-floodplain',
    question: 'How many people live in the floodplain?',
    tag: 'near-miss',
    expect: {
      outcome: 'plan',
      ops: ['flood_exposure'],
      fields: ['pop'],
      // The mirror of the case above: unqualified "floodplain" is the SFHA.
      notFields: ['flood_pct_500'],
    },
  },
  {
    id: 'most-people-total',
    question: 'Which block groups have the largest populations?',
    tag: 'near-miss',
    expect: { outcome: 'plan', ops: ['rank'], fields: ['pop'], notFields: ['pop_density'] },
  },
  {
    id: 'richest',
    question: 'Show the wealthiest neighbourhoods.',
    tag: 'near-miss',
    expect: {
      outcome: 'plan',
      ops: ['rank'],
      fields: ['median_income'],
      also: (p) => {
        const s = step(p, 'rank');
        return s?.op === 'rank' && s.dir === 'desc' ? null : 'wealthiest means dir desc';
      },
    },
  },
  {
    id: 'grocery-not-park',
    question: 'Where are the food deserts?',
    tag: 'near-miss',
    expect: {
      outcome: 'plan',
      ops: ['resource_gap'],
      notFields: ['dist_park_m'],
      also: (p) => {
        const s = step(p, 'resource_gap');
        return s?.op === 'resource_gap' && s.poi_type === 'supermarket'
          ? null
          : 'a food desert is about supermarkets';
      },
    },
  },

  // --------------------------------------------------------------- decline --
  {
    id: 'commute-time',
    question: 'Which neighbourhoods have the longest commute to downtown?',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because:
        'travel time needs a road network; the nearest thing here is straight-line distance, ' +
        'which is an answer-shaped wrong answer',
    },
  },
  {
    id: 'drive-to-hospital',
    question: 'How far is it to drive to the nearest hospital from each block group?',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because: 'hospitals are not in the dataset, and driving distance is not measured',
    },
  },
  {
    id: 'schools',
    question: 'Which areas have no primary school within 2 km?',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because: 'the only points of interest are supermarkets and parks',
    },
  },
  {
    id: 'crime',
    question: 'Show me the crime rate by neighbourhood.',
    tag: 'decline',
    expect: { outcome: 'decline', because: 'there is no crime data' },
  },
  {
    id: 'time-series',
    question: 'How has flood exposure changed since 2010?',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because: 'the dataset is one vintage; there is nothing to compare across time',
    },
  },
  {
    id: 'prediction',
    question: 'Which areas will flood next hurricane season?',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because: 'this is a prediction, and the data describes present exposure',
    },
  },
  {
    id: 'other-county',
    question: 'Do the same analysis for Dallas County.',
    tag: 'decline',
    expect: { outcome: 'decline', because: 'the dataset covers Harris County only' },
  },
  {
    id: 'rent',
    question: 'Show me the neighbourhoods with the highest rents.',
    tag: 'decline',
    expect: {
      outcome: 'decline',
      because:
        'rent is not in the dataset, and median household income is a different measure ' +
        'that a plan could plausibly be built from instead',
    },
  },
];
