/**
 * The parts of `lib/saved` that need no database — including, above all, what
 * happens when there isn't one.
 *
 * The authorization claims are tested against real Postgres next door
 * (`saved.integration.test.ts`), because a WHERE clause can only be checked by
 * something that can refuse a query. What is checked here is the degraded
 * path, which is easy to get wrong precisely because it is never exercised in
 * development: `/a/<slug>` is the one route a stranger can reach without an
 * account, so it is also the route that gets opened on a deployment that has
 * no accounts at all.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { getBySlug, paramsFor, pathFor } from '@/lib/saved';

const original = process.env.DATABASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
});

describe('without a database', () => {
  it('reports a share link as missing rather than throwing', async () => {
    delete process.env.DATABASE_URL;

    // The regression: this used to reach the client, which throws on a
    // missing connection string, turning a link someone pasted into a 500.
    // Nothing was ever saved on such a deployment, so "not found" is not a
    // softened error — it is the true answer.
    await expect(getBySlug('k7m2p9qr4t')).resolves.toBeNull();
  });
});

describe('turning a saved row back into a question', () => {
  it('prefers the preset when there is one', () => {
    expect(paramsFor({ presetId: 'income-flood-gap', question: null })).toBe(
      'preset=income-flood-gap',
    );
  });

  it('escapes a free-text question', () => {
    expect(paramsFor({ presetId: null, question: 'which tracts flood & lack groceries?' })).toBe(
      'q=which%20tracts%20flood%20%26%20lack%20groceries%3F',
    );
  });

  it('builds a path the router can check', () => {
    expect(pathFor('abc123')).toBe('/a/abc123');
  });
});
