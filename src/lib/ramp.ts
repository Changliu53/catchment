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
 * The outline that marks the group a comparison is splitting on.
 *
 * A comparison has two variables — the measure it compares and the field it
 * splits on — and they need separate visual channels or one of them is simply
 * absent. The fill grades the measure; this outlines the group. Amber rather
 * than another blue: it has to read as a different kind of statement than the
 * ramp underneath it, not as one more class of it.
 */
export const SPLIT_OUTLINE = '#b45309';

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
