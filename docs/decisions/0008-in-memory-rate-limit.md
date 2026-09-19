# 0008 — Rate limiting is in memory and per-instance

**Status:** in force, with the trade-off stated rather than hidden.

## Context

The model tier is the only part of this application that costs money per
request, and it sits behind a public text box with no sign-in. Something has to
bound what a single visitor can spend.

The correct implementation is a shared counter — Redis, Upstash, Vercel KV —
because serverless runs many instances and a per-instance counter is not a
limit on anything global.

## Decision

A `Map` of timestamps in process memory, a sliding one-hour window, ten
questions by default.

On serverless this is per-instance, so the real ceiling is looser than the
configured number by roughly the instance count. That is written into the
module's own header, not just here.

It is acceptable because it is not the control that actually bounds the loss.
The spend limit on the Anthropic account is. The rate limiter's job is to stop
one impatient visitor from burning the budget in a minute; the spend limit is
what stops the budget being burnt at all. A precise rate limiter with no spend
limit would be the dangerous configuration, and it is the one that looks more
professional.

The map is bounded independently: past 10,000 keys it is pruned, because
otherwise it grows once per unique visitor for the life of the instance — a
slow leak in the thing that exists to prevent abuse.

Share links get their own bucket, keyed on the slug rather than the forwarded
IP. A popular share link is many visitors asking one already-decided question,
and rate-limiting them against each other would make a link stop working
because it was shared successfully.

## Alternatives

**Redis or Vercel KV.** Correct, and a network round trip on the request path
plus a service to configure, monitor and pay for, bought for a demo whose real
ceiling is an account-level spend limit. Revisit the moment the spend limit
stops being the binding control — which is the moment this stops being a demo.

**Limit at the edge, in Vercel's firewall.** Global and free of application
code, and it cannot see the tier: it would rate-limit preset clicks and share
links, which cost nothing, at the same rate as model calls.

**No limit, rely on the spend cap alone.** The spend cap is a day ruined rather
than a request refused — it takes the feature down for everyone until someone
notices.

## Consequences

- No external dependency, no round trip, no service to keep alive.
- The advertised limit is a floor, not a ceiling, and the module says so.
- The limiter resets when an instance is recycled, which on a low-traffic demo
  is often.
- Anyone reading this can see the trade-off was chosen. That is most of the
  point of writing it down: an in-memory rate limiter with no comment looks
  identical to one written by someone who did not know better.

## How this is held

`src/lib/__tests__/rate-limit.test.ts` drives the clock explicitly rather than
sleeping: it asserts the window slides, that the retry-after is computed from
the oldest hit in the window rather than from now, and that the map is pruned
rather than growing without bound.

`src/components/Explorer.tsx` picks the bucket key, and the saved-analysis path
is asserted to use the slug — so a shared link cannot be rate-limited into
failure by its own popularity.
