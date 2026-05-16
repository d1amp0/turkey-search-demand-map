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
import type {
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";

type TurkeyGeoJson = FeatureCollection<Geometry, TurkeyProvinceProperties>;
type Theme = "light" | "dark";
type CoordinateMatch = {
  latitude: number;
  longitude: number;
  regionName: string | null;
  provinceNumber: number | null;
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

function colorForValue(
  value: number | undefined,
  min: number,
  max: number,
  theme: Theme,
) {
  if (!Number.isFinite(value)) {
    return themePathColors[theme].emptyFill;
  }

  const ratio = normalizeValue(value as number, min, max);
  const lightness = theme === "dark" ? 62 - ratio * 42 : 92 - ratio * 64;

  return `hsl(199 86% ${lightness}%)`;
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

export function TurkeyMap({ theme }: { theme: Theme }) {
  const [geoJson, setGeoJson] = useState<TurkeyGeoJson | null>(null);
  const [regionData, setRegionData] = useState<RegionValuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latitudeInput, setLatitudeInput] = useState("39");
  const [longitudeInput, setLongitudeInput] = useState("35");
  const [isMapPickEnabled, setIsMapPickEnabled] = useState(false);
  const [coordinateMatch, setCoordinateMatch] = useState<CoordinateMatch | null>(null);
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [selectedProvinceNumber, setSelectedProvinceNumber] = useState<number | null>(
    null,
  );

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
        fetchRegionValues(),
      ]);

      setGeoJson(nextGeoJson);
      setRegionData(nextRegionData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load map");
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const styleRegion = useCallback(
    (feature?: Feature<Geometry, TurkeyProvinceProperties>) => {
      const provinceNumber = feature?.properties?.number;
      const value =
        provinceNumber === undefined
          ? undefined
          : regionData?.values[String(provinceNumber)]?.value;

      return {
        ...baseStyle(theme),
        fillColor: colorForValue(value, valueRange.min, valueRange.max, theme),
        ...(provinceNumber === selectedProvinceNumber ? selectedStyle(theme) : {}),
      };
    },
    [regionData, selectedProvinceNumber, theme, valueRange],
  );

  const onEachFeature = useCallback(
    (feature: Feature<Geometry, TurkeyProvinceProperties>, layer: Layer) => {
      const provinceNumber = String(feature.properties.number);
      const value = regionData?.values[provinceNumber]?.value;

      layer.bindTooltip(
        `
          <strong>${feature.properties.name}</strong><br>
          Province: ${provinceNumber}<br>
          Value: ${Number.isFinite(value) ? value : "No data"}
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
          setSelectedProvinceNumber(feature.properties.number);

          if ("bringToFront" in layer) {
            (layer as Path).bringToFront();
          }
        },
      });
    },
    [regionData, selectedProvinceNumber, styleRegion, theme],
  );

  const updatedAt = regionData?.updated_at
    ? new Date(regionData.updated_at).toLocaleString()
    : "Loading data...";

  const updateCoordinateMatch = useCallback((latitude: number, longitude: number) => {
    const matchingFeature = geoJson?.features.find((feature) =>
      featureContainsPoint(feature, longitude, latitude),
    );

    setCoordinateError(null);
    setCoordinateMatch({
      latitude,
      longitude,
      regionName: matchingFeature?.properties.name ?? null,
      provinceNumber: matchingFeature?.properties.number ?? null,
    });
  }, [geoJson]);

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
      setCoordinateMatch(null);
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
    setCoordinateMatch(null);
    setCoordinateError(null);
    setSelectedProvinceNumber(null);
    void loadData();
  }

  return (
    <section className="map-card">
      <div className="map-toolbar">
        <div>
          <h1>Turkey demand map</h1>
          <p>{error ?? `Updated: ${updatedAt}`}</p>
        </div>
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
        <button type="button" onClick={refreshData}>
          Refresh
        </button>
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
                key={`${regionData?.updated_at ?? "initial"}-${selectedProvinceNumber ?? "none"}`}
                data={geoJson}
                style={styleRegion}
                onEachFeature={onEachFeature}
              />
            ) : null}
          </Pane>
          <Pane name="marker-pane" style={{ zIndex: 450 }}>
            {coordinateMatch ? (
              <CircleMarker
                center={[coordinateMatch.latitude, coordinateMatch.longitude]}
                pathOptions={{
                  color: theme === "dark" ? "#f8fafc" : "#111827",
                  fillColor: "#ef4444",
                  fillOpacity: 1,
                  weight: 2,
                }}
                radius={7}
              />
            ) : null}
          </Pane>
        </MapContainer>
      </div>
    </section>
  );
}
