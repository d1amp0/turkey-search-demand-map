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
    emptyFill: "#d1d5db",
  },
  dark: {
    border: "#94a3b8",
    emptyFill: "#475569",
  },
};

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

function metricLabel(metric: DemandMetricKey) {
  switch (metric) {
    case "avg_rating":
      return "Average rating";
    case "searches":
    default:
      return "Popularity";
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
  heatmapPalette,
  theme,
  onHeatmapPaletteChange,
  onSelectionChange,
}: {
  filters: DemandFilters;
  heatmapPalette: HeatmapPalette;
  theme: Theme;
  onHeatmapPaletteChange: (palette: HeatmapPalette) => void;
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
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isProvinceSearchOpen, setIsProvinceSearchOpen] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState("");
  const [selectedProvinceNumber, setSelectedProvinceNumber] = useState<number | null>(
    null,
  );
  const activeMetric = filters.metric;
  const activeMarkerColors = markerColors(heatmapPalette, theme);

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
      const displayValue =
        activeMetric === "avg_rating" && value === 0 ? undefined : value;

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
          Province: ${provinceNumber}<br>
          ${metricLabel(activeMetric)}:
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
          </label>
          <button type="submit">Find</button>
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
                key={`${regionData?.updated_at ?? "initial"}-${selectedProvinceNumber ?? "none"}-${heatmapPalette}`}
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
