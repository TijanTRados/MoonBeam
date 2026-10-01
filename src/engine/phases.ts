/**
 * The campaign's phases: a journey from Earth out through the planets, ending
 * at a black hole.
 *
 * Each phase is ten nights. It decides which elements may appear at all, how
 * hard its nights ramp, and which new elements it introduces. A new element is
 * *required* on its introduction night — so the player meets exactly one new
 * idea at a time, with its explanation card, rather than whenever the dice say.
 *
 * Difficulty ramps up within a phase and steps back a little at the start of
 * the next: a new planet brings new rules, and the first nights there should
 * teach them rather than test them.
 *
 * Pure data. The look and the soundtrack of each phase live with the renderer
 * and the music, keyed by `key`.
 */

export interface Features {
  stars: boolean;
  splitters: boolean;
  galaxy: boolean;
  crystals: boolean;
  tints: boolean;
  comets: boolean;
  portals: boolean;
  terrain: boolean;
  warps: boolean;
  blackholes: boolean;
  combinedRings: boolean;
  asteroids: boolean;
  satellites: boolean;
  movingWalls: boolean;
}
export type Feature = keyof Features;

/**
 * The lowest difficulty at which each element can appear at all, in any phase.
 * Inside a phase that allows an element, it still waits for the ramp to reach
 * this — so Earth's first nights are mirrors and rings, and splitters turn up
 * towards the end of it.
 */
export const SOFT_GATE: Record<Feature, number> = {
  galaxy: 1.5, stars: 2, splitters: 2.5, crystals: 2.5, tints: 3, comets: 3,
  portals: 3.5, blackholes: 4, warps: 4, terrain: 4, combinedRings: 4.5,
  asteroids: 5, satellites: 5.5, movingWalls: 6,
};

/** Without a phase (tests, tools), what a difficulty allows by itself. */
export function defaultFeatures(d: number): Features {
  const gate: Record<Feature, number> = {
    galaxy: 1.5, stars: 3, splitters: 3, crystals: 4, tints: 5, comets: 4.5,
    portals: 6, blackholes: 6, warps: 4, terrain: 5, combinedRings: 6,
    asteroids: 5.5, satellites: 6.5, movingWalls: 7,
  };
  const f = {} as Features;
  for (const k of Object.keys(gate) as Feature[]) f[k] = d >= gate[k];
  return f;
}

export type PhaseKey =
  | "earth" | "venus" | "mercury" | "mars" | "jupiter"
  | "saturn" | "uranus" | "neptune" | "blackhole";

export interface Phase {
  key: PhaseKey;
  name: string;
  /** First and last night, inclusive. The black hole goes on forever. */
  first: number;
  last: number;
  dMin: number;
  dMax: number;
  /** What may appear here. */
  features: Features;
  /** New this phase, in the order they are introduced — one per night. */
  introduces: Feature[];
  blurb: string;
}

const none: Features = {
  stars: false, splitters: false, galaxy: false, crystals: false, tints: false,
  comets: false, portals: false, terrain: false, warps: false, blackholes: false,
  combinedRings: false, asteroids: false, satellites: false, movingWalls: false,
};
const plus = (base: Features, ...add: Feature[]): Features => {
  const f = { ...base };
  for (const k of add) f[k] = true;
  return f;
};

const EARTH = plus(none, "stars", "splitters", "galaxy");
const VENUS = plus(EARTH, "crystals", "tints");
const MERCURY = plus(VENUS, "comets", "portals");
const MARS = plus(MERCURY, "terrain", "warps", "blackholes", "combinedRings");
const JUPITER = plus(MARS, "asteroids");
const SATURN = plus(JUPITER, "satellites", "movingWalls");

export const PHASES: Phase[] = [
  { key: "earth", name: "Earth", first: 1, last: 10, dMin: 1, dMax: 3.5, features: EARTH,
    introduces: [], blurb: "Home. The moon, a few mirrors, and the rings it wants lit." },
  { key: "venus", name: "Venus", first: 11, last: 20, dMin: 2.5, dMax: 4.5, features: VENUS,
    introduces: ["crystals", "tints"], blurb: "Under the clouds, moonlight comes apart into colour." },
  { key: "mercury", name: "Mercury", first: 21, last: 30, dMin: 3.5, dMax: 5.5, features: MERCURY,
    introduces: ["comets", "portals"], blurb: "Close to the sun, shooting stars race and light leaps." },
  { key: "mars", name: "Mars", first: 31, last: 40, dMin: 4.5, dMax: 6.5, features: MARS,
    introduces: ["terrain", "warps", "blackholes"], blurb: "Rough red ground, and edges that fold round on themselves." },
  { key: "jupiter", name: "Jupiter", first: 41, last: 50, dMin: 5, dMax: 7, features: JUPITER,
    introduces: ["asteroids"], blurb: "The giant's asteroids drift through — now timing matters." },
  { key: "saturn", name: "Saturn", first: 51, last: 60, dMin: 6, dMax: 8, features: SATURN,
    introduces: ["satellites", "movingWalls"], blurb: "Satellites hold the light, and the rings keep moving." },
  { key: "uranus", name: "Uranus", first: 61, last: 70, dMin: 6.5, dMax: 8.5, features: SATURN,
    introduces: [], blurb: "Everything you know, tilted on its side." },
  { key: "neptune", name: "Neptune", first: 71, last: 80, dMin: 7.5, dMax: 9.5, features: SATURN,
    introduces: [], blurb: "The far blue edge. Deep puzzles in cold light." },
  { key: "blackhole", name: "The Black Hole", first: 81, last: Infinity, dMin: 8.5, dMax: 10, features: SATURN,
    introduces: [], blurb: "Where the light bends hardest. It never ends." },
];

export function phaseFor(night: number): { phase: Phase; index: number } {
  const n = Math.max(1, Math.floor(night));
  const phase = PHASES.find((p) => n >= p.first && n <= p.last) ?? PHASES[PHASES.length - 1];
  return { phase, index: n - phase.first };
}

/**
 * Target difficulty for a night: a ramp across its phase, with a small
 * sawtooth so the curve breathes instead of grinding monotonically upward.
 * Past night 90 the black hole simply stays at the top.
 */
export function nightDifficulty(night: number): number {
  const { phase, index } = phaseFor(night);
  const span = Math.min(9, phase.last - phase.first);
  const k = Math.min(1, index / Math.max(1, span));
  const breathe = ((night * 7) % 5) * 0.12 - 0.24;
  const d = phase.dMin + (phase.dMax - phase.dMin) * k + (index === 0 ? -0.3 : breathe);
  return Math.max(1, Math.min(10, d));
}

/** What a night must contain: its phase's new element, if it introduces one. */
export function nightRequires(night: number): Feature[] {
  const { phase, index } = phaseFor(night);
  const f = phase.introduces[index];
  return f ? [f] : [];
}
