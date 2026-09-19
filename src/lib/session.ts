/**
 * Who is asking, on the server.
 *
 * One place, because "read the session" is the step that gets skipped. It
 * returns null rather than throwing or redirecting: almost every page here is
 * meant to work for someone who is not signed in, and a helper that redirects
 * would make anonymous access the exception instead of the default.
 *
 * It also returns null when this deployment has no accounts at all, so nothing
 * downstream has to distinguish "signed out" from "no database".
 */

import 'server-only';

import { headers } from 'next/headers';

import { getAuth } from '@/lib/auth';

export interface Viewer {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export async function viewer(): Promise<Viewer | null> {
  const auth = getAuth();
  if (!auth) return null;

  // Better Auth reads the signed cookie first and only falls through to the
  // session table when that cache has expired, so a signed-in request usually
  // costs nothing and an anonymous one always costs nothing.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
}
