/**
 * Say which database you are actually talking to, and whether it has the
 * tables the app expects.
 *
 * This exists because a migration silently went nowhere. `drizzle-kit migrate`
 * reports "migrations applied successfully" without ever naming the host it
 * applied them to, so a DATABASE_URL that was empty, stale, or pointing at the
 * wrong environment produced a cheerful success message and a production
 * database that still had no tables. The failure was only visible days later,
 * as a sign-in button that hung: Better Auth writes a row recording the OAuth
 * state before it can redirect, and the table was not there.
 *
 * So `npm run db:migrate` now ends here. The host is printed every time —
 * never the password — and a missing table is a non-zero exit rather than
 * something to notice later.
 *
 *   npm run db:status      check and report
 *   npm run db:migrate     apply, then check and report
 */

import process from 'node:process';

/** Every table the application reads or writes. Ordered as the migration creates them. */
const EXPECTED = ['account', 'saved_analysis', 'session', 'user', 'verification'];

function target() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    console.error('DATABASE_URL is not set, so there is nothing to check.');
    console.error('Accounts need a Postgres; the analysis itself runs without one');
    console.error('(CATCHMENT_DATA=fixture).');
    process.exit(1);
  }

  try {
    // Parsed rather than printed: a connection string carries a password, and
    // this output belongs in terminals, CI logs and screenshots.
    const url = new URL(value);
    return { value, host: url.hostname, database: url.pathname.replace(/^\//, '') || '(default)' };
  } catch {
    console.error(`DATABASE_URL is not a valid connection string (${value.length} characters).`);
    process.exit(1);
  }
}

async function tablesIn(connection) {
  const sql = `
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any($1)
  `;

  // The same two-driver split the app makes, for the same reason: Neon over
  // HTTP, anything else over a socket.
  if (/\.neon\.tech(?::|\/|$)/.test(connection)) {
    const { neon } = await import('@neondatabase/serverless');
    const rows = await neon(connection).query(sql, [EXPECTED]);
    return rows.map((r) => r.table_name);
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: connection });
  await client.connect();
  try {
    const { rows } = await client.query(sql, [EXPECTED]);
    return rows.map((r) => r.table_name);
  } finally {
    await client.end();
  }
}

const { value, host, database } = target();
console.log(`database: ${database} on ${host}`);

let present;
try {
  present = await tablesIn(value);
} catch (error) {
  console.error(`could not reach it: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const missing = EXPECTED.filter((name) => !present.includes(name));

if (missing.length === 0) {
  console.log(`tables:   all ${EXPECTED.length} present (${EXPECTED.join(', ')})`);
  process.exit(0);
}

console.error(`tables:   MISSING ${missing.join(', ')}`);
console.error('');
console.error('Accounts will not work against this database. If you just ran a migration,');
console.error('it did not reach the host named above — check which DATABASE_URL is in this');
console.error('shell before assuming the migration itself failed.');
process.exit(1);
