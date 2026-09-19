/**
 * The answer is in the HTML.
 *
 * This is the property the App Router refactor bought, and it is the one worth
 * pinning, because nothing else in the suite would notice if it quietly went
 * back to being fetched: a client-rendered page passes every other test here
 * once its JavaScript has run.
 *
 * Before, the browser loaded HTML with an empty panel, ran the bundle, POSTed
 * to /api/query and only then had something to show. Now the question is in
 * the URL and the analysis runs on the server, so the answer ships in the
 * first response — shareable, readable by anything that reads HTML, and
 * present with scripting switched off.
 */

import { expect, test } from '@playwright/test';

import { PRESETS, stubBasemap } from './helpers';

test.describe('server rendering', () => {
  test('the answer is in the first response, before any script runs', async ({ request }) => {
    // No browser at all: this is the raw document.
    const res = await request.get(`/?preset=${PRESETS.grocery}`);
    expect(res.status()).toBe(200);

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');

    // The headline number, the title the plan carries, and the audit trail.
    expect(text).toMatch(/\d[\d,]* of \d[\d,]* block groups/);
    expect(text).toContain('Flood exposure and grocery access');
    expect(text).toContain('How this was computed');
  });

  test('a comparison ships its statistics too, not just its shape', async ({ request }) => {
    const html = await (await request.get(`/?preset=${PRESETS.income}`)).text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('flood_pct');
    expect(text).toMatch(/\$[\d,]+/);
    expect(text).toContain('Medians, not means');
  });

  test('it works with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/?preset=${PRESETS.grocery}`);

    // Everything except the map, which needs WebGL and a worker and is honest
    // about that.
    await expect(page.getByText(/of \d[\d,]* block groups/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Catchment' })).toBeVisible();

    // No streamed fallback left on screen. This assertion is the one that
    // matters, and its absence is how a real regression got through: a
    // Suspense boundary reveals its content with an inline script, so with
    // scripting off the page sits on the skeleton for ever while the answer
    // sits in the HTML inside a hidden div. The test above passed anyway,
    // because the render happened to finish before the first flush — until a
    // heavier render tipped it over and the property broke with none of its
    // own code changing.
    await expect(page.getByText('Working out the answer.')).toHaveCount(0);
    expect(await page.locator('div[hidden]').count()).toBeLessThanOrEqual(1);

    // The presets have to be links, not buttons with handlers, or the page is
    // a dead end without scripting.
    const preset = page.getByRole('link', { name: /no supermarket within a kilometre/i });
    await expect(preset).toHaveAttribute('href', `/?preset=${PRESETS.grocery}`);

    await context.close();
  });

  test('the question box is a GET form, so an answer has an address', async ({ page }) => {
    await stubBasemap(page);
    await page.goto('/');

    const form = page.locator('form');
    await expect(form).toHaveAttribute('method', 'get');
    await expect(page.getByLabel('Question')).toHaveAttribute('name', 'q');
  });

  test('an unanswerable question is a normal render, not an error page', async ({ request }) => {
    // `compare` cannot express travel time, and the dataset has no road
    // network. Declining is the correct answer, so it comes back as a page.
    const res = await request.get('/?preset=does-not-exist');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('No such question');
  });

  test('the landing page carries no answer', async ({ request }) => {
    const text = await (await request.get('/')).text();
    expect(text).not.toMatch(/\d[\d,]* of \d[\d,]* block groups/);
    expect(text).toContain('Pick a question on the left');
  });
});
