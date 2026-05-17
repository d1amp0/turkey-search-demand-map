export type HeatmapPalette =
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "greenRed"
  | "tealGold"
  | "custom";

export type HeatmapPaletteConfig = {
  accent: string;
  endColor?: string;
  hue?: number;
  label: string;
  mode: "hue" | "gradient" | "custom";
  saturation?: number;
  startColor?: string;
};

export const heatmapPalettes: Record<HeatmapPalette, HeatmapPaletteConfig> = {
  blue: {
    accent: "#0284c7",
    hue: 199,
    label: "Blue",
    mode: "hue",
    saturation: 86,
  },
  green: {
    accent: "#16a34a",
    hue: 151,
    label: "Green",
    mode: "hue",
    saturation: 72,
  },
  orange: {
    accent: "#ea580c",
    hue: 32,
    label: "Orange",
    mode: "hue",
    saturation: 92,
  },
  purple: {
    accent: "#7c3aed",
    hue: 267,
    label: "Purple",
    mode: "hue",
    saturation: 78,
  },
  greenRed: {
    accent: "#dc2626",
    endColor: "#dc2626",
    label: "Green-red",
    mode: "gradient",
    startColor: "#16a34a",
  },
  tealGold: {
    accent: "#ca8a04",
    endColor: "#ca8a04",
    label: "Teal-gold",
    mode: "gradient",
    startColor: "#0f766e",
  },
  custom: {
    accent: "#0284c7",
    label: "Custom",
    mode: "custom",
  },
};
