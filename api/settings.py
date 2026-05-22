from __future__ import annotations

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
GEOJSON_PATH = BASE_DIR / "data" / "tr-cities.json"
PROVINCES_DIR = BASE_DIR / "data" / "provinces"
FULL_DEMAND_CSV_PATHS = (
    BASE_DIR / "data" / "df_with_cat.csv",
    BASE_DIR / "ml" / "df_with_cat.csv",
)
MODEL_PATH = BASE_DIR / "api" / "rf_model.pkl"
