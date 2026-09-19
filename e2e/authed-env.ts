/**
 * The one configuration shared between the signed-in Playwright project and
 * the server it talks to.
 *
 * It lives in its own module because both `playwright.config.ts` and the spec
 * need the same secret: the config hands it to the server, and the spec uses
 * it to sign a session cookie. Two copies of a secret that must match is a
 * test that breaks for a reason unrelated to the code.
 */

/** Fixed, and fixed on purpose — a random one could not be shared. Never used
 * anywhere a real secret would be. */
export const E2E_AUTH_SECRET = 'e2e-only-fixed-secret-do-not-reuse';

export const E2E_USER = {
  id: 'e2e-owner',
  name: 'E2E Owner',
  email: 'e2e-owner@example.test',
  sessionId: 'e2e-session',
  sessionToken: 'e2e-session-token',
} as const;

/**
 * Where the signed-in project's server keeps accounts.
 *
 * In CI this is the `postgres:17` service container the test job already
 * starts and migrates, so these tests always run there. Locally it needs
 * `E2E_DATABASE_URL` pointing at any migrated Postgres; without it the project
 * is left out and Playwright says so rather than pretending to have run.
 *
 * Skipping locally is acceptable only because CI cannot: the whole point of
 * this suite is the flow nothing else covers, and a suite that can quietly
 * stop covering it is the failure mode this project keeps running into.
 */
export const E2E_DATABASE_URL: string | null =
  process.env.E2E_DATABASE_URL ??
  (process.env.CI ? 'postgresql://postgres:postgres@localhost:5432/postgres' : null);
