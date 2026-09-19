import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest owns `src`. Playwright owns `e2e`. Without the exclusion below Vitest
 * would collect `e2e/*.spec.ts`, import `@playwright/test` outside a Playwright
 * runner and fail with an error about the wrong runner rather than about the
 * code — a confusing way to find out the two suites overlap.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws unless the bundler resolves its react-server
      // export condition, which Vitest does not. Aliasing it to nothing lets
      // server modules be unit-tested; the guard it provides is a build-time
      // one in Next, and is unaffected.
      'server-only': fileURLToPath(new URL('./src/lib/__tests__/server-only.stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
