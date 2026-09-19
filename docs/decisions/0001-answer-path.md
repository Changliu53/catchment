# 0001 — Three tiers on the answer path, cheapest first

**Status:** in force.

## Context

Every question a visitor asks could be turned into an analysis plan by a
language model. That is the obvious design, and it is wrong for this project in
three separate ways.

It costs money per visitor, and a public demo has no way of knowing who is on
the other end. It is slow: a model call is one to three seconds before any
analysis has started, on a page whose entire claim is that the answer arrives in
the first response. And it makes the project undemonstrable without an API key —
a reader who clones the repository, or an employer who opens the deployed site
on a day the key has expired, sees nothing work.

The last one matters most. The interesting part of this codebase is the
executor and the validator, neither of which involves a model. Putting a model
call in front of them means a failure in the least interesting layer hides all
the rest.

## Decision

Three tiers, tried in order, and most traffic never leaves the first.

1. **Presets.** Each preset question ships with the plan it resolves to, as
   data in the build. Clicking one costs no model call, no API key and no
   rate-limit budget. The plan is still run through the validator before it
   executes — a preset is not trusted for being ours.
2. **Cache.** A normalised question (lowercased, whitespace collapsed, trailing
   punctuation dropped) is looked up in an LRU of 500 plans. Two visitors who
   ask the same thing in different words still pay twice; that is accepted. The
   win is the same question repeated, which in a demo is most of the traffic —
   people retype, refresh, and open share links.
3. **The model**, once the rate limiter agrees, and only to produce a plan. It
   never sees a row of data and never returns a number.

## Alternatives

**Model on every question.** Rejected above. Worth noting what it would have
bought: nothing, since a preset's plan is the same object a model would have
had to produce.

**Semantic caching — embed the question, match on distance.** This would have
caught the paraphrase case the LRU misses. Rejected on the cost of being wrong:
a near-miss serves an answer to a question the visitor did not ask, and the
page presents plans as what was actually run. An exact-match cache can only be
stale, never dishonest.

**Cache the answer rather than the plan.** Smaller and faster, and wrong
whenever the pipeline is re-run: the cached numbers would outlive the data they
came from. The plan is the durable artefact; the numbers are recomputed every
time, which is also what makes a share link honest.

## Consequences

- The demo works with no API key at all, in a reduced form that is honest about
  being reduced: presets answer, free text says why it cannot.
- The presets do double duty as the model's few-shot examples, which keeps them
  from drifting away from what the system can actually do. One of them is
  deliberately a question the system **cannot** answer — a model shown only
  successes learns that an answer is always required, and starts inventing
  them.
- The cache lives in process memory, so on serverless it is per-instance. See
  [0008](0008-in-memory-rate-limit.md) for the same trade-off made explicitly.

## How this is held

`src/lib/__tests__/presets.test.ts` validates every shipped preset plan against
the same validator a model's output goes through, so a preset cannot encode a
plan the system would reject from anyone else. `src/lib/__tests__/answer.test.ts`
asserts the tier order directly: a preset resolves with the model client
mocked to throw, and a repeated question makes exactly one call.

The preset branch also validates at runtime, not only in the test, and reports
`unsupported` rather than crashing if a shipped plan ever fails to validate.
