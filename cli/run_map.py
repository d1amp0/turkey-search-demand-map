#!/usr/bin/env python3
"""CLI entry: search logs → map-ready province CSVs."""

from __future__ import annotations

import argparse
from pathlib import Path

from cli.constants import REQUIRED_LOG_COLUMNS
from cli.errors import die
from cli.pipeline import PipelineOptions, PipelinePaths, run_pipeline
from cli.translate import TRANSLATION_MODEL


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description=(
            "Read JSONL logs, strip model_response_full into org_* fields, "
            "filter by GeoJSON, optionally clean queries, translate org_type (HF), "
            "assign categories (BGE), write df_with_cat.csv, and split into data/provinces/."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python -m cli.run_map --logs data/batch.jsonl --geojson data/tr-cities.json\n"
            "  python -m cli.run_map --logs data/batch.jsonl --geojson data/tr-cities.json "
            "--exclude-queries data/turkish_trash.txt\n"
            "\n"
            "Each non-empty line of --logs must be a JSON object with these keys (all required): "
            f"{', '.join(sorted(REQUIRED_LOG_COLUMNS))}."
        ),
    )
    parser.add_argument("--logs", type=Path, required=True, help="Input JSONL path.")
    parser.add_argument(
        "--geojson",
        type=Path,
        required=True,
        help="GeoJSON with province polygons for point-in-polygon filter.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "data" / "df_with_cat.csv",
        help="Output CSV with org_type_en and category.",
    )
    parser.add_argument(
        "--provinces-dir",
        type=Path,
        default=root / "data" / "provinces",
        help="Directory for per-province CSV files ({number}.csv).",
    )
    parser.add_argument("--translate-batch-size", type=int, default=32)
    parser.add_argument(
        "--translation-model",
        default=TRANSLATION_MODEL,
        help=(
            "Hugging Face translation model. Hy-MT2 options include "
            "tencent/Hy-MT2-1.8B, tencent/Hy-MT2-7B, and tencent/Hy-MT2-30B-A3B."
        ),
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=("cpu", "cuda", "mps"),
        help="Device for Hugging Face translation model.",
    )
    parser.add_argument(
        "--drop-min-count",
        type=int,
        metavar="N",
        default=None,
        help="Drop rows whose query appears at least N times.",
    )
    parser.add_argument(
        "--exclude-queries",
        type=Path,
        metavar="PATH",
        default=None,
        help="Text file: one exact query per line to remove.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logs_path = args.logs.expanduser().resolve()
    geojson_path = args.geojson.expanduser().resolve()

    if not logs_path.is_file():
        die(f"Logs file not found: {logs_path}")
    if not geojson_path.is_file():
        die(f"GeoJSON file not found: {geojson_path}")
    if args.drop_min_count is not None and args.drop_min_count < 1:
        die("--drop-min-count must be a positive integer.")
    if args.translate_batch_size < 1:
        die("--translate-batch-size must be at least 1.")

    exclude_queries_path = (
        args.exclude_queries.expanduser().resolve()
        if args.exclude_queries is not None
        else None
    )

    run_pipeline(
        PipelinePaths(
            logs=logs_path,
            geojson=geojson_path,
            output=args.output.expanduser().resolve(),
            provinces_dir=args.provinces_dir.expanduser().resolve(),
        ),
        PipelineOptions(
            exclude_queries_path=exclude_queries_path,
            drop_min_count=args.drop_min_count,
            translate_batch_size=args.translate_batch_size,
            translation_model=args.translation_model,
            device=args.device,
        ),
    )


if __name__ == "__main__":
    main()
