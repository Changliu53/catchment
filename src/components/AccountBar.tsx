'use client';

/**
 * Sign in, sign out, and the way to your saved analyses.
 *
 * Deliberately small and deliberately last: the entire app works without an
 * account, so this is an offer rather than a gate. Someone who never presses
 * it loses nothing except the ability to keep a question.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

interface Props {
  /** Read on the server and passed down; the client never decides who it is. */
  name: string | null;
}

export default function AccountBar({ name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!name) {
    return (
      <button
        onClick={async () => {
          setBusy(true);
          await authClient.signIn.social({ provider: 'github', callbackURL: '/' });
        }}
        disabled={busy}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Opening GitHub…' : 'Sign in to save'}
      </button>
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
          await authClient.signOut();
          // The page is server-rendered, so the new signed-out state comes from
          // the server rather than from clearing something in the client.
          router.refresh();
          setBusy(false);
        }}
        disabled={busy}
        className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:opacity-50"
      >
        Sign out {name.split(' ')[0]}
      </button>
    </div>
  );
}
