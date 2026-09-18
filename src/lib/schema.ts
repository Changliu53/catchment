/**
 * Single source of truth for the analysis contract.
 *
 * Everything downstream is generated from this file: the Zod validators, the
 * Anthropic tool schema, and the field/primitive documentation injected into
 * the system prompt. Adding a field or a primitive means editing exactly one
 * place, so the prompt can never drift away from what the executor supports.
 */

/** A measurable attribute of a census block group. */
export interface FieldSpec {
  readonly name: string;
  readonly unit: string;
  readonly description: string;
  /** Plausible range. Used by the semantic validator to reject absurd thresholds. */
  readonly range: readonly [number, number];
  /** Fields derived from others cannot be used as a normalization denominator. */
  readonly isDerived?: boolean;
}

const FIELDS_RAW = {
  pop: {
    name: 'pop',
    unit: 'people',
    description: 'Total population (ACS B01003_001E)',
    range: [0, 20_000],
  },
  median_income: {
    name: 'median_income',
    unit: 'USD/year',
    description: 'Median household income (ACS B19013_001E). Null where suppressed.',
    range: [0, 300_000],
  },
  area_m2: {
    name: 'area_m2',
    unit: 'm^2',
    description: 'Block group area, measured in EPSG:32615',
    range: [0, 2_000_000_000],
  },
  flood_pct: {
    name: 'flood_pct',
    unit: 'fraction 0-1',
    description:
      'Share of area inside a FEMA Special Flood Hazard Area — the 1% annual chance ' +
      '("100-year") floodplain, where flood insurance is federally mandated',
    range: [0, 1],
  },
  flood_pct_500: {
    name: 'flood_pct_500',
    unit: 'fraction 0-1',
    description:
      'Share of area in the 0.2% annual chance ("500-year") zone. Not a subset of ' +
      'flood_pct: many Houston homes flooded in Harvey while outside the SFHA, so ' +
      'reporting only flood_pct understates real exposure',
    range: [0, 1],
  },
  dist_grocery_m: {
    name: 'dist_grocery_m',
    unit: 'm',
    description: 'Straight-line distance from centroid to nearest supermarket',
    range: [0, 50_000],
  },
  dist_park_m: {
    name: 'dist_park_m',
    unit: 'm',
    description: 'Straight-line distance from centroid to nearest park',
    range: [0, 50_000],
  },
  pop_density: {
    name: 'pop_density',
    unit: 'people/km^2',
    description: 'Population per square kilometre',
    range: [0, 100_000],
    isDerived: true,
  },
} as const satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELDS_RAW;

/**
 * Widened view of the field table. `as const satisfies` above pins the key
 * names for the type system; this alias restores the uniform FieldSpec value
 * type, so optional members like `isDerived` are readable on every entry.
 */
export const FIELDS: Record<FieldName, FieldSpec> = FIELDS_RAW;
export const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

/** Fields that may serve as a denominator in `normalize`. */
export const DENOMINATORS = ['pop', 'area_m2'] as const;
export type Denominator = (typeof DENOMINATORS)[number];

export const POI_TYPES = ['supermarket', 'park'] as const;
export type PoiType = (typeof POI_TYPES)[number];

export const COMPARISON_OPS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

/** Hard ceiling on pipeline length. Bounds worst-case cost and runtime. */
export const MAX_PIPELINE_STEPS = 5;

/**
 * The closed set of operations the model may emit. It cannot express anything
 * outside this list, which is why no sanitization of model output is needed:
 * there is no escape hatch to sanitize.
 */
export const PRIMITIVES = {
  filter: {
    op: 'filter',
    summary: 'Keep block groups whose field satisfies a comparison.',
    params: 'field (any field), op (lt|lte|gt|gte|eq), value (number)',
  },
  flood_exposure: {
    op: 'flood_exposure',
    summary: 'Keep block groups with at least min_pct of their area in a floodplain.',
    params: 'min_pct (0-1)',
  },
  resource_gap: {
    op: 'resource_gap',
    summary: 'Keep block groups farther than max_distance_m from the nearest POI of a type.',
    params: 'poi_type (supermarket|park), max_distance_m (metres)',
  },
  normalize: {
    op: 'normalize',
    summary: 'Divide a measure by pop or area_m2, writing the result to a derived field.',
    params: 'measure (field), by (pop|area_m2)',
  },
  rank: {
    op: 'rank',
    summary: 'Sort by a measure and keep the top or bottom n.',
    params: 'measure (field), dir (asc|desc), n (1-200)',
  },
  compare: {
    op: 'compare',
    summary: 'Split into two groups on a threshold and report distribution stats for each.',
    params: 'measure (field), split_on (field), threshold (number)',
  },
} as const;

export type PrimitiveOp = keyof typeof PRIMITIVES;
export const PRIMITIVE_OPS = Object.keys(PRIMITIVES) as PrimitiveOp[];

/** Renders the field dictionary for the system prompt. Never hand-written. */
export function describeFields(): string {
  return FIELD_NAMES.map((n) => {
    const f = FIELDS[n];
    return `- ${f.name} (${f.unit}, range ${f.range[0]}–${f.range[1]}): ${f.description}`;
  }).join('\n');
}

/** Renders the primitive catalog for the system prompt. Never hand-written. */
export function describePrimitives(): string {
  return PRIMITIVE_OPS.map((o) => {
    const p = PRIMITIVES[o];
    return `- ${p.op}(${p.params}) — ${p.summary}`;
  }).join('\n');
}
