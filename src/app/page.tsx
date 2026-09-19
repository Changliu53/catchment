/**
 * The landing route.
 *
 * All it does is turn the URL and the session into props. The view itself is
 * shared with `/a/[slug]`, so a saved analysis and a fresh one cannot drift
 * apart.
 *
 * The Suspense boundary is here rather than in an `app/loading.tsx`. At the
 * app root that file wraps every route beneath it, which commits the response
 * status before any page has decided what it is — see `components/Skeleton`.
 * Written explicitly, the boundary sits around the one slow thing: a free-text
 * question waits on a model, and the reader gets the page's shape immediately
 * instead of a blank tab.
 */

import { Suspense } from 'react';

import Explorer from '@/components/Explorer';
import Skeleton from '@/components/Skeleton';
import { viewer } from '@/lib/session';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; q?: string }>;
}) {
  const [{ preset, q }, me] = await Promise.all([searchParams, viewer()]);

  return (
    // Keyed on the question: without this React keeps the resolved boundary
    // mounted across a navigation to a different answer, and the old result
    // stays on screen while the new one is computed.
    <Suspense key={`${preset ?? ''}|${q ?? ''}`} fallback={<Skeleton />}>
      <Explorer preset={preset} q={q} me={me} />
    </Suspense>
  );
}
