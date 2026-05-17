import type { FeatureCollection, Geometry } from "geojson";
import type {
  DemandOverviewResponse,
  DemandMetricKey,
  ProvinceDemandResponse,
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";
import type { DemandFilters } from "../types/filters";

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

export function fetchTurkeyGeoJson() {
  return getJson<FeatureCollection<Geometry, TurkeyProvinceProperties>>(
    "/tr-cities.json",
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
    params.set("categories", filters.categories.join(","));
  }

  if (filters.resultStates.length) {
    params.set("results", filters.resultStates.join(","));
  }

  if (filters.rating !== "Any rating") {
    params.set("rating", filters.rating);
  }

  if (filters.stepRanges.length) {
    params.set("steps", filters.stepRanges.join(","));
  }

  if (filters.sourceStates.length) {
    params.set("sources", filters.sourceStates.join(","));
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

export function fetchProvinceDemand(
  provinceNumber: number,
  filters: DemandFilters,
) {
  return getJson<ProvinceDemandResponse>(
    `/api/demand/provinces/${provinceNumber}${demandQuery(filters)}`,
  );
}
