import type { DemandMetricKey } from "./region";

export type DemandFilters = {
  metric: DemandMetricKey;
  hourRanges: string[];
  weekdays: string[];
  provinceNumbers: number[];
  categories: string[];
  rating: string;
};

export const emptyDemandFilters: DemandFilters = {
  metric: "searches",
  hourRanges: [],
  weekdays: [],
  provinceNumbers: [],
  categories: [],
  rating: "Any rating",
};
