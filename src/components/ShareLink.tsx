'use client';

/**
 * The link, which is the thing that was made.
 *
 * This panel used to offer Rename and Delete and nothing else, while the
 * sentence that got people to sign in read "get a link you can share". The
 * link existed only in the address bar — so the one promised artefact was the
 * one thing the interface never showed.
 *
 * Three states rather than the usual two, because the middle one is the one
 * everybody forgets:
 *
 *   server HTML   the URL, in a readonly field, selectable and copyable by
 *                 hand. No button, because a Copy button that does nothing is
 *                 worse than no Copy button.
 *   hydrated      the same field plus Copy, which is the fast path.
 *   no clipboard  Safari without a user gesture, an insecure origin, a denied
 *                 permission — the field is selected instead and the label
 *                 says "Press ⌘C", rather than claiming a copy that did not
 *                 happen.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * True once this is running in a browser, false in the server's HTML.
 *
 * `useSyncExternalStore` rather than the usual `useState(false)` plus an
 * effect: the effect version sets state during the commit that just happened,
 * which is a cascading render, and the linter is right to flag it. A store
 * that never changes but reports a different snapshot on each side is exactly
 * what this hook is for, and React reconciles it as part of hydration rather
 * than as a second pass.
 */
const subscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

type State = 'idle' | 'copied' | 'select';

export default function ShareLink({ url }: { url: string }) {
  const field = useRef<HTMLInputElement>(null);
  const enhanced = useHydrated();
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    field.current?.select();
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      // Leave it selected and say so. The reader can finish the job.
      setState('select');
    }
  }

  return (
    <div>
      <label htmlFor="share-link" className="text-slate-500">
        Anyone with this link can open it
      </label>

      <div className="mt-1 flex gap-2">
        <input
          id="share-link"
          ref={field}
          readOnly
          value={url}
          // Selecting the whole thing on focus is the difference between one
          // gesture and a careful drag across a URL that does not wrap.
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 outline-none focus:border-blue-500"
        />

        {enhanced ? (
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded bg-slate-900 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700"
          >
            {state === 'copied' ? 'Copied' : state === 'select' ? 'Press ⌘C' : 'Copy'}
          </button>
        ) : null}
      </div>

      {/* Announced rather than only coloured, since the button's own label is
          what changes and a screen reader would not otherwise revisit it.
          `<output>` carries role=status implicitly, which is one fewer thing
          to keep in sync than the attribute. */}
      <output aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Link copied to the clipboard' : ''}
      </output>
    </div>
  );
}
