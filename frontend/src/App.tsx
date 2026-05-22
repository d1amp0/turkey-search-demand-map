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
const STATS_ONLY_QUERY = "(max-width: 1000px)";

const SelectionSummary = lazy(() =>
  import("./components/SelectionSummary").then((module) => ({
    default: module.SelectionSummary,
  })),
);

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);

    return () => {
      mediaQuery.removeEventListener("change", updateMatches);
    };
  }, [query]);

  return matches;
}

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
  const [isPredictionLoading, setIsPredictionLoading] = useState(false);
  const [selectedRadiusKm, setSelectedRadiusKm] = useState(25);
  const [isMapPickEnabled, setIsMapPickEnabled] = useState(false);
  const isStatsOnlyLayout = useMediaQuery(STATS_ONLY_QUERY);

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
    setSelectedRadiusKm(25);
    setIsMapPickEnabled(false);
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

  useEffect(() => {
    if (!predictionWindow) {
      setRecursivePredictions([]);
    }
  }, [predictionWindow]);

  useEffect(() => {
    if (!isStatsOnlyLayout) {
      return;
    }

    setSelection(null);
    setIsMapPickEnabled(false);
    setPredictionWindow(null);
    setRecursivePredictions([]);
    setIsPanelExpanded(false);
  }, [isStatsOnlyLayout]);

  return (
    <main
      className="app-shell"
      data-prediction-loading={isPredictionLoading ? "true" : "false"}
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
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            <span>{translations[language].light}</span>
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            aria-pressed={theme === "dark"}
            onClick={() => updateTheme("dark")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span>{translations[language].dark}</span>
          </button>
        </div>
      </nav>
      <section
        className={[
          "workspace",
          isPanelExpanded ? "panel-expanded" : "",
          isStatsOnlyLayout ? "stats-only" : "",
        ].filter(Boolean).join(" ")}
      >
        {!isStatsOnlyLayout ? (
          <div className="map-area">
            <TurkeyMap
              filters={filters}
              heatmapPalette={heatmapPalette}
              language={language}
              theme={theme}
              isMapPickEnabled={isMapPickEnabled}
              onHeatmapPaletteChange={setHeatmapPalette}
              onResetUserControls={resetUserControls}
              onMapPickEnabledChange={setIsMapPickEnabled}
              onSelectionChange={setSelection}
              radiusKm={selectedRadiusKm}
              resetVersion={resetVersion}
              selection={selection}
            />
          </div>
        ) : null}
        <aside className="charts-panel" aria-label={translations[language].chartsPanel}>
          {isAnalyticsReady ? (
            <Suspense fallback={<div className="summary-empty">{translations[language].loadingAnalytics}</div>}>
              <SelectionSummary
                isExpanded={isPanelExpanded}
                filters={filters}
                heatmapPalette={heatmapPalette}
                language={language}
                isMapPickEnabled={isMapPickEnabled}
                onExpandedChange={setIsPanelExpanded}
                onMapPickEnabledChange={setIsMapPickEnabled}
                onRadiusKmChange={setSelectedRadiusKm}
                onSelectionChange={setSelection}
                predictionData={recursivePredictions}
                onPredictionsChange={setRecursivePredictions}
                isPredictionLoading={isPredictionLoading}
                onPredictionLoadingChange={setIsPredictionLoading}
                radiusKm={selectedRadiusKm}
                resetVersion={resetVersion}
                selection={selection}
              />
            </Suspense>
          ) : (
            <div className="summary-empty">{translations[language].loadingAnalytics}</div>
          )}
        </aside>
      </section>
      {isPredictionLoading ? (
        <div className="interaction-lock" aria-hidden="true" />
      ) : null}
    </main>
  );
}
