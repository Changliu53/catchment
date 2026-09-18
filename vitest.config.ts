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
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
