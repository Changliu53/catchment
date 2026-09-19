# 0003 — Failure is a named variant, not a message

**Status:** in force. Forced by a fault.

## Context

An earlier version returned `{ ok: false, error: string }`. Everything that had
to react to a failure — the JSON API choosing a status code, the page choosing
a panel, the client deciding whether to offer a retry — did so by reading that
string, or by not reading it and treating every failure the same.

It was the second one. A wrong model ID and a rejected API key both surfaced to
the visitor as "network error", pointing at the network, which was fine. Two
different configuration mistakes, one useless message, and the message named
the one subsystem that was working.

The same shape produced a worse version of itself in production. `DATABASE_URL`
was set on Vercel _after_ the build that was serving traffic, so the running
build did not have it. The symptom was a data-loading failure. The actual
mistake — environment variables added after a build are not picked up until the
next one — is invisible from that symptom, and is the single most common way to
get this wrong on that platform.

## Decision

Every way the analysis can fail is a named variant of a discriminated union:
`unsupported`, `rate-limited`, `model-failed`, `data-unavailable`. A caller
switches on the tag. Nothing parses a string to work out what happened.

Each variant carries what its readers need rather than a flattened message:
`rate-limited` carries the retry-after seconds, `unsupported` carries both a
reason and a suggestion, because "I cannot answer that" without "try this
instead" is a dead end on a page whose whole invitation is to type a question.

The JSON API maps each variant onto a status code. The page maps each onto a
panel. Neither knows about the other's mapping, and adding a variant makes both
mappings fail to compile until they handle it.

Messages name the actual mistake where the mistake is knowable. The missing
`DATABASE_URL` case says which variable is missing _and_ that a variable added
after a build is not picked up until the next one.

## Alternatives

**Error subclasses and `instanceof`.** Works, and loses the exhaustiveness: a
missing branch in a `switch` over subclasses is not a compile error, and the
reason for this change was a missing branch.

**Error codes as string constants.** Most of the benefit, none of the payload
typing — `rate-limited` and `unsupported` carry different fields, and a shared
shape would make both of them optional everywhere.

**Throwing.** Rejected because these are not exceptional. A question the system
cannot answer is an ordinary outcome of asking a question, and the page has a
designed state for it.

## Consequences

- Adding a failure mode is a compile error at every site that handles failure,
  which is the point.
- Status codes are a property of the variant rather than a guess at the call
  site, so the API and the page cannot disagree about what a failure was.
- A little more ceremony at the throw site: a function that fails has to say
  which way.

## How this is held

`src/lib/__tests__/answer.test.ts` asserts a variant per failure mode, including
that a rate-limited result carries a retry-after and that an unsupported one
carries a suggestion. `e2e/degraded.spec.ts` runs a deployment with a
connection string and nothing else, and asserts the page names the missing
configuration rather than showing a generic failure.
