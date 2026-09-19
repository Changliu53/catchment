/**
 * What just happened, carried across a redirect.
 *
 * Every write here ends in `redirect()`, so the action that did the work and
 * the page that should say so are two different renders. A confirmation has to
 * survive that gap.
 *
 * It travels as a search parameter rather than a cookie or client state, for
 * one reason: the parameter is on the URL by the time the page renders, so the
 * confirmation is in the server's HTML. It is therefore announced by a screen
 * reader and visible with JavaScript switched off, like the rest of this app.
 * A client-side toast queue would have been neither.
 *
 * The messages live here rather than at the two ends, so the action cannot
 * redirect to a key the page has no text for.
 */

export const FLASH_PARAM = 'done';

export const FLASH = {
  saved: 'Saved. Anyone with the link can open it.',
  renamed: 'Name updated.',
  deleted: 'Deleted.',
} as const;

export type FlashKey = keyof typeof FLASH;

/** The message for a raw query value, or null if it is not one of ours. */
export function flashFor(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  return value in FLASH ? FLASH[value as FlashKey] : null;
}

/**
 * `path` with the flash attached.
 *
 * Note what this is *not* used for: the share link the panel offers to copy is
 * built from the path alone. Handing someone a URL with `?done=saved` on it
 * would make every reader of that link see "Saved." as though they had done
 * it.
 */
export function withFlash<P extends string>(
  path: P,
  key: FlashKey,
): `${P}?${typeof FLASH_PARAM}=${FlashKey}` {
  // Generic in the path so the literal survives. `redirect()` is checked
  // against Next's generated route table, and a plain `string` return would
  // have been rejected there — which is the typed-routes check doing its job
  // rather than something to cast away.
  return `${path}?${FLASH_PARAM}=${key}`;
}
