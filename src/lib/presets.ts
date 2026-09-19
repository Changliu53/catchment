/**
 * Preset questions. Each one ships with the analysis plan it resolves to, so
 * clicking a preset costs nothing: no model call, no API key, no rate limit.
 *
 * This is the demo's first line of cost defence, and it is also why a stranger
 * can open the page and get a real answer in under thirty seconds without
 * typing anything.
 *
 * They double as the model's few-shot examples — including, deliberately, one
 * question the system cannot answer. A model shown only successes learns that
 * an answer is always required, and starts inventing them.
 */

import type { Plan } from './validate';

export interface Preset {
  id: string;
  question: string;
  /** One line on what the result actually shows, for the caption under the map. */
  reading: string;
  plan: Plan;
}

export const PRESETS: Preset[] = [
  {
    id: 'flooded-grocery-deserts',
    question: 'Which flood-exposed neighbourhoods have no supermarket within a kilometre?',
    reading:
      'Block groups with over half their area in the 100-year floodplain whose centre is more than 1 km from the nearest supermarket, ranked by population.',
    plan: {
      title: 'Flood exposure and grocery access',
      pipeline: [
        { op: 'flood_exposure', min_pct: 0.5 },
        { op: 'resource_gap', poi_type: 'supermarket', max_distance_m: 1000 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'pop',
    },
  },
  {
    id: 'worst-park-access',
    question: 'Where is park access worst relative to how many people live there?',
    reading:
      'The 50 densest block groups whose centre is farthest from a park. Density matters: a long walk affects more people where more people live.',
    plan: {
      title: 'Park access in dense areas',
      pipeline: [
        { op: 'resource_gap', poi_type: 'park', max_distance_m: 1000 },
        { op: 'rank', measure: 'pop_density', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'pop_density',
    },
  },
  {
    id: 'income-flood-gap',
    question: 'Do lower-income areas sit in the floodplain more often?',
    reading:
      'Median household income compared between block groups above and below 50% floodplain coverage. This describes a distribution; it does not establish cause.',
    plan: {
      title: 'Income distribution by flood exposure',
      pipeline: [
        { op: 'compare', measure: 'median_income', split_on: 'flood_pct', threshold: 0.5 },
      ],
      render: 'comparison',
    },
  },
  {
    id: 'most-exposed-population',
    question: 'Which neighbourhoods have the most people living in the floodplain?',
    reading: 'Block groups at least 80% inside the 100-year floodplain, ranked by population.',
    plan: {
      title: 'Population in the floodplain',
      pipeline: [
        { op: 'flood_exposure', min_pct: 0.8 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'pop',
    },
  },
  {
    id: 'grocery-deserts',
    question: 'Where are the worst grocery deserts, regardless of flooding?',
    reading: 'Block groups more than 3 km from the nearest supermarket, ranked by population.',
    plan: {
      title: 'Distance to the nearest supermarket',
      pipeline: [
        { op: 'resource_gap', poi_type: 'supermarket', max_distance_m: 3000 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'dist_grocery_m',
    },
  },
  {
    id: 'low-income-flooded',
    question: 'Which low-income neighbourhoods are most flood-exposed?',
    reading:
      'Block groups with median household income under $40,000 and at least half their area in the floodplain. Areas where income was suppressed by the Census are excluded, not counted as low-income.',
    plan: {
      title: 'Low income and flood exposure',
      pipeline: [
        { op: 'filter', field: 'median_income', comparison: 'lt', value: 40_000 },
        { op: 'flood_exposure', min_pct: 0.5 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'median_income',
    },
  },
  {
    id: 'outside-sfha',
    question: 'Who is exposed to the 500-year flood but not the 100-year one?',
    reading:
      'Block groups with little 100-year floodplain but substantial 0.2%-annual-chance area. Many Houston homes that flooded in Harvey sat exactly here, outside the zone where insurance is mandatory.',
    plan: {
      title: 'Exposure outside the regulatory floodplain',
      pipeline: [
        { op: 'filter', field: 'flood_pct', comparison: 'lt', value: 0.1 },
        { op: 'filter', field: 'flood_pct_500', comparison: 'gte', value: 0.3 },
        { op: 'rank', measure: 'pop', dir: 'desc', n: 50 },
      ],
      render: 'choropleth',
      color_by: 'flood_pct_500',
    },
  },
  {
    id: 'densest',
    question: 'Where do the most people live per square kilometre?',
    reading: 'The 50 densest block groups in the county.',
    plan: {
      title: 'Population density',
      pipeline: [{ op: 'rank', measure: 'pop_density', dir: 'desc', n: 50 }],
      render: 'choropleth',
      color_by: 'pop_density',
    },
  },
];

/** A question the system deliberately cannot answer, used as a few-shot example. */
export const UNSUPPORTED_EXAMPLE = {
  question: 'Which neighbourhoods have the longest commute to downtown?',
  response: {
    unsupported: true as const,
    reason:
      'Commute time needs a road network and travel times, which this dataset does not include. Distances here are straight-line.',
    suggestion: 'Try: where is park access worst relative to how many people live there?',
  },
};

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
