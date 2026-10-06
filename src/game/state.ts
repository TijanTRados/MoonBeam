/**
 * Game state: the bridge between the pure engine and the DOM.
 *
 * Holds one level in progress — what the player has placed, what is left in the
 * tray, the board's clock, and how far the run animation has got. Knows nothing
 * about canvas or elements.
 */
import { Level, Light, Tile, TileKind, tileFrom } from "../engine/types";
import {
  HOPS_PER_TICK, Outcome, SimResult, cycleLength, simulate, wins,
} from "../engine/simulate";
import { poolKey } from "../engine/solver";
import { POINTS, segmentPoints } from "./score";
import type { DailyResult } from "./daily";
import type { Constellation } from "./medals";

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
  /** Cells a hint has pointed at. */
  hint = new Set<number>();
  /** …and, after a second hint on the same cell, exactly what goes there. */
  hintGhost = new Map<number, Tile>();
  /** Hints taken on this level. Any at all makes a solve "assisted". */
  hintsUsed = 0;
  /** Boosters used on this level. Like hints, any at all makes it assisted. */
  boostersUsed = 0;
  /** Perfect timing: Shine waits for a moment that works. */
  timingAid = false;
  /** Times Shine has been pressed on this level. One means solved first try. */
  runs = 0;
  /** Shines on this level that did not solve it. */
  misses = 0;
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
    this.misses = 0;
    this.hintsUsed = 0;
    this.boostersUsed = 0;
    this.timingAid = false;
    // Hints belong to the level, not to the board: Clear keeps them.
    this.hint.clear();
    this.hintGhost.clear();
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
    // The cell the moon shines into first is never the end of a segment, so
    // nothing above records the light reaching it. A star or ring sitting
    // there is reached at the very start of the run.
    for (const e of lv.emitters) {
      const i = e.y * lv.w + e.x;
      if (!this.firstArrival.has(i)) this.firstArrival.set(i, 0.01);
      if (!this.lastArrival.has(i)) this.lastArrival.set(i, 0.01);
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

  /** The tick of board time the last run was fired at. */
  get firedAt(): number {
    return this.fireAt;
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
      if (!this.outcome?.won) this.misses++;
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

  /**
   * The route as a constellation, for the star map: where the moon's light
   * came in, then every piece and goal it touched, in the order it got there.
   */
  route(): number[] {
    if (!this.sim) return [];
    const lv = this.current();
    const cells = new Set(this.constellation());
    this.board.forEach((t, i) => { if (t.placed && this.firstArrival.has(i)) cells.add(i); });
    const entry = lv.emitters.map((e) => e.y * lv.w + e.x);
    const rest = [...cells].filter((i) => !entry.includes(i))
      .sort((a, b) => (this.eventOrder(a) ?? 0) - (this.eventOrder(b) ?? 0));
    return [...entry, ...rest];
  }

  /** Is the piece the known solution wants at this placement already there, exactly? */
  private isRight(p: { i: number; kind: TileKind; mask?: Light; from?: Light }): boolean {
    const cur = this.board[p.i];
    return cur.kind === p.kind && cur.mask === p.mask && cur.from === p.from;
  }

  /**
   * A hint, in two steps per piece, following the light from the moon.
   *
   * The first hint on a piece says *where*: its cell pulses. Asking again says
   * *what*: a faint ghost of exactly the right piece, the right way round,
   * appears in it. Pieces already right are skipped, so hints always point at
   * the next thing that is actually wrong.
   */
  takeHint(): "where" | "what" | "none" {
    const sol = this.level.solution;
    if (!sol?.length) return "none";
    const next = sol.find((p) => !this.isRight(p));
    if (!next) return "none";
    this.hintsUsed++;
    if (!this.hint.has(next.i)) { this.hint.add(next.i); return "where"; }
    this.hintGhost.set(next.i, tileFrom(next));
    return "what";
  }

  // ---------------------------------------------------------------- boosters

  /** Pieces in the tray the known solution has no use for. */
  get decoys(): number {
    const need = new Map<string, number>();
    for (const p of this.level.solution ?? []) {
      const k = poolKey(p.kind, p.mask, p.from);
      need.set(k, (need.get(k) ?? 0) + 1);
    }
    return this.tray.reduce((n, s) => n + Math.max(0, s.total - (need.get(s.key) ?? 0)), 0);
  }

  /** Is there a solution piece not yet in place? */
  get nextPiece(): boolean {
    return (this.level.solution ?? []).some((p) => !this.isRight(p));
  }

  /**
   * Place the next piece of the known solution, following the light. If the
   * tray has run out of that piece, one placed somewhere it doesn't belong
   * is picked up first. Returns the cell, or -1.
   */
  placeNext(): number {
    if (this.phase === "running") return -1;
    const sol = this.level.solution ?? [];
    const p = sol.find((q) => !this.isRight(q));
    if (!p) return -1;
    const key = poolKey(p.kind, p.mask, p.from);
    const slot = this.tray.find((s) => s.key === key);
    if (!slot) return -1;

    // Whatever the player put in that cell goes back to the tray.
    const here = this.board[p.i];
    if (here.placed) {
      const back = this.slotFor(here.kind, here.mask, here.from);
      if (back) back.used--;
      this.board[p.i] = { kind: "empty" };
    }
    if (slot.used >= slot.total) {
      const wrong = this.board.findIndex((t, i) => t.placed && poolKey(t.kind, t.mask, t.from) === key &&
        !sol.some((q) => q.i === i && this.isRight(q)));
      if (wrong < 0) return -1;
      this.board[wrong] = { kind: "empty" };
      slot.used--;
    }
    this.board[p.i] = tileFrom(p, true);
    slot.used++;
    this.boostersUsed++;
    this.invalidate();
    return p.i;
  }

  /** Take the decoys out of the tray. Placed decoys go back first. */
  sweepDecoys(): number {
    const need = new Map<string, number>();
    for (const p of this.level.solution ?? []) {
      const k = poolKey(p.kind, p.mask, p.from);
      need.set(k, (need.get(k) ?? 0) + 1);
    }
    const before = this.decoys;
    for (const s of this.tray) {
      const keep = need.get(s.key) ?? 0;
      // Pick up any of this kind beyond what is kept, wrong ones first.
      while (s.used > keep) {
        const sol = this.level.solution ?? [];
        let i = this.board.findIndex((t, j) => t.placed && poolKey(t.kind, t.mask, t.from) === s.key &&
          !sol.some((q) => q.i === j && this.isRight(q)));
        if (i < 0) i = this.board.findIndex((t) => t.placed && poolKey(t.kind, t.mask, t.from) === s.key);
        if (i < 0) break;
        this.board[i] = { kind: "empty" };
        s.used--;
      }
      s.total = Math.min(s.total, keep);
    }
    this.tray = this.tray.filter((s) => s.total > 0);
    this.selected = Math.min(this.selected, Math.max(0, this.tray.length - 1));
    if (before > 0) { this.boostersUsed++; this.invalidate(); }
    return before;
  }

  /**
   * The first tick from now at which the board as it stands would win, within
   * one full cycle of everything moving — or null if no moment works.
   */
  nextWinningTick(): number | null {
    const lv = this.current();
    const from = this.fireTick;
    for (let t = from; t < from + Math.max(1, this.cycle); t++) {
      if (wins(lv, simulate(lv, t))) return t;
    }
    return null;
  }

  /** Hinted cells that still need something done to them. */
  get openHints(): Set<number> {
    const sol = this.level.solution ?? [];
    const out = new Set<number>();
    for (const i of this.hint) {
      const p = sol.find((q) => q.i === i);
      if (p && !this.isRight(p)) out.add(i);
    }
    return out;
  }

  /** Ghosts still worth showing: only on cells not yet holding the right piece. */
  get openGhosts(): Map<number, Tile> {
    const out = new Map<number, Tile>();
    const open = this.openHints;
    for (const [i, t] of this.hintGhost) if (open.has(i)) out.set(i, t);
    return out;
  }

  /** The result of the finished run, for the card. */
  score(): { solved: boolean; stars: number; totalStars: number; par: number; used: number; firstTry: boolean; points: number; assisted: boolean } {
    return {
      solved: this.phase === "won",
      stars: this.outcome?.starsLit.size ?? 0,
      totalStars: this.outcome?.totalStars ?? 0,
      par: this.level.par ?? 0,
      used: this.used,
      firstTry: this.runs === 1 && this.hintsUsed === 0 && this.boostersUsed === 0,
      points: this.runScore,
      assisted: this.hintsUsed > 0 || this.boostersUsed > 0,
    };
  }
}


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
  /** Nights skipped rather than solved; they can be come back to any time. */
  skipped: number[];
  /** Earned by solving, spent on boosters. */
  stardust: number;
  /** night -> medals won (a bitmask; see medals.ts). */
  medals: Record<number, number>;
  /** night -> its constellation, for the star map. */
  maps: Record<number, Constellation>;
  /** Moon Rush: the best run of each day, and of all time. */
  rushBest: Record<number, { solved: number; points: number }>;
  rushRecord: { solved: number; points: number };
  /** Daily puzzle number -> the first solve of it. */
  daily: Record<number, DailyResult>;
  dailyStreak: number;
  dailyBestStreak: number;
  /** The last daily puzzle solved. */
  lastDaily: number;
}

export function loadProgress(): Progress {
  const fresh: Progress = {
    unlocked: 1, stars: {}, best: {}, runSeed: 1, streak: 0, bestStreak: 0, seen: [], phasesSeen: [], openAll: false, skipped: [],
    stardust: 10, medals: {}, maps: {}, rushBest: {}, rushRecord: { solved: 0, points: 0 }, daily: {}, dailyStreak: 0, dailyBestStreak: 0, lastDaily: 0,
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
