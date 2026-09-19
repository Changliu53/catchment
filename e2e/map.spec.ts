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
 * It runs against a production build (see playwright.config.ts). The original
 * fault was a bundling fault: `next dev` served the worker fine and would have
 * shown a perfectly healthy map.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import { openPreset, PRESETS, renderedGeoids, stubBasemap } from './helpers';

/** The console line that was the only visible trace of the dead worker. */
const WORKER_FAILURE = /module script|MIME type|Failed to (?:load|construct).*[Ww]orker/;

test.describe('results map', () => {
  test('draws the block groups the answer matched', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await openPreset(page, PRESETS.grocery);

    // Every geoid on screen is one the server said matched. The page states
    // the count, so the two are checked against each other rather than against
    // a number written into this file.
    const stated = await page
      .getByText(/of \d[\d,]* block groups/)
      .innerText()
      .then((t) => Number(t.match(/^([\d,]+)/)?.[1]?.replace(/,/g, '')));

    const drawn = await renderedGeoids(page);
    expect(stated).toBeGreaterThan(0);
    expect(drawn.length).toBe(stated);

    const workerErrors = consoleErrors.filter((e) => WORKER_FAILURE.test(e));
    expect(workerErrors, 'the worker failed to load').toEqual([]);
  });

  test('does not fall back to the raster basemap when the style loads', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });

    await openPreset(page, PRESETS.grocery);

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

    await stubBasemap(page);
    await page.goto(`/?preset=${PRESETS.grocery}`);

    // The answer still arrives and the page still states it — this is exactly
    // why the blank map was so hard to read. Everything outside the canvas is
    // right, and now it is right before any script runs at all.
    await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();

    // Generous, because the claim is "never", not "not yet".
    await page.waitForTimeout(5_000);

    const layers = await page.evaluate(() => {
      const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
        .__catchmentMap;
      if (!m) return -1;
      return ['results-fill', 'results-dots'].filter((l) => m.getLayer(l)).length;
    });

    // The layers exist. That was always true, and it is why every check short
    // of this one passed while the map stayed empty.
    expect(layers).toBeGreaterThan(0);
    expect(await renderedGeoids(page)).toEqual([]);
  });
});
