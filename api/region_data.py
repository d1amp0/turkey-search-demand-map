from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from api.settings import GEOJSON_PATH


def load_city_geojson() -> dict[str, Any]:
    with GEOJSON_PATH.open(encoding="utf-8") as geojson_file:
        return json.load(geojson_file)


def get_region_values() -> dict[str, Any]:
    """Demo data endpoint. Replace this body with the real API integration."""
    geojson_data = load_city_geojson()
    values = {}

    for feature in geojson_data.get("features", []):
        properties = feature.get("properties", {})
        province_number = int(properties["number"])

        values[str(province_number)] = {
            "name": properties["name"],
            "value": (province_number * 37) % 250,
        }

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "key": "province_number",
        "values": values,
    }
