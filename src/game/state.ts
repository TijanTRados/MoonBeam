/**
 * Game state: the bridge between the pure engine and the DOM.
 *
 * Holds one level in progress — what the player has placed, what is left in the
 * tray, the board's clock, and how far the run animation has got. Knows nothing
 * about canvas or elements.
 */
import { Level, Light, Tile, TileKind } from "../engine/types";
import {
  HOPS_PER_TICK, Outcome, SimResult, cycleLength, simulate, wins,
} from "../engine/simulate";
import { poolKey } from "../engine/solver";
import { POINTS, segmentPoints } from "./score";

export type Phase = "build" | "running" | "won" | "lost";

/** Seconds of real time per tick of board time while building. */
export const TICK_SECONDS = 0.9;

/** Something worth a sound, an effect, or points, during the reveal. */
export interface RunEvent {
  cell: number;
  points: number;
  kind: "galaxy" | "star" | "ring" | "asteroid" | "comet";
  /** For comets: which piece, and whether it was the last. */
  seq?: number;
  last?: boolean;
}

/** What happened during one frame of the reveal. */
export interface RevealTick {
  /** The run has finished drawing. */
  settled: boolean;
  /** Cells the light reached this frame, in the order it reached them. */
  reached: number[];
  /** Point-bearing events this frame, in order. */
  events: RunEvent[];
  /** Points gained this frame — travel included. */
  points: number;
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
  /** The whole tick of board time currently shown. */
  tick = 0;
  reveal = 0;
  starsLit = new Set<number>();
  outcome: Outcome | null = null;
  hint = new Set<number>();
  /** Times Shine has been pressed on this level. One means solved first try. */
  runs = 0;
  /** Points scored so far by the run being revealed. */
  runScore = 0;

  /**
   * Board time, in ticks, as a float. Anything moving moves with it, while you
   * build and while the light travels; Shine fires at the moment you press it.
   */
  clock = 0;
  /** Ticks after which everything moving is back where it started. */
  cycle = 1;
  /** The tick a run was fired at. */
  private fireAt = 0;
  /** Cells something moving passes through. Nothing can be built there. */
  noBuild = new Set<number>();

  // Reveal bookkeeping, measured in hops from the moon rather than as a fraction,
  // so speed can be set in hops per second and the slow-down lands exactly.
  private front = 0;
  private maxOrder = 0;
  private firstArrival = new Map<number, number>();
  /** A ring needing two converging beams is only complete when the later arrives. */
  private lastArrival = new Map<number, number>();
  /** Shooting-star pieces: the hop at which each was collected, in its turn. */
  private cometAt = new Map<number, number>();
  /** Everything that scores, by the hop at which it happens. */
  private events: { order: number; points: number; event?: RunEvent }[] = [];
  private climaxAt = -1;
  private climaxFired = false;
  private slowMoOn = false;

  constructor(level: Level) {
    this.load(level);
  }

  load(level: Level) {
    this.level = level;
    this.board = level.tiles.map((t) => ({ ...t }));
    this.cycle = cycleLength(level);
    this.clock = 0;
    this.noBuild = new Set();
    for (const t of level.tiles) for (const p of t.track ?? []) this.noBuild.add(p.y * level.w + p.x);
    this.tray = [];
    const seen = new Map<string, TraySlot>();
    for (const it of level.inventory) {
      const key = poolKey(it.kind, it.mask, it.from);
      const e = seen.get(key);
      if (e) { e.total += it.count; continue; }
      seen.set(key, {
        key,
        // Mirrors are pooled, so the slot shows one orientation and the player
        // rotates it in place after dropping it.
        kind: key === "mirror" ? "mirrorB" : it.kind,
        mask: it.mask,
        from: it.from,
        total: it.count,
        used: 0,
      });
      this.tray.push(seen.get(key)!);
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
    this.reveal = 0;
    this.runScore = 0;
    this.starsLit.clear();
    this.outcome = null;
    this.hint.clear();
  }

  get moving(): boolean {
    return this.cycle > 1;
  }

  /** Let board time run while the player builds, so moving things visibly move. */
  tickClock(dt: number) {
    if (this.moving && this.phase !== "running") this.clock += dt / TICK_SECONDS;
    this.tick = Math.floor(this.displayClock);
  }

  /**
   * The tick a press of Shine would fire at. Moving pieces dwell in a cell for
   * most of a tick and glide at the end, so this rounds up only once the glide
   * is well under way — the piece is where it looks like it is.
   */
  get fireTick(): number {
    return Math.floor(this.clock + 0.2);
  }

  /** Board time as shown: during a run it advances as the light travels. */
  get displayClock(): number {
    return this.phase === "running" ? this.fireAt + this.front / HOPS_PER_TICK : this.clock;
  }

  slotFor(kind: TileKind, mask?: Light, from?: Light): TraySlot | undefined {
    const key = poolKey(kind, mask, from);
    return this.tray.find((s) => s.key === key);
  }

  get remaining(): number {
    return this.tray.reduce((n, s) => n + (s.total - s.used), 0);
  }

  get used(): number {
    return this.tray.reduce((n, s) => n + s.used, 0);
  }

  /**
   * A tap on a cell.
   *
   * Empty cell  -> place the selected piece (unless something moving passes there).
   * Your mirror -> flip it; a second tap takes it back.
   * Your piece  -> pick it back up.
   * Level piece -> nothing; the level's own furniture is fixed.
   */
  tap(i: number): "placed" | "rotated" | "removed" | "blocked" | "none" {
    if (this.phase === "running" || this.phase === "won") return "none";
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
    if (this.noBuild.has(i)) return "blocked";

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

  /**
   * The board's furniture changed (the Galaxy sandbox moves it around): work
   * out again what moves and where nothing can be built, and drop any result.
   */
  refresh() {
    const lv = this.current();
    this.cycle = cycleLength(lv);
    this.noBuild = new Set();
    for (const t of this.board) for (const p of t.track ?? []) this.noBuild.add(p.y * lv.w + p.x);
    this.invalidate();
  }

  private invalidate() {
    this.sim = null;
    this.reveal = 0;
    this.phase = "build";
    this.outcome = null;
    this.runScore = 0;
    this.starsLit.clear();
    this.hint.clear();
  }

  /** The level as the engine sees it right now. */
  current(): Level {
    return { ...this.level, tiles: this.board };
  }

  /**
   * Fire. The light leaves the moon at the current moment of board time — the
   * player chose it — and the outcome is settled immediately; the reveal
   * animation catches up.
   */
  start(): Outcome {
    this.runs++;
    this.phase = "running";
    this.reveal = 0;
    this.front = 0;
    this.runScore = 0;
    this.starsLit.clear();
    this.hint.clear();

    const lv = this.current();
    this.fireAt = this.fireTick;
    this.tick = this.fireAt;
    const sim = simulate(lv, this.fireAt);
    this.sim = sim;

    let totalStars = 0, totalReceptors = 0;
    for (const t of lv.tiles) {
      if (t.kind === "star") totalStars++;
      if (t.kind === "receptor") totalReceptors++;
    }
    const won = wins(lv, sim);
    this.outcome = {
      won,
      winTick: won ? this.fireAt : -1,
      starsLit: sim.starsLit,
      totalStars,
      totalReceptors,
      satisfiedCount: sim.satisfied.size,
      touched: sim.touched,
    };

    this.maxOrder = 0;
    this.firstArrival.clear();
    this.lastArrival.clear();
    for (const g of sim.segments) {
      if (g.order > this.maxOrder) this.maxOrder = g.order;
      if (g.x1 < 0 || g.y1 < 0 || g.x1 >= lv.w || g.y1 >= lv.h) continue;
      const i = g.y1 * lv.w + g.x1;
      const f = this.firstArrival.get(i);
      if (f === undefined || g.order < f) this.firstArrival.set(i, g.order);
      const l = this.lastArrival.get(i);
      if (l === undefined || g.order > l) this.lastArrival.set(i, g.order);
    }
    this.cometAt = new Map(sim.cometHits.map((c) => [c.i, c.order]));

    // Everything that scores, keyed to the hop it happens at. The reveal pays
    // these out as the light gets there, so the counter climbs with the beam —
    // and because it is built from the same rules as `scoreRun`, the total it
    // lands on is exactly the run's score.
    const galaxy = new Set(lv.galaxy ?? []);
    this.events = [];
    for (const g of sim.segments) {
      const pts = segmentPoints(lv, g, galaxy);
      if (!pts) continue;
      const cell = g.y1 * lv.w + g.x1;
      this.events.push({
        order: g.order, points: pts,
        event: pts === POINTS.galaxyHop ? { cell, points: pts, kind: "galaxy" } : undefined,
      });
    }
    for (const i of sim.starsLit) {
      this.events.push({ order: this.firstArrival.get(i) ?? 0, points: POINTS.star,
        event: { cell: i, points: POINTS.star, kind: "star" } });
    }
    for (const i of sim.satisfied) {
      this.events.push({ order: this.lastArrival.get(i) ?? 0, points: POINTS.ring,
        event: { cell: i, points: POINTS.ring, kind: "ring" } });
    }
    for (const i of sim.asteroidsHit) {
      this.events.push({ order: this.firstArrival.get(i) ?? 0, points: POINTS.asteroid,
        event: { cell: i, points: POINTS.asteroid, kind: "asteroid" } });
    }
    sim.cometHits.forEach((c, k) => {
      const last = k === sim.cometTotal - 1;
      const pts = POINTS.comet + (last ? POINTS.cometComplete : 0);
      this.events.push({ order: c.order, points: pts,
        event: { cell: c.i, points: pts, kind: "comet", seq: k, last } });
    });
    this.events.sort((a, b) => a.order - b.order);

    // On a winning run, the climax is whichever goal completes last.
    this.climaxAt = -1;
    this.climaxFired = false;
    this.slowMoOn = false;
    if (won) {
      for (const i of sim.satisfied) this.climaxAt = Math.max(this.climaxAt, this.lastArrival.get(i) ?? 0);
      for (const i of sim.starsLit) this.climaxAt = Math.max(this.climaxAt, this.firstArrival.get(i) ?? 0);
      for (const c of sim.cometHits) this.climaxAt = Math.max(this.climaxAt, c.order);
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
      .filter((g) => !g.warp && !g.gate && (g.x1 < 0 || g.y1 < 0 || g.x1 >= w || g.y1 >= h))
      .map((g) => g.order);
  }

  /** Hops at which a beam passes through a warp gate, and where. */
  gateCrossings(): { order: number; x: number; y: number; light: Light }[] {
    if (!this.sim) return [];
    return this.sim.segments.filter((g) => g.gate).map((g) => ({
      order: g.order,
      x: g.gate === "out" ? g.x1 : g.x0,
      y: g.gate === "out" ? g.y1 : g.y0,
      light: g.light,
    }));
  }

  /** Satellite carries: when each starts and ends, for the pick-up and put-down sounds. */
  carries(): { from: number; to: number; x0: number; y0: number; x1: number; y1: number }[] {
    if (!this.sim) return [];
    return this.sim.segments.filter((g) => g.carry).map((g) => ({
      from: g.order - (g.span ?? 1), to: g.order, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1,
    }));
  }

  /**
   * The hop at which a cell's event fires: rings when full, comet pieces when
   * collected in their turn, everything else on first touch.
   */
  eventOrder(i: number): number | undefined {
    const k = this.board[i]?.kind;
    if (k === "receptor") return this.lastArrival.get(i);
    if (k === "comet") return this.cometAt.get(i);
    return this.firstArrival.get(i);
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
      settled: false, reached: [], events: [], points: 0, climax: false,
      slowMo: false, slowMoStarted: false, slowMoSeconds: 0,
    };
    if (this.phase !== "running" || !this.sim) { out.settled = true; return out; }

    const span = this.maxOrder + 1;
    // A floor keeps a short beam lively. The rate is capped relative to board
    // time too: HOPS_PER_TICK hops is one tick, and at 9+ hops a second the
    // reveal would otherwise race moving pieces through a whole cycle.
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
    this.tick = Math.floor(this.displayClock);

    const hits: [number, number][] = [];
    for (const i of this.firstArrival.keys()) {
      const at = this.eventOrder(i);
      if (at !== undefined && at > prev && at <= this.front) hits.push([at, i]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    out.reached = hits.map((h) => h[1]);

    for (const e of this.events) {
      if (e.order <= prev) continue;
      if (e.order > this.front) break;
      out.points += e.points;
      if (e.event) out.events.push(e.event);
    }
    this.runScore += out.points;

    for (const s of this.sim.starsLit) {
      if (this.front >= (this.firstArrival.get(s) ?? 0)) this.starsLit.add(s);
    }

    if (this.climaxAt >= 0 && !this.climaxFired && this.front >= this.climaxAt) {
      this.climaxFired = true;
      out.climax = true;
    }

    if (this.reveal >= 1.15) {
      this.reveal = 1.15;
      // Board time carries on from wherever the light left it.
      this.clock = this.fireAt + this.front / HOPS_PER_TICK;
      this.phase = this.outcome?.won ? "won" : "lost";
      out.settled = true;
    }
    return out;
  }

  /** Stars, comet pieces and lit rings, in the order the light found them. */
  constellation(): number[] {
    if (!this.sim) return [];
    const pts = [...this.sim.satisfied, ...this.sim.starsLit, ...this.sim.cometHits.map((c) => c.i)];
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

  /** The result of the finished run, for the card. */
  score(): { solved: boolean; stars: number; totalStars: number; par: number; used: number; firstTry: boolean; points: number } {
    return {
      solved: this.phase === "won",
      stars: this.outcome?.starsLit.size ?? 0,
      totalStars: this.outcome?.totalStars ?? 0,
      par: this.level.par ?? 0,
      used: this.used,
      firstTry: this.runs === 1,
      points: this.runScore,
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
  /** night -> best score. */
  best: Record<number, number>;
  runSeed: number;
  /** Nights solved in a row on the first Shine. */
  streak: number;
  bestStreak: number;
  /** Piece kinds the player has been introduced to. */
  seen: string[];
  /** Phases whose opening card has been shown. */
  phasesSeen: string[];
  /** Every night open, whatever has been solved — for jumping around and testing. */
  openAll: boolean;
}

export function loadProgress(): Progress {
  const fresh: Progress = {
    unlocked: 1, stars: {}, best: {}, runSeed: 1, streak: 0, bestStreak: 0, seen: [], phasesSeen: [], openAll: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      // Fill in fields added after this save was written.
      if (typeof p.unlocked === "number") return { ...fresh, ...p, unlocked: p.unlocked };
    }
  } catch { /* private mode, cleared storage, blocked cookies — fall through */ }
  return fresh;
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* nothing we can do */ }
}
