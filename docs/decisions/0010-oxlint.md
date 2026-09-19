# 0010 — oxlint instead of ESLint

**Status:** in force. Forced by a dependency conflict with no clean fix.

## Context

This project is on TypeScript 7. `eslint-config-next` pulls in
typescript-eslint, which carries a supported-version guard and refuses to load
against a TypeScript major it does not know about. So does
`@typescript-eslint/parser` on its own, which rules out assembling a minimal
config by hand.

The obvious workaround is an npm `override` pinning a side-by-side TypeScript 6
for the linter's tree. It does not survive `npm ci`, because `typescript` is a
peer dependency: the override applies to the resolved tree, the peer resolution
picks the root version back up, and the install that works locally fails in CI.

That left three options: pin TypeScript back to 6, lint with nothing, or change
linter.

Pinning TypeScript back is the tail wagging the dog — the compiler is the tool
that does the work here, the linter is the tool that comments on it. Linting
with nothing was briefly the actual state of the repository, which is worth
admitting: the `npm run lint` script existed and did nothing useful, which is
the same failure this project keeps finding everywhere else. A check that
quietly stops checking reports exactly the same green as one that ran.

## Decision

oxlint, configured in `.oxlintrc.json` with the react, nextjs, typescript,
jsx-a11y, promise and import plugins. Correctness rules are errors, suspicious
rules are warnings.

The rules that are off are off for stated reasons, and the reasons are here
rather than in the config, because `.oxlintrc.json` is JSON and JSON has no
comments. That is a real cost of the format and this section is the mitigation:

- `react/react-in-jsx-scope` — predates the automatic JSX runtime.
- `import/no-unassigned-import` — `maplibre-gl/dist/maplibre-gl.css` has to be
  a side-effect import.
- `no-console` — server-side logging is deliberate here, and every call site
  that matters is a diagnostic the production incidents made necessary.
- `react/no-array-index-key` — the lists it fires on are rendered from a
  frozen array in the same render, never reordered.
- `no-shadow`, `no-underscore-dangle` — style, not correctness; they produced
  noise and caught nothing.

Tests, end-to-end specs, config files and scripts relax
`typescript/no-explicit-any`, because a test that asserts what happens with a
deliberately wrong shape has to be able to construct one.

## Alternatives

**Pin TypeScript to 6.** Cheapest, and it gives up the thing that is actually
load-bearing: `noUncheckedIndexedAccess` and strict mode are doing real work in
this codebase, and the compiler is not the component to downgrade to keep a
linter happy.

**`--legacy-peer-deps`.** Tried. It resolved the conflict and pruned `vite`,
which broke the test runner — a linter fix that disabled the tests. Removing
the ESLint packages and installing plainly was the fix, and it is a good
illustration of why peer-dependency escape hatches are not free.

**Biome.** The nearer competitor and a reasonable choice. oxlint won on having
the Next.js and jsx-a11y rule sets, which cover the two things this project
most wants a linter for: a React Server Components mistake, and an
accessibility regression in a UI whose README makes claims about accessibility.

**No linter.** The status quo that prompted this. Rejected on principle: a
lint script that runs nothing is worse than no lint script, because it reports
success.

## Consequences

- Linting is fast enough to be unremarkable, which matters for whether it gets
  run.
- Some ESLint rules have no oxlint equivalent yet. Nothing that was catching
  something here, but the rule set is smaller and that is a real cost.
- One more tool a reader has to recognise. Hence this file.

## How this is held

`npm run lint` runs in CI on every push, and a deploy only happens after it
passes — so this cannot silently revert to the state that prompted it.

The configuration is committed rather than inferred, and every disabled rule
has its reason written down above — which is the part that usually rots, since
a rule switched off with no reason is indistinguishable from one switched off
to make a build pass.
