"""Memory-safe JSONL cleaner for model response organization fields.

This script reads a large JSONL file line by line, parses only the
`model_response_full` column from each row, extracts the first organization
found in the model response, removes the heavy `model_response_full` payload,
keeps the rest of the original row fields, and adds:

    org_found, org_name, org_type, org_rating, org_lat, org_lon

It intentionally does not use pandas and does not load the whole file into
memory. Example:

    python ds/preprocessing/memory_free.py batch_00000.jsonl

By default the output is written next to the input as
`batch_00000.parsed.jsonl`. Use `--output path.jsonl` to choose another path.
Use `--in-place` only when you want to replace the source file after a
successful parse.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Iterable


OUTPUT_FIELDS = (
    "org_found",
    "org_name",
    "org_type",
    "org_rating",
    "org_lat",
    "org_lon",
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


def clean_row(row: dict[str, Any]) -> dict[str, Any]:
    cleaned_row = {
        key: value
        for key, value in row.items()
        if key != "model_response_full"
    }
    cleaned_row.update(extract_org_fields(row))
    return cleaned_row


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.parsed{input_path.suffix}")


def clean_jsonl(input_path: Path, output_path: Path) -> tuple[int, int]:
    total_rows = 0
    bad_rows = 0

    with (
        input_path.open("r", encoding="utf-8") as input_file,
        output_path.open("w", encoding="utf-8") as output_file,
    ):
        for line_number, line in enumerate(input_file, start=1):
            if not line.strip():
                continue

            total_rows += 1

            try:
                row = json.loads(line)
                cleaned_row = clean_row(row)
            except (TypeError, json.JSONDecodeError):
                bad_rows += 1
                cleaned_row = {
                    "org_found": False,
                    "org_name": None,
                    "org_type": None,
                    "org_rating": None,
                    "org_lat": None,
                    "org_lon": None,
                }

            output_file.write(
                json.dumps(cleaned_row, ensure_ascii=False, separators=(",", ":"))
            )
            output_file.write("\n")

            if line_number % 100_000 == 0:
                print(f"processed {line_number} lines")

    return total_rows, bad_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract organization fields from model_response_full in JSONL.",
    )
    parser.add_argument("input", type=Path, help="Source JSONL file.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Output JSONL file. Defaults to <input>.parsed.jsonl.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Replace input file after writing a temporary parsed file.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = args.input

    if args.in_place and args.output:
        raise SystemExit("--output cannot be used together with --in-place")

    if not input_path.exists():
        raise SystemExit(f"Input file does not exist: {input_path}")

    output_path = args.output or default_output_path(input_path)

    if args.in_place:
        output_path = input_path.with_name(f".{input_path.name}.parsed.tmp")

    total_rows, bad_rows = clean_jsonl(input_path, output_path)

    if args.in_place:
        os.replace(output_path, input_path)

    print(
        f"done: rows={total_rows}, bad_rows={bad_rows}, output={input_path if args.in_place else output_path}"
    )


if __name__ == "__main__":
    main()
