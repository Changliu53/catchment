/**
 * The geometry the map depends on, tested without a map.
 *
 * Both of these lived inside `MapView`, where exercising them meant starting
 * WebGL in a headless browser — so neither was ever tested. `centroidOf` had a
 * real bug at one point (an earlier version assumed convex polygons, which
 * census block groups are emphatically not), and nothing would have caught it.
 */

import { describe, expect, it } from 'vitest';

import { boundsOf, centroidOf, OUTSIDE_COUNTY } from '@/lib/geo';

const square = (x: number, y: number, size = 2) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

describe('centroidOf', () => {
  it('finds the middle of a simple shape', () => {
    // The closing vertex repeats the first, which pulls a vertex mean slightly
    // towards that corner. For a square that still lands inside.
    const [x, y] = centroidOf(square(0, 0))!;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(2);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(2);
  });

  it('handles a MultiPolygon by averaging every part', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0).coordinates, square(10, 0).coordinates],
    };

    const [x] = centroidOf(multi)!;
    expect(x).toBeGreaterThan(2);
    expect(x).toBeLessThan(11);
  });

  it('ignores holes', () => {
    // Averaging the inner ring in as well drags the point towards whatever is
    // missing from the shape, which is the opposite of what a marker should do.
    const withHole = {
      type: 'Polygon',
      coordinates: [
        square(0, 0, 10).coordinates[0],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    };

    const solid = centroidOf(square(0, 0, 10));
    expect(centroidOf(withHole)).toEqual(solid);
  });

  it('is null for geometry it cannot read, rather than NaN', () => {
    // A NaN coordinate reaches MapLibre and throws somewhere unrelated.
    for (const bad of [null, undefined, {}, { type: 'Point' }, { type: 'Polygon' }]) {
      expect(centroidOf(bad)).toBeNull();
    }
  });
});

describe('boundsOf', () => {
  it('covers every feature', () => {
    const box = boundsOf([{ geometry: square(0, 0) }, { geometry: square(10, 5) }])!;
    expect(box).toEqual([0, 0, 12, 7]);
  });

  it('reads a MultiPolygon as one shape', () => {
    const box = boundsOf([
      {
        geometry: {
          type: 'MultiPolygon',
          coordinates: [square(0, 0).coordinates, square(10, 10).coordinates],
        },
      },
    ])!;
    expect(box).toEqual([0, 0, 12, 12]);
  });

  it('is null when there is nothing to frame', () => {
    // The reason this is null and not a zero-size box: `fitBounds` on an empty
    // bounding box flies the camera to the Gulf of Guinea, which is a
    // confusing way to say "no results".
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ geometry: null }])).toBeNull();
    expect(boundsOf([{ geometry: { type: 'Polygon', coordinates: [[]] } }])).toBeNull();
  });

  it('skips coordinates that are not numbers', () => {
    const box = boundsOf([
      { geometry: { type: 'Polygon', coordinates: [[[NaN, 1] as never, [3, 4], [5, 6]]] } },
    ])!;
    expect(box).toEqual([3, 4, 5, 6]);
  });
});

describe('the county mask', () => {
  it('is the world with the county as a hole', () => {
    const rings = OUTSIDE_COUNTY.geometry.coordinates;
    expect(rings.length).toBeGreaterThanOrEqual(2);

    // The outer ring stops at ±85° because Web Mercator does not reach the
    // poles; ±90 would be an invalid latitude by the time it is projected.
    const outer = rings[0]!;
    expect(Math.max(...outer.map((c) => Math.abs(c[1]!)))).toBe(85);
    expect(Math.max(...outer.map((c) => Math.abs(c[0]!)))).toBe(180);
  });

  it('punches a hole that is actually Harris County', () => {
    const hole = OUTSIDE_COUNTY.geometry.coordinates[1]!;
    const lngs = hole.map((c) => c[0]!);
    const lats = hole.map((c) => c[1]!);

    // Harris County sits around -95.4, 29.8. A mask cut in the wrong place
    // would hide the study area and highlight the Gulf.
    expect(Math.min(...lngs)).toBeGreaterThan(-96.5);
    expect(Math.max(...lngs)).toBeLessThan(-94.5);
    expect(Math.min(...lats)).toBeGreaterThan(29);
    expect(Math.max(...lats)).toBeLessThan(30.5);
  });
});
