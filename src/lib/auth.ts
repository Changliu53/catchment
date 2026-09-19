/**
 * Authentication — optional by construction.
 *
 * Accounts need a Postgres. The analysis does not: it reads 2,830 rows that
 * are held in memory, or a sampled copy of them. So this returns null when the
 * deployment is not set up for accounts, and the app runs without them rather
 * than refusing to start. Someone who clones the repository gets the whole map
 * and every question; they just cannot keep one.
 *
 * What counts as "set up for accounts" is deliberately all four variables, and
 * that was a correction. It used to be DATABASE_URL alone — which is wrong
 * here, because this app already uses DATABASE_URL for the block-group data.
 * Every deployment has one. So the day accounts shipped, they switched
 * themselves on in an environment whose auth tables did not exist yet, and the
 * first session read took down every page including the anonymous landing
 * page. "Has a database" was never the same question as "accounts are
 * configured here", and conflating them turned an optional feature into a
 * site-wide outage.
 *
 * Requiring the GitHub credentials too is not belt-and-braces: without them
 * nobody can sign in anyway, so offering the button would be a lie. Turning
 * accounts on is now something someone does on purpose.
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

import { db } from '@/db/client';
import * as schema from '@/db/schema';

/** Every variable sign-in actually needs, named so a missing one is obvious. */
const REQUIRED = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

/** The variables that are missing, in the order above. Empty means configured. */
export function missingAuthConfig(): string[] {
  return REQUIRED.filter((name) => !process.env[name]);
}

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

let instance: Auth | null = null;

/**
 * Null when this deployment is not set up for accounts.
 *
 * The environment is re-read on every call and only the built instance is
 * memoised. Caching the *answer* instead would freeze whatever the first
 * caller saw, which makes the predicate untestable and hides a variable added
 * after boot.
 */
export function getAuth(): Auth | null {
  if (missingAuthConfig().length > 0) return null;
  instance ??= build();
  return instance;
}

/** Whether signing in is possible at all here. */
export function accountsEnabled(): boolean {
  return getAuth() !== null;
}
