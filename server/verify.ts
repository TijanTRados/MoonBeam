/**
 * Checking a submitted solve, without trusting anything the client says.
 *
 * The engine is deterministic and every puzzle is a pure function of its
 * number, so a client never sends a score — only *what it placed* and *when it
 * pressed Shine*. The server regenerates the same puzzle, checks the
 * placements are legal (right pieces, right counts, on cells that can be
 * built on), replays the shot with the very same simulator the game uses, and
 * computes the score itself. A faked score is not something you can send.
 *
 * Pure: no I/O, so the tests run it directly.
 */
import { Level, Light, TileKind, Tile, tileFrom } from "../src/engine/types";
import { cycleLength, simulate, wins } from "../src/engine/simulate";
import { generateCampaignLevel } from "../src/engine/generate";
import { poolKey } from "../src/engine/solver";
import { bonuses, scoreRun } from "../src/game/score";
import { dailyNumber, generateDaily, levelHash } from "../src/game/daily";
import { rushLevel } from "../src/game/rush";

export type BoardKind = "daily" | "night" | "rush";

export interface Placement { i: number; kind: TileKind; mask?: Light; from?: Light }

/** One solved puzzle: what was placed, and the moment the light was fired. */
export interface Solve {
  placements: Placement[];
  /** The tick of board time the light was fired at. */
  fireTick: number;
  /** The client's fingerprint of the board it played. */
  hash: string;
}

export interface Submission extends Partial<Solve> {
  /** Random id kept by the client; never shown to anyone else. */
  player: string;
  name: string;
  kind: BoardKind;
  /** Daily puzzle number, campaign night, or (rush) the day. */
  id: number;
  /** Seconds taken, used only to break ties. */
  seconds?: number;
  /** Moon Rush: every puzzle solved in the run, by its place in the day's sequence. */
  solves?: (Solve & { k: number })[];
}

export interface Verified {
  points: number;
  /** Pieces used — or, for a rush, puzzles solved. */
  used: number;
  fewest: number;
  seconds: number;
}

export type Verdict = { ok: true; result: Verified } | { ok: false; status: number; reason: string };

const MAX_NIGHT = 1000;
/** Nobody solves sixty in a rush; anything claiming more is not a person. */
const MAX_RUSH = 60;

const levelCache = new Map<string, Level>();

function cached(key: string, make: () => Level): Level {
  let l = levelCache.get(key);
  if (!l) {
    l = make();
    levelCache.set(key, l);
    // A small cache is plenty: today's daily, today's rush and a few nights are hot.
    if (levelCache.size > 160) levelCache.delete(levelCache.keys().next().value!);
  }
  return l;
}

/** The puzzle a board refers to, generated once and kept. */
export function levelFor(kind: "daily" | "night", id: number): Level {
  return cached(`${kind}:${id}`, () => (kind === "daily" ? generateDaily(id).level : generateCampaignLevel(id, 1).level));
}

export function rushLevelFor(day: number, k: number): Level {
  return cached(`rush:${day}:${k}`, () => rushLevel(day, k).level);
}

/**
 * Which days are open for scores right now. Time zones put players up to a
 * day either side of the server, so yesterday, today and tomorrow are all
 * someone's "today".
 */
export function openDailies(now: Date): number[] {
  const n = dailyNumber(now);
  return [n - 1, n, n + 1];
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 16) return null;
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) return null;
  return name;
}

const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;

type Checked = { ok: true; points: number; used: number; fewest: number } | { ok: false; status: number; reason: string };

/**
 * Replay one solve on its level: legal placements, a winning shot, and the
 * score it earns — the run's own points plus the piece-count bonus. First-try
 * and time bonuses can't be checked, so they are left out.
 */
export function checkSolve(level: Level, s: Partial<Solve>): Checked {
  const bad = (reason: string, status = 400): Checked => ({ ok: false, status, reason });
  if (!Array.isArray(s.placements) || s.placements.length > 40) return bad("bad placements");
  if (s.hash !== levelHash(level)) return bad("this puzzle doesn't match ours — update the game", 409);
  if (!isInt(s.fireTick, 0, 100_000)) return bad("bad moment");

  // Build the board exactly as the player had it.
  const tiles: Tile[] = level.tiles.map((t) => ({ ...t }));
  const blocked = new Set<number>();
  for (const t of level.tiles) for (const p of t.track ?? []) blocked.add(p.y * level.w + p.x);
  const left = new Map<string, number>();
  for (const it of level.inventory) {
    const k = poolKey(it.kind, it.mask, it.from);
    left.set(k, (left.get(k) ?? 0) + it.count);
  }
  const seen = new Set<number>();
  for (const p of s.placements) {
    if (!p || !isInt(p.i, 0, tiles.length - 1)) return bad("placement off the board");
    if (seen.has(p.i)) return bad("two pieces in one cell");
    seen.add(p.i);
    if (tiles[p.i].kind !== "empty" || blocked.has(p.i)) return bad("that cell can't be built on");
    const k = poolKey(p.kind, p.mask, p.from);
    const n = left.get(k) ?? 0;
    // Only what the tray offers, as many as it offers: level furniture never is.
    if (n <= 0) return bad("that piece isn't in the tray");
    left.set(k, n - 1);
    tiles[p.i] = tileFrom(p, true);
  }

  const played: Level = { ...level, tiles };
  const tick = s.fireTick % Math.max(1, cycleLength(played));
  const sim = simulate(played, tick);
  if (!wins(played, sim)) return bad("that doesn't solve it", 422);

  const used = s.placements.length;
  const fewest = level.par ?? used;
  const points = scoreRun(played, sim).total + bonuses(used, fewest, false).reduce((t, b) => t + b.points, 0);
  return { ok: true, points, used, fewest };
}

export function verify(sub: Submission, now = new Date()): Verdict {
  const bad = (reason: string, status = 400): Verdict => ({ ok: false, status, reason });

  if (typeof sub?.player !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(sub.player)) return bad("bad player id");
  if (!cleanName(sub.name)) return bad("names are 2-16 letters, numbers, spaces or _.'-");
  if (sub.kind !== "daily" && sub.kind !== "night" && sub.kind !== "rush") return bad("unknown board");
  if (sub.kind !== "night" && !openDailies(now).includes(sub.id)) return bad("that day is closed", 409);
  if (sub.kind === "night" && !isInt(sub.id, 1, MAX_NIGHT)) return bad("no such night");
  // Time only breaks ties, and is the one thing taken on trust: the server
  // can replay a solve, but not watch it being made.
  const seconds = isInt(sub.seconds, 0, 86_400 * 2) ? sub.seconds : 0;

  if (sub.kind === "rush") {
    // A rush is a list of solves, each replayed on its own puzzle. Puzzles
    // can be skipped, so the list need not be consecutive — but each one
    // only once, in order.
    if (!Array.isArray(sub.solves) || sub.solves.length === 0 || sub.solves.length > MAX_RUSH) return bad("bad run");
    let last = 0, points = 0;
    for (const s of sub.solves) {
      if (!s || !isInt(s.k, last + 1, MAX_RUSH * 3)) return bad("bad run order");
      last = s.k;
      const c = checkSolve(rushLevelFor(sub.id, s.k), s);
      if (!c.ok) return bad(`puzzle ${s.k}: ${c.reason}`, c.status);
      points += c.points;
    }
    return { ok: true, result: { points, used: sub.solves.length, fewest: 0, seconds } };
  }

  const c = checkSolve(levelFor(sub.kind, sub.id), sub);
  if (!c.ok) return bad(c.reason, c.status);
  return { ok: true, result: { points: c.points, used: c.used, fewest: c.fewest, seconds } };
}
