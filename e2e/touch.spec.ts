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

import { openPreset, PRESETS } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** The share of the map a legend may cover before it stops being an aid. */
const MAX_LEGEND_SHARE = 0.15;

async function open(page: Page) {
  await openPreset(page, PRESETS.grocery);
}

/**
 * Screen coordinates of a point that really is inside a drawn block group.
 *
 * Not the mean of a ring: a census block group is not convex — they wrap
 * bayous and follow street grids — so the centre of its vertices is regularly
 * outside it, and a tap there hits the basemap. This asks the map what is
 * under a grid of candidate points and takes the first that is over a result.
 */
async function pointOnAFeature(page: Page) {
  const found = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const canvas = m.getCanvas();
    const rect = document
      .querySelector('[aria-label="Map of analysis results"]')!
      .getBoundingClientRect();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    for (let fy = 0.15; fy < 0.9; fy += 0.05) {
      for (let fx = 0.1; fx < 0.95; fx += 0.05) {
        const pt: [number, number] = [w * fx, h * fy];
        const hit = m.queryRenderedFeatures(pt, { layers: ['results-fill'] })[0];
        if (hit) {
          return {
            x: rect.left + pt[0],
            y: rect.top + pt[1],
            geoid: hit.properties?.['geoid'] as string,
          };
        }
      }
    }
    return null;
  });

  if (!found) throw new Error('no rendered block group was reachable by tapping');
  return found;
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

  // And all of it has to be readable. On the live preview the panel ran 22px
  // under MapLibre's attribution bar, which spans the full width on a phone,
  // so the last row's value sat behind it.
  const fit = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('div')]
      .find((d) => d.textContent?.startsWith('Block group '))!
      .getBoundingClientRect();
    const map = document
      .querySelector('[aria-label="Map of analysis results"]')!
      .getBoundingClientRect();
    const attribution = document.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect();
    return {
      // A control with no attribution text has a zero-sized box at the
      // origin; comparing against that would always 'overlap'.
      attributionVisible: !!attribution && attribution.height > 0,
      overlapsAttribution:
        attribution && attribution.height > 0 ? panel.bottom > attribution.top + 1 : false,
      escapesMap: panel.top < map.top - 1 || panel.bottom > map.bottom + 1,
      geometry: {
        panel: [Math.round(panel.top), Math.round(panel.bottom)],
        map: [Math.round(map.top), Math.round(map.bottom)],
        attribution: attribution
          ? [Math.round(attribution.top), Math.round(attribution.bottom)]
          : null,
      },
    };
  });
  // If this is false the overlap check below is vacuous, so assert it.
  expect(fit.attributionVisible, 'the fixture style rendered no attribution to test against').toBe(
    true,
  );
  expect(
    fit.overlapsAttribution,
    `the detail panel sits under the attribution bar: ${JSON.stringify(fit.geometry)}`,
  ).toBe(false);
  expect(fit.escapesMap, 'the detail panel spills outside the map').toBe(false);
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
  // shaded and which direction is more, so the strip carries both ends of the
  // range. The values come from the data, so they are read rather than
  // hardcoded — a legend that renders "—" at both ends would pass a check that
  // only looked for two numbers.
  const legend = page.getByRole('figure', { name: 'Population' });
  await expect(legend).toBeVisible();

  const ends = (await legend.innerText()).match(/[\d,]+/g) ?? [];
  const numbers = ends.map((n) => Number(n.replace(/,/g, ''))).filter((n) => n > 0);
  expect(numbers.length, 'the compact legend showed no range').toBeGreaterThanOrEqual(2);
  expect(Math.max(...numbers)).toBeGreaterThan(Math.min(...numbers));
});
