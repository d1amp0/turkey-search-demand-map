import { useEffect, useMemo, useState } from "react";
import {
  fetchDemandOverview,
  fetchProvinceDemand,
} from "../api/client";
import { translations, translateCategory } from "../i18n";
import type { DemandFilters } from "../types/filters";
import type { Language } from "../i18n";
import type { HeatmapPalette } from "../types/palette";
import type { PredictionWindow, RecursivePredictionPoint } from "../types/ml";
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
  { key: "day", labelKey: "day", durationHours: 24 },
  { key: "week", labelKey: "week", durationHours: 24 * 7 },
  { key: "month", labelKey: "month", durationHours: 24 * 30 },
  { key: "all", labelKey: "allTime", durationHours: null },
] as const;

type TimeWindowKey = (typeof timeWindowOptions)[number]["key"];
type ChartPoint = {
  key: string;
  label: string;
  searches: number;
  time: number;
};
type PredictionChartPoint = {
  key: string;
  label: string;
  prediction: number;
  time: number;
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

function formatLocalHourTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00`;
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addHours(timestamp: number, hours: number) {
  return timestamp + hours * 60 * 60 * 1000;
}

function bucketKeyForTimestamp(timestamp: Date, windowKey: TimeWindowKey) {
  if (windowKey === "day") {
    return formatLocalHourTimestamp(timestamp.getTime()).slice(0, 13);
  }

  return formatLocalDateKey(timestamp);
}

function dateFromBucketKey(key: string, windowKey: TimeWindowKey) {
  return new Date(windowKey === "day" ? `${key}:00:00` : `${key}T00:00:00`);
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
  language,
  predictionData = [],
}: {
  data: ChartPoint[];
  isExpanded: boolean;
  language: Language;
  predictionData?: PredictionChartPoint[];
}) {
  const t = translations[language];
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const chart = useMemo(() => {
    const max = Math.max(
      ...data.map((item) => item.searches),
      ...predictionData.map((item) => item.prediction),
      0,
    );
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
    const allTimes = [
      ...data.map((item) => item.time),
      ...predictionData.map((item) => item.time),
    ];
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const timeRange = Math.max(maxTime - minTime, 1);
    const xForTime = (time: number) =>
      padding.left +
      (allTimes.length === 1 ? plotWidth / 2 : ((time - minTime) / timeRange) * plotWidth);
    const coordinates = data.map((item) => {
      const x = xForTime(item.time);
      const y = padding.top + plotHeight - (item.searches / safeMax) * plotHeight;

      return {
        ...item,
        x,
        y,
      };
    });
    const predictionCoordinates = predictionData.map((item) => {
      const x =
        padding.left +
        (allTimes.length === 1 ? plotWidth / 2 : ((item.time - minTime) / timeRange) * plotWidth);
      const y = padding.top + plotHeight - (item.prediction / safeMax) * plotHeight;

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
      predictionPoints: predictionCoordinates.map((item) => `${item.x},${item.y}`).join(" "),
      predictionCoordinates,
      total: data.reduce((sum, item) => sum + item.searches, 0),
      width,
    };
  }, [data, isExpanded, predictionData]);

  if (!data.length) {
    return <p className="chart-empty">{t.noRequests}</p>;
  }

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data.at(-1)?.label ?? "";
  const yTicks = getYAxisTicks(chart.max);
  const hoveredPoint = hoveredIndex === null ? null : chart.coordinates[hoveredIndex];
  const hasPredictionLine = chart.predictionCoordinates.length > 0;

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
    const left = (nextPoint.x / chart.width) * bounds.width;
    const top = (nextPoint.y / chart.height) * bounds.height;

    setHoveredIndex(nextIndex);
    setTooltipPosition({
      left: clamp(left, 112, bounds.width - 112),
      top: clamp(top + 14, 12, bounds.height - 64),
    });
  }

  return (
    <div className="line-chart-wrap">
      <div className="line-chart-metric">
        <span>{t.totalRequests}</span>
        <strong>{formatInteger(chart.total)}</strong>
      </div>
      <div className="line-chart-legend">
        <span><i data-series="actual" />{t.requests}</span>
        {hasPredictionLine ? (
          <span><i data-series="prediction" />{t.predictedRequests}</span>
        ) : null}
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
        <polyline className="actual-line" points={chart.points} />
        {hasPredictionLine ? (
          <polyline className="prediction-line" points={chart.predictionPoints}>
            <title>{t.predictedRequests}</title>
          </polyline>
        ) : null}
        {chart.predictionCoordinates.map((item, index) => (
          <circle
            className="prediction-chart-point"
            cx={item.x}
            cy={item.y}
            key={`${item.key}-${index}`}
            r={predictionData.length > 24 && index % 2 !== 0 ? 1.8 : 2.8}
          >
            <title>{`${item.label}: ${formatInteger(item.prediction)} ${t.predictedRequests.toLowerCase()}`}</title>
          </circle>
        ))}
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
          <span>{formatInteger(hoveredPoint.searches)} {t.requests.toLowerCase()}</span>
        </div>
      ) : null}
    </div>
  );
}

function TimeWindowSlider({
  language,
  max,
  value,
  windowKey,
  onChange,
}: {
  language: Language;
  max: number;
  value: number;
  windowKey: TimeWindowKey;
  onChange: (value: number) => void;
}) {
  const t = translations[language];
  const windowOption =
    timeWindowOptions.find((option) => option.key === windowKey) ?? timeWindowOptions[1];
  const durationHours = windowOption.durationHours ?? 24 * 30;
  const handleWidthPercent = clamp((durationHours / (24 * 30)) * 100, 10, 100);
  const safeValue = clamp(value, 0, max);
  const leftPercent = max > 0 ? (safeValue / max) * (100 - handleWidthPercent) : 0;

  return (
    <div className="time-window-control">
      <label className="time-window-track">
        <div className="time-window-line" />
        <div
          className="time-window-segment"
          style={{
            left: `${leftPercent}%`,
            width: `${handleWidthPercent}%`,
          }}
        />
        <input
          aria-label={t.window}
          max={max}
          min={0}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          step={1}
          type="range"
          value={safeValue}
        />
      </label>
      <div className="time-window-labels">
        <span>{t.start}</span>
        <span>{t.end}</span>
      </div>
    </div>
  );
}

function aggregateTimeSeries(
  data: TimeSearchPoint[],
  language: Language,
  windowKey: TimeWindowKey,
  offset: number,
) {
  if (!data.length) {
    return {
      maxOffset: 0,
      points: [] as ChartPoint[],
      predictionAnchorPoint: null as ChartPoint | null,
      predictionStartTimestamp: null as string | null,
      predictionHours: 0,
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
  const durationMs =
    windowOption.durationHours === null
      ? Math.max(endTime - startTime + hourMs, hourMs)
      : windowOption.durationHours * hourMs;
  const maxOffset = Math.max(0, Math.ceil((endTime - startTime - durationMs) / hourMs));
  const safeOffset = Math.min(offset, maxOffset);
  const selectedStart = startTime + safeOffset * hourMs;
  const selectedEnd = selectedStart + durationMs;
  const selectedRangeEnd = Math.max(selectedStart, Math.min(selectedEnd - hourMs, endTime));
  const selected = sorted.filter((item) => {
    const timestamp = new Date(item.timestamp).getTime();
    return timestamp >= selectedStart && timestamp < selectedEnd;
  });
  const bucket = new Map<string, number>();
  const labelFormatter =
    windowKey === "day"
      ? new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
          day: "2-digit",
          hour: "2-digit",
          month: "short",
        })
      : windowKey === "all"
        ? new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })
      : new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
          day: "2-digit",
          month: "short",
        });

  selected.forEach((item) => {
    const timestamp = new Date(item.timestamp);
    const key = bucketKeyForTimestamp(timestamp, windowKey);

    bucket.set(key, (bucket.get(key) ?? 0) + item.searches);
  });

  const points = Array.from(bucket.entries()).map(([key, searches]) => ({
    key,
    label: labelFormatter.format(dateFromBucketKey(key, windowKey)),
    searches,
    time: dateFromBucketKey(key, windowKey).getTime(),
  }));
  const anchorPoint = points[0] ?? null;
  const predictionStartTime = anchorPoint ? addHours(anchorPoint.time, 1) : selectedStart;
  const predictionEndTime = points.at(-1)?.time ?? selectedRangeEnd;
  const predictionHours = Math.min(
    24 * 30,
    Math.max(1, Math.floor((predictionEndTime - predictionStartTime) / hourMs) + 1),
  );
  const rangeFormatter = new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
    day: "2-digit",
    hour: windowKey === "month" || windowKey === "week" || windowKey === "all" ? undefined : "2-digit",
    month: "short",
    year: windowKey === "all" ? "2-digit" : undefined,
  });

  return {
    maxOffset,
    predictionAnchorPoint: anchorPoint,
    points,
    predictionStartTimestamp: formatLocalHourTimestamp(predictionStartTime),
    predictionHours,
    rangeLabel: `${rangeFormatter.format(new Date(selectedStart))} - ${rangeFormatter.format(new Date(selectedRangeEnd))}`,
  };
}

function aggregateRecursivePredictionSeries(
  data: RecursivePredictionPoint[],
  language: Language,
  windowKey: TimeWindowKey,
  anchorPoint: ChartPoint | null,
) {
  const bucket = new Map<string, number>();
  const labelFormatter =
    windowKey === "day"
      ? new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
          day: "2-digit",
          hour: "2-digit",
          month: "short",
        })
      : windowKey === "all"
        ? new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })
        : new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
            day: "2-digit",
            month: "short",
          });

  data.forEach((item) => {
    const timestamp = new Date(item.timestamp);
    const key = bucketKeyForTimestamp(timestamp, windowKey);

    bucket.set(key, (bucket.get(key) ?? 0) + item.prediction);
  });

  const points = Array.from(bucket.entries()).map(([key, prediction]) => ({
    key,
    label: labelFormatter.format(dateFromBucketKey(key, windowKey)),
    prediction,
    time: dateFromBucketKey(key, windowKey).getTime(),
  }));

  if (!anchorPoint || !data.length) {
    return points;
  }

  return [
    {
      key: anchorPoint.key,
      label: anchorPoint.label,
      prediction: anchorPoint.searches,
      time: anchorPoint.time,
    },
    ...points.filter((point) => point.key !== anchorPoint.key),
  ];
}

function BarList({
  data,
  getLabel,
  language,
}: {
  data: Array<CategorySearchPoint | HourlySearchPoint>;
  getLabel: (item: CategorySearchPoint | HourlySearchPoint) => string;
  language: Language;
}) {
  if (!data.length) {
    return <p className="chart-empty">{translations[language].noData}</p>;
  }

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
  language,
}: {
  data: Array<CategorySearchPoint | HourlySearchPoint>;
  getLabel: (item: CategorySearchPoint | HourlySearchPoint) => string;
  language: Language;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  if (!data.length) {
    return <p className="chart-empty">{translations[language].noData}</p>;
  }

  const rawMax = Math.max(...data.map((item) => item.searches), 0);
  const max = Math.max(rawMax, 1);
  const width = 840;
  const height = 340;
  const padding = {
    bottom: 92,
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
      left: clamp((x / width) * bounds.width, 120, bounds.width - 120),
      top: clamp((y / height) * bounds.height + 14, 12, bounds.height - 68),
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
                <title>{`${label}: ${formatInteger(item.searches)} ${translations[language].requests.toLowerCase()}`}</title>
              </rect>
              {shouldShowLabel ? (
                <text
                  className="chart-x-label"
                  textAnchor="end"
                  transform={`rotate(-38 ${x + barWidth / 2} ${height - 26})`}
                  x={x + barWidth / 2}
                  y={height - 26}
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
          <span>{formatInteger(hoveredItem.searches)} {translations[language].requests.toLowerCase()}</span>
        </div>
      ) : null}
    </div>
  );
}

function CategoryPieChart({
  data,
  language,
}: {
  data: CategorySearchPoint[];
  language: Language;
}) {
  const t = translations[language];
  const sortedData = [...data].sort((left, right) => right.searches - left.searches);
  const mainCategories = sortedData.slice(0, 6);
  const otherSearches = sortedData
    .slice(6)
    .reduce((sum, item) => sum + item.searches, 0);
  const chartData =
    otherSearches > 0
      ? [...mainCategories, { category: language === "tr" ? "Diğer" : "Other", searches: otherSearches }]
      : mainCategories;
  const total = chartData.reduce((sum, item) => sum + item.searches, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (!data.length || total <= 0) {
    return <p className="chart-empty">{t.noCategoryData}</p>;
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
              <title>{`${translateCategory(item.category, language)}: ${formatInteger(item.searches)} ${t.requests.toLowerCase()}`}</title>
            </circle>
          );
        })}
        <text className="pie-chart-total" x="60" y="57">
          {formatInteger(total)}
        </text>
        <text className="pie-chart-caption" x="60" y="72">
          {t.totalRequests}
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
              <strong title={translateCategory(item.category, language)}>
                {translateCategory(item.category, language)}
              </strong>
              <em>{percent}%</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrganizationList({
  data,
  language,
}: {
  data: TopOrganization[];
  language: Language;
}) {
  if (!data.length) {
    return <p className="summary-empty">{translations[language].noOrganizations}</p>;
  }

  return (
    <div className="organization-list">
      {data.map((organization) => (
        <div className="organization-row" key={`${organization.name}-${organization.category}`}>
          <div>
            <strong>{organization.name}</strong>
            <span>{translateCategory(organization.category, language)}</span>
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
  language,
  onExpandedChange,
  onPredictionWindowChange,
  predictionData,
  selection,
}: {
  filters: DemandFilters;
  heatmapPalette: HeatmapPalette;
  isExpanded: boolean;
  language: Language;
  onExpandedChange: (isExpanded: boolean) => void;
  onPredictionWindowChange: (window: PredictionWindow) => void;
  predictionData: RecursivePredictionPoint[];
  selection: CoordinateMatch | null;
}) {
  const t = translations[language];
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
        setError(loadError instanceof Error ? loadError.message : t.failedToLoad);
      });
  }, [filters, t.failedToLoad]);

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
        setError(loadError instanceof Error ? loadError.message : t.failedToLoad);
      });
  }, [filters, selection?.provinceNumber, t.failedToLoad]);

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
  const topCategory = categoryBreakdown[0];
  const peakHour = hourlyDistribution.reduce<HourlySearchPoint | null>(
    (bestHour, hour) => !bestHour || hour.searches > bestHour.searches ? hour : bestHour,
    null,
  );
  const timeChart = useMemo(
    () => aggregateTimeSeries(timeSeries, language, timeWindow, timeOffset),
    [language, timeOffset, timeSeries, timeWindow],
  );
  const recursivePredictionChart = useMemo(
    () =>
      aggregateRecursivePredictionSeries(
        predictionData,
        language,
        timeWindow,
        timeChart.predictionAnchorPoint,
      ),
    [language, predictionData, timeChart.predictionAnchorPoint, timeWindow],
  );
  const hasInsufficientProvinceData = Boolean(provinceDemand && !provinceDemand.summary);
  const title = provinceDemand?.name ?? t.turkeyOverview;
  const subtitle = provinceDemand
    ? `${t.province} ${provinceDemand.province_number}`
    : t.allMappedProvinces;

  useEffect(() => {
    if (!canShowDailyRequestChart && timeWindow === "day") {
      setTimeWindow("week");
      setTimeOffset(0);
    }
  }, [canShowDailyRequestChart, timeWindow]);

  useEffect(() => {
    setTimeOffset(0);
  }, [activeData?.updated_at, selection?.provinceNumber, timeWindow]);

  useEffect(() => {
    if (
      !selection?.provinceNumber ||
      !timeChart.predictionStartTimestamp ||
      timeChart.predictionHours <= 0
    ) {
      onPredictionWindowChange(null);
      return;
    }

    onPredictionWindowChange({
      hours: timeChart.predictionHours,
      startTimestamp: timeChart.predictionStartTimestamp,
    });
  }, [
    onPredictionWindowChange,
    selection?.provinceNumber,
    timeChart.predictionAnchorPoint,
    timeChart.predictionHours,
    timeChart.predictionStartTimestamp,
  ]);

  return (
    <section
      className="summary-panel"
      aria-label={t.analytics}
      data-palette={heatmapPalette}
    >
      <div className="summary-header">
        <span>{t.analytics}</span>
        <div className="summary-actions">
          <span>{selection?.regionName ? t.province : t.overview}</span>
          <button type="button" onClick={() => onExpandedChange(!isExpanded)}>
            {isExpanded ? t.collapse : t.expand}
          </button>
        </div>
      </div>

      {summary ? (
        <div className={isExpanded ? "summary-content expanded" : "summary-content"}>
          <div className="summary-primary">
            <div>
              <strong>{selection?.regionName ?? title}</strong>
              <span>
                {selection?.provinceNumber
                  ? subtitle
                  : t.selectProvinceHint}
              </span>
            </div>
          </div>

          <dl className="summary-grid">
            <MetricTile label={t.requests} value={formatInteger(summary.searches)} />
            <MetricTile label={t.avgRating} value={summary.avg_rating.toFixed(2)} />
            <MetricTile
              label={t.topCategory}
              value={topCategory ? formatAxisLabel(translateCategory(topCategory.category, language), 18) : "N/A"}
            />
            <MetricTile
              label={t.peakHour}
              value={peakHour ? `${peakHour.hour}:00` : "N/A"}
            />
          </dl>

          <div className="chart-block line-chart-block">
            <div className="chart-header">
              <h3>{t.searchRequests}</h3>
              <span>{timeChart.rangeLabel}</span>
            </div>
            <div className="chart-controls">
              <div className="time-window-picker">
                <span>{t.window}</span>
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
                      {t[option.labelKey]}
                    </button>
                  ))}
                </div>
              </div>
              {!canShowDailyRequestChart ? (
                <p className="chart-note">
                  {t.dayViewHidden}
                </p>
              ) : null}
              {timeWindow !== "all" ? (
                <TimeWindowSlider
                  max={timeChart.maxOffset}
                  language={language}
                  value={Math.min(timeOffset, timeChart.maxOffset)}
                  windowKey={timeWindow}
                  onChange={setTimeOffset}
                />
              ) : null}
            </div>
            <MiniLineChart
              data={timeChart.points}
              isExpanded={isExpanded}
              language={language}
              predictionData={provinceDemand ? recursivePredictionChart : []}
            />
          </div>

          {isExpanded ? (
            <div className="expanded-chart-grid">
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{t.categoryDistribution}</h3>
                </div>
                <CategoryPieChart data={categoryBreakdown} language={language} />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>{t.hourlyDistribution}</h3>
                </div>
                <NumericBarPlot
                  data={hourlyDistribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : translateCategory(item.category, language)}
                  language={language}
                />
              </div>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{provinceDemand ? t.categories : t.topProvinces}</h3>
                </div>
                {provinceDemand ? (
                  <BarList
                    data={provinceDemand.category_breakdown}
                    getLabel={(item) =>
                      "category" in item ? translateCategory(item.category, language) : String(item.hour)
                    }
                    language={language}
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
                    language={language}
                  />
                ) : null}
              </div>
            </div>
          ) : provinceDemand ? (
            <>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{t.categoryDistribution}</h3>
                </div>
                <CategoryPieChart
                  data={provinceDemand.category_breakdown}
                  language={language}
                />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>{t.hours}</h3>
                </div>
                <NumericBarPlot
                  data={provinceDemand.hourly_distribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : translateCategory(item.category, language)}
                  language={language}
                />
              </div>
              <div className="chart-block top-organizations-block">
                <div className="chart-header">
                  <h3>{t.top5Organizations}</h3>
                  <span>{t.rating}</span>
                </div>
                <OrganizationList data={topOrganizations} language={language} />
              </div>
            </>
          ) : overview ? (
            <>
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{t.categoryDistribution}</h3>
                </div>
                <CategoryPieChart data={overview.category_breakdown} language={language} />
              </div>
              <div className="chart-block full-width-bar-chart">
                <div className="chart-header">
                  <h3>{t.hours}</h3>
                </div>
                <NumericBarPlot
                  data={overview.hourly_distribution}
                  getLabel={(item) => "hour" in item ? `${item.hour}:00` : translateCategory(item.category, language)}
                  language={language}
                />
              </div>
              <div className="chart-block">
                <div className="chart-header">
                  <h3>{t.topProvinces}</h3>
                </div>
                <BarList
                  data={overview.top_provinces.map((province) => ({
                    category: province.name,
                    searches: province.summary.searches,
                  }))}
                  getLabel={(item) => "category" in item ? item.category : String(item.hour)}
                  language={language}
                />
              </div>
              <div className="chart-block top-organizations-block">
                <div className="chart-header">
                  <h3>{t.top5Organizations}</h3>
                  <span>{t.rating}</span>
                </div>
                <OrganizationList data={topOrganizations} language={language} />
              </div>
            </>
          ) : null}

          {selection &&
          selection.latitude !== null &&
          selection.longitude !== null ? (
            <dl className="coordinate-grid">
              <MetricTile label={t.latitude} value={selection.latitude.toFixed(6)} />
              <MetricTile label={t.longitude} value={selection.longitude.toFixed(6)} />
            </dl>
          ) : null}
        </div>
      ) : (
        <div className="summary-empty">
          {hasInsufficientProvinceData
            ? t.notEnoughData
            : error ?? t.loadingAnalytics}
        </div>
      )}
    </section>
  );
}
