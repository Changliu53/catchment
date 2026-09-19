/**
 * Accounts configured, database down.
 *
 * Signing in with a social provider is not one hop. The server records the
 * OAuth state in a row *before* it can hand the browser a URL to redirect to,
 * so a database that will not answer makes the button fail rather than merely
 * be useless — and the first version of it failed in the worst possible way:
 * the request 500'd, the result object nobody read carried the error, and the
 * button sat on "Opening GitHub…" until the reader gave up. Indistinguishable
 * from a slow network, so they press it again.
 *
 * That is what this project is for. The other two servers assert about pages;
 * this one exists to click a button and watch what it says. The server behind
 * it has every auth variable set and a DATABASE_URL pointing at a closed port —
 * the shape of a real provider incident, or of a deployment configured before
 * its migrations were run. See `playwright.config.ts`.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS, stubBasemap } from './helpers';

test('the analysis is untouched by the database being down', async ({ page }) => {
  // Nothing on this path reads Postgres: the rows are in memory, or sampled.
  await openPreset(page, PRESETS.grocery);

  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();
});

test('sign-in fails out loud instead of hanging', async ({ page }) => {
  await stubBasemap(page);
  await page.goto('/');

  const button = page.getByRole('button', { name: /sign in to save/i });
  // Accounts *are* configured here, so offering is correct. It simply cannot
  // get anywhere until the database is back.
  await expect(button).toBeVisible();

  await button.click();

  // Said so...
  const message = page.getByRole('status');
  await expect(message).toContainText(/sign-in/i, { timeout: 10_000 });

  // ...and let go, so a second attempt is possible once the database returns.
  await expect(button).toBeEnabled();
  await expect(button).toHaveText(/sign in to save/i);

  // And it does not leave the reader thinking the whole page is broken.
  await expect(message).toContainText(/still works/i);
});

test('a visitor is anonymous rather than an error', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
  // Signed out, because an unreadable session means signed out.
  const saved = await request.get('/saved', { maxRedirects: 0 });
  expect(saved.status()).toBe(307);
});
