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
// maplibre-gl v5 on purpose. v6 is ESM-only and loads its Web Worker as a
// separate chunk via `new Worker(new URL(...))`; the bundler did not emit that
// URL into the deployed build, so the worker request fell back to the document
// root and came back as the 404 HTML page.
//
// That worker is what turns GeoJSON into renderable tiles, so losing it made
// the map draw nothing while every other check passed — sources present,
// layers present and on top, colour expression correct, no thrown errors. The
// only visible trace was one console line about a module script with the wrong
// MIME type. v5's UMD build inlines the worker as a Blob: nothing to resolve,
// nothing to 404.
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { boundsOf, centroidOf } from '@/lib/geo';
import {
  INTERACTIVE,
  LAYERS,
  lineOpacity,
  RESULT_SOURCES,
  SOURCES,
  splitFilter,
} from '@/lib/map-layers';
import { colorExpression } from '@/lib/ramp';

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
  /**
   * Set when the answer is a comparison. The fill still grades the measure
   * being compared — that is what the question is about — and the grouping
   * takes a second visual channel: the block groups above the threshold are
   * outlined. One variable per channel, so a reader can see whether the
   * outlined ones sit at one end of the ramp.
   *
   * The dot layer goes off with it. Dots reveal small polygons in a sparse
   * result; a comparison returns the whole county, where they cover the answer.
   */
  split: { field: string; threshold: number } | null;
  onHover: (props: Record<string, number | string | boolean | null> | null) => void;
  /**
   * A block group the reader picked, rather than passed over. Touch devices
   * have no hover, so without this every per-block-group number — population,
   * income, flood share, distances — is unreachable on a phone and the map is
   * decoration.
   */
  onSelect: (props: Record<string, number | string | boolean | null> | null) => void;
}

export default function MapView({ features, colorBy, breaks, split, onHover, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const hovered = useRef<string | null>(null);

  // The latest render inputs, readable from callbacks that outlive a render.
  // Without this, a style swap rebuilds the layers against whatever `features`
  // was closed over when the map was created — which is the empty first render.
  //
  // It is seeded from the first render and updated in the same effect that
  // repaints — see the bottom of this component. It used to be assigned in the
  // render body, which is a side effect inside a function React may call
  // speculatively, abandon or replay: under concurrent rendering the ref could
  // end up holding values from a render that was never committed.
  const latest = useRef({ features, colorBy, breaks, split });

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

    // A handle for the end-to-end regression test (e2e/map.spec.ts). The blank
    // map was invisible from outside: the DOM, the sources, the layers and the
    // paint expressions were all exactly right and only the worker was missing.
    // The one honest question to ask is what the map actually managed to
    // render, and only the instance can answer it.
    (window as unknown as { __catchmentMap?: MapLibreMap }).__catchmentMap = m;

    paint.current = (fit: boolean) => {
      const polygons = m.getSource('results') as maplibregl.GeoJSONSource | undefined;
      const dots = m.getSource('results-points') as maplibregl.GeoJSONSource | undefined;
      if (!polygons || !dots) return;

      const { features: fs, colorBy: cb, breaks: bk, split: sp } = latest.current;

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

      // The grouping, as an outline over the graded fill.
      m.setLayoutProperty('results-split', 'visibility', sp ? 'visible' : 'none');
      if (sp) {
        m.setFilter('results-split', splitFilter(sp.field, sp.threshold) as never);
      }

      // A comparison covers the whole county, so every polygon has a neighbour
      // and the dots mark nothing. The outline softens for the same reason:
      // 2,830 outlined shapes read as a mesh laid over the map.
      m.setLayoutProperty('results-dots', 'visibility', sp ? 'none' : 'visible');
      m.setPaintProperty('results-line', 'line-opacity', lineOpacity(Boolean(sp)) as never);

      const box = fit ? boundsOf(fs) : null;
      if (box) {
        // A camera flight is motion the reader did not ask for. Respect the
        // system setting and jump instead — the destination is identical.
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        m.fitBounds(box, { padding: 56, maxZoom: 12, duration: still ? 0 : 600 });
      }
    };

    const setHovered = (id: string | null) => {
      if (hovered.current === id) return;
      for (const source of RESULT_SOURCES) {
        if (hovered.current !== null) {
          m.setFeatureState({ source, id: hovered.current }, { hover: false });
        }
        if (id !== null) m.setFeatureState({ source, id }, { hover: true });
      }
      hovered.current = id;
    };

    const build = () => {
      if (m.getSource('results')) return;

      // Declared in `lib/map-layers`, in draw order. The county frame is first
      // in that array and therefore underneath, which is the whole reason the
      // order is asserted in a test rather than kept by hand here.
      for (const [id, spec] of Object.entries(SOURCES)) m.addSource(id, spec);
      for (const layer of LAYERS) m.addLayer(layer);

      for (const layer of INTERACTIVE) {
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

        // Tap or click to pick one. On a pointer device this pins what hover
        // was already showing; on a touch device it is the only way to see it
        // at all.
        m.on('click', layer, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          setHovered((f.id ?? f.properties?.['geoid'] ?? null) as string | null);
          onSelect(f.properties ?? null);
        });
      }

      // A tap on the map that hits no block group clears the selection — the
      // ordinary way out of a detail panel, and on a phone the panel covers
      // enough of the map to need one.
      m.on('click', (e) => {
        const layers = INTERACTIVE.filter((l) => m.getLayer(l));
        if (layers.length === 0) return;
        if (m.queryRenderedFeatures(e.point, { layers }).length === 0) {
          setHovered(null);
          onSelect(null);
        }
      });

      // The whole point: rebuilt layers are useless empty. Refill immediately,
      // without re-framing — a style swap should not yank the user's view.
      paint.current(false);
    };

    // Gating this on isStyleLoaded() was the bug that kept the map empty.
    // isStyleLoaded() means the style AND every source's metadata is resolved;
    // a vector basemap with a slow TileJSON can leave it false indefinitely
    // while rendering perfectly. Adding a source only needs the style document
    // parsed, which is what styledata signals. build() is idempotent, and if a
    // call still lands too early MapLibre throws and the next styledata
    // retries — so the layers arrive at the first moment they legally can.
    const tryBuild = () => {
      try {
        build();
      } catch {
        /* style not parsed yet; the next styledata event will retry */
      }
    };
    m.on('styledata', tryBuild);
    m.on('load', tryBuild);
    tryBuild();

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
      delete (window as unknown as { __catchmentMap?: MapLibreMap }).__catchmentMap;
    };
  }, [onHover, onSelect]);

  // New results: record them, then refill and frame them.
  //
  // Both halves belong in one effect. The ref has to be current before `paint`
  // reads it, and putting the write in a separate effect made that ordering a
  // property of the order the effects happen to be declared in — true today,
  // silently wrong after a reorder. Here the dependency is the write.
  useEffect(() => {
    latest.current = { features, colorBy, breaks, split };
    paint.current(true);
  }, [features, colorBy, breaks, split]);

  return <div ref={container} className="h-full w-full" aria-label="Map of analysis results" />;
}
