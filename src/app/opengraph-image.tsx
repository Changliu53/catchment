/**
 * The card that appears when the link is pasted into Slack, LinkedIn or a
 * message. Without one, a shared link renders as a bare URL.
 *
 * Generated at build time by next/og rather than committed as a PNG, so it
 * cannot drift out of date with the title and it costs nothing to keep. The
 * county outline is the same geometry the map draws — derived from the block
 * groups themselves — so the card shows the actual study area rather than a
 * generic shape.
 */

import { ImageResponse } from 'next/og';

import COUNTY from '@/lib/harris-county.json';

export const alt = 'Catchment — flood exposure and service access in Harris County, Texas';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The outline as an SVG path, scaled to fit a box, with latitude flipped. */
function countyPath(width: number, height: number): string {
  const rings = (COUNTY.geometry as { coordinates: number[][][] }).coordinates;
  const points = rings.flat();

  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];

  // Harris County is about 90km across and 75 tall; at this latitude a degree
  // of longitude is roughly cos(29.8°) as long as a degree of latitude, so
  // scaling the axes independently would visibly stretch it. One scale, fitted
  // to whichever axis runs out first.
  const lonScale = Math.cos((29.8 * Math.PI) / 180);
  const spanX = (maxX - minX) * lonScale;
  const spanY = maxY - minY;
  const scale = Math.min(width / spanX, height / spanY);

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return rings
    .map((ring) => {
      const d = ring
        .map((p, i) => {
          const x = offsetX + (p[0]! - minX) * lonScale * scale;
          // SVG y grows downward; latitude grows upward.
          const y = offsetY + (maxY - p[1]!) * scale;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return `${d} Z`;
    })
    .join(' ');
}

export default function Image() {
  const path = countyPath(360, 360);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 56,
          padding: 72,
          background: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <svg width={360} height={360} viewBox="0 0 360 360">
          <path d={path} fill="#1d4ed8" fillOpacity={0.12} stroke="#1e3a8a" strokeWidth={3} />
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontSize: 72, fontWeight: 700, color: '#0f172a', letterSpacing: -2 }}>
            Catchment
          </div>
          <div style={{ fontSize: 34, color: '#334155', marginTop: 20, lineHeight: 1.3 }}>
            Flood exposure and service access across Harris County, Texas
          </div>
          <div style={{ fontSize: 26, color: '#64748b', marginTop: 28, lineHeight: 1.4 }}>
            Ask in plain English. A language model writes the analysis plan; a fixed program runs
            it over 2,830 census block groups.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
