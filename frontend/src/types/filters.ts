export type DemandFilters = {
  hourRanges: string[];
  weekdays: string[];
  provinceNumbers: number[];
  resultStates: string[];
  rating: string;
  stepRanges: string[];
  sourceStates: string[];
};

export const emptyDemandFilters: DemandFilters = {
  hourRanges: [],
  weekdays: [],
  provinceNumbers: [],
  resultStates: [],
  rating: "Any rating",
  stepRanges: [],
  sourceStates: [],
};
