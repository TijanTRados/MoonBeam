/**
 * The daily puzzle.
 *
 * Everyone gets the same board on the same day, and nothing is stored or
 * served: the puzzle number is the date, and the date is the seed. Difficulty
 * follows the week like a newspaper crossword — gentle on Monday, hardest on
 * Saturday, a generous Sunday — and the moon waxes through the week to match.
 *
 * Pure, apart from reading the clock in `todayNumber`.
 */
import { Level } from "../engine/types";
import { generateLevel, GenResult } from "../engine/generate";
import { Features, PHASES, PhaseKey, defaultFeatures } from "../engine/phases";

/** Puzzle #1 was this day. */
const EPOCH = Date.UTC(2026, 9, 1);   // 1 October 2026
const DAY = 86_400_000;

/** The puzzle number for a calendar day, in the player's own time zone. */
export function dailyNumber(d: Date): number {
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((local - EPOCH) / DAY) + 1;
}

export const todayNumber = () => dailyNumber(new Date());

/** The calendar day of a puzzle, for display. */
export function dailyDate(n: number): Date {
  const t = EPOCH + (n - 1) * DAY;
  const u = new Date(t);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/** Day of the week a puzzle falls on, Monday = 0. */
export function weekday(n: number): number {
  return (dailyDate(n).getDay() + 6) % 7;
}

const WEEK_DIFFICULTY = [2.2, 2.6, 3.0, 3.4, 3.8, 4.3, 3.6];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dailyDifficulty(n: number): number {
  return WEEK_DIFFICULTY[weekday(n)];
}

/** Monday's moon is a thin crescent; Sunday's is full. */
export function dailyMoon(n: number): number {
  return 0.12 + (0.88 * weekday(n)) / 6;
}

/** Each day borrows a world's sky and song, in turn. */
export function dailyWorld(n: number): PhaseKey {
  return PHASES[((n - 1) % PHASES.length + PHASES.length) % PHASES.length].key;
}

/**
 * Everything is allowed on a daily: the difficulty's own gates decide what
 * actually turns up, so a Saturday can be anything and a Monday stays simple.
 */
const ALL: Features = (() => {
  const f = defaultFeatures(10);
  for (const k of Object.keys(f) as (keyof Features)[]) f[k] = true;
  return f;
})();

/** A seed that has nothing to do with campaign seeds, so dailies never repeat a night. */
function dailySeed(n: number): number {
  let h = (n * 0x9e3779b1) ^ 0x6d2b79f5;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function generateDaily(n: number): GenResult {
  return generateLevel(dailySeed(n), {
    difficulty: dailyDifficulty(n),
    name: `Daily #${n}`,
    tolerance: 0.7,
    features: ALL,
  });
}

/**
 * A fingerprint of a level's layout. The leaderboard server regenerates the
 * same puzzle and compares fingerprints, so a client whose generator has
 * drifted (an old version, a different engine) is caught rather than scored
 * against the wrong board.
 */
export function levelHash(l: Level): string {
  const parts = [l.w, l.h, JSON.stringify(l.emitters), JSON.stringify(l.inventory),
    JSON.stringify(l.warps ?? []), JSON.stringify(l.galaxy ?? []),
    ...l.tiles.map((t) => `${t.kind}${t.mask ?? ""}.${t.from ?? ""}.${t.pair ?? ""}.${t.seq ?? ""}.${t.delay ?? ""}.${(t.track ?? []).map((p) => `${p.x},${p.y}`).join(";")}.${t.phase ?? ""}`)];
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- results

export interface DailyResult {
  points: number;
  used: number;
  fewest: number;
  seconds: number;
  /** Shines that did not solve it, before the one that did. */
  misses: number;
  assisted: boolean;
}

/** Streak after solving puzzle `n`, given the last puzzle solved before it. */
export function nextStreak(streak: number, last: number, n: number): number {
  if (last === n) return streak;
  return last === n - 1 ? streak + 1 : 1;
}

/** The streak as it stands today: it lapses once a whole day is missed. */
export function liveStreak(streak: number, last: number, today: number): number {
  return last >= today - 1 ? streak : 0;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The share card: no board, no spoilers. Each Shine is a moon — dark for a
 * miss, full for the solve — so a friend can see how it went at a glance.
 */
export function shareText(n: number, r: DailyResult, streak: number, url: string): string {
  const moons = "🌑".repeat(Math.min(r.misses, 8)) + (r.misses > 8 ? `+${r.misses - 8}` : "") + "🌕";
  const pieces = r.used <= r.fewest ? `${r.used} piece${r.used === 1 ? "" : "s"} (fewest!)`
    : `${r.used} pieces (fewest ${r.fewest})`;
  const lines = [
    `MoonBeam Daily #${n} ☾ ${WEEKDAY_NAMES[weekday(n)]}`,
    `${moons}${r.assisted ? " 🔭" : ""}`,
    `✦ ${r.points} · ${pieces} · ${formatTime(r.seconds)}`,
  ];
  if (streak >= 2) lines.push(`🔥 ${streak}-day streak`);
  lines.push(url);
  return lines.join("\n");
}
