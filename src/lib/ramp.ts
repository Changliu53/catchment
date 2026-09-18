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
