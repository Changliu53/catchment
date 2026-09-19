"""
Does this environment still do the things the pipeline needs?

Run after changing anything in requirements.txt, and in CI on every push.

The pipeline is the one part of this project CI did not touch. A dependency
update to `pipeline/requirements.txt` used to collect three green checks that
were all about the JavaScript — a check that reports success about something it
never looked at, which is the failure this repository keeps finding in its own
tooling. This closes that.

It is a smoke test, not a test of the analysis. The real numbers are checked
where they can be: `county_outline.py` refuses to ship an outline if the union
of every block group drifts more than 1% from the county's official area. What
this asserts is narrower and is exactly what a dependency bump breaks — that
the operations still exist, still accept these arguments, and still return the
right kind of answer.

    python pipeline/smoke.py
"""

from __future__ import annotations

import sys

MIN_PYTHON = (3, 11)


def main() -> int:
    if sys.version_info < MIN_PYTHON:
        print(f"needs Python {'.'.join(map(str, MIN_PYTHON))} or newer", file=sys.stderr)
        return 1

    import geopandas as gpd
    import pandas as pd
    import pyproj
    import shapely
    from shapely import to_wkb
    from shapely.geometry import MultiPolygon, Polygon

    print(
        f"python {sys.version.split()[0]} · pandas {pd.__version__} · "
        f"geopandas {gpd.__version__} · shapely {shapely.__version__} · pyproj {pyproj.__version__}"
    )

    # Two block groups, one with income suppressed — the case that has already
    # produced a real bug on the map, where coercing null to zero painted those
    # areas as the poorest in the county.
    frame = gpd.GeoDataFrame(
        {
            "geoid": ["482010001001", "482010001002"],
            "pop": [1200, 0],
            "median_income": [51000.0, None],
        },
        geometry=[
            Polygon([(-95.5, 29.7), (-95.4, 29.7), (-95.4, 29.8), (-95.5, 29.8)]),
            Polygon([(-95.3, 29.6), (-95.2, 29.6), (-95.2, 29.7), (-95.3, 29.7)]),
        ],
        crs="EPSG:4326",
    )

    # Every measurement happens in UTM 15N. Measuring in degrees is how you get
    # answers that are wrong by a factor that varies with latitude, so a
    # reprojection that silently stops working is the worst thing on this list.
    utm = frame.to_crs(32615)
    areas_km2 = [a / 1e6 for a in utm.area]
    assert all(80 < a < 140 for a in areas_km2), f"areas look wrong: {areas_km2}"

    # The flood overlay.
    flood = gpd.GeoDataFrame(
        geometry=[Polygon([(-95.45, 29.7), (-95.35, 29.7), (-95.35, 29.8), (-95.45, 29.8)])],
        crs="EPSG:4326",
    ).to_crs(32615)
    share = gpd.overlay(
        utm.reset_index(), gpd.GeoDataFrame(geometry=flood.geometry), how="intersection"
    ).area.sum() / utm.area.iloc[0]
    assert 0.45 < share < 0.55, f"half-covered block group came out at {share}"

    # Nearest-facility distance, which resource_gap is built on.
    point = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy([-95.45], [29.75]), crs="EPSG:4326"
    ).to_crs(32615)
    distance = utm.geometry.iloc[0].centroid.distance(point.geometry.iloc[0])
    assert distance < 1000, f"centroid to a point inside the shape came out {distance} m"

    # Null stays null. Census suppression means unknown, not zero.
    assert pd.isna(frame.median_income.iloc[1]), "suppressed income was coerced"

    # What analyze.py actually writes: MultiPolygon WKB hex, and the simplified
    # geometry the application serves.
    assert to_wkb(MultiPolygon([frame.geometry.iloc[0]]), hex=True).startswith("0106")
    assert frame.geometry.iloc[0].simplify(0.0001).is_valid

    # analyze.py iterates with itertuples; pandas has changed what that yields.
    row = next(frame.itertuples())
    assert row.geoid == "482010001001" and int(row.pop) == 1200

    # The loader's two API surfaces, without needing a database.
    import psycopg

    assert callable(psycopg.connect) and hasattr(psycopg.Cursor, "copy")

    print("ok — projection, overlay, distance, nulls, WKB and the loader API all work")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
