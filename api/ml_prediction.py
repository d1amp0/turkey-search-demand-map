from __future__ import annotations

import os
from functools import lru_cache
from math import cos, pi, sin
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, Field

from api.demand_data import get_demand_dataframe
from api.settings import MODEL_PATH
from api.settings import MODELS_DIR


FEATURE_COLUMNS = [
    "hour_sin",
    "hour_cos",
    "lag_1",
    "lag_2",
    "lag_24",
    "rolling_mean_3",
    "rolling_mean_6",
    "rolling_mean_24",
    "is_weekend",
    "day_of_week_0",
    "day_of_week_1",
    "day_of_week_2",
    "day_of_week_3",
    "day_of_week_4",
    "day_of_week_5",
    "day_of_week_6",
]

ALLOWED_PREDICTION_PROVINCES = {
    1,
    6,
    7,
    16,
    21,
    27,
    34,
    35,
    38,
    41,
    42,
    66,
}


class PredictionRequest(BaseModel):
    province_number: int = Field(..., ge=1, le=81)
    start_hour: int | None = Field(default=None, ge=0, le=23)
    predict_timestamp: int | str | None = Field(default=None)
    category: str | None = None


class PredictionResponse(BaseModel):
    prediction: float | int | str | list[Any]
    model_path: str
    province_number: int
    prediction_timestamp: str
    start_hour: int | None = None
    category: str | None = None


class RecursivePredictionRequest(BaseModel):
    province_number: int = Field(..., ge=1, le=81)
    start_timestamp: int | str
    hours: int = Field(default=24, ge=1, le=24 * 30)
    category: str | None = None


class RecursivePredictionPoint(BaseModel):
    timestamp: str
    prediction: float


class RecursivePredictionResponse(BaseModel):
    points: list[RecursivePredictionPoint]
    model_path: str
    province_number: int
    start_timestamp: str
    hours: int
    category: str | None = None


def get_model_path() -> Path:
    configured_path = os.getenv("ML_MODEL_PATH")

    if configured_path:
        return Path(configured_path).expanduser().resolve()

    return MODEL_PATH


def get_prediction_model_path(kind: str, province_number: int) -> Path:
    if kind == "category":
        return MODELS_DIR / f"rf_category_model_{province_number}.joblib"

    return MODELS_DIR / f"rf_total_model_{province_number}.joblib"


@lru_cache(maxsize=32)
def load_prediction_model(kind: str, province_number: int) -> Any:
    model_path = get_prediction_model_path(kind, province_number)

    if not model_path.exists():
        raise FileNotFoundError(f"ML model file not found: {model_path}")

    model = joblib.load(model_path)

    if hasattr(model, "n_jobs"):
        model.n_jobs = 1

    return model


@lru_cache(maxsize=1)
def load_model() -> Any:
    model_path = get_model_path()

    if not model_path.exists():
        raise FileNotFoundError(f"ML model file not found: {model_path}")

    model = joblib.load(model_path)

    if hasattr(model, "n_jobs"):
        model.n_jobs = 1

    return model


def _model_feature_columns(model: Any) -> list[str]:
    feature_names = getattr(model, "feature_names_in_", None)

    if feature_names is None:
        return FEATURE_COLUMNS

    return [str(feature_name) for feature_name in feature_names]


def _prediction_to_json(value: Any) -> float | int | str | list[Any]:
    if hasattr(value, "tolist"):
        value = value.tolist()

    if isinstance(value, list):
        if len(value) == 1:
            return _prediction_to_json(value[0])

        return [_prediction_to_json(item) for item in value]

    if isinstance(value, (float, int, str)):
        return value

    return float(value)


def _prediction_to_float(value: Any) -> float:
    json_value = _prediction_to_json(value)

    if isinstance(json_value, list):
        json_value = json_value[0] if json_value else 0

    return max(float(json_value), 0)


def _count_at(values: list[float], offset: int) -> float:
    index = len(values) - offset

    if index < 0:
        return 0

    return float(values[index])


def _rolling_mean(values: list[float], window: int, offset:int) -> float:
    if not values:
        return 0
    if offset == 0:
        window_values = values[-window:]
    else:
        window_values = values[-window - offset:-offset]
    if len(window_values) == 0:
        return 0
    return float(sum(window_values) / len(window_values))


@lru_cache(maxsize=81)
def _hourly_counts_for_province(province_number: int) -> pd.DataFrame:
    demand = get_demand_dataframe()
    province_frame = demand[demand["province_number"] == province_number].copy()

    if province_frame.empty:
        raise HTTPException(status_code=404, detail="Province has no demand data")

    province_frame["prediction_hour"] = province_frame["timestamp"].dt.floor("h")
    hourly_counts = (
        province_frame.groupby("prediction_hour", as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values("prediction_hour")
    )

    all_hours = pd.date_range(
        pd.Timestamp(hourly_counts["prediction_hour"].iloc[0]),
        pd.Timestamp(hourly_counts["prediction_hour"].iloc[-1]),
        freq="h",
    )

    return (
        hourly_counts.set_index("prediction_hour")
        .reindex(all_hours, fill_value=0)
        .rename_axis("prediction_hour")
        .reset_index()
        .assign(count=lambda frame: frame["count"].astype(float))
    )


@lru_cache(maxsize=81)
def _category_hourly_counts_for_province(province_number: int) -> pd.DataFrame:
    demand = get_demand_dataframe()
    province_frame = demand[demand["province_number"] == province_number].copy()

    if province_frame.empty:
        raise HTTPException(status_code=404, detail="Province has no demand data")

    province_frame["prediction_hour"] = province_frame["timestamp"].dt.floor("h")
    province_frame["category"] = province_frame["category"].fillna("unknown").astype(str)
    hourly_counts = (
        province_frame.groupby(["prediction_hour", "category"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["prediction_hour", "category"])
    )

    all_hours = pd.date_range(
        pd.Timestamp(hourly_counts["prediction_hour"].iloc[0]),
        pd.Timestamp(hourly_counts["prediction_hour"].iloc[-1]),
        freq="h",
    )
    categories = sorted(hourly_counts["category"].unique().tolist())
    full_index = pd.MultiIndex.from_product(
        [all_hours, categories],
        names=["prediction_hour", "category"],
    )

    return (
        hourly_counts.set_index(["prediction_hour", "category"])
        .reindex(full_index, fill_value=0)
        .reset_index()
        .assign(count=lambda frame: frame["count"].astype(float))
    )


def _hourly_counts_for_category(province_number: int, category: str) -> pd.DataFrame:
    category_counts = _category_hourly_counts_for_province(province_number)
    hourly_counts = (
        category_counts[category_counts["category"] == category]
        .drop(columns=["category"])
        .reset_index(drop=True)
    )

    if hourly_counts.empty:
        raise HTTPException(
            status_code=400,
            detail="Selected category has no demand history in this province",
        )

    return hourly_counts


def _target_hour_from_timestamp(timestamp: int | str) -> pd.Timestamp:
    try:
        if isinstance(timestamp, str):
            target_hour = pd.Timestamp(timestamp)
        else:
            unit = "ms" if abs(timestamp) > 10_000_000_000 else "s"
            target_hour = pd.Timestamp(pd.to_datetime(timestamp, unit=unit))
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Prediction timestamp must be a valid epoch or ISO datetime",
        ) from error

    if target_hour.tz is not None:
        target_hour = target_hour.tz_convert(None)

    return target_hour.floor("h")


def _resolve_target_hour(
    hourly_counts: pd.DataFrame,
    start_hour: int | None,
    predict_timestamp: int | str | None,
) -> pd.Timestamp:
    first_hour = pd.Timestamp(hourly_counts["prediction_hour"].iloc[0])
    last_hour = pd.Timestamp(hourly_counts["prediction_hour"].iloc[-1])

    if predict_timestamp is not None:
        target_hour = _target_hour_from_timestamp(predict_timestamp)
    elif start_hour is not None:
        matching_hours = hourly_counts[
            hourly_counts["prediction_hour"].dt.hour == start_hour
        ]["prediction_hour"]
        eligible_hours = matching_hours[matching_hours > first_hour]

        if eligible_hours.empty:
            raise HTTPException(
                status_code=400,
                detail="Selected start hour has no previous hour of demand history",
            )

        target_hour = pd.Timestamp(eligible_hours.iloc[-1])
    else:
        target_hour = last_hour + pd.Timedelta(hours=1)

    if target_hour <= first_hour:
        raise HTTPException(
            status_code=400,
            detail="Prediction timestamp must be after the first available demand hour",
        )

    if target_hour > last_hour + pd.Timedelta(hours=1):
        raise HTTPException(
            status_code=400,
            detail="Prediction timestamp is beyond the available one-hour forecast horizon",
        )

    return target_hour


def _features_from_history(
    hourly_counts: pd.DataFrame,
    target_hour: pd.Timestamp,
) -> dict[str, Any]:
    current_hour = target_hour - pd.Timedelta(hours=1)
    history = hourly_counts[hourly_counts["prediction_hour"] <= current_hour]

    if history.empty:
        raise HTTPException(
            status_code=400,
            detail="Selected prediction hour has no demand history",
        )

    counts = [float(value) for value in history["count"].tolist()]
    previous_counts = counts[:-1]
    day_of_week = int(target_hour.dayofweek)

    features = {
        "hour_sin": sin(2 * pi * target_hour.hour / 24),
        "hour_cos": cos(2 * pi * target_hour.hour / 24),
        "lag_1": _count_at(counts, 1),
        "lag_2": _count_at(counts, 2),
        "lag_24": _count_at(counts, 24),
        "rolling_mean_3": _rolling_mean(previous_counts, 3, 1),
        "rolling_mean_6": _rolling_mean(previous_counts, 6, 1),
        "rolling_mean_24": _rolling_mean(previous_counts, 24, 1),
        "is_weekend": int(day_of_week >= 5),
        "day_of_week_0": int(day_of_week == 0),
        "day_of_week_1": int(day_of_week == 1),
        "day_of_week_2": int(day_of_week == 2),
        "day_of_week_3": int(day_of_week == 3),
        "day_of_week_4": int(day_of_week == 4),
        "day_of_week_5": int(day_of_week == 5),
        "day_of_week_6": int(day_of_week == 6),
    }

    return features


def _features_from_counts(
    counts: list[float],
    current_hour: pd.Timestamp,
) -> dict[str, Any]:
    target_hour = current_hour + pd.Timedelta(hour=1)
    day_of_week = int(target_hour.dayofweek)

    return {
        "hour_sin": sin(2 * pi * target_hour.hour / 24),
        "hour_cos": cos(2 * pi * target_hour.hour / 24),
        "lag_1": _count_at(counts, 1),
        "lag_2": _count_at(counts, 2),
        "lag_24": _count_at(counts, 24),
        "rolling_mean_3": _rolling_mean(counts, 3, 1),
        "rolling_mean_6": _rolling_mean(counts, 6, 1),
        "rolling_mean_24": _rolling_mean(counts, 24, 1),
        "is_weekend": int(day_of_week >= 5),
        "day_of_week_0": int(day_of_week == 0),
        "day_of_week_1": int(day_of_week == 1),
        "day_of_week_2": int(day_of_week == 2),
        "day_of_week_3": int(day_of_week == 3),
        "day_of_week_4": int(day_of_week == 4),
        "day_of_week_5": int(day_of_week == 5),
        "day_of_week_6": int(day_of_week == 6),
    }


def _category_features_from_counts(
    counts: list[float],
    current_hour: pd.Timestamp,
    category: str,
    feature_columns: list[str],
) -> dict[str, Any]:
    target_hour = current_hour + pd.Timedelta(hour=1)
    day_of_week = int(target_hour.dayofweek)
    category_column = f"category_{category}"

    if category_column not in feature_columns:
        raise HTTPException(
            status_code=400,
            detail="Selected category is not supported by this province model",
        )

    features = {
        "hour_sin": sin(2 * pi * target_hour.hour / 24),
        "hour_cos": cos(2 * pi * target_hour.hour / 24),
        "lag_1": _count_at(counts, 1),
        "lag_2": _count_at(counts, 2),
        "lag_24": _count_at(counts, 24),
        "rolling_mean_3": _rolling_mean(counts, 3, 1),
        "rolling_mean_6": _rolling_mean(counts, 6, 1),
        "rolling_mean_24": _rolling_mean(counts, 24, 1),
        "is_weekend": int(day_of_week >= 5),
        "day_of_week_0": int(day_of_week == 0),
        "day_of_week_1": int(day_of_week == 1),
        "day_of_week_2": int(day_of_week == 2),
        "day_of_week_3": int(day_of_week == 3),
        "day_of_week_4": int(day_of_week == 4),
        "day_of_week_5": int(day_of_week == 5),
        "day_of_week_6": int(day_of_week == 6),
    }

    for column in feature_columns:
        if column.startswith("category_"):
            features[column] = int(column == category_column)

    return features


def _frame_from_features(
    features: dict[str, Any],
    feature_columns: list[str],
) -> pd.DataFrame:
    return pd.DataFrame([{column: features.get(column, 0) for column in feature_columns}])


def build_features_for_province(
    province_number: int,
    start_hour: int | None = None,
    predict_timestamp: int | str | None = None,
    category: str | None = None,
    feature_columns: list[str] | None = None,
) -> tuple[dict[str, Any], pd.Timestamp]:
    hourly_counts = (
        _hourly_counts_for_category(province_number, category)
        if category
        else _hourly_counts_for_province(province_number)
    )
    target_hour = _resolve_target_hour(hourly_counts, start_hour, predict_timestamp)
    if category:
        current_hour = target_hour - pd.Timedelta(hours=1)
        history = hourly_counts[hourly_counts["prediction_hour"] <= current_hour]
        counts = [float(value) for value in history["count"].tolist()]
        features = _category_features_from_counts(
            counts,
            current_hour,
            category,
            feature_columns or [],
        )
    else:
        features = _features_from_history(hourly_counts, target_hour)

    return features, target_hour


def predict_demand(payload: PredictionRequest) -> PredictionResponse:
    if payload.province_number not in ALLOWED_PREDICTION_PROVINCES:
        raise HTTPException(
            status_code=400,
            detail="Prediction is available only for selected provinces",
        )

    model_kind = "category" if payload.category else "total"

    try:
        model = load_prediction_model(model_kind, payload.province_number)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    feature_columns = _model_feature_columns(model)
    features, prediction_timestamp = build_features_for_province(
        payload.province_number,
        payload.start_hour,
        payload.predict_timestamp,
        payload.category,
        feature_columns,
    )
    frame = _frame_from_features(features, feature_columns)

    try:
        prediction = model.predict(frame)
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Model prediction failed: {error}",
        ) from error

    raw_pred = _prediction_to_json(prediction)
    if isinstance(raw_pred, list):
        rounded_prediction = [round(item) if isinstance(item, (int, float)) else item for item in raw_pred]
    elif isinstance(raw_pred, (int, float)):
        rounded_prediction = round(raw_pred)
    else:
        rounded_prediction = raw_pred

    return PredictionResponse(
        prediction=rounded_prediction,
        model_path=str(get_prediction_model_path(model_kind, payload.province_number)),
        province_number=payload.province_number,
        prediction_timestamp=prediction_timestamp.isoformat(),
        start_hour=payload.start_hour,
        category=payload.category,
    )


def predict_recursive_demand(
    payload: RecursivePredictionRequest,
) -> RecursivePredictionResponse:
    if payload.province_number not in ALLOWED_PREDICTION_PROVINCES:
        raise HTTPException(
            status_code=400,
            detail="Prediction is available only for selected provinces",
        )

    model_kind = "category" if payload.category else "total"

    try:
        model = load_prediction_model(model_kind, payload.province_number)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    feature_columns = _model_feature_columns(model)
    hourly_counts = (
        _hourly_counts_for_category(payload.province_number, payload.category)
        if payload.category
        else _hourly_counts_for_province(payload.province_number)
    )
    first_hour = pd.Timestamp(hourly_counts["prediction_hour"].iloc[0])
    last_hour = pd.Timestamp(hourly_counts["prediction_hour"].iloc[-1])
    start_hour = _target_hour_from_timestamp(payload.start_timestamp)

    if start_hour > last_hour + pd.Timedelta(hours=1):
        raise HTTPException(
            status_code=400,
            detail="Recursive prediction start is beyond the available one-hour forecast horizon",
        )

    history = hourly_counts[hourly_counts["prediction_hour"] < start_hour]

    counts = [float(value) for value in history["count"].tolist()]
    if start_hour < first_hour:
        missing_hours = int((first_hour - start_hour) / pd.Timedelta(hours=1))
        counts = [0.0] * max(missing_hours, 1)

    if not counts:
        counts = [0]
    points: list[RecursivePredictionPoint] = []

    for offset in range(payload.hours):
        target_hour = start_hour + pd.Timedelta(hours=offset)
        current_hour = target_hour - pd.Timedelta(hours=1)
        features = (
            _category_features_from_counts(
                counts,
                current_hour,
                payload.category,
                feature_columns,
            )
            if payload.category
            else _features_from_counts(counts, current_hour)
        )
        frame = _frame_from_features(features, feature_columns)

        try:
            prediction = _prediction_to_float(model.predict(frame))
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail=f"Model prediction failed: {error}",
            ) from error

        points.append(
            RecursivePredictionPoint(
                timestamp=target_hour.isoformat(),
                prediction=float(round(prediction)),
            ),
        )

        counts.append(prediction)

    return RecursivePredictionResponse(
        points=points,
        model_path=str(get_prediction_model_path(model_kind, payload.province_number)),
        province_number=payload.province_number,
        start_timestamp=start_hour.isoformat(),
        hours=payload.hours,
        category=payload.category,
    )


def get_model_info() -> dict[str, Any]:
    total_model_paths = [
        get_prediction_model_path("total", province_number)
        for province_number in sorted(ALLOWED_PREDICTION_PROVINCES)
    ]
    category_model_paths = [
        get_prediction_model_path("category", province_number)
        for province_number in sorted(ALLOWED_PREDICTION_PROVINCES)
    ]

    return {
        "model_path": str(MODELS_DIR),
        "model_exists": all(model_path.exists() for model_path in total_model_paths + category_model_paths),
        "features": FEATURE_COLUMNS,
        "available_provinces": sorted(ALLOWED_PREDICTION_PROVINCES),
    }
