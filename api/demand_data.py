from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Literal, TypedDict

import pandas as pd

from api.region_data import load_city_geojson
from api.settings import PROVINCES_DIR


MetricName = Literal[
    "searches",
    "no_result_rate",
    "avg_rating",
    "avg_steps",
    "source_coverage",
]

METRICS: dict[MetricName, dict[str, str]] = {
    "searches": {
        "label": "Searches",
        "format": "integer",
        "description": "Total search requests in the selected slice.",
    },
    "no_result_rate": {
        "label": "No-result rate",
        "format": "percent",
        "description": "Share of searches that did not return organizations.",
    },
    "avg_rating": {
        "label": "Average rating",
        "format": "decimal",
        "description": "Average rating of organizations returned by search.",
    },
    "avg_steps": {
        "label": "Average steps",
        "format": "decimal",
        "description": "Average number of steps needed to reach a useful result.",
    },
    "source_coverage": {
        "label": "Source coverage",
        "format": "percent",
        "description": "Share of searches with at least one source attached.",
    },
}

CATEGORIES = ("restaurants", "hotels", "clinics", "transport", "shops")


class DemandFilters(TypedDict, total=False):
    hours: str | None
    weekdays: str | None
    provinces: str | None
    categories: str | None
    results: str | None
    rating: str | None
    steps: str | None
    sources: str | None


def _stable_int(*parts: object) -> int:
    value = ":".join(str(part) for part in parts)
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


@lru_cache(maxsize=1)
def get_demand_dataframe() -> pd.DataFrame:
    """Build a deterministic demo dataframe shaped like production search logs."""
    geojson_data = load_city_geojson()
    rows: list[dict[str, Any]] = []
    start_day = date.today() - timedelta(days=29)

    for feature in geojson_data.get("features", []):
        properties = feature.get("properties", {})
        province_number = int(properties["number"])
        province_name = str(properties["name"])
        province_seed = _stable_int(province_number, province_name)
        base_demand = 60 + province_seed % 260

        for day_offset in range(30):
            current_day = start_day + timedelta(days=day_offset)
            weekday_factor = 1.16 if current_day.weekday() in {4, 5} else 1.0

            for hour in (0, 6, 9, 12, 15, 18, 21):
                hour_factor = 1.35 if hour in {12, 15, 18} else 0.82

                for category in CATEGORIES:
                    category_seed = _stable_int(province_number, current_day, hour, category)
                    category_factor = 0.72 + (category_seed % 55) / 100
                    searches = int(base_demand * weekday_factor * hour_factor * category_factor)
                    no_result_count = int(searches * (0.06 + (category_seed % 18) / 100))
                    source_count = int(searches * (0.52 + (category_seed % 34) / 100))

                    rows.append(
                        {
                            "date": current_day.isoformat(),
                            "weekday": current_day.strftime("%a"),
                            "hour": hour,
                            "province_number": province_number,
                            "province_name": province_name,
                            "category": category,
                            "searches": searches,
                            "no_result_count": no_result_count,
                            "source_count": min(source_count, searches),
                            "avg_rating": round(3.1 + (category_seed % 170) / 100, 2),
                            "avg_steps": round(1.4 + (category_seed % 62) / 10, 1),
                        }
                    )

    return pd.DataFrame(rows)


def _summary_from_frame(frame: pd.DataFrame) -> dict[str, float | int]:
    searches = int(frame["searches"].sum())

    if searches == 0:
        return {
            "searches": 0,
            "no_result_rate": 0,
            "avg_rating": 0,
            "avg_steps": 0,
            "source_coverage": 0,
        }

    return {
        "searches": searches,
        "no_result_rate": round(float(frame["no_result_count"].sum() / searches), 4),
        "avg_rating": round(float((frame["avg_rating"] * frame["searches"]).sum() / searches), 2),
        "avg_steps": round(float((frame["avg_steps"] * frame["searches"]).sum() / searches), 2),
        "source_coverage": round(float(frame["source_count"].sum() / searches), 4),
    }


def _metric_value(summary: dict[str, float | int], metric: MetricName) -> float | int:
    return summary[metric]


def _split_filter(value: str | None) -> list[str]:
    if not value:
        return []

    return [item.strip() for item in value.split(",") if item.strip()]


def _hours_from_ranges(ranges: list[str]) -> set[int]:
    hours: set[int] = set()

    for hour_range in ranges:
        if "-" not in hour_range:
            continue

        start_text, end_text = hour_range.split("-", 1)
        start_hour = int(start_text)
        end_hour = int(end_text)
        hours.update(range(start_hour, end_hour + 1))

    return hours


def _step_mask(frame: pd.DataFrame, ranges: list[str]) -> pd.Series:
    mask = pd.Series(False, index=frame.index)

    for step_range in ranges:
        if step_range.endswith("+"):
            mask = mask | (frame["avg_steps"] >= float(step_range.rstrip("+")))
            continue

        if "-" not in step_range:
            continue

        start_text, end_text = step_range.replace(" steps", "").split("-", 1)
        mask = mask | frame["avg_steps"].between(float(start_text), float(end_text))

    return mask


def apply_demand_filters(
    frame: pd.DataFrame,
    filters: DemandFilters | None = None,
) -> pd.DataFrame:
    if not filters:
        return frame.copy()

    filtered = frame.copy()
    hour_ranges = _split_filter(filters.get("hours"))
    weekdays = _split_filter(filters.get("weekdays"))
    provinces = _split_filter(filters.get("provinces"))
    categories = _split_filter(filters.get("categories"))
    result_states = _split_filter(filters.get("results"))
    step_ranges = _split_filter(filters.get("steps"))
    source_states = _split_filter(filters.get("sources"))
    rating = filters.get("rating")

    if hour_ranges:
        filtered = filtered[filtered["hour"].isin(_hours_from_ranges(hour_ranges))]

    if weekdays:
        filtered = filtered[filtered["weekday"].isin(weekdays)]

    if provinces:
        province_numbers = {int(province) for province in provinces}
        filtered = filtered[filtered["province_number"].isin(province_numbers)]

    if categories:
        filtered = filtered[filtered["category"].isin(categories)]

    if rating and rating != "Any rating":
        filtered = filtered[filtered["avg_rating"] >= float(rating.rstrip("+"))]

    if step_ranges:
        filtered = filtered[_step_mask(filtered, step_ranges)]

    if not filtered.empty and result_states and len(result_states) == 1:
        filtered = filtered.copy()

        if result_states[0] == "No organizations":
            filtered["searches"] = filtered["no_result_count"]
            filtered["source_count"] = 0
        elif result_states[0] == "Organizations found":
            filtered["searches"] = filtered["searches"] - filtered["no_result_count"]
            filtered["no_result_count"] = 0
            filtered["source_count"] = filtered[["source_count", "searches"]].min(axis=1)

    if not filtered.empty and source_states and len(source_states) == 1:
        filtered = filtered.copy()

        if source_states[0] == "Has sources":
            filtered["searches"] = filtered["source_count"]
            filtered["no_result_count"] = filtered[["no_result_count", "searches"]].min(axis=1)
        elif source_states[0] == "No sources":
            filtered["searches"] = filtered["searches"] - filtered["source_count"]
            filtered["source_count"] = 0
            filtered["no_result_count"] = filtered[["no_result_count", "searches"]].min(axis=1)

    return filtered[filtered["searches"] > 0]


def get_metric_catalog() -> dict[str, Any]:
    return {
        "default_metric": "searches",
        "metrics": [
            {"key": key, **metadata}
            for key, metadata in METRICS.items()
        ],
    }


def get_region_values(
    metric: MetricName = "searches",
    filters: DemandFilters | None = None,
) -> dict[str, Any]:
    frame = apply_demand_filters(get_demand_dataframe(), filters)
    values: dict[str, Any] = {}

    for province_number, province_frame in frame.groupby("province_number"):
        summary = _summary_from_frame(province_frame)
        values[str(province_number)] = {
            "name": str(province_frame["province_name"].iloc[0]),
            "value": _metric_value(summary, metric),
            "summary": summary,
        }

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "key": "province_number",
        "metric": metric,
        "metric_catalog": get_metric_catalog()["metrics"],
        "values": values,
    }


def _time_series(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    next_frame = frame.copy()
    next_frame["timestamp"] = pd.to_datetime(next_frame["date"]) + pd.to_timedelta(
        next_frame["hour"],
        unit="h",
    )

    return (
        next_frame.groupby("timestamp", as_index=False)["searches"]
        .sum()
        .sort_values("timestamp")
        .assign(timestamp=lambda item: item["timestamp"].dt.strftime("%Y-%m-%dT%H:00:00"))
        .to_dict("records")
    )


def _top_organizations(
    frame: pd.DataFrame,
    limit: int = 10,
) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    rows: list[dict[str, Any]] = []

    for item in frame.itertuples(index=False):
        for rank in range(1, 4):
            seed = _stable_int(item.province_number, item.category, item.date, item.hour, rank)
            searches = max(1, int(item.searches * (0.44 - rank * 0.08)))
            rating = round(min(5.0, float(item.avg_rating) + (seed % 18) / 100 - 0.06), 2)
            rows.append(
                {
                    "name": f"{item.province_name} {str(item.category).title()} #{rank}",
                    "category": item.category,
                    "rating": rating,
                    "searches": searches,
                }
            )

    organization_frame = pd.DataFrame(rows)

    if organization_frame.empty:
        return []

    return (
        organization_frame.groupby(["name", "category"], as_index=False)
        .agg(
            rating=("rating", "mean"),
            searches=("searches", "sum"),
        )
        .assign(rating=lambda item: item["rating"].round(2))
        .sort_values(["rating", "searches"], ascending=[False, False])
        .head(max(1, min(limit, 10)))
        .to_dict("records")
    )


def _province_name(province_number: int) -> str | None:
    for feature in load_city_geojson().get("features", []):
        properties = feature.get("properties", {})

        if int(properties["number"]) == province_number:
            return str(properties["name"])

    return None


def _load_province_csv(
    province_number: int,
    filters: DemandFilters | None = None,
) -> list[dict[str, Any]] | None:
    csv_path = PROVINCES_DIR / f"{province_number}.csv"

    if not csv_path.exists():
        return None

    frame = pd.read_csv(
        csv_path,
        usecols=["org_name", "time", "category", "org_rating"],
    )
    frame = frame.where(pd.notna(frame), None)

    if filters:
        hour_ranges = _split_filter(filters.get("hours"))
        weekdays = _split_filter(filters.get("weekdays"))
        categories = _split_filter(filters.get("categories"))
        rating = filters.get("rating")

        if hour_ranges or weekdays:
            parsed_time = pd.to_datetime(frame["time"], errors="coerce")

            if hour_ranges:
                hours = _hours_from_ranges(hour_ranges)
                frame = frame[parsed_time.dt.hour.isin(hours)]

            if weekdays:
                frame = frame[parsed_time.dt.strftime("%a").isin(weekdays)]

        if categories:
            frame = frame[frame["category"].isin(categories)]

        if rating and rating != "Any rating":
            rating_values = pd.to_numeric(frame["org_rating"], errors="coerce")
            frame = frame[rating_values >= float(rating.rstrip("+"))]

    return frame.to_dict(orient="records")


def get_overview(
    metric: MetricName = "searches",
    filters: DemandFilters | None = None,
) -> dict[str, Any]:
    frame = apply_demand_filters(get_demand_dataframe(), filters)
    summary = _summary_from_frame(frame)
    provinces = get_region_values(metric, filters)["values"]
    ranked = sorted(
        (
            {
                "province_number": int(province_number),
                "name": value["name"],
                "value": value["value"],
                "summary": value["summary"],
            }
            for province_number, value in provinces.items()
        ),
        key=lambda item: item["value"],
        reverse=True,
    )

    by_date = (
        frame.groupby("date", as_index=False)["searches"]
        .sum()
        .sort_values("date")
        .to_dict("records")
    )
    category = (
        frame.groupby("category", as_index=False)["searches"]
        .sum()
        .sort_values("searches", ascending=False)
        .to_dict("records")
    )
    hourly = (
        frame.groupby("hour", as_index=False)["searches"]
        .sum()
        .sort_values("hour")
        .to_dict("records")
    )

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "metric": metric,
        "summary": summary,
        "top_provinces": ranked[:8],
        "daily_searches": by_date,
        "time_series": _time_series(frame),
        "category_breakdown": category,
        "hourly_distribution": hourly,
        "top_organizations": _top_organizations(frame),
    }


def get_province_detail(
    province_number: int,
    filters: DemandFilters | None = None,
) -> list[dict[str, Any]] | None:
    return _load_province_csv(province_number, filters)
