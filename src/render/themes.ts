/**
 * The look of each phase: its sky, its planet, and the constellations over it.
 *
 * The constellations are the real ones, simplified to their main stars and
 * scaled into a unit box. Each phase picks two that suit it — Scorpius over
 * Mars, because its brightest star Antares is named "rival of Mars".
 */
import type { PhaseKey } from "../engine/phases";

export interface Constellation {
  name: string;
  stars: [number, number][];
  lines: [number, number][];
}

export const CONSTELLATIONS: Record<string, Constellation> = {
  plough: {
    name: "The Plough",
    stars: [[0, 0.12], [0.02, 0.38], [0.3, 0.45], [0.34, 0.22], [0.55, 0.16], [0.76, 0.1], [1, 0.26]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
  },
  cassiopeia: {
    name: "Cassiopeia",
    stars: [[0, 0.3], [0.25, 0.72], [0.5, 0.36], [0.75, 0.78], [1, 0.22]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  orion: {
    name: "Orion",
    stars: [[0.2, 0.08], [0.76, 0.14], [0.38, 0.5], [0.5, 0.47], [0.62, 0.44], [0.28, 0.92], [0.82, 0.86]],
    lines: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  cygnus: {
    name: "Cygnus",
    stars: [[0.5, 0], [0.5, 0.4], [0.5, 1], [0.08, 0.34], [0.92, 0.46]],
    lines: [[0, 1], [1, 2], [3, 1], [1, 4]],
  },
  lyra: {
    name: "Lyra",
    stars: [[0.3, 0], [0.45, 0.3], [0.72, 0.36], [0.62, 0.84], [0.36, 0.78]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]],
  },
  scorpius: {
    name: "Scorpius",
    stars: [[0.02, 0.02], [0.14, 0.18], [0.27, 0.34], [0.4, 0.5], [0.5, 0.66], [0.63, 0.82], [0.79, 0.9], [0.93, 0.82], [0.99, 0.66], [0, 0.26]],
    lines: [[0, 1], [9, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
  },
  leo: {
    name: "Leo",
    stars: [[0.2, 0.82], [0.15, 0.56], [0.26, 0.36], [0.42, 0.3], [0.46, 0.48], [0.7, 0.56], [1, 0.72], [0.74, 0.88]],
    lines: [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
  },
  crux: {
    name: "The Southern Cross",
    stars: [[0.5, 0], [0.5, 1], [0.12, 0.44], [0.86, 0.56]],
    lines: [[0, 1], [2, 3]],
  },
};

export interface PlanetLook {
  /** Base, shadow and highlight colours. */
  body: [string, string, string];
  kind: "earth" | "venus" | "mercury" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune" | "blackhole";
}

export interface Theme {
  /** Sky gradient: near the moon, middle, and edges. */
  sky: [string, string, string];
  /** Two nebula tints. */
  nebula: [string, string];
  planet: PlanetLook;
  constellations: string[];
  /** Colour of rough ground on this world. */
  terrain: [string, string];
}

export const THEMES: Record<PhaseKey, Theme> = {
  earth: {
    sky: ["#231a4d", "#1a1438", "#120e26"], nebula: ["#6b3fa0", "#2f6f8f"],
    planet: { kind: "earth", body: ["#6fb3ff", "#123a6b", "#7fe0a0"] },
    constellations: ["plough", "cassiopeia"],
    terrain: ["#3a3060", "#4b4080"],
  },
  venus: {
    sky: ["#4a2238", "#321629", "#1e0d1a"], nebula: ["#b0506a", "#c08a3a"],
    planet: { kind: "venus", body: ["#ffe2a8", "#8a5a2a", "#fff3d0"] },
    constellations: ["lyra", "cygnus"],
    terrain: ["#5a2e3a", "#7a4450"],
  },
  mercury: {
    sky: ["#3a2230", "#261622", "#170d15"], nebula: ["#c0603a", "#7a4a8a"],
    planet: { kind: "mercury", body: ["#c9c2bb", "#4a4440", "#e6e0da"] },
    constellations: ["leo", "orion"],
    terrain: ["#4a3a3a", "#6a5450"],
  },
  mars: {
    sky: ["#3d1a1e", "#2a1014", "#18080b"], nebula: ["#b0402a", "#6a2a5a"],
    planet: { kind: "mars", body: ["#ff8a5c", "#6a2210", "#ffe0d0"] },
    constellations: ["scorpius", "orion"],
    terrain: ["#6a2a22", "#8a3c2e"],
  },
  jupiter: {
    sky: ["#352818", "#241a10", "#150f09"], nebula: ["#a07040", "#5a4a8a"],
    planet: { kind: "jupiter", body: ["#f0c89a", "#6a4020", "#c86a4a"] },
    constellations: ["leo", "plough"],
    terrain: ["#4a3822", "#6a5030"],
  },
  saturn: {
    sky: ["#1f2e32", "#152226", "#0c1517"], nebula: ["#3a8a8a", "#a0904a"],
    planet: { kind: "saturn", body: ["#f5dfa0", "#7a6030", "#e8d0f0"] },
    constellations: ["cygnus", "lyra"],
    terrain: ["#2e4448", "#446066"],
  },
  uranus: {
    sky: ["#173a44", "#0f2830", "#08181d"], nebula: ["#3ab0b0", "#7a6ad0"],
    planet: { kind: "uranus", body: ["#b8f2f2", "#2a6a7a", "#e0ffff"] },
    constellations: ["cassiopeia", "crux"],
    terrain: ["#1e4a52", "#2e6670"],
  },
  neptune: {
    sky: ["#16275a", "#0d1a40", "#060d26"], nebula: ["#3a5ad0", "#2a9ab0"],
    planet: { kind: "neptune", body: ["#6a9aff", "#0e2a7a", "#a0c8ff"] },
    constellations: ["orion", "crux"],
    terrain: ["#1a2a5a", "#2a3e7a"],
  },
  blackhole: {
    sky: ["#150a24", "#0b0614", "#040208"], nebula: ["#6a2a9a", "#a04a2a"],
    planet: { kind: "blackhole", body: ["#ffd08a", "#1a0a2a", "#ff9a5a"] },
    constellations: ["scorpius", "cygnus"],
    terrain: ["#1e1230", "#2e1e48"],
  },
};

export const DEFAULT_THEME = THEMES.earth;
