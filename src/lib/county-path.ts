/**
 * Harris County as an SVG path.
 *
 * Shared by both social cards — the site-wide one and the per-analysis one —
 * so the outline on a shared link is the same geometry the map draws, derived
 * from the union of the block groups themselves rather than a traced shape
 * that would drift the next time the pipeline runs.
 *
 * It is plain string building with no React and no `next/og` import, which is
 * also what makes it testable: the projection is arithmetic, and arithmetic
 * that only runs inside an image renderer is arithmetic nobody checks.
 */

import COUNTY from '@/lib/harris-county.json';

/** Roughly the middle of the county; see the note on `lonScale` below. */
const CENTRE_LATITUDE = 29.8;

export interface Projected {
  /** An SVG `d` attribute covering every ring. */
  d: string;
  /** The drawn extent, which is smaller than the box on one axis. */
  width: number;
  height: number;
}

export function countyPath(boxWidth: number, boxHeight: number): Projected {
  const rings = (COUNTY.geometry as { coordinates: number[][][] }).coordinates;
  const points = rings.flat();

  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];

  // Harris County is about 90 km across and 75 tall; at this latitude a degree
  // of longitude is roughly cos(29.8°) as long as a degree of latitude, so
  // scaling the axes independently would visibly stretch it. One scale, fitted
  // to whichever axis runs out first.
  const lonScale = Math.cos((CENTRE_LATITUDE * Math.PI) / 180);
  const spanX = (maxX - minX) * lonScale;
  const spanY = maxY - minY;
  const scale = Math.min(boxWidth / spanX, boxHeight / spanY);

  const width = spanX * scale;
  const height = spanY * scale;
  const offsetX = (boxWidth - width) / 2;
  const offsetY = (boxHeight - height) / 2;

  const d = rings
    .map((ring) => {
      const segments = ring
        .map((p, i) => {
          const x = offsetX + (p[0]! - minX) * lonScale * scale;
          // SVG y grows downward; latitude grows upward.
          const y = offsetY + (maxY - p[1]!) * scale;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return `${segments} Z`;
    })
    .join(' ');

  return { d, width, height };
}
