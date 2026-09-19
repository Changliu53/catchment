/**
 * A comparison has to look like a comparison.
 *
 * `compare` answers with two distributions rather than a value per row, so its
 * plan carries no `color_by` — and nothing in the map handled that. The whole
 * county came back (compare filters nothing), fell through to the default
 * branch, and was painted one flat blue: identical polygons under a dot per
 * polygon, and no legend, because the legend keyed off a field that was not
 * there. The statistics table was the only part of the answer saying anything.
 *
 * Then the first fix went too far the other way and painted which side of the
 * threshold each row fell on — which answers half the question and leaves the
 * measure, the thing actually being compared, off the map entirely.
 *
 * Two variables, two channels: the fill grades the measure, the group is
 * outlined over it.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS } from './helpers';

test('the fill grades the measure the question is about', async ({ page }) => {
  await openPreset(page, PRESETS.income);

  const paint = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    return m.getPaintProperty('results-fill', 'fill-color');
  });

  // A flat fill is a bare colour string; the original failure looked exactly
  // like that. And it has to grade median income — shading by the split field
  // instead answers half the question.
  expect(Array.isArray(paint), `fill-color is ${JSON.stringify(paint)}`).toBe(true);
  const expr = paint as unknown[];
  expect(expr[0]).toBe('case');
  expect(expr[1]).toEqual(['==', ['get', 'median_income'], null]);
  expect(JSON.stringify(expr)).toContain('["to-number",["get","median_income"]]');
});

test('the group it splits on is outlined over that fill', async ({ page }) => {
  await openPreset(page, PRESETS.income);

  const split = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const ids = m.getStyle().layers.map((l) => l.id);
    return {
      visible: m.getLayoutProperty('results-split', 'visibility'),
      filter: m.getFilter('results-split'),
      colour: String(m.getPaintProperty('results-split', 'line-color')).toLowerCase(),
      // Over the fill, or the outline is buried under it.
      aboveFill: ids.indexOf('results-split') > ids.indexOf('results-fill'),
      dots: m.getLayoutProperty('results-dots', 'visibility'),
    };
  });

  expect(split.visible).toBe('visible');
  expect(split.aboveFill).toBe(true);
  expect(split.filter).toEqual(['>=', ['to-number', ['get', 'flood_pct']], 0.5]);
  // Two variables need two channels: an outline taken from the fill's own ramp
  // would read as one more class of it.
  expect(split.colour).not.toMatch(/#(3b82f6|2563eb|1d4ed8|1e40af|1e3a8a|172554)/);
  // Dots reveal small polygons in a sparse result; a comparison returns the
  // whole county, where they cover the answer instead.
  expect(split.dots).toBe('none');
});

test('the legend explains both channels', async ({ page }) => {
  await openPreset(page, PRESETS.income);

  // Captioned by the measure, because that is what the colours mean.
  const legend = page.getByRole('figure', { name: 'Median household income' });
  await expect(legend).toBeVisible();

  const outlineRow = legend.getByRole('listitem').filter({ hasText: /floodplain/i });
  await expect(outlineRow).toHaveCount(1);
  // formatValue trims a trailing .0, so the threshold reads "50%".
  await expect(outlineRow).toContainText('50%');
});

test('the statistics are server-rendered, not drawn by the map', async ({ page }) => {
  await openPreset(page, PRESETS.income);

  // The map gained a job here; it did not take the table's.
  await expect(page.getByText('flood_pct ≥ 0.5')).toBeVisible();
  await expect(page.getByText('flood_pct < 0.5')).toBeVisible();
  await expect(page.getByText(/Medians, not means/i)).toBeVisible();
});
