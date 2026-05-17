import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTurkeyGeoJson } from "../api/client";
import type { DemandFilters } from "../types/filters";

type FilterMenu =
  | "metric"
  | "time"
  | "provinces"
  | "organizations"
  | "results"
  | null;
type ProvinceOption = {
  name: string;
  number: number;
};
type ArrayFilterKey =
  | "hourRanges"
  | "weekdays"
  | "provinceNumbers"
  | "categories"
  | "resultStates"
  | "stepRanges"
  | "sourceStates";

const hourRanges = [
  "00-05",
  "06-09",
  "10-13",
  "14-17",
  "18-21",
  "22-23",
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const metrics = [
  { key: "searches", label: "Popularity" },
  { key: "avg_rating", label: "Rating" },
  { key: "no_result_rate", label: "No results" },
  { key: "avg_steps", label: "Agent steps" },
  { key: "source_coverage", label: "Source coverage" },
] as const;
const organizationTypes = ["restaurants", "hotels", "clinics", "transport", "shops"];
const resultStates = ["Organizations found", "No organizations"];
const ratingThresholds = ["Any rating", "3.0+", "4.0+", "4.5+"];
const stepRanges = ["1-3 steps", "4-6 steps", "7+ steps"];
const sourceStates = ["Has sources", "No sources"];

function summaryLabel(values: string[], fallback: string) {
  if (!values.length) {
    return fallback;
  }

  if (values.length === 1) {
    return values[0];
  }

  return `${values.length} selected`;
}

export function FilterBar({
  filters,
  onFiltersChange,
}: {
  filters: DemandFilters;
  onFiltersChange: (filters: DemandFilters) => void;
}) {
  const [openMenu, setOpenMenu] = useState<FilterMenu>(null);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  function updateFilters(nextFilters: Partial<DemandFilters>) {
    onFiltersChange({
      ...filters,
      ...nextFilters,
    });
  }

  function toggleFilterValue(key: ArrayFilterKey, value: string | number) {
    const selected = filters[key] as Array<string | number>;
    const nextSelected = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];

    updateFilters({
      [key]: nextSelected,
    } as Partial<DemandFilters>);
  }

  useEffect(() => {
    void fetchTurkeyGeoJson().then((geoJson) => {
      setProvinces(
        geoJson.features
          .map((feature) => ({
            name: feature.properties.name,
            number: feature.properties.number,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
    });
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const filteredProvinces = useMemo(() => {
    const normalizedQuery = provinceSearch.trim().toLowerCase();

    if (!normalizedQuery) {
      return provinces;
    }

    return provinces.filter((province) =>
      province.name.toLowerCase().includes(normalizedQuery),
    );
  }, [provinceSearch, provinces]);

  const timeSummary =
    filters.hourRanges.length + filters.weekdays.length > 0
      ? `${filters.hourRanges.length + filters.weekdays.length} selected`
      : "Time";

  const resultSelectionCount =
    filters.resultStates.length +
    filters.stepRanges.length +
    filters.sourceStates.length +
    (filters.rating === "Any rating" ? 0 : 1);

  const selectedProvinceNames = provinces
    .filter((province) => filters.provinceNumbers.includes(province.number))
    .map((province) => province.name);

  return (
    <div className="filter-bar" ref={containerRef}>
      <div className="filter-group">
        <button
          type="button"
          className={openMenu === "metric" ? "filter-trigger active" : "filter-trigger"}
          aria-expanded={openMenu === "metric"}
          onClick={() => setOpenMenu(openMenu === "metric" ? null : "metric")}
        >
          {metrics.find((metric) => metric.key === filters.metric)?.label ?? "Metric"}
        </button>

        {openMenu === "metric" ? (
          <div className="filter-popover metric-popover">
            <div className="filter-section-header">
              <span>Map metric</span>
            </div>
            <div className="stacked-options">
              {metrics.map((metric) => (
                <label className="region-option" key={metric.key}>
                  <input
                    checked={filters.metric === metric.key}
                    name="metric"
                    type="radio"
                    onChange={() => updateFilters({ metric: metric.key })}
                  />
                  <span>{metric.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="filter-group">
        <button
          type="button"
          className={openMenu === "time" ? "filter-trigger active" : "filter-trigger"}
          aria-expanded={openMenu === "time"}
          onClick={() => setOpenMenu(openMenu === "time" ? null : "time")}
        >
          {timeSummary}
        </button>

        {openMenu === "time" ? (
          <div className="filter-popover time-popover">
            <div className="filter-section">
              <div className="filter-section-header">
                <span>Hours</span>
                <button type="button" onClick={() => updateFilters({ hourRanges: [] })}>
                  Clear
                </button>
              </div>
              <div className="chip-grid hours-grid">
                {hourRanges.map((hourRange) => (
                  <button
                    type="button"
                    className={filters.hourRanges.includes(hourRange) ? "chip active" : "chip"}
                    key={hourRange}
                    onClick={() => toggleFilterValue("hourRanges", hourRange)}
                  >
                    {hourRange}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Days</span>
                <button type="button" onClick={() => updateFilters({ weekdays: [] })}>
                  Clear
                </button>
              </div>
              <div className="chip-grid days-grid">
                {weekdays.map((weekday) => (
                  <button
                    type="button"
                    className={filters.weekdays.includes(weekday) ? "chip active" : "chip"}
                    key={weekday}
                    onClick={() => toggleFilterValue("weekdays", weekday)}
                  >
                    {weekday}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="filter-group">
        <button
          type="button"
          className={
            openMenu === "organizations" ? "filter-trigger active" : "filter-trigger"
          }
          aria-expanded={openMenu === "organizations"}
          onClick={() =>
            setOpenMenu(openMenu === "organizations" ? null : "organizations")
          }
        >
          {summaryLabel(filters.categories, "Organizations")}
        </button>

        {openMenu === "organizations" ? (
          <div className="filter-popover organizations-popover">
            <div className="filter-section-header">
              <span>Organization type</span>
              <button type="button" onClick={() => updateFilters({ categories: [] })}>
                Clear
              </button>
            </div>
            <div className="stacked-options">
              {organizationTypes.map((category) => (
                <label className="region-option" key={category}>
                  <input
                    checked={filters.categories.includes(category)}
                    type="checkbox"
                    onChange={() => toggleFilterValue("categories", category)}
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="filter-group">
        <button
          type="button"
          className={
            openMenu === "provinces" ? "filter-trigger active" : "filter-trigger"
          }
          aria-expanded={openMenu === "provinces"}
          onClick={() => setOpenMenu(openMenu === "provinces" ? null : "provinces")}
        >
          {summaryLabel(selectedProvinceNames, "Provinces")}
        </button>

        {openMenu === "provinces" ? (
          <div className="filter-popover provinces-popover">
            <div className="filter-section-header">
              <span>Query province</span>
              <button type="button" onClick={() => updateFilters({ provinceNumbers: [] })}>
                Clear
              </button>
            </div>
            <input
              className="province-search"
              placeholder="Search province"
              value={provinceSearch}
              onChange={(event) => setProvinceSearch(event.target.value)}
            />
            <div className="province-list">
              {filteredProvinces.map((province) => (
                <label className="region-option" key={province.number}>
                  <input
                    checked={filters.provinceNumbers.includes(province.number)}
                    type="checkbox"
                    onChange={() => toggleFilterValue("provinceNumbers", province.number)}
                  />
                  <span>{province.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="filter-group">
        <button
          type="button"
          className={openMenu === "results" ? "filter-trigger active" : "filter-trigger"}
          aria-expanded={openMenu === "results"}
          onClick={() => setOpenMenu(openMenu === "results" ? null : "results")}
        >
          {resultSelectionCount ? `${resultSelectionCount} selected` : "Results"}
        </button>

        {openMenu === "results" ? (
          <div className="filter-popover results-popover">
            <div className="filter-section">
              <div className="filter-section-header">
                <span>Organizations</span>
                <button type="button" onClick={() => updateFilters({ resultStates: [] })}>
                  Clear
                </button>
              </div>
              <div className="stacked-options">
                {resultStates.map((state) => (
                  <label className="region-option" key={state}>
                    <input
                      checked={filters.resultStates.includes(state)}
                      type="checkbox"
                      onChange={() => toggleFilterValue("resultStates", state)}
                    />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Rating</span>
              </div>
              <div className="chip-grid rating-grid">
                {ratingThresholds.map((rating) => (
                  <button
                    type="button"
                    className={filters.rating === rating ? "chip active" : "chip"}
                    key={rating}
                    onClick={() => updateFilters({ rating })}
                  >
                    {rating}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Agent steps</span>
                <button type="button" onClick={() => updateFilters({ stepRanges: [] })}>
                  Clear
                </button>
              </div>
              <div className="chip-grid steps-grid">
                {stepRanges.map((stepRange) => (
                  <button
                    type="button"
                    className={filters.stepRanges.includes(stepRange) ? "chip active" : "chip"}
                    key={stepRange}
                    onClick={() => toggleFilterValue("stepRanges", stepRange)}
                  >
                    {stepRange}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Sources</span>
                <button type="button" onClick={() => updateFilters({ sourceStates: [] })}>
                  Clear
                </button>
              </div>
              <div className="stacked-options">
                {sourceStates.map((state) => (
                  <label className="region-option" key={state}>
                    <input
                      checked={filters.sourceStates.includes(state)}
                      type="checkbox"
                      onChange={() => toggleFilterValue("sourceStates", state)}
                    />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
