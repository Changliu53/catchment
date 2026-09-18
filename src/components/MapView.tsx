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

const BASEMAP = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const HARRIS_CENTER: [number, number] = [-95.44, 29.82];

const RAMP = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];

export interface Feature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, number | string | boolean | null>;
}

interface Props {
  features: Feature[];
  colorBy: string | null;
  onHover: (props: Record<string, number | string | boolean | null> | null) => void;
}

/** Quantile breaks, so a skewed distribution still shows structure. */
function breaks(values: number[], n = RAMP.length - 1): number[] {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const v = clean[Math.floor((clean.length - 1) * (i / (n + 1)))];
    if (v !== undefined && (out.length === 0 || v > out[out.length - 1]!)) out.push(v);
  }
  return out;
}

export default function MapView({ features, colorBy, onHover }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

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

    m.on('load', () => {
      m.addSource('results', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'results-fill',
        type: 'fill',
        source: 'results',
        paint: { 'fill-color': RAMP[2]!, 'fill-opacity': 0.75 },
      });
      m.addLayer({
        id: 'results-line',
        type: 'line',
        source: 'results',
        paint: { 'line-color': '#1e293b', 'line-width': 0.4, 'line-opacity': 0.5 },
      });

      m.on('mousemove', 'results-fill', (e: MapLayerMouseEvent) => {
        m.getCanvas().style.cursor = 'pointer';
        onHover(e.features?.[0]?.properties ?? null);
      });
      m.on('mouseleave', 'results-fill', () => {
        m.getCanvas().style.cursor = '';
        onHover(null);
      });

      ready.current = true;
      m.getSource('results'); // touch so the first data effect finds it
    });

    map.current = m;
    return () => {
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

      if (colorBy && features.length > 0) {
        const values = features.map((f) => Number(f.properties[colorBy])).filter(Number.isFinite);
        const stops = breaks(values);
        if (stops.length > 0) {
          const expr: unknown[] = ['step', ['to-number', ['get', colorBy], 0], RAMP[0]!];
          stops.forEach((s, i) => expr.push(s, RAMP[Math.min(i + 1, RAMP.length - 1)]!));
          m.setPaintProperty('results-fill', 'fill-color', expr as never);
        }
      } else {
        m.setPaintProperty('results-fill', 'fill-color', RAMP[3]!);
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
    else m.once('load', apply);
  }, [features, colorBy]);

  return <div ref={container} className="h-full w-full" aria-label="Map of analysis results" />;
}
