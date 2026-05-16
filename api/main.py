from __future__ import annotations

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api.region_data import get_region_values
from api.settings import FRONTEND_DIST_DIR, GEOJSON_PATH


app = FastAPI(title="Turkey Search Demand Map")

if FRONTEND_DIST_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST_DIR / "assets"),
        name="frontend-assets",
    )


@app.get("/")
def index() -> FileResponse:
    react_index = FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        return FileResponse(react_index)

    raise HTTPException(
        status_code=404,
        detail="Frontend build not found. Run `npm run build` in frontend/.",
    )


@app.get("/tr-cities.json")
def city_boundaries() -> FileResponse:
    return FileResponse(GEOJSON_PATH, media_type="application/geo+json")


@app.get("/api/region-values")
def region_values() -> dict:
    return get_region_values()


@app.get("/{path:path}")
def react_app(path: str) -> FileResponse:
    react_index = FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        return FileResponse(react_index)

    raise HTTPException(status_code=404, detail=f"Not found: {path}")
