from __future__ import annotations

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from api.demand_data import get_metric_catalog
from api.demand_data import get_category_catalog
from api.demand_data import get_overview
from api.demand_data import get_province_detail
from api.demand_data import get_region_values
from api.demand_data import DemandFilters
from api.demand_data import MetricName
from api.ml_prediction import PredictionRequest
from api.ml_prediction import get_model_info
from api.ml_prediction import predict_demand
from api.settings import FRONTEND_DIST_DIR, GEOJSON_PATH


app = FastAPI(title="Turkey Search Demand Map")
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def cache_static_assets(request, call_next):
    response = await call_next(request)

    if request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

    if request.url.path == "/tr-cities.json":
        response.headers["Cache-Control"] = "public, max-age=86400"

    return response

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


@app.get("/api/metrics")
def metrics() -> dict:
    return get_metric_catalog()


@app.get("/api/categories")
def categories() -> list[str]:
    return get_category_catalog()


@app.get("/api/ml/model-info")
def ml_model_info() -> dict:
    return get_model_info()


@app.post("/api/ml/predict")
def ml_predict(payload: PredictionRequest) -> dict:
    return predict_demand(payload).dict()


@app.get("/api/demand/region-values")
def demand_region_values(
    metric: MetricName = "searches",
    hours: str | None = None,
    weekdays: str | None = None,
    provinces: str | None = None,
    categories: str | None = None,
    rating: str | None = None,
) -> dict:
    filters: DemandFilters = {
        "hours": hours,
        "weekdays": weekdays,
        "provinces": provinces,
        "categories": categories,
        "rating": rating,
    }
    return get_region_values(metric, filters)


@app.get("/api/demand/overview")
def demand_overview(
    metric: MetricName = "searches",
    hours: str | None = None,
    weekdays: str | None = None,
    provinces: str | None = None,
    categories: str | None = None,
    rating: str | None = None,
) -> dict:
    filters: DemandFilters = {
        "hours": hours,
        "weekdays": weekdays,
        "provinces": provinces,
        "categories": categories,
        "rating": rating,
    }
    return get_overview(metric, filters)


@app.get("/api/demand/provinces/{province_number}")
def demand_province_detail(
    province_number: int,
    hours: str | None = None,
    weekdays: str | None = None,
    categories: str | None = None,
    rating: str | None = None,
) -> dict:
    filters: DemandFilters = {
        "hours": hours,
        "weekdays": weekdays,
        "categories": categories,
        "rating": rating,
    }
    detail = get_province_detail(province_number, filters)

    if detail is None:
        raise HTTPException(status_code=404, detail="Province not found")

    return detail


@app.get("/api/region-values")
def region_values(metric: MetricName = "searches") -> dict:
    return get_region_values(metric)


@app.get("/{path:path}")
def react_app(path: str) -> FileResponse:
    react_index = FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        return FileResponse(react_index)

    raise HTTPException(status_code=404, detail=f"Not found: {path}")
