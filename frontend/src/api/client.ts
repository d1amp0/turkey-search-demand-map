import type { FeatureCollection, Geometry } from "geojson";
import type { RegionValuesResponse, TurkeyProvinceProperties } from "../types/region";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function fetchTurkeyGeoJson() {
  return getJson<FeatureCollection<Geometry, TurkeyProvinceProperties>>(
    "/tr-cities.json",
  );
}

export function fetchRegionValues() {
  return getJson<RegionValuesResponse>("/api/region-values");
}
