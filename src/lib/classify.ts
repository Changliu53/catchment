/**
 * Turning an answer's rows into the numbers the map and the legend both need.
 *
 * It happens once, in one place, on the server. If the map computed its own
 * breaks the legend would be describing a different map than the one drawn —
 * and doing it on the server means the legend is ordinary HTML rather than
 * something the browser has to compute before it can be read.
 */

import { quantileBreaks } from './ramp';

export interface Classification {
  /** Values that exist, for the quantile breaks and the legend's counts. */
  values: number[];
  breaks: number[];
  /** Rows with no value for this field. Counted, never coerced. */
  missing: number;
}

export function classify(
  features: { properties: Record<string, unknown> }[],
  colorBy: string | null,
): Classification {
  if (!colorBy) return { values: [], breaks: [], missing: 0 };

  const values: number[] = [];
  let missing = 0;

  for (const f of features) {
    const raw = f.properties[colorBy];
    // `Number(null)` is 0, which once put 273 block groups with suppressed
    // income at the bottom of the distribution: painted as the poorest areas
    // in the county, and dragging every quantile break down with them.
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(n)) values.push(n);
    else missing++;
  }

  return { values, breaks: quantileBreaks(values), missing };
}
