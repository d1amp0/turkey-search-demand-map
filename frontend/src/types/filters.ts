import type { DemandMetricKey } from "./region";

export type DemandFilters = {
  metric: DemandMetricKey;
  hourRanges: string[];
  weekdays: string[];
  provinceNumbers: number[];
  categories: string[];
  resultStates: string[];
  rating: string;
  stepRanges: string[];
  sourceStates: string[];
};

export const emptyDemandFilters: DemandFilters = {
  metric: "searches",
  hourRanges: [],
  weekdays: [],
  provinceNumbers: [],
  categories: [],
  resultStates: [],
  rating: "Any rating",
  stepRanges: [],
  sourceStates: [],
};
