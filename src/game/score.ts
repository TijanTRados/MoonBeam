/**
 * Points.
 *
 * Solving a night is the goal; points are how well you solved it. They reward
 * routing light across the Milky Way, past stars and through every piece of a
 * shooting star; they punish smashing it into asteroids, and using more pieces
 * than the level needs. A second puzzle layered on the first.
 *
 * Everything here is pure, and the reveal tallies points from the same
 * `segmentPoints` and constants the final score uses, so the counter that ticks
 * up while the beam travels always lands exactly on the total.
 */
import { Level } from "../engine/types";
import { SimResult, Segment } from "../engine/simulate";

export const POINTS = {
  /** Each cell of board the light crosses. */
  hop: 2,
  /** Each cell crossed inside the Milky Way. */
  galaxyHop: 10,
  star: 50,
  ring: 100,
  asteroid: -60,
  /** Each piece of a shooting star, collected in its turn. */
  comet: 40,
  /** Catching the whole shooting star. */
  cometComplete: 100,
  /** Using exactly the fewest pieces the level can be solved with. */
  fewest: 50,
  /** Per piece fewer than the fewest we found — it happens, when the search gave up early. */
  fewerThanFound: 60,
  /** Per piece beyond the fewest. */
  extraPiece: -30,
  firstTry: 50,
  /** Per second left on the clock when the night is solved. */
  timeLeft: 2,
} as const;

/**
 * How long the moon stays up: a night's time limit, in seconds.
 *
 * Generous on purpose — it is there to make a quick solve feel good, not to
 * make a slow one feel bad. Missing it costs only the time bonus, never the
 * night. It grows with what there is to do: pieces that must be right, and
 * the rated difficulty, which carries everything else.
 */
export function timeLimit(level: { par?: number; difficulty?: number }): number {
  const pieces = Math.max(1, level.par ?? 1);
  const d = Math.max(1, level.difficulty ?? 1);
  return Math.round((40 + 20 * pieces + 8 * d) / 5) * 5;
}

/** Points for one hop of light: nothing for jumps or light leaving the board. */
export function segmentPoints(level: Level, s: Segment, galaxy: Set<number>): number {
  if (s.warp || s.carry) return 0;
  if (s.x1 < 0 || s.y1 < 0 || s.x1 >= level.w || s.y1 >= level.h) return 0;
  return galaxy.has(s.y1 * level.w + s.x1) ? POINTS.galaxyHop : POINTS.hop;
}

export interface RunScore {
  hops: number;
  galaxyHops: number;
  stars: number;
  rings: number;
  asteroids: number;
  comets: number;
  cometComplete: boolean;
  /** Points from the run itself, before the card's bonuses. */
  total: number;
}

export function scoreRun(level: Level, sim: SimResult): RunScore {
  const galaxy = new Set(level.galaxy ?? []);
  let hops = 0, galaxyHops = 0, total = 0;
  for (const s of sim.segments) {
    const p = segmentPoints(level, s, galaxy);
    if (p === POINTS.galaxyHop) galaxyHops++;
    else if (p === POINTS.hop) hops++;
    total += p;
  }
  const stars = sim.starsLit.size;
  const rings = sim.satisfied.size;
  const asteroids = sim.asteroidsHit.size;
  const comets = sim.cometHits.length;
  const cometComplete = sim.cometTotal > 0 && comets === sim.cometTotal;
  total += stars * POINTS.star + rings * POINTS.ring + asteroids * POINTS.asteroid
    + comets * POINTS.comet + (cometComplete ? POINTS.cometComplete : 0);
  return { hops, galaxyHops, stars, rings, asteroids, comets, cometComplete, total };
}

export interface Bonus { label: string; points: number }

/**
 * The card's bonuses and penalties, on top of the run's own points.
 *
 * `fewest` is the smallest number of pieces the level can be solved with —
 * what golfers would call par. Every piece beyond it costs points.
 */
export function bonuses(used: number, fewest: number, firstTry: boolean, secondsLeft = 0): Bonus[] {
  const out: Bonus[] = [];
  if (fewest > 0) {
    if (used < fewest) {
      out.push({ label: "Fewer than we found!", points: (fewest - used) * POINTS.fewerThanFound });
    } else if (used === fewest) {
      out.push({ label: "Fewest possible", points: POINTS.fewest });
    } else {
      const extra = used - fewest;
      out.push({ label: `${extra} extra piece${extra === 1 ? "" : "s"}`, points: extra * POINTS.extraPiece });
    }
  }
  if (firstTry) out.push({ label: "First try", points: POINTS.firstTry });
  const left = Math.floor(Math.max(0, secondsLeft));
  if (left > 0) out.push({ label: `Time bonus · ${left}s left`, points: left * POINTS.timeLeft });
  return out;
}
