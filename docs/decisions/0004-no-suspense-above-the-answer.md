# 0004 — No Suspense boundary above the answer

**Status:** in force. Forced by a fault, twice, in opposite directions.

## Context

This corner has been written three times. Each version looked correct, and the
first two were each broken by a property the third one holds.

### Version one: `app/loading.tsx`

The routing convention. It puts a Suspense boundary above **every** route
beneath it, which means Next commits the response — status line included —
before any page has decided what it is.

So `notFound()` rendered a 404 page under a **200**, and `redirect()` became a
client-side hop instead of a 307. In a browser this is invisible: the right
page appears at the right URL. To a crawler, a link checker or an unfurler it
is wrong, and for a product whose output is a URL people paste into other
products, that is most of the audience.

### Version two: `<Suspense>` inside the page

Fixed the status codes: the boundary sat below the lookup that decides them, so
the row was awaited before anything was flushed.

It introduced a subtler fault. When a render does not finish before React's
first flush, React streams the fallback and reveals the real content with an
inline script. With JavaScript disabled that script never runs — so the page
sits on "Working out the answer." for ever, while the answer is right there in
the HTML, inside a hidden div.

The end-to-end suite was green for this the entire time. The render was
finishing before the flush, so React never emitted a fallback, so the property
held — by luck rather than by construction. Adding the results table made the
render heavier, the flush came first, and a claim the README leads with broke
without a line of that claim's code changing.

## Decision

No Suspense boundary on either route. The page awaits the analysis and renders
it; the first byte sent is the finished document.

## Alternatives

**Keep the boundary and assert against the fallback.** The test that now exists
would have caught this. It does not fix it: the fallback is genuinely the only
thing a no-JavaScript reader would ever see once the render is slow enough, and
"slow enough" is a function of how much the page renders, which changes.

**`<noscript>` with the content duplicated inside it.** Two renders of the same
answer in one document, which is also a second place for them to disagree.

**Stream, and make the fallback itself useful.** The fallback cannot contain
the answer — that is what it is standing in for.

## Consequences

- **The cost is real and accepted.** A free-text question waits on a model call
  with no skeleton, showing the browser's own loading state. That is a worse
  few seconds for a reader with JavaScript, in exchange for the page working at
  all for a reader without it.
- Presets and share links, which are most of the traffic, do not pay it: they
  resolve without a model call and render immediately.
- Time to first byte is now the analysis time. If the model layer ever became
  the common path rather than the third tier, this would have to be revisited —
  and the answer then would be to move the slow part to a second request, not
  to put the boundary back.

## How this is held

`e2e/table.spec.ts` loads the page with JavaScript disabled and asserts the
results are present and readable. The no-JavaScript assertion is now **negative**
— `expect(page.getByText('Working out the answer.')).toHaveCount(0)` — because
asserting the answer eventually appears is exactly the test that passed while
this was broken.

`e2e/accounts.spec.ts` asserts the status codes at the protocol level, since a
browser cannot tell a 200 from a 404 by looking at the page.
