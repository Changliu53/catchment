/**
 * Authorization, against a real Postgres.
 *
 * These assertions cannot be made against a mock. The claim is that one person
 * cannot read, rename or delete another person's saved analysis, and that
 * claim lives in a WHERE clause — a fake query builder would happily agree
 * with whatever the code asked it, including a query missing half its
 * conditions.
 *
 * So the suite skips unless DATABASE_URL points at a Postgres with the
 * migrations applied. CI starts one as a service container and runs
 * `drizzle-kit migrate` before this; locally, any Postgres will do.
 *
 * Skipping is the danger, though. A suite that quietly skips its only
 * security assertions reports the same green as one that ran them, so the
 * skip is allowed on a laptop and refused in CI: if the service container or
 * the environment variable ever goes missing, this file fails rather than
 * disappears.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { savedAnalysis, user } from '@/db/schema';
import {
  createFor,
  deleteFor,
  getBySlug,
  listForUser,
  ownedBy,
  paramsFor,
  renameFor,
} from '@/lib/saved';

const live = Boolean(process.env.DATABASE_URL);

if (!live && process.env.CI) {
  throw new Error(
    'DATABASE_URL is not set in CI, so the authorization tests would have been skipped. ' +
      'They are the only tests that can prove one account cannot read another account’s rows.',
  );
}

const OWNER = 'test-owner';
const STRANGER = 'test-stranger';

describe.skipIf(!live)('saved analyses', () => {
  beforeAll(async () => {
    await db().delete(user).where(eq(user.id, OWNER));
    await db().delete(user).where(eq(user.id, STRANGER));
    await db()
      .insert(user)
      .values([
        { id: OWNER, name: 'Owner', email: 'owner@example.test', emailVerified: true },
        { id: STRANGER, name: 'Stranger', email: 'stranger@example.test', emailVerified: true },
      ]);
  });

  afterAll(async () => {
    // The cascade takes the saved rows with it, which is itself worth relying
    // on: deleting an account must not leave its analyses behind.
    await db().delete(user).where(eq(user.id, OWNER));
    await db().delete(user).where(eq(user.id, STRANGER));
  });

  it('lists only the rows belonging to the asker', async () => {
    const mine = await createFor(OWNER, { title: 'Mine', presetId: 'flooded-grocery-deserts' });
    await createFor(STRANGER, { title: 'Theirs', presetId: 'worst-park-access' });

    const listed = await listForUser(OWNER);
    expect(listed.map((r) => r.slug)).toContain(mine);
    expect(listed.every((r) => r.title !== 'Theirs')).toBe(true);
  });

  it('will not rename a row belonging to someone else', async () => {
    const slug = await createFor(OWNER, { title: 'Original', presetId: 'densest' });

    // The answer is false rather than an error: a stranger learns nothing
    // about whether the slug exists.
    expect(await renameFor(STRANGER, slug, 'Hijacked')).toBe(false);

    const after = await getBySlug(slug);
    expect(after?.title).toBe('Original');
  });

  it('will not delete a row belonging to someone else', async () => {
    const slug = await createFor(OWNER, { title: 'Keep me', presetId: 'grocery-deserts' });

    expect(await deleteFor(STRANGER, slug)).toBe(false);
    expect(await getBySlug(slug)).not.toBeNull();

    expect(await deleteFor(OWNER, slug)).toBe(true);
    expect(await getBySlug(slug)).toBeNull();
  });

  it('lets the owner rename, and reports ownership honestly', async () => {
    const slug = await createFor(OWNER, { title: 'Before', presetId: 'outside-sfha' });

    expect(await ownedBy(slug, OWNER)).toBe(true);
    expect(await ownedBy(slug, STRANGER)).toBe(false);

    expect(await renameFor(OWNER, slug, 'After')).toBe(true);
    expect((await getBySlug(slug))?.title).toBe('After');
  });

  it('reads a shared analysis without knowing who is asking', async () => {
    // A share link that needs an account is not a share link.
    const slug = await createFor(OWNER, { title: 'Shared', question: 'where is flooding worst?' });
    const row = await getBySlug(slug);

    expect(row?.title).toBe('Shared');
    expect(row?.question).toBe('where is flooding worst?');
    expect(paramsFor(row!)).toBe('q=where%20is%20flooding%20worst%3F');
  });

  it('stores the question, never the result', async () => {
    const slug = await createFor(OWNER, { title: 'Re-runnable', presetId: 'most-exposed-population' });
    const [row] = await db().select().from(savedAnalysis).where(eq(savedAnalysis.slug, slug));

    // Re-running is cheap; a stored result would go stale the next time the
    // pipeline runs and answer with last year's floodplain.
    expect(Object.keys(row!)).toEqual(
      expect.arrayContaining(['slug', 'userId', 'title', 'presetId', 'question', 'createdAt']),
    );
    expect(Object.keys(row!)).not.toContain('features');
    expect(row!.presetId).toBe('most-exposed-population');
    expect(row!.question).toBeNull();
  });

  it('refuses a row that could never be re-run', async () => {
    await expect(createFor(OWNER, { title: 'Neither' })).rejects.toThrow(/preset or a question/);

    // And the database refuses it too, independently of the code above —
    // which is the point of the check constraint. Asserting on the driver's
    // `constraint` field rather than on a message: it names which rule fired,
    // so this cannot pass because some *other* constraint happened to reject
    // the row.
    const refused = await db()
      .insert(savedAnalysis)
      .values({
        slug: 'both-set',
        userId: OWNER,
        title: 'Both',
        presetId: 'densest',
        question: 'also a question',
      })
      .then(
        () => null,
        (err: unknown) => (err as { cause?: { code?: string; constraint?: string } }).cause ?? err,
      );

    expect(refused, 'the database accepted a row with both a preset and a question').not.toBeNull();
    expect((refused as { code?: string }).code).toBe('23514'); // check_violation
    expect((refused as { constraint?: string }).constraint).toBe('saved_analysis_one_source');
  });
});
