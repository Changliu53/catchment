/**
 * The blank-map regression.
 *
 * What happened: MapLibre v6 loads its Web Worker as a separate chunk via
 * `new Worker(new URL(...))`. That URL did not survive bundling into the
 * deployed build, so the request fell back to the document root and came back
 * as the 404 HTML page. The worker is what turns GeoJSON into renderable
 * tiles, so the map drew nothing — while the source existed, the layers
 * existed and were on top, the paint expression was correct, and nothing
 * threw. Every check available from outside the map passed.
 *
 * That is why this test asks the map itself. `queryRenderedFeatures` can only
 * answer from tiles the worker produced, so it is a direct probe of the thing
 * that broke, and it fails for a blank map no matter which of the several
 * plausible causes produced it. The unit test in
 * `src/lib/__tests__/maplibre-packaging.test.ts` guards the specific packaging
 * property; this one guards the outcome.
 *
 * It deliberately runs against a production build (see playwright.config.ts).
 * The original fault was a bundling fault: `next dev` served the worker fine
 * and would have shown a perfectly healthy map.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import { QUERY_FIXTURE, STUB_STYLE } from './fixture';

/** The console line that was the only visible trace of the dead worker. */
const WORKER_FAILURE = /module script|MIME type|Failed to (?:load|construct).*[Ww]orker/;

test.describe('results map', () => {
  test('draws the features it is given', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    // Both third-party basemaps are stubbed: the primary so the style resolves
    // instantly, the fallback so a silent switch to it cannot pass as success.
    await page.route('**/tiles.openfreemap.org/**', (route) =>
      route.fulfill({ json: STUB_STYLE }),
    );
    await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
    await page.route('**/api/query', (route) => route.fulfill({ json: QUERY_FIXTURE }));

    await page.goto('/');

    // A preset, because that is the path a visitor takes and it needs no key.
    await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();

    // The plan panel confirms the response arrived and was parsed. If this
    // fails the problem is upstream of rendering, which is worth knowing
    // before the map assertion muddies it.
    await expect(page.getByText('Flood exposure and grocery access')).toBeVisible();

    // The assertion. Poll rather than wait on an event: tiling is asynchronous
    // and `idle` has fired early enough to flake before.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
              .__catchmentMap;
            if (!m) return -1;
            return m.queryRenderedFeatures(undefined, {
              layers: ['results-fill', 'results-dots'].filter((l) => m.getLayer(l)),
            }).length;
          }),
        {
          timeout: 20_000,
          message:
            'The map rendered no features. The source and layers can still be present and ' +
            'correct when this fails — check that the MapLibre worker loaded.',
        },
      )
      .toBeGreaterThan(0);

    // The polygons carry their data through, so a hover reads real values
    // rather than an empty popup over a correctly-coloured shape.
    const rendered = await page.evaluate(() => {
      const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
        .__catchmentMap!;
      return m
        .queryRenderedFeatures(undefined, { layers: ['results-fill'] })
        .map((f) => f.properties?.['geoid'] as string);
    });
    expect(new Set(rendered)).toEqual(
      new Set(QUERY_FIXTURE.features.map((f) => f.properties.geoid)),
    );

    // The legend and the map are classified from the same breaks, so a legend
    // that renders no classes means the page and the map disagree about the
    // data even if the map itself drew something.
    const legend = page.getByRole('figure', { name: 'Population' });
    await expect(legend).toBeVisible();
    expect(await legend.getByRole('listitem').count()).toBeGreaterThan(1);

    const workerErrors = consoleErrors.filter((e) => WORKER_FAILURE.test(e));
    expect(workerErrors, 'the worker failed to load').toEqual([]);
  });

  test('does not fall back to the raster basemap when the style loads', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });

    await page.route('**/tiles.openfreemap.org/**', (route) =>
      route.fulfill({ json: STUB_STYLE }),
    );
    await page.route('**/api/query', (route) => route.fulfill({ json: QUERY_FIXTURE }));

    await page.goto('/');
    await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();
    await expect(page.getByText('Flood exposure and grocery access')).toBeVisible();

    // Longer than the watchdog, so a spurious fallback has time to happen.
    await page.waitForTimeout(14_000);

    expect(warnings.filter((w) => /falling back to OSM raster/.test(w))).toEqual([]);
  });

  /**
   * The negative control.
   *
   * A regression test that has never failed is a guess about what it measures.
   * This one takes the worker away — the exact fault, reproduced rather than
   * described — and asserts that the probe above goes to zero. If a future
   * MapLibre renders GeoJSON on the main thread when no worker is available,
   * this test fails, and that is the signal that `queryRenderedFeatures` has
   * stopped being sensitive to the thing it was chosen to detect.
   *
   * It is also the reproduction: run the suite with the line below removed and
   * the first test is the map Chang was looking at.
   */
  test('renders nothing when the worker is unavailable (control)', async ({ page }) => {
    // Break Worker before any application code runs. Constructing it succeeds,
    // as it did in the real failure — the worker simply never answers, so no
    // tile is ever built and nothing reaches the screen.
    await page.addInitScript(() => {
      class DeadWorker {
        onmessage: unknown = null;
        onerror: unknown = null;
        postMessage() {}
        addEventListener() {}
        removeEventListener() {}
        terminate() {}
      }
      (window as unknown as { Worker: unknown }).Worker = DeadWorker;
    });

    await page.route('**/tiles.openfreemap.org/**', (route) =>
      route.fulfill({ json: STUB_STYLE }),
    );
    await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
    await page.route('**/api/query', (route) => route.fulfill({ json: QUERY_FIXTURE }));

    await page.goto('/');
    await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();

    // The data still arrives and the UI still reports it: this is precisely why
    // the blank map was so hard to read. Everything outside the canvas is right.
    await expect(page.getByText('Flood exposure and grocery access')).toBeVisible();

    // Generous, because the claim is "never", not "not yet".
    await page.waitForTimeout(5_000);

    const rendered = await page.evaluate(() => {
      const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
        .__catchmentMap;
      if (!m) return -1;
      const layers = ['results-fill', 'results-dots'].filter((l) => m.getLayer(l));
      return { layers: layers.length, features: m.queryRenderedFeatures(undefined, { layers }).length };
    });

    // The layers exist. That was always true, and it is why every check short
    // of this one passed while the map stayed empty.
    expect(rendered).not.toBe(-1);
    expect((rendered as { layers: number }).layers).toBeGreaterThan(0);
    expect((rendered as { features: number }).features).toBe(0);
  });
});
