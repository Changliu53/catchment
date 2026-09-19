# 0006 — maplibre-gl v5, pinned, with a test that explains it

**Status:** in force. Forced by a fault.

## Context

The map rendered nothing in production and everything in development.

Every check that could be run from outside passed. The container had a size.
The sources were present. The layers were present, and on top. The colour
expression was correct. No error was thrown, and the only trace anywhere was a
single console line about a module script served with the wrong MIME type.

maplibre-gl v6 is ESM-only and loads its Web Worker as a separate chunk, via
`new Worker(new URL(...))`. The bundler did not emit that URL into the deployed
build, so the worker request fell back to the document root and came back as
the 404 page — HTML, served as HTML, to something expecting a module script.

That worker is what turns GeoJSON into renderable tiles. Without it the map is
a correctly configured, fully initialised, completely empty canvas.

`next dev` served the worker without complaint, which is why this reached
production: the failure does not exist in the development server.

## Decision

Pin maplibre-gl to v5, whose UMD build inlines the worker as a Blob — nothing
to resolve, nothing to 404 — and write down why at the import site rather than
in a changelog nobody reads.

The end-to-end suite runs against `next build && next start`, not against
`next dev`, because that is the only configuration in which this class of
failure reproduces at all.

## Alternatives

**Fix the bundling.** The right long-term answer, and it is a bet on a
Next/Turbopack interaction being configured correctly and staying that way,
guarding a failure mode with no symptom. Revisit when v6's worker loading is
something the framework handles rather than something that happens to work.

**Copy the worker into `public/` and point at it.** Works, and hard-codes a
path into a dependency's internals that the dependency is free to change.

**Notice it in code review.** This is the version that failed. The code was
correct; the deployment was not.

## Consequences

- A pinned major version that will eventually need lifting, with the reason
  attached so the person lifting it knows what to check.
- The e2e suite is slower, because it builds. That cost bought the only
  environment where the bug exists.

## How this is held

Two things, because one of them is not enough.

A unit test asserts how `maplibre-gl` packages its worker — it fails if a
version bump changes the packaging, without needing a browser.

`e2e/map.spec.ts` asks the map instance itself what it actually rendered,
because the DOM cannot tell the difference. Next to it is a **negative
control**: a spec that removes the worker deliberately and asserts the probe
goes to zero. A regression test that has never failed is a guess about what it
measures; this one reproduces the original fault on demand.
