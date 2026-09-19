/**
 * The analyses this person kept.
 *
 * `listForUser` puts the owner in the WHERE clause, so this page cannot show
 * someone else's rows even if it wanted to.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

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

export default async function Saved() {
  const me = await viewer();
  // Nothing here is meaningful signed out, and there is no public version of
  // "your saved analyses" to fall back to.
  if (!me) redirect('/');

  const rows = await listForUser(me.id);

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
              className="flex items-baseline justify-between gap-4 rounded-md border border-slate-200 p-3"
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
              <time
                dateTime={row.createdAt.toISOString()}
                className="shrink-0 text-xs tabular-nums text-slate-400"
              >
                {when.format(row.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
