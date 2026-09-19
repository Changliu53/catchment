/**
 * The projection behind the social cards.
 *
 * Worth testing precisely because nobody looks at it: a social card is
 * rendered by a crawler, in someone else's product, weeks later. A stretched
 * county or a path that runs off the canvas would go unnoticed until it was
 * the first thing a reader saw.
 */

import { describe, expect, it } from 'vitest';

import { countyPath } from '@/lib/county-path';
import COUNTY from '@/lib/harris-county.json';

/** Every `x,y` pair in a `d` string. */
function coordinates(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('countyPath', () => {
  it('stays inside the box it was given', () => {
    const { d } = countyPath(360, 360);
    const points = coordinates(d);

    expect(points.length).toBeGreaterThan(100);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(-0.1);
      expect(x).toBeLessThanOrEqual(360.1);
      expect(y).toBeGreaterThanOrEqual(-0.1);
      expect(y).toBeLessThanOrEqual(360.1);
    }
  });

  it('touches the edge on the axis that ran out, and is centred on the other', () => {
    const { d, width, height } = countyPath(360, 360);
    const points = coordinates(d);

    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);

    // One axis fills the box; whichever it is, the extent reported must match
    // the extent actually drawn.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(width, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(height, 0);
    expect(Math.max(width, height)).toBeCloseTo(360, 0);

    // Centred: the slack is the same on both sides.
    expect(Math.min(...xs)).toBeCloseTo(360 - Math.max(...xs), 0);
    expect(Math.min(...ys)).toBeCloseTo(360 - Math.max(...ys), 0);
  });

  it('does not stretch the county', () => {
    // The regression this guards is scaling each axis to fill the box, which
    // is the obvious implementation and makes Harris County visibly wrong.
    const rings = (COUNTY.geometry as { coordinates: number[][][] }).coordinates;
    const points = rings.flat();
    const xs = points.map((p) => p[0]!);
    const ys = points.map((p) => p[1]!);

    const lonScale = Math.cos((29.8 * Math.PI) / 180);
    const trueAspect = ((Math.max(...xs) - Math.min(...xs)) * lonScale) / (Math.max(...ys) - Math.min(...ys));

    const { width, height } = countyPath(360, 360);
    expect(width / height).toBeCloseTo(trueAspect, 3);

    // And the same shape whatever box it is fitted into.
    const wide = countyPath(1200, 400);
    expect(wide.width / wide.height).toBeCloseTo(trueAspect, 3);
  });

  it('closes every ring', () => {
    const { d } = countyPath(200, 200);
    const rings = d.split('Z').filter((part) => part.trim());

    expect(rings.length).toBeGreaterThanOrEqual(1);
    // A ring that is not closed renders as a stroked squiggle rather than a
    // filled county once `fill` is applied.
    for (const ring of rings) expect(ring.trim().startsWith('M')).toBe(true);
  });
});
