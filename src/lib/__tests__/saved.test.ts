/**
 * The parts of `lib/saved` that need no database.
 *
 * The authorization claims are tested against real Postgres next door
 * (`saved.integration.test.ts`), because a WHERE clause can only be checked by
 * something that can refuse a query. Everything here is pure.
 *
 * Note what is deliberately *not* here: a "what happens without a database"
 * case. This module assumes a migrated database and says nothing about whether
 * the deployment has one — that question belongs to the routes, and is
 * answered by `missingAuthConfig` (see `auth.test.ts`) and asserted end to end
 * in `e2e/accounts.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import { paramsFor, pathFor } from '@/lib/saved';

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
