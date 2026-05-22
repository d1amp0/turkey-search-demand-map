"""Split categorized dataframe into per-province CSV files."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from tqdm import tqdm

from cli.errors import require_df_columns

PROVINCE_OUTPUT_COLUMNS = ("org_name", "time", "category", "org_rating")


def split_by_province(df: pd.DataFrame, provinces_dir: Path) -> int:
    """Write one CSV per province number (ds/splitting/province_split.ipynb)."""
    require_df_columns(df, ("number", *PROVINCE_OUTPUT_COLUMNS), "Province split")

    provinces_dir.mkdir(parents=True, exist_ok=True)
    numbers = sorted(df["number"].dropna().unique())
    written = 0

    for number in tqdm(numbers, desc="Split provinces", unit="province"):
        province_num = int(number)
        slice_df = df.loc[df["number"] == number, list(PROVINCE_OUTPUT_COLUMNS)]
        slice_df.to_csv(
            provinces_dir / f"{province_num}.csv",
            index=False,
            encoding="utf-8-sig",
        )
        written += 1

    return written
