export type TurkeyProvinceProperties = {
  name: string;
  number: number;
};

export type RegionValue = {
  name: string;
  value: number;
  summary: DemandSummary;
};

export type RegionValuesResponse = {
  updated_at: string;
  key: "province_number";
  metric: DemandMetricKey;
  metric_catalog: DemandMetric[];
  values: Record<string, RegionValue>;
};

export type RequestHeatPoint = {
  latitude: number;
  longitude: number;
  searches: number;
};

export type RequestPointsResponse = {
  updated_at: string;
  points: RequestHeatPoint[];
};

export type RadiusSummaryResponse = {
  updated_at: string;
  center: {
    latitude: number;
    longitude: number;
  };
  radius_km: number;
  searches: number;
};

export type DemandMetricKey =
  | "searches"
  | "avg_rating";

export type DemandMetric = {
  key: DemandMetricKey;
  label: string;
  format: "integer" | "percent" | "decimal";
  description: string;
};

export type DemandSummary = {
  searches: number;
  avg_rating: number;
};

export type DailySearchPoint = {
  date: string;
  searches: number;
};

export type CategorySearchPoint = {
  category: string;
  searches: number;
};

export type HourlySearchPoint = {
  hour: number;
  searches: number;
};

export type TimeSearchPoint = {
  timestamp: string;
  searches: number;
};

export type TopOrganization = {
  name: string;
  category: string;
  rating: number;
  searches: number;
};

export type TopProvince = {
  province_number: number;
  name: string;
  value: number;
  summary: DemandSummary;
};

export type DemandOverviewResponse = {
  updated_at: string;
  metric: DemandMetricKey;
  summary: DemandSummary;
  top_provinces: TopProvince[];
  daily_searches: DailySearchPoint[];
  time_series: TimeSearchPoint[];
  category_breakdown: CategorySearchPoint[];
  hourly_distribution: HourlySearchPoint[];
  top_organizations: TopOrganization[];
};

export type ProvinceDemandResponse = {
  updated_at: string;
  province_number: number;
  name: string;
  summary: DemandSummary | null;
  daily_searches: DailySearchPoint[];
  time_series: TimeSearchPoint[];
  category_breakdown: CategorySearchPoint[];
  hourly_distribution: HourlySearchPoint[];
  top_organizations: TopOrganization[];
};
