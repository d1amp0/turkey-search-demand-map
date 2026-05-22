"""Optional query cleanup after spatial join."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from tqdm import tqdm

from cli.errors import die, require_df_columns


def load_exclude_queries(path: Path) -> set[str]:
    if not path.is_file():
        die(f"Exclude-queries file not found: {path}")

    queries: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            queries.add(text)

    if not queries:
        die(f"Exclude-queries file has no query lines: {path}")
    return queries


def filter_queries(
    df: pd.DataFrame,
    *,
    exclude_queries_path: Path | None,
    drop_min_count: int | None,
) -> pd.DataFrame:
    if exclude_queries_path is None and drop_min_count is None:
        return df

    require_df_columns(df, ("query",), "Query filter")
    before = len(df)

    if exclude_queries_path is not None:
        excluded = load_exclude_queries(exclude_queries_path)
        mask = ~df["query"].isin(excluded)
        removed = before - int(mask.sum())
        df = df.loc[mask]
        tqdm.write(
            f"Query filter (--exclude-queries): removed {removed} row(s) "
            f"matching {len(excluded)} excluded query string(s)."
        )
        before = len(df)

    if drop_min_count is not None:
        counts = df["query"].value_counts()
        frequent = counts[counts >= drop_min_count].index
        if len(frequent) == 0:
            tqdm.write(
                f"Query filter (--drop-min-count {drop_min_count}): "
                "no queries met the threshold."
            )
        else:
            mask = ~df["query"].isin(frequent)
            removed = before - int(mask.sum())
            df = df.loc[mask]
            tqdm.write(
                f"Query filter (--drop-min-count {drop_min_count}): removed {removed} row(s) "
                f"from {len(frequent)} query string(s) with count >= {drop_min_count}."
            )

    return df
