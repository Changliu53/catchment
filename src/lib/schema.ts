/**
 * Single source of truth for the analysis contract.
 *
 * Everything downstream is generated from this file: the Zod validators, the
 * Anthropic tool schema, and the field/primitive documentation injected into
 * the system prompt. Adding a field or a primitive means editing exactly one
 * place, so the prompt can never drift away from what the executor supports.
 */

/**
 * A measurable attribute of a census block group.
 *
 * `label` and `format` live here rather than in the UI, and that was a
 * correction: `format.ts` used to keep its own label map and its own switch
 * over units, so adding a field meant editing three places and forgetting one
 * of them showed up as a raw column name or an unlabelled number in the
 * legend. The whole point of this file is that adding a field is one edit.
 */
export interface FieldSpec {
  readonly name: string;
  /** What a reader is shown. `name` is what the model and the data use. */
  readonly label: string;
  readonly unit: string;
  readonly description: string;
  /** Plausible range. Used by the semantic validator to reject absurd thresholds. */
  readonly range: readonly [number, number];
  /** How one value of this field reads. Units are never hard-coded in the UI. */
  readonly format: (v: number) => string;
}

const int = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
const oneDp = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(v);

const FIELDS_RAW = {
  pop: {
    name: 'pop',
    label: 'Population',
    unit: 'people',
    description: 'Total population (ACS B01003_001E)',
    range: [0, 20_000],
    format: (v) => int(v),
  },
  median_income: {
    name: 'median_income',
    label: 'Median household income',
    unit: 'USD/year',
    description: 'Median household income (ACS B19013_001E). Null where suppressed.',
    range: [0, 300_000],
    format: (v) => `$${int(v)}`,
  },
  area_m2: {
    name: 'area_m2',
    label: 'Area',
    unit: 'm^2',
    description: 'Block group area, measured in EPSG:32615',
    range: [0, 2_000_000_000],
    format: (v) => `${oneDp(v / 1e6)} km²`,
  },
  flood_pct: {
    name: 'flood_pct',
    label: 'Area in the 100-year floodplain',
    unit: 'fraction 0-1',
    description:
      'Share of area inside a FEMA Special Flood Hazard Area — the 1% annual chance ' +
      '("100-year") floodplain, where flood insurance is federally mandated',
    range: [0, 1],
    format: (v) => `${oneDp(v * 100)}%`,
  },
  flood_pct_500: {
    name: 'flood_pct_500',
    label: 'Area in the 0.2% annual chance zone',
    unit: 'fraction 0-1',
    description:
      'Share of area in the 0.2% annual chance ("500-year") zone. Not a subset of ' +
      'flood_pct: many Houston homes flooded in Harvey while outside the SFHA, so ' +
      'reporting only flood_pct understates real exposure',
    range: [0, 1],
    format: (v) => `${oneDp(v * 100)}%`,
  },
  dist_grocery_m: {
    name: 'dist_grocery_m',
    label: 'Distance to nearest supermarket',
    unit: 'm',
    description: 'Straight-line distance from centroid to nearest supermarket',
    range: [0, 50_000],
    format: (v) => (v >= 1000 ? `${oneDp(v / 1000)} km` : `${int(v)} m`),
  },
  dist_park_m: {
    name: 'dist_park_m',
    label: 'Distance to nearest park',
    unit: 'm',
    description: 'Straight-line distance from centroid to nearest park',
    range: [0, 50_000],
    format: (v) => (v >= 1000 ? `${oneDp(v / 1000)} km` : `${int(v)} m`),
  },
  pop_density: {
    name: 'pop_density',
    label: 'Population density',
    unit: 'people/km^2',
    description: 'Population per square kilometre, precomputed by the pipeline',
    range: [0, 100_000],
    format: (v) => `${int(v)}/km²`,
  },
} as const satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELDS_RAW;

/**
 * Widened view of the field table. `as const satisfies` above pins the key
 * names for the type system; this alias restores the uniform FieldSpec value
 * type, so every entry is readable through one shape.
 */
export const FIELDS: Record<FieldName, FieldSpec> = FIELDS_RAW;
export const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

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
    // Which floodplain, explicitly. This read "in a floodplain" until the
    // evaluation caught what that costs: asked about the 500-year zone, the
    // model reached for this op, because nothing here said it only ever means
    // flood_pct. The result validates, draws, and answers the wrong question —
    // and understating flood exposure is the specific error Harvey made
    // famous. The rule below about unqualified "floodplain" was already in the
    // prompt; it did not help, because the ambiguity was in the catalogue.
    summary:
      'Keep block groups with at least min_pct of their area in the 1% annual chance ' +
      'floodplain (flood_pct). This op only ever means flood_pct — for the 0.2% ' +
      'annual chance zone use filter on flood_pct_500.',
    params: 'min_pct (0-1)',
  },
  resource_gap: {
    op: 'resource_gap',
    summary: 'Keep block groups farther than max_distance_m from the nearest POI of a type.',
    params: 'poi_type (supermarket|park), max_distance_m (metres)',
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
