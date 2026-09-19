/**
 * The answer as a table, rendered on the server.
 *
 * The project's own claim is that the UI was measured rather than eyeballed,
 * and the measurement it never made was this one: every per-block-group number
 * lived behind a hover or a tap on a WebGL canvas. Keyboard users and screen
 * reader users could read that 28 block groups matched and never find out
 * which, or what any of their values were. A map is a summary of data; without
 * the data it is a picture.
 *
 * So the same rows the map draws are also a table. Three things fall out of
 * one decision:
 *
 *   - the numbers are reachable by keyboard and announced by a screen reader,
 *     with real `<th scope>` headers rather than a grid of divs
 *   - the page keeps working with JavaScript switched off, where the map
 *     cannot render at all
 *   - a crawler indexes the actual findings rather than an empty canvas
 *
 * It is collapsed by default because it sits beneath an answer that already
 * summarises it, and because 200 rows above the fold would bury everything
 * else. `<details>` rather than a toggle with state: no JavaScript, and the
 * browser handles the keyboard interaction correctly without help.
 *
 * Columns are chosen by the plan, not fixed: whatever the analysis ranked or
 * compared by leads, because that is the column the question was about.
 */

import { formatValue, labelFor } from '@/lib/format';
import type { Feature } from '@/lib/answer';

/** Enough to be useful, few enough that the DOM stays small. */
const MAX_ROWS = 200;

/** Always shown: the identifier, and the two measures every question implies. */
const ALWAYS: string[] = ['pop', 'median_income', 'flood_pct'];

interface Props {
  features: Feature[];
  /** The field the map shades by, which is what the question was about. */
  colorBy: string | null;
  /** Set for a comparison, so the grouping field earns a column too. */
  splitOn?: string | null;
}

function columnsFor(colorBy: string | null, splitOn?: string | null): string[] {
  // Lead with what the question was about, then the standing context columns,
  // with no repeats.
  const ordered = [colorBy, splitOn, ...ALWAYS].filter((f): f is string => Boolean(f));
  return [...new Set(ordered)].slice(0, 5);
}

export default function ResultsTable({ features, colorBy, splitOn }: Props) {
  if (features.length === 0) return null;

  const columns = columnsFor(colorBy, splitOn);
  const rows = features.slice(0, MAX_ROWS);
  const hidden = features.length - rows.length;

  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
        Show the {features.length.toLocaleString('en-US')} matching block groups as a table
      </summary>

      <div className="max-h-80 overflow-auto border-t border-slate-200">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Block groups matching this analysis, with the measures the question used.
          </caption>
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Block group
              </th>
              {columns.map((field) => (
                <th key={field} scope="col" className="px-3 py-2 text-right font-medium">
                  {labelFor(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((feature) => {
              const geoid = String(feature.properties['geoid'] ?? '');
              return (
                <tr key={geoid} className="border-t border-slate-100">
                  {/* The GEOID is the row's identity, so it is a header for
                      the row rather than another cell — that is what lets a
                      screen reader say which block group a number belongs
                      to. */}
                  <th
                    scope="row"
                    className="px-3 py-1.5 font-mono text-[11px] font-normal text-slate-500"
                  >
                    {geoid}
                  </th>
                  {columns.map((field) => (
                    <td key={field} className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {formatValue(field, feature.properties[field] as number | null)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 ? (
        <p className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
          Showing the first {MAX_ROWS} of {features.length.toLocaleString('en-US')}. The map draws
          all of them.
        </p>
      ) : null}
    </details>
  );
}
