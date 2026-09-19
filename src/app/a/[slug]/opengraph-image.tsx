/**
 * The card for one saved analysis.
 *
 * A share link is pasted somewhere before it is clicked, so what a reader sees
 * first is this image, not the map. Showing the saved title and the question
 * behind it makes the link self-describing: "Flooded grocery deserts" in a
 * channel is worth opening, `catchment.app/a/k7m2p9qr4t` is not.
 *
 * It fails soft on purpose. A deployment without a database has no saved
 * analyses to look up, and a slug that no longer exists will still be
 * requested by every crawler that saw the old link — in both cases the
 * generic card is a better answer than a 500, which renders as nothing at all
 * in the product doing the unfurling.
 */

import { ImageResponse } from 'next/og';

import { countyPath } from '@/lib/county-path';
import { accountsEnabled } from '@/lib/auth';
import { PRESETS } from '@/lib/presets';
import { getBySlug } from '@/lib/saved';

export const alt = 'A saved analysis of Harris County, Texas';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Satori has no line clamp, so the trim happens before layout. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

async function load(slug: string): Promise<{ title: string; question: string | null } | null> {
  // Same guard as the page: no accounts here means no share link could exist,
  // and the saved-analysis tables may never have been migrated.
  if (!accountsEnabled()) return null;

  try {
    const row = await getBySlug(slug);
    if (!row) return null;

    // A saved row holds a preset id or free text, never both. Either way the
    // card should show the question a reader would recognise, so a preset is
    // resolved back to its wording rather than captioned generically.
    const question =
      row.question ?? PRESETS.find((p) => p.id === row.presetId)?.question ?? null;

    return { title: row.title, question };
  } catch {
    // The database being unreachable is a reason to show a plainer card, not
    // a reason for the link to have no card.
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const row = await load((await params).slug);
  const { d } = countyPath(260, 260);

  const title = row ? clip(row.title, 72) : 'Catchment';
  const subtitle = row?.question
    ? clip(row.question, 130)
    : 'Flood exposure and service access across Harris County, Texas';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 4,
                textTransform: 'uppercase',
                color: '#2563eb',
              }}
            >
              {row ? 'Saved analysis' : 'Catchment'}
            </div>
            <div
              style={{
                fontSize: 58,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: -1.5,
                marginTop: 18,
                lineHeight: 1.15,
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 30, color: '#475569', marginTop: 24, lineHeight: 1.35 }}>
              {subtitle}
            </div>
          </div>

          <svg width={260} height={260} viewBox="0 0 260 260">
            <path d={d} fill="#1d4ed8" fillOpacity={0.12} stroke="#1e3a8a" strokeWidth={2} />
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 24,
            color: '#64748b',
            borderTop: '2px solid #e2e8f0',
            paddingTop: 28,
          }}
        >
          <div style={{ display: 'flex' }}>Harris County, Texas · 2,830 block groups</div>
          {/* Stated on the card because it changes what the number means: the
              question is stored, not the answer, so the link re-runs. */}
          <div style={{ display: 'flex' }}>Re-run against current data</div>
        </div>
      </div>
    ),
    size,
  );
}
