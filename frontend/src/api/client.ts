import type { FeatureCollection, Geometry } from "geojson";
import type {
  DemandOverviewResponse,
  DemandMetricKey,
  ProvinceDemandResponse,
  RadiusSummaryResponse,
  RequestPointsResponse,
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";
import type { DemandFilters } from "../types/filters";
import type {
  ModelInfoResponse,
  PredictionRequest,
  PredictionResponse,
  RecursivePredictionRequest,
  RecursivePredictionResponse,
} from "../types/ml";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  if (!contentType.includes("application/json") && !contentType.includes("geo+json")) {
    throw new Error(`${url} returned ${contentType || "non-JSON response"}`);
  }

  return response.json() as Promise<T>;
}

let turkeyGeoJsonRequest:
  | Promise<FeatureCollection<Geometry, TurkeyProvinceProperties>>
  | null = null;
let demandCategoriesRequest: Promise<string[]> | null = null;

async function postJson<TResponse, TPayload>(url: string, payload: TPayload): Promise<TResponse> {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : null;
    throw new Error(detail ?? `${url} returned ${response.status}`);
  }

  return body as TResponse;
}

export function fetchTurkeyGeoJson() {
  turkeyGeoJsonRequest ??= getJson<FeatureCollection<Geometry, TurkeyProvinceProperties>>(
    "/tr-cities.json",
  );

  return turkeyGeoJsonRequest;
}

export function fetchDemandCategories() {
  demandCategoriesRequest ??= getJson<string[]>("/api/categories");

  return demandCategoriesRequest;
}

export function fetchModelInfo() {
  return getJson<ModelInfoResponse>("/api/ml/model-info");
}

export function predictDemand(payload: PredictionRequest) {
  return postJson<PredictionResponse, PredictionRequest>("/api/ml/predict", payload);
}

export function predictDemandRecursive(payload: RecursivePredictionRequest) {
  return postJson<RecursivePredictionResponse, RecursivePredictionRequest>(
    "/api/ml/predict-recursive",
    payload,
  );
}

function demandQuery(filters: DemandFilters) {
  const params = new URLSearchParams();

  if (filters.hourRanges.length) {
    params.set("hours", filters.hourRanges.join(","));
  }

  if (filters.weekdays.length) {
    params.set("weekdays", filters.weekdays.join(","));
  }

  if (filters.provinceNumbers.length) {
    params.set("provinces", filters.provinceNumbers.join(","));
  }

  if (filters.categories.length) {
    filters.categories.forEach((category) => {
      params.append("categories", category);
    });
  }

  if (filters.rating !== "Any rating") {
    params.set("rating", filters.rating);
  }

  if (filters.startTime) {
    params.set("start_time", filters.startTime);
  }

  if (filters.endTime) {
    params.set("end_time", filters.endTime);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchRegionValues(
  filters: DemandFilters,
  metric: DemandMetricKey = filters.metric,
) {
  const query = demandQuery(filters);
  const separator = query ? "&" : "?";

  return getJson<RegionValuesResponse>(
    `/api/demand/region-values${query}${separator}metric=${metric}`,
  );
}

export function fetchDemandOverview(filters: DemandFilters) {
  return getJson<DemandOverviewResponse>(
    `/api/demand/overview${demandQuery(filters)}`,
  );
}

export function fetchRequestPoints(filters: DemandFilters) {
  return getJson<RequestPointsResponse>(
    `/api/demand/request-points${demandQuery(filters)}`,
  );
}

export function fetchRadiusSummary(
  filters: DemandFilters,
  latitude: number,
  longitude: number,
  radiusKm: number,
) {
  const query = demandQuery(filters);
  const separator = query ? "&" : "?";
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    radius_km: String(radiusKm),
  });

  return getJson<RadiusSummaryResponse>(
    `/api/demand/radius-summary${query}${separator}${params.toString()}`,
  );
}

export function fetchProvinceDemand(
  provinceNumber: number,
  filters: DemandFilters,
) {
  return getJson<ProvinceDemandResponse>(
    `/api/demand/provinces/${provinceNumber}${demandQuery(filters)}`,
  );
}
