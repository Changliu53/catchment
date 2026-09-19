"""Derive the Harris County outline from the block groups that tile it.

The map draws 2,830 block groups over a basemap that extends well past the
county, and until now nothing on screen said where the study area stopped. A
reader could not tell whether a blank stretch meant "no block group matched"
or "this is Fort Bend County and was never considered". The boundary answers
that, and it costs no new data: the block groups partition the county exactly,
so their union *is* the county.

That is also a check. The union's area is compared against the county's
official 4,602 km2; a mismatch would mean the extract dropped or duplicated
geometry, and this script fails rather than shipping a wrong outline.

Run it after the pipeline, whenever the block-group set changes:

    python3 pipeline/county_outline.py

It writes src/lib/harris-county.json, which the map imports directly. At this
size an import costs less than a request: no extra round trip, no loading
state, and nothing to serve.
"""

from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path

from pyproj import Transformer
from shapely import from_wkb, to_geojson
from shapely.geometry import shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "block_groups.csv.gz"
TARGET = ROOT / "src" / "lib" / "harris-county.json"

# Harris County's official land+water area, from the Census gazetteer. The
# union of the block groups should land within a fraction of a percent of it.
OFFICIAL_KM2 = 4602.0
TOLERANCE_PCT = 1.0

# All measurement and simplification happens in UTM 15N, never in degrees: a
# tolerance in degrees means something different at every latitude, and area in
# square degrees is not area at all.
METRIC = "EPSG:32615"
WGS84 = "EPSG:4326"

# Metres. Large enough to cut the vertex count hard, small enough that the
# boundary still reads as Harris County at every zoom the map allows — the
# county is ~90 km across, so 200 m is about two screen pixels at county zoom.
SIMPLIFY_M = 200.0

to_metric = Transformer.from_crs(WGS84, METRIC, always_xy=True).transform
to_wgs84 = Transformer.from_crs(METRIC, WGS84, always_xy=True).transform


def main() -> int:
    if not SOURCE.exists():
        print(f"missing {SOURCE}; run the pipeline first", file=sys.stderr)
        return 1

    geoms = []
    with gzip.open(SOURCE, "rt") as fh:
        for row in csv.DictReader(fh):
            # The full geometry, not geom_simple: simplified pieces do not
            # share edges exactly, so their union leaves slivers and pinholes
            # along every internal boundary. Simplify once, after the union.
            geoms.append(from_wkb(bytes.fromhex(row["geom"])))

    if not geoms:
        print("no geometry in the source file", file=sys.stderr)
        return 1

    county = transform(to_metric, unary_union(geoms))

    area_km2 = county.area / 1e6
    drift = abs(area_km2 - OFFICIAL_KM2) / OFFICIAL_KM2 * 100
    print(f"{len(geoms)} block groups -> {area_km2:,.1f} km2 (official {OFFICIAL_KM2:,.1f}, {drift:.2f}% off)")
    if drift > TOLERANCE_PCT:
        print(
            f"area is {drift:.2f}% off the official figure, over the {TOLERANCE_PCT}% "
            "tolerance — the block-group set is probably incomplete",
            file=sys.stderr,
        )
        return 1

    # preserve_topology keeps the ring valid and stops the simplifier from
    # collapsing the ship channel into a self-intersection.
    simple = county.simplify(SIMPLIFY_M, preserve_topology=True)
    outline = transform(to_wgs84, simple)

    feature = {
        "type": "Feature",
        "properties": {"name": "Harris County, Texas"},
        "geometry": json.loads(to_geojson(outline)),
    }
    payload = json.dumps(feature, separators=(",", ":"))
    TARGET.write_text(payload + "\n")

    kept = len(shape(feature["geometry"]).wkt)
    print(f"wrote {TARGET.relative_to(ROOT)} — {len(payload) / 1024:.1f} KB, wkt {kept / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
