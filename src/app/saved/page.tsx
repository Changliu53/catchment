/**
 * The analyses this person kept.
 *
 * `listForUser` puts the owner in the WHERE clause, so this page cannot show
 * someone else's rows even if it wanted to.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { deleteAnalysis } from '@/app/actions';
import SubmitButton from '@/components/SubmitButton';
import Toast from '@/components/Toast';
import { FLASH_PARAM, flashFor } from '@/lib/flash';
import { listForUser, pathFor, questionFor } from '@/lib/saved';
import { viewer } from '@/lib/session';

export const metadata = { title: 'Saved analyses — Catchment' };

/**
 * Never prerendered.
 *
 * Without this the page is dynamic only as a side effect of reading the
 * session, and on a build that has no DATABASE_URL — which is every build of
 * the fixture configuration — `viewer()` answers null without touching
 * headers at all. Next then bakes "redirect to /" into a static page, and a
 * deployment whose database arrives at runtime serves that baked answer to
 * everyone. A per-person page should say so itself rather than depend on
 * whether one of its callees happened to be dynamic.
 */
export const dynamic = 'force-dynamic';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export default async function Saved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, query] = await Promise.all([viewer(), searchParams]);
  // Nothing here is meaningful signed out, and there is no public version of
  // "your saved analyses" to fall back to.
  if (!me) redirect('/');

  const rows = await listForUser(me.id);
  const flash = flashFor(query[FLASH_PARAM]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Saved analyses</h1>
        <Link href="/" className="text-sm text-slate-600 underline-offset-2 hover:underline">
          Back to the map
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm leading-relaxed text-slate-600">
          Nothing saved yet. Ask a question, then use Save beneath the answer — you get a link
          anyone can open, and the question is re-run against the current data each time.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.slug}
              className="flex items-start justify-between gap-4 rounded-md border border-slate-200 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={pathFor(row.slug)}
                    className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                  >
                    {row.title}
                  </Link>
                  {/* Same chip the answer panel uses, so "this one came from a
                      preset" means the same thing in both places. */}
                  {row.presetId ? (
                    <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                      Preset
                    </span>
                  ) : null}
                </div>
                {/* The question as it was asked. This line used to show the URL
                    parameters, which meant a question someone typed came back
                    at them percent-encoded — correct for an address bar,
                    unreadable in a list of your own work. */}
                <p className="mt-0.5 truncate text-xs text-slate-600">{questionFor(row)}</p>
              </div>
              {/* `relative`, and the confirmation inside it is absolutely
                  positioned. That is the whole fix for a real complaint:
                  opening the confirmation used to widen this cluster, and
                  because the cluster is anchored to the right edge, the date
                  slid 57 pixels left. Out of flow, it cannot.

                  An earlier attempt moved the confirmation to a full-width
                  row of its own. That also stopped the movement, and was
                  worse: the row grew a line taller and the confirmation
                  floated away from the control that opened it. */}
              <div className="relative flex shrink-0 items-baseline gap-3">
                <time
                  dateTime={row.createdAt.toISOString()}
                  className="text-xs tabular-nums text-slate-400"
                >
                  {when.format(row.createdAt)}
                </time>

                {/* Deleting used to require opening the analysis first, which
                    is the wrong way round: the list is where you tidy up. Two
                    steps because it cannot be undone, and a native <details>
                    rather than confirm() so it still works without
                    JavaScript.

                    The trigger's label swaps on [open]. Without that, the open
                    state showed "Delete" directly above a second button also
                    saying "Delete" — a destructive control apparently offered
                    twice, with no way back out. It is the trigger that becomes
                    the cancel, which is where a reader reaches. */}
                <details className="group">
                  {/* Both labels share one grid cell, so the trigger is as
                      wide as the wider of them and swapping them moves
                      nothing either. `invisible` rather than `hidden` is what
                      reserves the width, and visibility:hidden is kept out of
                      the accessibility tree, so only one is ever read. */}
                  <summary className="grid cursor-pointer list-none text-xs text-slate-400 underline-offset-2 hover:text-red-700 hover:underline">
                    <span className="col-start-1 row-start-1 group-open:invisible">Delete</span>
                    <span className="invisible col-start-1 row-start-1 group-open:visible">
                      Cancel
                    </span>
                  </summary>
                  <form
                    action={deleteAnalysis}
                    className="absolute top-full right-0 mt-1.5 flex items-center gap-2 whitespace-nowrap"
                  >
                    <input type="hidden" name="slug" value={row.slug} />
                    <span className="text-[11px] text-slate-500">Cannot be undone.</span>
                    <SubmitButton
                      pending="Deleting"
                      className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-medium text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </SubmitButton>
                  </form>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}

      {flash ? <Toast message={flash} dismissHref="/saved" /> : null}
    </main>
  );
}
