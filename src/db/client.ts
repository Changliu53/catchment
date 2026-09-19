/**
 * The Drizzle client, over whichever Postgres the environment actually has.
 *
 * Two drivers, chosen by the connection string rather than by an environment
 * flag, because the flag is the thing that gets forgotten:
 *
 *   Neon            neon-http. Each query is an HTTP request with no
 *                   connection state, which is what you want on serverless —
 *                   a TCP pool per invocation is the classic way to exhaust a
 *                   database from a platform that promises you never think
 *                   about servers.
 *   anything else   node-postgres. This is what makes the suite runnable: CI
 *                   and a laptop get an ordinary local Postgres, and the same
 *                   migrations and the same queries run against it.
 *
 * Note this is *not* the path the block-group data takes. That is 2,830 rows
 * read once per instance and held in memory (see `lib/db.ts`); this client
 * exists for the handful of rows that belong to a person — their session and
 * the analyses they saved.
 */

import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';

import * as schema from './schema';

/**
 * Whether this deployment has a database at all.
 *
 * One predicate, used by everything that has an anonymous fallback: accounts
 * are absent rather than broken, and a share link cannot exist where nothing
 * could have saved one. The alternative — each caller reading
 * `process.env.DATABASE_URL` for itself — is how one of them ends up throwing
 * a 500 on a path the others handle.
 */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function url(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      'DATABASE_URL is not set. Accounts and saved analyses need a Postgres; the ' +
        'analysis itself runs without one (CATCHMENT_DATA=fixture).',
    );
  }
  return value;
}

/**
 * One type, not a union of two.
 *
 * The two drivers have structurally different Drizzle types, and a union of
 * them erases the overloads on things like `.returning()` — every call site
 * would need a cast. The query surface this app uses is identical across both,
 * so the client is typed as one of them and the other is asserted into it
 * here, once, where the reason is written down.
 */
type Database = NodePgDatabase<typeof schema>;

function create(): Database {
  const connection = url();

  if (/\.neon\.tech(?::|\/|$)/.test(connection)) {
    return drizzleHttp(neon(connection), { schema }) as unknown as Database;
  }

  // One pool per process. Next keeps modules alive between requests, so
  // creating a pool per call would leak connections until the database
  // refused them.
  return drizzleNode(new Pool({ connectionString: connection }), { schema });
}

let client: Database | null = null;

export function db(): Database {
  client ??= create();
  return client;
}
