"""Pipeline: slim JSONL logs → filter by GeoJSON map → save CSV for the map."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
from tqdm import tqdm

# Every JSONL object must contain these keys (same shape as project logs); extras are allowed.
REQUIRED_LOG_COLUMNS: frozenset[str] = frozenset(
    {
        "latitude",
        "longitude",
        "message_id",
        "model_response_full",
        "model_response_timestamp",
        "prod_classifier_agent",
        "query",
        "region_id",
        "region_name",
    }
)

# After slimming, these must still be present (plus org_* added by the script).
REQUIRED_AFTER_SLIM_COLUMNS: frozenset[str] = frozenset(
    {
        "latitude",
        "longitude",
        "model_response_timestamp",
        "query",
        "region_id",
        "region_name",
        "org_found",
        "org_name",
        "org_type",
        "org_rating",
        "org_lat",
        "org_lon",
    }
)

# After spatial join, these columns must exist so we can drop them as in cleaning.ipynb.
REQUIRED_AFTER_JOIN_DROP: tuple[str, ...] = ("region_name", "geometry", "index_right")


def _die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def _require_df_columns(df: pd.DataFrame, required: Iterable[str], stage: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        _die(
            f"{stage}: missing column(s): {missing}. "
            f"Present columns: {list(df.columns)}"
        )


def parse_json_if_possible(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped or stripped[0] not in "[{":
        return value
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def iter_nested_json_values(value: Any) -> Iterable[Any]:
    value = parse_json_if_possible(value)
    yield value
    if isinstance(value, dict):
        for nested_value in value.values():
            yield from iter_nested_json_values(nested_value)
    elif isinstance(value, list):
        for nested_value in value:
            yield from iter_nested_json_values(nested_value)


def find_first_organization(model_response_full: Any) -> dict[str, Any] | None:
    for value in iter_nested_json_values(model_response_full):
        if not isinstance(value, dict):
            continue
        organization_list = value.get("OrganizationList")
        if not isinstance(organization_list, dict):
            continue
        organizations = organization_list.get("Organizations")
        if isinstance(organizations, list) and organizations:
            first_organization = organizations[0]
            if isinstance(first_organization, dict):
                return first_organization
    return None


def extract_org_fields(row: dict[str, Any]) -> dict[str, Any]:
    organization = find_first_organization(row.get("model_response_full"))
    if organization is None:
        return {
            "org_found": False,
            "org_name": None,
            "org_type": None,
            "org_rating": None,
            "org_lat": None,
            "org_lon": None,
        }
    coords = organization.get("coords")
    rating = organization.get("rating")
    return {
        "org_found": True,
        "org_name": organization.get("title") or organization.get("short_title"),
        "org_type": organization.get("subtitle") or organization.get("type"),
        "org_rating": rating.get("rating") if isinstance(rating, dict) else None,
        "org_lat": coords.get("lat") if isinstance(coords, dict) else None,
        "org_lon": coords.get("long") if isinstance(coords, dict) else None,
    }


DROP_KEYS = frozenset({"model_response_full", "prod_classifier_agent", "message_id"})


def slim_jsonl_row(row: dict[str, Any]) -> dict[str, Any]:
    """Strip heavy fields and classifier noise; keep org summary from model_response_full."""
    slim = {k: v for k, v in row.items() if k not in DROP_KEYS}
    slim.update(extract_org_fields(row))
    return slim


def _validate_log_row(row: Any, line_no: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        _die(f"Slim JSONL: line {line_no} is not a JSON object (expected an object with columns).")
    missing = sorted(REQUIRED_LOG_COLUMNS - row.keys())
    if missing:
        _die(
            f"Slim JSONL: line {line_no} missing required column(s): {missing}. "
            f"Required keys: {sorted(REQUIRED_LOG_COLUMNS)}"
        )
    return row


def slim_jsonl(input_path: Path, output_path: Path) -> int:
    written = 0
    with input_path.open("r", encoding="utf-8") as fin, output_path.open(
        "w", encoding="utf-8"
    ) as fout:
        for line_no, line in enumerate(tqdm(fin, desc="Slim JSONL", unit="line"), start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as e:
                _die(f"Slim JSONL: invalid JSON at line {line_no}: {e}")
            row = _validate_log_row(raw, line_no)
            out_row = slim_jsonl_row(row)
            fout.write(json.dumps(out_row, ensure_ascii=False, separators=(",", ":")))
            fout.write("\n")
            written += 1
    return written


def filter_by_map(df: pd.DataFrame, geojson_path: Path) -> pd.DataFrame:
    """Keep only points inside GeoJSON polygons (same idea as ds/preprocessing/cleaning.ipynb)."""
    _require_df_columns(df, ("latitude", "longitude"), "Spatial join (input)")
    turkey_map = gpd.read_file(geojson_path)
    geometry = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
    requests_gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    turkey_map = turkey_map.to_crs("EPSG:4326")
    df_clean = gpd.sjoin(requests_gdf, turkey_map, how="inner", predicate="within")
    missing = [c for c in REQUIRED_AFTER_JOIN_DROP if c not in df_clean.columns]
    if missing:
        _die(
            "Spatial join: expected column(s) not present after join "
            f"(needed before drop): {missing}. Columns: {list(df_clean.columns)}"
        )
    return df_clean.drop(columns=list(REQUIRED_AFTER_JOIN_DROP))


def load_exclude_queries(path: Path) -> set[str]:
    if not path.is_file():
        _die(f"Exclude-queries file not found: {path}")

    queries: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            queries.add(text)

    if not queries:
        _die(f"Exclude-queries file has no query lines: {path}")

    return queries


def filter_queries(
    df: pd.DataFrame,
    *,
    exclude_queries_path: Path | None,
    drop_min_count: int | None,
) -> pd.DataFrame:
    """Optionally drop rows by exact query match or by query frequency."""
    if exclude_queries_path is None and drop_min_count is None:
        return df

    _require_df_columns(df, ("query",), "Query filter")
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


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description=(
            "Read JSONL logs, strip model_response_full into org_* fields, "
            "keep rows whose coordinates fall inside the GeoJSON map, then write CSV."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        epilog=(
            "Examples:\n"
            "  %(prog)s --logs data/batch.jsonl --geojson data/tr-cities.json\n"
            "  %(prog)s --logs data/batch.jsonl --geojson data/tr-cities.json "
            "--exclude-queries data/turkish_trash.txt\n"
            "  %(prog)s --logs data/batch.jsonl --geojson data/tr-cities.json --drop-min-count 500\n"
            "\n"
            "Each non-empty line of --logs must be a JSON object with these keys (all required): "
            f"{', '.join(sorted(REQUIRED_LOG_COLUMNS))}."
        ),
    )
    parser.add_argument(
        "--logs",
        type=Path,
        required=True,
        help="Path to input JSONL (one log record per line).",
    )
    parser.add_argument(
        "--geojson",
        type=Path,
        required=True,
        help="Path to GeoJSON with polygons (e.g. city boundaries) for point-in-polygon filter.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "data" / "df_with_cat.csv",
        help="Output CSV path.",
    )
    parser.add_argument(
        "--drop-min-count",
        type=int,
        metavar="N",
        default=None,
        help=(
            "Drop all rows whose query text appears at least N times in the current dataset "
            "(removes high-frequency system prompts)."
        ),
    )
    parser.add_argument(
        "--exclude-queries",
        type=Path,
        metavar="PATH",
        default=None,
        help=(
            "Path to a text file with one exact query string per line; matching rows are removed. "
            "Lines starting with # and blank lines are ignored."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logs_path = args.logs.expanduser().resolve()
    geojson_path = args.geojson.expanduser().resolve()
    output_path = args.output.expanduser().resolve()

    if not logs_path.is_file():
        _die(f"Logs file not found: {logs_path}")
    if not geojson_path.is_file():
        _die(f"GeoJSON file not found: {geojson_path}")
    if args.drop_min_count is not None and args.drop_min_count < 1:
        _die("--drop-min-count must be a positive integer.")

    exclude_queries_path = (
        args.exclude_queries.expanduser().resolve()
        if args.exclude_queries is not None
        else None
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".jsonl",
        delete=False,
        encoding="utf-8",
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        n_written = slim_jsonl(logs_path, tmp_path)
        tqdm.write(f"Slim JSONL: wrote {n_written} records to temporary file.")

        chunks: list[pd.DataFrame] = []
        chunk_reader = pd.read_json(tmp_path, lines=True, chunksize=100_000)
        for chunk in tqdm(chunk_reader, desc="Load DataFrame", unit="chunk"):
            _require_df_columns(
                chunk,
                REQUIRED_AFTER_SLIM_COLUMNS,
                "After loading slimmed JSONL",
            )
            chunks.append(chunk)
        if not chunks:
            _die("After slimming: no data rows found (empty JSONL).")
        df = pd.concat(chunks, ignore_index=True)

        tqdm.write("Spatial join: point-in-polygon against GeoJSON…")
        df = filter_by_map(df, geojson_path)

        _require_df_columns(df, ("query", "model_response_timestamp"), "Before query filter")
        df["time"] = pd.to_datetime(
            df["model_response_timestamp"], unit="s", utc=True, errors="coerce"
        )
        df = filter_queries(
            df,
            exclude_queries_path=exclude_queries_path,
            drop_min_count=args.drop_min_count,
        )

        tqdm.write(f"Writing CSV ({len(df)} rows)…")
        df.to_csv(output_path, index=False, encoding="utf-8")
        tqdm.write(f"Done: wrote {len(df)} rows to {output_path}")
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
