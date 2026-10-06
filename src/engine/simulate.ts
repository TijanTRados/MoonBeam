/**
 * The beam simulation.
 *
 * Pure and deterministic: `simulate(level, tick)` always returns the same result
 * for the same inputs. The renderer animates the returned segments in order,
 * which recreates the "ball travelling through the grid" reveal from the 2015
 * version.
 *
 * Light has a speed. A beam fired at tick `t` is at tick `t + order / HOPS_PER_TICK`
 * when it has made `order` hops, and every tile is resolved at the moment the
 * light actually reaches it. On a board with nothing moving that changes
 * nothing. With asteroids drifting across it, it is the whole game: an asteroid
 * that is in the way when you fire may have moved on by the time the light gets
 * there — and a satellite, which holds light for a while before its dish lets
 * it go, can be used to wait for exactly that.
 */
import {
  DELTA, Dir, Level, Light, Tile, WHITE, idx, inBounds, turnCCW, turnCW,
} from "./types";
import { cubeExit } from "./cube";

/** How many cells light crosses per tick of board time. */
export const HOPS_PER_TICK = 6;

/** One cell-to-cell hop of light. The renderer draws these in `order`. */
export interface Segment {
  x0: number; y0: number;
  x1: number; y1: number;
  light: Light;
  /** Hop count from the emitter — drives the growth animation and board time. */
  order: number;
  /** A portal or black-hole jump (drawn as a dashed fade, not a line). */
  warp?: boolean;
  /**
   * How many hops of reveal this segment takes to draw. Ordinary hops take one;
   * a satellite carrying light to its dish takes as long as its delay.
   */
  span?: number;
  /** A satellite carrying light to its dish. */
  carry?: boolean;
  /**
   * An edge warp. "out": the beam runs into a gate on the rim. "in": it comes
   * back out of the opposite gate. Drawn only as far as the rim.
   */
  gate?: "in" | "out";
  /** On a cube: the face this hop is on (0, the front, when unset). */
  face?: number;
  /**
   * On a cube: "out" runs off the edge of its face, "in" comes over the edge
   * onto the next. Drawn only as far as the rim, like a warp gate.
   */
  edge?: "in" | "out";
}

export interface SimResult {
  segments: Segment[];
  /** Indices of star tiles that received any light. */
  starsLit: Set<number>;
  /** Receptor cell index -> accumulated light that reached it this firing. */
  receptorLight: Map<number, Light>;
  /** Receptors whose accumulated light exactly matches their mask. */
  satisfied: Set<number>;
  /** Cell indices any beam passed through — the solver uses this to prune. */
  touched: Set<number>;
  /** Cells where light struck an asteroid (each costs points). */
  asteroidsHit: Set<number>;
  /**
   * Shooting-star pieces collected, in order, with the hop at which each was
   * collected. Stops at the first piece the light never reached in its turn.
   */
  cometHits: { i: number; order: number }[];
  /** How many pieces the level's shooting star has. */
  cometTotal: number;
  /** True if the beam tree looped or hit the step budget. */
  exhausted: boolean;
  /** Longest hop count reached, for scoring puzzle complexity. */
  depth: number;
}

/** Hard cap on beam hops. Cycles are caught by `seen`; this is a backstop. */
const MAX_STEPS = 4000;

/**
 * Where each tile actually is on a given tick. Tiles with a `track` walk it one
 * cell per tick, so an asteroid is just a tile whose index changes.
 */
export function resolveTiles(level: Level, tick: number): Tile[] {
  const tiles = level.tiles;
  let moving = false;
  for (const t of tiles) if (t.track && t.track.length > 1) { moving = true; break; }
  if (!moving) return tiles;

  const out: Tile[] = tiles.map((t) => (t.track && t.track.length > 1 ? { kind: "empty" as const } : t));
  for (const t of tiles) {
    if (!t.track || t.track.length <= 1) continue;
    const n = t.track.length;
    const p = t.track[(((tick + (t.phase ?? 0)) % n) + n) % n];
    if (inBounds(level, p.x, p.y)) out[idx(level, p.x, p.y)] = t;
  }
  return out;
}

interface Ray { x: number; y: number; dir: Dir; light: Light; order: number; face: number }

/**
 * Where each jumping tile sends light.
 *
 * Portals map both ways within a pair. Black holes map one way onto the white
 * hole sharing their id, satellites one way onto their dish; never back.
 */
function buildLinks(tiles: Tile[]): Map<number, number> {
  const links = new Map<number, number>();
  const portals = new Map<number, number[]>();
  const oneWay: [string, string][] = [["blackhole", "whitehole"], ["satellite", "dish"]];
  const sources = new Map<string, Map<number, number[]>>();
  const exits = new Map<string, Map<number, number>>();

  for (let j = 0; j < tiles.length; j++) {
    const t = tiles[j];
    const p = t.pair ?? 0;
    if (t.kind === "portal") {
      const xs = portals.get(p);
      if (xs) xs.push(j); else portals.set(p, [j]);
      continue;
    }
    for (const [src, dst] of oneWay) {
      if (t.kind === src) {
        const m = sources.get(src) ?? sources.set(src, new Map()).get(src)!;
        const xs = m.get(p);
        if (xs) xs.push(j); else m.set(p, [j]);
      } else if (t.kind === dst) {
        const m = exits.get(dst) ?? exits.set(dst, new Map()).get(dst)!;
        m.set(p, j);
      }
    }
  }

  for (const js of portals.values()) {
    if (js.length === 2) { links.set(js[0], js[1]); links.set(js[1], js[0]); }
  }
  for (const [src, dst] of oneWay) {
    for (const [p, js] of sources.get(src) ?? []) {
      const exit = exits.get(dst)?.get(p);
      if (exit !== undefined) for (const j of js) links.set(j, exit);
    }
  }
  return links;
}

export function simulate(level: Level, tick = 0): SimResult {
  const segments: Segment[] = [];
  const starsLit = new Set<number>();
  const receptorLight = new Map<number, Light>();
  const touched = new Set<number>();
  const asteroidsHit = new Set<number>();
  const { w, h } = level;

  // Tiles and jump links, resolved once per tick of board time the light
  // passes through. On a static board there is exactly one.
  const cycle = cycleLength(level);
  const byTick = new Map<number, { tiles: Tile[]; links: Map<number, number> | null }>();
  const timeOf = (order: number) => (((tick + Math.floor(order / HOPS_PER_TICK)) % cycle) + cycle) % cycle;
  const stateAt = (t: number) => {
    let s = byTick.get(t);
    if (!s) { s = { tiles: resolveTiles(level, t), links: null }; byTick.set(t, s); }
    return s;
  };

  // Which rows and columns wrap round, and whether a beam leaving the board at
  // (nx, ny) travelling `d` comes back in on the far side.
  const wrapRows = new Set<number>();
  const wrapCols = new Set<number>();
  for (const wp of level.warps ?? []) (wp.axis === "row" ? wrapRows : wrapCols).add(wp.index);
  const wrapOf = (nx: number, ny: number): { ex: number; ey: number; ix: number; iy: number } | null => {
    if ((nx < 0 || nx >= w) && ny >= 0 && ny < h && wrapRows.has(ny)) {
      return nx < 0 ? { ex: w, ey: ny, ix: w - 1, iy: ny } : { ex: -1, ey: ny, ix: 0, iy: ny };
    }
    if ((ny < 0 || ny >= h) && nx >= 0 && nx < w && wrapCols.has(nx)) {
      return ny < 0 ? { ex: nx, ey: h, ix: nx, iy: h - 1 } : { ex: nx, ey: -1, ix: nx, iy: 0 };
    }
    return null;
  };

  // A ray is fully described by (cell, direction, colour, and — when things are
  // moving — the tick of board time). Revisiting that exact state can only
  // repeat work already done, so this terminates loops, including the ones a
  // wrapping row or column makes very easy to build.
  const seen = new Set<number>();
  const key = (x: number, y: number, d: Dir, l: Light, t: number, f: number) =>
    ((((y * w + x) * 4 + d) * 8 + l) * cycle + t) * 6 + f;
  const cube = !!level.cube && w === h;

  const queue: Ray[] = [];
  for (const e of level.emitters) queue.push({ x: e.x, y: e.y, dir: e.dir, light: e.light, order: 0, face: 0 });

  let steps = 0;
  let depth = 0;
  let exhausted = false;
  let head = 0; // index cursor: Array.shift() is O(n) and this loop is hot

  while (head < queue.length) {
    const ray = queue[head++];
    if (++steps > MAX_STEPS) { exhausted = true; break; }
    const { x, y, dir, light } = ray;
    if (!inBounds(level, x, y) || light === 0) continue;

    const t = timeOf(ray.order);
    const face = ray.face;
    const k = key(x, y, dir, light, t, face);
    if (seen.has(k)) { exhausted = true; continue; }
    seen.add(k);

    const state = stateAt(t);
    const tiles = state.tiles;
    const i = idx(level, x, y);
    const tile = tiles[i];
    touched.add(i);
    if (ray.order > depth) depth = ray.order;

    const onFace = cube ? { face } : {};

    /**
     * One hop of light from (fx, fy) heading `d`, drawn and queued. Off the
     * edge it may come back through a warp gate, carry over onto the next
     * face of a cube, or simply leave.
     */
    const hop = (fx: number, fy: number, d: Dir, l: Light, base: number) => {
      const dv = DELTA[d];
      const nx = fx + dv.x, ny = fy + dv.y;
      if (!inBounds(level, nx, ny)) {
        if (cube) {
          // Over the edge: half a hop to the rim here, half from the rim there.
          const s = cubeExit(w, face, fx, fy, d);
          const rim = DELTA[s.dir];
          segments.push({ x0: fx, y0: fy, x1: nx, y1: ny, light: l, order: base + 1, edge: "out", face });
          segments.push({ x0: s.x - rim.x, y0: s.y - rim.y, x1: s.x, y1: s.y, light: l, order: base + 1, edge: "in", face: s.face });
          queue.push({ x: s.x, y: s.y, dir: s.dir, light: l, order: base + 1, face: s.face });
          return;
        }
        const wr = wrapOf(nx, ny);
        if (wr) {
          segments.push({ x0: fx, y0: fy, x1: nx, y1: ny, light: l, order: base + 1, gate: "out" });
          segments.push({ x0: wr.ex, y0: wr.ey, x1: wr.ix, y1: wr.iy, light: l, order: base + 2, gate: "in" });
          queue.push({ x: wr.ix, y: wr.iy, dir: d, light: l, order: base + 2, face });
          return;
        }
      }
      segments.push({ x0: fx, y0: fy, x1: nx, y1: ny, light: l, order: base + 1, ...onFace });
      if (inBounds(level, nx, ny)) queue.push({ x: nx, y: ny, dir: d, light: l, order: base + 1, face });
    };

    // Sends light onward from this cell.
    const emit = (d: Dir, l: Light) => { if (l !== 0) hop(x, y, d, l, ray.order); };

    /** Continue from another cell, still heading `dir`, after a jump of `extra` hops. */
    const jumpTo = (to: number, extra: number, seg: Partial<Segment>) => {
      const tx = to % w, ty = Math.floor(to / w);
      segments.push({ x0: x, y0: y, x1: tx, y1: ty, light, order: ray.order + extra, ...onFace, ...seg });
      // Step out of the exit through the same machinery as any other hop, so a
      // jump that lands by an edge can still use a warp gate or cross the cube.
      hop(tx, ty, dir, light, ray.order + extra);
    };

    switch (tile.kind) {
      case "wall":
        break; // absorbed

      case "asteroid":
        // Breaks the beam, and the run pays for it.
        asteroidsHit.add(i);
        break;

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
        // Conversion, not subtraction. Nothing dies here, which makes tints safe
        // to experiment with.
        emit(dir, tile.from === undefined || light === tile.from ? (tile.mask ?? light) : light);
        break;

      // Portals pair symmetrically; a black hole only ever sends light *to* its
      // white hole. Both come out "over there, still travelling the same way".
      case "portal":
      case "blackhole": {
        if (!state.links) state.links = buildLinks(tiles);
        const twin = state.links.get(i) ?? -1;
        if (twin < 0) { if (tile.kind === "portal") emit(dir, light); break; }
        jumpTo(twin, 1, { warp: true });
        break;
      }

      // A satellite catches the light and carries it to its dish, which lets it
      // go again `delay` ticks later — by which time everything moving on the
      // board has moved on too.
      case "satellite": {
        if (!state.links) state.links = buildLinks(tiles);
        const dish = state.links.get(i) ?? -1;
        if (dish < 0) break; // a satellite with nowhere to send the light keeps it
        const hold = Math.max(1, tile.delay ?? 1) * HOPS_PER_TICK;
        jumpTo(dish, hold, { carry: true, span: hold });
        break;
      }

      // Exits only. Light that wanders into one directly just passes through.
      case "whitehole":
      case "dish":
        emit(dir, light);
        break;

      case "star":
        starsLit.add(i);
        emit(dir, light);
        break;

      // Transparent. Whether a comet piece is collected depends on *when* the
      // light reached it relative to the others, worked out after the run.
      case "comet":
      case "terrain":
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
  const receptors = level.tiles;
  for (const [i, l] of receptorLight) {
    // Exact match, not superset: over-lighting a receptor fails it.
    if (l === (receptors[i].mask ?? WHITE)) satisfied.add(i);
  }

  const { hits: cometHits, total: cometTotal } = collectComet(level, segments);

  return {
    segments, starsLit, receptorLight, satisfied, touched, asteroidsHit,
    cometHits, cometTotal, exhausted, depth,
  };
}

/**
 * Walk the shooting star's sequence against the run.
 *
 * Piece 0 is collected by the first light to reach it. Each later piece is
 * collected by the first light to reach it *after* the previous piece was
 * collected — light that crossed it earlier, before its turn, does not count.
 * That is what makes a player route the beam through the locations in order,
 * rather than simply through all of them.
 */
export function collectComet(level: Level, segments: Segment[]) {
  const pieces: { i: number; seq: number }[] = [];
  level.tiles.forEach((t, i) => { if (t.kind === "comet") pieces.push({ i, seq: t.seq ?? 0 }); });
  pieces.sort((a, b) => a.seq - b.seq);
  const hits: { i: number; order: number }[] = [];
  if (!pieces.length) return { hits, total: 0 };

  // Every hop at which light arrives at each piece.
  const arrivals = new Map<number, number[]>();
  for (const p of pieces) arrivals.set(p.i, []);
  for (const s of segments) {
    if (s.x1 < 0 || s.y1 < 0 || s.x1 >= level.w || s.y1 >= level.h || s.warp || s.carry) continue;
    const list = arrivals.get(s.y1 * level.w + s.x1);
    if (list) list.push(s.order);
  }

  let after = -1;
  for (const p of pieces) {
    const at = (arrivals.get(p.i) ?? []).filter((o) => o > after);
    if (!at.length) break;
    after = Math.min(...at);
    hits.push({ i: p.i, order: after });
  }
  return { hits, total: pieces.length };
}

/** Ticks after which everything moving is back where it started. */
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
  /** The first tick at which firing wins, or -1. */
  winTick: number;
  /** Stars lit by the winning firing (or by the best one, on a loss). */
  starsLit: Set<number>;
  totalStars: number;
  totalReceptors: number;
  satisfiedCount: number;
  /**
   * Every cell any beam touched, across every tick. The solver needs this and
   * would otherwise have to re-simulate the whole cycle to get it.
   */
  touched: Set<number>;
}

/** Does one firing complete the level: every ring satisfied and every star lit? */
export function wins(level: Level, r: SimResult): boolean {
  let totalStars = 0, totalReceptors = 0;
  for (const t of level.tiles) {
    if (t.kind === "star") totalStars++;
    if (t.kind === "receptor") totalReceptors++;
  }
  return totalReceptors > 0 && r.satisfied.size === totalReceptors &&
    r.starsLit.size === totalStars && r.cometHits.length === r.cometTotal;
}

/**
 * Is there *any* moment at which firing solves the level?
 *
 * This is the generator's and solver's question, not the player's: the player
 * fires at the moment they choose and must pick a good one. A single firing
 * must light every ring and every star; with nothing moving there is only one
 * moment and this is simply "does it work".
 */
export function evaluate(level: Level): Outcome {
  const ticks = cycleLength(level);
  let totalStars = 0, totalReceptors = 0;
  for (const t of level.tiles) {
    if (t.kind === "star") totalStars++;
    if (t.kind === "receptor") totalReceptors++;
  }

  let winTick = -1;
  let best = 0;
  let bestStars = new Set<number>();
  const touched = new Set<number>();
  for (let tick = 0; tick < ticks; tick++) {
    const r = simulate(level, tick);
    for (const c of r.touched) touched.add(c);
    if (r.satisfied.size > best || (r.satisfied.size === best && r.starsLit.size > bestStars.size)) {
      best = r.satisfied.size;
      bestStars = r.starsLit;
    }
    if (wins(level, r)) {
      winTick = tick;
      bestStars = r.starsLit;
      break;
    }
  }

  return {
    won: winTick >= 0,
    winTick,
    starsLit: bestStars,
    totalStars,
    totalReceptors,
    satisfiedCount: best,
    touched,
  };
}
