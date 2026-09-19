# 0009 — The built dataset is committed, with a tripwire

**Status:** in force, with a stated condition for revisiting.

## Context

`build/block_groups.csv.gz` is 3.6 MB and it is in the repository. It is a
build artefact: the Python pipeline produces it from Census TIGER/Line, ACS,
FEMA NFHL and an Overpass extract, and `pipeline/load_postgis.py` streams it
into Postgres.

Committing a build artefact is a smell, and it should be treated as one rather
than waved past. What follows is the case for the exception, measured.

**What is in it.** 2,830 rows, 12 columns, 10.4 MB uncompressed. 98% of that is
geometry: 8.4 MB of full-precision `geom` and 1.7 MB of `geom_simple`. The ten
scalar columns together are 190 KB. There is no fat to trim — this is a
geospatial dataset and the geometry is the payload. Both geometry columns earn
their place: `geom_simple` is what the application serves, and `geom` is what
the load-time validation measures the county's area against.

**What it replaces.** Without it, reproducing the database means downloading
roughly 2 GB of source data — a national TIGER/Line shapefile, an ACS table, a
FEMA flood layer, an Overpass query — and running four pipeline stages that
take tens of minutes and depend on four services being up and unchanged. The
sources are also not versioned in any way that makes them reproducible: FEMA's
NFHL is "current", and an Overpass extract is whatever OpenStreetMap looked
like that day.

So the committed file is not a cache of something cheap. It is the only thing
that makes the data reproducible at all, and it is the only thing that lets
someone who clones this repository stand the application up.

**The actual risk.** Not the 3.6 MB — a single `npm install` here is two orders
of magnitude larger. It is that the file is regenerated repeatedly and each
regeneration adds another 3.6 MB blob to history forever. It has been written
once.

## Decision

Keep it committed, and add the thing that was actually missing: a manifest.

`build/block_groups.manifest.json` records the row count, the byte size, the
column list, the SHA-256 and the build time. It is written by `analyze.py`
alongside the table and verified by `load_postgis.py` before it opens a
transaction.

This does two jobs. In review, regenerating the table stops being "binary file
modified" and becomes a diff with a changed checksum, a changed row count and a
changed date — which is how you notice a regeneration nobody meant to do. At
load time it is an integrity check: a truncated file is otherwise discovered as
a COPY that fails halfway through, or, worse, one that succeeds with fewer rows
than the county has.

A missing manifest is not fatal — someone may be loading a table they built a
minute ago — but a manifest that disagrees is.

**The tripwire:** if this file is regenerated more than a couple more times, it
moves to a release asset with a download script, and the manifest becomes the
checksum that script verifies. The manifest exists partly so that the moment
the tripwire is hit is visible in `git log` rather than a matter of memory.

## Alternatives

**Git LFS.** The textbook answer, and it makes every clone worse: LFS is a
setup step, a separate quota, and a failure mode where a clone succeeds and the
file is a pointer. For a repository whose audience is people reading it once,
that trade is backwards.

**A GitHub release asset plus a download script.** Where this goes if the
tripwire trips. Today it buys nothing — the file has one version — and costs a
second source of truth to keep in sync, plus a network dependency in the one
path that currently works offline.

**Regenerate from source, commit nothing.** Honest and unusable: it makes the
repository depend on four external services and a couple of gigabytes of
download to get to a running state.

**Commit it and say nothing.** What was in place. The file is defensible; the
silence was not.

## Consequences

- A clone plus a `DATABASE_URL` is enough to stand up the whole application.
- History carries one 3.6 MB blob, and will carry another for each
  regeneration — which the tripwire exists to notice.
- `build/` stays ignored apart from these two files, so the 15 MB of
  intermediate GeoJSON never enters the repository.

## How this is held

`pipeline/load_postgis.py` verifies the manifest before it connects, and exits
with the expected and actual checksums if they differ. That was checked against
a deliberately corrupted copy, not assumed.

`pipeline/paths.py` owns both the paths and the manifest format, so the stage
that writes it and the stage that reads it cannot disagree about either.
