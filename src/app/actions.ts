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
 */

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createFor, deleteFor, pathFor, renameFor } from '@/lib/saved';
import { viewer } from '@/lib/session';

export async function saveAnalysis(form: FormData): Promise<void> {
  const me = await viewer();
  if (!me) redirect('/');

  const presetId = String(form.get('presetId') ?? '').trim();
  const question = String(form.get('question') ?? '').trim();
  if (!presetId && !question) redirect('/');

  const slug = await createFor(me.id, {
    title: String(form.get('title') ?? '').trim() || 'Untitled analysis',
    presetId: presetId || null,
    question: question || null,
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

  const slug = String(form.get('slug') ?? '');
  if (!(await renameFor(me.id, slug, String(form.get('title') ?? '')))) notFound();

  revalidatePath('/saved');
  redirect(pathFor(slug));
}

export async function deleteAnalysis(form: FormData): Promise<void> {
  const me = await viewer();
  if (!me) redirect('/');

  if (!(await deleteFor(me.id, String(form.get('slug') ?? '')))) notFound();

  revalidatePath('/saved');
  redirect('/saved');
}
