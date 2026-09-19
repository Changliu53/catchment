/**
 * Analyses people kept.
 *
 * Every function here takes the owner's id and puts it in the WHERE clause.
 * That is the whole authorization model, and it is deliberate: the alternative
 * — fetch by slug, then compare `row.userId` to the session in application
 * code — works right up until one caller forgets the second half, and that
 * caller is a data leak that returns 200.
 *
 * Reading a shared analysis is the one exception, and it is public on purpose:
 * a share link that needs an account is not a share link. What is stored is a
 * question over public census data, not anything private, and `getBySlug` is
 * the only function that does not take a user.
 */

import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { savedAnalysis } from '@/db/schema';
import { PRESETS } from '@/lib/presets';

export interface SavedAnalysis {
  slug: string;
  title: string;
  presetId: string | null;
  question: string | null;
  createdAt: Date;
}

/**
 * Short, URL-safe, and unambiguous when read aloud or typed: no `l`, no `1`,
 * no `0`, no `o`.
 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/**
 * Largest multiple of the alphabet size that fits in a byte.
 *
 * `byte % 33` is the obvious way to pick a character and it is biased: 256 is
 * not a multiple of 33, so the first 256 % 33 = 25 letters come up slightly
 * more often than the rest. Nothing here depends on uniformity — a slug is not
 * a secret — but a biased random function is the kind of detail that is free
 * to get right and awkward to explain.
 */
const CEILING = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function newSlugForTest(length = 10): string {
  return newSlug(length);
}

function newSlug(length = 10): string {
  let out = '';
  while (out.length < length) {
    // Rejection sampling: draw, discard anything in the uneven tail, repeat.
    // Each byte has a 25/256 chance of being discarded, so this loops about
    // 1.1 times per character.
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte >= CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * The URL someone actually pastes.
 *
 * Typed as a template literal rather than `string`, so `typedRoutes` can still
 * check it against the real `/a/[slug]` route: this stays type-safe without a
 * cast, and renaming the route breaks here rather than at runtime.
 */
export function pathFor(slug: string): `/a/${string}` {
  return `/a/${slug}`;
}

/** Turns a saved row back into the query that produced it. */
export function paramsFor(row: Pick<SavedAnalysis, 'presetId' | 'question'>): string {
  return row.presetId
    ? `preset=${encodeURIComponent(row.presetId)}`
    : `q=${encodeURIComponent(row.question ?? '')}`;
}

/**
 * The question behind a saved row, in the words someone would recognise.
 *
 * Not `paramsFor`. That builds a URL and is percent-encoded by definition, and
 * it was briefly what the saved list displayed — so a question someone typed
 * came back as `q=which%20neighborhood%20having%20the%20least%20flood…`. Fine
 * in an address bar, unreadable in a list of your own work.
 *
 * A preset resolves to its wording rather than its id for the same reason:
 * `income-flood-gap` is a key, not a question.
 */
export function questionFor(row: Pick<SavedAnalysis, 'presetId' | 'question'>): string {
  if (row.question) return row.question;

  const preset = PRESETS.find((p) => p.id === row.presetId);
  return preset?.question ?? row.presetId ?? '';
}

export async function listForUser(userId: string): Promise<SavedAnalysis[]> {
  return db()
    .select({
      slug: savedAnalysis.slug,
      title: savedAnalysis.title,
      presetId: savedAnalysis.presetId,
      question: savedAnalysis.question,
      createdAt: savedAnalysis.createdAt,
    })
    .from(savedAnalysis)
    .where(eq(savedAnalysis.userId, userId))
    .orderBy(desc(savedAnalysis.createdAt));
}

/**
 * Public: anyone holding the link can read it.
 *
 * This module assumes a database that has been migrated, and says nothing
 * about whether the deployment it is running on has one — that is the route's
 * question, and `/a/[slug]` answers it before calling here. Keeping the check
 * out of the data layer is what lets the integration tests point this straight
 * at a Postgres without also having to satisfy the auth configuration.
 */
export async function getBySlug(slug: string): Promise<SavedAnalysis | null> {
  const [row] = await db()
    .select({
      slug: savedAnalysis.slug,
      title: savedAnalysis.title,
      presetId: savedAnalysis.presetId,
      question: savedAnalysis.question,
      createdAt: savedAnalysis.createdAt,
    })
    .from(savedAnalysis)
    .where(eq(savedAnalysis.slug, slug))
    .limit(1);

  return row ?? null;
}

/** Whether this user owns this slug. Used to decide what to offer, not to guard. */
export async function ownedBy(slug: string, userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ slug: savedAnalysis.slug })
    .from(savedAnalysis)
    .where(and(eq(savedAnalysis.slug, slug), eq(savedAnalysis.userId, userId)))
    .limit(1);

  return Boolean(row);
}

export async function createFor(
  userId: string,
  input: { title: string; presetId?: string | null; question?: string | null },
): Promise<string> {
  // Exactly one source, matching the check constraint the database enforces.
  // Sending both would be refused there; normalising here means the caller
  // gets a clear failure rather than a constraint violation.
  const presetId = input.presetId?.trim() || null;
  const question = presetId ? null : input.question?.trim() || null;
  if (!presetId && !question) {
    throw new Error('a saved analysis needs either a preset or a question');
  }

  const slug = newSlug();
  await db()
    .insert(savedAnalysis)
    .values({
      slug,
      userId,
      title: input.title.trim().slice(0, 120) || 'Untitled analysis',
      presetId,
      question,
    });

  return slug;
}

/** Returns false when the row does not exist *or* is not theirs — same answer
 * either way, so a probe cannot tell the difference. */
export async function renameFor(userId: string, slug: string, title: string): Promise<boolean> {
  const clean = title.trim().slice(0, 120);
  if (!clean) return false;

  const rows = await db()
    .update(savedAnalysis)
    .set({ title: clean })
    .where(and(eq(savedAnalysis.slug, slug), eq(savedAnalysis.userId, userId)))
    .returning({ slug: savedAnalysis.slug });

  return rows.length > 0;
}

export async function deleteFor(userId: string, slug: string): Promise<boolean> {
  const rows = await db()
    .delete(savedAnalysis)
    .where(and(eq(savedAnalysis.slug, slug), eq(savedAnalysis.userId, userId)))
    .returning({ slug: savedAnalysis.slug });

  return rows.length > 0;
}
