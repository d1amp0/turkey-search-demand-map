from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Literal, TypedDict

import pandas as pd

from api.region_data import load_city_geojson
from api.settings import FULL_DEMAND_CSV_PATHS, PROVINCES_DIR


MetricName = Literal["searches", "avg_rating"]

METRICS: dict[MetricName, dict[str, str]] = {
    "searches": {
        "label": "Searches",
        "format": "integer",
        "description": "Total search requests in the selected slice.",
    },
    "avg_rating": {
        "label": "Average rating",
        "format": "decimal",
        "description": "Average rating of organizations returned by search.",
    },
}


class DemandFilters(TypedDict, total=False):
    hours: str | None
    weekdays: str | None
    provinces: str | None
    categories: str | None
    rating: str | None


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
        hours.update(range(int(start_text), int(end_text) + 1))

    return hours


def _province_names() -> dict[int, str]:
    return {
        int(feature["properties"]["number"]): str(feature["properties"]["name"])
        for feature in load_city_geojson().get("features", [])
    }


@lru_cache(maxsize=1)
def get_demand_dataframe() -> pd.DataFrame:
    """Load real province CSV files and normalize them for analytics endpoints."""
    full_demand_csv_path = next(
        (path for path in FULL_DEMAND_CSV_PATHS if path.exists()),
        None,
    )

    if full_demand_csv_path:
        demand = pd.read_csv(
            full_demand_csv_path,
            usecols=[
                "latitude",
                "longitude",
                "org_name",
                "time",
                "category",
                "org_rating",
                "name",
                "number",
            ],
            encoding="utf-8-sig",
        )
        demand = demand.rename(
            columns={
                "name": "province_name",
                "number": "province_number",
            },
        )
        demand["latitude"] = pd.to_numeric(demand["latitude"], errors="coerce")
        demand["longitude"] = pd.to_numeric(demand["longitude"], errors="coerce")
    else:
        demand = _load_province_demand_dataframe()

    demand["timestamp"] = pd.to_datetime(demand["time"], errors="coerce")
    demand["date"] = demand["timestamp"].dt.date.astype("string")
    demand["weekday"] = demand["timestamp"].dt.strftime("%a")
    demand["hour"] = demand["timestamp"].dt.hour
    demand["category"] = demand["category"].fillna("Unknown")
    demand["org_name"] = demand["org_name"].fillna("Unknown")
    demand["org_rating"] = pd.to_numeric(demand["org_rating"], errors="coerce")

    return demand[demand["timestamp"].notna()].copy()


def _load_province_demand_dataframe() -> pd.DataFrame:
    province_names = _province_names()
    frames: list[pd.DataFrame] = []

    for csv_path in sorted(PROVINCES_DIR.glob("*.csv")):
        province_number = int(csv_path.stem)
        frame = pd.read_csv(
            csv_path,
            usecols=["org_name", "time", "category", "org_rating"],
            encoding="utf-8-sig",
        )
        frame["province_number"] = province_number
        frame["province_name"] = province_names.get(province_number, str(province_number))
        frames.append(frame)

    if not frames:
        return pd.DataFrame(
            columns=[
                "org_name",
                "time",
                "category",
                "org_rating",
                "province_number",
                "province_name",
                "latitude",
                "longitude",
                "timestamp",
                "date",
                "weekday",
                "hour",
            ],
        )

    demand = pd.concat(frames, ignore_index=True)
    demand["latitude"] = pd.NA
    demand["longitude"] = pd.NA

    return demand


def _summary_from_frame(frame: pd.DataFrame) -> dict[str, float | int]:
    searches = int(len(frame))
    rating_values = frame["org_rating"].dropna()

    return {
        "searches": searches,
        "avg_rating": round(float(rating_values.mean()), 2) if not rating_values.empty else 0,
    }


def _metric_value(summary: dict[str, float | int], metric: MetricName) -> float | int:
    return summary[metric]


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
        filtered = filtered[filtered["org_rating"] >= float(rating.rstrip("+"))]

    return filtered


def get_metric_catalog() -> dict[str, Any]:
    return {
        "default_metric": "searches",
        "metrics": [
            {"key": key, **metadata}
            for key, metadata in METRICS.items()
        ],
    }


def get_category_catalog() -> list[str]:
    frame = get_demand_dataframe()

    if frame.empty:
        return []

    return sorted(str(category) for category in frame["category"].dropna().unique())


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


def get_request_points(filters: DemandFilters | None = None) -> dict[str, Any]:
    frame = apply_demand_filters(get_demand_dataframe(), filters)
    point_frame = frame.dropna(subset=["latitude", "longitude"])

    if point_frame.empty:
        points: list[dict[str, Any]] = []
    else:
        points = (
            point_frame.groupby(
                ["latitude", "longitude"],
                as_index=False,
                dropna=True,
            )
            .size()
            .rename(columns={"size": "searches"})
            .sort_values("searches", ascending=False)
            .to_dict("records")
        )

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "points": points,
    }


def _time_series(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    return (
        frame.groupby("timestamp", as_index=False)
        .size()
        .rename(columns={"size": "searches"})
        .sort_values("timestamp")
        .assign(timestamp=lambda item: item["timestamp"].dt.strftime("%Y-%m-%dT%H:00:00"))
        .to_dict("records")
    )


def _daily_searches(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    return (
        frame.groupby("date", as_index=False)
        .size()
        .rename(columns={"size": "searches"})
        .sort_values("date")
        .to_dict("records")
    )


def _category_breakdown(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    return (
        frame.groupby("category", as_index=False)
        .size()
        .rename(columns={"size": "searches"})
        .sort_values("searches", ascending=False)
        .to_dict("records")
    )


def _hourly_distribution(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    return (
        frame.groupby("hour", as_index=False)
        .size()
        .rename(columns={"size": "searches"})
        .sort_values("hour")
        .to_dict("records")
    )


def _top_organizations(frame: pd.DataFrame, limit: int = 10) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    organization_frame = (
        frame.groupby(["org_name", "category"], as_index=False)
        .agg(
            rating=("org_rating", "mean"),
            searches=("org_name", "size"),
        )
        .assign(rating=lambda item: item["rating"].fillna(0).round(2))
        .sort_values(["rating", "searches"], ascending=[False, False])
        .head(max(1, min(limit, 10)))
    )
    organization_frame = organization_frame.rename(columns={"org_name": "name"})

    return organization_frame.to_dict("records")


def _province_name(province_number: int) -> str | None:
    return _province_names().get(province_number)


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

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "metric": metric,
        "summary": summary,
        "top_provinces": ranked[:8],
        "daily_searches": _daily_searches(frame),
        "time_series": _time_series(frame),
        "category_breakdown": _category_breakdown(frame),
        "hourly_distribution": _hourly_distribution(frame),
        "top_organizations": _top_organizations(frame),
    }


def get_province_detail(
    province_number: int,
    filters: DemandFilters | None = None,
) -> dict[str, Any] | None:
    province_name = _province_name(province_number)

    if province_name is None:
        return None

    frame = apply_demand_filters(get_demand_dataframe(), filters)
    province_frame = frame[frame["province_number"] == province_number]

    if province_frame.empty:
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "province_number": province_number,
            "name": province_name,
            "summary": None,
            "daily_searches": [],
            "time_series": [],
            "category_breakdown": [],
            "hourly_distribution": [],
            "top_organizations": [],
        }

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "province_number": province_number,
        "name": province_name,
        "summary": _summary_from_frame(province_frame),
        "daily_searches": _daily_searches(province_frame),
        "time_series": _time_series(province_frame),
        "category_breakdown": _category_breakdown(province_frame),
        "hourly_distribution": _hourly_distribution(province_frame),
        "top_organizations": _top_organizations(province_frame),
    }
