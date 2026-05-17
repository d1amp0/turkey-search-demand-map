import { useEffect, useMemo, useState } from "react";
import { fetchDemandOverview, fetchProvinceDemand } from "../api/client";
import type { DemandFilters } from "../types/filters";
import type { HeatmapPalette } from "../types/palette";
import type {
  CategorySearchPoint,
  DemandOverviewResponse,
  HourlySearchPoint,
  ProvinceDemandResponse,
  TimeSearchPoint,
  TopOrganization,
} from "../types/region";
import type { CoordinateMatch } from "../types/selection";

const chartColors = ["#0284c7", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed"];
const timeWindowOptions = [
  { key: "hour", label: "Hour", durationHours: 1 },
  { key: "day", label: "Day", durationHours: 24 },
  { key: "week", label: "Week", durationHours: 24 * 7 },
  { key: "month", label: "Month", durationHours: 24 * 30 },
] as const;

type TimeWindowKey = (typeof timeWindowOptions)[number]["key"];
type ChartPoint = {
  label: string;
  searches: number;
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function MetricTile({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "good" | "warning" | "bad" | "neutral";
  value: string;
}) {
  return (
    <div data-tone={tone ?? "neutral"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MiniLineChart({ data }: { data: ChartPoint[] }) {
  const chart = useMemo(() => {
    const max = Math.max(...data.map((item) => item.searches), 0);
    const safeMax = Math.max(max, 1);
    const width = 320;
    const height = 180;
    const padding = {
      bottom: 30,
      left: 48,
      right: 14,
      top: 18,
    };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const coordinates = data.map((item, index) => {
      const x =
        padding.left +
        (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
      const y = padding.top + plotHeight - (item.searches / safeMax) * plotHeight;

      return {
        ...item,
        x,
        y,
      };
    });

    return {
      coordinates,
      height,
      max,
      mid: max / 2,
      padding,
      plotHeight,
      plotWidth,
      points: coordinates.map((item) => `${item.x},${item.y}`).join(" "),
      total: data.reduce((sum, item) => sum + item.searches, 0),
      width,
    };
  }, [data]);

  if (!data.length) {
    return <p className="chart-empty">No requests in this time window.</p>;
  }

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data.at(-1)?.label ?? "";
  const yTicks = [
    { label: formatInteger(chart.max), value: chart.max },
    { label: formatInteger(chart.mid), value: chart.mid },
    { label: "0", value: 0 },
  ];

  return (
    <div className="line-chart-wrap">
      <div className="line-chart-metric">
        <span>Total requests</span>
        <strong>{formatInteger(chart.total)}</strong>
      </div>
      <svg
        className="mini-line-chart"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
      >
        {yTicks.map((tick) => {
          const y =
            chart.padding.top +
            chart.plotHeight -
            (tick.value / Math.max(chart.max, 1)) * chart.plotHeight;

          return (
            <g key={tick.label}>
              <line
                className="chart-grid-line"
                x1={chart.padding.left}
                x2={chart.padding.left + chart.plotWidth}
                y1={y}
                y2={y}
              />
              <text className="chart-y-label" x={chart.padding.left - 8} y={y + 4}>
                {tick.label}
              </text>
            </g>
          );
        })}
        <line
          className="chart-axis"
          x1={chart.padding.left}
          x2={chart.padding.left}
          y1={chart.padding.top}
          y2={chart.padding.top + chart.plotHeight}
        />
        <line
          className="chart-axis"
          x1={chart.padding.left}
          x2={chart.padding.left + chart.plotWidth}
          y1={chart.padding.top + chart.plotHeight}
          y2={chart.padding.top + chart.plotHeight}
        />
        <polyline points={chart.points} />
        {chart.coordinates.map((item, index) => (
          <circle
            className="chart-point"
            cx={item.x}
            cy={item.y}
            key={`${item.label}-${index}`}
            r={data.length > 24 && index % 2 !== 0 ? 2 : 3}
          >
            <title>{`${item.label}: ${formatInteger(item.searches)}`}</title>
          </circle>
        ))}
        <text
          className="chart-x-label"
          x={chart.padding.left}
          y={chart.height - 8}
        >
          {firstLabel}
        </text>
        <text
          className="chart-x-label end"
          x={chart.padding.left + chart.plotWidth}
          y={chart.height - 8}
        >
          {lastLabel}
        </text>
      </svg>
    </div>
  );
}

function aggregateTimeSeries(
  data: TimeSearchPoint[],
  windowKey: TimeWindowKey,
  offset: number,
) {
  if (!data.length) {
    return {
      maxOffset: 0,
      points: [] as ChartPoint[],
      rangeLabel: "",
    };
  }

  const sorted = [...data].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const windowOption =
    timeWindowOptions.find((option) => option.key === windowKey) ?? timeWindowOptions[1];
  const startTime = new Date(sorted[0].timestamp).getTime();
  const endTime = new Date(sorted.at(-1)?.timestamp ?? sorted[0].timestamp).getTime();
  const hourMs = 60 * 60 * 1000;
  const durationMs = windowOption.durationHours * hourMs;
  const maxOffset = Math.max(0, Math.ceil((endTime - startTime - durationMs) / hourMs));
  const safeOffset = Math.min(offset, maxOffset);
  const selectedStart = startTime + safeOffset * hourMs;
  const selectedEnd = selectedStart + durationMs;
  const selected = sorted.filter((item) => {
    const timestamp = new Date(item.timestamp).getTime();
    return timestamp >= selectedStart && timestamp < selectedEnd;
  });
  const bucket = new Map<string, number>();
  const labelFormatter =
    windowKey === "hour" || windowKey === "day"
      ? new Intl.DateTimeFormat("en-US", {
          day: "2-digit",
          hour: "2-digit",
          month: "short",
        })
      : new Intl.DateTimeFormat("en-US", {
          day: "2-digit",
          month: "short",
        });

  selected.forEach((item) => {
    const timestamp = new Date(item.timestamp);
    const key =
      windowKey === "hour" || windowKey === "day"
        ? timestamp.toISOString().slice(0, 13)
        : timestamp.toISOString().slice(0, 10);

    bucket.set(key, (bucket.get(key) ?? 0) + item.searches);
  });

  const points = Array.from(bucket.entries()).map(([key, searches]) => ({
    label: labelFormatter.format(new Date(windowKey === "hour" || windowKey === "day" ? `${key}:00:00` : key)),
    searches,
  }));
  const rangeFormatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: windowKey === "month" || windowKey === "week" ? undefined : "2-digit",
    month: "short",
  });

  return {
    maxOffset,
    points,
    rangeLabel: `${rangeFormatter.format(new Date(selectedStart))} - ${rangeFormatter.format(new Date(Math.min(selectedEnd, endTime)))}`,
  };
}

function PieChart({ data }: { data: CategorySearchPoint[] }) {
  const total = data.reduce((sum, item) => sum + item.searches, 0);
  let offset = 25;

  if (!total) {
    return null;
  }

  return (
    <div className="pie-chart-wrap">
      <svg className="pie-chart" viewBox="0 0 42 42" role="img">
        <circle className="pie-chart-base" cx="21" cy="21" r="15.915" />
        {data.map((item, index) => {
          const share = (item.searches / total) * 100;
          const segment = (
            <circle
              className="pie-chart-segment"
              cx="21"
              cy="21"
              key={item.category}
              r="15.915"
              stroke={chartColors[index % chartColors.length]}
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={offset}
            />
          );

          offset -= share;
          return segment;
        })}
      </svg>
      <div className="pie-legend">
        {data.map((item, index) => (
          <div className="pie-legend-row" key={item.category}>
            <span style={{ background: chartColors[index % chartColors.length] }} />
            <strong>{item.category}</strong>
            <em>{formatPercent(item.searches / total)}</em>
          </div>
        ))}
      </div>
    </div>
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

function OrganizationList({ data }: { data: TopOrganization[] }) {
  if (!data.length) {
    return <p className="summary-empty">No organizations for this selection.</p>;
  }

  return (
    <div className="organization-list">
      {data.map((organization) => (
        <div className="organization-row" key={`${organization.name}-${organization.category}`}>
          <div>
            <strong>{organization.name}</strong>
            <span>{organization.category}</span>
          </div>
          <em>{organization.rating.toFixed(2)}</em>
        </div>
      ))}
    </div>
  );
}

function getSummary(data: DemandOverviewResponse | ProvinceDemandResponse | null) {
  return data?.summary ?? null;
}

function ratingTone(value: number) {
  if (value >= 4) {
    return "good";
  }

  if (value >= 3) {
    return "warning";
  }

  return "bad";
}

function inverseRateTone(value: number) {
  if (value <= 0.15) {
    return "good";
  }

  if (value <= 0.3) {
    return "warning";
  }

  return "bad";
}

function coverageTone(value: number) {
  if (value >= 0.75) {
    return "good";
  }

  if (value >= 0.5) {
    return "warning";
  }

  return "bad";
}

function stepsTone(value: number) {
  if (value <= 3) {
    return "good";
  }

  if (value <= 6) {
    return "warning";
  }

  return "bad";
}

export function SelectionSummary({
  filters,
  heatmapPalette,
  isExpanded,
  onExpandedChange,
  selection,
}: {
  filters: DemandFilters;
  heatmapPalette: HeatmapPalette;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  selection: CoordinateMatch | null;
}) {
  const [overview, setOverview] = useState<DemandOverviewResponse | null>(null);
  const [provinceDemand, setProvinceDemand] =
    useState<ProvinceDemandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindowKey>("day");
  const [timeOffset, setTimeOffset] = useState(0);

  useEffect(() => {
    void fetchDemandOverview(filters)
      .then((nextOverview) => {
        setOverview(nextOverview);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load");
      });
  }, [filters]);

  useEffect(() => {
    if (!selection?.provinceNumber) {
      setProvinceDemand(null);
      return;
    }

    void fetchProvinceDemand(selection.provinceNumber, filters)
      .then((nextProvinceDemand) => {
        setProvinceDemand(nextProvinceDemand);
        setError(null);
      })
      .catch((loadError) => {
        setProvinceDemand(null);
        setError(loadError instanceof Error ? loadError.message : "Failed to load");
      });
  }, [filters, selection?.provinceNumber]);

  const activeData = provinceDemand ?? overview;
  const summary = getSummary(activeData);
  const timeSeries = activeData?.time_series ?? [];
  const categoryBreakdown = activeData?.category_breakdown ?? [];
  const hourlyDistribution = activeData?.hourly_distribution ?? [];
  const topOrganizations = (activeData?.top_organizations ?? []).slice(0, 5);
  const timeChart = useMemo(
    () => aggregateTimeSeries(timeSeries, timeWindow, timeOffset),
    [timeOffset, timeSeries, timeWindow],
  );
  const hasInsufficientProvinceData = Boolean(provinceDemand && !provinceDemand.summary);
  const title = provinceDemand?.name ?? "Turkey overview";
  const subtitle = provinceDemand
    ? `Province ${provinceDemand.province_number}`
    : "All mapped provinces";

  return (
    <section
      className="summary-panel"
      aria-label="Selection summary"
      data-palette={heatmapPalette}
    >
      <div className="summary-header">
        <span>Analytics</span>
        <div className="summary-actions">
          <span>{selection?.regionName ? "Province" : "Overview"}</span>
          <button type="button" onClick={() => onExpandedChange(!isExpanded)}>
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {summary ? (
        <div className={isExpanded ? "summary-content expanded" : "summary-content"}>
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
            <MetricTile
              label="No results"
              tone={inverseRateTone(summary.no_result_rate)}
              value={formatPercent(summary.no_result_rate)}
            />
            <MetricTile
              label="Avg rating"
              tone={ratingTone(summary.avg_rating)}
              value={summary.avg_rating.toFixed(2)}
            />
            <MetricTile
              label="Avg steps"
              tone={stepsTone(summary.avg_steps)}
              value={summary.avg_steps.toFixed(1)}
            />
            <MetricTile
              label="Source coverage"
              tone={coverageTone(summary.source_coverage)}
              value={formatPercent(summary.source_coverage)}
            />
          </dl>

          <div className="chart-block line-chart-block">
            <div className="chart-header">
              <h3>Search requests</h3>
              <span>{timeChart.rangeLabel}</span>
            </div>
            <div className="chart-controls">
              <div className="segmented-control">
                {timeWindowOptions.map((option) => (
                  <button
                    className={timeWindow === option.key ? "active" : ""}
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setTimeWindow(option.key);
                      setTimeOffset(0);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <input
                aria-label="Time window"
                max={timeChart.maxOffset}
                min={0}
                type="range"
                value={Math.min(timeOffset, timeChart.maxOffset)}
                onChange={(event) => setTimeOffset(Number(event.target.value))}
              />
            </div>
            <MiniLineChart data={timeChart.points} />
          </div>

          <div className="chart-block top-organizations-block">
            <div className="chart-header">
              <h3>Top 5 organizations</h3>
              <span>Rating</span>
            </div>
            <OrganizationList data={topOrganizations} />
          </div>

          {isExpanded ? (
            <div className="expanded-chart-grid">
              <div className="chart-block">
                <div className="chart-header">
                  <h3>Request types</h3>
                </div>
                <PieChart data={categoryBreakdown} />
              </div>
              <div className="chart-block">
                <div className="chart-header">
                  <h3>Hourly distribution</h3>
                </div>
                <BarList
                  data={hourlyDistribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : item.category}
                />
              </div>
              <div className="chart-block">
                <div className="chart-header">
                  <h3>{provinceDemand ? "Categories" : "Top provinces"}</h3>
                </div>
                {provinceDemand ? (
                  <BarList
                    data={provinceDemand.category_breakdown}
                    getLabel={(item) =>
                      "category" in item ? item.category : String(item.hour)
                    }
                  />
                ) : overview ? (
                  <BarList
                    data={overview.top_provinces.map((province) => ({
                      category: province.name,
                      searches: province.summary.searches,
                    }))}
                    getLabel={(item) =>
                      "category" in item ? item.category : String(item.hour)
                    }
                  />
                ) : null}
              </div>
            </div>
          ) : provinceDemand ? (
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
        <div className="summary-empty">
          {hasInsufficientProvinceData
            ? "Данных недостаточно для построения графиков."
            : error ?? "Loading demand analytics..."}
        </div>
      )}
    </section>
  );
}
