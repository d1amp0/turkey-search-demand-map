import { useEffect, useMemo, useState } from "react";
import { fetchDemandOverview, fetchProvinceDemand } from "../api/client";
import type {
  CategorySearchPoint,
  DailySearchPoint,
  DemandOverviewResponse,
  HourlySearchPoint,
  ProvinceDemandResponse,
} from "../types/region";
import type { CoordinateMatch } from "../types/selection";

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MiniLineChart({ data }: { data: DailySearchPoint[] }) {
  const points = useMemo(() => {
    const max = Math.max(...data.map((item) => item.searches), 1);

    return data
      .map((item, index) => {
        const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 100;
        const y = 100 - (item.searches / max) * 86;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data]);

  return (
    <svg className="mini-line-chart" viewBox="0 0 100 100" role="img">
      <polyline points={points} />
    </svg>
  );
}

function BarList({
  data,
  getLabel,
}: {
  data: Array<CategorySearchPoint | HourlySearchPoint>;
  getLabel: (item: CategorySearchPoint | HourlySearchPoint) => string;
}) {
  const max = Math.max(...data.map((item) => item.searches), 1);

  return (
    <div className="bar-list">
      {data.map((item) => (
        <div className="bar-row" key={getLabel(item)}>
          <span>{getLabel(item)}</span>
          <div className="bar-track">
            <div style={{ width: `${(item.searches / max) * 100}%` }} />
          </div>
          <strong>{formatInteger(item.searches)}</strong>
        </div>
      ))}
    </div>
  );
}

function getSummary(data: DemandOverviewResponse | ProvinceDemandResponse | null) {
  return data?.summary ?? null;
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function SelectionSummary({
  selection,
}: {
  selection: CoordinateMatch | null;
}) {
  const [overview, setOverview] = useState<DemandOverviewResponse | null>(null);
  const [provinceDemand, setProvinceDemand] =
    useState<ProvinceDemandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDemandOverview()
      .then((nextOverview) => {
        setOverview(nextOverview);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load");
      });
  }, []);

  useEffect(() => {
    if (!selection?.provinceNumber) {
      setProvinceDemand(null);
      return;
    }

    void fetchProvinceDemand(selection.provinceNumber)
      .then((nextProvinceDemand) => {
        setProvinceDemand(nextProvinceDemand);
        setError(null);
      })
      .catch((loadError) => {
        setProvinceDemand(null);
        setError(loadError instanceof Error ? loadError.message : "Failed to load");
      });
  }, [selection?.provinceNumber]);

  const activeData = provinceDemand ?? overview;
  const summary = getSummary(activeData);
  const dailySearches = activeData?.daily_searches ?? [];
  const title = provinceDemand?.name ?? "Turkey overview";
  const subtitle = provinceDemand
    ? `Province ${provinceDemand.province_number}`
    : "All mapped provinces";

  return (
    <section className="summary-panel" aria-label="Selection summary">
      <div className="summary-header">
        <span>Analytics</span>
        <span>{selection?.regionName ? "Province" : "Overview"}</span>
      </div>

      {summary ? (
        <div className="summary-content">
          <div className="summary-primary">
            <div>
              <strong>{selection?.regionName ?? title}</strong>
              <span>
                {selection?.provinceNumber ? subtitle : "Select a province for details"}
              </span>
            </div>
            <div className="summary-primary-metric">
              <span>Searches</span>
              <strong>{formatInteger(summary.searches)}</strong>
            </div>
          </div>

          <dl className="summary-grid">
            <MetricTile label="No results" value={formatPercent(summary.no_result_rate)} />
            <MetricTile label="Avg rating" value={summary.avg_rating.toFixed(2)} />
            <MetricTile label="Avg steps" value={summary.avg_steps.toFixed(1)} />
            <MetricTile label="Source coverage" value={formatPercent(summary.source_coverage)} />
          </dl>

          <div className="chart-block">
            <div className="chart-header">
              <h3>30-day demand</h3>
              <span>{formatDate(dailySearches.at(-1)?.date)}</span>
            </div>
            <MiniLineChart data={dailySearches} />
          </div>

          {provinceDemand ? (
            <>
              <div className="chart-block">
                <div className="chart-header">
                  <h3>Categories</h3>
                </div>
                <BarList
                  data={provinceDemand.category_breakdown}
                  getLabel={(item) => "category" in item ? item.category : String(item.hour)}
                />
              </div>
              <div className="chart-block">
                <div className="chart-header">
                  <h3>Hours</h3>
                </div>
                <BarList
                  data={provinceDemand.hourly_distribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : item.category}
                />
              </div>
            </>
          ) : overview ? (
            <div className="chart-block">
              <div className="chart-header">
                <h3>Top provinces</h3>
              </div>
              <BarList
                data={overview.top_provinces.map((province) => ({
                  category: province.name,
                  searches: province.summary.searches,
                }))}
                getLabel={(item) => "category" in item ? item.category : String(item.hour)}
              />
            </div>
          ) : null}

          {selection &&
          selection.latitude !== null &&
          selection.longitude !== null ? (
            <dl className="coordinate-grid">
              <MetricTile label="Latitude" value={selection.latitude.toFixed(6)} />
              <MetricTile label="Longitude" value={selection.longitude.toFixed(6)} />
            </dl>
          ) : null}
        </div>
      ) : (
        <p className="summary-empty">{error ?? "Loading demand analytics..."}</p>
      )}
    </section>
  );
}
