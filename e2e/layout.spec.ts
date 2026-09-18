/**
 * Layout regressions, at the sizes people actually hold.
 *
 * The map once had a height of exactly zero on a phone. Nothing threw, the
 * suite was green, and every check that looked at the map itself passed —
 * because the map was fine; it had simply been squeezed out of the page. The
 * stacked controls are about 1,000px of content and carried `shrink-0`, so on
 * an 844px screen they took everything and left the map nothing. A tablet got
 * a 237px sliver of a county 90km across.
 *
 * So these tests measure the boxes rather than the pixels. "The map exists and
 * is big enough to read" is the property that broke, and it is the property
 * asserted here.
 */

import { expect, test, type Page } from '@playwright/test';

import { QUERY_FIXTURE, STUB_STYLE } from './fixture';

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'large phone', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1680, height: 1050 },
] as const;

/** The map has to be worth looking at, not merely present. */
const MIN_MAP_SHARE = 0.4;

async function stub(page: Page) {
  await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ json: STUB_STYLE }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/query', (r) => r.fulfill({ json: QUERY_FIXTURE }));
}

async function boxes(page: Page) {
  // MapView is a dynamic import with ssr:false, so on first paint the slot
  // holds a skeleton and the map element does not exist yet. Measuring before
  // it arrives tests the placeholder, not the map.
  await page.locator('[aria-label="Map of analysis results"]').waitFor();

  return page.evaluate(() => {
    const map = document
      .querySelector('[aria-label="Map of analysis results"]')!
      .getBoundingClientRect();
    const aside = document.querySelector('aside')!.getBoundingClientRect();
    return {
      mapHeight: Math.round(map.height),
      mapWidth: Math.round(map.width),
      asideHeight: Math.round(aside.height),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      // A horizontal scrollbar on a phone is the classic sign of a fixed width
      // escaping its container.
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

for (const size of SIZES) {
  test(`the map keeps its share of the screen on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await stub(page);
    await page.goto('/');

    const before = await boxes(page);
    expect(
      before.mapHeight,
      `map is ${before.mapHeight}px tall in a ${size.height}px viewport`,
    ).toBeGreaterThanOrEqual(size.height * MIN_MAP_SHARE);
    expect(before.mapWidth).toBeGreaterThan(0);
    expect(before.horizontalOverflow).toBe(false);

    // A result adds a panel to the controls. On a phone that panel is the
    // tallest thing on the page, and it must not push the map out again.
    await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();
    await expect(page.getByText('Flood exposure and grocery access')).toBeVisible();

    const after = await boxes(page);
    expect(
      after.mapHeight,
      `map shrank to ${after.mapHeight}px once a result arrived`,
    ).toBeGreaterThanOrEqual(size.height * MIN_MAP_SHARE);
    expect(after.horizontalOverflow).toBe(false);
  });
}

test('the answer is readable without hunting for it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stub(page);
  await page.goto('/');
  await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();

  const answer = page.getByText(/of 2,830 block groups/);
  await expect(answer).toBeVisible();

  // Visible is not the same as in view: the panel used to render below eight
  // preset buttons and sat past the bottom of the controls' scroll area.
  const inView = await answer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const scroller = el.closest('aside')!.getBoundingClientRect();
    return r.top >= scroller.top && r.bottom <= scroller.bottom;
  });
  expect(inView, 'the answer rendered outside the visible part of the controls').toBe(true);
});

test('the county boundary frames the study area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stub(page);
  await page.goto('/');

  // The mask and outline are what tell a reader where the analysis stops. They
  // are static, so they should be there before any question is asked.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
          .__catchmentMap;
        if (!m) return null;
        return ['county-mask', 'county-outline'].filter((l) => m.getLayer(l)).length;
      }),
    )
    .toBe(2);

  // Drawn under the results, or it would grey out the answer.
  const order = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const ids = m.getStyle().layers.map((l) => l.id);
    return { mask: ids.indexOf('county-mask'), fill: ids.indexOf('results-fill') };
  });
  expect(order.mask).toBeLessThan(order.fill);
});
