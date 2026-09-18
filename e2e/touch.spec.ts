/**
 * The map has to be usable without a mouse.
 *
 * Every per-block-group number — population, median income, flood share,
 * distance to a supermarket — lived behind `mousemove`. A touch device has no
 * hover, so on a phone none of it was reachable: the map rendered, it was
 * correctly coloured, and it answered no questions. Tapping a polygon produced
 * nothing at all, which a desktop test suite has no way of noticing.
 *
 * The legend had the same shape of problem in a different direction: the full
 * class table measured 264x203 over a 390x464 map, covering thirty percent of
 * the thing it was annotating.
 */

import { expect, test, type Page } from '@playwright/test';

import { QUERY_FIXTURE, STUB_STYLE } from './fixture';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The share of the map a legend may cover before it stops being an aid. */
const MAX_LEGEND_SHARE = 0.15;

async function open(page: Page) {
  await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ json: STUB_STYLE }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/query', (r) => r.fulfill({ json: QUERY_FIXTURE }));
  await page.goto('/');
  await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();
  await expect(page.getByText('Flood exposure and grocery access')).toBeVisible();

  // Wait for the worker to produce tiles; nothing is tappable before that.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
          .__catchmentMap;
        return m ? m.queryRenderedFeatures(undefined, { layers: ['results-fill'] }).length : 0;
      }),
    )
    .toBeGreaterThan(0);

  // And wait for the camera to stop. A new result runs a 600ms fitBounds, so
  // a point projected while the map is still flying has moved by the time the
  // tap lands — which showed up as a test that failed about one run in three.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
          .__catchmentMap;
        if (!m || !m.isMoving()) return resolve();
        m.once('moveend', () => resolve());
      }),
  );
}

/** Screen coordinates of a point inside a rendered block group. */
async function pointOnAFeature(page: Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const f = m.queryRenderedFeatures(undefined, { layers: ['results-fill'] })[0]!;
    const ring = (f.geometry as { coordinates: [number, number][][] }).coordinates[0]!;
    // Mean of the ring, which is inside it for the convex fixture polygons.
    const mid = ring.reduce((a, c) => [a[0] + c[0] / ring.length, a[1] + c[1] / ring.length], [0, 0]);
    const p = m.project(mid as [number, number]);
    const rect = document
      .querySelector('[aria-label="Map of analysis results"]')!
      .getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y, geoid: f.properties?.['geoid'] as string };
  });
}

test('tapping a block group shows its numbers', async ({ page }) => {
  await open(page);
  const target = await pointOnAFeature(page);

  await page.touchscreen.tap(target.x, target.y);

  const panel = page.getByText(`Block group ${target.geoid}`);
  await expect(panel).toBeVisible();

  // The point of opening it: the values, not just the identifier.
  const details = page.locator('dl').filter({ hasText: 'Population' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('Median household income');
  await expect(details).toContainText('Distance to nearest supermarket');
});

test('a tapped block group can be dismissed', async ({ page }) => {
  await open(page);
  const target = await pointOnAFeature(page);

  await page.touchscreen.tap(target.x, target.y);
  await expect(page.getByText(`Block group ${target.geoid}`)).toBeVisible();

  // Without a mouse there is no "move away", so there has to be a way out.
  await page.getByRole('button', { name: /close block group details/i }).click();
  await expect(page.getByText(`Block group ${target.geoid}`)).toBeHidden();
});

test('a tap on empty map clears the selection', async ({ page }) => {
  await open(page);
  const target = await pointOnAFeature(page);
  await page.touchscreen.tap(target.x, target.y);
  await expect(page.getByText(`Block group ${target.geoid}`)).toBeVisible();

  // The county is masked but still map; a tap that hits no block group is the
  // other ordinary way to close the panel.
  const rect = (await page.locator('[aria-label="Map of analysis results"]').boundingBox())!;
  await page.touchscreen.tap(rect.x + 8, rect.y + rect.height - 8);
  await expect(page.getByText(`Block group ${target.geoid}`)).toBeHidden();
});

test('the legend stays out of the way on a phone', async ({ page }) => {
  await open(page);

  const share = await page.evaluate(() => {
    const legend = document.querySelector('figure')!.getBoundingClientRect();
    const map = document
      .querySelector('[aria-label="Map of analysis results"]')!
      .getBoundingClientRect();
    return (legend.width * legend.height) / (map.width * map.height);
  });

  expect(share, `the legend covers ${(share * 100).toFixed(1)}% of the map`).toBeLessThan(
    MAX_LEGEND_SHARE,
  );

  // Compact is not the same as absent: it still has to say what is being
  // shaded and which direction is more.
  const legend = page.getByRole('figure', { name: 'Population' });
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('960');
  await expect(legend).toContainText('5,310');
});
