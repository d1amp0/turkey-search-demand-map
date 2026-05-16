import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTurkeyGeoJson } from "../api/client";

type FilterMenu = "time" | "provinces" | "results" | null;
type ProvinceOption = {
  name: string;
  number: number;
};

const hourRanges = [
  "00-05",
  "06-09",
  "10-13",
  "14-17",
  "18-21",
  "22-23",
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const resultStates = ["Organizations found", "No organizations"];
const ratingThresholds = ["Any rating", "3.0+", "4.0+", "4.5+"];
const stepRanges = ["1-3 steps", "4-6 steps", "7+ steps"];
const sourceStates = ["Has sources", "No sources"];

function toggleValue(value: string, selected: string[], onChange: (next: string[]) => void) {
  onChange(
    selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value],
  );
}

function summaryLabel(values: string[], fallback: string) {
  if (!values.length) {
    return fallback;
  }

  if (values.length === 1) {
    return values[0];
  }

  return `${values.length} selected`;
}

export function FilterBar() {
  const [openMenu, setOpenMenu] = useState<FilterMenu>(null);
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedProvinces, setSelectedProvinces] = useState<string[]>([]);
  const [selectedResultStates, setSelectedResultStates] = useState<string[]>([]);
  const [selectedRating, setSelectedRating] = useState("Any rating");
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [selectedSourceStates, setSelectedSourceStates] = useState<string[]>([]);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

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
    selectedHours.length + selectedDays.length > 0
      ? `${selectedHours.length + selectedDays.length} selected`
      : "Time";

  const resultSelectionCount =
    selectedResultStates.length +
    selectedSteps.length +
    selectedSourceStates.length +
    (selectedRating === "Any rating" ? 0 : 1);

  return (
    <div className="filter-bar" ref={containerRef}>
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
                <button type="button" onClick={() => setSelectedHours([])}>
                  Clear
                </button>
              </div>
              <div className="chip-grid hours-grid">
                {hourRanges.map((hourRange) => (
                  <button
                    type="button"
                    className={selectedHours.includes(hourRange) ? "chip active" : "chip"}
                    key={hourRange}
                    onClick={() => toggleValue(hourRange, selectedHours, setSelectedHours)}
                  >
                    {hourRange}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Days</span>
                <button type="button" onClick={() => setSelectedDays([])}>
                  Clear
                </button>
              </div>
              <div className="chip-grid days-grid">
                {weekdays.map((weekday) => (
                  <button
                    type="button"
                    className={selectedDays.includes(weekday) ? "chip active" : "chip"}
                    key={weekday}
                    onClick={() => toggleValue(weekday, selectedDays, setSelectedDays)}
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
            openMenu === "provinces" ? "filter-trigger active" : "filter-trigger"
          }
          aria-expanded={openMenu === "provinces"}
          onClick={() => setOpenMenu(openMenu === "provinces" ? null : "provinces")}
        >
          {summaryLabel(selectedProvinces, "Provinces")}
        </button>

        {openMenu === "provinces" ? (
          <div className="filter-popover provinces-popover">
            <div className="filter-section-header">
              <span>Query province</span>
              <button type="button" onClick={() => setSelectedProvinces([])}>
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
                    checked={selectedProvinces.includes(province.name)}
                    type="checkbox"
                    onChange={() =>
                      toggleValue(province.name, selectedProvinces, setSelectedProvinces)
                    }
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
                <button type="button" onClick={() => setSelectedResultStates([])}>
                  Clear
                </button>
              </div>
              <div className="stacked-options">
                {resultStates.map((state) => (
                  <label className="region-option" key={state}>
                    <input
                      checked={selectedResultStates.includes(state)}
                      type="checkbox"
                      onChange={() =>
                        toggleValue(state, selectedResultStates, setSelectedResultStates)
                      }
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
                    className={selectedRating === rating ? "chip active" : "chip"}
                    key={rating}
                    onClick={() => setSelectedRating(rating)}
                  >
                    {rating}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Agent steps</span>
                <button type="button" onClick={() => setSelectedSteps([])}>
                  Clear
                </button>
              </div>
              <div className="chip-grid steps-grid">
                {stepRanges.map((stepRange) => (
                  <button
                    type="button"
                    className={selectedSteps.includes(stepRange) ? "chip active" : "chip"}
                    key={stepRange}
                    onClick={() => toggleValue(stepRange, selectedSteps, setSelectedSteps)}
                  >
                    {stepRange}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Sources</span>
                <button type="button" onClick={() => setSelectedSourceStates([])}>
                  Clear
                </button>
              </div>
              <div className="stacked-options">
                {sourceStates.map((state) => (
                  <label className="region-option" key={state}>
                    <input
                      checked={selectedSourceStates.includes(state)}
                      type="checkbox"
                      onChange={() =>
                        toggleValue(state, selectedSourceStates, setSelectedSourceStates)
                      }
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
