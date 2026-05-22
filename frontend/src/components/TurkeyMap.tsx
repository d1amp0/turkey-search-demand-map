import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import type { Layer, LeafletMouseEvent, Path, PathOptions } from "leaflet";
import {
  Circle,
  CircleMarker,
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  Pane,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  fetchRegionValues,
  fetchRequestPoints,
  fetchTurkeyGeoJson,
} from "../api/client";
import { translations } from "../i18n";
import type { DemandFilters } from "../types/filters";
import type { Language } from "../i18n";
import { heatmapPalettes } from "../types/palette";
import type { HeatmapPalette } from "../types/palette";
import type {
  DemandMetricKey,
  RequestHeatPoint,
  RequestPointsResponse,
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";
import type { CoordinateMatch } from "../types/selection";

type TurkeyGeoJson = FeatureCollection<Geometry, TurkeyProvinceProperties>;
type Theme = "light" | "dark";
type MapHeatMode = "regions" | "points";
type ProvinceSuggestion = {
  distance: number;
  name: string;
  number: number;
};
const paletteLabelKeys = {
  blue: "blue",
  green: "green",
  orange: "orange",
  purple: "purple",
} as const;

const themePathColors: Record<Theme, { border: string; emptyFill: string }> = {
  light: {
    border: "#374151",
    emptyFill: "#d1d5db",
  },
  dark: {
    border: "#94a3b8",
    emptyFill: "#475569",
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function baseStyle(theme: Theme): PathOptions {
  return {
    color: themePathColors[theme].border,
    fillColor: themePathColors[theme].emptyFill,
    fillOpacity: 0.96,
    opacity: 1,
    weight: 1,
  };
}

function highlightStyle(theme: Theme): PathOptions {
  return {
    color: theme === "dark" ? "#e5e7eb" : "#111827",
    fillOpacity: 0.98,
    weight: 2,
  };
}

function selectedStyle(theme: Theme): PathOptions {
  return {
    color: theme === "dark" ? "#f8fafc" : "#111827",
    fillOpacity: 1,
    weight: 3,
  };
}

function outlineStyle(theme: Theme): PathOptions {
  return {
    color: theme === "dark" ? "#64748b" : "#94a3b8",
    fillColor: "transparent",
    fillOpacity: 0,
    opacity: 0.18,
    weight: 0.8,
  };
}

function normalizeValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || min === max) {
    return 0;
  }

  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function percentile(sortedValues: number[], ratio: number) {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * ratio)),
  );

  return sortedValues[index];
}

function hexToRgb(color: string) {
  const value = color.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((character) => character + character).join("")
    : value;

  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function mixHexColors(startColor: string, endColor: string, ratio: number) {
  const start = hexToRgb(startColor);
  const end = hexToRgb(endColor);
  const next = {
    b: Math.round(start.b + (end.b - start.b) * ratio),
    g: Math.round(start.g + (end.g - start.g) * ratio),
    r: Math.round(start.r + (end.r - start.r) * ratio),
  };

  return `rgb(${next.r} ${next.g} ${next.b})`;
}

function colorForValue(
  value: number | undefined,
  min: number,
  max: number,
  theme: Theme,
  palette: HeatmapPalette,
) {
  if (!Number.isFinite(value)) {
    return themePathColors[theme].emptyFill;
  }

  const normalizedRatio = normalizeValue(value as number, min, max);
  const ratio = Math.pow(normalizedRatio, 0.72);
  const paletteConfig = heatmapPalettes[palette];

  if (paletteConfig.mode === "gradient") {
    return mixHexColors(
      paletteConfig.startColor ?? "#16a34a",
      paletteConfig.endColor ?? "#dc2626",
      ratio,
    );
  }

  const lightness = theme === "dark" ? 70 - ratio * 52 : 94 - ratio * 70;

  return `hsl(${paletteConfig.hue ?? 199} ${Math.min((paletteConfig.saturation ?? 86) + 8, 98)}% ${lightness}%)`;
}

function metricLabel(metric: DemandMetricKey, language: Language) {
  const t = translations[language];

  switch (metric) {
    case "avg_rating":
      return t.averageRating;
    case "searches":
    default:
      return t.popularity;
  }
}

function markerColors(
  palette: HeatmapPalette,
  theme: Theme,
) {
  if (palette === "orange") {
    return {
      border: theme === "dark" ? "#f8fafc" : "#111827",
      fill: "#2563eb",
    };
  }

  if (palette === "blue") {
    return {
      border: theme === "dark" ? "#f8fafc" : "#111827",
      fill: "#f97316",
    };
  }

  if (palette === "purple") {
    return {
      border: theme === "dark" ? "#f8fafc" : "#111827",
      fill: "#22c55e",
    };
  }

  return {
    border: theme === "dark" ? "#f8fafc" : "#111827",
    fill: "#dc2626",
  };
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLowerCase()
    .trim();
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

function levenshteinDistance(leftValue: string, rightValue: string) {
  const left = normalizeSearchValue(leftValue);
  const right = normalizeSearchValue(rightValue);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function provinceSearchScore(query: string, provinceName: string) {
  const normalizedQuery = normalizeSearchValue(query);
  const normalizedName = normalizeSearchValue(provinceName);
  const baseDistance = levenshteinDistance(normalizedQuery, normalizedName);

  if (normalizedName.startsWith(normalizedQuery)) {
    return Math.max(0, baseDistance - 6);
  }

  if (normalizedName.includes(normalizedQuery)) {
    return Math.max(0, baseDistance - 3);
  }

  return baseDistance;
}

function fitMapToTurkey(map: L.Map, data: TurkeyGeoJson) {
  const layer = L.geoJSON(data);
  const bounds = layer.getBounds();
  const zoom = map.getBoundsZoom(bounds, false, L.point(72, 72)) - 0.3;

  map.invalidateSize();
  map.setView(bounds.getCenter(), zoom, { animate: false });
  map.setMaxBounds(bounds.pad(0.5));
}

function BoundsController({ data }: { data: TurkeyGeoJson | null }) {
  const map = useMap();

  useEffect(() => {
    if (!data) {
      return;
    }

    fitMapToTurkey(map, data);

    requestAnimationFrame(() => {
      fitMapToTurkey(map, data);
    });
  }, [data, map]);

  return null;
}

function ResizeController({ data }: { data: TurkeyGeoJson | null }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;

    const resizeMap = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (data) {
          fitMapToTurkey(map, data);
          return;
        }

        map.invalidateSize();
      });
    };

    const observer = new ResizeObserver(resizeMap);
    observer.observe(container);
    window.addEventListener("resize", resizeMap);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resizeMap);
    };
  }, [data, map]);

  return null;
}

function CoordinatePicker({
  enabled,
  onMapBackgroundClick,
  onPick,
}: {
  enabled: boolean;
  onMapBackgroundClick: () => void;
  onPick: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (enabled) {
        onPick(event.latlng.lat, event.latlng.lng);
        return;
      }

      onMapBackgroundClick();
    },
  });

  return null;
}

function heatmapColorRamp(intensity: number, palette: HeatmapPalette, theme: Theme) {
  const ratio = Math.pow(clamp(intensity, 0, 1), 1.12);
  const low = hexToRgb(theme === "dark" ? "#0b1120" : "#ffffff");
  const high = hexToRgb(heatmapPalettes[palette].accent);

  return {
    b: Math.round(low.b + (high.b - low.b) * ratio),
    g: Math.round(low.g + (high.g - low.g) * ratio),
    r: Math.round(low.r + (high.r - low.r) * ratio),
  };
}

function drawGeometryMask(
  context: CanvasRenderingContext2D,
  geometry: Geometry,
  map: L.Map,
) {
  const drawRing = (ring: number[][]) => {
    ring.forEach(([longitude, latitude], index) => {
      const point = map.latLngToContainerPoint([latitude, longitude]);

      if (index === 0) {
        context.moveTo(point.x, point.y);
        return;
      }

      context.lineTo(point.x, point.y);
    });
    context.closePath();
  };

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(drawRing);
    return;
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach(drawRing);
    });
  }
}

function RequestHeatmapLayer({
  geoJson,
  palette,
  points,
  theme,
}: {
  geoJson: TurkeyGeoJson;
  palette: HeatmapPalette;
  points: RequestHeatPoint[];
  theme: Theme;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const pane = map.getPane("heat-pane") ?? map.getPanes().overlayPane;
    const canvas = L.DomUtil.create("canvas", "request-heatmap-canvas");

    canvasRef.current = canvas;
    pane.appendChild(canvas);

    return () => {
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    let frame = 0;
    const draw = () => {
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      canvas.width = Math.max(1, Math.round(size.x * pixelRatio));
      canvas.height = Math.max(1, Math.round(size.y * pixelRatio));
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, size.x, size.y);

      const maskCanvas = document.createElement("canvas");
      const maskContext = maskCanvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!maskContext) {
        return;
      }

      const densityCanvas = document.createElement("canvas");
      const densityContext = densityCanvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!densityContext) {
        return;
      }

      maskCanvas.width = Math.max(1, size.x);
      maskCanvas.height = Math.max(1, size.y);
      densityCanvas.width = Math.max(1, size.x);
      densityCanvas.height = Math.max(1, size.y);
      maskContext.clearRect(0, 0, size.x, size.y);
      maskContext.beginPath();
      geoJson.features.forEach((feature) => {
        drawGeometryMask(maskContext, feature.geometry, map);
      });
      maskContext.fillStyle = "#000000";
      maskContext.fill("evenodd");

      const maxSearches = Math.max(...points.map((point) => point.searches), 1);
      const baseRadius = Math.max(22, Math.min(48, size.x / 30));

      densityContext.clearRect(0, 0, size.x, size.y);
      densityContext.globalCompositeOperation = "lighter";

      points.forEach((point) => {
        const containerPoint = map.latLngToContainerPoint([
          point.latitude,
          point.longitude,
        ]);
        const ratio = Math.pow(point.searches / maxSearches, 2);
        const radius = baseRadius + ratio * 34;

        if (
          containerPoint.x < -radius ||
          containerPoint.y < -radius ||
          containerPoint.x > size.x + radius ||
          containerPoint.y > size.y + radius
        ) {
          return;
        }

        const gradient = densityContext.createRadialGradient(
          containerPoint.x,
          containerPoint.y,
          0,
          containerPoint.x,
          containerPoint.y,
          radius,
        );
        const alpha = 0.04 + ratio * 0.2;

        gradient.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
        gradient.addColorStop(0.5, `rgba(0, 0, 0, ${alpha * 0.46})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        densityContext.fillStyle = gradient;
        densityContext.beginPath();
        densityContext.arc(containerPoint.x, containerPoint.y, 5, 0, Math.PI * 2);
        densityContext.fill();
      });

      const image = densityContext.getImageData(0, 0, size.x, size.y);
      const data = image.data;
      const mask = maskContext.getImageData(0, 0, size.x, size.y).data;

      for (let index = 0; index < data.length; index += 4) {
        if (mask[index + 3] === 0) {
          data[index + 3] = 0;
          continue;
        }

        const density = data[index + 3] / 255;
        const intensity = Math.min(1, Math.pow(density * 0.9, 1.18));
        const rampColor = heatmapColorRamp(intensity, palette, theme);

        data[index] = rampColor.r;
        data[index + 1] = rampColor.g;
        data[index + 2] = rampColor.b;
        data[index + 3] = 255;
      }

      densityContext.globalCompositeOperation = "source-over";
      densityContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = true;
      context.drawImage(densityCanvas, 0, 0, size.x, size.y);
    };
    const scheduleDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };

    scheduleDraw();
    map.on("move zoom resize moveend zoomend", scheduleDraw);

    return () => {
      cancelAnimationFrame(frame);
      map.off("move zoom resize moveend zoomend", scheduleDraw);
    };
  }, [geoJson, map, palette, points, theme]);

  return null;
}

export function TurkeyMap({
  filters,
  heatmapPalette,
  isMapPickEnabled,
  language,
  theme,
  onHeatmapPaletteChange,
  onMapPickEnabledChange,
  onResetUserControls,
  onSelectionChange,
  radiusKm,
  resetVersion,
  selection,
}: {
  filters: DemandFilters;
  heatmapPalette: HeatmapPalette;
  isMapPickEnabled: boolean;
  language: Language;
  theme: Theme;
  onHeatmapPaletteChange: (palette: HeatmapPalette) => void;
  onMapPickEnabledChange: (isEnabled: boolean) => void;
  onResetUserControls: () => void;
  onSelectionChange: (selection: CoordinateMatch | null) => void;
  radiusKm: number;
  resetVersion: number;
  selection: CoordinateMatch | null;
}) {
  const t = translations[language];
  const [geoJson, setGeoJson] = useState<TurkeyGeoJson | null>(null);
  const [regionData, setRegionData] = useState<RegionValuesResponse | null>(null);
  const [requestPointsData, setRequestPointsData] =
    useState<RequestPointsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isProvinceSearchOpen, setIsProvinceSearchOpen] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [selectedProvinceNumber, setSelectedProvinceNumber] = useState<number | null>(
    null,
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [mapHeatMode, setMapHeatMode] = useState<MapHeatMode>("regions");
  const activeMetric = filters.metric;
  const activeMarkerColors = markerColors(heatmapPalette, theme);
  const markerPosition =
    selection && selection.latitude !== null && selection.longitude !== null
      ? {
          latitude: selection.latitude,
          longitude: selection.longitude,
        }
      : null;
  const hasValidRadius = Number.isFinite(radiusKm) && radiusKm > 0;

  const provinceSuggestions = useMemo<ProvinceSuggestion[]>(() => {
    const query = provinceSearch.trim();

    if (!query || !geoJson) {
      return [];
    }

    return geoJson.features
      .map((feature) => {
        const normalizedQuery = normalizeSearchValue(query);
        const normalizedName = normalizeSearchValue(feature.properties.name);
        const distance = levenshteinDistance(query, feature.properties.name);
        const isPrefixMatch = normalizedName.startsWith(normalizedQuery);
        const isSubstringMatch = normalizedName.includes(normalizedQuery);

        return {
          distance,
          isPrefixMatch,
          isSubstringMatch,
          name: feature.properties.name,
          number: feature.properties.number,
          score: provinceSearchScore(query, feature.properties.name),
        };
      })
      .filter((province) =>
        province.isPrefixMatch || province.isSubstringMatch || province.distance <= 1,
      )
      .sort((left, right) => {
        if (left.isPrefixMatch !== right.isPrefixMatch) {
          return left.isPrefixMatch ? -1 : 1;
        }

        if (left.isSubstringMatch !== right.isSubstringMatch) {
          return left.isSubstringMatch ? -1 : 1;
        }

        return left.score - right.score || left.name.localeCompare(right.name);
      });
  }, [geoJson, provinceSearch]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [provinceSuggestions]);

  const visibleProvinceSuggestions = useMemo(() => {
    const startIndex = Math.min(
      Math.max(activeSuggestionIndex - 2, 0),
      Math.max(provinceSuggestions.length - 5, 0),
    );

    return provinceSuggestions.slice(startIndex, startIndex + 5).map((province, index) => ({
      ...province,
      index: startIndex + index,
    }));
  }, [activeSuggestionIndex, provinceSuggestions]);

  const valueRange = useMemo(() => {
    const values = Object.values(regionData?.values ?? {})
      .map((item) => item.value)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);

    return {
      min: values.length ? percentile(values, 0.08) : 0,
      max: values.length ? percentile(values, 0.92) : 1,
    };
  }, [regionData]);

  const requestPoints = requestPointsData?.points ?? [];

  const loadData = useCallback(async () => {
    setError(null);

    try {
      const [nextGeoJson, nextRegionData, nextRequestPointsData] = await Promise.all([
        fetchTurkeyGeoJson(),
        fetchRegionValues(filters, activeMetric),
        fetchRequestPoints(filters),
      ]);

      setGeoJson(nextGeoJson);
      setRegionData(nextRegionData);
      setRequestPointsData(nextRequestPointsData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.failedToLoadMap);
    }
  }, [activeMetric, filters, t.failedToLoadMap]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshVersion]);

  const clearMapInputs = useCallback(() => {
    setSelectedProvinceNumber(null);
    setIsProvinceSearchOpen(false);
    setProvinceSearch("");
    setActiveSuggestionIndex(0);
  }, []);

  useEffect(() => {
    if (resetVersion === 0) {
      return;
    }

    clearMapInputs();
  }, [clearMapInputs, resetVersion]);

  const selectProvince = useCallback(
    (province: { name: string; number: number }) => {
      setSelectedProvinceNumber(province.number);
      setProvinceSearch("");
      setIsProvinceSearchOpen(false);
      onSelectionChange({
        latitude: null,
        longitude: null,
        regionName: province.name,
        provinceNumber: province.number,
      });
    },
    [onSelectionChange],
  );

  const pickLocationOnMap = useCallback(
    (latitude: number, longitude: number, province: { name: string; number: number }) => {
      setSelectedProvinceNumber(province.number);
      setProvinceSearch("");
      setIsProvinceSearchOpen(false);
      onSelectionChange({
        latitude,
        longitude,
        regionName: province.name,
        provinceNumber: province.number,
      });
    },
    [onSelectionChange],
  );

  useEffect(() => {
    setSelectedProvinceNumber(selection?.provinceNumber ?? null);
  }, [selection?.provinceNumber]);

  const styleRegion = useCallback(
    (feature?: Feature<Geometry, TurkeyProvinceProperties>) => {
      const provinceNumber = feature?.properties?.number;
      const value =
        provinceNumber === undefined
          ? undefined
          : regionData?.values[String(provinceNumber)]?.value;
      const displayValue =
        activeMetric === "avg_rating" && value === 0 ? undefined : value;

      if (mapHeatMode === "points") {
        return {
          ...outlineStyle(theme),
          ...(provinceNumber === selectedProvinceNumber ? selectedStyle(theme) : {}),
        };
      }

      return {
        ...baseStyle(theme),
        fillColor: colorForValue(
          displayValue,
          valueRange.min,
          valueRange.max,
          theme,
          heatmapPalette,
        ),
        ...(provinceNumber === selectedProvinceNumber ? selectedStyle(theme) : {}),
      };
    },
    [
      activeMetric,
      heatmapPalette,
      mapHeatMode,
      regionData,
      selectedProvinceNumber,
      theme,
      valueRange,
    ],
  );

  const onEachFeature = useCallback(
    (feature: Feature<Geometry, TurkeyProvinceProperties>, layer: Layer) => {
      const provinceNumber = String(feature.properties.number);
      const value = regionData?.values[provinceNumber]?.value;
      const displayValue =
        activeMetric === "avg_rating" && value === 0 ? undefined : value;

      layer.bindTooltip(
        `
          <strong>${feature.properties.name}</strong><br>
          ${t.province}: ${provinceNumber}<br>
          ${metricLabel(activeMetric, language)}:
          ${Number.isFinite(displayValue) ? displayValue : "N/A"}
        `,
        {
          className: "region-tooltip",
          sticky: true,
        },
      );

      layer.on({
        mouseout: () => {
          if ("setStyle" in layer) {
            (layer as Path).setStyle(styleRegion(feature));
          }
        },
        mouseover: () => {
          if ("setStyle" in layer) {
            (layer as Path).setStyle(
              feature.properties.number === selectedProvinceNumber
                ? selectedStyle(theme)
                : mapHeatMode === "points"
                  ? outlineStyle(theme)
                  : highlightStyle(theme),
            );
          }
        },
        click: (event: LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event);

          if (isMapPickEnabled) {
            pickLocationOnMap(event.latlng.lat, event.latlng.lng, {
              name: feature.properties.name,
              number: feature.properties.number,
            });
            return;
          }

          selectProvince({
            name: feature.properties.name,
            number: feature.properties.number,
          });

          if ("bringToFront" in layer) {
            (layer as Path).bringToFront();
          }
        },
      });
    },
    [
      activeMetric,
      isMapPickEnabled,
      regionData,
      mapHeatMode,
      pickLocationOnMap,
      selectProvince,
      selectedProvinceNumber,
      styleRegion,
      t.province,
      theme,
      language,
    ],
  );

  const updatedAt = regionData?.updated_at
    ? new Date(regionData.updated_at).toLocaleString()
    : t.loadingData;
  const hasProvinceSuggestion = provinceSuggestions.length > 0;

  function refreshData() {
    clearMapInputs();
    onResetUserControls();
    onMapPickEnabledChange(false);
    onSelectionChange(null);
    setRefreshVersion((version) => version + 1);
  }

  return (
    <section className="map-card">
      <div className="map-toolbar">
        <div className="flex items-center gap-3">
          <div className="w-[3px] h-6 bg-[var(--accent)] rounded-full flex-shrink-0" />
          <div>
            <h1 className="m-0 text-base font-semibold leading-tight">{t.turkeyDemandMap}</h1>
            <p className="mt-0.5 mb-0 text-[11px] font-medium text-[var(--muted-text)]">
              {error ??
                `${metricLabel(activeMetric, language)} • ${updatedAt}`}
            </p>
          </div>
        </div>
        <div className="map-toolbar-actions">
          <label className="palette-select">
            <span>
              {t.heatmap}
              <em>{t.heatmapHelp}</em>
            </span>
            <select
              value={heatmapPalette}
              onChange={(event) =>
                onHeatmapPaletteChange(event.target.value as HeatmapPalette)
              }
            >
              {Object.entries(heatmapPalettes).map(([key, palette]) => (
                <option key={key} value={key}>
                  {t[paletteLabelKeys[key as HeatmapPalette]] ?? palette.label}
                </option>
              ))}
            </select>
          </label>
          <button className="refresh-button flex items-center justify-center gap-1.5" type="button" onClick={refreshData}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>{t.reset}</span>
          </button>
        </div>
      </div>

      <div className="map-canvas">
        <div className="map-mode-toggle" aria-label={t.mapView}>
          <button
            className={mapHeatMode === "regions" ? "active" : ""}
            type="button"
            onClick={() => setMapHeatMode("regions")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
            <span>{t.regionsHeatmap}</span>
          </button>
          <button
            className={mapHeatMode === "points" ? "active" : ""}
            type="button"
            onClick={() => setMapHeatMode("points")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            <span>{t.requestHeatmap}</span>
          </button>
        </div>
        <form
          className="province-map-search"
          onSubmit={(event) => {
            event.preventDefault();

            if (provinceSuggestions[0]) {
              selectProvince({
                name: provinceSuggestions[0].name,
                number: provinceSuggestions[0].number,
              });
            }
          }}
        >
          <div className="flex flex-col gap-1 w-full relative">
            <span className="text-[11px] font-semibold text-[var(--muted-text)] uppercase tracking-wider">{t.province}</span>
            <div className="flex gap-2 items-center w-full">
              <div className="relative flex-1 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 text-[var(--muted-text)] pointer-events-none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input
                  autoComplete="off"
                  placeholder={t.typeProvinceName}
                  value={provinceSearch}
                  onChange={(event) => {
                    setProvinceSearch(event.target.value);
                    setIsProvinceSearchOpen(true);
                  }}
                  onFocus={() => setIsProvinceSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (!provinceSuggestions.length) {
                      return;
                    }

                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setIsProvinceSearchOpen(true);
                      setActiveSuggestionIndex((index) =>
                        Math.min(index + 1, provinceSuggestions.length - 1),
                      );
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setIsProvinceSearchOpen(true);
                      setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
                    }

                    if (event.key === "Enter" && isProvinceSearchOpen) {
                      event.preventDefault();
                      const activeSuggestion = provinceSuggestions[activeSuggestionIndex];

                      if (activeSuggestion) {
                        selectProvince(activeSuggestion);
                      }
                    }

                    if (event.key === "Escape") {
                      setIsProvinceSearchOpen(false);
                    }
                  }}
                />
              </div>
              <button disabled={!hasProvinceSuggestion} type="submit" className="province-find-btn">
                {t.find}
              </button>
            </div>
            <em className="text-[10px] text-[var(--muted-text)] not-italic mt-0.5">{t.provinceSearchHelp}</em>
            {isProvinceSearchOpen && visibleProvinceSuggestions.length ? (
              <div className="province-suggestions">
                {visibleProvinceSuggestions.map((province) => (
                  <button
                    className={province.index === activeSuggestionIndex ? "active" : ""}
                    key={province.number}
                    type="button"
                    onClick={() => selectProvince(province)}
                    onMouseEnter={() => setActiveSuggestionIndex(province.index)}
                  >
                    <span>{province.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </form>
        <MapContainer
          center={[39, 35]}
          zoom={6}
          boxZoom={false}
          doubleClickZoom={false}
          dragging={false}
          keyboard={false}
          scrollWheelZoom={false}
          touchZoom={false}
          zoomSnap={0.1}
          zoomControl={false}
          attributionControl={false}
          className={isMapPickEnabled ? "leaflet-map pick-enabled" : "leaflet-map"}
        >
          <BoundsController data={geoJson} />
          <ResizeController data={geoJson} />
          <CoordinatePicker
            enabled={isMapPickEnabled}
            onMapBackgroundClick={() => onSelectionChange(null)}
            onPick={(latitude, longitude) => {
              const matchingFeature = geoJson?.features.find((feature) =>
                featureContainsPoint(feature, longitude, latitude),
              );

              if (matchingFeature) {
                pickLocationOnMap(latitude, longitude, {
                  name: matchingFeature.properties.name,
                  number: matchingFeature.properties.number,
                });
              }
            }}
          />
          <Pane name="province-pane" style={{ zIndex: 400 }}>
            {geoJson ? (
              <LeafletGeoJSON
                key={`${regionData?.updated_at ?? "initial"}-${selectedProvinceNumber ?? "none"}-${heatmapPalette}-${theme}-${mapHeatMode}-${isMapPickEnabled ? "pick" : "select"}`}
                data={geoJson}
                style={styleRegion}
                onEachFeature={onEachFeature}
              />
            ) : null}
          </Pane>
          <Pane name="heat-pane" style={{ zIndex: 350, pointerEvents: "none" }}>
            {mapHeatMode === "points" && geoJson ? (
              <RequestHeatmapLayer
                geoJson={geoJson}
                palette={heatmapPalette}
                points={requestPoints}
                theme={theme}
              />
            ) : null}
          </Pane>
          <Pane name="marker-pane" style={{ zIndex: 450 }}>
            {markerPosition ? (
              <>
                {hasValidRadius ? (
                  <Circle
                    center={[markerPosition.latitude, markerPosition.longitude]}
                    pathOptions={{
                      color: activeMarkerColors.fill,
                      fillColor: activeMarkerColors.fill,
                      fillOpacity: 0.12,
                      opacity: 0.85,
                      weight: 2,
                    }}
                    radius={radiusKm * 1000}
                  />
                ) : null}
                <CircleMarker
                  center={[markerPosition.latitude, markerPosition.longitude]}
                  pathOptions={{
                    color: activeMarkerColors.border,
                    fillColor: activeMarkerColors.fill,
                    fillOpacity: 1,
                    weight: 3,
                  }}
                  radius={5}
                />
              </>
            ) : null}
          </Pane>
        </MapContainer>
      </div>
    </section>
  );
}
