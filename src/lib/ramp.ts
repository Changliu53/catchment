/**
 * The choropleth ramp and its class breaks.
 *
 * Sequential, so: one hue, light to dark, monotone. The steps start at blue-500
 * rather than blue-100 because the marks sit at 0.85 opacity over a basemap,
 * and the blend is what the reader actually sees. Measured against the map's
 * land colour, the old light end came out at 1.05:1 — invisible. These six
 * clear 2.69:1 at the light end and stay separated all the way down.
 *
 * Breaks are quantiles of the values on screen, not fixed thresholds. Every
 * distribution here is heavily right-skewed: population density spans three
 * orders of magnitude, and equal-interval breaks would paint 95% of the county
 * in the first class and call it a map.
 */

export const RAMP = ['#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'] as const;

export const FILL_OPACITY = 0.85;

/**
 * For block groups with no value for the field being shaded.
 *
 * Deliberately outside the ramp: a neutral grey reads as "not measured", where
 * any blue — however pale — reads as "measured, and low". 273 of the county's
 * 2,830 block groups have no median household income because the Census
 * suppresses small samples, and painting those as the poorest areas in the
 * county would be a claim the data does not make.
 */
export const NO_DATA = '#cbd5e1';

/**
 * The fill colour for the shaded field, as a MapLibre expression.
 *
 * The null branch is the point. `['==', ['get', f], null]` was checked against
 * MapLibre's own expression evaluator rather than assumed: it returns true for
 * a property that is null *and* for one that is absent, which is what we want.
 * Two plausible-looking alternatives do not —
 *
 *   ['has', f]                          treats an explicit null as present
 *   ['==', ['to-number', ['get', f], -1], -1]   never matches, because
 *                                       to-number turns null into 0, not into
 *                                       the fallback
 *
 * — and the second fails silently, which is how a bug like this survives a
 * code review.
 */
/**
 * The two ends of the ramp, for a comparison.
 *
 * A `compare` step has no field to shade by — its output is a pair of
 * distributions, not a value per row — so the map used to paint all 2,830
 * block groups one flat colour and say nothing at all. These two classes let
 * it say the thing the statistics table cannot: where each group actually is.
 *
 * Two ends of the sequential ramp rather than two unrelated hues, because the
 * split is ordinal. `flood_pct >= 0.5` is *more* than `< 0.5`, and a
 * categorical pair would assert the groups are unordered.
 */
export const SPLIT_BELOW = RAMP[0];
export const SPLIT_ABOVE = RAMP[4];

/** Fill colour for a comparison: which side of the threshold each row falls. */
export function splitExpression(field: string, threshold: number): unknown {
  return [
    'case',
    ['==', ['get', field], null],
    NO_DATA,
    ['>=', ['to-number', ['get', field]], threshold],
    SPLIT_ABOVE,
    SPLIT_BELOW,
  ];
}

export function colorExpression(colorBy: string | null, breaks: number[]): unknown {
  if (!colorBy) return RAMP[1];

  const shaded: unknown[] =
    breaks.length === 0
      ? [RAMP[1]]
      : ['step', ['to-number', ['get', colorBy]], RAMP[0]];
  if (breaks.length > 0) {
    breaks.forEach((b, i) => shaded.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]!));
  }

  return ['case', ['==', ['get', colorBy], null], NO_DATA, breaks.length === 0 ? RAMP[1] : shaded];
}

/**
 * Upper bounds for classes 0..n-2; the last class is everything above the last
 * break. Duplicate values are dropped, so a field where most rows share one
 * value yields fewer classes rather than several identical ones.
 */
export function quantileBreaks(values: number[], classes: number = RAMP.length): number[] {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return [];

  const min = clean[0]!;
  const out: number[] = [];
  for (let i = 1; i < classes; i++) {
    const v = clean[Math.floor((clean.length - 1) * (i / classes))];
    if (v === undefined) continue;
    // A break at the minimum is not a break: it would open a class that no row
    // can fall into, and a field where every row shares one value would still
    // get two colours on the map and two rows in the legend.
    if (v <= min) continue;
    if (out.length === 0 || v > out[out.length - 1]!) out.push(v);
  }
  return out;
}

/** Inclusive-lower ranges per class, for the legend. */
export function classRanges(breaks: number[], min: number, max: number) {
  const edges = [min, ...breaks, max];
  return edges.slice(0, -1).map((lo, i) => ({
    color: RAMP[Math.min(i, RAMP.length - 1)]!,
    lo,
    hi: edges[i + 1]!,
  }));
}
