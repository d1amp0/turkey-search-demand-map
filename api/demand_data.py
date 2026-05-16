from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Literal

import pandas as pd

from api.region_data import load_city_geojson


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


def get_metric_catalog() -> dict[str, Any]:
    return {
        "default_metric": "searches",
        "metrics": [
            {"key": key, **metadata}
            for key, metadata in METRICS.items()
        ],
    }


def get_region_values(metric: MetricName = "searches") -> dict[str, Any]:
    frame = get_demand_dataframe()
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


def get_overview(metric: MetricName = "searches") -> dict[str, Any]:
    frame = get_demand_dataframe()
    summary = _summary_from_frame(frame)
    provinces = get_region_values(metric)["values"]
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
        "category_breakdown": category,
        "hourly_distribution": hourly,
    }


def get_province_detail(province_number: int) -> dict[str, Any] | None:
    frame = get_demand_dataframe()
    province_frame = frame[frame["province_number"] == province_number]

    if province_frame.empty:
        return None

    summary = _summary_from_frame(province_frame)
    daily = (
        province_frame.groupby("date", as_index=False)["searches"]
        .sum()
        .sort_values("date")
        .to_dict("records")
    )
    category = (
        province_frame.groupby("category", as_index=False)["searches"]
        .sum()
        .sort_values("searches", ascending=False)
        .to_dict("records")
    )
    hourly = (
        province_frame.groupby("hour", as_index=False)["searches"]
        .sum()
        .sort_values("hour")
        .to_dict("records")
    )

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "province_number": province_number,
        "name": str(province_frame["province_name"].iloc[0]),
        "summary": summary,
        "daily_searches": daily,
        "category_breakdown": category,
        "hourly_distribution": hourly,
    }
