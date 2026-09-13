/**
 * The beam simulation.
 *
 * Pure and deterministic: `simulate(level, tick)` always returns the same result
 * for the same inputs. The renderer animates the returned segments in order,
 * which recreates the "ball travelling through the grid" reveal from the 2015
 * version without the simulation itself having to know about time.
 */
import {
  DELTA, Dir, Level, Light, Tile, WHITE, idx, inBounds, turnCCW, turnCW,
} from "./types";

/** One cell-to-cell hop of light. The renderer draws these in `order`. */
export interface Segment {
  x0: number; y0: number;
  x1: number; y1: number;
  light: Light;
  /** Hop count from the emitter — drives the growth animation. */
  order: number;
  /** True when the hop is a portal jump (drawn as a fade, not a line). */
  warp?: boolean;
}

export interface SimResult {
  segments: Segment[];
  /** Indices of star tiles that received any light. */
  starsLit: Set<number>;
  /** Receptor cell index -> accumulated light that reached it this tick. */
  receptorLight: Map<number, Light>;
  /** Receptors whose accumulated light exactly matches their mask. */
  satisfied: Set<number>;
  /** Cell indices any beam passed through — the solver uses this to prune. */
  touched: Set<number>;
  /** True if the beam tree looped or hit the step budget. */
  exhausted: boolean;
  /** Longest hop count reached, for scoring puzzle complexity. */
  depth: number;
}

/** Hard cap on beam hops. Cycles are caught by `seen`; this is a backstop. */
const MAX_STEPS = 4000;

/**
 * Where each tile actually is on a given tick. Tiles with a `track` walk it one
 * cell per tick, so a moving mirror is just a tile whose index changes.
 */
export function resolveTiles(level: Level, tick: number): Tile[] {
  const tiles = level.tiles;
  let moving = false;
  for (const t of tiles) if (t.track && t.track.length > 1) { moving = true; break; }
  if (!moving) return tiles;

  const out: Tile[] = tiles.map((t) => (t.track && t.track.length > 1 ? { kind: "empty" as const } : t));
  for (const t of tiles) {
    if (!t.track || t.track.length <= 1) continue;
    const p = t.track[(tick + (t.phase ?? 0)) % t.track.length];
    if (inBounds(level, p.x, p.y)) out[idx(level, p.x, p.y)] = t;
  }
  return out;
}

interface Ray { x: number; y: number; dir: Dir; light: Light; order: number }

/**
 * Where each jumping tile sends light.
 *
 * Portals map both ways within a pair. Black holes map one way onto the white
 * hole sharing their id, and never back.
 */
function buildLinks(tiles: Tile[]): Map<number, number> {
  const links = new Map<number, number>();
  const portals = new Map<number, number[]>();
  const blacks = new Map<number, number[]>();
  const whites = new Map<number, number>();

  for (let j = 0; j < tiles.length; j++) {
    const p = tiles[j].pair ?? 0;
    if (tiles[j].kind === "portal") {
      const xs = portals.get(p);
      if (xs) xs.push(j); else portals.set(p, [j]);
    } else if (tiles[j].kind === "blackhole") {
      const xs = blacks.get(p);
      if (xs) xs.push(j); else blacks.set(p, [j]);
    } else if (tiles[j].kind === "whitehole") {
      whites.set(p, j);
    }
  }

  for (const js of portals.values()) {
    if (js.length === 2) { links.set(js[0], js[1]); links.set(js[1], js[0]); }
  }
  for (const [p, js] of blacks) {
    const exit = whites.get(p);
    if (exit !== undefined) for (const j of js) links.set(j, exit);
  }
  return links;
}

export function simulate(level: Level, tick = 0): SimResult {
  const tiles = resolveTiles(level, tick);
  const segments: Segment[] = [];
  const starsLit = new Set<number>();
  const receptorLight = new Map<number, Light>();
  const touched = new Set<number>();

  // A ray is fully described by (cell, direction, colour); revisiting that exact
  // state can only repeat work already done, so this terminates loops.
  const seen = new Set<number>();
  const key = (x: number, y: number, d: Dir, l: Light) => ((y * level.w + x) * 4 + d) * 8 + l;

  const queue: Ray[] = [];
  for (const e of level.emitters) queue.push({ x: e.x, y: e.y, dir: e.dir, light: e.light, order: 0 });

  // Jump destinations are looked up per hop, so resolve the pairings once.
  let linkOf: Map<number, number> | null = null;

  let steps = 0;
  let depth = 0;
  let exhausted = false;
  let head = 0; // index cursor: Array.shift() is O(n) and this loop is hot

  while (head < queue.length) {
    const ray = queue[head++];
    if (++steps > MAX_STEPS) { exhausted = true; break; }
    const { x, y, dir, light } = ray;
    if (!inBounds(level, x, y) || light === 0) continue;

    const k = key(x, y, dir, light);
    if (seen.has(k)) { exhausted = true; continue; }
    seen.add(k);

    const i = idx(level, x, y);
    const tile = tiles[i];
    touched.add(i);
    if (ray.order > depth) depth = ray.order;

    // Sends light onward from this cell, drawing the hop that gets there.
    const emit = (d: Dir, l: Light) => {
      if (l === 0) return;
      const dv = DELTA[d];
      const nx = x + dv.x, ny = y + dv.y;
      segments.push({ x0: x, y0: y, x1: nx, y1: ny, light: l, order: ray.order + 1 });
      if (inBounds(level, nx, ny)) queue.push({ x: nx, y: ny, dir: d, light: l, order: ray.order + 1 });
    };

    switch (tile.kind) {
      case "wall":
        break; // absorbed

      // SW-NE mirror. Reflecting a direction across it maps (dx,dy) -> (-dy,-dx).
      case "mirrorA":
        emit(dir === Dir.Down ? Dir.Left : dir === Dir.Left ? Dir.Down
           : dir === Dir.Up ? Dir.Right : Dir.Up, light);
        break;

      // NW-SE mirror: (dx,dy) -> (dy,dx). This is the thesis's mirror1.
      case "mirrorB":
        emit(dir === Dir.Down ? Dir.Right : dir === Dir.Right ? Dir.Down
           : dir === Dir.Up ? Dir.Left : Dir.Up, light);
        break;

      case "splitter":
        // The diamond: light fans out to both sides, never straight on.
        emit(turnCW(dir), light);
        emit(turnCCW(dir), light);
        break;

      case "crystal":
        if (light === WHITE) {
          // Separation: red bends one way, blue the other, green carries straight.
          emit(turnCW(dir), 1);
          emit(dir, 2);
          emit(turnCCW(dir), 4);
        } else {
          emit(dir, light); // already separated - passes through untouched
        }
        break;

      case "tint":
        // Conversion, not subtraction. Light that matches `from` (or any light,
        // when `from` is unset) leaves as `mask`; anything else is unaffected.
        // Nothing dies here, which makes tints safe to experiment with.
        emit(dir, tile.from === undefined || light === tile.from ? (tile.mask ?? light) : light);
        break;

      // Portals pair symmetrically; a black hole only ever sends light *to* its
      // white hole. Both resolve to "come out over there, still travelling the
      // same way", so they share one jump.
      case "portal":
      case "blackhole": {
        if (!linkOf) linkOf = buildLinks(tiles);
        const twin = linkOf.get(i) ?? -1;
        if (twin < 0) { if (tile.kind === "portal") emit(dir, light); break; }
        const tx = twin % level.w, ty = Math.floor(twin / level.w);
        segments.push({ x0: x, y0: y, x1: tx, y1: ty, light, order: ray.order + 1, warp: true });
        const dv = DELTA[dir];
        const nx = tx + dv.x, ny = ty + dv.y;
        segments.push({ x0: tx, y0: ty, x1: nx, y1: ny, light, order: ray.order + 2 });
        if (inBounds(level, nx, ny)) queue.push({ x: nx, y: ny, dir, light, order: ray.order + 2 });
        break;
      }

      // A white hole is only an exit. Light that wanders into one just passes.
      case "whitehole":
        emit(dir, light);
        break;

      case "star":
        starsLit.add(i);
        emit(dir, light);
        break;

      case "receptor":
        // Receptors accumulate additively, so two beams can combine into a
        // colour no single beam could carry.
        receptorLight.set(i, (receptorLight.get(i) ?? 0) | light);
        break;

      default:
        emit(dir, light);
    }
  }

  const satisfied = new Set<number>();
  for (const [i, l] of receptorLight) {
    // Exact match, not superset: over-lighting a receptor fails it, which is
    // what makes filters and careful routing matter.
    if (l === (tiles[i].mask ?? WHITE)) satisfied.add(i);
  }

  return { segments, starsLit, receptorLight, satisfied, touched, exhausted, depth };
}

/** Ticks to run before deciding a level with moving parts is unsolved. */
export function cycleLength(level: Level): number {
  let lcm = 1;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  for (const t of level.tiles) {
    if (t.track && t.track.length > 1) lcm = (lcm * t.track.length) / gcd(lcm, t.track.length);
  }
  return Math.min(lcm, 60);
}

export interface Outcome {
  won: boolean;
  /** The tick on which every receptor was lit at once, or -1. */
  winTick: number;
  /** Stars banked across every tick — once lit, a star stays collected. */
  starsLit: Set<number>;
  totalStars: number;
  totalReceptors: number;
  satisfiedCount: number;
  /**
   * Every cell any beam touched, across every tick. The solver needs this and
   * would otherwise have to re-simulate the whole cycle to get it, so it rides
   * along here — this function is the hot path of level generation.
   */
  touched: Set<number>;
}

/**
 * Run the level across a full movement cycle.
 *
 * Stars bank across ticks (light one now, another later), but every receptor
 * must be lit on the *same* tick. With no moving parts this collapses to a
 * single tick and behaves exactly like the static game.
 */
export function evaluate(level: Level): Outcome {
  const ticks = cycleLength(level);
  const banked = new Set<number>();
  let totalStars = 0, totalReceptors = 0;
  for (const t of level.tiles) {
    if (t.kind === "star") totalStars++;
    if (t.kind === "receptor") totalReceptors++;
  }

  let winTick = -1;
  let best = 0;
  const touched = new Set<number>();
  for (let tick = 0; tick < ticks; tick++) {
    const r = simulate(level, tick);
    for (const s of r.starsLit) banked.add(s);
    for (const c of r.touched) touched.add(c);
    if (r.satisfied.size > best) best = r.satisfied.size;
    if (winTick < 0 && r.satisfied.size === totalReceptors && totalReceptors > 0) {
      winTick = tick;
      if (banked.size === totalStars) break;
    }
  }

  return {
    won: winTick >= 0 && banked.size === totalStars,
    winTick,
    starsLit: banked,
    totalStars,
    totalReceptors,
    satisfiedCount: best,
    touched,
  };
}
