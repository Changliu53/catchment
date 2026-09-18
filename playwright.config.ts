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
 * Nothing here needs DATABASE_URL or an API key: the one endpoint the page
 * calls is intercepted in the test.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The map needs a viewport with room in it; the layout puts the
        // controls in a 26rem column and the map in what is left.
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // Headless Chrome falls back to SwiftShader for WebGL. Without this
          // the map has no GL context at all and every test fails for a reason
          // that has nothing to do with the code.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],

  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
