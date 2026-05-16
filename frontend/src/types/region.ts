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

export type DemandMetricKey =
  | "searches"
  | "no_result_rate"
  | "avg_rating"
  | "avg_steps"
  | "source_coverage";

export type DemandMetric = {
  key: DemandMetricKey;
  label: string;
  format: "integer" | "percent" | "decimal";
  description: string;
};

export type DemandSummary = {
  searches: number;
  no_result_rate: number;
  avg_rating: number;
  avg_steps: number;
  source_coverage: number;
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
  category_breakdown: CategorySearchPoint[];
  hourly_distribution: HourlySearchPoint[];
};

export type ProvinceDemandResponse = {
  updated_at: string;
  province_number: number;
  name: string;
  summary: DemandSummary;
  daily_searches: DailySearchPoint[];
  category_breakdown: CategorySearchPoint[];
  hourly_distribution: HourlySearchPoint[];
};
