'use client';

/**
 * The map. MapLibre with a free CARTO basemap, so there is no token to leak
 * and no account that can lapse and break the demo months from now.
 *
 * Colour encodes one measure at a time, on a sequential ramp with the breaks
 * computed from the data actually on screen rather than fixed thresholds:
 * a fixed ramp would render most results as a single flat colour, since the
 * distributions here are heavily skewed.
 */

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { FILL_OPACITY, RAMP } from '@/lib/ramp';

/**
 * Basemap, with a fallback.
 *
 * CARTO's keyless service is gated now: its sprite sheet returns a 103-byte
 * stub and its raster tiles come back stamped "API KEY REQUIRED". Both
 * symptoms have the same cause, and neither one fails loudly — the style
 * simply never finishes loading, or the tiles render with a watermark baked
 * into the image.
 *
 * OpenFreeMap is a free, keyless public service whose sprite and glyphs are
 * real (27 KB and 76 KB, verified). It is still someone else's server, so a
 * watchdog swaps in plain OpenStreetMap raster tiles if the style has not
 * loaded in time. A basemap that quietly stops working a year from now would
 * take the whole demo with it, and nobody would be watching when it happened.
 */
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

const FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const STYLE_TIMEOUT_MS = 12_000;

const HARRIS_CENTER: [number, number] = [-95.44, 29.82];


/**
 * Centroid of a polygon, good enough for placing a dot.
 *
 * Not a true centroid — the mean of the outer ring's vertices. For a census
 * block group that is within a few hundred metres of the real one, which is
 * invisible at the zooms this layer exists for.
 */
function centroidOf(geometry: unknown): [number, number] | null {
  const g = geometry as { type: string; coordinates: number[][][][] | number[][][] };
  const polys = g?.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : [g?.coordinates as number[][][]];
  let x = 0, y = 0, n = 0;
  for (const poly of polys ?? []) {
    const ring = poly?.[0];
    if (!ring) continue;
    for (const c of ring) { x += c[0]!; y += c[1]!; n++; }
  }
  return n === 0 ? null : [x / n, y / n];
}

export interface Feature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, number | string | boolean | null>;
}

interface Props {
  features: Feature[];
  colorBy: string | null;
  /** Class breaks, computed once by the page so the legend and the map agree. */
  breaks: number[];
  onHover: (props: Record<string, number | string | boolean | null> | null) => void;
}


export default function MapView({ features, colorBy, breaks, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const hovered = useRef<string | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: HARRIS_CENTER,
      zoom: 8.4,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Surface style and tile failures. Previously a stalled style produced a
    // blank map with an empty console, which is the hardest kind of bug to see.
    m.on('error', (e) => console.error('[map]', e.error?.message ?? e));

    const addLayers = () => {
      if (m.getSource('results')) return; // idempotent
      // promoteId lifts geoid into the feature id, which is what feature-state
      // keys on. Without it the hovered polygon cannot be styled at all.
      m.addSource('results', {
        type: 'geojson',
        promoteId: 'geoid',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'results-fill',
        type: 'fill',
        source: 'results',
        paint: { 'fill-color': RAMP[0]!, 'fill-opacity': FILL_OPACITY },
      });
      // Block groups are small. A result scattered across the county forces a
      // zoom where each polygon is a few pixels wide — drawn, but unreadable,
      // and on a busy basemap indistinguishable from nothing at all. Dots carry
      // the same colour at those zooms and hand over to the polygons on the way
      // in, so there is never a zoom at which the answer is invisible.
      m.addSource('results-points', {
        type: 'geojson',
        promoteId: 'geoid',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'results-dots',
        type: 'circle',
        source: 'results-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 11, 7, 13, 9],
          'circle-color': RAMP[0]!,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.95, 13, 0],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 1, 13, 0],
        },
      });

      m.addLayer({
        id: 'results-line',
        type: 'line',
        source: 'results',
        paint: {
          // The hovered polygon gets a white halo rather than a darker edge:
          // against six shades of blue, lighter reads as "picked out" at every
          // step of the ramp, where a darker line disappears into the dark end.
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', '#1e293b'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.9],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.7],
        },
      });

      // Hovering a dot means hovering the block group it stands for, so both
      // layers drive the same highlight. Highlight state lives on the polygon
      // source: the dot is a stand-in for it, not a separate thing.
      const setHovered = (id: string | null) => {
        if (hovered.current === id) return;
        if (hovered.current !== null) {
          m.setFeatureState({ source: 'results', id: hovered.current }, { hover: false });
          m.setFeatureState({ source: 'results-points', id: hovered.current }, { hover: false });
        }
        hovered.current = id;
        if (id !== null) {
          m.setFeatureState({ source: 'results', id }, { hover: true });
          m.setFeatureState({ source: 'results-points', id }, { hover: true });
        }
      };

      for (const layer of ['results-fill', 'results-dots'] as const) {
        m.on('mousemove', layer, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = 'pointer';
          setHovered((f.id ?? f.properties?.['geoid'] ?? null) as string | null);
          onHover(f.properties ?? null);
        });
        m.on('mouseleave', layer, () => {
          m.getCanvas().style.cursor = '';
          setHovered(null);
          onHover(null);
        });
      }

      ready.current = true;
    };

    if (m.isStyleLoaded()) addLayers();
    else m.on('load', addLayers);
    // setStyle drops every layer we added, so re-add whenever a style settles.
    m.on('styledata', () => {
      if (m.isStyleLoaded()) addLayers();
    });

    // The watchdog must only count time the page was actually visible.
    // Chrome pauses requestAnimationFrame in background tabs, so MapLibre
    // never renders a frame and never finishes loading its style there. A
    // naive timer therefore fires for everyone who opens this in a background
    // tab — demoting them to the fallback basemap when nothing was wrong.
    let elapsed = 0;
    const TICK = 1000;
    const watchdog = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (m.isStyleLoaded()) {
        clearInterval(watchdog);
        return;
      }
      elapsed += TICK;
      if (elapsed >= STYLE_TIMEOUT_MS) {
        clearInterval(watchdog);
        console.warn('[map] basemap did not load while visible; falling back to OSM raster');
        m.setStyle(FALLBACK);
      }
    }, TICK);

    map.current = m;
    return () => {
      clearInterval(watchdog);
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, [onHover]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const apply = () => {
      const src = m.getSource('results') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;

      src.setData({ type: 'FeatureCollection', features: features as never[] });

      const dots = m.getSource('results-points') as maplibregl.GeoJSONSource | undefined;
      dots?.setData({
        type: 'FeatureCollection',
        features: features.flatMap((f) => {
          const c = centroidOf(f.geometry);
          return c ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: f.properties }] : [];
        }) as never[],
      });

      if (colorBy && breaks.length > 0) {
        const expr: unknown[] = ['step', ['to-number', ['get', colorBy], 0], RAMP[0]!];
        breaks.forEach((b, i) => expr.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]!));
        m.setPaintProperty('results-fill', 'fill-color', expr as never);
        m.setPaintProperty('results-dots', 'circle-color', expr as never);
      } else {
        m.setPaintProperty('results-fill', 'fill-color', RAMP[1]!);
        m.setPaintProperty('results-dots', 'circle-color', RAMP[1]!);
      }

      if (features.length > 0) {
        const b = new maplibregl.LngLatBounds();
        for (const f of features) {
          const g = f.geometry as { type: string; coordinates: number[][][][] | number[][][] };
          const polys = g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : [g.coordinates as number[][][]];
          for (const poly of polys) for (const ring of poly) for (const c of ring) {
            b.extend([c[0]!, c[1]!]);
          }
        }
        if (!b.isEmpty()) m.fitBounds(b, { padding: 56, maxZoom: 12, duration: 600 });
      }
    };

    if (ready.current) apply();
    else m.on('load', apply);
  }, [features, colorBy, breaks]);

  return <div ref={container} className="h-full w-full" aria-label="Map of analysis results" />;
}
