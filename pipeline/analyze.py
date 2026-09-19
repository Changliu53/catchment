"""
Stage 2: turn the normalised GeoDataFrame into a load-ready table.

Produces two geometries per block group:

  geom         full precision, used for every measurement (intersection with
               floodplains, distance to POIs, area).
  geom_simple  simplified at 10 m, used only for drawing the map.

They are kept apart on purpose. Simplification moves boundaries by up to ~5% of
area on the smallest block groups, which is invisible on screen and unacceptable
in a statistic. Measuring against display geometry is a classic GIS error and
one this schema makes structurally impossible.

Output is a gzipped CSV of WKB hex so the loader needs no geospatial libraries.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import paths

import geopandas as gpd
from shapely import to_wkb
from shapely.geometry import MultiPolygon

CRS_STORAGE = 4326
CRS_MEASURE = 32615

# 10 m: ~2.0 MB of GeoJSON for the whole county, indistinguishable on screen at
# county zoom. 20 m halves the vertex count again but doubles the area error.
SIMPLIFY_TOLERANCE_M = 10


def as_multipolygon(geom):
    """Postgres column is typed MultiPolygon; promote bare Polygons."""
    return geom if geom.geom_type == "MultiPolygon" else MultiPolygon([geom])


def build(src: Path, out_csv: Path) -> int:
    gdf = gpd.read_file(src)
    if gdf.crs.to_epsg() != CRS_STORAGE:
        raise ValueError(f"expected EPSG:{CRS_STORAGE}, got {gdf.crs}")

    # Simplify in the projected CRS so the tolerance is genuinely metres.
    projected = gdf.to_crs(epsg=CRS_MEASURE)
    simplified = projected.geometry.simplify(
        SIMPLIFY_TOLERANCE_M, preserve_topology=True
    ).to_crs(epsg=CRS_STORAGE)

    invalid = ~simplified.is_valid
    if invalid.any():
        print(f"repairing {int(invalid.sum())} invalid simplified geometries")
        simplified = simplified.buffer(0)

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_csv, "wt", newline="") as fh:
        fh.write("geoid,pop,median_income,income_topcoded,area_m2,pop_density,flood_pct,flood_pct_500,dist_grocery_m,dist_park_m,geom,geom_simple\n")
        for row, simple in zip(gdf.itertuples(), simplified):
            income = "" if row.median_income is None or row.median_income != row.median_income else int(row.median_income)
            fh.write(
                f"{row.geoid},{int(row.pop)},{income},"
                f"{'t' if row.income_topcoded else 'f'},"
                f"{row.area_m2:.3f},{row.pop_density:.6f},"
                f"{row.flood_pct:.6f},{row.flood_pct_500:.6f},"
                f"{row.dist_grocery_m:.2f},{row.dist_park_m:.2f},"
                f"{to_wkb(as_multipolygon(row.geometry), hex=True)},"
                f"{to_wkb(as_multipolygon(simple), hex=True)}\n"
            )

    return len(gdf)


def main() -> int:
    args = paths.parser(__doc__.strip().splitlines()[0]).parse_args()
    src = paths.require(args.build / paths.ANALYZED.name, "run spatial.py first")
    out = args.build / paths.TABLE.name
    out.parent.mkdir(parents=True, exist_ok=True)
    n = build(src, out)

    # The table is committed; the manifest is what makes regenerating it a
    # visible act. A changed checksum and row count in a diff is reviewable
    # where "binary file modified" is not.
    manifest = args.build / paths.MANIFEST.name
    m = paths.write_manifest(out, manifest, n)

    print(f"rows    : {n}")
    print(f"wrote   : {out} ({out.stat().st_size / 1e6:.1f} MB gzipped)")
    print(f"sha256  : {m['sha256']}")
    print(f"manifest: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
