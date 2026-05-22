"""CLI error helpers."""

from __future__ import annotations

import sys
from typing import Iterable

import pandas as pd


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def require_df_columns(
    df: pd.DataFrame,
    required: Iterable[str],
    stage: str,
) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        die(
            f"{stage}: missing column(s): {missing}. "
            f"Present columns: {list(df.columns)}"
        )
