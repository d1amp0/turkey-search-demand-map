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


FEATURE_COLUMNS = [
    "count",
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


class PredictionRequest(BaseModel):
    province_number: int = Field(..., ge=1, le=81)
    start_hour: int | None = Field(default=None, ge=0, le=23)
    predict_timestamp: int | str | None = Field(default=None)


class PredictionResponse(BaseModel):
    prediction: float | int | str | list[Any]
    model_path: str
    province_number: int
    prediction_timestamp: str
    start_hour: int | None = None


class RecursivePredictionRequest(BaseModel):
    province_number: int = Field(..., ge=1, le=81)
    start_timestamp: int | str
    hours: int = Field(default=24, ge=1, le=24 * 30)


class RecursivePredictionPoint(BaseModel):
    timestamp: str
    prediction: float


class RecursivePredictionResponse(BaseModel):
    points: list[RecursivePredictionPoint]
    model_path: str
    province_number: int
    start_timestamp: str
    hours: int


def get_model_path() -> Path:
    configured_path = os.getenv("ML_MODEL_PATH")

    if configured_path:
        return Path(configured_path).expanduser().resolve()

    return MODEL_PATH


@lru_cache(maxsize=1)
def load_model() -> Any:
    model_path = get_model_path()

    if not model_path.exists():
        raise FileNotFoundError(f"ML model file not found: {model_path}")

    model = joblib.load(model_path)

    if hasattr(model, "n_jobs"):
        model.n_jobs = 1

    return model


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


def _rolling_mean(values: list[float], window: int) -> float:
    if not values:
        return 0

    window_values = values[-window:]
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
    day_of_week = int(current_hour.dayofweek)

    features = {
        "count": _count_at(counts, 1),
        "hour_sin": sin(2 * pi * current_hour.hour / 24),
        "hour_cos": cos(2 * pi * current_hour.hour / 24),
        "lag_1": _count_at(counts, 2),
        "lag_2": _count_at(counts, 3),
        "lag_24": _count_at(counts, 25),
        "rolling_mean_3": _rolling_mean(previous_counts, 3),
        "rolling_mean_6": _rolling_mean(previous_counts, 6),
        "rolling_mean_24": _rolling_mean(previous_counts, 24),
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
    previous_counts = counts[:-1]
    day_of_week = int(current_hour.dayofweek)

    return {
        "count": _count_at(counts, 1),
        "hour_sin": sin(2 * pi * current_hour.hour / 24),
        "hour_cos": cos(2 * pi * current_hour.hour / 24),
        "lag_1": _count_at(counts, 2),
        "lag_2": _count_at(counts, 3),
        "lag_24": _count_at(counts, 25),
        "rolling_mean_3": _rolling_mean(previous_counts, 3),
        "rolling_mean_6": _rolling_mean(previous_counts, 6),
        "rolling_mean_24": _rolling_mean(previous_counts, 24),
        "is_weekend": int(day_of_week >= 5),
        "day_of_week_0": int(day_of_week == 0),
        "day_of_week_1": int(day_of_week == 1),
        "day_of_week_2": int(day_of_week == 2),
        "day_of_week_3": int(day_of_week == 3),
        "day_of_week_4": int(day_of_week == 4),
        "day_of_week_5": int(day_of_week == 5),
        "day_of_week_6": int(day_of_week == 6),
    }


def build_features_for_province(
    province_number: int,
    start_hour: int | None = None,
    predict_timestamp: int | str | None = None,
) -> tuple[dict[str, Any], pd.Timestamp]:
    hourly_counts = _hourly_counts_for_province(province_number)
    target_hour = _resolve_target_hour(hourly_counts, start_hour, predict_timestamp)
    features = _features_from_history(hourly_counts, target_hour)

    return features, target_hour


def predict_demand(payload: PredictionRequest) -> PredictionResponse:
    try:
        model = load_model()
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    features, prediction_timestamp = build_features_for_province(
        payload.province_number,
        payload.start_hour,
        payload.predict_timestamp,
    )
    frame = pd.DataFrame([{column: features[column] for column in FEATURE_COLUMNS}])

    try:
        prediction = model.predict(frame)
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Model prediction failed: {error}",
        ) from error

    return PredictionResponse(
        prediction=_prediction_to_json(prediction),
        model_path=str(get_model_path()),
        province_number=payload.province_number,
        prediction_timestamp=prediction_timestamp.isoformat(),
        start_hour=payload.start_hour,
    )


def predict_recursive_demand(
    payload: RecursivePredictionRequest,
) -> RecursivePredictionResponse:
    try:
        model = load_model()
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    hourly_counts = _hourly_counts_for_province(payload.province_number)
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
        features = _features_from_counts(counts, current_hour)
        frame = pd.DataFrame([{column: features[column] for column in FEATURE_COLUMNS}])

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
                prediction=prediction,
            ),
        )

        counts.append(prediction)

    return RecursivePredictionResponse(
        points=points,
        model_path=str(get_model_path()),
        province_number=payload.province_number,
        start_timestamp=start_hour.isoformat(),
        hours=payload.hours,
    )


def get_model_info() -> dict[str, Any]:
    model_path = get_model_path()

    return {
        "model_path": str(model_path),
        "model_exists": model_path.exists(),
        "features": FEATURE_COLUMNS,
    }
