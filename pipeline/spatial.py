"""
Stage 2: the spatial analysis. Adds flood exposure and service distance to
every block group.

Two measurements, both done in EPSG:32615 so the units are metres:

  flood_pct       share of block-group area inside a FEMA Special Flood Hazard
                  Area (SFHA_TF = 'T') — the 1% annual chance, "100-year",
                  floodplain. This is the regulatory definition used for
                  mandatory flood insurance.

  flood_pct_500   share inside the 0.2% annual chance ("500-year") zone. Kept
                  separate because a great many Houston homes that flooded in
                  Harvey were OUTSIDE the SFHA. Reporting only the SFHA share
                  would understate real exposure, and saying so is the honest
                  framing of this dataset.

  dist_*_m        straight-line distance from the block group's representative
                  point to the nearest POI of that type.

Every step asserts something that must hold. A spatial join that silently
produces the wrong answer is the failure mode to fear here, because nothing
about the output looks wrong.
"""

from __future__ import annotations

from pathlib import Path

import paths

import geopandas as gpd
import pandas as pd

CRS_STORAGE = 4326
CRS_MEASURE = 32615

# ZONE_SUBTY value marking the 0.2% annual chance zone inside the non-SFHA X zone.
SUBTY_500YR = "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"


def load_flood(zip_path: Path) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    fld = gpd.read_file(f"zip://{zip_path}!S_FLD_HAZ_AR.shp").to_crs(epsg=CRS_MEASURE)
    fld = fld[fld.geometry.notna() & ~fld.geometry.is_empty]
    fld["geometry"] = fld.geometry.buffer(0)  # repair self-intersections

    sfha = fld[fld["SFHA_TF"] == "T"][["geometry"]].copy()
    five_hundred = fld[fld["ZONE_SUBTY"] == SUBTY_500YR][["geometry"]].copy()
    return sfha, five_hundred


def share_of_area(
    blocks: gpd.GeoDataFrame, hazard: gpd.GeoDataFrame, label: str
) -> pd.Series:
    """Fraction of each block group's area covered by the hazard polygons.

    `overlay` cuts the block groups against the hazard layer; `dissolve` then
    unions the pieces per block group, so overlapping hazard polygons are
    counted once rather than summed. Summing the pieces instead would silently
    produce shares above 1.
    """
    if hazard.empty:
        return pd.Series(0.0, index=blocks.index)

    pieces = gpd.overlay(
        blocks[["geoid", "geometry"]], hazard, how="intersection", keep_geom_type=True
    )
    if pieces.empty:
        return pd.Series(0.0, index=blocks.index)

    covered = pieces.dissolve(by="geoid").area.rename("covered_m2")
    merged = blocks[["geoid", "area_m2"]].merge(
        covered, left_on="geoid", right_index=True, how="left"
    )
    share = (merged["covered_m2"].fillna(0.0) / merged["area_m2"]).clip(0.0, 1.0)
    share.index = blocks.index

    over = (merged["covered_m2"].fillna(0.0) / merged["area_m2"]) > 1.001
    if over.any():
        raise ValueError(f"{label}: {int(over.sum())} block groups exceed 100% coverage")
    return share


def nearest_distance(
    blocks: gpd.GeoDataFrame, pois: gpd.GeoDataFrame, poi_type: str
) -> pd.Series:
    subset = pois[pois["poi_type"] == poi_type]
    if subset.empty:
        raise ValueError(f"no POIs of type {poi_type}")

    # representative_point, not centroid: a centroid can fall outside a
    # concave or multi-part polygon, which would measure from the wrong place.
    points = blocks.copy()
    points["geometry"] = points.geometry.representative_point()

    joined = gpd.sjoin_nearest(
        points[["geoid", "geometry"]], subset[["geometry"]], how="left", distance_col="d"
    )
    # sjoin_nearest emits one row per tie; keep the first per block group.
    return joined.groupby("geoid")["d"].min().reindex(blocks["geoid"]).to_numpy()


def build(raw_dir: Path, blocks_path: Path, out: Path) -> gpd.GeoDataFrame:
    blocks = gpd.read_file(blocks_path).to_crs(epsg=CRS_MEASURE)
    county = blocks.geometry.union_all()

    # --- POIs -------------------------------------------------------------
    raw_poi = gpd.read_file(raw_dir / "export.geojson")
    raw_poi = raw_poi[raw_poi.geom_type == "Point"].to_crs(epsg=CRS_MEASURE)

    def classify(row) -> str | None:
        if row.get("shop") == "supermarket":
            return "supermarket"
        if row.get("leisure") == "park":
            return "park"
        return None

    raw_poi["poi_type"] = raw_poi.apply(classify, axis=1)
    raw_poi = raw_poi[raw_poi["poi_type"].notna()]

    # The Overpass query matched BOTH Harris County, Texas and Harris County,
    # Georgia — they share a name. Filter by containment in the real county
    # boundary, not a bounding box, which would keep the wrong ones near the
    # corners and drop real ones along the county's irregular edge.
    before = len(raw_poi)
    pois = raw_poi[raw_poi.within(county)].copy()
    print(f"POIs: kept {len(pois)} of {before} (dropped {before - len(pois)} outside the county)")

    # --- flood ------------------------------------------------------------
    flood_zip = next(raw_dir.glob("48201C_*.zip"))
    sfha, five_hundred = load_flood(flood_zip)
    print(f"flood polygons: {len(sfha)} SFHA, {len(five_hundred)} 0.2% annual chance")

    blocks["flood_pct"] = share_of_area(blocks, sfha, "SFHA")
    blocks["flood_pct_500"] = share_of_area(blocks, five_hundred, "0.2%")
    blocks["dist_grocery_m"] = nearest_distance(blocks, pois, "supermarket")
    blocks["dist_park_m"] = nearest_distance(blocks, pois, "park")

    for col in ("flood_pct", "flood_pct_500", "dist_grocery_m", "dist_park_m"):
        if blocks[col].isna().any():
            raise ValueError(f"{col} has {int(blocks[col].isna().sum())} nulls")

    out.parent.mkdir(parents=True, exist_ok=True)
    blocks.to_crs(epsg=CRS_STORAGE).to_file(out, driver="GeoJSON")
    return blocks


def main() -> int:
    args = paths.parser(__doc__.strip().splitlines()[0]).parse_args()
    raw_dir = paths.require(args.raw, "it holds the FEMA NFHL and the OSM extract")
    blocks_path = paths.require(
        args.build / paths.BLOCK_GROUPS.name, "run extract.py first"
    )
    out = args.build / paths.ANALYZED.name

    b = build(raw_dir, blocks_path, out)

    print("\n--- flood exposure (SFHA, 1% annual chance) ---")
    print(f"  any exposure      : {(b['flood_pct'] > 0).sum()} block groups")
    print(f"  >= 50% of area    : {(b['flood_pct'] >= 0.5).sum()}")
    print(f"  population in >=50%: {b.loc[b['flood_pct'] >= 0.5, 'pop'].sum():,}")
    print(f"  county-wide share : {(b['flood_pct'] * b['area_m2']).sum() / b['area_m2'].sum():.1%}")
    print("\n--- 0.2% annual chance (500-year) ---")
    print(f"  any exposure      : {(b['flood_pct_500'] > 0).sum()} block groups")
    print("\n--- service distance (m) ---")
    for c in ("dist_grocery_m", "dist_park_m"):
        s = b[c]
        print(f"  {c:<16} median {s.median():>8,.0f}  p90 {s.quantile(0.9):>8,.0f}  max {s.max():>9,.0f}")
    print(f"\nwrote: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
