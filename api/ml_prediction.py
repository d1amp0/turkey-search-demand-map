from __future__ import annotations

import os
from functools import lru_cache
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
    predict_timestamp: int = Field(...)


class PredictionResponse(BaseModel):
    prediction: float | int | str | list[Any]
    model_path: str
    province_number: int


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

    return joblib.load(model_path)


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

from math import sin, cos, pi

def build_features_for_province(province_number: int, timestamp: int) -> dict[str, Any]:
    demand = get_demand_dataframe()
    province_frame = demand[demand["province_number"] == province_number].copy()
    time_split_frame = demand[demand['timestamp'] <= timestamp].copy()

    if province_frame.empty:
        raise HTTPException(status_code=404, detail="Province has no demand data")

    time_split_frame["prediction_hour"] = time_split_frame["timestamp"].dt.floor("h")
    hourly_counts = (
        time_split_frame.groupby("prediction_hour", as_index=False)
        .size()
        .rename(columns={"size": "searches"})
        .sort_values("prediction_hour")
    )
    counts = [float(value) for value in hourly_counts["searches"].tolist()]
    last_timestamp = pd.Timestamp(hourly_counts["prediction_hour"].iloc[-1])
    prediction_timestamp = last_timestamp + pd.Timedelta(hours=1)
    day_of_week = int(prediction_timestamp.dayofweek)

    return {
        "count": _count_at(counts, 1),
        "hour_sin": sin(2 * pi * last_timestamp.hour / 24),
        "hour_cos": cos(2 * pi * last_timestamp.hour / 24),
        "lag_1": _count_at(counts, 1),
        "lag_2": _count_at(counts, 2),
        "lag_24": _count_at(counts, 24),
        "rolling_mean_3": _rolling_mean(counts, 3),
        "rolling_mean_6": _rolling_mean(counts, 6),
        "rolling_mean_24": _rolling_mean(counts, 24),
        "is_weekend": day_of_week >= 5,
        "day_of_week_0": day_of_week == 0,
        "day_of_week_1": day_of_week == 1,
        "day_of_week_2": day_of_week == 2,
        "day_of_week_3": day_of_week == 3,
        "day_of_week_4": day_of_week == 4,
        "day_of_week_5": day_of_week == 5,
        "day_of_week_6": day_of_week == 6,
    }


def predict_demand(payload: PredictionRequest) -> PredictionResponse:
    try:
        model = load_model()
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    features = build_features_for_province(payload.province_number)
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
        province_number=payload.province_number
    )


def get_model_info() -> dict[str, Any]:
    model_path = get_model_path()

    return {
        "model_path": str(model_path),
        "model_exists": model_path.exists(),
        "features": FEATURE_COLUMNS,
    }
