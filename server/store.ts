/**
 * Leaderboard storage: one JSON file, kept in memory, written atomically.
 *
 * The data is small — a few numbers per player per board — so a database
 * would be ceremony. Writes are debounced and go to a temporary file that is
 * renamed over the real one, so a crash mid-write never leaves half a file.
 *
 * What is stored: a random player id, the nickname they chose, and their best
 * result per board. No emails, no IP addresses, nothing else.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BoardKind, Verified } from "./verify";

export interface Entry extends Verified {
  at: number;   // when it was set, ms since epoch
}

interface Data {
  names: Record<string, string>;
  /** "daily:12" -> player -> best entry. */
  boards: Record<string, Record<string, Entry>>;
}

export interface Row {
  rank: number;
  name: string;
  points: number;
  used: number;
  fewest: number;
  seconds: number;
  you?: boolean;
}

/**
 * Better is: fewer pieces, then more points, then (dailies) less time, then
 * whoever got there first. Fewest pieces leads because it is the skill the
 * puzzle is about; points then reward style, and time only breaks ties.
 */
export function better(a: Entry, b: Entry): number {
  return a.used - b.used || b.points - a.points || a.seconds - b.seconds || a.at - b.at;
}

export class Store {
  private data: Data = { names: {}, boards: {} };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file: string | null) {
    if (!file) return;
    try {
      this.data = { names: {}, boards: {}, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch { /* no file yet: start empty */ }
  }

  /** Record a result; keeps only the player's best. Returns true if it improved. */
  submit(player: string, name: string, kind: BoardKind, id: number, r: Verified, now = Date.now()): boolean {
    this.data.names[player] = name;
    const key = `${kind}:${id}`;
    const board = this.data.boards[key] ??= {};
    const entry: Entry = { ...r, at: now };
    const old = board[player];
    const improved = !old || better(entry, old) < 0;
    if (improved) board[player] = entry;
    this.save();
    return improved;
  }

  /** The top of a board, plus where `player` stands if they are further down. */
  board(kind: BoardKind, id: number, player?: string, top = 50): { rows: Row[]; you?: Row; total: number } {
    const entries = Object.entries(this.data.boards[`${kind}:${id}`] ?? {}).sort((a, b) => better(a[1], b[1]));
    const row = ([p, e]: [string, Entry], k: number): Row => ({
      rank: k + 1, name: this.data.names[p] ?? "?", points: e.points, used: e.used,
      fewest: e.fewest, seconds: e.seconds, ...(p === player ? { you: true } : {}),
    });
    const rows = entries.slice(0, top).map(row);
    const at = player ? entries.findIndex(([p]) => p === player) : -1;
    return { rows, you: at >= 0 ? row(entries[at], at) : undefined, total: entries.length };
  }

  /**
   * The Moon ladder: every player's best points summed over every campaign
   * night. Rewards both going far and going back to polish.
   */
  ladder(player?: string, top = 50): { rows: { rank: number; name: string; points: number; nights: number; you?: boolean }[]; you?: { rank: number; name: string; points: number; nights: number }; total: number } {
    const sums = new Map<string, { points: number; nights: number }>();
    for (const [key, board] of Object.entries(this.data.boards)) {
      if (!key.startsWith("night:")) continue;
      for (const [p, e] of Object.entries(board)) {
        const s = sums.get(p) ?? { points: 0, nights: 0 };
        s.points += e.points;
        s.nights++;
        sums.set(p, s);
      }
    }
    const sorted = [...sums].sort((a, b) => b[1].points - a[1].points || b[1].nights - a[1].nights);
    const row = ([p, s]: [string, { points: number; nights: number }], k: number) => ({
      rank: k + 1, name: this.data.names[p] ?? "?", ...s, ...(p === player ? { you: true } : {}),
    });
    const at = player ? sorted.findIndex(([p]) => p === player) : -1;
    return { rows: sorted.slice(0, top).map(row), you: at >= 0 ? row(sorted[at], at) : undefined, total: sorted.length };
  }

  rename(player: string, name: string) {
    if (this.data.names[player] === undefined) return false;
    this.data.names[player] = name;
    this.save();
    return true;
  }

  /** Forget a player entirely. */
  forget(player: string) {
    delete this.data.names[player];
    for (const b of Object.values(this.data.boards)) delete b[player];
    this.save();
  }

  private save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
