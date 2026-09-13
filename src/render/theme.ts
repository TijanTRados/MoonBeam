/**
 * The look.
 *
 * A cozy late-night palette: deep indigo paper, warm cream moon, and light
 * that reads as soft rather than neon. The original was flat periwinkle with
 * white line art; this keeps that graphic simplicity but lights it from within.
 */
import { Chan, Light } from "../engine/types";

export const PALETTE = {
  nightDeep: "#120e26",
  nightMid: "#1a1438",
  nightSoft: "#231a4d",

  gridLine: "rgba(226, 216, 255, 0.13)",
  gridLineWarm: "rgba(255, 232, 184, 0.10)",
  cellFill: "rgba(255, 255, 255, 0.022)",
  cellHover: "rgba(200, 166, 255, 0.12)",

  moon: "#ffe6a8",
  moonGlow: "rgba(255, 226, 154, 0.42)",

  ink: "#ece5ff",
  inkDim: "#9c92c4",
  accent: "#c8a6ff",
  accentWarm: "#ffd07d",

  wall: "#2a2154",
  wallEdge: "#3d3170",
  star: "#ffd97d",
  starDim: "rgba(255, 217, 125, 0.30)",
} as const;

/**
 * Colour per light bitmask. Deliberately desaturated towards pastel — the
 * point is cozy, not arcade.
 */
export const LIGHT_COLOR: Record<number, string> = {
  [Chan.R]: "#ff7d9e",                       // rose
  [Chan.G]: "#86f0ae",                       // mint
  [Chan.B]: "#7cc4ff",                       // sky
  [Chan.R | Chan.G]: "#ffd484",              // amber
  [Chan.R | Chan.B]: "#f39bf0",              // orchid
  [Chan.G | Chan.B]: "#8ef0e4",              // aqua
  [Chan.R | Chan.G | Chan.B]: "#fff6e0",     // moonlight
};

export const lightColor = (l: Light) => LIGHT_COLOR[l] ?? PALETTE.inkDim;

/** Human-readable colour names, used in the tray and the receptor legend. */
export const LIGHT_LABEL: Record<number, string> = {
  1: "rose", 2: "mint", 3: "amber", 4: "sky", 5: "orchid", 6: "aqua", 7: "moonlight",
};

/** Convert "#rrggbb" to "rgba(r,g,b,a)". */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
