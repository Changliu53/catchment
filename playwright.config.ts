import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite runs against a production build, on purpose.
 *
 * The regression it guards was a bundling fault: the MapLibre worker chunk was
 * not emitted into the built output. `next dev` served that worker without
 * complaint, so a dev-server test would have watched the map render perfectly
 * and reported nothing. `next build && next start` is the only configuration
 * in which the original failure reproduces.
 *
 * Three servers, because "does it work", "does it survive a half-configured
 * environment" and "does it say so when the database is down" are different
 * questions, and a process can only be asked one of them. All three run the
 * same build; they differ only in environment.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Accounts not configured: a connection string, nothing else. */
const DEGRADED_PORT = PORT + 1;
/** Accounts configured, database refusing connections. */
const OUTAGE_PORT = PORT + 2;
/** Nothing listens here. Anything that tries to connect fails immediately. */
const DEAD_DATABASE = 'postgresql://postgres:postgres@127.0.0.1:59999/not_migrated';

const chrome = {
  ...devices['Desktop Chrome'],
  // The map needs a viewport with room in it; the layout puts the controls in
  // a 26rem column and the map in what is left.
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    // Headless Chrome falls back to SwiftShader for WebGL. Without this the
    // map has no GL context at all and every test fails for a reason that has
    // nothing to do with the code.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  },
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: { trace: 'on-first-retry' },

  projects: [
    {
      name: 'chromium',
      testIgnore: /(degraded|outage)\.spec\.ts/,
      use: { ...chrome, baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'degraded',
      testMatch: /degraded\.spec\.ts/,
      use: { ...chrome, baseURL: `http://127.0.0.1:${DEGRADED_PORT}` },
    },
    {
      name: 'outage',
      testMatch: /outage\.spec\.ts/,
      use: { ...chrome, baseURL: `http://127.0.0.1:${OUTAGE_PORT}` },
    },
  ],

  webServer: [
    {
      command: `npm run build && npx next start --port ${PORT}`,
      // The page renders on the server now, so the suite cannot intercept an
      // API call the browser no longer makes. It runs against the real server
      // backed by a sampled copy of the real table instead — which also means
      // anyone who clones the repo can run both the app and its tests without
      // Neon credentials.
      // DATABASE_URL is blanked rather than merely left unset: a developer with
      // one exported in their shell would otherwise be testing a different
      // application from the one CI tests. This is the "clone it and run it"
      // configuration — the whole analysis, no accounts — and `accounts.spec.ts`
      // asserts it degrades rather than breaks.
      env: { CATCHMENT_DATA: 'fixture', DATABASE_URL: '' },
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The shape of a real deployment that has not been set up for accounts
      // yet: a connection string is present, because this app keeps the
      // block-group data in Postgres, but no BETTER_AUTH_SECRET, no GitHub
      // credentials and no migrated tables. The URL points at a closed port,
      // so any code that decides to connect fails immediately and visibly.
      //
      // This is not hypothetical. It is exactly the state production was in
      // the day accounts shipped, and every page returned 500 — including the
      // landing page, which needs no account at all. `degraded.spec.ts` is the
      // standing proof that it cannot happen again.
      command: `npx next start --port ${DEGRADED_PORT}`,
      env: { CATCHMENT_DATA: 'fixture', DATABASE_URL: DEAD_DATABASE },
      url: `http://127.0.0.1:${DEGRADED_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Accounts fully configured, database refusing connections. Unlike the
      // two above, this one exists to exercise a click: signing in writes a
      // row recording the OAuth state *before* it can hand back a URL to
      // redirect to, so a database that is down makes the button fail rather
      // than merely be useless. It has to say so. The credentials are
      // deliberately nonsense — nothing is ever authenticated here, only
      // attempted.
      command: `npx next start --port ${OUTAGE_PORT}`,
      env: {
        CATCHMENT_DATA: 'fixture',
        DATABASE_URL: DEAD_DATABASE,
        BETTER_AUTH_SECRET: 'e2e-not-a-real-secret-0000000000',
        GITHUB_CLIENT_ID: 'e2e-not-a-real-client-id',
        GITHUB_CLIENT_SECRET: 'e2e-not-a-real-client-secret',
        BETTER_AUTH_URL: `http://127.0.0.1:${OUTAGE_PORT}`,
      },
      url: `http://127.0.0.1:${OUTAGE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
