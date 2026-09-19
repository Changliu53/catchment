/**
 * Geometry, without a map.
 *
 * These were inline in `MapView`, which meant they could only be exercised by
 * starting WebGL in a headless browser — so they never were. They are ordinary
 * functions over coordinates and belong where they can be called directly:
 * the centroid had a real bug once (it assumed convex polygons, which census
 * block groups are not), and nothing would have caught it here.
 */

import COUNTY from '@/lib/harris-county.json';

export type Position = [number, number];
/** West, south, east, north — the order MapLibre's LngLatBounds takes. */
export type Bounds = [number, number, number, number];

/** Every ring of a Polygon or MultiPolygon, whatever it arrives as. */
function ringsOf(geometry: unknown): number[][][] {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (!g?.coordinates) return [];

  return g.type === 'MultiPolygon'
    ? (g.coordinates as number[][][][]).flat()
    : (g.coordinates as number[][][]);
}

/**
 * Mean of a polygon's outer-ring vertices.
 *
 * Not a true centroid, and deliberately not: an area-weighted centroid is more
 * code for a difference of a few hundred metres on a census block group, which
 * is invisible at the zoom the dot layer exists for. What it must not do is
 * fall outside the shape often enough to mislead, which the vertex mean does
 * not for shapes this compact.
 *
 * Only the outer ring counts. Averaging holes in as well pulls the point
 * towards whatever is missing from the shape.
 */
export function centroidOf(geometry: unknown): Position | null {
  const g = geometry as { type?: string; coordinates?: unknown };
  const polys =
    g?.type === 'MultiPolygon'
      ? (g.coordinates as number[][][][])
      : [g?.coordinates as number[][][]];

  let x = 0;
  let y = 0;
  let n = 0;
  for (const poly of polys ?? []) {
    for (const c of poly?.[0] ?? []) {
      x += c[0]!;
      y += c[1]!;
      n++;
    }
  }
  return n === 0 ? null : [x / n, y / n];
}

/**
 * The box containing every feature, or null when there is nothing to frame.
 *
 * Null rather than a zero-size box at the origin: `fitBounds` on an empty
 * bounding box flies the camera to the Gulf of Guinea, which is a confusing
 * way to say "no results".
 */
export function boundsOf(features: readonly { geometry: unknown }[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = false;

  for (const feature of features) {
    for (const ring of ringsOf(feature.geometry)) {
      for (const c of ring) {
        const [lng, lat] = [c[0]!, c[1]!];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
        seen = true;
      }
    }
  }

  return seen ? [west, south, east, north] : null;
}

/**
 * Everything outside Harris County, as one polygon with the county punched out
 * of it. Drawn in translucent white, it turns the basemap's surroundings into
 * context and makes the study area unmistakable.
 *
 * This matters more than it sounds. The analysis covers exactly one county,
 * but the basemap runs to Galveston and beyond, so an empty stretch of map was
 * ambiguous: no block group matched here, or this was never in the dataset?
 * The mask answers that without a word of explanation.
 *
 * The outer ring stops short of the poles because Web Mercator does not reach
 * them; ±85° is the projection's own limit.
 */
const WORLD_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

const countyRings = (COUNTY.geometry as { type: string; coordinates: number[][][] }).coordinates;

export const OUTSIDE_COUNTY = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [WORLD_RING, ...countyRings],
  },
};

export { COUNTY };
