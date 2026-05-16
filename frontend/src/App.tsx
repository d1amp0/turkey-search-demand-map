import { useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { SelectionSummary } from "./components/SelectionSummary";
import { TurkeyMap } from "./components/TurkeyMap";
import { emptyDemandFilters } from "./types/filters";
import type { CoordinateMatch } from "./types/selection";

type Theme = "light" | "dark";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("theme");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [selection, setSelection] = useState<CoordinateMatch | null>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [filters, setFilters] = useState(emptyDemandFilters);

  function updateTheme(nextTheme: Theme) {
    window.localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <nav className="navbar" aria-label="Main navigation">
        <FilterBar filters={filters} onFiltersChange={setFilters} />
        <div className="navbar-spacer" />
        <div className="theme-toggle" aria-label="Theme switcher">
          <button
            type="button"
            className={theme === "light" ? "active" : ""}
            aria-pressed={theme === "light"}
            onClick={() => updateTheme("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            aria-pressed={theme === "dark"}
            onClick={() => updateTheme("dark")}
          >
            Dark
          </button>
        </div>
      </nav>
      <section className={isPanelExpanded ? "workspace panel-expanded" : "workspace"}>
        <div className="map-area">
          <TurkeyMap
            filters={filters}
            theme={theme}
            onSelectionChange={setSelection}
          />
        </div>
        <aside className="charts-panel" aria-label="Charts panel">
          <SelectionSummary
            isExpanded={isPanelExpanded}
            filters={filters}
            onExpandedChange={setIsPanelExpanded}
            selection={selection}
          />
        </aside>
      </section>
    </main>
  );
}
