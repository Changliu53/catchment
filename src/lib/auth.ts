/**
 * Authentication — optional by construction.
 *
 * Accounts need a Postgres. The analysis does not: it reads 2,830 rows that
 * are held in memory, or a sampled copy of them. So this returns null when
 * there is no DATABASE_URL, and the app runs without accounts rather than
 * refusing to start. Someone who clones the repository gets the whole map and
 * every question; they just cannot keep one.
 *
 * Throwing here instead would have made a database a hard dependency of the
 * build, which is the sort of thing that quietly turns "clone and run" into
 * "clone, sign up for a database, then run".
 *
 * GitHub is the only provider. Email sign-in needs a transactional mail
 * service — a third-party dependency and a deliverability problem in exchange
 * for a button — and the people who will open this already have GitHub.
 *
 * On sessions: Better Auth keeps them in the database, which is what makes
 * revocation real. `cookieCache` then serves the common read from a signed
 * cookie so a signed-in request does not pay for a round trip every time. The
 * trade is stated rather than hidden — a session revoked on one device can
 * survive on another until the cached cookie expires, which is why the window
 * is five minutes rather than five hours. Anonymous requests touch the
 * database zero times either way.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db, hasDatabase } from '@/db/client';
import * as schema from '@/db/schema';

function build() {
  return betterAuth({
    database: drizzleAdapter(db(), { provider: 'pg', schema }),

    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID ?? '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      },
    },

    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    // No mail provider, so there is no way to verify an address or reset a
    // password, and an unverifiable account is worse than no account.
    emailAndPassword: { enabled: false },
  });
}

/** Taken from the real call: `ReturnType<typeof betterAuth>` is the generic
 * default and does not describe a configured instance. */
export type Auth = ReturnType<typeof build>;

function create(): Auth | null {
  if (!hasDatabase()) return null;
  return build();
}

let instance: Auth | null | undefined;

/** Null when this deployment has no database, and therefore no accounts. */
export function getAuth(): Auth | null {
  if (instance === undefined) instance = create();
  return instance;
}

/** Whether signing in is possible at all here. */
export function accountsEnabled(): boolean {
  return getAuth() !== null;
}
