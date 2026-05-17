from __future__ import annotations

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
GEOJSON_PATH = BASE_DIR / "data" / "tr-cities.json"
PROVINCES_DIR = BASE_DIR / "data" / "provinces"
