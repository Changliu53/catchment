/**
 * A comparison has to look like a comparison.
 *
 * `compare` answers with two distributions rather than a value per row, so its
 * plan carries no `color_by` — and nothing in the map handled that. The whole
 * county came back (compare filters nothing), fell through to the default
 * branch, and was painted one flat blue: 2,830 identical polygons, 2,830 dots
 * on top, and no legend, because the legend keyed off a field that was not
 * there. The statistics table was the only part of the answer that said
 * anything.
 *
 * The map now paints which side of the threshold each block group falls on,
 * which is the one thing the table cannot show: where each group is.
 */

import { expect, test, type Page } from '@playwright/test';

import { QUERY_FIXTURE_COMPARISON, STUB_STYLE } from './fixture';

const { comparison } = QUERY_FIXTURE_COMPARISON;

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ json: STUB_STYLE }));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/query', (r) => r.fulfill({ json: QUERY_FIXTURE_COMPARISON }));
  await page.goto('/');
  await page.getByRole('button', { name: /no supermarket within a kilometre/i }).click();
  await expect(page.getByText('Income distribution by flood exposure')).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map })
          .__catchmentMap;
        return m ? m.queryRenderedFeatures(undefined, { layers: ['results-fill'] }).length : 0;
      }),
    )
    .toBeGreaterThan(0);
}

test('the fill grades the measure the question is about', async ({ page }) => {
  await open(page);

  const paint = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    return m.getPaintProperty('results-fill', 'fill-color');
  });

  // A flat fill is a bare colour string; the original failure looked exactly
  // like that. And it has to grade `median_income` — shading by the split
  // field instead answers half the question and leaves the measure off the map.
  expect(Array.isArray(paint), `fill-color is ${JSON.stringify(paint)}`).toBe(true);
  const expr = paint as unknown[];
  expect(expr[0]).toBe('case');
  expect(expr[1]).toEqual(['==', ['get', comparison.measure], null]);
  expect(JSON.stringify(expr)).toContain(`["to-number",["get","${comparison.measure}"]]`);
});

test('the group it splits on is outlined over that fill', async ({ page }) => {
  await open(page);

  const split = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const ids = m.getStyle().layers.map((l) => l.id);
    return {
      visible: m.getLayoutProperty('results-split', 'visibility'),
      filter: m.getFilter('results-split'),
      colour: m.getPaintProperty('results-split', 'line-color'),
      // Over the fill, or the outline is buried under it.
      aboveFill: ids.indexOf('results-split') > ids.indexOf('results-fill'),
    };
  });

  expect(split.visible).toBe('visible');
  expect(split.aboveFill).toBe(true);
  expect(split.filter).toEqual([
    '>=',
    ['to-number', ['get', comparison.split_on]],
    comparison.threshold,
  ]);
  // Two variables need two channels: an outline taken from the fill's own ramp
  // would read as one more class of it.
  expect(String(split.colour).toLowerCase()).not.toMatch(/#(3b82f6|2563eb|1d4ed8|1e40af|1e3a8a|172554)/);
});

test('the dot layer is off, because every polygon has a neighbour', async ({ page }) => {
  await open(page);

  const dots = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    return m.getLayoutProperty('results-dots', 'visibility');
  });

  // Dots exist to reveal small polygons in a sparse result. A comparison
  // returns the whole county, so they cover the answer instead of aiding it.
  expect(dots).toBe('none');
});

test('the legend explains both channels', async ({ page }) => {
  await open(page);

  // Captioned by the measure, because that is what the colours mean.
  const legend = page.getByRole('figure', { name: 'Median household income' });
  await expect(legend).toBeVisible();

  // And one row for the outline, or the amber shapes are unexplained.
  const outlineRow = legend.getByRole('listitem').filter({ hasText: /floodplain/i });
  await expect(outlineRow).toHaveCount(1);
  // formatValue trims a trailing .0, so the threshold reads "50%".
  await expect(outlineRow).toContainText('≥ 50%');
  await expect(outlineRow).toContainText(String(comparison.above.n));
});

test('the statistics table is still the answer', async ({ page }) => {
  await open(page);

  // The map gained a job here; it did not take the table's.
  await expect(page.getByText(`${comparison.split_on} ≥ ${comparison.threshold}`)).toBeVisible();
  await expect(page.getByText('$63,475')).toBeVisible();
  await expect(page.getByText('$73,563')).toBeVisible();
  await expect(page.getByText(/Medians, not means/i)).toBeVisible();
});
