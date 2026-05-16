import { useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { SelectionSummary } from "./components/SelectionSummary";
import { TurkeyMap } from "./components/TurkeyMap";
import type { CoordinateMatch } from "./types/selection";

type Theme = "light" | "dark";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("theme");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [selection, setSelection] = useState<CoordinateMatch | null>(null);

  function updateTheme(nextTheme: Theme) {
    window.localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <nav className="navbar" aria-label="Main navigation">
        <FilterBar />
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
      <section className="workspace">
        <div className="map-area">
          <TurkeyMap theme={theme} onSelectionChange={setSelection} />
        </div>
        <aside className="charts-panel" aria-label="Charts panel">
          <SelectionSummary selection={selection} />
        </aside>
      </section>
    </main>
  );
}
