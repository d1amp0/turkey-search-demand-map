export type HeatmapPalette =
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "redGreen";

export type HeatmapPaletteConfig = {
  accent: string;
  endColor?: string;
  hue?: number;
  label: string;
  mode: "hue" | "gradient";
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
  redGreen: {
    accent: "#16a34a",
    endColor: "#16a34a",
    label: "Red-green",
    mode: "gradient",
    startColor: "#dc2626",
  },
};
