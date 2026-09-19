'use client';

/**
 * Sign in, sign out, and the way to your saved analyses.
 *
 * Deliberately small and deliberately last: the entire app works without an
 * account, so this is an offer rather than a gate. Someone who never presses
 * it loses nothing except the ability to keep a question.
 *
 * Both buttons report failure, which they did not at first, and the gap was
 * worth more than the two lines it cost. Signing in with a social provider is
 * not one hop: the server writes a row recording the OAuth state and only then
 * hands back a URL to redirect to. When that write failed — the auth tables
 * had not been migrated yet — the request 500'd, `await` returned an error
 * object nobody looked at, and the button sat on "Opening GitHub…" forever. No
 * redirect, no message, nothing in the tab. A reader has no way to tell that
 * apart from a slow network, so they wait, then press it again.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

interface Props {
  /** Read on the server and passed down; the client never decides who it is. */
  name: string | null;
}

interface ClientResult {
  error?: { message?: string; statusText?: string; status?: number } | null;
}

const UNAFFECTED = 'Everything else here still works.';

/**
 * Better Auth answers with `{ error }` rather than throwing; the network can
 * still throw. Both mean the same thing here.
 *
 * The presence of `error` is the test, not the presence of a message. The
 * failure that prompted this had neither: the server answered 500 with an
 * empty body, so `message` was undefined and a check written around it
 * concluded that nothing had gone wrong — which is how the button came to hang
 * silently in the first place.
 *
 * `statusText` is deliberately not used. "Internal Server Error" is the
 * server's own words and tells a reader nothing they can act on; Better Auth's
 * `message`, when there is one, actually describes what went wrong.
 */
function failureOf(result: ClientResult | undefined): string | null {
  const error = result?.error;
  if (!error) return null;

  return error.message
    ? `Sign-in failed: ${error.message}. ${UNAFFECTED}`
    : `Sign-in isn't working right now. ${UNAFFECTED}`;
}

export default function AccountBar({ name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!name) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={async () => {
            setBusy(true);
            setProblem(null);
            try {
              const result = await authClient.signIn.social({
                provider: 'github',
                callbackURL: '/',
              });
              const failed = failureOf(result);
              if (failed) {
                setProblem(failed);
                setBusy(false);
              }
              // On success the browser is leaving this page, so `busy` stays
              // set on purpose: releasing it would flash the original label
              // during the redirect.
            } catch {
              setProblem(`Sign-in isn't working right now. ${UNAFFECTED}`);
              setBusy(false);
            }
          }}
          disabled={busy}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? 'Opening GitHub…' : 'Sign in to save'}
        </button>

        {problem ? (
          <p role="status" className="max-w-[15rem] text-right text-[11px] leading-snug text-red-700">
            {problem}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      <Link href="/saved" className="font-medium text-slate-700 underline-offset-2 hover:underline">
        Saved
      </Link>
      <span aria-hidden className="text-slate-300">
        ·
      </span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await authClient.signOut();
          } finally {
            // The page is server-rendered, so the new signed-out state comes
            // from the server rather than from clearing something in the
            // client. Refreshing even after a failure is deliberate: the
            // cookie may well be gone regardless, and the server is the only
            // thing that knows.
            router.refresh();
            setBusy(false);
          }
        }}
        disabled={busy}
        className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-50"
      >
        Sign out {name.split(' ')[0]}
      </button>
    </div>
  );
}
