"""Slim JSONL logs: extract org fields, drop heavy columns."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from tqdm import tqdm

from cli.constants import DROP_JSONL_KEYS, REQUIRED_LOG_COLUMNS
from cli.errors import die


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


def slim_jsonl_row(row: dict[str, Any]) -> dict[str, Any]:
    slim = {k: v for k, v in row.items() if k not in DROP_JSONL_KEYS}
    slim.update(extract_org_fields(row))
    return slim


def _validate_log_row(row: Any, line_no: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        die(f"Slim JSONL: line {line_no} is not a JSON object (expected an object with columns).")
    missing = sorted(REQUIRED_LOG_COLUMNS - row.keys())
    if missing:
        die(
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
                die(f"Slim JSONL: invalid JSON at line {line_no}: {e}")
            row = _validate_log_row(raw, line_no)
            out_row = slim_jsonl_row(row)
            fout.write(json.dumps(out_row, ensure_ascii=False, separators=(",", ":")))
            fout.write("\n")
            written += 1
    return written
