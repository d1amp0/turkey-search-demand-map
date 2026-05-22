"""Shared column requirements for the data pipeline."""

from __future__ import annotations

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

REQUIRED_AFTER_JOIN_DROP: tuple[str, ...] = ("region_name", "geometry", "index_right")
REQUIRED_AFTER_JOIN: tuple[str, ...] = (
    "name",
    "number",
    "org_name",
    "org_type",
    "org_rating",
)

DROP_JSONL_KEYS: frozenset[str] = frozenset(
    {"model_response_full", "prod_classifier_agent", "message_id"}
)
