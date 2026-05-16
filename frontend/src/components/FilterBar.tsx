import { useEffect, useRef, useState } from "react";

type FilterMenu = "time" | "regions" | null;

const hourRanges = [
  "00-05",
  "06-09",
  "10-13",
  "14-17",
  "18-21",
  "22-23",
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const seasons = ["Winter", "Spring", "Summer", "Autumn"];

const regionGroups = [
  "Marmara",
  "Aegean",
  "Mediterranean",
  "Central Anatolia",
  "Black Sea",
  "Eastern Anatolia",
  "Southeastern Anatolia",
];

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
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const timeSummary =
    selectedHours.length + selectedDays.length + selectedSeasons.length > 0
      ? `${selectedHours.length + selectedDays.length + selectedSeasons.length} selected`
      : "Time";

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

            <div className="filter-section">
              <div className="filter-section-header">
                <span>Seasons</span>
                <button type="button" onClick={() => setSelectedSeasons([])}>
                  Clear
                </button>
              </div>
              <div className="chip-grid seasons-grid">
                {seasons.map((season) => (
                  <button
                    type="button"
                    className={selectedSeasons.includes(season) ? "chip active" : "chip"}
                    key={season}
                    onClick={() => toggleValue(season, selectedSeasons, setSelectedSeasons)}
                  >
                    {season}
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
          className={openMenu === "regions" ? "filter-trigger active" : "filter-trigger"}
          aria-expanded={openMenu === "regions"}
          onClick={() => setOpenMenu(openMenu === "regions" ? null : "regions")}
        >
          {summaryLabel(selectedRegions, "Regions")}
        </button>

        {openMenu === "regions" ? (
          <div className="filter-popover regions-popover">
            <div className="filter-section-header">
              <span>Geographic regions</span>
              <button type="button" onClick={() => setSelectedRegions([])}>
                Clear
              </button>
            </div>
            <div className="region-list">
              {regionGroups.map((region) => (
                <label className="region-option" key={region}>
                  <input
                    checked={selectedRegions.includes(region)}
                    type="checkbox"
                    onChange={() =>
                      toggleValue(region, selectedRegions, setSelectedRegions)
                    }
                  />
                  <span>{region}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
