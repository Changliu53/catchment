'use client';

/**
 * The confirmation after a write.
 *
 * Server-rendered from a search parameter (see `lib/flash.ts`), so it is in
 * the first response: announced by a screen reader through `role="status"`,
 * and visible with JavaScript switched off. That is the reason it is not a
 * client-side toast queue, which is the usual way to build this and would have
 * been neither of those things.
 *
 * What JavaScript adds, and only adds:
 *
 *  - the flash parameter is stripped from the address bar with
 *    `replaceState`, so a refresh does not replay the confirmation and the URL
 *    the reader might copy is the clean one;
 *  - the toast dismisses itself.
 *
 * Without JavaScript neither happens, and the fallback is honest rather than
 * broken: the dismiss control is a real link back to the same page without the
 * parameter, so it works either way, and the toast is positioned so it covers
 * nothing that matters.
 */

import { useEffect, useState } from 'react';

const DISMISS_AFTER_MS = 5000;

export default function Toast({ message, dismissHref }: { message: string; dismissHref: string }) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    // Drop the parameter without a navigation: re-rendering the page to clear
    // a toast would re-run the analysis underneath it.
    window.history.replaceState(null, '', dismissHref);
    const timer = setTimeout(() => setShown(false), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [dismissHref]);

  if (!shown) return null;

  // `<output>` rather than a div with role=status: same semantics, one fewer
  // attribute that can drift away from the element it describes.
  return (
    <output
      aria-live="polite"
      className="animate-toast-in fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 py-2 pr-2 pl-3.5 text-xs text-white shadow-lg">
        {/* Decorative: the message says what happened. */}
        {/* evenodd, so the tick is punched out of the disc rather than filled
            in with it — nonzero merges the two subpaths into a plain green
            circle, which is what this was until someone looked at it. */}
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 fill-green-400">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
          />
        </svg>

        <span>{message}</span>

        {/* A link, not a button: without JavaScript this is the way out, and
            with it the click lands on a page that no longer has the flash. */}
        <a
          href={dismissHref}
          onClick={(e) => {
            e.preventDefault();
            setShown(false);
          }}
          className="rounded px-1.5 py-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
        >
          Dismiss
        </a>
      </div>
    </output>
  );
}
