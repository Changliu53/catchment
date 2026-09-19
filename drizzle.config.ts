import type { Config } from 'drizzle-kit';

/**
 * Migrations are files in the repository, not something a CLI improvises
 * against whatever the database currently looks like. `drizzle-kit generate`
 * writes SQL into drizzle/; `drizzle-kit migrate` applies what is missing, in
 * order, and records it. CI runs the same files against a throwaway Postgres,
 * so a migration that only works on a machine where the table already exists
 * fails there rather than in production.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config;
