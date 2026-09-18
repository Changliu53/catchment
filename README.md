# Catchment

Overlay analysis of flood exposure and service access across Harris County, Texas.

Ask a question in plain English; a language model translates it into a
constrained analysis plan, a hardcoded executor runs that plan over precomputed
census-block-group data, and the result is drawn as a thematic map.

Google Maps answers "where is X". It cannot express a relational spatial query
("more than half this area sits in a floodplain *and* no supermarket within a
kilometre") and it does not normalise by population. That gap is what this
project fills.

## Status

Phase 1 of 4: analysis primitives, validation, and tests. No UI yet.

## Design note

The model never emits executable code. It fills a closed schema of six
primitives, which is why model output needs no sanitisation: there is no escape
hatch to sanitise. Correctness lives in the executor, a pure function with no
I/O, tested independently of any model.

## Development

```bash
npm install
npm test
npm run typecheck
```
