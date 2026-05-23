import { useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  fetchDemandOverview,
  fetchProvinceDemand,
  fetchRadiusSummary,
  fetchTurkeyGeoJson,
  predictDemandRecursive,
} from "../api/client";
import { translations, translateCategory } from "../i18n";
import type { DemandFilters } from "../types/filters";
import type { Language } from "../i18n";
import type { HeatmapPalette } from "../types/palette";
import { maxPredictionHours, canPredictProvince } from "../types/prediction";
import type { RecursivePredictionPoint } from "../types/ml";
import type {
  CategorySearchPoint,
  DemandOverviewResponse,
  HourlySearchPoint,
  ProvinceDemandResponse,
  RadiusSummaryResponse,
  TimeSearchPoint,
  TopOrganization,
  TurkeyProvinceProperties,
} from "../types/region";
import type { CoordinateMatch } from "../types/selection";

type TurkeyGeoJson = FeatureCollection<Geometry, TurkeyProvinceProperties>;

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
type LineChartSeries = {
  color: string;
  data: ChartPoint[];
  key: string;
  label: string;
  predictionData: PredictionChartPoint[];
};

const pieSegmentColors = [
  "#0284c7",
  "#db2777",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#be123c",
];
const lineSeriesColors = [
  "#0284c7",
  "#db2777",
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

function pointInRing(
  longitude: number,
  latitude: number,
  ring: number[][],
) {
  let isInside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    const intersects =
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function pointInPolygon(
  longitude: number,
  latitude: number,
  coordinates: number[][][],
) {
  const [outerRing, ...holes] = coordinates;

  if (!pointInRing(longitude, latitude, outerRing)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(longitude, latitude, hole));
}

function featureContainsPoint(
  feature: Feature<Geometry, TurkeyProvinceProperties>,
  longitude: number,
  latitude: number,
) {
  if (feature.geometry.type === "Polygon") {
    return pointInPolygon(longitude, latitude, feature.geometry.coordinates);
  }

  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.some((polygon) =>
      pointInPolygon(longitude, latitude, polygon),
    );
  }

  return false;
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

function MiniLineChart({
  isExpanded,
  language,
  series,
}: {
  isExpanded: boolean;
  language: Language;
  series: LineChartSeries[];
}) {
  const t = translations[language];
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const chart = useMemo(() => {
    const actualPoints = series.flatMap((item) => item.data);
    const predictionPoints = series.flatMap((item) => item.predictionData);
    const max = Math.max(
      ...actualPoints.map((item) => item.searches),
      ...predictionPoints.map((item) => item.prediction),
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
      ...actualPoints.map((item) => item.time),
      ...predictionPoints.map((item) => item.time),
    ];
    const minTime = allTimes.length ? Math.min(...allTimes) : 0;
    const maxTime = allTimes.length ? Math.max(...allTimes) : 0;
    const timeRange = Math.max(maxTime - minTime, 1);
    const xForTime = (time: number) =>
      padding.left +
      (allTimes.length === 1 ? plotWidth / 2 : ((time - minTime) / timeRange) * plotWidth);
    const chartSeries = series.map((item) => {
      const coordinates = item.data.map((point) => {
        const x = xForTime(point.time);
        const y = padding.top + plotHeight - (point.searches / safeMax) * plotHeight;

        return {
          ...point,
          x,
          y,
        };
      });
      const predictionCoordinates = item.predictionData.map((point) => {
        const x = xForTime(point.time);
        const y = padding.top + plotHeight - (point.prediction / safeMax) * plotHeight;

        return {
          ...point,
          x,
          y,
        };
      });

      return {
        ...item,
        coordinates,
        points: coordinates.map((point) => `${point.x},${point.y}`).join(" "),
        testPoints: coordinates
          .slice(Math.max(0, Math.floor(coordinates.length * 0.8) - 1))
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
        trainPoints: coordinates
          .slice(0, Math.max(1, Math.floor(coordinates.length * 0.8)))
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
        predictionCoordinates,
        predictionPoints: predictionCoordinates.map((point) => `${point.x},${point.y}`).join(" "),
      };
    });
    const coordinates = chartSeries.flatMap((item) => item.coordinates);
    const predictionCoordinates = chartSeries.flatMap((item) => item.predictionCoordinates);

    const hoverCoordinates = (() => {
      const timeMap = new Map<number, { x: number; label: string }>();

      chartSeries.forEach((item) => {
        item.coordinates.forEach((point) => {
          if (!timeMap.has(point.time)) {
            timeMap.set(point.time, { x: point.x, label: point.label });
          }
        });
        item.predictionCoordinates.forEach((point) => {
          if (!timeMap.has(point.time)) {
            timeMap.set(point.time, { x: point.x, label: point.label });
          }
        });
      });

      const isSingleSeries = chartSeries.length === 1;

      const points = Array.from(timeMap.entries()).map(([time, info]) => {
        const seriesData: {
          label: string;
          color: string;
          predictionColor: string;
          searches?: number;
          searchesY?: number;
          prediction?: number;
          predictionY?: number;
        }[] = [];

        chartSeries.forEach((item) => {
          const pt = item.coordinates.find((p) => p.time === time);
          const predPt = item.predictionCoordinates.find((p) => p.time === time);

          if (pt || predPt) {
            seriesData.push({
              label: item.label,
              color: item.color,
              predictionColor: isSingleSeries ? "#f97316" : item.color,
              searches: pt?.searches,
              searchesY: pt?.y,
              prediction: predPt?.prediction,
              predictionY: predPt?.y,
            });
          }
        });

        const yCoords = seriesData
          .flatMap((sd) => [sd.searchesY, sd.predictionY])
          .filter((y): y is number => y !== undefined);
        const y = yCoords.length > 0 ? yCoords[0] : 0;

        return {
          time,
          x: info.x,
          y,
          label: info.label,
          seriesData,
        };
      });

      return points.sort((left, right) => left.time - right.time);
    })();
    const total = actualPoints.reduce((sum, item) => sum + item.searches, 0);
    return {
      chartSeries,
      coordinates,
      height,
      hoverCoordinates,
      max,
      padding,
      plotHeight,
      plotWidth,
      predictionCoordinates,
      total,
      width,
    };
  }, [isExpanded, series]);

  if (!series.some((item) => item.data.length)) {
    return <p className="chart-empty">{t.noRequests}</p>;
  }

  const firstLabel = chart.coordinates[0]?.label ?? "";
  const lastLabel = chart.coordinates.at(-1)?.label ?? "";
  const yTicks = getYAxisTicks(chart.max);
  const hoveredPoint = hoveredIndex === null ? null : chart.hoverCoordinates[hoveredIndex];
  const hasPredictionLine = chart.predictionCoordinates.length > 0;

  function getNearestPoint(clientX: number, target: SVGSVGElement) {
    const bounds = target.getBoundingClientRect();
    const viewBoxX = ((clientX - bounds.left) / bounds.width) * chart.width;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    chart.hoverCoordinates.forEach((point, index) => {
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
    const nextPoint = chart.hoverCoordinates[nextIndex];

    if (!nextPoint) {
      return;
    }

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

        {chart.chartSeries.map((item) => (
              <polyline
                className="actual-line"
                key={`${item.key}-actual`}
                points={item.points}
                style={{ stroke: item.color }}
              />
            ))}
        {chart.chartSeries.map((item) => {
          const isSingleSeries = chart.chartSeries.length === 1;
          const predictionColor = isSingleSeries ? "#f97316" : item.color;
          return item.predictionPoints ? (
            <polyline
              className="prediction-line"
              key={`${item.key}-prediction`}
              points={item.predictionPoints}
              style={{ stroke: predictionColor }}
            >
              <title>{`${item.label}: ${t.predictedRequests}`}</title>
            </polyline>
          ) : null;
        })}
        {chart.chartSeries.flatMap((seriesItem) => {
          const isSingleSeries = chart.chartSeries.length === 1;
          const predictionColor = isSingleSeries ? "#f97316" : seriesItem.color;
          return seriesItem.predictionCoordinates.map((item, index) => (
            <circle
              className="prediction-chart-point"
              cx={item.x}
              cy={item.y}
              key={`${seriesItem.key}-${item.key}-${index}`}
              r={seriesItem.predictionCoordinates.length > 24 && index % 2 !== 0 ? 1.8 : 2.8}
              style={{ stroke: predictionColor }}
            >
              <title>{`${seriesItem.label}: ${item.label}: ${formatInteger(item.prediction)} ${t.predictedRequests.toLowerCase()}`}</title>
            </circle>
          ));
        })}
        {chart.chartSeries.flatMap((seriesItem) =>
          seriesItem.coordinates.map((item, index) => (
            <circle
              className="chart-point"
              cx={item.x}
              cy={item.y}
              key={`${seriesItem.key}-${item.label}-${index}`}
              r={seriesItem.coordinates.length > 24 && index % 2 !== 0 ? 2 : 3}
              style={{ stroke: seriesItem.color }}
            >
              <title>{`${seriesItem.label}: ${item.label}: ${formatInteger(item.searches)}`}</title>
            </circle>
          )),
        )}
        {hoveredPoint ? (
          <>
            <line
              className="chart-hover-line"
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={chart.padding.top}
              y2={chart.padding.top + chart.plotHeight}
            />
            {hoveredPoint.seriesData.map((sd, idx) => (
              <g key={idx}>
                {sd.searchesY !== undefined && (
                  <circle
                    className="chart-hover-point"
                    cx={hoveredPoint.x}
                    cy={sd.searchesY}
                    r={5}
                    style={{ fill: "var(--card-background)", stroke: sd.color, strokeWidth: 2.5 }}
                  />
                )}
                {sd.predictionY !== undefined && (
                  <circle
                    className="chart-hover-point"
                    cx={hoveredPoint.x}
                    cy={sd.predictionY}
                    r={5}
                    style={{ fill: "var(--card-background)", stroke: sd.predictionColor, strokeWidth: 2.5 }}
                  />
                )}
              </g>
            ))}
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
      <div className="line-chart-legend">
        {chart.chartSeries.map((item) => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        {hasPredictionLine ? (
          <span>
            <i
              style={{
                background: chart.chartSeries.length === 1 ? "#f97316" : "transparent",
                border: chart.chartSeries.length === 1 ? "none" : "1.5px dashed var(--muted-text)",
                height: chart.chartSeries.length === 1 ? "2px" : "0px",
                width: "20px",
                display: "block"
              }}
            />
            {t.predictedRequests}
          </span>
        ) : null}
      </div>
      {hoveredPoint && tooltipPosition ? (
        <div
          className="line-chart-tooltip"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            minWidth: "180px",
          }}
        >
          <strong style={{ borderBottom: "1px solid var(--border)", paddingBottom: "4px", marginBottom: "4px" }}>
            {hoveredPoint.label}
          </strong>
          {hoveredPoint.seriesData.map((sd, index) => (
            <div key={index} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {chart.chartSeries.length > 1 && (
                <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text)" }}>
                  {sd.label}
                </span>
              )}
              {sd.searches !== undefined && (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <i style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: sd.color
                  }} />
                  <span>
                    {formatInteger(sd.searches)} {t.requests.toLowerCase()}
                  </span>
                </span>
              )}
              {sd.prediction !== undefined && (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <i style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: sd.predictionColor
                  }} />
                  <strong style={{ color: sd.predictionColor, fontWeight: "normal" }}>
                    {formatInteger(sd.prediction)} {t.predictedRequests.toLowerCase()}
                  </strong>
                </span>
              )}
            </div>
          ))}
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
  const handleWidthPercent = clamp((durationHours / (24 * 30)) * 100, 10, 42);
  const isDaily = windowKey === "week" || windowKey === "month";
  const step = isDaily ? 24 : 1;
  const sliderMax = isDaily ? Math.floor(max / 24) * 24 : max;
  const safeValue = clamp(isDaily ? Math.round(value / 24) * 24 : value, 0, sliderMax);
  const leftPercent = sliderMax > 0 ? (safeValue / sliderMax) * (100 - handleWidthPercent) : 0;

  return (
    <div className="time-window-control">
      <label className="time-window-track">
        <div
          className="time-window-line"
          style={{
            background: "linear-gradient(to right, #db2777 0%, #db2777 80%, #16a34a 80%, #16a34a 100%)"
          }}
        />
        <div
          className="time-window-segment"
          style={{
            left: `${leftPercent}%`,
            width: `${handleWidthPercent}%`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2.5px"
          }}
        >
          <div className="w-[1.5px] h-3 bg-white/70 rounded-full" />
          <div className="w-[1.5px] h-3 bg-white/70 rounded-full" />
          <div className="w-[1.5px] h-3 bg-white/70 rounded-full" />
        </div>
        <input
          aria-label={t.window}
          max={sliderMax}
          min={0}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          step={step}
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
  overrideRange?: {
    selectedStart: number;
    actualEndLimit: number;
    selectedRangeEnd: number;
    isTimelineAtEnd: boolean;
  },
) {
  if (!data.length && !overrideRange) {
    return {
      maxOffset: 0,
      points: [] as ChartPoint[],
      predictionAnchorPoint: null as ChartPoint | null,
      predictionStartTimestamp: null as string | null,
      predictionHours: 0,
      rangeLabel: "",
      selectedStartTime: 0,
      selectedStartTimestamp: null as string | null,
      selectedEndTimestamp: null as string | null,
      actualEndLimit: 0,
      selectedRangeEnd: 0,
      isTimelineAtEnd: false,
    };
  }

  const windowOption =
    timeWindowOptions.find((option) => option.key === windowKey) ?? timeWindowOptions[1];
  const hourMs = 60 * 60 * 1000;

  let selectedStart: number;
  let actualEndLimit: number;
  let selectedRangeEnd: number;
  let isTimelineAtEnd: boolean;
  let maxOffset = 0;
  let durationMs: number;

  if (overrideRange) {
    selectedStart = overrideRange.selectedStart;
    actualEndLimit = overrideRange.actualEndLimit;
    selectedRangeEnd = overrideRange.selectedRangeEnd;
    isTimelineAtEnd = overrideRange.isTimelineAtEnd;
    durationMs = actualEndLimit - selectedStart;
  } else {
    const sorted = [...data].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    const startDate = new Date(sorted[0].timestamp);
    startDate.setHours(0, 0, 0, 0);
    const startTime = startDate.getTime();
    const endDate = new Date(sorted.at(-1)?.timestamp ?? sorted[0].timestamp);
    endDate.setHours(23, 59, 59, 999);
    const endTime = endDate.getTime();
    durationMs =
      windowOption.durationHours === null
        ? Math.max(endTime - startTime + hourMs, hourMs)
        : windowOption.durationHours * hourMs;
    maxOffset = Math.max(0, Math.ceil((endTime - startTime - durationMs) / hourMs));
    let safeOffset = Math.min(offset, maxOffset);
    let maxValidOffset = maxOffset;
    if (windowKey === "week" || windowKey === "month") {
      maxValidOffset = Math.floor(maxOffset / 24) * 24;
      safeOffset = Math.round(safeOffset / 24) * 24;
      safeOffset = clamp(safeOffset, 0, maxValidOffset);
    }
    selectedStart = startTime + safeOffset * hourMs;
    const selectedEnd = selectedStart + durationMs;
    selectedRangeEnd = Math.max(selectedStart, Math.min(selectedEnd - hourMs, endTime));
    isTimelineAtEnd = windowKey === "all" || safeOffset >= maxValidOffset;
    actualEndLimit = selectedEnd;
  }

  const predictionHours = Math.min(
    maxPredictionHours,
    Math.max(1, Math.floor(durationMs / hourMs)),
  );

  const selected = data.filter((item) => {
    const timestamp = new Date(item.timestamp).getTime();
    return timestamp >= selectedStart && timestamp < actualEndLimit;
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

  // Pre-populate bucket with all time slots in the selected range to ensure zero gaps
  const stepMs = windowKey === "day" ? hourMs : 24 * hourMs;
  for (let currentMs = selectedStart; currentMs < actualEndLimit; currentMs += stepMs) {
    const key = bucketKeyForTimestamp(new Date(currentMs), windowKey);
    bucket.set(key, 0);
  }

  selected.forEach((item) => {
    const timestamp = new Date(item.timestamp);
    const key = bucketKeyForTimestamp(timestamp, windowKey);

    bucket.set(key, (bucket.get(key) ?? 0) + item.searches);
  });

  const points = Array.from(bucket.entries())
    .map(([key, searches]) => ({
      key,
      label: labelFormatter.format(dateFromBucketKey(key, windowKey)),
      searches,
      time: dateFromBucketKey(key, windowKey).getTime(),
    }))
    .sort((left, right) => left.time - right.time);

  const anchorTime = isTimelineAtEnd ? selectedRangeEnd : selectedStart;
  const anchorKey = bucketKeyForTimestamp(new Date(anchorTime), windowKey);
  const anchorPoint = points.find((point) => point.key === anchorKey) ?? points.at(-1) ?? null;

  const predictionStartTime = selectedRangeEnd + hourMs;

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
    selectedStartTime: selectedStart,
    selectedStartTimestamp: formatLocalHourTimestamp(selectedStart),
    selectedEndTimestamp: formatLocalHourTimestamp(selectedRangeEnd),
    actualEndLimit,
    selectedRangeEnd,
    isTimelineAtEnd,
  };
}

function timeOffsetForStart(
  data: TimeSearchPoint[],
  windowKey: TimeWindowKey,
  selectedStartTime: number,
) {
  if (!data.length) {
    return 0;
  }

  const sorted = [...data].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const windowOption =
    timeWindowOptions.find((option) => option.key === windowKey) ?? timeWindowOptions[0];
  const startDate = new Date(sorted[0].timestamp);
  startDate.setHours(0, 0, 0, 0);
  const startTime = startDate.getTime();
  const endDate = new Date(sorted.at(-1)?.timestamp ?? sorted[0].timestamp);
  endDate.setHours(23, 59, 59, 999);
  const endTime = endDate.getTime();
  const hourMs = 60 * 60 * 1000;
  const durationMs =
    windowOption.durationHours === null
      ? Math.max(endTime - startTime + hourMs, hourMs)
      : windowOption.durationHours * hourMs;
  const maxOffset = Math.max(0, Math.ceil((endTime - startTime - durationMs) / hourMs));

  const rawOffset = Math.round((selectedStartTime - startTime) / hourMs);
  let offset = rawOffset;
  let maxValidOffset = maxOffset;
  if (windowKey === "week" || windowKey === "month") {
    maxValidOffset = Math.floor(maxOffset / 24) * 24;
    offset = Math.round(rawOffset / 24) * 24;
  }
  return clamp(offset, 0, maxValidOffset);
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
    prediction: Math.round(prediction),
    time: dateFromBucketKey(key, windowKey).getTime(),
  }));

  if (!anchorPoint || !data.length) {
    return points.sort((left, right) => left.time - right.time);
  }

  return [
    {
      key: anchorPoint.key,
      label: anchorPoint.label,
      prediction: anchorPoint.searches,
      time: anchorPoint.time,
    },
    ...points.filter((point) => point.key !== anchorPoint.key),
  ].sort((left, right) => left.time - right.time);
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

function getSummary(data: DemandOverviewResponse | ProvinceDemandResponse | null) {
  return data?.summary ?? null;
}

export function SelectionSummary({
  filters,
  heatmapPalette,
  isMapPickEnabled,
  isExpanded,
  language,
  onExpandedChange,
  onMapPickEnabledChange,
  onRadiusKmChange,
  onSelectionChange,
  predictionData,
  onPredictionsChange,
  isPredictionLoading,
  onPredictionLoadingChange,
  radiusKm,
  resetVersion,
  selection,
}: {
  filters: DemandFilters;
  heatmapPalette: HeatmapPalette;
  isMapPickEnabled: boolean;
  isExpanded: boolean;
  language: Language;
  onExpandedChange: (isExpanded: boolean) => void;
  onMapPickEnabledChange: (isEnabled: boolean) => void;
  onRadiusKmChange: (radiusKm: number) => void;
  onSelectionChange: (selection: CoordinateMatch | null) => void;
  predictionData: RecursivePredictionPoint[];
  onPredictionsChange: (points: RecursivePredictionPoint[]) => void;
  isPredictionLoading: boolean;
  onPredictionLoadingChange: (isLoading: boolean) => void;
  radiusKm: number;
  resetVersion: number;
  selection: CoordinateMatch | null;
}) {
  const t = translations[language];
  const [overview, setOverview] = useState<DemandOverviewResponse | null>(null);
  const [provinceDemand, setProvinceDemand] =
    useState<ProvinceDemandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindowKey>("day");
  const [timeOffset, setTimeOffset] = useState(999999);
  const [geoJson, setGeoJson] = useState<TurkeyGeoJson | null>(null);
  const [latitudeInput, setLatitudeInput] = useState("39");
  const [longitudeInput, setLongitudeInput] = useState("35");
  const [radiusInput, setRadiusInput] = useState(String(radiusKm));
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [radiusSummary, setRadiusSummary] = useState<RadiusSummaryResponse | null>(null);
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [isRadiusLoading, setIsRadiusLoading] = useState(false);
  const [selectedChartCategories, setSelectedChartCategories] = useState<string[]>(["all"]);
  const [lineChartDataByCategory, setLineChartDataByCategory] =
    useState<Record<string, DemandOverviewResponse | ProvinceDemandResponse>>({});
  const [isRadiusInputFocused, setIsRadiusInputFocused] = useState(false);
  const [selectedPeriodBreakdown, setSelectedPeriodBreakdown] = useState<CategorySearchPoint[]>([]);
  const [isSelectedPeriodLoading, setIsSelectedPeriodLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  const activeData = provinceDemand ?? overview;
  const summary = getSummary(activeData);
  const categoryBreakdown = activeData?.category_breakdown ?? [];
  const chartCategories = useMemo(
    () => selectedChartCategories.length ? selectedChartCategories : ["all"],
    [selectedChartCategories],
  );
  const chartDataItems = useMemo(
    () => chartCategories.map((category) => ({
      category,
      data: category === "all" ? activeData : lineChartDataByCategory[category] ?? null,
    })),
    [activeData, chartCategories, lineChartDataByCategory],
  );
  const overallTimeSeries = useMemo(
    () => activeData?.time_series ?? [],
    [activeData?.time_series],
  );
  const hourlyDistribution = activeData?.hourly_distribution ?? [];
  const topOrganizations = (activeData?.top_organizations ?? []).slice(0, 5);
  const availableTimeWindowOptions = timeWindowOptions;
  const topCategory = categoryBreakdown[0];
  const peakHour = hourlyDistribution.reduce<HourlySearchPoint | null>(
    (bestHour, hour) => !bestHour || hour.searches > bestHour.searches ? hour : bestHour,
    null,
  );
  const timeChart = useMemo(
    () => aggregateTimeSeries(overallTimeSeries, language, timeWindow, timeOffset),
    [language, timeOffset, overallTimeSeries, timeWindow],
  );
  const hasInsufficientProvinceData = Boolean(provinceDemand && !provinceDemand.summary);
  const title = provinceDemand?.name ?? t.turkeyOverview;
  const subtitle = provinceDemand
    ? `${t.province} ${provinceDemand.province_number}`
    : t.allMappedProvinces;
  const selectionLatitude = selection?.latitude ?? null;
  const selectionLongitude = selection?.longitude ?? null;

  const isProvinceAllowed = canPredictProvince(selection?.provinceNumber);
  const canPredict = Boolean(
    selection?.provinceNumber &&
    timeWindow !== "all" &&
    isProvinceAllowed &&
    timeChart.points.length > 0
  );

  async function handlePredict() {
    if (!selection?.provinceNumber || timeWindow === "all" || !canPredict) {
      return;
    }

    const provinceNumber = selection.provinceNumber;

    setPredictError(null);
    onPredictionsChange([]);
    onPredictionLoadingChange(true);

    try {
      const isTimelineAtEnd = timeChart.isTimelineAtEnd;
      const hourMs = 60 * 60 * 1000;
      const durationMs =
        timeWindow === "day"
          ? 24 * hourMs
          : timeWindow === "week"
            ? 168 * hourMs
            : timeWindow === "month"
              ? 720 * hourMs
              : 0;
      const durationHours = Math.round(durationMs / hourMs);

      let startTimestamp = "";
      let hours = 0;

      if (isTimelineAtEnd) {
        startTimestamp = timeChart.predictionStartTimestamp ?? "";
        hours = durationHours;
      } else {
        const predictionStartTime = timeChart.selectedStartTime + hourMs;
        startTimestamp = formatLocalHourTimestamp(predictionStartTime);
        hours = durationHours - 1;
      }

      if (!startTimestamp) {
        throw new Error("Invalid start timestamp");
      }

      const categories = chartCategories.map((c) => c === "all" ? null : c);
      
      const responses = await Promise.all(
        categories.map(async (category) => {
          const response = await predictDemandRecursive({
            category,
            hours,
            province_number: provinceNumber,
            start_timestamp: startTimestamp,
          });

          return response.points.map((point) => ({
            ...point,
            prediction: Math.round(point.prediction),
            category,
          }));
        }),
      );

      onPredictionsChange(responses.flat());
    } catch (requestError) {
      setPredictError(requestError instanceof Error ? requestError.message : t.predictionFailed);
    } finally {
      onPredictionLoadingChange(false);
    }
  }

  useEffect(() => {
    onPredictionsChange([]);
    setPredictError(null);
  }, [
    selection?.provinceNumber,
    timeWindow,
    timeOffset,
    selectedChartCategories,
    resetVersion,
    onPredictionsChange,
  ]);

  useEffect(() => {
    void fetchTurkeyGeoJson()
      .then((nextGeoJson) => {
        setGeoJson(nextGeoJson);
      })
      .catch((loadError) => {
        setCoordinateError(loadError instanceof Error ? loadError.message : t.failedToLoadMap);
      });
  }, [t.failedToLoadMap]);

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

    let isActive = true;

    void fetchProvinceDemand(selection.provinceNumber, filters)
      .then((nextProvinceDemand) => {
        if (isActive) {
          setProvinceDemand(nextProvinceDemand);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setProvinceDemand(null);
          setError(loadError instanceof Error ? loadError.message : t.failedToLoad);
        }
      });

    return () => {
      isActive = false;
    };
  }, [filters, selection?.provinceNumber, t.failedToLoad]);

  useEffect(() => {
    if (timeWindow === "all" || !timeChart.selectedStartTimestamp || !timeChart.selectedEndTimestamp) {
      setSelectedPeriodBreakdown([]);
      setIsSelectedPeriodLoading(false);
      return undefined;
    }

    setIsSelectedPeriodLoading(true);

    const handler = setTimeout(() => {
      let isActive = true;
      const subPeriodFilters: DemandFilters = {
        ...filters,
        startTime: timeChart.selectedStartTimestamp!,
        endTime: timeChart.selectedEndTimestamp!,
      };

      const request = selection?.provinceNumber
        ? fetchProvinceDemand(selection.provinceNumber, subPeriodFilters)
        : fetchDemandOverview(subPeriodFilters);

      request
        .then((response) => {
          if (isActive) {
            setSelectedPeriodBreakdown(response.category_breakdown ?? []);
            setIsSelectedPeriodLoading(false);
          }
        })
        .catch(() => {
          if (isActive) {
            setSelectedPeriodBreakdown([]);
            setIsSelectedPeriodLoading(false);
          }
        });

      return () => {
        isActive = false;
      };
    }, 250);

    return () => {
      clearTimeout(handler);
    };
  }, [
    filters,
    selection?.provinceNumber,
    timeWindow,
    timeChart.selectedStartTimestamp,
    timeChart.selectedEndTimestamp,
  ]);



  useEffect(() => {
    const categoryRequests = selectedChartCategories.filter((category) => category !== "all");

    if (!categoryRequests.length) {
      setLineChartDataByCategory({});
      return undefined;
    }

    let isActive = true;

    void Promise.all(
      categoryRequests.map(async (category) => {
        const nextFilters = {
          ...filters,
          categories: [category],
        };
        const data = selection?.provinceNumber
          ? await fetchProvinceDemand(selection.provinceNumber, nextFilters)
          : await fetchDemandOverview(nextFilters);

        return [category, data] as const;
      }),
    )
      .then((entries) => {
        if (isActive) {
          setLineChartDataByCategory(Object.fromEntries(entries));
          setError(null);
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setLineChartDataByCategory({});
          setError(loadError instanceof Error ? loadError.message : t.failedToLoad);
        }
      });

    return () => {
      isActive = false;
    };
  }, [filters, selectedChartCategories, selection?.provinceNumber, t.failedToLoad]);

  // Keep slider at current position when switching categories



  useEffect(() => {
    if (selectionLatitude !== null && selectionLongitude !== null) {
      setLatitudeInput(selectionLatitude.toFixed(6));
      setLongitudeInput(selectionLongitude.toFixed(6));
    }
  }, [selectionLatitude, selectionLongitude]);

  useEffect(() => {
    if (isRadiusInputFocused) {
      return;
    }

    const nextRadiusInput = String(radiusKm);

    setRadiusInput((currentRadiusInput) =>
      Number(currentRadiusInput.replace(",", ".")) === radiusKm
        ? currentRadiusInput
      : nextRadiusInput,
    );
  }, [isRadiusInputFocused, radiusKm]);

  useEffect(() => {
    setIsRadiusInputFocused(false);
    setRadiusInput(String(radiusKm));
    setRadiusError(null);
  }, [radiusKm, resetVersion]);

  function commitRadiusInput() {
    const nextRadiusKm = Number(radiusInput.replace(",", "."));

    if (!Number.isFinite(nextRadiusKm) || nextRadiusKm <= 0) {
      setRadiusError(radiusInput.trim() ? t.enterValidRadius : null);
      return false;
    }

    setRadiusError(null);

    if (nextRadiusKm !== radiusKm) {
      onRadiusKmChange(nextRadiusKm);
    }

    return true;
  }

  useEffect(() => {
    if (selectionLatitude === null || selectionLongitude === null) {
      setRadiusSummary(null);
      setRadiusError(null);
      setIsRadiusLoading(false);
      return undefined;
    }

    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      setRadiusSummary(null);
      setRadiusError(t.enterValidRadius);
      setIsRadiusLoading(false);
      return undefined;
    }

    let isActive = true;
    setRadiusError(null);
    setIsRadiusLoading(true);

    void fetchRadiusSummary(filters, selectionLatitude, selectionLongitude, radiusKm)
      .then((summary) => {
        if (isActive) {
          setRadiusSummary(summary);
        }
      })
      .catch((summaryError: unknown) => {
        if (isActive) {
          setRadiusSummary(null);
          setRadiusError(
            summaryError instanceof Error ? summaryError.message : t.radiusSummaryFailed,
          );
        }
      })
      .finally(() => {
        if (isActive) {
          setIsRadiusLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    filters,
    radiusKm,
    selectionLatitude,
    selectionLongitude,
    t.enterValidRadius,
    t.radiusSummaryFailed,
  ]);

  function findLocationByCoordinates() {
    const latitude = Number(latitudeInput.replace(",", "."));
    const longitude = Number(longitudeInput.replace(",", "."));
    const nextRadiusKm = Number(radiusInput.replace(",", "."));

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setCoordinateError(t.enterValidCoordinates);
      setRadiusSummary(null);
      onSelectionChange(null);
      return;
    }

    if (!Number.isFinite(nextRadiusKm) || nextRadiusKm <= 0) {
      setCoordinateError(t.enterValidRadius);
      setRadiusSummary(null);
      return;
    }

    const matchingFeature = geoJson?.features.find((feature) =>
      featureContainsPoint(feature, longitude, latitude),
    );

    if (!matchingFeature) {
      setCoordinateError(t.coordinatesOutsideTurkey);
      setRadiusSummary(null);
      onSelectionChange(null);
      return;
    }

    setCoordinateError(null);
    commitRadiusInput();
    onSelectionChange({
      latitude,
      longitude,
      regionName: matchingFeature.properties.name,
      provinceNumber: matchingFeature.properties.number,
    });
  }

  function updateTimeWindow(nextWindow: TimeWindowKey) {
    setTimeWindow(nextWindow);
    setTimeOffset(timeOffsetForStart(overallTimeSeries, nextWindow, timeChart.selectedStartTime));
  }

  function toggleChartCategory(category: string, isChecked: boolean) {
    setSelectedChartCategories((currentCategories) => {
      if (category === "all") {
        if (isChecked) {
          return ["all"];
        }

        const nextCategories = currentCategories.filter((item) => item !== "all");

        return nextCategories.length ? nextCategories : ["all"];
      }

      const withoutAll = currentCategories.filter((item) => item !== "all");
      const nextCategories = isChecked
        ? [...withoutAll, category]
        : withoutAll.filter((item) => item !== category);

      return nextCategories.length ? nextCategories : ["all"];
    });
  }

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
          <div className="summary-primary flex flex-col gap-2">
            <div>
              <strong>{selection?.regionName ?? title}</strong>
              <span className="block mt-0.5 text-xs text-[var(--muted-text)]">
                {selection?.provinceNumber
                  ? subtitle
                  : t.selectProvinceHint}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--toggle-background)] text-[11px] text-[var(--text)] font-semibold">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                <span>{t.topCategory}: <strong>{topCategory ? translateCategory(topCategory.category, language) : "N/A"}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--toggle-background)] text-[11px] text-[var(--text)] font-semibold">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>{t.peakHour}: <strong>{peakHour ? `${peakHour.hour}:00` : "N/A"}</strong></span>
              </div>
            </div>
          </div>

          <form
            className="analytics-coordinate-search"
            onSubmit={(event) => {
              event.preventDefault();
              findLocationByCoordinates();
            }}
          >
            <label>
              <span>{t.lat}</span>
              <input
                inputMode="decimal"
                value={latitudeInput}
                onChange={(event) => setLatitudeInput(event.target.value)}
              />
            </label>
            <label>
              <span>{t.lon}</span>
              <input
                inputMode="decimal"
                value={longitudeInput}
                onChange={(event) => setLongitudeInput(event.target.value)}
              />
            </label>
            <label>
              <span>{t.radiusKm}</span>
              <input
                inputMode="decimal"
                type="text"
                value={radiusInput}
                onBlur={() => {
                  setIsRadiusInputFocused(false);
                  commitRadiusInput();
                }}
                onChange={(event) => {
                  setRadiusInput(event.target.value);
                  setRadiusSummary(null);
                }}
                onFocus={() => setIsRadiusInputFocused(true)}
              />
            </label>
            <button
              disabled={latitudeInput.trim() === "" || longitudeInput.trim() === ""}
              type="submit"
            >
              {t.find}
            </button>
            <label className="map-pick-toggle">
              <input
                checked={isMapPickEnabled}
                onChange={(event) => onMapPickEnabledChange(event.target.checked)}
                type="checkbox"
              />
              <span>{t.pickOnMap}</span>
              <em>{t.pickOnMapHelp}</em>
            </label>
            <p className="control-help">
              {coordinateError ??
                radiusError ??
                (isRadiusLoading
                  ? t.loadingRadiusSummary
                  : radiusSummary
                    ? `${radiusSummary.searches.toLocaleString()} ${t.requests.toLowerCase()} · ${radiusSummary.radius_km} km`
                    : t.coordinateSearchHelp)}
            </p>
          </form>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <div className="flex items-center justify-between p-3.5 rounded-lg border border-[var(--border)] bg-[var(--card-background)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--muted-text)]">{t.requests}</span>
                <strong className="block text-lg font-extrabold mt-0.5 text-[var(--text)]">{formatInteger(summary.searches)}</strong>
              </div>
              <div className="p-2.5 rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,var(--toggle-background))] text-[var(--accent)] flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
              </div>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-lg border border-[var(--border)] bg-[var(--card-background)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--muted-text)]">{t.avgRating}</span>
                <strong className="block text-lg font-extrabold mt-0.5 text-[var(--text)]">{summary.avg_rating.toFixed(2)}</strong>
              </div>
              <div className="p-2.5 rounded-md bg-[color-mix(in_srgb,#eab308_12%,var(--toggle-background))] text-amber-600 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              </div>
            </div>
          </div>

          <div className="chart-block line-chart-block">
            <div className="chart-header">
              <h3>{t.searchRequests}</h3>
              <div className="chart-header-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{timeChart.rangeLabel}</span>
                {canPredict && (
                  <button
                    className="predict-submit-compact"
                    disabled={isPredictionLoading}
                    onClick={handlePredict}
                    type="button"
                  >
                    {isPredictionLoading ? t.predicting : t.predict}
                  </button>
                )}
              </div>
            </div>
            {predictError && (
              <div className="predict-error" style={{ margin: "8px 0" }}>
                {predictError}
              </div>
            )}
            <div className="chart-controls">
              <div className="time-window-picker">
                <span>{t.window}</span>
                <div className="segmented-control">
                  {availableTimeWindowOptions.map((option) => (
                    <button
                      className={timeWindow === option.key ? "active" : ""}
                      key={option.key}
                      type="button"
                      onClick={() => updateTimeWindow(option.key)}
                    >
                      {t[option.labelKey]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="chart-category-picker">
                <span>{t.category}</span>
                <div className="chart-category-checklist">
                  <label>
                    <input
                      checked={selectedChartCategories.includes("all")}
                      onChange={(event) => toggleChartCategory("all", event.target.checked)}
                      type="checkbox"
                    />
                    <span>{t.allCategories}</span>
                  </label>
                  {categoryBreakdown.map((item) => (
                    <label key={item.category}>
                      <input
                        checked={selectedChartCategories.includes(item.category)}
                        onChange={(event) =>
                          toggleChartCategory(item.category, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>{translateCategory(item.category, language)}</span>
                    </label>
                  ))}
                </div>
              </div>
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
              isExpanded={isExpanded}
              language={language}
              series={chartDataItems.map((item, index) => {
                const itemTimeChart = aggregateTimeSeries(
                  item.data?.time_series ?? [],
                  language,
                  timeWindow,
                  timeOffset,
                  {
                    selectedStart: timeChart.selectedStartTime,
                    actualEndLimit: timeChart.actualEndLimit,
                    selectedRangeEnd: timeChart.selectedRangeEnd,
                    isTimelineAtEnd: timeChart.isTimelineAtEnd,
                  }
                );
                const predictionCategory = item.category === "all" ? null : item.category;
                const itemPredictionChart = aggregateRecursivePredictionSeries(
                  predictionData.filter((point) => (point.category ?? null) === predictionCategory),
                  language,
                  timeWindow,
                  predictionData.length > 0 ? itemTimeChart.predictionAnchorPoint : null,
                );

                return {
                  color: lineSeriesColors[index % lineSeriesColors.length],
                  data: itemTimeChart.points,
                  key: item.category,
                  label: item.category === "all"
                    ? t.allCategories
                    : translateCategory(item.category, language),
                  predictionData: (provinceDemand && predictionData.length > 0) ? itemPredictionChart : [],
                };
              })}
            />
          </div>

          {isExpanded ? (
            <div className="expanded-chart-grid">
              {timeWindow !== "all" && (
                <div className="chart-block full-width-chart" style={{ position: "relative" }}>
                  <div className="chart-header">
                    <h3>{t.categoryDistributionSelected}</h3>
                  </div>
                  <div style={{ opacity: isSelectedPeriodLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
                    <CategoryPieChart data={selectedPeriodBreakdown} language={language} />
                  </div>
                  {isSelectedPeriodLoading && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      fontSize: "12px",
                      color: "var(--muted-text)",
                      background: "rgba(0,0,0,0.05)",
                      borderRadius: "8px"
                    }}>
                      {t.loadingData}
                    </div>
                  )}
                </div>
              )}
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{timeWindow === "all" ? t.categoryDistribution : t.categoryDistributionEntire}</h3>
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
              {timeWindow !== "all" && (
                <div className="chart-block full-width-chart" style={{ position: "relative" }}>
                  <div className="chart-header">
                    <h3>{t.categoryDistributionSelected}</h3>
                  </div>
                  <div style={{ opacity: isSelectedPeriodLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
                    <CategoryPieChart data={selectedPeriodBreakdown} language={language} />
                  </div>
                  {isSelectedPeriodLoading && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      fontSize: "12px",
                      color: "var(--muted-text)",
                      background: "rgba(0,0,0,0.05)",
                      borderRadius: "8px"
                    }}>
                      {t.loadingData}
                    </div>
                  )}
                </div>
              )}
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{timeWindow === "all" ? t.categoryDistribution : t.categoryDistributionEntire}</h3>
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
              {timeWindow !== "all" && (
                <div className="chart-block full-width-chart" style={{ position: "relative" }}>
                  <div className="chart-header">
                    <h3>{t.categoryDistributionSelected}</h3>
                  </div>
                  <div style={{ opacity: isSelectedPeriodLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
                    <CategoryPieChart data={selectedPeriodBreakdown} language={language} />
                  </div>
                  {isSelectedPeriodLoading && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                      fontSize: "12px",
                      color: "var(--muted-text)",
                      background: "rgba(0,0,0,0.05)",
                      borderRadius: "8px"
                    }}>
                      {t.loadingData}
                    </div>
                  )}
                </div>
              )}
              <div className="chart-block full-width-chart">
                <div className="chart-header">
                  <h3>{timeWindow === "all" ? t.categoryDistribution : t.categoryDistributionEntire}</h3>
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
