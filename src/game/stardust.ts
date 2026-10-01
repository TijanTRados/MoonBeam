/**
 * Stardust: earned by solving, spent on boosters.
 *
 * Hints stay free — getting unstuck should never cost anything. Boosters are
 * conveniences on top: they do a step for you rather than point at it. Any of
 * them makes a solve "assisted", so it isn't ranked; stardust can buy your way
 * past a night, never up a leaderboard.
 */
import { Level } from "../engine/types";
import { cycleLength } from "../engine/simulate";

export type BoosterKey = "place" | "sweep" | "timing";

export interface Booster {
  key: BoosterKey;
  name: string;
  cost: number;
  blurb: string;
}

export const BOOSTERS: Booster[] = [
  { key: "place", name: "Place a piece", cost: 8, blurb: "Puts the next right piece down for you, the right way round." },
  { key: "sweep", name: "Sweep decoys", cost: 4, blurb: "Takes the pieces the solution doesn't need out of the tray." },
  { key: "timing", name: "Perfect timing", cost: 5, blurb: "Shine waits for a moment that works, when things are moving." },
];

/**
 * Stardust for a solve. Only a *first* solve of a night pays (so nothing can
 * be farmed), scaled gently by points; the daily pays a bonus that grows with
 * the streak, up to a week.
 */
export function earned(o: { first: boolean; points: number; daily: boolean; streak: number }): number {
  if (!o.first) return 0;
  const base = 2 + Math.floor(Math.max(0, o.points) / 80);
  return o.daily ? base + 3 + Math.min(7, Math.max(0, o.streak)) : base;
}

/** Can this booster do anything on this level right now? */
export function applicable(key: BoosterKey, level: Level, decoys: number, nextPiece: boolean): boolean {
  switch (key) {
    case "place": return nextPiece;
    case "sweep": return decoys > 0;
    case "timing": return cycleLength(level) > 1;
  }
}
