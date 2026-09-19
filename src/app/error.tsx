'use client';

/**
 * The last resort.
 *
 * Every failure the analysis can *name* — an unsupported question, a rate
 * limit, a missing DATABASE_URL — is a normal render with a panel explaining
 * it. This boundary only catches what nothing anticipated, so it says so
 * plainly rather than pretending to diagnose, and offers the two things that
 * actually help: try again, or go back to a question that is known to work.
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  /** Next attaches a digest to server-side errors; the message itself is not sent. */
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which is not
    // sent to the browser. Without logging it here there is nothing to match
    // against the server logs.
    console.error('[catchment] unhandled', error.digest ?? '', error.message);
  }, [error]);

  return (
    <main className="grid h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-base font-semibold text-slate-900">Something broke on our side</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This one was not anticipated, so there is no useful explanation to give — the failures we
          do understand come back as an ordinary answer saying what went wrong.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-slate-400">reference {error.digest}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Start over
          </Link>
        </div>
      </div>
    </main>
  );
}
