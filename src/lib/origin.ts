import 'server-only';

import { headers } from 'next/headers';

/**
 * The origin this request arrived on.
 *
 * Needed because a share link has to be shown as something a person can copy
 * and paste — a path is not that — and the panel showing it is rendered on the
 * server, where there is no `window.location`.
 *
 * Taken from the request rather than from `VERCEL_URL`, because those differ
 * in the case that matters: on a custom domain, or a preview deployment, or
 * localhost, the environment variable names a host the reader is not on. The
 * link offered has to be the one they are actually looking at, or it is a link
 * to somewhere else.
 *
 * `x-forwarded-*` is set by Vercel's proxy and by every sensible one; the
 * fallback is `host` plus a protocol guessed from whether the host is local.
 * These headers are attacker-controlled in general, which is fine here and
 * would not be elsewhere: the value is printed into a link the reader may copy
 * and is never used to decide anything. Authentication does not read this —
 * `lib/auth.ts` has its own allow-list of trusted origins, for exactly that
 * reason.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  if (!host) return '';

  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const protocol = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https');

  return `${protocol}://${host}`;
}
