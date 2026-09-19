# Catchment

**[Live demo](https://catchment-two.vercel.app)** · [![CI](https://github.com/Changliu53/catchment/actions/workflows/ci.yml/badge.svg)](https://github.com/Changliu53/catchment/actions/workflows/ci.yml)

A full-stack analysis tool for Harris County, Texas. Ask a question in plain
English; the answer is computed over 2,830 census block groups of flood,
income and service-access data and drawn as a choropleth.

> Which flood-exposed neighbourhoods have no supermarket within a kilometre?

Google Maps can tell you where a supermarket is. It cannot express *"more than
half of this area sits in the 100-year floodplain **and** its centre is over a
kilometre from the nearest supermarket"*, and it will not tell you how many
people live there. That gap is the whole project.

Next.js 16 App Router, React 19, TypeScript in strict mode, Postgres with
PostGIS, GitHub sign-in for keeping and sharing an analysis, and a test suite —
unit, integration against a real database, and end-to-end against a production
build — that runs before anything deploys.

## Architecture

```mermaid
flowchart TB
  subgraph browser["Browser"]
    URL["/?preset=... or /?q=..."]
    MAP["ResultMap<br/>client island, MapLibre GL"]
  end

  subgraph server["Vercel — Node runtime"]
    PAGE["page.tsx · the share route<br/>Server Components"]
    ANS["answerFor()"]
    VAL["Validation<br/>Zod + semantic checks"]
    EXE["Executor<br/>pure function, no I/O"]
    MEM[("rows held in memory")]
    API["/api/query<br/>the same function, as JSON"]
    ACT["Server Actions<br/>save · rename · delete"]
    SES["viewer()<br/>Better Auth"]
  end

  subgraph ext["External"]
    DB[("Neon Postgres + PostGIS")]
    LLM["Anthropic API"]
  end

  URL --> PAGE
  PAGE --> ANS
  API --> ANS
  ANS -->|"new question only"| LLM
  LLM --> VAL
  ANS --> VAL
  VAL --> EXE
  MEM --> EXE
  DB -->|"read once per instance"| MEM
  EXE -->|"HTML + GeoJSON"| MAP
  PAGE --> SES
  ACT --> SES
  SES -->|"sessions"| DB
  ACT -->|"saved questions"| DB
  DB -->|"slug → question"| PAGE
```

**The question is in the URL, and the answer is in the HTML.** The page is a
Server Component: it reads `?preset=` or `?q=`, runs the analysis there, and
ships the result in the first response. Nothing fetches. A shared link shows
its answer to anything that can read HTML, and — apart from the map — the app
works with JavaScript switched off, because the question box is an ordinary
GET form and the presets are ordinary links.

Measured on the deployed build: a preset answer arrives as one 64 KB HTML
document containing the headline figures, the statistics table and the audit
trail. The previous version served 22 KB of shell, then ran the bundle, then
POSTed for the data.

The only client component is the map island — WebGL, a Web Worker, and the
hover/selection state that follows a pointer or a tap. Everything else,
including the legend, is HTML. The classification is computed once on the
server and handed to both, so the legend and the colours cannot disagree.

`DATABASE_URL` and `ANTHROPIC_API_KEY` exist only on the server. The browser
receives a rendered page and a GeoJSON payload, and nothing else.

## Decisions worth a look

**The database is not on the request path.** The dataset is 2,830 rows and
changes only when the pipeline is re-run, so it is fetched once per server
instance and memoised. A request never waits on Postgres — which also means a
cold Neon compute costs a visitor nothing. The memoised promise clears itself
if the fetch rejects, so a transient failure is retried rather than cached
forever.

**One endpoint, three tiers, cheapest first.** A preset question resolves from
a plan that shipped with the build: no model call, no API key, no rate-limit
budget. A repeated question resolves from an LRU cache. Only a genuinely new
question reaches the model, and only after the rate limiter agrees. Most
visitors never get past the first tier.

**Errors name their own cause.** Every way the analysis can fail is a named
variant — `unsupported`, `rate-limited`, `model-failed`, `data-unavailable` —
so a caller never parses a string to work out what happened. The JSON API maps
each onto a status code; the page maps each onto a panel. If `DATABASE_URL` is
missing it says so, and adds that environment variables added after a build
are not picked up until the next one, because that is the actual mistake and
it is invisible from the symptom. This replaced a version where a wrong model
ID and a rejected API key both surfaced as the same useless "network error",
pointing at the network.

**Types hold at the boundary, not just inside it.** Strict TypeScript with
`noUncheckedIndexedAccess`, and every payload crossing into the executor is
re-parsed by a Zod discriminated union first. One field dictionary in
`schema.ts` generates the prompt text *and* the tool schema, so the two cannot
drift — the failure where a prompt still advertises a field renamed six
commits ago is structurally impossible.

**Trade-offs are stated, not hidden.** Rate limiting is an in-memory map, so
on serverless it is per-instance and the real ceiling is looser than the
configured number. That is written down in the module, along with why: the
control that actually bounds the loss is a spend limit on the Anthropic
account, and a Redis dependency would buy precision nothing here needs.

**The UI was measured, not eyeballed.** The map had a height of exactly zero
on a 390px screen — the stacked controls were 1,023px of `shrink-0` content in
an 844px viewport. The legend covered 29.6% of the map on a phone. Tapping a
block group did nothing at all, because every value lived behind `mousemove`.
None of that was visible from a desktop browser, and all of it is now asserted
in Playwright at five widths with touch emulation. The responsive legend
switches layout in CSS rather than by measuring the viewport during render,
which would disagree with the server-rendered HTML.

## Accounts and saved analyses

Sign in with GitHub, keep a question, get a link anyone can open. It is a small
feature with a few decisions in it worth defending.

**Accounts are optional by construction.** `getAuth()` returns `null` unless
every variable sign-in needs is present, so a deployment without them runs the
entire analysis and simply never offers to save one. That is not a
graceful-degradation afterthought: it is the configuration the end-to-end suite
runs in, with `DATABASE_URL` blanked in `playwright.config.ts` so a developer
with one exported in their shell cannot accidentally test a different
application. The alternative — throwing at startup — turns "clone and run" into
"clone, sign up for a database, then run".

**The first version of that predicate took production down, which is why it is
now four variables.** It tested `DATABASE_URL` alone — reasonable in general,
wrong *here*, because the block-group data lives in Postgres too, so every
deployment has a connection string. Accounts therefore switched themselves on
in an environment that had none of the rest of the configuration, Better Auth
refused to start without a secret, and that error came out of the session read
— which happens on every page. Every route returned 500, including the landing
page, which needs no account at all. Two fixes, because two things were wrong:
the predicate now names what is missing, and `viewer()` treats any failure as
"signed out" and logs it, because the one call made on every page is the worst
possible place to let an exception escape. A second Playwright server runs that
exact half-configured environment (`e2e/degraded.spec.ts`), and reverting
either fix turns it red.

**Sign-in reports its own failure, which it did not at first.** Signing in with
a social provider is not one hop: the server records the OAuth state in a row
*before* it can hand back a URL to redirect to. With the tables not yet
migrated that write failed, the endpoint answered 500 with an empty body, and
the button sat on "Opening GitHub…" indefinitely — indistinguishable from a
slow network, so a reader waits and then presses it again. The first attempt at
a fix was itself wrong: it keyed on `error.message`, which was `undefined`
here, so it concluded nothing had gone wrong. The presence of the error is what
is checked now, and a third Playwright server — configured for accounts, with
the database refusing connections — clicks the button and asserts it says so
and becomes usable again.

**Authorization is a condition in the query, not a check after it.** Every
function in `lib/saved.ts` takes the owner's id and puts it in the `WHERE`
clause; `UPDATE … WHERE slug = $1 AND user_id = $2 RETURNING slug` tells you
whether it applied. The alternative — fetch by slug, then compare `row.userId`
to the session — works right up until one caller forgets the second half, and
that caller is a data leak that returns 200. "Not yours" and "does not exist"
give the same answer, so a probe learns nothing.

**Those claims are tested against a real Postgres.** A mock query builder
agrees with whatever the code asks it, including a query missing half its
conditions, so `saved.integration.test.ts` runs against an actual database:
CI starts a `postgres:17` service container and applies the committed
migrations first. The suite skips itself when no database is configured — and
**refuses to skip when `CI` is set**, because a suite that quietly skips its
only security assertions reports exactly the same green as one that ran them.

**The database enforces what the code believes.** A saved row must have
exactly one source — a preset or a free-text question, never both and never
neither — and that is a `CHECK` constraint, not just a branch in TypeScript.
The test asserts on the driver's `constraint` name rather than on an error
message, so it cannot pass because some other rule happened to reject the row.

**It stores the question, not the answer.** Opening a share link re-runs the
analysis, so a saved link cannot quietly serve last year's floodplain. The page
says so rather than leaving a reader to assume they are seeing a snapshot.

**Saving, renaming and deleting work without JavaScript.** They are Server
Actions taking a bare `FormData`, bound to plain `<form action={…}>`, so they
keep the property the rest of the page has. Each action re-reads the session
itself — a hidden input claiming who you are is a suggestion, and a Server
Action is a public endpoint whatever the button looked like.

**Sessions live in the database, with a five-minute signed-cookie cache.** A
stateless JWT would be one fewer moving part and would make sign-out a lie.
The cache is the stated trade in the other direction: a session revoked on one
device can survive on another until the cookie expires, which is why the window
is five minutes rather than five hours. Anonymous requests touch the database
zero times either way.

**A dead share link returns 404, and this took finding.** The app had an
`app/loading.tsx`, which puts a Suspense boundary above *every* route beneath
it. Next then commits the response — status line included — before any page has
decided what it is, so `notFound()` rendered a 404 page under a **200**, and
`redirect()` became a client-side hop instead of a 307. Invisible in a browser;
wrong to every crawler, link checker and unfurler, which for a URL people paste
into other products is most of the audience. The fix was to stop using the
routing convention and place the boundary as a component, around the slow part
and *below* the lookup that decides the status. `e2e/accounts.spec.ts` asserts
the status codes at the protocol level, because a browser cannot tell the two
apart.

Each saved analysis also generates its own social card at request time
(`next/og`), titled with the saved name and captioned with the question, over
the same county outline the map draws. It falls back to the generic card when
the slug is gone or the database is absent — an image route that throws unfurls
as no card at all.

## The data

| Source | What it provides | Vintage |
| --- | --- | --- |
| Census TIGER/Line | Block-group boundaries | 2024 |
| Census ACS 5-year | Population, median household income | 2024 release |
| FEMA National Flood Hazard Layer | 1% and 0.2% annual-chance flood zones | current NFHL |
| OpenStreetMap | Supermarkets and parks (ODbL) | extract via Overpass |

A Python pipeline (`pipeline/`) joins these, computes the flood overlay and the
nearest-facility distances, and loads the result into Neon Postgres with
PostGIS. Every measurement happens in EPSG:32615 (UTM 15N); EPSG:4326 is used
only for storage and display. Measuring in degrees is how you get answers that
are wrong by a factor that varies with latitude.

### Checked, not assumed

- **The county area comes out right.** The union of all 2,830 block groups is
  4,605.8 km², against an official 4,602 km² — 0.08% off. That single number
  catches a dropped extract, a bad projection, or duplicated geometry at once,
  and `pipeline/county_outline.py` fails rather than shipping an outline if it
  drifts past 1%.
- **Nulls stay null, on the map as well as in the statistics.** Census income
  suppression means "unknown", not "zero", and it covers 273 of the 2,830
  block groups. They are excluded from statistics rather than coerced, they
  sort last in both directions, they are shaded in a neutral grey outside the
  ramp, and the legend counts them. Coercing them would have painted them as
  the poorest neighbourhoods in the county *and* dragged every quantile break
  downwards, so the error would have reached rows whose data was fine.
- **Class breaks are quantiles, not equal intervals.** Population density here
  spans three orders of magnitude; equal intervals would paint 95% of the
  county in the first class and call it a map.
- **Colour contrast is measured on the blend.** Marks sit at 0.85 opacity over
  a basemap, so the ramp was checked against what a reader actually sees, not
  against the raw hex.

## Tests

```bash
npm test            # unit, plus integration if DATABASE_URL is set
npm run test:e2e    # end-to-end, against a production build
```

Both run in CI on every push, and a deploy only happens after they pass. The
test job brings up a `postgres:17` service container and applies the committed
migrations to an empty database first, so a migration that only works where the
table already exists fails there rather than in production.

`typecheck` runs `next typegen` before `tsc`, which is not tidying. Next's typed
routes live in generated declarations, so `tsc` on a checkout with no `.next`
directory — exactly what CI has — type-checks every `Link` and `redirect`
against a route table that does not exist, and passes. A stale `.next` is worse:
it checks against last build's routes and rejects one that now exists. Both
failure modes are silent, so the generation is part of the command rather than
something the environment is trusted to have done.

- **Unit** — the executor on hand-built rows, including the null and tie
  cases; the validator rejecting plans that type-check but mean nothing; the
  classifier; the projection behind the social cards; and an assertion about
  how `maplibre-gl` packages its Web Worker.
- **Integration** — authorization against a real Postgres: a stranger cannot
  rename or delete someone else's saved analysis, deleting an account takes its
  analyses with it, and the database refuses a row that could never be re-run.
  These refuse to skip when `CI` is set, and refuse to *run* against a
  `DATABASE_URL` that is not plainly local or named for testing — they delete
  rows, and `npm test` picks up whatever the shell happens to be holding.
- **End-to-end** — a real production build against the sampled dataset, so the
  suite needs no database and no API key while still exercising the real
  analysis over real geometry. It asserts that the answer is in the first HTML
  response and survives with JavaScript disabled, that the map renders exactly
  the block groups the page says matched, that the layout holds from 390px to
  1680px, that a dead share link answers 404 and a signed-out visit to `/saved`
  answers 307, and — with touch emulation — that tapping a block group opens
  its numbers. Two more servers run the same build in environments that broke
  it: one half-configured — a connection string and nothing else, the state
  that once took production down — asserting every public route still answers
  and none answers 500; one fully configured with the database refusing
  connections, asserting that pressing sign-in reports the failure and releases
  the button instead of sitting on "Opening GitHub…" forever.
- **A negative control** — one spec removes the Web Worker and asserts the map
  renders *nothing*. A regression test that has never failed is a guess about
  what it measures; this one reproduces the original fault and watches the
  probe go to zero.

That middle layer exists because of a real incident. A MapLibre worker chunk
did not survive bundling, so the map drew nothing while the sources, the
layers, the paint expressions and the console all looked correct — a fault
invisible to every check that did not ask the map itself what it had rendered.
`e2e/map.spec.ts` carries the full story in its header.

## The language-model layer

One component, deliberately small. The model translates English into an
analysis plan and does nothing else: it never sees the data, never computes a
number, and never emits code.

That makes its output safe by construction rather than by sanitising. The tool
schema is a whitelist — eight field names, six operations, a bounded step
count — so there is no string that becomes SQL and no string that becomes
code. A plan naming a field that does not exist fails the Zod union before the
executor runs. Correctness lives in the executor, which is a pure function
over an array of rows and is tested without a model.

Declining is a first-class answer: `decline` is its own tool rather than a
variant the model has to notice it may pick, and the prompt's examples include
a question the dataset genuinely cannot answer. Ask about commute time and it
says so, instead of quietly substituting straight-line distance.

## Running it

```bash
npm install
npm run dev
```

It runs with no credentials at all:

```bash
CATCHMENT_DATA=fixture npm run dev
```

That reads `fixtures/block-groups.json` — a stratified sample of the real
table, cut by `pipeline/make_fixture.py` so the awkward cases survive
(suppressed income, both sides of the flood threshold). It is the same code
path over real Harris County geometry, just fewer rows, and it is what the
end-to-end suite runs against.

For the full dataset, set `DATABASE_URL` (Neon, with PostGIS and the data
loaded). `ANTHROPIC_API_KEY` is only needed for free-text questions; the
presets ship with their plans and never call a model.

Accounts are off until a database is configured, and need nothing else running:

```bash
npm run db:migrate   # applies drizzle/*.sql, then says where they landed
npm run db:status    # just the check
```

That second half is not decoration. `drizzle-kit migrate` reports success
without naming the host it applied to, so a `DATABASE_URL` that is empty,
stale, or pointing at the wrong environment produces a cheerful message and an
untouched database. It happened: a production migration went nowhere, and the
symptom surfaced later as a sign-in button that hung, because the OAuth state
row had no table to go in. Both commands now print `database: <name> on <host>`
— never the password — and exit non-zero if a table the app needs is absent.

with `BETTER_AUTH_SECRET` set and a GitHub OAuth app supplying
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Any Postgres will do — the
sessions and saved rows never touch PostGIS. The schema lives in
`src/db/schema.ts` and the migrations it generates are committed, so the SQL
that will run in production is reviewable in the diff rather than produced by a
tool at deploy time.

To rebuild the dataset from scratch: `pipeline/extract.py` → `spatial.py` →
`analyze.py` → `load_postgis.py`, then `county_outline.py`.

## Limits

Distances are straight-line, not travel time — a block group 800m from a
supermarket across a bayou with no bridge is not within 800m of anything. ACS
estimates carry margins of error that this project does not currently surface.
Income is top-coded at $250,001. And the results describe a distribution: they
show where flooding and poor access coincide, not that either causes the other.

## Stack

**Application** — TypeScript (strict, with `noUncheckedIndexedAccess`) ·
Next.js 16 App Router · React 19 · Tailwind CSS v4 · MapLibre GL JS

**Server** — Server Components and Server Actions · Next.js Route Handlers on
the Node runtime · Zod · Drizzle ORM with committed SQL migrations · Better
Auth (GitHub OAuth, database sessions) · Neon Postgres with PostGIS ·
Anthropic API

**Testing and delivery** — Vitest (unit and integration against a Postgres
service container) · Playwright · GitHub Actions gating deployment to Vercel

**Data pipeline** — Python · GeoPandas · Shapely · PyProj
