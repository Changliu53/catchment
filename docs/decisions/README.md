# Decision records

Each file here holds one decision: what the situation was, what was chosen,
what was rejected and why, and what the choice costs. The README summarises
several of these in a paragraph each. These are the long versions — the
alternatives that were priced and dropped, and the consequences that are still
being paid.

They are written after the fact rather than before. Half of them were forced by
a fault in production, and where that is true the record says so, because "we
chose X" and "X is what was left after Y broke" are different kinds of claim
and only one of them is honest here.

| #                                              | Decision                                                | Forced by a fault |
| ---------------------------------------------- | ------------------------------------------------------- | ----------------- |
| [0001](0001-answer-path.md)                    | Three tiers on the answer path, cheapest first           | no                |
| [0002](0002-data-off-the-request-path.md)      | The dataset is loaded once, not queried per request      | no                |
| [0003](0003-failure-is-a-variant.md)           | Failure is a named variant, not a message                | yes               |
| [0004](0004-no-suspense-above-the-answer.md)   | No Suspense boundary above the answer                    | yes, twice        |
| [0005](0005-accounts-degrade.md)               | Accounts degrade; they do not take the site down         | yes               |
| [0006](0006-maplibre-v5.md)                    | maplibre-gl v5, pinned, with a test that explains it     | yes               |
| [0007](0007-one-field-dictionary.md)           | One field dictionary generates the prompt and the schema | no                |
| [0008](0008-in-memory-rate-limit.md)           | Rate limiting is in memory and per-instance              | no                |
| [0009](0009-derived-data-in-git.md)            | The built dataset is committed, with a tripwire          | no                |
| [0010](0010-oxlint.md)                         | oxlint instead of ESLint                                 | yes               |

## Format

Status, Context, Decision, Alternatives, Consequences, and how the decision is
held — the test, assertion or check that fails if someone quietly undoes it. A
decision with nothing holding it is a comment, and comments do not fail.
