/**
 * Game state: the bridge between the pure engine and the DOM.
 *
 * Holds one level in progress — what the player has placed, what is left in the
 * tray, and how far the run animation has got. Knows nothing about canvas or
 * elements.
 */
import { Level, Light, Tile, TileKind } from "../engine/types";
import { SimResult, Outcome, cycleLength, evaluate, simulate } from "../engine/simulate";
import { poolKey } from "../engine/solver";

export type Phase = "build" | "running" | "won" | "lost";

export interface TraySlot {
  key: string;
  kind: TileKind;
  mask?: Light;
  total: number;
  used: number;
}

export class Game {
  level!: Level;
  board!: Tile[];
  tray: TraySlot[] = [];
  selected = 0;
  phase: Phase = "build";

  sim: SimResult | null = null;
  tick = 0;
  reveal = 0;
  starsLit = new Set<number>();
  outcome: Outcome | null = null;
  hint = new Set<number>();
  /** Runs used on this level, for the score. */
  attempts = 0;

  constructor(level: Level) {
    this.load(level);
  }

  load(level: Level) {
    this.level = level;
    this.board = level.tiles.map((t) => ({ ...t }));
    this.tray = [];
    const seen = new Map<string, TraySlot>();
    for (const it of level.inventory) {
      const key = poolKey(it.kind, it.mask);
      const e = seen.get(key);
      if (e) { e.total += it.count; continue; }
      const slot: TraySlot = {
        key,
        // Mirrors are pooled, so the slot shows one orientation and the player
        // rotates it in place after dropping it.
        kind: key === "mirror" ? "mirrorB" : it.kind,
        mask: it.mask,
        total: it.count,
        used: 0,
      };
      seen.set(key, slot);
      this.tray.push(slot);
    }
    this.selected = 0;
    this.reset(false);
  }

  reset(countAttempt = true) {
    if (countAttempt) this.attempts++;
    this.board = this.level.tiles.map((t) => ({ ...t }));
    for (const s of this.tray) s.used = 0;
    this.phase = "build";
    this.sim = null;
    this.tick = 0;
    this.reveal = 0;
    this.starsLit.clear();
    this.outcome = null;
    this.hint.clear();
  }

  slotFor(kind: TileKind, mask?: Light): TraySlot | undefined {
    const key = poolKey(kind, mask);
    return this.tray.find((s) => s.key === key);
  }

  get remaining(): number {
    return this.tray.reduce((n, s) => n + (s.total - s.used), 0);
  }

  /**
   * A tap on a cell.
   *
   * Empty cell  -> place the selected piece.
   * Your mirror -> flip its orientation (free: both orientations share a pool).
   * Your piece  -> pick it back up.
   * Level piece -> nothing; the level's own furniture is fixed.
   */
  tap(i: number): "placed" | "rotated" | "removed" | "none" {
    if (this.phase === "running") return "none";
    if (this.phase === "won") return "none";
    const t = this.board[i];

    if (t.placed) {
      if (t.kind === "mirrorB") { this.board[i] = { ...t, kind: "mirrorA" }; return "rotated"; }
      if (t.kind === "mirrorA") { this.board[i] = { ...t, kind: "mirrorB" }; return "rotated"; }
      const slot = this.slotFor(t.kind, t.mask);
      if (slot) slot.used--;
      this.board[i] = { kind: "empty" };
      this.invalidate();
      return "removed";
    }

    if (t.kind !== "empty") return "none";

    const slot = this.tray[this.selected];
    if (!slot || slot.used >= slot.total) {
      const next = this.tray.findIndex((s) => s.used < s.total);
      if (next < 0) return "none";
      this.selected = next;
      return this.tap(i);
    }

    this.board[i] = { kind: slot.kind, mask: slot.mask, placed: true };
    slot.used++;
    this.invalidate();
    return "placed";
  }

  private invalidate() {
    this.sim = null;
    this.reveal = 0;
    this.phase = "build";
    this.outcome = null;
    this.starsLit.clear();
    this.hint.clear();
  }

  /** The level as the engine sees it right now. */
  current(): Level {
    return { ...this.level, tiles: this.board };
  }

  /** Start a run. Returns the outcome immediately; the animation catches up. */
  start(): Outcome {
    this.attempts++;
    this.phase = "running";
    this.reveal = 0;
    this.tick = 0;
    this.starsLit.clear();
    this.hint.clear();
    const lv = this.current();
    this.outcome = evaluate(lv);
    // Show the winning tick if there is one, so the player sees the moment it
    // works rather than an arbitrary frame of the cycle.
    this.tick = this.outcome.winTick >= 0 ? this.outcome.winTick : 0;
    this.sim = simulate(lv, this.tick);
    return this.outcome;
  }

  /** Advance the reveal animation. `dt` in seconds. Returns true when settled. */
  advance(dt: number): boolean {
    if (this.phase !== "running" || !this.sim) return true;
    const hops = Math.max(1, Math.max(...this.sim.segments.map((s) => s.order), 1));
    // Constant speed in hops/second, so long paths take longer — the original's
    // travelling-ball pacing, which is most of its charm.
    this.reveal += (dt * 9) / (hops + 1);

    for (const s of this.sim.starsLit) {
      const seg = this.sim.segments.find((g) => g.x1 + g.y1 * this.level.w === s);
      if (!seg || seg.order <= this.reveal * (hops + 1)) this.starsLit.add(s);
    }

    if (this.reveal >= 1.15) {
      this.reveal = 1.15;
      this.phase = this.outcome?.won ? "won" : "lost";
      if (this.outcome) for (const s of this.outcome.starsLit) this.starsLit.add(s);
      return true;
    }
    return false;
  }

  /** Reveal one piece of the known solution that is not already correct. */
  takeHint(): boolean {
    const sol = this.level.solution;
    if (!sol?.length) return false;
    for (const p of sol) {
      const cur = this.board[p.i];
      const ok = cur.kind === p.kind || (isMirror(cur.kind) && isMirror(p.kind));
      if (!ok) { this.hint.add(p.i); return true; }
    }
    // Everything is in the right place already — nudge the orientations.
    for (const p of sol) if (this.board[p.i].kind !== p.kind) { this.hint.add(p.i); return true; }
    return false;
  }

  /** Stars earned: one for solving, plus the collectibles banked. */
  score(): { solved: boolean; stars: number; totalStars: number; par: number; used: number } {
    const used = this.tray.reduce((n, s) => n + s.used, 0);
    return {
      solved: this.phase === "won",
      stars: this.outcome?.starsLit.size ?? 0,
      totalStars: this.outcome?.totalStars ?? 0,
      par: this.level.par ?? 0,
      used,
    };
  }

  cycle(): number {
    return cycleLength(this.level);
  }
}

const isMirror = (k: TileKind) => k === "mirrorA" || k === "mirrorB";

// ---------------------------------------------------------------- progress

const KEY = "moonbeam.progress.v1";

export interface Progress {
  /** Highest campaign night unlocked. */
  unlocked: number;
  /** night -> stars collected. */
  stars: Record<number, number>;
  runSeed: number;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (typeof p.unlocked === "number") {
        // Fill in fields added after this save was written.
        return {
          unlocked: p.unlocked,
          stars: p.stars ?? {},
          runSeed: p.runSeed ?? 1,
        };
      }
    }
  } catch { /* private mode, cleared storage, blocked cookies — fall through */ }
  return { unlocked: 1, stars: {}, runSeed: 1 };
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* nothing we can do */ }
}
