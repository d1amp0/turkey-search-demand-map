"""Spatial filter: keep rows inside GeoJSON province polygons."""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from cli.constants import REQUIRED_AFTER_JOIN, REQUIRED_AFTER_JOIN_DROP
from cli.errors import die, require_df_columns


def filter_by_map(df: pd.DataFrame, geojson_path: Path) -> pd.DataFrame:
    require_df_columns(df, ("latitude", "longitude"), "Spatial join (input)")
    turkey_map = gpd.read_file(geojson_path)
    geometry = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
    requests_gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    turkey_map = turkey_map.to_crs("EPSG:4326")
    df_clean = gpd.sjoin(requests_gdf, turkey_map, how="inner", predicate="within")

    missing = [c for c in REQUIRED_AFTER_JOIN_DROP if c not in df_clean.columns]
    if missing:
        die(
            "Spatial join: expected column(s) not present after join "
            f"(needed before drop): {missing}. Columns: {list(df_clean.columns)}"
        )

    dropped = df_clean.drop(columns=list(REQUIRED_AFTER_JOIN_DROP))
    require_df_columns(dropped, REQUIRED_AFTER_JOIN, "After spatial join")
    return dropped
