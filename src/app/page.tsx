/**
 * The landing route.
 *
 * All it does is turn the URL and the session into props. The view itself is
 * shared with `/a/[slug]`, so a saved analysis and a fresh one cannot drift
 * apart.
 *
 * There is deliberately no Suspense boundary here, and that is the third time
 * this corner has been rewritten — the history is worth keeping because each
 * version looked correct.
 *
 *   app/loading.tsx     put a boundary above every route beneath it, so Next
 *                       committed the response, status line included, before
 *                       any page had decided what it was. `notFound()` served
 *                       404 content under a 200.
 *   <Suspense> here     fixed the status codes and introduced a subtler fault:
 *                       when the render does not finish before the first
 *                       flush, React streams the fallback and reveals the real
 *                       content with an inline script. With JavaScript
 *                       disabled that script never runs, so the page sits on
 *                       "Working out the answer." for ever — while the answer
 *                       is right there in the HTML, inside a hidden div.
 *   nothing             the answer is rendered before anything is sent.
 *
 * What makes the middle version instructive is that the end-to-end suite was
 * green for it. The render was finishing in time, so React never emitted a
 * fallback, so the property held — by luck. Adding the results table made the
 * render heavier, the flush came first, and a claim the README leads with
 * broke without a line of that claim's code changing.
 *
 * The cost of blocking is real and accepted: a free-text question waits on a
 * model with no skeleton, showing the browser's own loading state instead.
 * That is a worse few seconds for someone with JavaScript, in exchange for the
 * page working at all for someone without it.
 */

import Explorer from '@/components/Explorer';
import { viewer } from '@/lib/session';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; q?: string }>;
}) {
  const [{ preset, q }, me] = await Promise.all([searchParams, viewer()]);
  return <Explorer preset={preset} q={q} me={me} />;
}
