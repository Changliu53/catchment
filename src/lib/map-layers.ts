/**
 * The map's sources and layers, as data.
 *
 * These were forty lines of `m.addSource` / `m.addLayer` inside a callback
 * inside an effect inside a client component, which put them out of reach of
 * everything except a headless browser with WebGL. That matters more here than
 * it looks, because the map has failed twice in ways that no rendering test
 * would catch and a reading of these specs would:
 *
 *   - a results source without `promoteId` accepts every `setFeatureState`
 *     call without complaint and highlights nothing, because feature-state
 *     keys on the feature id and GeoJSON features have none;
 *   - a layer added before the layer it must sit above is silently drawn
 *     underneath it, and the county mask is translucent white over the whole
 *     world, so "underneath" means invisible.
 *
 * Declaring them means the invariants — draw order, every layer pointing at a
 * source that exists, the handoff zoom where dots fade out as polygons become
 * legible — can be asserted directly. `MapView` walks these arrays in order;
 * it no longer knows what is in them.
 *
 * Only the parts that never change live here. Anything that depends on the
 * current answer (the colour ramp, the comparison's filter) is applied by
 * `paint`, and the two dynamic expressions it needs are the functions at the
 * bottom.
 */

import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';

import { COUNTY, OUTSIDE_COUNTY } from '@/lib/geo';
import { FILL_OPACITY, RAMP, SPLIT_OUTLINE } from '@/lib/ramp';

/** True when the reader is pointing at this feature. */
const HOVERED = ['boolean', ['feature-state', 'hover'], false] as const;

/**
 * Above this zoom a block group is wide enough to read as a shape, so the dots
 * are gone; below it they are the only thing visible in a sparse result. The
 * fade runs from 11.5 to 13 so the two never both compete for the eye.
 */
export const DOT_HANDOFF = { start: 11.5, end: 13 } as const;

export const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * The county frame is filled here and never touched again — its data is a
 * constant. The two results sources are created empty and filled by `paint`,
 * which is what makes a style swap survivable: rebuilding the layers and
 * refilling them are separate steps, and the refill can run at any time.
 */
export const SOURCES: Record<string, SourceSpecification> = {
  county: { type: 'geojson', data: OUTSIDE_COUNTY as never },
  'county-line': { type: 'geojson', data: COUNTY as never },
  // promoteId lifts geoid into the feature id, which feature-state keys on.
  results: { type: 'geojson', promoteId: 'geoid', data: EMPTY },
  'results-points': { type: 'geojson', promoteId: 'geoid', data: EMPTY },
};

/** The sources whose contents change with the answer. */
export const RESULT_SOURCES = ['results', 'results-points'] as const;

/** The layers a pointer can pick a block group out of. */
export const INTERACTIVE = ['results-fill', 'results-dots'] as const;

/**
 * Added in this order, which is also back to front: the county frame first, so
 * every results layer sits on top of it.
 */
export const LAYERS: LayerSpecification[] = [
  {
    id: 'county-mask',
    type: 'fill',
    source: 'county',
    paint: { 'fill-color': '#f8fafc', 'fill-opacity': 0.6 },
  },
  {
    id: 'county-outline',
    type: 'line',
    source: 'county-line',
    paint: { 'line-color': '#64748b', 'line-width': 1.25, 'line-opacity': 0.9 },
  },
  {
    id: 'results-fill',
    type: 'fill',
    source: 'results',
    // Replaced by `paint` as soon as there is anything to shade; a flat colour
    // here rather than the ramp so an unshaded result is not a map of noise.
    paint: { 'fill-color': RAMP[1], 'fill-opacity': FILL_OPACITY },
  },
  {
    id: 'results-line',
    type: 'line',
    source: 'results',
    paint: {
      // White for the hovered edge: against six shades of blue, lighter reads
      // as "picked out" at every step, where darker vanishes into the dark end
      // of the ramp.
      'line-color': ['case', HOVERED, '#ffffff', '#1e293b'] as never,
      'line-width': ['case', HOVERED, 2.5, 0.9] as never,
      'line-opacity': ['case', HOVERED, 1, 0.7] as never,
    },
  },
  {
    // The comparison's grouping, drawn over the graded fill. Hidden until
    // there is a comparison on screen, and filtered to nothing until then —
    // a visible layer with no filter is every block group in the county
    // outlined in amber.
    id: 'results-split',
    type: 'line',
    source: 'results',
    layout: { visibility: 'none' },
    filter: ['==', ['get', 'geoid'], ''],
    paint: {
      'line-color': SPLIT_OUTLINE,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.1, 12, 2] as never,
    },
  },
  {
    // Block groups are small. A result scattered across the county forces a
    // zoom where each polygon is a few pixels wide — drawn, but on a busy
    // basemap indistinguishable from nothing. Dots carry the same colour there
    // and hand back to the polygons on the way in.
    id: 'results-dots',
    type: 'circle',
    source: 'results-points',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 11, 7, 13, 9] as never,
      'circle-color': RAMP[1],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', HOVERED, 3, 1.5] as never,
      'circle-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        DOT_HANDOFF.start,
        0.95,
        DOT_HANDOFF.end,
        0,
      ] as never,
      'circle-stroke-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        DOT_HANDOFF.start,
        1,
        DOT_HANDOFF.end,
        0,
      ] as never,
    },
  },
];

/**
 * Which block groups the comparison outlines.
 *
 * `to-number` rather than a bare `get`: the split field arrives as a GeoJSON
 * property, and a numeric string compares as a string against a number — which
 * in MapLibre's evaluator is not an error, just a filter that matches nothing.
 */
export function splitFilter(field: string, threshold: number): unknown {
  return ['>=', ['to-number', ['get', field]], threshold];
}

/**
 * The outline weight for the ordinary results edge.
 *
 * A comparison covers the whole county, so every polygon has a neighbour and
 * 2,830 outlined shapes read as a mesh laid over the map rather than as
 * boundaries. The hovered edge stays at full strength either way — that is the
 * one the reader is asking about.
 */
export function lineOpacity(split: boolean): unknown {
  return ['case', HOVERED, 1, split ? 0.25 : 0.7];
}
