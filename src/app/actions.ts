'use server';

/**
 * Everything that writes.
 *
 * Each action re-reads the session itself rather than trusting anything the
 * form sent. A hidden input saying who you are is a suggestion, not a fact,
 * and a Server Action is a public endpoint whatever the button looked like.
 *
 * Ownership is never checked here either. It is a condition inside the query
 * (see `lib/saved.ts`), so "not yours" and "does not exist" are the same
 * answer — and both come back as 404, which is the honest response to a slug
 * the asker has no business knowing about.
 *
 * They take a bare FormData, which is what `<form action={...}>` passes. That
 * keeps saving, renaming and deleting working with JavaScript switched off,
 * like the rest of the page.
 *
 * And the FormData is parsed by Zod before anything reaches the database. That
 * was missing, and the omission was inconsistent in a way worth naming: every
 * payload crossing into the executor is re-parsed at the boundary, because a
 * model's output is not trusted — but the boundary where a *person* writes to
 * the database had no schema at all. The concrete cost was a question longer
 * than the analysis will accept: it saved fine, and then its share link showed
 * "question too long" to every reader, for ever, with no way to fix it from
 * the interface. Anything stored here has to be answerable, so the limit that
 * governs asking governs saving too.
 */

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { MAX_QUESTION_LENGTH } from '@/lib/answer';
import { createFor, deleteFor, pathFor, renameFor } from '@/lib/saved';
import { viewer } from '@/lib/session';

/** Long enough for a sentence, short enough to render in a list row. */
const MAX_TITLE_LENGTH = 120;

const title = z
  .string()
  .trim()
  .max(MAX_TITLE_LENGTH)
  .transform((value) => value || 'Untitled analysis');

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]{6,32}$/);

const saveInput = z
  .object({
    title,
    presetId: z.string().trim().max(64).optional(),
    // The same ceiling the analysis enforces. A saved question that cannot be
    // asked is a link that can never answer.
    question: z.string().trim().max(MAX_QUESTION_LENGTH).optional(),
  })
  .refine((v) => Boolean(v.presetId) !== Boolean(v.question), {
    message: 'exactly one of presetId or question',
  });

const renameInput = z.object({ slug, title: z.string().trim().min(1).max(MAX_TITLE_LENGTH) });
const deleteInput = z.object({ slug });

/** FormData as a plain object, so Zod can speak about it. */
function fields(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  return out;
}

export async function saveAnalysis(form: FormData): Promise<void> {
  const me = await viewer();
  if (!me) redirect('/');

  const parsed = saveInput.safeParse(fields(form));
  // Back to the map rather than an error page: every way this can fail is
  // something the interface should not have allowed, so there is nothing for
  // the reader to correct.
  if (!parsed.success) redirect('/');

  const slug = await createFor(me.id, {
    title: parsed.data.title,
    presetId: parsed.data.presetId ?? null,
    question: parsed.data.question ?? null,
  });

  revalidatePath('/saved');
  // Straight to the share link, because that link is the thing being made.
  // Landing back on the same map with a toast would leave the reader to go
  // looking for the URL they just created.
  redirect(pathFor(slug));
}

export async function renameAnalysis(form: FormData): Promise<void> {
  const me = await viewer();
  if (!me) redirect('/');

  const parsed = renameInput.safeParse(fields(form));
  if (!parsed.success) notFound();

  if (!(await renameFor(me.id, parsed.data.slug, parsed.data.title))) notFound();

  revalidatePath('/saved');
  redirect(pathFor(parsed.data.slug));
}

export async function deleteAnalysis(form: FormData): Promise<void> {
  const me = await viewer();
  if (!me) redirect('/');

  const parsed = deleteInput.safeParse(fields(form));
  if (!parsed.success) notFound();

  if (!(await deleteFor(me.id, parsed.data.slug))) notFound();

  revalidatePath('/saved');
  redirect('/saved');
}
