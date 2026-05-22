"""Orchestrate the full JSONL → provinces pipeline."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from tqdm import tqdm

from cli.categorize import categorize_dataframe
from cli.constants import REQUIRED_AFTER_SLIM_COLUMNS
from cli.errors import die, require_df_columns
from cli.queries import filter_queries
from cli.slim import slim_jsonl
from cli.spatial import filter_by_map
from cli.split import split_by_province
from cli.translate import TRANSLATION_MODEL


@dataclass(frozen=True)
class PipelinePaths:
    logs: Path
    geojson: Path
    output: Path
    provinces_dir: Path


@dataclass(frozen=True)
class PipelineOptions:
    exclude_queries_path: Path | None = None
    drop_min_count: int | None = None
    translate_batch_size: int = 32
    translation_model: str = TRANSLATION_MODEL
    device: str = "cpu"


def run_pipeline(paths: PipelinePaths, options: PipelineOptions) -> None:
    paths.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".jsonl",
        delete=False,
        encoding="utf-8",
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        n_written = slim_jsonl(paths.logs, tmp_path)
        tqdm.write(f"Slim JSONL: wrote {n_written} records to temporary file.")

        chunks: list[pd.DataFrame] = []
        chunk_reader = pd.read_json(tmp_path, lines=True, chunksize=100_000)
        for chunk in tqdm(chunk_reader, desc="Load DataFrame", unit="chunk"):
            require_df_columns(
                chunk,
                REQUIRED_AFTER_SLIM_COLUMNS,
                "After loading slimmed JSONL",
            )
            chunks.append(chunk)
        if not chunks:
            die("After slimming: no data rows found (empty JSONL).")
        df = pd.concat(chunks, ignore_index=True)

        tqdm.write("Spatial join: point-in-polygon against GeoJSON…")
        df = filter_by_map(df, paths.geojson)

        require_df_columns(df, ("query", "model_response_timestamp"), "Before query filter")
        df["time"] = pd.to_datetime(
            df["model_response_timestamp"], unit="s", utc=True, errors="coerce"
        )
        df = filter_queries(
            df,
            exclude_queries_path=options.exclude_queries_path,
            drop_min_count=options.drop_min_count,
        )

        tqdm.write("Categorization: HF translation + BGE labels…")
        df_with_cat = categorize_dataframe(
            df,
            translate_batch_size=options.translate_batch_size,
            translation_model=options.translation_model,
            device=options.device,
        )

        df_with_cat.to_csv(paths.output, index=False, encoding="utf-8")
        tqdm.write(f"Wrote {len(df_with_cat)} rows to {paths.output}")

        tqdm.write(f"Province split: writing to {paths.provinces_dir}…")
        n_provinces = split_by_province(df_with_cat, paths.provinces_dir)
        tqdm.write(f"Done: wrote {n_provinces} province file(s) under {paths.provinces_dir}")
    finally:
        tmp_path.unlink(missing_ok=True)
