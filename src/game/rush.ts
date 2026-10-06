/**
 * Moon Rush: as many nights as you can before the moon sets.
 *
 * The clock starts at ninety seconds. Every solve puts time back — more for
 * a puzzle with more pieces — and brings a harder one; skipping costs time.
 * Hints and boosters stay at home. The puzzles climb the campaign's worlds,
 * three nights' worth of difficulty per step, so a long run meets most of
 * the game's elements on the way.
 *
 * Like the daily, the sequence is the same for everyone on the same day and
 * nothing is stored: puzzle k of day n is a pure function of (n, k).
 */
import { generateLevel, GenResult } from "../engine/generate";
import { nightDifficulty, phaseFor, PhaseKey } from "../engine/phases";
import { formatTime } from "./daily";

export const RUSH_START = 90;
export const RUSH_SKIP = 20;

/** The campaign night a rush puzzle borrows its difficulty and elements from. */
export const rushNight = (k: number) => Math.min(90, 3 * k);

export function rushWorld(k: number): PhaseKey {
  return phaseFor(rushNight(k)).phase.key;
}

function rushSeed(day: number, k: number): number {
  let h = Math.imul(day, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca6b) ^ 0x2c1b3c6d;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function rushLevel(day: number, k: number): GenResult {
  const n = rushNight(k);
  return generateLevel(rushSeed(day, k), {
    difficulty: nightDifficulty(n),
    name: `Rush ${k}`,
    tolerance: 0.8,
    features: phaseFor(n).phase.features,
  });
}

/** Seconds a solve puts back on the clock. */
export function rushReward(fewest: number): number {
  return 15 + 10 * Math.max(1, fewest);
}

export interface RushResult { solved: number; points: number }

export function rushShare(day: number, r: RushResult, url: string): string {
  const moons = r.solved ? "🌕".repeat(Math.min(r.solved, 12)) + (r.solved > 12 ? `+${r.solved - 12}` : "") : "🌑";
  return [
    `MoonBeam Moon Rush · day ${day} 🏃‍♀️☾`,
    moons,
    `${r.solved} night${r.solved === 1 ? "" : "s"} · ✦ ${r.points}`,
    url,
  ].join("\n");
}

export { formatTime };
