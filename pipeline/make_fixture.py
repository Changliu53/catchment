"""Cut a small, representative sample of the dataset for running without a database.

The application reads the real 2,830 block groups from Neon. That makes the
project unrunnable for anyone who clones it — and, once the page renders on the
server, unrunnable in CI too, because the tests can no longer intercept an HTTP
call that no longer happens.

So there is a second data source: a JSON file the app reads when
`CATCHMENT_DATA=fixture`. It is not invented data. It is a stratified sample of
the real thing, so the map draws real Harris County geometry and the
statistics are real statistics over a real subset.

Stratified, not the first N rows: a prefix of a geoid-ordered table is one
corner of the county and would miss the flood-exposed east side entirely. This
walks the whole table at a fixed stride, then makes sure the awkward cases
survive the sampling — block groups with suppressed income, and block groups on
both sides of the 50% floodplain threshold that the comparison splits on.

    python3 pipeline/make_fixture.py [rows]
"""

from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "block_groups.csv.gz"
TARGET = ROOT / "fixtures" / "block-groups.json"

DEFAULT_ROWS = 400

# The cases a naive sample would drop, and what each one is needed for.
MUST_INCLUDE = {
    # Suppressed income: the map has a whole code path for a null measure.
    "no_income": lambda r: r["median_income"] is None,
    # Both sides of the comparison threshold, or the split has nothing to split.
    "flooded": lambda r: r["flood_pct"] >= 0.5,
    "dry": lambda r: r["flood_pct"] < 0.5,
    # A long walk to a supermarket, so the resource_gap presets return rows.
    "far_from_shops": lambda r: r["dist_grocery_m"] > 1500,
}
MIN_PER_CASE = 12


def number(value: str) -> float | None:
    value = value.strip()
    if value == "" or value.lower() in {"none", "null", "nan"}:
        return None
    return float(value)


def read_rows() -> list[dict]:
    out = []
    with gzip.open(SOURCE, "rt") as fh:
        for row in csv.DictReader(fh):
            out.append(
                {
                    "geoid": row["geoid"],
                    "pop": int(float(row["pop"])),
                    "median_income": (
                        None if number(row["median_income"]) is None else int(number(row["median_income"]))
                    ),
                    "income_topcoded": row["income_topcoded"].strip().lower() in {"t", "true", "1"},
                    "area_m2": round(float(row["area_m2"]), 1),
                    "pop_density": round(float(row["pop_density"]), 2),
                    "flood_pct": round(float(row["flood_pct"]), 6),
                    "flood_pct_500": round(float(row["flood_pct_500"]), 6),
                    "dist_grocery_m": round(float(row["dist_grocery_m"]), 1),
                    "dist_park_m": round(float(row["dist_park_m"]), 1),
                    "_wkb": row["geom_simple"],
                }
            )
    return out


def main() -> int:
    if not SOURCE.exists():
        print(f"missing {SOURCE}; run the pipeline first", file=sys.stderr)
        return 1

    from shapely import from_wkb, to_geojson

    want = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ROWS
    rows = read_rows()
    if not rows:
        print("no rows in the source file", file=sys.stderr)
        return 1

    stride = max(1, len(rows) // want)
    picked = {r["geoid"]: r for r in rows[::stride][:want]}

    # Top up any case the stride happened to miss.
    for name, matches in MUST_INCLUDE.items():
        have = sum(1 for r in picked.values() if matches(r))
        if have >= MIN_PER_CASE:
            continue
        for r in rows:
            if have >= MIN_PER_CASE:
                break
            if r["geoid"] in picked or not matches(r):
                continue
            picked[r["geoid"]] = r
            have += 1
        print(f"  topped up {name}: {have}")

    out = []
    for r in sorted(picked.values(), key=lambda r: r["geoid"]):
        geometry = json.loads(to_geojson(from_wkb(bytes.fromhex(r.pop("_wkb")))))
        out.append({**r, "geometry": geometry})

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(out, separators=(",", ":")) + "\n")

    flooded = sum(1 for r in out if r["flood_pct"] >= 0.5)
    no_income = sum(1 for r in out if r["median_income"] is None)
    size = TARGET.stat().st_size / 1024
    print(
        f"wrote {TARGET.relative_to(ROOT)} — {len(out)} block groups, {size:.0f} KB "
        f"({flooded} at or above 50% floodplain, {no_income} with suppressed income)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
