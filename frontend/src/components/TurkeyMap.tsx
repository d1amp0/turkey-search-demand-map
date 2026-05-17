import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import type { Layer, Path, PathOptions } from "leaflet";
import {
  CircleMarker,
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  Pane,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { fetchRegionValues, fetchTurkeyGeoJson } from "../api/client";
import type { DemandFilters } from "../types/filters";
import { heatmapPalettes } from "../types/palette";
import type { HeatmapPalette } from "../types/palette";
import type {
  DemandMetricKey,
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";
import type { CoordinateMatch } from "../types/selection";

type TurkeyGeoJson = FeatureCollection<Geometry, TurkeyProvinceProperties>;
type Theme = "light" | "dark";
type ProvinceSuggestion = {
  distance: number;
  name: string;
  number: number;
};

const themePathColors: Record<Theme, { border: string; emptyFill: string }> = {
  light: {
    border: "#374151",
    emptyFill: "#f3f4f6",
  },
  dark: {
    border: "#94a3b8",
    emptyFill: "#1f2937",
  },
};

function baseStyle(theme: Theme): PathOptions {
  return {
    color: themePathColors[theme].border,
    fillColor: themePathColors[theme].emptyFill,
    fillOpacity: 0.88,
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

function normalizeValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || min === max) {
    return 0;
  }

  return Math.max(0, Math.min(1, (value - min) / (max - min)));
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
  customColor: string,
) {
  if (!Number.isFinite(value)) {
    return themePathColors[theme].emptyFill;
  }

  const ratio = normalizeValue(value as number, min, max);
  const paletteConfig = heatmapPalettes[palette];

  if (paletteConfig.mode === "gradient") {
    return mixHexColors(
      paletteConfig.startColor ?? "#16a34a",
      paletteConfig.endColor ?? "#dc2626",
      ratio,
    );
  }

  if (paletteConfig.mode === "custom") {
    return mixHexColors(themePathColors[theme].emptyFill, customColor, ratio);
  }

  const lightness = theme === "dark" ? 62 - ratio * 42 : 92 - ratio * 64;

  return `hsl(${paletteConfig.hue ?? 199} ${paletteConfig.saturation ?? 86}% ${lightness}%)`;
}

function metricLabel(metric: DemandMetricKey) {
  switch (metric) {
    case "avg_rating":
      return "Average rating";
    case "no_result_rate":
      return "No-result rate";
    case "avg_steps":
      return "Average steps";
    case "source_coverage":
      return "Source coverage";
    case "searches":
    default:
      return "Popularity";
  }
}

function markerColors(
  palette: HeatmapPalette,
  customColor: string,
  theme: Theme,
) {
  if (palette === "greenRed" || palette === "orange") {
    return {
      border: theme === "dark" ? "#f8fafc" : "#111827",
      fill: "#2563eb",
    };
  }

  if (palette === "blue" || palette === "tealGold") {
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

  if (palette === "custom") {
    const { b, g, r } = hexToRgb(customColor);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    return {
      border: luminance > 0.55 ? "#111827" : "#f8fafc",
      fill: luminance > 0.55 ? "#7c3aed" : "#facc15",
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

function BoundsController({ data }: { data: TurkeyGeoJson | null }) {
  const map = useMap();

  useEffect(() => {
    if (!data) {
      return;
    }

    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    const zoom = map.getBoundsZoom(bounds, false, L.point(72, 72)) - 0.3;

    map.invalidateSize();
    map.setView(bounds.getCenter(), zoom, { animate: false });
    map.setMaxBounds(bounds.pad(0.5));

    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView(bounds.getCenter(), zoom, { animate: false });
    });
  }, [data, map]);

  return null;
}

function CoordinatePicker({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (!enabled) {
        return;
      }

      onPick(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export function TurkeyMap({
  filters,
  customHeatmapColor,
  heatmapPalette,
  theme,
  onHeatmapPaletteChange,
  onCustomHeatmapColorChange,
  onSelectionChange,
}: {
  filters: DemandFilters;
  customHeatmapColor: string;
  heatmapPalette: HeatmapPalette;
  theme: Theme;
  onHeatmapPaletteChange: (palette: HeatmapPalette) => void;
  onCustomHeatmapColorChange: (color: string) => void;
  onSelectionChange: (selection: CoordinateMatch | null) => void;
}) {
  const [geoJson, setGeoJson] = useState<TurkeyGeoJson | null>(null);
  const [regionData, setRegionData] = useState<RegionValuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latitudeInput, setLatitudeInput] = useState("39");
  const [longitudeInput, setLongitudeInput] = useState("35");
  const [isMapPickEnabled, setIsMapPickEnabled] = useState(false);
  const [coordinateMatch, setCoordinateMatch] = useState<CoordinateMatch | null>(null);
  const [markerPosition, setMarkerPosition] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [isCustomColorPickerActive, setIsCustomColorPickerActive] = useState(false);
  const [isProvinceSearchOpen, setIsProvinceSearchOpen] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [selectedProvinceNumber, setSelectedProvinceNumber] = useState<number | null>(
    null,
  );
  const activeMetric = filters.metric;
  const activeMarkerColors = markerColors(heatmapPalette, customHeatmapColor, theme);

  const provinceSuggestions = useMemo<ProvinceSuggestion[]>(() => {
    const query = provinceSearch.trim();

    if (!query || !geoJson) {
      return [];
    }

    return geoJson.features
      .map((feature) => ({
        distance: provinceSearchScore(query, feature.properties.name),
        name: feature.properties.name,
        number: feature.properties.number,
      }))
      .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
      .slice(0, 5);
  }, [geoJson, provinceSearch]);

  const valueRange = useMemo(() => {
    const values = Object.values(regionData?.values ?? {}).map((item) => item.value);

    return {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
    };
  }, [regionData]);

  const loadData = useCallback(async () => {
    setError(null);

    try {
      const [nextGeoJson, nextRegionData] = await Promise.all([
        fetchTurkeyGeoJson(),
        fetchRegionValues(filters, activeMetric),
      ]);

      setGeoJson(nextGeoJson);
      setRegionData(nextRegionData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load map");
    }
  }, [activeMetric, filters]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectProvince = useCallback(
    (province: { name: string; number: number }) => {
      setSelectedProvinceNumber(province.number);
      setCoordinateError(null);
      setCoordinateMatch({
        latitude: null,
        longitude: null,
        regionName: province.name,
        provinceNumber: province.number,
      });
      setMarkerPosition(null);
      setProvinceSearch(province.name);
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

  const styleRegion = useCallback(
    (feature?: Feature<Geometry, TurkeyProvinceProperties>) => {
      const provinceNumber = feature?.properties?.number;
      const value =
        provinceNumber === undefined
          ? undefined
          : regionData?.values[String(provinceNumber)]?.value;

      return {
        ...baseStyle(theme),
        fillColor: colorForValue(
          value,
          valueRange.min,
          valueRange.max,
          theme,
          heatmapPalette,
          customHeatmapColor,
        ),
        ...(provinceNumber === selectedProvinceNumber ? selectedStyle(theme) : {}),
      };
    },
    [
      customHeatmapColor,
      heatmapPalette,
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

      layer.bindTooltip(
        `
          <strong>${feature.properties.name}</strong><br>
          Province: ${provinceNumber}<br>
          ${metricLabel(activeMetric)}:
          ${Number.isFinite(value) ? value : "No data"}
        `,
        {
          className: "region-tooltip",
          sticky: true,
        },
      );

      layer.on({
        mouseout: () => {
          if (heatmapPalette === "custom" && isCustomColorPickerActive) {
            return;
          }

          if ("setStyle" in layer) {
            (layer as Path).setStyle(styleRegion(feature));
          }
        },
        mouseover: () => {
          if (heatmapPalette === "custom" && isCustomColorPickerActive) {
            return;
          }

          if ("setStyle" in layer) {
            (layer as Path).setStyle(
              feature.properties.number === selectedProvinceNumber
                ? selectedStyle(theme)
                : highlightStyle(theme),
            );
          }
        },
        click: () => {
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
      heatmapPalette,
      isCustomColorPickerActive,
      regionData,
      selectProvince,
      selectedProvinceNumber,
      styleRegion,
      theme,
    ],
  );

  const updatedAt = regionData?.updated_at
    ? new Date(regionData.updated_at).toLocaleString()
    : "Loading data...";

  const updateCoordinateMatch = useCallback(
    (latitude: number, longitude: number) => {
      const matchingFeature = geoJson?.features.find((feature) =>
        featureContainsPoint(feature, longitude, latitude),
      );
      const nextSelection = {
        latitude,
        longitude,
        regionName: matchingFeature?.properties.name ?? null,
        provinceNumber: matchingFeature?.properties.number ?? null,
      };

      setCoordinateError(null);
      setMarkerPosition({ latitude, longitude });
      setCoordinateMatch(nextSelection);
      onSelectionChange(nextSelection);
    },
    [geoJson, onSelectionChange],
  );

  function findLocationByCoordinates() {
    const latitude = Number(latitudeInput.replace(",", "."));
    const longitude = Number(longitudeInput.replace(",", "."));

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setCoordinateError("Enter valid latitude and longitude");
      setMarkerPosition(null);
      setCoordinateMatch(null);
      onSelectionChange(null);
      return;
    }

    updateCoordinateMatch(latitude, longitude);
  }

  function pickLocationOnMap(latitude: number, longitude: number) {
    setLatitudeInput(latitude.toFixed(6));
    setLongitudeInput(longitude.toFixed(6));
    updateCoordinateMatch(latitude, longitude);
  }

  function refreshData() {
    setMarkerPosition(null);
    setCoordinateMatch(null);
    setCoordinateError(null);
    setSelectedProvinceNumber(null);
    setIsProvinceSearchOpen(false);
    setProvinceSearch("");
    onSelectionChange(null);
    void loadData();
  }

  return (
    <section className="map-card">
      <div className="map-toolbar">
        <div>
          <h1>Turkey demand map</h1>
          <p>
            {error ??
              `${metricLabel(activeMetric)} · Updated: ${updatedAt}`}
          </p>
        </div>
        <div className="map-toolbar-actions">
          <label className="palette-select">
            <span>Heatmap</span>
            <select
              value={heatmapPalette}
              onChange={(event) =>
                onHeatmapPaletteChange(event.target.value as HeatmapPalette)
              }
            >
              {Object.entries(heatmapPalettes).map(([key, palette]) => (
                <option key={key} value={key}>
                  {palette.label}
                </option>
              ))}
            </select>
          </label>
          <label className="palette-color">
            <span>Color</span>
            <input
              disabled={heatmapPalette !== "custom"}
              type="color"
              value={customHeatmapColor}
              onBlur={() => setIsCustomColorPickerActive(false)}
              onChange={(event) => onCustomHeatmapColorChange(event.target.value)}
              onFocus={() => setIsCustomColorPickerActive(true)}
              onPointerDown={() => setIsCustomColorPickerActive(true)}
            />
          </label>
          <button className="refresh-button" type="button" onClick={refreshData}>
            Refresh
          </button>
        </div>
      </div>

      <div className="coordinate-result" aria-live="polite">
        {coordinateError ??
          (coordinateMatch
            ? coordinateMatch.regionName
              ? `${coordinateMatch.regionName} province (${coordinateMatch.provinceNumber})`
              : "Coordinates are outside Turkey"
            : "Enter coordinates to identify a province")}
      </div>

      <div className="map-canvas">
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
          <label>
            <span>Province</span>
            <input
              autoComplete="off"
              placeholder="Type a province name"
              value={provinceSearch}
              onChange={(event) => {
                setProvinceSearch(event.target.value);
                setIsProvinceSearchOpen(true);
              }}
              onFocus={() => setIsProvinceSearchOpen(true)}
            />
          </label>
          <button type="submit">Find</button>
          {isProvinceSearchOpen && provinceSuggestions.length ? (
            <div className="province-suggestions">
              {provinceSuggestions.map((province) => (
                <button
                  key={province.number}
                  type="button"
                  onClick={() => selectProvince(province)}
                >
                  <span>{province.name}</span>
                  <em>{province.distance}</em>
                </button>
              ))}
            </div>
          ) : null}
        </form>
        <form
          className="coordinate-search"
          onSubmit={(event) => {
            event.preventDefault();
            findLocationByCoordinates();
          }}
        >
          <label>
            <span>Lat</span>
            <input
              inputMode="decimal"
              value={latitudeInput}
              onChange={(event) => setLatitudeInput(event.target.value)}
            />
          </label>
          <label>
            <span>Lon</span>
            <input
              inputMode="decimal"
              value={longitudeInput}
              onChange={(event) => setLongitudeInput(event.target.value)}
            />
          </label>
          <label className="map-pick-toggle">
            <input
              checked={isMapPickEnabled}
              onChange={(event) => setIsMapPickEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>Pick on map</span>
          </label>
          <button type="submit">Find</button>
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
          className="leaflet-map"
        >
          <BoundsController data={geoJson} />
          <CoordinatePicker
            enabled={isMapPickEnabled}
            onPick={pickLocationOnMap}
          />
          <Pane name="province-pane" style={{ zIndex: 400 }}>
            {geoJson ? (
              <LeafletGeoJSON
                key={`${regionData?.updated_at ?? "initial"}-${selectedProvinceNumber ?? "none"}-${heatmapPalette}-${customHeatmapColor}`}
                data={geoJson}
                style={styleRegion}
                onEachFeature={onEachFeature}
              />
            ) : null}
          </Pane>
          <Pane name="marker-pane" style={{ zIndex: 450 }}>
            {markerPosition ? (
              <CircleMarker
                center={[markerPosition.latitude, markerPosition.longitude]}
                pathOptions={{
                  color: activeMarkerColors.border,
                  fillColor: activeMarkerColors.fill,
                  fillOpacity: 1,
                  weight: 3,
                }}
                radius={8}
              />
            ) : null}
          </Pane>
        </MapContainer>
      </div>
    </section>
  );
}
