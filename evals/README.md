# Evaluating the model layer

The model's only job here is translation: an English question becomes a plan in
a closed schema. That makes it testable in a way most model-backed features are
not — there is a right answer, or at least a set of wrong ones, and judging it
does not require judging prose.

```bash
ANTHROPIC_API_KEY=... npm run eval
npm run eval -- --tag near-miss
npm run eval -- --threshold 0.9
```

## What is being measured

Two different things, and the second one is the point.

**Does the plan validate?** A plan the validator rejects is a visible failure:
the visitor sees an error. Cheap to detect, and the application already handles
it.

**Does the plan answer the question that was asked?** A plan that validates and
answers a _different_ question is the expensive failure, because nothing
downstream can tell. The page will run it, draw it, caption it, and hand the
visitor a share link.

Most of the corpus is aimed at the second. Several cases exist only to catch one
specific near-miss:

| Case                | The wrong answer it catches                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `five-hundred-year` | the 100-year floodplain when the question said the 500-year zone — not a subset, and the understatement Harvey made famous |
| `income-under-40k`  | `40` instead of `40000`, which is inside the plausible range so the semantic validator cannot see it                       |
| `flood-70-percent`  | `70` instead of `0.7`                                                                                                      |
| `densest`           | total population when the question said per square kilometre                                                               |
| `grocery-not-park`  | parks, for a question about food deserts                                                                                   |
| `commute-time`      | straight-line distance offered as an answer about driving                                                                  |

Eight of the thirty cases are refusals. A corpus of answerable questions
measures willingness, not judgement — and the failure mode that matters here is
a confident wrong answer, which only a refusal case can catch. Refusals are also
graded on being _usable_: a decline with no suggested alternative is a dead end
on a page whose whole invitation is to type a question.

## Why expectations are structural

Many different plans answer "the poorest flood-exposed neighbourhoods"
correctly. Step order varies, `n` varies, the title is free text. An
exact-match corpus would fail on differences that are not mistakes, and an eval
suite that cries wolf is an eval suite that gets switched off.

So a case states what must be true: which operations appear and in what
relative order, which fields must be referenced, which fields must **not** be,
and — where the shape cannot express it — a predicate.

`fieldsUsed` is load-bearing here. `flood_exposure` has no field parameter and
is entirely about `flood_pct`; `resource_gap` names a point-of-interest type
rather than a distance column. Without resolving those, the near-miss cases
would never fire.

## Why this is not on the push path

A model call per push is a bill that grows with commit frequency, a third-party
dependency inside the gate that decides whether code ships, and — because the
model is non-deterministic — a build that can go red for reasons the commit did
not cause. A CI job that fails on its own teaches people to ignore red, which
costs more than the eval is worth.

What does run on every push is `src/lib/__tests__/evals.test.ts`: it calls no
model, and it checks that the corpus is well-formed (every operation and every
field covered, ids unique, no duplicate questions, every refusal case carrying
a stated reason) and that **the grader actually discriminates**.

That second half matters more than it sounds. An eval suite scoring 100% on a
broken grader looks identical to one scoring 100% on a working model. So the
grader is fed hand-written plans that are deliberately wrong — the right shape
with the wrong number, the right steps in the wrong order, a refusal of an
answerable question — and asserted to reject each one. The discrimination was
checked by breaking the grader on purpose and watching eight of those tests go
red, which is the only way to know an assertion is doing work.

The live run belongs on a schedule and on demand, where a drop in the score is
information rather than a blocked deploy.

## Files

| File       | What it is                                                            |
| ---------- | --------------------------------------------------------------------- |
| `cases.ts` | the corpus, and `fieldsUsed`                                          |
| `grade.ts` | pure grading and scoring — no model, no network, unit-tested offline  |
| `run.ts`   | the live runner: one call per case, sequential, with a pass threshold |
