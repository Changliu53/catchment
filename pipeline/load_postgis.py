"""
Load the prepared block-group table into Lakebase Postgres (Neon).

Run this yourself — the build environment has no network route to Neon, so the
data has to be pushed from a machine that does. Nothing geospatial is required
here: all the GIS work already happened upstream, and this script only streams
a CSV of WKB hex into Postgres via COPY.

    pip install "psycopg[binary]"
    export DATABASE_URL='postgresql://...'      # from the Neon console
    python pipeline/load_postgis.py

Safe to re-run: it loads into a staging table and swaps in one transaction, so
a failure part-way through leaves the existing data untouched.
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import paths  # noqa: E402  (same directory; keeps one definition of where things live)

CSV = paths.TABLE
MANIFEST = paths.MANIFEST

COLUMNS = (
    "geoid, pop, median_income, income_topcoded, area_m2, pop_density, "
    "flood_pct, flood_pct_500, dist_grocery_m, dist_park_m, geom, geom_simple"
)

CREATE_STAGING = """
CREATE TEMP TABLE block_groups_staging (
  geoid           char(12),
  pop             integer,
  median_income   integer,
  income_topcoded boolean,
  area_m2         double precision,
  pop_density     double precision,
  flood_pct       double precision,
  flood_pct_500   double precision,
  dist_grocery_m  double precision,
  dist_park_m     double precision,
  geom            geometry(MultiPolygon, 4326),
  geom_simple     geometry(MultiPolygon, 4326)
) ON COMMIT DROP
"""

SWAP = """
DELETE FROM block_groups;
INSERT INTO block_groups (geoid, pop, median_income, income_topcoded,
                          area_m2, pop_density, flood_pct, flood_pct_500,
                          dist_grocery_m, dist_park_m, geom, geom_simple)
SELECT geoid, pop, median_income, income_topcoded,
       area_m2, pop_density, flood_pct, flood_pct_500,
       dist_grocery_m, dist_park_m, geom, geom_simple
FROM block_groups_staging
"""

CHECKS = [
    ("rows", "SELECT count(*) FROM block_groups"),
    ("population", "SELECT sum(pop) FROM block_groups"),
    ("invalid geometries", "SELECT count(*) FROM block_groups WHERE NOT ST_IsValid(geom)"),
    (
        "area km2 (recomputed in PostGIS)",
        "SELECT round(sum(ST_Area(ST_Transform(geom, 32615)))::numeric / 1e6) FROM block_groups",
    ),
    (
        "block groups >=50% in SFHA",
        "SELECT count(*) FROM block_groups WHERE flood_pct >= 0.5",
    ),
    (
        "population in those",
        "SELECT sum(pop) FROM block_groups WHERE flood_pct >= 0.5",
    ),
]


def check_dsn(dsn: str) -> str | None:
    """Catch the mistakes that otherwise surface as an opaque DNS error.

    A DSN copied from documentation rather than the console fails deep inside
    socket resolution with 'label empty or too long', which says nothing about
    the actual problem.
    """
    if "..." in dsn:
        return "it still contains '...', so it is an example rather than your connection string"
    if not dsn.startswith(("postgresql://", "postgres://")):
        return "it does not start with postgresql://"
    if "@" not in dsn:
        return "it has no user:password@host section"
    host = dsn.split("@", 1)[1].split("/", 1)[0].split(":", 1)[0]
    if not host or ".." in host or host.startswith(".") or host.endswith("."):
        return f"the hostname looks malformed: {host!r}"
    if "XXXX" in dsn or "your-" in dsn:
        return "it still contains placeholder text"
    return None


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set. Copy it from the Neon console.", file=sys.stderr)
        return 1

    problem = check_dsn(dsn)
    if problem:
        print(f"DATABASE_URL looks wrong: {problem}.", file=sys.stderr)
        print(
            "Copy the full string from the Neon console "
            "(Dashboard -> Connection string) rather than typing it.",
            file=sys.stderr,
        )
        return 1

    try:
        import psycopg
    except ModuleNotFoundError:
        print('psycopg is not installed. Run: pip install "psycopg[binary]"', file=sys.stderr)
        return 1
    if not CSV.exists():
        print(f"missing {CSV} — run pipeline/analyze.py first", file=sys.stderr)
        return 1

    # Before touching the database. A truncated or half-written file is
    # otherwise discovered as a COPY that fails partway through — or, worse,
    # one that succeeds with fewer rows than the county has.
    m = paths.verify_manifest(CSV, MANIFEST)
    if m["checked"]:
        print(f"source  : {CSV.name} ({m['rows']} rows, built {m['built']})")
    else:
        print(f"source  : {CSV.name} (unverified — {m['reason']})")

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(CREATE_STAGING)

        copy_sql = f"COPY block_groups_staging ({COLUMNS}) FROM STDIN WITH (FORMAT csv, HEADER true)"
        with gzip.open(CSV, "rb") as fh, cur.copy(copy_sql) as copy:
            while chunk := fh.read(1 << 20):
                copy.write(chunk)

        cur.execute("SELECT count(*) FROM block_groups_staging")
        staged = cur.fetchone()[0]
        if staged == 0:
            raise SystemExit("staging table is empty; aborting before the swap")
        print(f"staged {staged} rows")

        # One transaction: the old data is only removed once the new data is in.
        for statement in SWAP.strip().split(";"):
            if statement.strip():
                cur.execute(statement)
        conn.commit()

        print("\nverification")
        for label, sql in CHECKS:
            cur.execute(sql)
            print(f"  {label:<34} {cur.fetchone()[0]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
