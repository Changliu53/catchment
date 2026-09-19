/**
 * Suppressed values must not be drawn as low values.
 *
 * The Census withholds a median income estimate wherever the sample is too
 * small — 273 of Harris County's 2,830 block groups, and 42 of the 400 in the
 * test fixture. The map used to shade by `['to-number', ['get', field], 0]`,
 * which turned every one of those into a zero: the lightest blue, shown as the
 * poorest neighbourhoods in the county. The page computed its class breaks the
 * same way, so those zeros also pulled every quantile boundary downward and
 * the error reached rows whose data was fine.
 *
 * It is the kind of defect that never throws and never looks wrong. These
 * tests hold the three places it has to be handled: the colour, the
 * classification, and the legend that explains both.
 */

import { expect, test } from '@playwright/test';

import { openPreset, PRESETS } from './helpers';

test('a block group with no income is shaded as no data, not as poor', async ({ page }) => {
  await openPreset(page, PRESETS.lowIncomeFlooded);

  const paint = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    return m.getPaintProperty('results-fill', 'fill-color');
  });

  // Read off the live map rather than re-derived here.
  expect(Array.isArray(paint)).toBe(true);
  const expr = paint as unknown[];
  expect(expr[0]).toBe('case');
  expect(expr[1]).toEqual(['==', ['get', 'median_income'], null]);
  expect(String(expr[2]).toLowerCase()).toBe('#cbd5e1');

  // The sentinel alternative that silently never fires.
  expect(JSON.stringify(expr)).not.toContain('["to-number",["get","median_income"],0]');
});

test('the legend accounts for what it could not shade', async ({ page }) => {
  await openPreset(page, PRESETS.lowIncomeFlooded);

  const legend = page.getByRole('figure', { name: 'Median household income' });
  await expect(legend).toBeVisible();

  const noData = legend.getByRole('listitem').filter({ hasText: 'No data' });
  const count = await noData.count();

  if (count > 0) {
    // Grey on a map with no entry explaining it is worse than no grey at all.
    await expect(legend).toContainText(/suppresses estimates/i);
    const shown = Number((await noData.innerText()).match(/(\d+)\s*$/)?.[1]);
    expect(shown).toBeGreaterThan(0);
  }

  // Whatever the counts, no class may start at zero: that is what a coerced
  // null looks like once it reaches the classifier.
  const classes = (await legend.getByRole('listitem').allInnerTexts()).filter(
    (r) => !r.includes('No data') && !/floodplain/i.test(r),
  );
  expect(classes.length).toBeGreaterThan(0);
  expect(classes.join(' ')).not.toMatch(/\$0\b/);
});

test('rows it cannot shade are still drawn', async ({ page }) => {
  await openPreset(page, PRESETS.lowIncomeFlooded);

  // "Not shaded" must not become "not drawn": the block group is still part of
  // the answer and still has a population worth inspecting.
  const stated = await page
    .getByText(/of \d[\d,]* block groups/)
    .innerText()
    .then((t) => Number(t.match(/^([\d,]+)/)?.[1]?.replace(/,/g, '')));

  const drawn = await page.evaluate(() => {
    const m = (window as unknown as { __catchmentMap?: import('maplibre-gl').Map }).__catchmentMap!;
    const hits = m.queryRenderedFeatures(undefined, { layers: ['results-fill'] });
    return [...new Set(hits.map((f) => f.properties?.['geoid'] as string))].length;
  });

  expect(drawn).toBe(stated);
});
