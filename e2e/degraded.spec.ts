/**
 * A deployment that has a database but has not been set up for accounts.
 *
 * This is the incident, turned into a test. Accounts were made optional on the
 * predicate "is DATABASE_URL set" — which is wrong in this app, because the
 * block-group data lives in Postgres too, so every deployment has one.
 * Accounts therefore switched themselves on in an environment that had none of
 * the rest of the configuration, and Better Auth refused to start without a
 * secret: `BetterAuthError: You are using the default secret`, thrown out of
 * the session read, which happens on every page. Every route returned 500,
 * including the landing page, which needs no account at all.
 *
 * Worth recording how that was found, because the first guess was wrong. The
 * visible error in the log was `relation "saved_analysis" does not exist`,
 * which looks like an unmigrated database and is a perfectly good story — but
 * it came from a request to a share link made moments earlier in the same
 * batch. Requesting only the landing page, and reading the log for that
 * request alone, named the secret instead. Two plausible causes, one true one,
 * and they need different fixes.
 *
 * The server this project talks to reproduces that environment exactly:
 * DATABASE_URL present and pointing at a closed port, nothing else set. See
 * `playwright.config.ts`.
 *
 * Two faults would each bring a failure here, which is the point of writing it
 * this way rather than only checking a status code:
 *
 *   - the predicate going back to DATABASE_URL alone → sign-in is offered on a
 *     deployment where it cannot possibly work, and the pages 500 again
 *   - the share route querying without checking first → 500 instead of 404
 *
 * Verified by reverting each in turn and watching this file fail.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS, stubBasemap } from './helpers';

test('the analysis is unaffected by accounts not being configured', async ({ page }) => {
  await openPreset(page, PRESETS.grocery);

  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catchment' })).toBeVisible();
});

test('sign-in is not offered where it could not work', async ({ page }) => {
  await stubBasemap(page);
  await page.goto('/');

  // A connection string is not consent to advertise accounts. Without the
  // GitHub credentials this button leads nowhere, so it must not be drawn.
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
});

test('a share link is missing rather than a server error', async ({ request }) => {
  // 404 because nothing here could ever have created one; 500 would mean the
  // route tried to read a table that was never migrated.
  expect((await request.get('/a/k7m2p9qr4t')).status()).toBe(404);

  const card = await request.get('/a/k7m2p9qr4t/opengraph-image');
  expect(card.status()).toBe(200);
  expect(card.headers()['content-type']).toContain('image/png');
});

test('every public route answers, and none of them answers 500', async ({ request }) => {
  const expected: Array<[string, number]> = [
    ['/', 200],
    ['/?preset=flooded-grocery-deserts', 200],
    ['/?preset=income-flood-gap', 200],
    ['/saved', 307],
    ['/a/k7m2p9qr4t', 404],
  ];

  for (const [path, status] of expected) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} should answer ${status}`).toBe(status);
  }
});
