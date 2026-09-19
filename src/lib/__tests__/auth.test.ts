/**
 * When this deployment thinks it has accounts.
 *
 * This predicate is load-bearing in a way that is easy to underestimate: it
 * decides whether the app queries tables that may not exist. The first version
 * tested `DATABASE_URL` alone, which is wrong *in this app specifically* —
 * the block-group data lives in Postgres too, so every deployment has a
 * connection string. Accounts therefore switched themselves on the moment the
 * code shipped, ahead of the migration, and the first session read returned a
 * 500 from every page including the anonymous landing page.
 *
 * So the truth table is worth writing down: each variable on its own is not
 * enough, and the missing ones are named rather than counted, because
 * "accounts are off and I do not know why" is the state this is meant to
 * prevent.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { missingAuthConfig } from '@/lib/auth';

const VARS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

const saved = new Map(VARS.map((v) => [v, process.env[v]]));

function setAll() {
  process.env['DATABASE_URL'] = 'postgresql://user@localhost:5432/db';
  process.env['BETTER_AUTH_SECRET'] = 'x'.repeat(32);
  process.env['GITHUB_CLIENT_ID'] = 'client-id';
  process.env['GITHUB_CLIENT_SECRET'] = 'client-secret';
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('missingAuthConfig', () => {
  it('is empty only when everything sign-in needs is present', () => {
    setAll();
    expect(missingAuthConfig()).toEqual([]);
  });

  it('names each variable that is absent', () => {
    for (const absent of VARS) {
      setAll();
      delete process.env[absent];
      expect(missingAuthConfig()).toEqual([absent]);
    }
  });

  it('a connection string alone does not turn accounts on', () => {
    // The regression, stated as plainly as it can be: this app has a
    // DATABASE_URL everywhere, because the block-group data is in Postgres.
    for (const name of VARS) delete process.env[name];
    process.env['DATABASE_URL'] = 'postgresql://user@localhost:5432/db';

    expect(missingAuthConfig()).toEqual([
      'BETTER_AUTH_SECRET',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
    ]);
  });

  it('reads the environment each time rather than caching the first answer', () => {
    for (const name of VARS) delete process.env[name];
    expect(missingAuthConfig()).toHaveLength(4);

    setAll();
    expect(missingAuthConfig()).toEqual([]);
  });
});
