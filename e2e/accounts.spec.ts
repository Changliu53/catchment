/**
 * What the app does where there is no database.
 *
 * Accounts are optional by construction: `DATABASE_URL` absent means sign-in
 * is not offered and nothing was ever saved, but the map and every question
 * still work. That is the configuration anyone who clones the repository gets,
 * so it is the configuration the suite runs in — `playwright.config.ts` blanks
 * `DATABASE_URL` for the server it starts.
 *
 * The failure mode being guarded is specific and was real: `/a/<slug>` is the
 * one route a stranger can reach without an account, and it read the database
 * unconditionally. On a deployment without one, a pasted link answered 500.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS, stubBasemap } from './helpers';

test('a share link for an analysis that cannot exist is missing, not broken', async ({ page }) => {
  const response = await page.goto('/a/k7m2p9qr4t');

  // 404 is the honest answer: nothing was ever saved here. 500 would be the
  // answer "something is wrong with this site", which is a different claim.
  expect(response?.status()).toBe(404);
});

test('the social card for a share link still renders', async ({ request }) => {
  // A crawler asks for this whether or not the slug resolves, and an image
  // route that throws unfurls as no card at all.
  const response = await request.get('/a/k7m2p9qr4t/opengraph-image');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
  expect((await response.body()).byteLength).toBeGreaterThan(5_000);
});

test('the site-wide social card renders', async ({ request }) => {
  const response = await request.get('/opengraph-image');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
});

test('sign-in is not offered, and nothing implies an account would help', async ({ page }) => {
  await openPreset(page, PRESETS.grocery);

  // Not "disabled" — absent. Offering a button that cannot work is worse than
  // not mentioning accounts on a deployment that has none.
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^save$/i })).toHaveCount(0);

  // And the answer itself is unaffected.
  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();
});

test('the saved list sends an anonymous visitor back to the map', async ({ page, request }) => {
  // A real 307, not a client-side hop. Both look identical in a browser, which
  // is why the redirect is asserted at the protocol level: a page whose
  // response was already committed can only redirect with JavaScript.
  const direct = await request.get('/saved', { maxRedirects: 0 });
  expect(direct.status()).toBe(307);
  expect(direct.headers()['location']).toMatch(/\/$/);

  await stubBasemap(page);
  await page.goto('/saved');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /catchment/i })).toBeVisible();
});
