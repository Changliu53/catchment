/**
 * A shared analysis.
 *
 * Public on purpose: a share link that needs an account is not a share link,
 * and what is stored is a question over public census data.
 *
 * The saved row holds the question, not the answer, so opening this re-runs
 * the analysis against whatever the data says now. That is stated on the page
 * rather than left as a surprise — a reader should not think they are seeing
 * the numbers the sender saw if the pipeline has been re-run since.
 *
 * Two things happen here, and their order is the whole design. The row lookup
 * is awaited by the page itself, so a slug that does not resolve is a real 404
 * — nothing has been flushed yet, and the status line is still ours to set.
 * Only then does the analysis, which may wait on a model, go inside a Suspense
 * boundary. A `loading.tsx` would have inverted that: a boundary above the
 * route commits the response before the page can answer, and a dead share link
 * returns 200 with 404 content.
 */

import { notFound } from 'next/navigation';
import { Suspense, cache } from 'react';

import Explorer from '@/components/Explorer';
import Skeleton from '@/components/Skeleton';
import { accountsEnabled } from '@/lib/auth';
import { getBySlug, ownedBy } from '@/lib/saved';
import { viewer } from '@/lib/session';

/**
 * One lookup per request, shared by the metadata and the page.
 *
 * The guard is here rather than in `lib/saved`, because it is a fact about the
 * deployment rather than about the data: where accounts are not configured,
 * nothing could ever have created a share link, so "not found" is true. It
 * also keeps this route from querying a schema that was never migrated —
 * DATABASE_URL alone does not mean the saved-analysis tables exist, since this
 * app uses that same database for the block-group data.
 */
const load = cache(async (slug: string) => (accountsEnabled() ? getBySlug(slug) : null));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const row = await load((await params).slug);
  if (!row) return { title: 'Not found — Catchment' };

  return {
    title: `${row.title} — Catchment`,
    description: 'A saved analysis of flood exposure and service access in Harris County, Texas.',
  };
}

export default async function SharedAnalysis({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [row, me] = await Promise.all([load(slug), viewer()]);
  if (!row) notFound();

  return (
    <Suspense key={slug} fallback={<Skeleton />}>
      <Explorer
        preset={row.presetId ?? undefined}
        q={row.question ?? undefined}
        me={me}
        saved={{
          slug: row.slug,
          title: row.title,
          mine: me ? await ownedBy(row.slug, me.id) : false,
        }}
      />
    </Suspense>
  );
}
