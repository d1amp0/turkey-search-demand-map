import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import type { Layer, Path, PathOptions } from "leaflet";
import { GeoJSON as LeafletGeoJSON, MapContainer, useMap } from "react-leaflet";
import { fetchRegionValues, fetchTurkeyGeoJson } from "../api/client";
import type {
  RegionValuesResponse,
  TurkeyProvinceProperties,
} from "../types/region";

type TurkeyGeoJson = FeatureCollection<Geometry, TurkeyProvinceProperties>;
type Theme = "light" | "dark";

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

function BoundsController({ data }: { data: TurkeyGeoJson | null }) {
  const map = useMap();

  useEffect(() => {
    if (!data) {
      return;
    }

    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    const zoom = map.getBoundsZoom(bounds, false, L.point(2, 2));

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

export function TurkeyMap({ theme }: { theme: Theme }) {
  const [geoJson, setGeoJson] = useState<TurkeyGeoJson | null>(null);
  const [regionData, setRegionData] = useState<RegionValuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      };
    },
    [regionData, theme, valueRange],
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
            (layer as Path).setStyle(highlightStyle(theme));
          }
        },
      });
    },
    [regionData, styleRegion, theme],
  );

  const updatedAt = regionData?.updated_at
    ? new Date(regionData.updated_at).toLocaleString()
    : "Loading data...";

  return (
    <section className="map-card">
      <div className="map-toolbar">
        <div>
          <h1>Turkey demand map</h1>
          <p>{error ?? `Updated: ${updatedAt}`}</p>
        </div>
        <button type="button" onClick={loadData}>
          Refresh
        </button>
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
          {geoJson ? (
            <LeafletGeoJSON
              key={regionData?.updated_at ?? "initial"}
              data={geoJson}
              style={styleRegion}
              onEachFeature={onEachFeature}
            />
          ) : null}
        </MapContainer>
      </div>
    </section>
  );
}
