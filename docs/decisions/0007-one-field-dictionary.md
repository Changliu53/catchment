# 0007 — One field dictionary generates the prompt and the schema

**Status:** in force.

## Context

A field the model can reason about — `median_income`, `flood_pct`,
`grocery_m` — appears in at least five places:

- the prose in the system prompt that tells the model the field exists;
- the tool schema's enum, which is what the API will actually accept;
- the validator, which decides whether a returned plan is runnable;
- the legend and table headers, which need a human label;
- the formatter, which decides whether it is a dollar amount, a percentage or a
  distance.

Keeping five lists in step by hand has one failure mode and it is silent: the
prompt still advertises a field that was renamed six commits ago. The model
dutifully uses the name it was given, the tool schema rejects it, and the
visitor gets a model failure for a question the system can answer perfectly
well. Nothing type-checks that gap, because the prompt is a string.

## Decision

One dictionary in `src/lib/schema.ts`. Each field is a `FieldSpec` carrying its
description, its human label and its format function. The prompt text, the tool
schema's enum, the validator's accepted set, the labels and the formatting are
all derived from it.

A field is added in one place. A field is renamed in one place. A field that
does not exist cannot be advertised, because the advertisement is generated
from the same object the validator reads.

## Alternatives

**Keep the prompt hand-written for tone.** The temptation is real — generated
prose reads like generated prose. Rejected: the descriptions themselves are
hand-written, per field, in the dictionary. What is generated is only the
assembly, which is where drift happens.

**Generate the dictionary from the database schema.** Removes another source of
drift, and adds a build step, and the useful content is exactly the part the
database does not have: what the field means, what unit it is in, and how to
say it to a reader.

**A test that asserts the lists match.** The version of this that most codebases
have. It catches the drift after it is written rather than making it
unwritable, and it is one more list.

## Consequences

- The failure where a prompt advertises a field that no longer exists is
  structurally impossible rather than tested against.
- The prompt is assembled from data, so reading it means reading the assembly
  plus the dictionary rather than reading a string. That is a real loss of
  legibility, and it is why `systemPrompt()` is exported: a test renders it and
  asserts against the rendered text, so what the model receives is inspectable
  rather than inferred.
- Field metadata that is only interesting to one consumer still lives in the
  shared object, which makes `FieldSpec` slightly wider than any one caller
  needs.

## How this is held

`src/lib/__tests__/prompt.test.ts` renders the prompt and the tool schema and
checks them against the dictionary in **both** directions: every field appears
in the prompt with its unit and range, and every field the prompt names is a
field that exists. The one-directional version of that test is the one that
would have passed while the bug was live.

It also pins the things that have to agree across three files and cannot be
type-checked into agreement — the step ceiling appears in the prompt as prose,
in the tool schema as `maxItems`, and in the validator as a number — and that
the four field-valued parameters (`field`, `measure`, `split_on`, `color_by`)
are all constrained to the dictionary, since one of them left as a free string
is an enum that does not constrain.

`src/lib/__tests__/format.test.ts` covers the other end: every field has a
label and a format, and formatting a null produces the no-value dash rather
than `$0` — the coercion bug this project has already shipped once, on the map.
