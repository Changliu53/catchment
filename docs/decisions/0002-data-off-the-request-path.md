# 0002 — The dataset is loaded once, not queried per request

**Status:** in force.

## Context

The analysis runs over 2,830 census block groups. Every question touches most
of them: a filter, a ranking and a comparison all want the whole table, and the
map needs the geometry of whatever survives.

The default shape for this is a query per request, with the filter pushed into
SQL. That is correct and it is what a growing dataset would need. It is also,
at this size, a network round trip added to every page render in exchange for
work Postgres would do in milliseconds and JavaScript does in single-digit
milliseconds.

There is a second cost specific to the deployment. Neon suspends an idle
compute, and the first query after a suspension waits for it to wake. A visitor
arriving at a demo nobody has opened for an hour would pay that, on the first
page, before anything rendered.

## Decision

The block-group table is fetched once per server instance and memoised as a
promise. Requests read from memory. The database is on the startup path, not
the request path.

The memoised promise clears itself if the fetch rejects, so a transient failure
is retried on the next request rather than cached forever — memoising a
rejection is the version of this that looks like it works and then serves an
error for the life of the instance.

## Alternatives

**Query per request with the filter in SQL.** The right answer at a larger
size, and the thing to change to first. Rejected here because 2,830 rows is
small enough that the round trip dominates the work, and because it puts a cold
compute between a visitor and their first answer.

**Ship the data as a static asset in the bundle.** Removes the database from
the running system entirely. Rejected because the saved-analysis feature needs
Postgres anyway, so this would have added a second source of truth for the same
rows without removing the dependency — and a 2,830-row GeoJSON is not a thing
to put in a JavaScript bundle.

**A revalidating cache keyed on the pipeline's output.** More correct, and the
obvious next step if the pipeline ran on a schedule. It does not: it is run by
hand when the sources update, which is followed by a deploy, which starts new
instances. The memoisation's lifetime already matches the data's.

## Consequences

- A cold Neon compute costs a visitor nothing. The first request after a deploy
  pays the fetch; nothing after it does.
- Memory is bounded by the dataset, not by traffic.
- **This does not scale**, and is written down as a limit rather than left to
  be discovered. Past roughly the size where the whole table stops fitting
  comfortably in an instance's memory — or the moment the data starts changing
  under a running instance — this has to become a query.
- The saved-analysis tables are queried normally, per request. They are small,
  per-user, and their correctness depends on reading what is actually stored.

## How this is held

The integration tests run against a real Postgres rather than a mock, so the
one part that _is_ on the request path is tested against the database's actual
behaviour. The memoisation's error handling has its own unit test: a rejecting
fetch followed by a succeeding one must produce a success, which fails if the
rejected promise is cached.
