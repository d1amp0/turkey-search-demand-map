import type { FeatureCollection, Geometry } from "geojson";
import type {
  DemandOverviewResponse,
  ProvinceDemandResponse,
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";

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

export function fetchRegionValues() {
  return getJson<RegionValuesResponse>("/api/demand/region-values");
}

export function fetchDemandOverview() {
  return getJson<DemandOverviewResponse>("/api/demand/overview");
}

export function fetchProvinceDemand(provinceNumber: number) {
  return getJson<ProvinceDemandResponse>(
    `/api/demand/provinces/${provinceNumber}`,
  );
}
