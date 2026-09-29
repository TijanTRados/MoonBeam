/**
 * Game state: the bridge between the pure engine and the DOM.
 *
 * Holds one level in progress — what the player has placed, what is left in the
 * tray, and how far the run animation has got. Knows nothing about canvas or
 * elements.
 */
import { Level, Light, Tile, TileKind } from "../engine/types";
import { SimResult, Outcome, evaluate, simulate } from "../engine/simulate";
import { poolKey } from "../engine/solver";

export type Phase = "build" | "running" | "won" | "lost";

/** What happened during one frame of the reveal. */
export interface RevealTick {
  /** The run has finished drawing. */
  settled: boolean;
  /** Cells the light reached this frame, in the order it reached them. */
  reached: number[];
  /** This is the frame the solution completed: fire the celebration. */
  climax: boolean;
  /** Time is slowed for the final approach. */
  slowMo: boolean;
  /** The first frame of the slow-down, so the riser starts exactly once. */
  slowMoStarted: boolean;
  /** Seconds the slow-down will last, for timing the riser. */
  slowMoSeconds: number;
}

export interface TraySlot {
  key: string;
  kind: TileKind;
  mask?: Light;
  /** For `tint`: the colour it converts from. */
  from?: Light;
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
  /** Times Shine has been pressed on this level. One means solved first try. */
  runs = 0;

  // Reveal bookkeeping, measured in hops from the moon rather than as a fraction,
  // so speed can be set in hops per second and the slow-down lands exactly.
  private front = 0;
  private maxOrder = 0;
  /** Cell -> first hop light reaches it. */
  private firstArrival = new Map<number, number>();
  /**
   * Cell -> last hop light reaches it. A ring that needs two converging beams is
   * only complete when the *later* one arrives, so rings fire on this.
   */
  private lastArrival = new Map<number, number>();
  /** The hop at which the final goal is met on a winning run, or -1. */
  private climaxAt = -1;
  private climaxFired = false;
  private slowMoOn = false;

  constructor(level: Level) {
    this.load(level);
  }

  load(level: Level) {
    this.level = level;
    this.board = level.tiles.map((t) => ({ ...t }));
    this.tray = [];
    const seen = new Map<string, TraySlot>();
    for (const it of level.inventory) {
      const key = poolKey(it.kind, it.mask, it.from);
      const e = seen.get(key);
      if (e) { e.total += it.count; continue; }
      const slot: TraySlot = {
        key,
        // Mirrors are pooled, so the slot shows one orientation and the player
        // rotates it in place after dropping it.
        kind: key === "mirror" ? "mirrorB" : it.kind,
        mask: it.mask,
        from: it.from,
        total: it.count,
        used: 0,
      };
      seen.set(key, slot);
      this.tray.push(slot);
    }
    this.selected = 0;
    this.runs = 0;
    this.reset();
  }

  reset() {
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

  slotFor(kind: TileKind, mask?: Light, from?: Light): TraySlot | undefined {
    const key = poolKey(kind, mask, from);
    return this.tray.find((s) => s.key === key);
  }

  get remaining(): number {
    return this.tray.reduce((n, s) => n + (s.total - s.used), 0);
  }

  /**
   * A tap on a cell.
   *
   * Empty cell  -> place the selected piece.
   * Your mirror -> flip it; a second tap takes it back.
   * Your piece  -> pick it back up.
   * Level piece -> nothing; the level's own furniture is fixed.
   *
   * Mirrors cycle "\" -> "/" -> gone rather than flipping forever. Flipping
   * forever left no way to pick a mirror back up: every tap just turned it
   * round again, and the only escape was clearing the whole board.
   */
  tap(i: number): "placed" | "rotated" | "removed" | "none" {
    if (this.phase === "running") return "none";
    if (this.phase === "won") return "none";
    const t = this.board[i];

    if (t.placed) {
      if (t.kind === "mirrorB") { this.board[i] = { ...t, kind: "mirrorA" }; this.invalidate(); return "rotated"; }
      const slot = this.slotFor(t.kind, t.mask, t.from);
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

    this.board[i] = { kind: slot.kind, mask: slot.mask, from: slot.from, placed: true };
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
    this.runs++;
    this.phase = "running";
    this.reveal = 0;
    this.front = 0;
    this.tick = 0;
    this.starsLit.clear();
    this.hint.clear();
    const lv = this.current();
    this.outcome = evaluate(lv);
    // Show the winning tick if there is one, so the player sees the moment it
    // works rather than an arbitrary frame of the cycle.
    this.tick = this.outcome.winTick >= 0 ? this.outcome.winTick : 0;
    this.sim = simulate(lv, this.tick);

    this.maxOrder = 0;
    this.firstArrival.clear();
    this.lastArrival.clear();
    for (const g of this.sim.segments) {
      if (g.order > this.maxOrder) this.maxOrder = g.order;
      if (g.x1 < 0 || g.y1 < 0 || g.x1 >= lv.w || g.y1 >= lv.h) continue;
      const i = g.y1 * lv.w + g.x1;
      const f = this.firstArrival.get(i);
      if (f === undefined || g.order < f) this.firstArrival.set(i, g.order);
      const l = this.lastArrival.get(i);
      if (l === undefined || g.order > l) this.lastArrival.set(i, g.order);
    }

    // On a winning run, the climax is whichever goal completes last: the final
    // ring to fill, or the final star to be touched.
    this.climaxAt = -1;
    this.climaxFired = false;
    this.slowMoOn = false;
    if (this.outcome.won) {
      for (const i of this.sim.satisfied) {
        this.climaxAt = Math.max(this.climaxAt, this.lastArrival.get(i) ?? 0);
      }
      for (const i of this.sim.starsLit) {
        this.climaxAt = Math.max(this.climaxAt, this.firstArrival.get(i) ?? 0);
      }
    }
    return this.outcome;
  }

  /** How far the light has travelled, in hops from the moon. */
  get frontHops(): number {
    return this.front;
  }

  /** Hops at which a beam runs off the edge of the board, for the dissolve sound. */
  exitOrders(): number[] {
    if (!this.sim) return [];
    const { w, h } = this.level;
    return this.sim.segments
      .filter((g) => !g.warp && (g.x1 < 0 || g.y1 < 0 || g.x1 >= w || g.y1 >= h))
      .map((g) => g.order);
  }

  /** The hop at which a cell's event fires: rings when full, everything else on first touch. */
  eventOrder(i: number): number | undefined {
    return this.board[i]?.kind === "receptor" ? this.lastArrival.get(i) : this.firstArrival.get(i);
  }

  /**
   * Advance the reveal animation by `dt` seconds.
   *
   * Pacing is where the excitement lives. The beam travels at a steady clip,
   * the original's travelling-ball feel, until on a winning run it is about to
   * complete the solution. Then time drops to a crawl for the last stretch, so
   * the player watches the light creep into the final ring, and snaps back to
   * double speed once the moment has landed.
   */
  advance(dt: number): RevealTick {
    const out: RevealTick = {
      settled: false, reached: [], climax: false,
      slowMo: false, slowMoStarted: false, slowMoSeconds: 0,
    };
    if (this.phase !== "running" || !this.sim) { out.settled = true; return out; }

    const span = this.maxOrder + 1;
    // Floored so a beam ricocheting round the whole grid still resolves in a
    // couple of seconds rather than twelve.
    const normal = Math.max(9, 0.45 * span);
    const SLOW = 1.5;     // hops per second on the final approach
    const WINDOW = 1.6;   // hops of slow motion before the climax

    let speed = normal;
    if (this.climaxAt >= 0 && !this.climaxFired &&
        this.front >= this.climaxAt - WINDOW && this.front < this.climaxAt) {
      speed = SLOW;
      out.slowMo = true;
      if (!this.slowMoOn) {
        this.slowMoOn = true;
        out.slowMoStarted = true;
        out.slowMoSeconds = (this.climaxAt - this.front) / SLOW;
      }
    } else if (this.climaxFired) {
      speed = normal * 2.2;
    }

    const prev = this.front;
    this.front += speed * dt;
    // Never overshoot the climax in one frame: land on it, so it fires on time.
    if (this.climaxAt >= 0 && !this.climaxFired && prev < this.climaxAt && this.front > this.climaxAt) {
      this.front = this.climaxAt;
    }
    this.reveal = this.front / span;

    const hits: [number, number][] = [];
    for (const i of this.firstArrival.keys()) {
      const at = this.eventOrder(i);
      if (at !== undefined && at > prev && at <= this.front) hits.push([at, i]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    out.reached = hits.map((h) => h[1]);

    for (const s of this.sim.starsLit) {
      if (this.front >= (this.firstArrival.get(s) ?? 0)) this.starsLit.add(s);
    }

    if (this.climaxAt >= 0 && !this.climaxFired && this.front >= this.climaxAt) {
      this.climaxFired = true;
      out.climax = true;
    }

    if (this.reveal >= 1.15) {
      this.reveal = 1.15;
      this.phase = this.outcome?.won ? "won" : "lost";
      if (this.outcome) for (const s of this.outcome.starsLit) this.starsLit.add(s);
      out.settled = true;
    }
    return out;
  }

  /** Cells of collected stars and lit rings, in the order the light found them. */
  constellation(): number[] {
    if (!this.sim) return [];
    const pts = [...this.sim.satisfied, ...this.sim.starsLit];
    return pts.sort((a, b) => (this.eventOrder(a) ?? 0) - (this.eventOrder(b) ?? 0));
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
  score(): { solved: boolean; stars: number; totalStars: number; par: number; used: number; firstTry: boolean } {
    const used = this.tray.reduce((n, s) => n + s.used, 0);
    return {
      solved: this.phase === "won",
      stars: this.outcome?.starsLit.size ?? 0,
      totalStars: this.outcome?.totalStars ?? 0,
      par: this.level.par ?? 0,
      used,
      firstTry: this.runs === 1,
    };
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
  /** Nights solved in a row on the first Shine. */
  streak: number;
  bestStreak: number;
  /** Piece kinds the player has been introduced to. */
  seen: string[];
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
          streak: p.streak ?? 0,
          bestStreak: p.bestStreak ?? 0,
          seen: p.seen ?? [],
        };
      }
    }
  } catch { /* private mode, cleared storage, blocked cookies — fall through */ }
  return { unlocked: 1, stars: {}, runSeed: 1, streak: 0, bestStreak: 0, seen: [] };
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* nothing we can do */ }
}
