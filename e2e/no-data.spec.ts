/**
 * Suppressed values must not be drawn as low values.
 *
 * The Census withholds a median income estimate wherever the sample is too
 * small — 273 of Harris County's 2,830 block groups. The map used to shade by
 * `['to-number', ['get', field], 0]`, which turned every one of those into a
 * zero: painted in the lightest blue, and therefore shown as the poorest
 * neighbourhoods in the county. The page computed its class breaks the same
 * way, so the 273 zeros also pulled every quantile boundary downward, and the
 * error reached rows that had perfectly good data.
 *
 * It is the kind of defect that never throws and never looks wrong. These
 * tests hold the three places it has to be handled: the colour, the
 * classification, and the legend that explains both.
 */

import { expect, test, type Page } from '@playwright/test';

import { QUERY_FIXTURE_SUPPRESSED, STUB_STYLE } from './fixture';

const NO_DATA = '#cbd5e1';

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ json: STUB_STYLE }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/query', (r) => r.fulfill({ json: QUERY_FIXTURE_SUPPRESSED }));
  await page.goto('/');
  await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();
  await expect(page.getByText('Income where flooding is worst')).toBeVisible();
}

test('a block group with no income is shaded as no data, not as poor', async ({ page }) => {
  await open(page);

  const paint = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    return m.getPaintProperty('results-fill', 'fill-color');
  });

  // MapLibre keeps the expression we gave it, so this reads the real thing off
  // the live map rather than re-deriving it in the test.
  expect(Array.isArray(paint)).toBe(true);
  const expr = paint as unknown[];
  expect(expr[0]).toBe('case');
  expect(expr[1]).toEqual(['==', ['get', 'median_income'], null]);
  expect(String(expr[2]).toLowerCase()).toBe(NO_DATA);
});

test('the legend accounts for the block groups it could not shade', async ({ page }) => {
  await open(page);

  const legend = page.getByRole('figure', { name: 'Median household income' });
  await expect(legend).toBeVisible();

  const noData = legend.getByRole('listitem').filter({ hasText: 'No data' });
  await expect(noData).toHaveCount(1);
  // Exactly the rows the fixture suppressed.
  const suppressed = QUERY_FIXTURE_SUPPRESSED.features.filter(
    (f) => f.properties.median_income === null,
  ).length;
  await expect(noData).toContainText(String(suppressed));

  // Grey on a map with no entry explaining it is worse than no grey at all.
  await expect(legend).toContainText(/suppresses estimates/i);
});

test('suppressed rows stay out of the class breaks', async ({ page }) => {
  await open(page);

  const legend = page.getByRole('figure', { name: 'Median household income' });
  const rows = await legend.getByRole('listitem').allInnerTexts();
  const classes = rows.filter((r) => !r.includes('No data'));

  // The lowest income that actually exists in the fixture is $26,400. If the
  // suppressed row had been counted as 0, a class would start at $0 and the
  // ramp would be describing a distribution that does not exist.
  expect(classes.length).toBeGreaterThan(0);
  expect(classes.join(' ')).not.toMatch(/\$0\b/);
});

test('every feature still renders, including the one with no value', async ({ page }) => {
  await open(page);

  // "Not shaded" must not become "not drawn": the block group is still part of
  // the answer and still has a population worth hovering.
  // Counted by geoid, not by hit: queryRenderedFeatures returns a polygon once
  // per tile it overlaps, so a feature straddling a tile boundary comes back
  // more than once. Asserting on the raw length passes or fails depending on
  // where the camera happened to land.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
          .__catchmentMap;
        if (!m) return [];
        const hits = m.queryRenderedFeatures(undefined, { layers: ['results-fill'] });
        return [...new Set(hits.map((f) => f.properties?.['geoid'] as string))].sort();
      }),
    )
    .toEqual(QUERY_FIXTURE_SUPPRESSED.features.map((f) => f.properties.geoid).sort());
});
