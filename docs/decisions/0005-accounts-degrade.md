# 0005 — Accounts degrade; they do not take the site down

**Status:** in force. Forced by a fault.

## Context

Accounts are optional. The analysis, the map, the presets and the share-link
_reader_ all work without one, and the deployment should be able to run with no
authentication configured at all.

The predicate for "are accounts on" was `is DATABASE_URL set`. Reasonable in
general. Wrong here, because the block-group data lives in Postgres too — so
**every** deployment has a connection string, and accounts switched themselves
on in an environment that had none of the rest of the configuration.

Better Auth then refused to start without a secret, and that error came out of
the session read. The session read happens on every page. Every route returned
500, including the landing page, which needs no account at all. An optional
feature took down the site's required one.

### The first diagnosis was wrong

Worth recording, because the wrong answer was more plausible than the right
one. The visible error in the log was `relation "saved_analysis" does not
exist`, which looks exactly like a migration that never ran, and a migration
that never ran was in fact also true. It was not the cause: that line came from
a share-link request in the same batch of log lines.

What found it was requesting only the landing page and reading the log for that
one request. `BetterAuthError: You are using the default secret`.

## Decision

Two changes, either of which would have prevented the outage, and both are
kept because they fail differently.

**The predicate names what it needs.** `missingAuthConfig()` returns the list
of variables that are absent out of the four accounts actually require. Empty
list, accounts are on. Non-empty, accounts are off and the page can say which
ones are missing. `DATABASE_URL` alone no longer implies anything.

**`viewer()` never throws.** The one call made on every page treats any failure
as "signed out". A reader who is not signed in and a reader whose session could
not be read get the same page, which is the correct page for both.

## Alternatives

**An explicit `ACCOUNTS_ENABLED` flag.** Simpler to reason about and one more
thing to get wrong: a deployment with every credential correctly set and the
flag unset is silently signed out, with nothing to point at. Deriving the
answer from the configuration that is actually required means the predicate
cannot disagree with reality.

**Let it throw and fix the configuration.** This is what the outage was. The
configuration was fixed; the failure mode was not, and the next missing
variable would have done the same thing.

**Catch at the route level.** Every route would need it, and the one that
forgets is the one that breaks.

## Consequences

- A half-configured deployment serves the analysis and says accounts are
  unavailable, instead of serving 500 to everyone.
- A genuinely broken session — a database that is up but refusing connections —
  looks to the reader like being signed out. That is the intended trade, and it
  is why the sign-in button reports a failure rather than hanging; see
  `e2e/outage.spec.ts`.
- The share route checks the same predicate before it queries, because
  `DATABASE_URL` being present does not mean the saved-analysis tables were
  ever migrated — the app uses that same database for the block-group data.

## How this is held

`e2e/degraded.spec.ts` runs a production build in exactly the environment that
caused the outage: a connection string and nothing else. It asserts that every
public route answers and that none answers 500. Reverting either fix turns it
red — which was checked, not assumed.

`e2e/outage.spec.ts` runs the other half: accounts fully configured, database
refusing connections, sign-in must report the failure rather than hang.
