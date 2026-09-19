'use client';

/**
 * The only interactive island on the page.
 *
 * Everything else — the answer, the statistics, the legend, the preset list —
 * renders on the server as HTML. What is left here is the part that genuinely
 * needs a browser: a WebGL map, and the hover/selection state that follows a
 * pointer or a tap.
 *
 * The classification arrives as props. It was computed once on the server, so
 * the legend beside this map and the colours inside it cannot disagree.
 */

import dynamic from 'next/dynamic';
import { Fragment, useCallback, useState } from 'react';

import { formatValue, labelFor } from '@/lib/format';
import type { Feature } from '@/components/MapView';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-100" />,
});

type Row = Record<string, number | string | boolean | null>;

const DETAIL_FIELDS = [
  'pop',
  'median_income',
  'pop_density',
  'flood_pct',
  'flood_pct_500',
  'dist_grocery_m',
  'dist_park_m',
] as const;

interface Props {
  features: Feature[];
  colorBy: string | null;
  breaks: number[];
  split: { field: string; threshold: number } | null;
}

export default function ResultMap({ features, colorBy, breaks, split }: Props) {
  const [hover, setHover] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  const onHover = useCallback((p: Row | null) => setHover(p), []);
  const onSelect = useCallback((p: Row | null) => setSelected(p), []);

  // A pick wins over a passing hover: on touch there is no hover at all, and
  // on a pointer device a reader who clicked a block group should not lose it
  // by moving the mouse.
  const detail = selected ?? hover;

  return (
    <>
      <MapView
        features={features}
        colorBy={colorBy}
        breaks={breaks}
        split={split}
        onHover={onHover}
        onSelect={onSelect}
      />

      {detail && (
        /*
          pointer-events only when it is a pick: a panel that follows the
          cursor must not swallow the hover it is describing, but a panel a
          touch user opened has to be dismissible.

          bottom-9 on small screens clears MapLibre's attribution bar, which
          spans the full width there and was covering the last row's value.
        */
        <div
          className={`absolute bottom-9 left-3 right-3 max-h-[70%] overflow-y-auto rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-slate-200 sm:right-auto sm:max-w-[17rem] lg:bottom-4 ${
            selected ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-[11px] text-slate-500">
              Block group {String(detail.geoid)}
            </p>
            {selected && (
              <button
                onClick={() => setSelected(null)}
                aria-label="Close block group details"
                className="-mr-1 -mt-1 shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
            )}
          </div>

          <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-slate-700">
            {DETAIL_FIELDS.map((f) => (
              <Fragment key={f}>
                <dt className={f === colorBy ? 'font-medium text-slate-900' : ''}>{labelFor(f)}</dt>
                <dd
                  className={`text-right tabular-nums ${f === colorBy ? 'font-medium text-slate-900' : ''}`}
                >
                  {formatValue(f, detail[f] === null ? null : Number(detail[f]))}
                  {f === 'median_income' && detail.income_topcoded ? '+' : ''}
                </dd>
              </Fragment>
            ))}
          </dl>

          {detail.income_topcoded ? (
            <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
              + income is top-coded by the Census at $250,001.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
