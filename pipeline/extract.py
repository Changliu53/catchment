"""
Stage 1 of the pipeline: raw files -> one normalised GeoDataFrame.

Reads the TIGER/Line block-group shapefile and the ACS JSON response, keeps
Harris County, joins them on GEOID, and writes an intermediate file. No spatial
analysis happens here; that is `analyze.py`. Keeping the two apart is what makes
the PostGIS migration a change to one file instead of a rewrite.

ACS sentinel handling (the part most pipelines get wrong):

  -666666666  value suppressed for privacy or too few samples  -> NULL
   250001     median income TOP-CODED, i.e. "at least $250,000" -> keep the
              number but flag it, because averaging top-coded values
              systematically understates income in wealthy block groups.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

# Geographic CRS for storage and web rendering; projected CRS for measurement.
CRS_STORAGE = 4326
CRS_MEASURE = 32615  # WGS84 / UTM zone 15N, metres. Covers -96 to -90; Houston is -95.37.

STATE_FIPS = "48"
COUNTY_FIPS = "201"

SUPPRESSED = {-666666666, -999999999, -888888888}
INCOME_TOPCODE = 250001


def load_boundaries(shapefile_zip: Path) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(f"zip://{shapefile_zip}")
    harris = gdf[(gdf["STATEFP"] == STATE_FIPS) & (gdf["COUNTYFP"] == COUNTY_FIPS)].copy()
    if harris.empty:
        raise ValueError("no Harris County block groups found; check the FIPS codes")

    harris = harris.rename(columns={"GEOID": "geoid"})[["geoid", "geometry"]]

    # TIGER ships in NAD83 (EPSG:4269). Declare it, then convert deliberately —
    # never assume a file is already in the CRS you want.
    if harris.crs is None:
        raise ValueError("shapefile has no CRS; refusing to guess")
    harris = harris.to_crs(epsg=CRS_STORAGE)

    # Area is measured in the projected CRS, never in degrees.
    harris["area_m2"] = harris.to_crs(epsg=CRS_MEASURE).area
    return harris.reset_index(drop=True)


def load_acs(acs_json: Path) -> pd.DataFrame:
    raw = json.loads(acs_json.read_text())
    header, rows = raw[0], raw[1:]
    df = pd.DataFrame(rows, columns=header)

    df["geoid"] = df["state"] + df["county"] + df["tract"] + df["block group"]
    df["pop"] = df["B01003_001E"].astype(int).clip(lower=0)

    income = df["B19013_001E"].astype(int)
    df["income_topcoded"] = income == INCOME_TOPCODE
    df["median_income"] = income.where(~income.isin(SUPPRESSED) & (income >= 0))
    df["median_income"] = df["median_income"].astype("Int64")

    return df[["geoid", "pop", "median_income", "income_topcoded"]]


def build(raw_dir: Path, out: Path) -> gpd.GeoDataFrame:
    boundaries = load_boundaries(raw_dir / "tl_2024_48_bg.zip")
    acs = load_acs(raw_dir / "acs.json")

    merged = boundaries.merge(acs, on="geoid", how="left", indicator=True)

    unmatched = merged[merged["_merge"] != "both"]
    if len(unmatched) > 0:
        # A geometry with no ACS row is a real problem, not a rounding error:
        # it means the vintages disagree. Report rather than silently drop.
        print(f"WARNING: {len(unmatched)} block groups have no ACS row")
        print(unmatched["geoid"].head(10).tolist())
    merged = merged.drop(columns="_merge")

    # people per km^2, computed from the projected area
    merged["pop_density"] = merged["pop"] / (merged["area_m2"] / 1e6)
    merged.loc[merged["area_m2"] == 0, "pop_density"] = 0

    merged.to_file(out, driver="GeoJSON")
    return merged


def main() -> int:
    raw_dir = Path("/mnt/user-data/uploads/personal projects/catchment/raw")
    out = Path("/home/claude/catchment/build/blockgroups.geojson")
    out.parent.mkdir(parents=True, exist_ok=True)

    gdf = build(raw_dir, out)

    print(f"block groups   : {len(gdf)}")
    print(f"CRS            : {gdf.crs}")
    print(f"population     : {gdf['pop'].sum():,}")
    print(f"income known   : {gdf['median_income'].notna().sum()}")
    print(f"income topcoded: {int(gdf['income_topcoded'].sum())}")
    print(f"area total km2 : {gdf['area_m2'].sum() / 1e6:,.0f}")
    print(f"density max    : {gdf['pop_density'].max():,.0f} /km2")
    print(f"wrote          : {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
