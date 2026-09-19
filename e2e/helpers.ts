/**
 * Shared setup for the end-to-end suite.
 *
 * The page renders on the server now, so there is no `/api/query` call to
 * intercept: the browser is handed finished HTML. The tests therefore run
 * against a real server backed by `fixtures/block-groups.json` — a stratified
 * sample of the real table, chosen so the awkward cases survive (suppressed
 * income, both sides of the flood threshold, block groups far from a shop).
 *
 * That means these are not tests against invented data. They exercise the
 * actual analysis over actual Harris County geometry; only the row count is
 * smaller. `playwright.config.ts` sets CATCHMENT_DATA=fixture for the server
 * it starts.
 *
 * The basemap is still stubbed. It comes from a third party, and letting an
 * unrelated outage look like a rendering regression — or letting the
 * 12-second fallback watchdog fire mid-assertion — would make the suite lie.
 */

import { expect, type Page } from '@playwright/test';

export const PRESETS = {
  /** Sparse choropleth shaded by population. */
  grocery: 'flooded-grocery-deserts',
  /** compare: statistics plus a two-channel map, shaded by median income. */
  income: 'income-flood-gap',
  /** Shaded by median income, so suppressed values are on screen. */
  lowIncomeFlooded: 'low-income-flooded',
} as const;

/**
 * A basemap that cannot be slow, rate limited or offline.
 *
 * The attribution source is not decoration: without attribution text MapLibre
 * renders its control as a zero-sized element at the origin, and a test
 * asserting that nothing overlaps it would be comparing against a box at
 * (0,0) — which is how the detail panel came to sit 22px under the real
 * attribution bar with the suite green.
 */
export const STUB_STYLE = {
  version: 8,
  sources: {
    attribution: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f1f5f9' } },
    // MapLibre only credits sources a layer actually uses.
    { id: 'attribution', type: 'circle', source: 'attribution' },
  ],
};

export async function stubBasemap(page: Page) {
  await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ json: STUB_STYLE }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
}

/** Rendered block groups, counted by geoid. */
export async function renderedGeoids(page: Page): Promise<string[]> {
  const ids = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap;
    if (!m || !m.getLayer('results-fill')) return [];
    // queryRenderedFeatures returns a polygon once per tile it overlaps, so a
    // feature straddling a tile boundary comes back more than once. Counting
    // hits instead of geoids passes or fails depending on where the camera
    // happened to land.
    const hits = m.queryRenderedFeatures(undefined, { layers: ['results-fill'] });
    return [...new Set(hits.map((f) => f.properties?.['geoid'] as string))];
  });
  return ids;
}

/**
 * Open a preset answer and wait until the map has actually drawn it.
 *
 * Navigating straight to the URL rather than clicking: the answer is a page,
 * and a page is reached by its address. Individual specs still click the links
 * where the click itself is what is under test.
 */
export async function openPreset(page: Page, preset: string) {
  await stubBasemap(page);
  await page.goto(`/?preset=${preset}`);

  // The answer is server-rendered, so it is present before any script runs.
  await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();

  await expect.poll(async () => (await renderedGeoids(page)).length).toBeGreaterThan(0);

  // And wait for the camera to settle. A new result runs a 600ms fitBounds, so
  // a point projected mid-flight has moved by the time a tap lands.
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
