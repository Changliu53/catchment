'use client';

/**
 * The results map.
 *
 * Two things here are load-bearing and were each the cause of a blank map:
 *
 *  1. `setStyle` destroys every source and layer. The style can change at any
 *     time — the basemap watchdog swaps in a fallback — so rebuilding the
 *     layers and *refilling them with the current data* has to happen together.
 *     Rebuilding alone leaves correctly-configured, empty layers, and a map
 *     that renders nothing while every other check passes.
 *
 *  2. MapLibre draws on requestAnimationFrame, which Chrome pauses in
 *     background tabs. A map created in a hidden tab never renders, never fires
 *     `load`, and never finishes loading its style. Nothing here may assume
 *     `load` has fired, and the watchdog must not count time spent hidden.
 */

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { FILL_OPACITY, RAMP } from '@/lib/ramp';

/**
 * Basemap, with a fallback.
 *
 * CARTO's keyless service is gated: its sprite returns a stub and its raster
 * tiles arrive stamped "API KEY REQUIRED". OpenFreeMap is keyless and its
 * assets are real, but it is still someone else's server, so a watchdog swaps
 * in OpenStreetMap raster tiles if the style has not loaded while visible.
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

export interface Feature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, number | string | boolean | null>;
}

interface Props {
  features: Feature[];
  colorBy: string | null;
  /** Class breaks, computed by the page so the legend and the map agree. */
  breaks: number[];
  onHover: (props: Record<string, number | string | boolean | null> | null) => void;
}

/**
 * Mean of a polygon's outer-ring vertices. Not a true centroid, but within a
 * few hundred metres of one for a census block group — invisible at the zooms
 * the dot layer exists for.
 */
function centroidOf(geometry: unknown): [number, number] | null {
  const g = geometry as { type?: string; coordinates?: unknown };
  const polys = (g?.type === 'MultiPolygon'
    ? (g.coordinates as number[][][][])
    : [g?.coordinates as number[][][]]) ?? [];

  let x = 0;
  let y = 0;
  let n = 0;
  for (const poly of polys) {
    for (const c of poly?.[0] ?? []) {
      x += c[0]!;
      y += c[1]!;
      n++;
    }
  }
  return n === 0 ? null : [x / n, y / n];
}

function colorExpression(colorBy: string | null, breaks: number[]): unknown {
  if (!colorBy || breaks.length === 0) return RAMP[1]!;
  const expr: unknown[] = ['step', ['to-number', ['get', colorBy], 0], RAMP[0]!];
  breaks.forEach((b, i) => expr.push(b, RAMP[Math.min(i + 1, RAMP.length - 1)]!));
  return expr;
}

export default function MapView({ features, colorBy, breaks, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const hovered = useRef<string | null>(null);

  // The latest render inputs, readable from callbacks that outlive a render.
  // Without this, a style swap rebuilds the layers against whatever `features`
  // was closed over when the map was created — which is the empty first render.
  const latest = useRef({ features, colorBy, breaks });
  latest.current = { features, colorBy, breaks };

  // Fills the existing layers from `latest`. Safe to call at any time: it does
  // nothing until the layers exist, and it is what makes a style swap
  // recoverable rather than terminal.
  const paint = useRef<(fit: boolean) => void>(() => {});

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
    m.on('error', (e) => console.error('[map]', e.error?.message ?? e));

    paint.current = (fit: boolean) => {
      const polygons = m.getSource('results') as maplibregl.GeoJSONSource | undefined;
      const dots = m.getSource('results-points') as maplibregl.GeoJSONSource | undefined;
      if (!polygons || !dots) return;

      const { features: fs, colorBy: cb, breaks: bk } = latest.current;

      polygons.setData({ type: 'FeatureCollection', features: fs as never[] });
      dots.setData({
        type: 'FeatureCollection',
        features: fs.flatMap((f) => {
          const c = centroidOf(f.geometry);
          return c
            ? [
                {
                  type: 'Feature' as const,
                  geometry: { type: 'Point' as const, coordinates: c },
                  properties: f.properties,
                },
              ]
            : [];
        }) as never[],
      });

      const color = colorExpression(cb, bk);
      m.setPaintProperty('results-fill', 'fill-color', color as never);
      m.setPaintProperty('results-dots', 'circle-color', color as never);

      if (fit && fs.length > 0) {
        const b = new maplibregl.LngLatBounds();
        for (const f of fs) {
          const g = f.geometry as { type: string; coordinates: number[][][][] | number[][][] };
          const polys =
            g.type === 'MultiPolygon'
              ? (g.coordinates as number[][][][])
              : [g.coordinates as number[][][]];
          for (const poly of polys) for (const ring of poly) for (const c of ring) {
            b.extend([c[0]!, c[1]!]);
          }
        }
        if (!b.isEmpty()) m.fitBounds(b, { padding: 56, maxZoom: 12, duration: 600 });
      }
    };

    const setHovered = (id: string | null) => {
      if (hovered.current === id) return;
      for (const source of ['results', 'results-points'] as const) {
        if (hovered.current !== null) {
          m.setFeatureState({ source, id: hovered.current }, { hover: false });
        }
        if (id !== null) m.setFeatureState({ source, id }, { hover: true });
      }
      hovered.current = id;
    };

    const build = () => {
      if (m.getSource('results')) return;

      // promoteId lifts geoid into the feature id, which feature-state keys on.
      m.addSource('results', {
        type: 'geojson',
        promoteId: 'geoid',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addSource('results-points', {
        type: 'geojson',
        promoteId: 'geoid',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: 'results-fill',
        type: 'fill',
        source: 'results',
        paint: { 'fill-color': RAMP[1]!, 'fill-opacity': FILL_OPACITY },
      });
      m.addLayer({
        id: 'results-line',
        type: 'line',
        source: 'results',
        paint: {
          // White for the hovered edge: against six shades of blue, lighter
          // reads as "picked out" at every step, where darker vanishes into
          // the dark end of the ramp.
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', '#1e293b'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.9],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.7],
        },
      });

      // Block groups are small. A result scattered across the county forces a
      // zoom where each polygon is a few pixels wide — drawn, but on a busy
      // basemap indistinguishable from nothing. Dots carry the same colour
      // there and hand back to the polygons on the way in.
      m.addLayer({
        id: 'results-dots',
        type: 'circle',
        source: 'results-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 11, 7, 13, 9],
          'circle-color': RAMP[1]!,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.95, 13, 0],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 1, 13, 0],
        },
      });

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

      // The whole point: rebuilt layers are useless empty. Refill immediately,
      // without re-framing — a style swap should not yank the user's view.
      paint.current(false);
    };

    // `styledata` fires for the first style and for every later one, so this
    // single hook covers both the initial build and any fallback swap. `load`
    // may never fire at all if the tab starts hidden.
    m.on('styledata', () => {
      if (m.isStyleLoaded()) build();
    });
    if (m.isStyleLoaded()) build();

    // Count only time the page was actually visible: rAF is paused in a
    // background tab, so a plain timer demotes every background-opened page to
    // the fallback basemap when nothing was wrong.
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
      paint.current = () => {};
    };
  }, [onHover]);

  // New results: refill and frame them.
  useEffect(() => {
    paint.current(true);
  }, [features, colorBy, breaks]);

  return <div ref={container} className="h-full w-full" aria-label="Map of analysis results" />;
}
