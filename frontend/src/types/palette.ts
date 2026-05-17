export type HeatmapPalette = "blue" | "green" | "orange" | "purple";

export const heatmapPalettes: Record<
  HeatmapPalette,
  {
    label: string;
    hue: number;
    saturation: number;
    accent: string;
  }
> = {
  blue: {
    label: "Blue",
    hue: 199,
    saturation: 86,
    accent: "#0284c7",
  },
  green: {
    label: "Green",
    hue: 151,
    saturation: 72,
    accent: "#16a34a",
  },
  orange: {
    label: "Orange",
    hue: 32,
    saturation: 92,
    accent: "#ea580c",
  },
  purple: {
    label: "Purple",
    hue: 267,
    saturation: 78,
    accent: "#7c3aed",
  },
};
