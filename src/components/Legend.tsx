'use client';

/**
 * The legend.
 *
 * Six shades of blue on a map mean nothing without this. It names the measure,
 * states the unit, and gives each class its real range — the ranges are
 * quantiles of what is on screen, so they change per question and cannot be
 * baked into a static image.
 *
 * Two layouts, because one does not fit both.
 *
 * On a wide screen there is room for the full table, including how many block
 * groups fall in each class. That turns the legend into a one-glance
 * distribution: a reader can see at once whether the dark end is two outliers
 * or a third of the result.
 *
 * On a phone the same table measured 264x203 over a 390x464 map — thirty
 * percent of the map, permanently, for a table nobody reads on a phone. The
 * small-screen layout is the standard compact choropleth key instead: one
 * strip of swatches with the range written under its ends. It costs about
 * forty pixels of height and says the thing that actually matters, which is
 * which end is more.
 *
 * Which one renders is decided by CSS, not by JavaScript. Measuring the
 * viewport during render would disagree with the server-rendered HTML and
 * produce a hydration mismatch.
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

  const label = labelFor(field);

  return (
    <figure
      aria-label={label}
      className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/95 p-2.5 shadow-lg ring-1 ring-slate-200 lg:left-4 lg:top-4 lg:p-3"
    >
      <figcaption className="mb-1.5 max-w-[13rem] text-[11px] font-medium leading-snug text-slate-900 lg:mb-2 lg:max-w-[15rem] lg:text-xs">
        {label}
      </figcaption>

      {/* ---- phones and tablets: one strip ---- */}
      <div className="lg:hidden">
        {ranges.length > 0 && (
          <>
            <div className="flex" role="presentation">
              {ranges.map((r, i) => (
                <span
                  key={i}
                  className="h-3 w-6 first:rounded-l-sm last:rounded-r-sm"
                  style={{ backgroundColor: r.color }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-600">
              <span>{formatValue(field, min)}</span>
              <span>{formatValue(field, max)}</span>
            </div>
          </>
        )}
        {missing > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-600">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-slate-300"
              style={{ backgroundColor: NO_DATA }}
            />
            <span>No data</span>
            <span className="tabular-nums text-slate-400">{missing}</span>
          </div>
        )}
      </div>

      {/* ---- wide screens: the full table ---- */}
      <ul className="hidden flex-col gap-1 lg:flex">
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

      <p className="mt-2 hidden max-w-[15rem] text-[10px] leading-snug text-slate-500 lg:block">
        Equal-count classes; the count of block groups is on the right.
        {missing > 0 && ' The Census suppresses estimates for small samples.'}
      </p>
    </figure>
  );
}
