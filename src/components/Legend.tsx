'use client';

/**
 * The legend.
 *
 * Six shades of blue on a map mean nothing without this. It names the measure,
 * states the unit, and gives each class its real range — the ranges are
 * quantiles of what is on screen, so they change per question and cannot be
 * baked into a static image.
 *
 * It also reports how many block groups fall in each class. That turns the
 * legend into a one-glance distribution: a reader can see at once whether the
 * dark end is two outliers or a third of the result.
 */

import { classRanges, NO_DATA } from '@/lib/ramp';
import { formatValue, labelFor } from '@/lib/format';

interface Props {
  field: string;
  /** Values that exist. Rows with no value are counted in `missing` instead. */
  values: number[];
  breaks: number[];
  /** How many block groups on screen have no value for this field. */
  missing: number;
}

export default function Legend({ field, values, breaks, missing }: Props) {
  const clean = values.filter(Number.isFinite);

  // Nothing to explain only when there is nothing on the map. A result with
  // too few distinct values to classify still gets a legend if any of its
  // block groups are greyed out — unexplained grey is worse than no legend.
  if (clean.length === 0 && missing === 0) return null;

  const min = clean.length > 0 ? Math.min(...clean) : 0;
  const max = clean.length > 0 ? Math.max(...clean) : 0;
  // With no breaks, classRanges yields the single min–max band the map is
  // painting flat, which is exactly what the reader is looking at.
  const ranges = clean.length > 0 ? classRanges(breaks, min, max) : [];

  const countIn = (lo: number, hi: number, isLast: boolean) =>
    clean.filter((v) => v >= lo && (isLast ? v <= hi : v < hi)).length;

  return (
    <figure className="pointer-events-none absolute left-4 top-4 rounded-lg bg-white/95 p-3 shadow-lg ring-1 ring-slate-200">
      <figcaption className="mb-2 max-w-[15rem] text-xs font-medium leading-snug text-slate-900">
        {labelFor(field)}
      </figcaption>
      <ul className="flex flex-col gap-1">
        {ranges.map((r, i) => {
          const isLast = i === ranges.length - 1;
          const n = countIn(r.lo, r.hi, isLast);
          return (
            <li key={i} className="flex items-center gap-2 text-[11px] text-slate-700">
              <span
                aria-hidden
                className="h-3 w-5 shrink-0 rounded-sm ring-1 ring-slate-300"
                style={{ backgroundColor: r.color }}
              />
              <span className="tabular-nums">
                {formatValue(field, r.lo)}
                <span className="mx-1 text-slate-400">–</span>
                {formatValue(field, r.hi)}
              </span>
              <span className="ml-auto pl-2 tabular-nums text-slate-400">{n}</span>
            </li>
          );
        })}

        {/*
          Its own row, outside the ramp. These block groups are not at the low
          end of the distribution — they are absent from it, and the legend has
          to say so or the grey on the map is unexplained.
        */}
        {missing > 0 && (
          <li className="mt-1 flex items-center gap-2 border-t border-slate-200 pt-1.5 text-[11px] text-slate-700">
            <span
              aria-hidden
              className="h-3 w-5 shrink-0 rounded-sm ring-1 ring-slate-300"
              style={{ backgroundColor: NO_DATA }}
            />
            <span>No data</span>
            <span className="ml-auto pl-2 tabular-nums text-slate-400">{missing}</span>
          </li>
        )}
      </ul>
      <p className="mt-2 max-w-[15rem] text-[10px] leading-snug text-slate-500">
        Equal-count classes; the count of block groups is on the right.
        {missing > 0 && ' The Census suppresses estimates for small samples.'}
      </p>
    </figure>
  );
}
