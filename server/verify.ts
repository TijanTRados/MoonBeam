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

export type BoardKind = "daily" | "night";

export interface Placement { i: number; kind: TileKind; mask?: Light; from?: Light }

export interface Submission {
  /** Random id kept by the client; never shown to anyone else. */
  player: string;
  name: string;
  kind: BoardKind;
  /** Daily puzzle number, or campaign night. */
  id: number;
  placements: Placement[];
  /** The tick of board time the light was fired at. */
  fireTick: number;
  /** Seconds taken — dailies only, used to break ties. */
  seconds?: number;
  /** The client's fingerprint of the board it played. */
  hash: string;
}

export interface Verified {
  points: number;
  used: number;
  fewest: number;
  seconds: number;
}

export type Verdict = { ok: true; result: Verified } | { ok: false; status: number; reason: string };

const MAX_NIGHT = 1000;

const levelCache = new Map<string, Level>();

/** The puzzle a board refers to, generated once and kept. */
export function levelFor(kind: BoardKind, id: number): Level {
  const key = `${kind}:${id}`;
  let l = levelCache.get(key);
  if (!l) {
    l = kind === "daily" ? generateDaily(id).level : generateCampaignLevel(id, 1).level;
    levelCache.set(key, l);
    // A small cache is plenty: today's daily and a handful of nights are hot.
    if (levelCache.size > 64) levelCache.delete(levelCache.keys().next().value!);
  }
  return l;
}

/**
 * Which daily puzzles are open for scores right now. Time zones put players up
 * to a day either side of the server, so yesterday, today and tomorrow are all
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

export function verify(sub: Submission, now = new Date()): Verdict {
  const bad = (reason: string, status = 400): Verdict => ({ ok: false, status, reason });

  if (typeof sub?.player !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(sub.player)) return bad("bad player id");
  if (!cleanName(sub.name)) return bad("names are 2-16 letters, numbers, spaces or _.'-");
  if (sub.kind !== "daily" && sub.kind !== "night") return bad("unknown board");
  if (sub.kind === "daily" && !openDailies(now).includes(sub.id)) return bad("that daily is closed", 409);
  if (sub.kind === "night" && !isInt(sub.id, 1, MAX_NIGHT)) return bad("no such night");
  if (!Array.isArray(sub.placements) || sub.placements.length > 40) return bad("bad placements");

  const level = levelFor(sub.kind, sub.id);
  if (sub.hash !== levelHash(level)) return bad("this puzzle doesn't match ours — update the game", 409);
  if (!isInt(sub.fireTick, 0, 100_000)) return bad("bad moment");

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
  for (const p of sub.placements) {
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
  const tick = sub.fireTick % Math.max(1, cycleLength(played));
  const sim = simulate(played, tick);
  if (!wins(played, sim)) return bad("that doesn't solve it", 422);

  const used = sub.placements.length;
  const fewest = level.par ?? used;
  // First-try is the one bonus that can't be checked, so the leaderboard
  // leaves it out: points are the run itself plus the piece-count bonus.
  const points = scoreRun(played, sim).total + bonuses(used, fewest, false).reduce((s, b) => s + b.points, 0);
  const seconds = sub.kind === "daily" && isInt(sub.seconds, 0, 86_400 * 2) ? sub.seconds : 0;
  return { ok: true, result: { points, used, fewest, seconds } };
}
