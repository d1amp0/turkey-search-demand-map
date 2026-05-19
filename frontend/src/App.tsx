import { lazy, Suspense, useEffect, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { TurkeyMap } from "./components/TurkeyMap";
import { emptyDemandFilters } from "./types/filters";
import { translations } from "./i18n";
import type { Language } from "./i18n";
import { heatmapPalettes } from "./types/palette";
import type { HeatmapPalette } from "./types/palette";
import type { CoordinateMatch } from "./types/selection";
import type { PredictionWindow, RecursivePredictionPoint } from "./types/ml";

type Theme = "light" | "dark";
const PredictPanel = lazy(() =>
  import("./components/PredictPanel").then((module) => ({
    default: module.PredictPanel,
  })),
);
const SelectionSummary = lazy(() =>
  import("./components/SelectionSummary").then((module) => ({
    default: module.SelectionSummary,
  })),
);

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("theme");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [language, setLanguage] = useState<Language>(() => {
    const savedLanguage = window.localStorage.getItem("language");
    return savedLanguage === "tr" ? "tr" : "en";
  });
  const [selection, setSelection] = useState<CoordinateMatch | null>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [filters, setFilters] = useState(emptyDemandFilters);
  const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPalette>("blue");
  const [resetVersion, setResetVersion] = useState(0);
  const [isAnalyticsReady, setIsAnalyticsReady] = useState(false);
  const [predictionWindow, setPredictionWindow] = useState<PredictionWindow>(null);
  const [recursivePredictions, setRecursivePredictions] = useState<RecursivePredictionPoint[]>([]);

  function updateTheme(nextTheme: Theme) {
    window.localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  function updateLanguage(nextLanguage: Language) {
    window.localStorage.setItem("language", nextLanguage);
    setLanguage(nextLanguage);
  }

  function resetUserControls() {
    setFilters(emptyDemandFilters);
    setHeatmapPalette("blue");
    setSelection(null);
    setIsPanelExpanded(false);
    setPredictionWindow(null);
    setRecursivePredictions([]);
    setResetVersion((version) => version + 1);
  }

  useEffect(() => {
    const windowWithIdle = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const handle = windowWithIdle.requestIdleCallback
      ? windowWithIdle.requestIdleCallback(() => setIsAnalyticsReady(true), {
          timeout: 1200,
        })
      : window.setTimeout(() => setIsAnalyticsReady(true), 350);

    return () => {
      if (windowWithIdle.cancelIdleCallback && typeof handle === "number") {
        windowWithIdle.cancelIdleCallback(handle);
        return;
      }

      window.clearTimeout(handle);
    };
  }, []);

  useEffect(() => {
    setPredictionWindow(null);
    setRecursivePredictions([]);
  }, [resetVersion, selection?.provinceNumber]);

  return (
    <main
      className="app-shell"
      data-theme={theme}
      style={{ "--accent": heatmapPalettes[heatmapPalette].accent } as React.CSSProperties}
    >
      <nav className="navbar" aria-label={translations[language].mainNavigation}>
        <FilterBar
          filters={filters}
          language={language}
          onFiltersChange={setFilters}
          resetVersion={resetVersion}
        />
        <div className="navbar-spacer" />
        <div className="theme-toggle" aria-label={translations[language].language}>
          <button
            type="button"
            className={language === "en" ? "active" : ""}
            aria-pressed={language === "en"}
            onClick={() => updateLanguage("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={language === "tr" ? "active" : ""}
            aria-pressed={language === "tr"}
            onClick={() => updateLanguage("tr")}
          >
            TR
          </button>
        </div>
        <div className="theme-toggle" aria-label={translations[language].theme}>
          <button
            type="button"
            className={theme === "light" ? "active" : ""}
            aria-pressed={theme === "light"}
            onClick={() => updateTheme("light")}
          >
            {translations[language].light}
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            aria-pressed={theme === "dark"}
            onClick={() => updateTheme("dark")}
          >
            {translations[language].dark}
          </button>
        </div>
      </nav>
      <section className={isPanelExpanded ? "workspace panel-expanded" : "workspace"}>
        <div className="map-area">
          <TurkeyMap
            filters={filters}
            heatmapPalette={heatmapPalette}
            language={language}
            theme={theme}
            onHeatmapPaletteChange={setHeatmapPalette}
            onResetUserControls={resetUserControls}
            onSelectionChange={setSelection}
            resetVersion={resetVersion}
          />
        </div>
        <aside className="charts-panel" aria-label={translations[language].chartsPanel}>
          {isAnalyticsReady ? (
            <Suspense fallback={<div className="summary-empty">{translations[language].loadingAnalytics}</div>}>
              {selection?.provinceNumber ? (
                <PredictPanel
                  language={language}
                  predictionWindow={predictionWindow}
                  resetVersion={resetVersion}
                  selection={selection}
                  onPredictionsChange={setRecursivePredictions}
                />
              ) : null}
              <SelectionSummary
                isExpanded={isPanelExpanded}
                filters={filters}
                heatmapPalette={heatmapPalette}
                language={language}
                onExpandedChange={setIsPanelExpanded}
                onPredictionWindowChange={setPredictionWindow}
                predictionData={recursivePredictions}
                selection={selection}
              />
            </Suspense>
          ) : (
            <div className="summary-empty">{translations[language].loadingAnalytics}</div>
          )}
        </aside>
      </section>
    </main>
  );
}
