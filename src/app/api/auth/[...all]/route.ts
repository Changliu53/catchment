/**
 * Better Auth's own endpoints: the GitHub redirect, the callback, sign-out,
 * and the session read.
 *
 * When the deployment has no database it has no accounts either, so these
 * answer 503 rather than 500 — the distinction between "broken" and "not
 * available here" is the whole point of the message.
 */

import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';

export const runtime = 'nodejs';

const auth = getAuth();

const unavailable = () =>
  Response.json(
    { error: 'accounts are not enabled on this deployment (no DATABASE_URL)' },
    { status: 503 },
  );

export const GET = auth ? toNextJsHandler(auth).GET : unavailable;
export const POST = auth ? toNextJsHandler(auth).POST : unavailable;
