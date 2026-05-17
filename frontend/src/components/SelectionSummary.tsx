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

const timeWindowOptions = [
  { key: "day", label: "Day", durationHours: 24 },
  { key: "week", label: "Week", durationHours: 24 * 7 },
  { key: "month", label: "Month", durationHours: 24 * 30 },
] as const;

type TimeWindowKey = (typeof timeWindowOptions)[number]["key"];
type ChartPoint = {
  label: string;
  searches: number;
};

const pieSegmentColors = [
  "#0284c7",
  "#f97316",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#be123c",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatAxisLabel(value: string, maxLength = 12) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getYAxisTicks(max: number) {
  const roundedMax = Math.round(max);
  const roundedMid = Math.floor(max / 2);

  return [roundedMax, roundedMid, 0]
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((value) => value >= 0);
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div data-tone="neutral">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MiniLineChart({
  data,
  isExpanded,
}: {
  data: ChartPoint[];
  isExpanded: boolean;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const chart = useMemo(() => {
    const max = Math.max(...data.map((item) => item.searches), 0);
    const safeMax = Math.max(max, 1);
    const width = isExpanded ? 1440 : 840;
    const height = isExpanded ? 260 : 230;
    const padding = {
      bottom: 36,
      left: 56,
      right: 24,
      top: 34,
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
      padding,
      plotHeight,
      plotWidth,
      points: coordinates.map((item) => `${item.x},${item.y}`).join(" "),
      total: data.reduce((sum, item) => sum + item.searches, 0),
      width,
    };
  }, [data, isExpanded]);

  if (!data.length) {
    return <p className="chart-empty">No requests in this time window.</p>;
  }

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data.at(-1)?.label ?? "";
  const yTicks = getYAxisTicks(chart.max);
  const hoveredPoint = hoveredIndex === null ? null : chart.coordinates[hoveredIndex];

  function getNearestPoint(clientX: number, target: SVGSVGElement) {
    const bounds = target.getBoundingClientRect();
    const viewBoxX = ((clientX - bounds.left) / bounds.width) * chart.width;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    chart.coordinates.forEach((point, index) => {
      const distance = Math.abs(point.x - viewBoxX);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    return nearestIndex;
  }

  function updateHoveredPoint(clientX: number, target: SVGSVGElement) {
    const nextIndex = getNearestPoint(clientX, target);
    const nextPoint = chart.coordinates[nextIndex];
    const bounds = target.getBoundingClientRect();

    setHoveredIndex(nextIndex);
    setTooltipPosition({
      left: (nextPoint.x / chart.width) * bounds.width,
      top: (nextPoint.y / chart.height) * bounds.height,
    });
  }

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
        onMouseLeave={() => {
          setHoveredIndex(null);
          setTooltipPosition(null);
        }}
        onMouseMove={(event) => updateHoveredPoint(event.clientX, event.currentTarget)}
      >
        {yTicks.map((tick) => {
          const y =
            chart.padding.top +
            chart.plotHeight -
            (tick / Math.max(chart.max, 1)) * chart.plotHeight;

          return (
            <g key={tick}>
              <line
                className="chart-grid-line"
                x1={chart.padding.left}
                x2={chart.padding.left + chart.plotWidth}
                y1={y}
                y2={y}
              />
              <text className="chart-y-label" x={chart.padding.left - 8} y={y + 4}>
                {formatInteger(tick)}
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
        {hoveredPoint ? (
          <>
            <line
              className="chart-hover-line"
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={chart.padding.top}
              y2={chart.padding.top + chart.plotHeight}
            />
            <circle
              className="chart-hover-point"
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={5}
            />
          </>
        ) : null}
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
      {hoveredPoint && tooltipPosition ? (
        <div
          className="line-chart-tooltip"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
          }}
        >
          <strong>{hoveredPoint.label}</strong>
          <span>{formatInteger(hoveredPoint.searches)} requests</span>
        </div>
      ) : null}
    </div>
  );
}

function TimeWindowSlider({
  max,
  value,
  windowKey,
  onChange,
}: {
  max: number;
  value: number;
  windowKey: TimeWindowKey;
  onChange: (value: number) => void;
}) {
  const windowOption =
    timeWindowOptions.find((option) => option.key === windowKey) ?? timeWindowOptions[1];
  const handleWidthPercent = clamp((windowOption.durationHours / (24 * 30)) * 100, 10, 100);
  const leftPercent = max > 0 ? (value / max) * (100 - handleWidthPercent) : 0;

  function updateFromPointer(clientX: number, target: HTMLDivElement) {
    const bounds = target.getBoundingClientRect();
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1);
    onChange(Math.round(ratio * max));
  }

  return (
    <div className="time-window-control">
      <div
        className="time-window-track"
        onPointerDown={(event) => {
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, target);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
          }

          updateFromPointer(event.clientX, event.currentTarget);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        role="slider"
        aria-label="Time window position"
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(clamp(value - 1, 0, max));
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            onChange(clamp(value + 1, 0, max));
          }
        }}
      >
        <div className="time-window-line" />
        <div
          className="time-window-segment"
          style={{
            left: `${leftPercent}%`,
            width: `${handleWidthPercent}%`,
          }}
        />
      </div>
      <div className="time-window-labels">
        <span>Start</span>
        <span>End</span>
      </div>
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
    windowKey === "day"
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
      windowKey === "day"
        ? timestamp.toISOString().slice(0, 13)
        : timestamp.toISOString().slice(0, 10);

    bucket.set(key, (bucket.get(key) ?? 0) + item.searches);
  });

  const points = Array.from(bucket.entries()).map(([key, searches]) => ({
    label: labelFormatter.format(new Date(windowKey === "day" ? `${key}:00:00` : key)),
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

function BarList({
  data,
  getLabel,
}: {
  data: Array<CategorySearchPoint | HourlySearchPoint>;
  getLabel: (item: CategorySearchPoint | HourlySearchPoint) => string;
}) {
  const rawMax = Math.max(...data.map((item) => item.searches), 0);
  const max = Math.max(rawMax, 1);

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

function NumericBarPlot({
  data,
  getLabel,
}: {
  data: Array<CategorySearchPoint | HourlySearchPoint>;
  getLabel: (item: CategorySearchPoint | HourlySearchPoint) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  if (!data.length) {
    return <p className="chart-empty">No data for this selection.</p>;
  }

  const rawMax = Math.max(...data.map((item) => item.searches), 0);
  const max = Math.max(rawMax, 1);
  const width = 840;
  const height = 340;
  const padding = {
    bottom: 56,
    left: 60,
    right: 28,
    top: 28,
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slotWidth = plotWidth / data.length;
  const barWidth = Math.max(12, Math.min(44, slotWidth * 0.68));
  const yTicks = getYAxisTicks(rawMax);
  const labelStep = data.length > 16 ? 3 : data.length > 10 ? 2 : 1;
  const hoveredItem = hoveredIndex === null ? null : data[hoveredIndex];

  function updateTooltip(
    index: number,
    x: number,
    y: number,
    target: SVGSVGElement,
  ) {
    const bounds = target.getBoundingClientRect();

    setHoveredIndex(index);
    setTooltipPosition({
      left: clamp((x / width) * bounds.width, 96, bounds.width - 96),
      top: clamp((y / height) * bounds.height + 12, 12, bounds.height - 56),
    });
  }

  return (
    <div className="numeric-bar-plot">
      <svg
        className="bar-plot-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        onMouseLeave={() => {
          setHoveredIndex(null);
          setTooltipPosition(null);
        }}
      >
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - (tick / max) * plotHeight;

          return (
            <g key={tick}>
              <line
                className="chart-grid-line"
                x1={padding.left}
                x2={padding.left + plotWidth}
                y1={y}
                y2={y}
              />
              <text className="chart-y-label" x={padding.left - 8} y={y + 4}>
                {formatInteger(tick)}
              </text>
            </g>
          );
        })}
        <line
          className="chart-axis"
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={padding.top + plotHeight}
        />
        <line
          className="chart-axis"
          x1={padding.left}
          x2={padding.left + plotWidth}
          y1={padding.top + plotHeight}
          y2={padding.top + plotHeight}
        />
        {data.map((item, index) => {
          const label = getLabel(item);
          const axisLabel = formatAxisLabel(label, data.length > 12 ? 8 : 12);
          const barHeight = Math.max((item.searches / max) * plotHeight, 2);
          const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          const shouldShowLabel = index % labelStep === 0 || index === data.length - 1;

          return (
            <g key={label}>
              <rect
                className="bar-plot-fill"
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                onMouseMove={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;

                  if (svg) {
                    updateTooltip(index, x + barWidth / 2, y, svg);
                  }
                }}
              >
                <title>{`${label}: ${formatInteger(item.searches)} requests`}</title>
              </rect>
              {shouldShowLabel ? (
                <text
                  className="chart-x-label"
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y={height - 18}
                >
                  {axisLabel}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hoveredItem && tooltipPosition ? (
        <div
          className="bar-plot-tooltip"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
          }}
        >
          <strong>{getLabel(hoveredItem)}</strong>
          <span>{formatInteger(hoveredItem.searches)} requests</span>
        </div>
      ) : null}
    </div>
  );
}

function CategoryPieChart({ data }: { data: CategorySearchPoint[] }) {
  const sortedData = [...data].sort((left, right) => right.searches - left.searches);
  const mainCategories = sortedData.slice(0, 6);
  const otherSearches = sortedData
    .slice(6)
    .reduce((sum, item) => sum + item.searches, 0);
  const chartData =
    otherSearches > 0
      ? [...mainCategories, { category: "Other", searches: otherSearches }]
      : mainCategories;
  const total = chartData.reduce((sum, item) => sum + item.searches, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (!data.length || total <= 0) {
    return <p className="chart-empty">No category data for this selection.</p>;
  }

  return (
    <div className="pie-chart-wrap">
      <svg className="pie-chart" viewBox="0 0 120 120" role="img">
        <circle className="pie-chart-base" cx="60" cy="60" r={radius} />
        {chartData.map((item, index) => {
          const ratio = item.searches / total;
          const dashLength = ratio * circumference;
          const dashOffset = -offset;
          const color = pieSegmentColors[index % pieSegmentColors.length];

          offset += dashLength;

          return (
            <circle
              className="pie-chart-segment"
              cx="60"
              cy="60"
              key={item.category}
              r={radius}
              style={{
                stroke: color,
                strokeDasharray: `${dashLength} ${circumference - dashLength}`,
                strokeDashoffset: dashOffset,
              }}
            >
              <title>{`${item.category}: ${formatInteger(item.searches)} requests`}</title>
            </circle>
          );
        })}
        <text className="pie-chart-total" x="60" y="57">
          {formatInteger(total)}
        </text>
        <text className="pie-chart-caption" x="60" y="72">
          total
        </text>
      </svg>
      <div className="pie-legend">
        {chartData.map((item, index) => {
          const percent = Math.round((item.searches / total) * 100);

          return (
            <div className="pie-legend-row" key={item.category}>
              <span
                style={{
                  background: pieSegmentColors[index % pieSegmentColors.length],
                }}
              />
              <strong title={item.category}>{item.category}</strong>
              <em>{percent}%</em>
            </div>
          );
        })}
      </div>
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

function hasEnoughDailyRequests(data: DemandOverviewResponse | ProvinceDemandResponse | null) {
  if (!data?.daily_searches.length) {
    return false;
  }

  const sortedDays = data.daily_searches
    .map((item) => ({
      date: item.date,
      searches: item.searches,
      time: new Date(item.date).getTime(),
    }))
    .sort((left, right) => left.time - right.time);
  const startTime = sortedDays[0]?.time;
  const endTime = sortedDays.at(-1)?.time;

  if (startTime === undefined || endTime === undefined) {
    return false;
  }

  const searchesByDate = new Map(sortedDays.map((item) => [item.date, item.searches]));

  for (
    let currentTime = startTime;
    currentTime <= endTime;
    currentTime += 24 * 60 * 60 * 1000
  ) {
    const dateKey = new Date(currentTime).toISOString().slice(0, 10);

    if ((searchesByDate.get(dateKey) ?? 0) < 5) {
      return false;
    }
  }

  return true;
}

function getSummary(data: DemandOverviewResponse | ProvinceDemandResponse | null) {
  return data?.summary ?? null;
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
  const timeSeries = useMemo(() => activeData?.time_series ?? [], [activeData?.time_series]);
  const categoryBreakdown = activeData?.category_breakdown ?? [];
  const hourlyDistribution = activeData?.hourly_distribution ?? [];
  const topOrganizations = (activeData?.top_organizations ?? []).slice(0, 5);
  const canShowDailyRequestChart = hasEnoughDailyRequests(activeData);
  const availableTimeWindowOptions = canShowDailyRequestChart
    ? timeWindowOptions
    : timeWindowOptions.filter((option) => option.key !== "day");
  const timeChart = useMemo(
    () => aggregateTimeSeries(timeSeries, timeWindow, timeOffset),
    [timeOffset, timeSeries, timeWindow],
  );
  const hasInsufficientProvinceData = Boolean(provinceDemand && !provinceDemand.summary);
  const title = provinceDemand?.name ?? "Turkey overview";
  const subtitle = provinceDemand
    ? `Province ${provinceDemand.province_number}`
    : "All mapped provinces";

  useEffect(() => {
    if (!canShowDailyRequestChart && timeWindow === "day") {
      setTimeWindow("week");
      setTimeOffset(0);
    }
  }, [canShowDailyRequestChart, timeWindow]);

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
          </div>

          <div className="chart-block line-chart-block">
            <div className="chart-header">
              <h3>Search requests</h3>
              <span>{timeChart.rangeLabel}</span>
            </div>
            <div className="chart-controls">
              <div className="time-window-picker">
                <span>Window</span>
                <div className="segmented-control">
                  {availableTimeWindowOptions.map((option) => (
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
              </div>
              {!canShowDailyRequestChart ? (
                <p className="chart-note">
                  Day view is hidden because at least one day has fewer than 5 requests.
                </p>
              ) : null}
              <TimeWindowSlider
                max={timeChart.maxOffset}
                value={Math.min(timeOffset, timeChart.maxOffset)}
                windowKey={timeWindow}
                onChange={setTimeOffset}
              />
            </div>
            <MiniLineChart data={timeChart.points} isExpanded={isExpanded} />
          </div>

          {isExpanded ? (
            <div className="expanded-chart-grid">
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Request types</h3>
                </div>
                <NumericBarPlot
                  data={categoryBreakdown}
                  getLabel={(item) => "category" in item ? item.category : String(item.hour)}
                />
              </div>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>Category distribution</h3>
                </div>
                <CategoryPieChart data={categoryBreakdown} />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Hourly distribution</h3>
                </div>
                <NumericBarPlot
                  data={hourlyDistribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : item.category}
                />
              </div>
              <div className="chart-block full-width-chart">
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
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Categories</h3>
                </div>
                <NumericBarPlot
                  data={provinceDemand.category_breakdown}
                  getLabel={(item) => "category" in item ? item.category : String(item.hour)}
                />
              </div>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>Category distribution</h3>
                </div>
                <CategoryPieChart data={provinceDemand.category_breakdown} />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Hours</h3>
                </div>
                <NumericBarPlot
                  data={provinceDemand.hourly_distribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : item.category}
                />
              </div>
              <div className="chart-block top-organizations-block">
                <div className="chart-header">
                  <h3>Top 5 organizations</h3>
                  <span>Rating</span>
                </div>
                <OrganizationList data={topOrganizations} />
              </div>
            </>
          ) : overview ? (
            <>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Request types</h3>
                </div>
                <NumericBarPlot
                  data={overview.category_breakdown}
                  getLabel={(item) => "category" in item ? item.category : String(item.hour)}
                />
              </div>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>Category distribution</h3>
                </div>
                <CategoryPieChart data={overview.category_breakdown} />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>Hours</h3>
                </div>
                <NumericBarPlot
                  data={overview.hourly_distribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : item.category}
                />
              </div>
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
              <div className="chart-block top-organizations-block">
                <div className="chart-header">
                  <h3>Top 5 organizations</h3>
                  <span>Rating</span>
                </div>
                <OrganizationList data={topOrganizations} />
              </div>
            </>
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
