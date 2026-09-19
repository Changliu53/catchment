/**
 * The numbers, reachable without a pointer.
 *
 * Everything per-block-group used to live behind hover or tap on a WebGL
 * canvas, which meant a keyboard user or a screen reader user could learn that
 * 28 block groups matched and never learn which, or anything about them. That
 * is a bigger gap than it sounds in a project whose own README says the UI was
 * measured rather than eyeballed.
 *
 * These assert the properties that make the table worth having rather than its
 * appearance: that it is in the HTML before any script runs, that it survives
 * JavaScript being switched off entirely, that its headers are real table
 * headers, and that a missing value is not rendered as a number.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS } from './helpers';

test('the matching rows are in the first response, before any script runs', async ({ page }) => {
  const response = await page.goto(`/?preset=${PRESETS.grocery}`);
  const html = await response!.text();

  expect(html).toContain('matching block groups as a table');
  // Real GEOIDs, not a placeholder to be filled in on the client. Harris
  // County block groups all begin with the state and county FIPS code.
  expect(html).toMatch(/<th scope="row"[^>]*>\s*48201/);
  expect(html).toContain('<th scope="col"');
});

test('it works with JavaScript disabled, where the map cannot', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`/?preset=${PRESETS.grocery}`);

    // `<details>` is the browser's, not ours, which is the reason it was
    // chosen over a button with state: no script has to run for this to open.
    const summary = page.locator('summary', { hasText: 'matching block groups' });
    await expect(summary).toBeVisible();

    await summary.click();
    await expect(page.locator('table th[scope="row"]').first()).toHaveText(/^48201/);
  } finally {
    await context.close();
  }
});

test('the table is announced as a table, with headers', async ({ page }) => {
  await openPreset(page, PRESETS.grocery);
  await page.locator('summary', { hasText: 'matching block groups' }).click();

  const table = page.getByRole('table');
  await expect(table).toBeVisible();

  // A grid of divs looks identical and conveys none of this.
  await expect(table.getByRole('columnheader').first()).toHaveText('Block group');
  await expect(table.getByRole('rowheader').first()).toHaveText(/^48201/);
  await expect(table.getByRole('caption')).toContainText(/block groups matching/i);
});

test('it leads with the column the question was about', async ({ page }) => {
  // The grocery preset ranks by population, so population leads. A fixed
  // column order would bury the measure the reader asked about.
  await openPreset(page, PRESETS.grocery);
  await page.locator('summary', { hasText: 'matching block groups' }).click();

  const headers = await page.getByRole('columnheader').allTextContents();
  expect(headers[0]).toBe('Block group');
  expect(headers[1]).toBe('Population');
});

test('a suppressed value is a dash, not a zero', async ({ page }) => {
  // Census income suppression means unknown. Printed as 0 it would put those
  // block groups at the poor end of a table someone might sort.
  await openPreset(page, PRESETS.grocery);
  await page.locator('summary', { hasText: 'matching block groups' }).click();

  const cells = await page.getByRole('table').locator('td').allTextContents();
  expect(cells.some((c) => c.trim() === '—')).toBe(true);
  // And nothing renders as a bare "$0", which is what coercion would produce.
  expect(cells).not.toContain('$0');
});
