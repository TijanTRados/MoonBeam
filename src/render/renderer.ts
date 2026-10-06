/**
 * Canvas renderer.
 *
 * Draws the board only — the tray, buttons and dialogs are DOM, which keeps
 * touch targets and accessibility sane. Everything here is procedural: no
 * sprite sheets, so the art scales to any screen and any grid size.
 */
import {
  Chan, Level, Light, Tile, WHITE, idx,
} from "../engine/types";
import { Segment, SimResult } from "../engine/simulate";
import { PALETTE as P, alpha, lightColor } from "./theme";
import { drawFx } from "./fx";
import { drawSky, glint } from "./sky";
import { Particles, rand } from "./particles";
import { drawMoon as paintMoon } from "./moon";
import { DEFAULT_THEME, Theme } from "./themes";
import {
  drawAsteroid, drawCometPiece, drawDish, drawMilkyWay, drawSatellitePiece, drawTerrain, drawWarpGate,
} from "./elements";

export interface ViewState {
  level: Level;
  /** Simulation for the tick currently being shown, or null when idle. */
  sim: SimResult | null;
  tick: number;
  /** 0..1 reveal progress along the beam, for the "run" animation. */
  reveal: number;
  /** Stars banked so far this run. */
  starsLit: Set<number>;
  /** Cell under the pointer, or -1. */
  hover: number;
  /** Seconds since load, for idle animation. */
  time: number;
  /** 0..1 win celebration. */
  winGlow: number;
  /** Cells to pulse as a hint, or empty. */
  hint: Set<number>;
  /** Hinted cells showing a faint ghost of the piece that belongs there. */
  hintGhost?: Map<number, Tile>;

  /** Particle system for this canvas; glitter is only emitted when present. */
  particles?: Particles;
  /** Seconds since the last frame, for particle emission rates. */
  dt?: number;
  /** 0..1 — every beam flares white at the moment of solving. */
  flare?: number;
  /** 0..1 — a brief zoom "punch" on the board at the moment of solving. */
  punch?: number;
  /** A tiny demo board: skip the planets, satellites and grain. */
  mini?: boolean;
  /**
   * A silent simulation of the board as it stands, used in build mode so a
   * crystal can show which way its colours will leave before you press Shine.
   */
  previewSim?: SimResult | null;
  /** Board time as a float, so moving pieces glide between cells. Defaults to `tick`. */
  clock?: number;
  /** How full the moon is, 0..1: it waxes across a phase's ten nights. */
  moonLit?: number;
  /** The phase's look. */
  theme?: Theme;
  /** Shooting-star pieces collected so far; the next one is the active one. */
  cometCollected?: number;
  /** Warp gates flashing as light passes through them: "axis:index" -> 0..1. */
  gateFlash?: Map<string, number>;
  /** Time left before the moon sets, 0..1; undefined for no clock. */
  timer?: number;
  /** On a cube: which face is being looked at (0, the front, by default). */
  face?: number;
}

export interface Layout {
  cell: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** Fit the grid into the canvas, leaving headroom above for the moon. */
export function computeLayout(cw: number, ch: number, level: Level): Layout {
  const moonRoom = 1.35;          // in cells
  const pad = Math.min(cw, ch) * 0.05;
  const cell = Math.min(
    (cw - pad * 2) / level.w,
    (ch - pad * 2) / (level.h + moonRoom),
  );
  return {
    cell,
    ox: (cw - cell * level.w) / 2,
    oy: (ch - cell * (level.h + moonRoom)) / 2 + cell * moonRoom,
    w: level.w,
    h: level.h,
  };
}

export function cellAt(l: Layout, px: number, py: number): number {
  const x = Math.floor((px - l.ox) / l.cell);
  const y = Math.floor((py - l.oy) / l.cell);
  if (x < 0 || y < 0 || x >= l.w || y >= l.h) return -1;
  return y * l.w + x;
}

const inGrid = (L: Layout, x: number, y: number) => x >= 0 && y >= 0 && x < L.w && y < L.h;

// ---------------------------------------------------------------- main draw

export function draw(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  v: ViewState,
) {
  const L = computeLayout(cw, ch, v.level);

  const theme = v.theme ?? DEFAULT_THEME;
  drawSky(ctx, cw, ch, v.time, {
    mini: v.mini,
    avoid: { x: L.ox, y: L.oy, w: L.w * L.cell, h: L.h * L.cell },
    moons: v.level.emitters.map((e) => ({ x: cx(L, e.x), y: L.oy - L.cell * 0.7, r: L.cell * 0.38 })),
    theme,
  });

  // The punch: a brief scale-up of everything on the board at the moment of
  // solving. Applied around the board's centre, after the sky, so the world
  // holds still and only the puzzle leans towards you.
  const punch = v.punch ?? 0;
  ctx.save();
  if (punch > 0) {
    const mx = L.ox + (L.w * L.cell) / 2, my = L.oy + (L.h * L.cell) / 2;
    ctx.translate(mx, my);
    ctx.scale(1 + 0.04 * punch, 1 + 0.04 * punch);
    ctx.translate(-mx, -my);
  }

  drawGrid(ctx, L, v);
  if (v.level.galaxy?.length) {
    drawMilkyWay(ctx, v.level.galaxy.map((i) => ({ x: cx(L, i % L.w), y: cy(L, Math.floor(i / L.w)) })),
      L.cell, v.time);
  }
  drawGates(ctx, L, v);

  const tiles = v.level.tiles;

  // Beams sit under the furniture so pieces read as solid objects the light
  // strikes, rather than decals floating on top of it.
  if (v.sim) drawBeams(ctx, L, v);
  v.particles?.draw(ctx, L, v.time);

  // How far the reveal has got, and when the light first reaches each cell.
  // Without this, rings snapped on and pieces flared the instant Shine was
  // pressed — the outcome was correct but it arrived before the beam did.
  const front = frontOf(v);
  const arrival = arrivalOrders(v);

  const comets = cometCells(v.level);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.kind === "empty" || (t.track && t.track.length > 1)) continue;
    drawTile(ctx, L, i, t, v, front, arrival, theme, comets);
  }
  // A second hint on a cell shows a ghost of exactly what belongs there.
  for (const [i, t] of v.hintGhost ?? []) {
    if (tiles[i]?.kind !== "empty") continue;
    ctx.save();
    ctx.globalAlpha = 0.32 + 0.14 * Math.sin(v.time * 3);
    drawTile(ctx, L, i, t, { ...v, sim: null }, front, arrival, theme, comets);
    ctx.restore();
  }
  // Moving pieces are drawn where they are *between* cells, so they glide.
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!t.track || t.track.length <= 1) continue;
    const pos = trackPos(t, v.clock ?? v.tick);
    ctx.save();
    ctx.translate(L.ox + (pos.x + 0.5) * L.cell, L.oy + (pos.y + 0.5) * L.cell);
    if (t.kind === "asteroid") {
      const here = Math.round(pos.y) * L.w + Math.round(pos.x);
      const hit = (v.sim?.asteroidsHit.has(here) ?? false) && front >= (arrival.get(here) ?? Infinity);
      drawAsteroid(ctx, L.cell, v.time, i, hit);
    } else if (t.kind === "wall") {
      drawWall(ctx, L.cell, t, v);
    }
    ctx.restore();
  }

  drawMoon(ctx, L, v);
  drawFx(ctx, L, v.time);
  ctx.restore();

  if (v.winGlow > 0) drawWinGlow(ctx, cw, ch, v);
  if (!v.mini) drawGrain(ctx, cw, ch);
}

function drawGrid(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  const { cell, ox, oy } = L;
  const r = cell * 0.14;

  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      const px = ox + x * cell, py = oy + y * cell;
      const inset = cell * 0.055;

      roundRect(ctx, px + inset, py + inset, cell - inset * 2, cell - inset * 2, r);
      ctx.fillStyle = i === v.hover ? P.cellHover : P.cellFill;
      ctx.fill();

      if (v.hint.has(i)) {
        const pulse = 0.35 + 0.35 * Math.sin(v.time * 4);
        ctx.strokeStyle = alpha(P.accentWarm, pulse);
        ctx.lineWidth = Math.max(1.5, cell * 0.045);
        ctx.stroke();
      }
    }
  }

  // Corner ticks instead of full rules: keeps the graphic grid of the original
  // legible without boxing every cell in.
  ctx.strokeStyle = P.gridLine;
  ctx.lineWidth = Math.max(1, cell * 0.022);
  ctx.lineCap = "round";
  const t = cell * 0.15;
  for (let y = 0; y <= L.h; y++) {
    for (let x = 0; x <= L.w; x++) {
      const px = ox + x * cell, py = oy + y * cell;
      ctx.beginPath();
      ctx.moveTo(px - t, py); ctx.lineTo(px + t, py);
      ctx.moveTo(px, py - t); ctx.lineTo(px, py + t);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- beams

/** The advancing front, in hops from the moon. Infinite when nothing is running. */
export function frontOf(v: { sim: SimResult | null; reveal: number }): number {
  if (!v.sim || !v.sim.segments.length) return Infinity;
  let maxOrder = 0;
  for (const s of v.sim.segments) if (s.order > maxOrder) maxOrder = s.order;
  return v.reveal * (maxOrder + 1);
}

/** Cell index -> the earliest hop at which light arrives there. */
/** The segments to draw: on a cube, only those on the face being looked at. */
export function visibleSegments(v: { level: Level; sim: SimResult | null; face?: number }): Segment[] {
  if (!v.sim) return [];
  if (!v.level.cube) return v.sim.segments;
  const f = v.face ?? 0;
  return v.sim.segments.filter((s) => (s.face ?? 0) === f);
}

function arrivalOrders(v: ViewState): Map<number, number> {
  const m = new Map<number, number>();
  if (!v.sim) return m;
  for (const s of visibleSegments(v)) {
    const i = s.y1 * v.level.w + s.x1;
    const prev = m.get(i);
    if (prev === undefined || s.order < prev) m.set(i, s.order);
  }
  return m;
}

function drawBeams(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  const segs = visibleSegments(v);
  if (!segs.length) return;
  const front = frontOf(v);
  const flare = v.flare ?? 0;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /**
   * How far along its own hop a segment has been drawn, 0..1.
   *
   * A segment of order N owns the interval [N-1, N] of the advancing front, so
   * it grows from nothing to full length while the front crosses that cell.
   */
  // A segment spans `span` hops of the front (one, normally; a satellite's
  // carry takes as long as it holds the light).
  const progress = (s: Segment) => {
    const span = s.span ?? 1;
    return Math.min(1, Math.max(0, (front - (s.order - span)) / span));
  };
  const galaxy = new Set(v.level.galaxy ?? []);
  const inGalaxy = (s: Segment) =>
    (inGrid(L, s.x1, s.y1) && galaxy.has(s.y1 * L.w + s.x1)) ||
    (inGrid(L, s.x0, s.y0) && galaxy.has(s.y0 * L.w + s.x0));

  // Three passes: a wide soft halo, a bright core, and a stream of glitter
  // flowing along the core in the direction the light travels.
  for (const pass of [0, 1, 2] as const) {
    for (const s of segs) {
      const p = progress(s);
      if (p <= 0) continue;
      const c = lightColor(s.light);

      if (s.warp) { if (pass === 1) drawWarp(ctx, L, s, p, v); continue; }
      if (s.carry) { if (pass === 1) drawCarry(ctx, L, s, p, v); continue; }

      let a = cx(L, s.x0), b = cy(L, s.y0);
      let c2 = cx(L, s.x1), d2 = cy(L, s.y1);
      // Warp gates sit on the rim, half a cell out: light runs into the gate
      // and comes back out of its twin, and is never drawn past the edge.
      if (s.gate === "out" || s.edge === "out") { c2 = (a + c2) / 2; d2 = (b + d2) / 2; }
      if (s.gate === "in" || s.edge === "in") { a = (a + c2) / 2; b = (b + d2) / 2; }
      const ex = a + (c2 - a) * p, ey = b + (d2 - b) * p;
      // Over the Milky Way the light shines brighter.
      const glow = inGalaxy(s) ? 1 : 0;

      // Light that runs off the board dissolves rather than stopping dead:
      // the last half-cell fades to nothing, and fizzes (see emitGlitter).
      const leaving = !inGrid(L, s.x1, s.y1) && !s.gate && !s.edge;
      const colourAt = (a0: number) => {
        if (!leaving) return alpha(c, a0);
        const g = ctx.createLinearGradient(a, b, c2, d2);
        g.addColorStop(0, alpha(c, a0));
        g.addColorStop(0.45, alpha(c, a0));
        g.addColorStop(1, alpha(c, 0));
        return g;
      };

      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(ex, ey);
      if (pass === 0) {
        ctx.strokeStyle = colourAt(0.16 + 0.12 * flare + 0.16 * glow);
        ctx.lineWidth = L.cell * (0.34 + 0.2 * flare + 0.18 * glow);
        ctx.stroke();
      } else if (pass === 1) {
        ctx.strokeStyle = colourAt(0.95);
        ctx.lineWidth = L.cell * (0.085 + 0.05 * flare + 0.04 * glow);
        ctx.stroke();
        if (glow) {
          ctx.strokeStyle = alpha("#ffffff", 0.55 + 0.25 * Math.sin(v.time * 6 + s.order));
          ctx.lineWidth = L.cell * 0.04;
          ctx.stroke();
        }
        if (flare > 0) {
          ctx.strokeStyle = leaving ? colourAt(0.8 * flare) : alpha("#ffffff", 0.8 * flare);
          ctx.lineWidth = L.cell * 0.05;
          ctx.stroke();
        }
      } else {
        // Glitter: short bright dashes, with the dash pattern marching along
        // the segment so the light visibly flows away from the moon.
        const len = L.cell;
        ctx.setLineDash([len * 0.02, len * 0.23]);
        ctx.lineDashOffset = -v.time * len * 1.6;
        ctx.strokeStyle = leaving ? colourAt(0.85) : alpha("#ffffff", 0.85);
        ctx.lineWidth = L.cell * 0.05;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // The head of the beam: a bright mote with a glint, a nod to the original's
  // travelling ball. Only segments still growing have a head.
  for (const s of segs) {
    if (s.warp || s.carry) continue;
    const p = progress(s);
    if (p <= 0 || p >= 1) continue;
    let a = cx(L, s.x0), b = cy(L, s.y0), c2 = cx(L, s.x1), d2 = cy(L, s.y1);
    if (s.gate === "out" || s.edge === "out") { c2 = (a + c2) / 2; d2 = (b + d2) / 2; }
    if (s.gate === "in" || s.edge === "in") { a = (a + c2) / 2; b = (b + d2) / 2; }
    const hx = a + (c2 - a) * p;
    const hy = b + (d2 - b) * p;
    const c = lightColor(s.light);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, L.cell * 0.45);
    g.addColorStop(0, alpha(c, 0.95));
    g.addColorStop(1, alpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, L.cell * 0.45, 0, Math.PI * 2);
    ctx.fill();
    glint(ctx, hx, hy, L.cell * 0.5, 0.9, "#ffffff");
  }

  // On a cube, where the light goes over the edge — or comes over it — the
  // rim glows: a doorway to another face.
  for (const s of segs) {
    if (!s.edge) continue;
    const p = progress(s);
    if (s.edge === "out" ? p < 1 : p <= 0) continue;
    const rx = (cx(L, s.x0) + cx(L, s.x1)) / 2, ry = (cy(L, s.y0) + cy(L, s.y1)) / 2;
    const c = lightColor(s.light);
    const pulse = 0.7 + 0.3 * Math.sin(v.time * 5 + s.order);
    const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, L.cell * 0.6);
    g.addColorStop(0, alpha(c, 0.7 * pulse));
    g.addColorStop(1, alpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(rx, ry, L.cell * 0.6, 0, Math.PI * 2); ctx.fill();
    glint(ctx, rx, ry, L.cell * 0.45 * pulse, 0.8, "#ffffff");
  }

  if (v.particles && v.dt) emitGlitter(v.particles, L, segs, progress, v);
}

/**
 * Throw sparkles off the lit parts of the beam.
 *
 * Rate is per cell of lit beam, so a long beam glitters more than a short one
 * without either looking busier per unit length. Where the light leaves the
 * board, a denser fizz of motes drifts outward as the beam dissolves.
 */
function emitGlitter(
  ps: Particles,
  L: Layout,
  segs: Segment[],
  progress: (s: Segment) => number,
  v: ViewState,
) {
  const dt = v.dt!;
  const now = v.time;
  for (const s of segs) {
    if (s.warp || s.carry) continue;
    const p = progress(s);
    if (p <= 0) continue;
    const c = lightColor(s.light);
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0;

    // Along the beam.
    let expect = 3.2 * p * dt * (1 + (v.flare ?? 0) * 6);
    while (expect > 0) {
      if (Math.random() < expect) {
        const k = Math.random() * p;
        ps.add({
          x: s.x0 + 0.5 + dx * k + rand(-0.06, 0.06),
          y: s.y0 + 0.5 + dy * k + rand(-0.06, 0.06),
          vx: rand(-0.12, 0.12) + dx * 0.15, vy: rand(-0.12, 0.12) + dy * 0.15,
          g: -0.08, born: now, life: rand(0.5, 1.0),
          size: rand(0.012, 0.03), color: Math.random() < 0.35 ? "#ffffff" : c,
          glint: Math.random() < 0.3, twinkle: Math.random() * 6,
        });
      }
      expect -= 1;
    }

    // Dissolving off the edge.
    if (!inGrid(L, s.x1, s.y1) && !s.gate && !s.edge && p > 0.5) {
      let fizz = 14 * dt;
      while (fizz > 0) {
        if (Math.random() < fizz) {
          const k = rand(0.35, p);
          ps.add({
            x: s.x0 + 0.5 + dx * k, y: s.y0 + 0.5 + dy * k,
            vx: dx * rand(0.3, 0.8) + rand(-0.3, 0.3), vy: dy * rand(0.3, 0.8) + rand(-0.3, 0.3),
            g: 0, born: now, life: rand(0.4, 0.8),
            size: rand(0.015, 0.035), color: Math.random() < 0.5 ? "#ffffff" : c,
            glint: Math.random() < 0.5, twinkle: Math.random() * 6,
          });
        }
        fizz -= 1;
      }
    }
  }
}

/**
 * A satellite carrying light to its dish: a dotted arc over the board, with the
 * light riding along it as a glowing packet for as long as the satellite holds
 * it. The delay is visible — you watch the light wait.
 */
function drawCarry(ctx: CanvasRenderingContext2D, L: Layout, s: Segment, p: number, v: ViewState) {
  const ax = cx(L, s.x0), ay = cy(L, s.y0), bx = cx(L, s.x1), by = cy(L, s.y1);
  const mx = (ax + bx) / 2, my = Math.min(ay, by) - L.cell * 1.2;
  const c = lightColor(s.light);
  ctx.setLineDash([L.cell * 0.05, L.cell * 0.12]);
  ctx.lineDashOffset = -v.time * L.cell;
  ctx.strokeStyle = alpha(c, 0.35);
  ctx.lineWidth = L.cell * 0.035;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.setLineDash([]);
  if (p <= 0 || p >= 1) return;
  const q = 1 - p;
  const x = q * q * ax + 2 * q * p * mx + p * p * bx;
  const y = q * q * ay + 2 * q * p * my + p * p * by;
  const g = ctx.createRadialGradient(x, y, 0, x, y, L.cell * 0.35);
  g.addColorStop(0, alpha(c, 0.95));
  g.addColorStop(1, alpha(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, L.cell * 0.35, 0, Math.PI * 2); ctx.fill();
  glint(ctx, x, y, L.cell * 0.4, 0.9, "#ffffff");
}

/** Warp gates on the rim, in their pair's colour, flashing as light passes. */
function drawGates(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  for (const wp of v.level.warps ?? []) {
    const flash = v.gateFlash?.get(`${wp.axis}:${wp.index}`) ?? 0;
    if (wp.axis === "row") {
      const y = L.oy + (wp.index + 0.5) * L.cell;
      drawWarpGate(ctx, L.ox - L.cell * 0.12, y, L.cell, true, wp.hue, v.time, flash);
      drawWarpGate(ctx, L.ox + L.w * L.cell + L.cell * 0.12, y, L.cell, true, wp.hue, v.time, flash);
    } else {
      const x = L.ox + (wp.index + 0.5) * L.cell;
      drawWarpGate(ctx, x, L.oy - L.cell * 0.12, L.cell, false, wp.hue, v.time, flash);
      drawWarpGate(ctx, x, L.oy + L.h * L.cell + L.cell * 0.12, L.cell, false, wp.hue, v.time, flash);
    }
  }
}

/**
 * Where a moving piece is at a moment of board time. It dwells in each cell
 * for most of a tick and glides to the next at the end, so the cell it looks
 * like it is in is the cell the physics has it in.
 */
export function trackPos(t: Tile, clock: number): { x: number; y: number } {
  const tr = t.track!;
  const n = tr.length;
  const c = clock + (t.phase ?? 0);
  const base = Math.floor(c);
  const frac = c - base;
  const a = tr[((base % n) + n) % n], b = tr[(((base + 1) % n) + n) % n];
  const k = frac < 0.6 ? 0 : (frac - 0.6) / 0.4;
  const e = k * k * (3 - 2 * k);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

/** Shooting-star pieces by their place in the sequence. */
function cometCells(level: Level): Map<number, number> {
  const m = new Map<number, number>();
  level.tiles.forEach((t, i) => { if (t.kind === "comet") m.set(t.seq ?? 0, i); });
  return m;
}

function drawWarp(ctx: CanvasRenderingContext2D, L: Layout, s: Segment, fade: number, v: ViewState) {
  const c = lightColor(s.light);
  ctx.setLineDash([L.cell * 0.09, L.cell * 0.11]);
  ctx.lineDashOffset = -v.time * L.cell * 1.4;
  ctx.strokeStyle = alpha(c, 0.32 * fade);
  ctx.lineWidth = L.cell * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx(L, s.x0), cy(L, s.y0));
  ctx.lineTo(cx(L, s.x1), cy(L, s.y1));
  ctx.stroke();
  ctx.setLineDash([]);
}

const cx = (L: Layout, x: number) => L.ox + (x + 0.5) * L.cell;
const cy = (L: Layout, y: number) => L.oy + (y + 0.5) * L.cell;

// ---------------------------------------------------------------- tiles

function drawTile(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  i: number,
  t: Tile,
  v: ViewState,
  front: number,
  arrival: Map<number, number>,
  theme: Theme = DEFAULT_THEME,
  comets: Map<number, number> = new Map(),
) {
  const x = i % L.w, y = Math.floor(i / L.w);
  const px = cx(L, x), py = cy(L, y);
  const s = L.cell;

  // A piece the light is currently striking brightens — but only once the beam
  // has actually got there.
  const reached = arrival.has(i) && front >= (arrival.get(i) ?? Infinity);
  const struck = (v.sim?.touched.has(i) ?? false) && (v.sim === null || reached);
  const lit = struck ? 1 : 0.78;

  ctx.save();
  ctx.translate(px, py);

  switch (t.kind) {
    case "wall": drawWall(ctx, s, t, v); break;
    case "mirrorA": drawMirror(ctx, s, -1, lit); break;
    case "mirrorB": drawMirror(ctx, s, 1, lit); break;
    case "splitter": drawSplitter(ctx, s, lit); break;
    case "crystal": {
      drawCrystal(ctx, s, lit, v.time);
      const source = v.sim ?? v.previewSim ?? null;
      const inDir = source ? incomingWhite(source, i, L.w) : null;
      if (inDir) drawCrystalExits(ctx, s, inDir, v.sim ? (reached ? 1 : 0.4) : 0.65, v.time);
      break;
    }
    case "tint": drawTint(ctx, s, t.mask ?? WHITE, t.from, lit); break;
    case "portal": drawPortal(ctx, s, t.pair ?? 0, v); break;
    case "blackhole": drawHole(ctx, s, true, v); break;
    case "whitehole": drawHole(ctx, s, false, v); break;
    case "star": drawStar(ctx, s, v.starsLit.has(i), v.time, i); break;
    case "terrain": drawTerrain(ctx, s, theme.terrain, i); break;
    case "asteroid": drawAsteroid(ctx, s, v.time, i, false); break;
    case "satellite": {
      const carry = v.sim?.segments.find((g) => g.carry && g.x0 === x && g.y0 === y);
      const span = carry?.span ?? 1;
      const p = carry ? (front - (carry.order - span)) / span : 0;
      drawSatellitePiece(ctx, s, v.time, t.delay ?? 1, p > 0 && p < 1 ? 1 : 0);
      break;
    }
    case "dish": {
      const carry = v.sim?.segments.find((g) => g.carry && g.x1 === x && g.y1 === y);
      const done = carry ? front - carry.order : -1;
      drawDish(ctx, s, v.time, done >= 0 && done < 1.5 ? 1 - done / 1.5 : 0);
      break;
    }
    case "comet": {
      const seq = t.seq ?? 0;
      const got = v.cometCollected ?? 0;
      const state = seq < got ? "collected" : seq === got ? "active" : "waiting";
      // The tail streams back towards where the comet came from.
      const other = comets.get(seq > 0 ? seq - 1 : seq + 1);
      let dir = -Math.PI * 0.75;
      if (other !== undefined) {
        const ox = other % L.w, oy = Math.floor(other / L.w);
        dir = seq > 0 ? Math.atan2(oy - y, ox - x) : Math.atan2(y - oy, x - ox);
      }
      drawCometPiece(ctx, s, v.time, seq, state, dir);
      break;
    }
    case "receptor":
      drawReceptor(ctx, s, t.mask ?? WHITE,
                   (v.sim?.satisfied.has(i) ?? false) && reached, v);
      break;
  }

  if (t.placed) {
    // A quiet dot marks pieces the player put down, so a board can be read at
    // a glance for what is yours and what is the level's.
    ctx.fillStyle = alpha(P.accent, 0.55);
    ctx.beginPath();
    ctx.arc(0, s * 0.4, s * 0.028, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawMirror(ctx: CanvasRenderingContext2D, s: number, slope: number, lit: number) {
  const r = s * 0.30;
  ctx.rotate(slope > 0 ? Math.PI / 4 : -Math.PI / 4);

  // A mirror is a bar: a bright reflective face and a dull backing, so which
  // way it is turned is readable instantly.
  const w = s * 0.10;
  roundRect(ctx, -r, -w / 2, r * 2, w, w / 2);
  const g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
  g.addColorStop(0, alpha("#ffffff", 0.92 * lit));
  g.addColorStop(0.5, alpha("#cfc4ff", 0.72 * lit));
  g.addColorStop(1, alpha("#6a5da8", 0.75 * lit));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = alpha("#ffffff", 0.30 * lit);
  ctx.lineWidth = Math.max(0.8, s * 0.012);
  ctx.stroke();
}

function drawSplitter(ctx: CanvasRenderingContext2D, s: number, lit: number) {
  const r = s * 0.27;
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
  ctx.closePath();
  ctx.fillStyle = alpha("#b8a6ff", 0.16 * lit);
  ctx.fill();
  ctx.strokeStyle = alpha("#e6ddff", 0.92 * lit);
  ctx.lineWidth = Math.max(1.4, s * 0.045);
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * The crystal: a faceted gem, each facet tinted one of the three colours it
 * makes, with a highlight that slowly catches the light. The facets say "this
 * makes colours"; the exit arrows (drawCrystalExits) say where each one goes.
 */
function drawCrystal(ctx: CanvasRenderingContext2D, s: number, lit: number, time: number) {
  const r = s * 0.31;
  const A = { x: 0, y: -r }, B = { x: r * 0.9, y: r * 0.6 }, C = { x: -r * 0.9, y: r * 0.6 };
  const O = { x: 0, y: r * 0.08 };
  const facet = (p: { x: number; y: number }, q: { x: number; y: number }, col: string, a: number) => {
    ctx.beginPath();
    ctx.moveTo(O.x, O.y); ctx.lineTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.closePath();
    ctx.fillStyle = alpha(col, a * lit);
    ctx.fill();
  };
  facet(A, B, lightColor(Chan.R), 0.42);
  facet(B, C, lightColor(Chan.G), 0.38);
  facet(C, A, lightColor(Chan.B), 0.42);

  // Facet edges.
  ctx.strokeStyle = alpha("#ffffff", 0.35 * lit);
  ctx.lineWidth = Math.max(0.8, s * 0.014);
  ctx.beginPath();
  for (const p of [A, B, C]) { ctx.moveTo(O.x, O.y); ctx.lineTo(p.x, p.y); }
  ctx.stroke();

  // Outline.
  ctx.beginPath();
  ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.closePath();
  ctx.strokeStyle = alpha("#f7f2ff", 0.95 * lit);
  ctx.lineWidth = Math.max(1.4, s * 0.042);
  ctx.lineJoin = "round";
  ctx.stroke();

  // A glint that wanders round the gem.
  const g = (time * 0.6) % 3;
  const gp = g < 1 ? A : g < 2 ? B : C;
  glint(ctx, gp.x * 0.8, gp.y * 0.8, s * 0.22, 0.75 * lit, "#ffffff");
}

/** Direction of the white light entering a cell, if any does. */
function incomingWhite(sim: SimResult, i: number, w: number): { dx: number; dy: number } | null {
  const x = i % w, y = Math.floor(i / w);
  for (const s of sim.segments) {
    if (s.warp || s.light !== WHITE || s.x1 !== x || s.y1 !== y) continue;
    return { dx: Math.sign(s.x1 - s.x0), dy: Math.sign(s.y1 - s.y0) };
  }
  return null;
}

/**
 * Where each colour leaves the crystal, drawn on the actual exit sides.
 *
 * The crystal has no orientation of its own — which side a colour leaves
 * depends on which side the light came in. The rule is orientation-free from
 * the light's point of view: red peels off to its left, blue to its right,
 * green carries straight on. So these arrows are computed from the real
 * incoming beam: faint while you are still building, bright once it is lit.
 */
function drawCrystalExits(
  ctx: CanvasRenderingContext2D,
  s: number,
  d: { dx: number; dy: number },
  strength: number,
  time: number,
) {
  // Screen y points down, so the light's left is (dy, -dx) and its right is (-dy, dx).
  const exits: [number, number, Light][] = [
    [d.dy, -d.dx, Chan.R],
    [d.dx, d.dy, Chan.G],
    [-d.dy, d.dx, Chan.B],
  ];
  const bob = 0.03 * Math.sin(time * 4);
  for (const [ux, uy, col] of exits) {
    const c = lightColor(col);
    const r0 = s * (0.33 + bob), r1 = s * (0.5 + bob);
    const tipX = ux * r1, tipY = uy * r1;
    const baseX = ux * r0, baseY = uy * r0;
    const px = -uy * s * 0.085, py = ux * s * 0.085;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px, baseY + py);
    ctx.lineTo(baseX - px, baseY - py);
    ctx.closePath();
    ctx.fillStyle = alpha(c, 0.95 * strength);
    ctx.fill();
  }
}

/**
 * A tint converts one colour into another, so it is drawn as exactly that: the
 * colour going in on one side, the colour coming out on the other, split by a
 * diagonal.
 */
function drawTint(
  ctx: CanvasRenderingContext2D,
  s: number,
  to: Light,
  from: Light | undefined,
  lit: number,
) {
  const r = s * 0.26;
  const cTo = lightColor(to);
  const cFrom = from === undefined ? P.inkDim : lightColor(from);

  roundRect(ctx, -r, -r, r * 2, r * 2, s * 0.07);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = alpha(cFrom, 0.34 * lit);
  ctx.beginPath();
  ctx.moveTo(-r, -r); ctx.lineTo(r, -r); ctx.lineTo(-r, r); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = alpha(cTo, 0.55 * lit);
  ctx.beginPath();
  ctx.moveTo(r, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(r, -r); ctx.lineTo(-r, r);
  ctx.strokeStyle = alpha(cTo, 0.85 * lit);
  ctx.lineWidth = Math.max(1.2, s * 0.03);
  ctx.stroke();

  roundRect(ctx, -r, -r, r * 2, r * 2, s * 0.07);
  ctx.strokeStyle = alpha(cTo, 0.9 * lit);
  ctx.lineWidth = Math.max(1.4, s * 0.042);
  ctx.stroke();

  const pip = (dx: number, col: string) => {
    ctx.beginPath();
    ctx.arc(dx, 0, s * 0.03, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  };
  pip(-s * 0.075, cFrom);
  pip(s * 0.075, cTo);
}

/**
 * A black hole swallows light; its white hole gives it back. Drawn as a matched
 * pair — same rings, inverted.
 */
function drawHole(ctx: CanvasRenderingContext2D, s: number, black: boolean, v: { time: number }) {
  const r = s * 0.30;
  const spin = v.time * (black ? 1.1 : -1.1);

  if (black) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "#05030d");
    g.addColorStop(0.72, "#0b0718");
    g.addColorStop(1, alpha("#8f6bd6", 0.55));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  } else {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, alpha("#fff6e0", 0.95));
    g.addColorStop(0.55, alpha("#ffe6a8", 0.45));
    g.addColorStop(1, alpha("#ffe6a8", 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.rotate(spin);
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.94 - k * 0.26), k * Math.PI, k * Math.PI + Math.PI * 1.15);
    ctx.strokeStyle = alpha(black ? "#b79bff" : "#ffe6a8", 0.85 - k * 0.28);
    ctx.lineWidth = Math.max(1.2, s * 0.032);
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

function drawWall(ctx: CanvasRenderingContext2D, s: number, _t: Tile, _v: unknown) {
  const r = s * 0.34;
  roundRect(ctx, -r, -r, r * 2, r * 2, s * 0.09);
  ctx.fillStyle = P.wall;
  ctx.fill();
  ctx.strokeStyle = P.wallEdge;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.strokeStyle = alpha("#ffffff", 0.045);
  ctx.lineWidth = Math.max(0.8, s * 0.014);
  for (let k = -4; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(-r, k * s * 0.09);
    ctx.lineTo(r, k * s * 0.09 + r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPortal(ctx: CanvasRenderingContext2D, s: number, pair: number, v: { time: number }) {
  const r = s * 0.26;
  const hue = pair % 2 === 0 ? "#c8a6ff" : "#8ef0e4";
  ctx.rotate(v.time * 0.6 * (pair % 2 ? -1 : 1));
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 - k * 0.26), k * 2.1, k * 2.1 + Math.PI * 1.25);
    ctx.strokeStyle = alpha(hue, 0.85 - k * 0.2);
    ctx.lineWidth = Math.max(1.2, s * 0.035);
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- stars

/**
 * Each star has its own pastel hue, shifting gently the way real stars
 * scintillate. The colour is decoration only — any light collects any star —
 * so it shimmers rather than holding still, to avoid reading as a colour
 * requirement next to the rings, which do mean their colour.
 */
const STAR_HUES = [46, 330, 200, 150, 276, 22];

function starHue(i: number, time: number) {
  return STAR_HUES[i % STAR_HUES.length] + 16 * Math.sin(time * 1.3 + i * 1.7);
}

/**
 * A four-pointed sparkle with curved, pinched sides, in the style of a sticker
 * star: the vertical points a little longer than the horizontal ones, a dark
 * outline, and a lighter inner highlight.
 */
function starPath(ctx: CanvasRenderingContext2D, rv: number, rh: number, pinch = 0.18) {
  ctx.beginPath();
  ctx.moveTo(0, -rv);
  ctx.quadraticCurveTo(rh * pinch, -rv * pinch, rh, 0);
  ctx.quadraticCurveTo(rh * pinch, rv * pinch, 0, rv);
  ctx.quadraticCurveTo(-rh * pinch, rv * pinch, -rh, 0);
  ctx.quadraticCurveTo(-rh * pinch, -rv * pinch, 0, -rv);
  ctx.closePath();
}

export function drawStar(ctx: CanvasRenderingContext2D, s: number, lit: boolean, time: number, i = 0) {
  const h = starHue(i, time);
  const breathe = 1 + 0.06 * Math.sin(time * 2.2 + i);
  const pulse = lit ? 1 + 0.1 * Math.sin(time * 5 + i) : breathe;
  const rv = s * (lit ? 0.3 : 0.24) * pulse;
  const rh = rv * 0.8;

  if (lit) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.62);
    g.addColorStop(0, `hsla(${h}, 100%, 75%, 0.55)`);
    g.addColorStop(1, `hsla(${h}, 100%, 75%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.rotate(lit ? Math.sin(time * 1.5 + i) * 0.12 : 0);

  starPath(ctx, rv, rh);
  ctx.fillStyle = `hsla(${h}, 95%, ${lit ? 66 : 58}%, ${lit ? 1 : 0.42})`;
  ctx.fill();
  ctx.strokeStyle = `hsla(${h}, 55%, ${lit ? 28 : 40}%, ${lit ? 0.95 : 0.7})`;
  ctx.lineWidth = Math.max(1, s * (lit ? 0.035 : 0.028));
  ctx.lineJoin = "round";
  ctx.stroke();

  // The lighter band on the inside, like the reference's two-tone sticker look.
  ctx.save();
  ctx.translate(-rh * 0.08, -rv * 0.1);
  starPath(ctx, rv * 0.5, rh * 0.5, 0.2);
  ctx.fillStyle = `hsla(${h + 10}, 100%, ${lit ? 86 : 74}%, ${lit ? 0.9 : 0.35})`;
  ctx.fill();
  ctx.restore();
  ctx.restore();

  if (lit) {
    // Glints that flicker at the tips, and a speck orbiting the star.
    const k = 0.5 + 0.5 * Math.sin(time * 6 + i * 2);
    glint(ctx, 0, -rv * 0.9, s * 0.18 * k, 0.8 * k, "#ffffff");
    const a = time * 2.4 + i;
    glint(ctx, Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42, s * 0.1, 0.8, `hsl(${h}, 100%, 85%)`);
  }
}

// ---------------------------------------------------------------- rings

function drawReceptor(
  ctx: CanvasRenderingContext2D,
  s: number,
  mask: Light,
  satisfied: boolean,
  v: { time: number },
) {
  const c = lightColor(mask);
  const r = s * 0.27;

  if (satisfied) {
    const pulse = 0.55 + 0.25 * Math.sin(v.time * 4);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.62);
    g.addColorStop(0, alpha(c, pulse));
    g.addColorStop(1, alpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.fill();
  }

  // The ring from the 2015 version, kept almost verbatim — it was already the
  // clearest thing on that screen.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(c, satisfied ? 1 : 0.78);
  ctx.lineWidth = Math.max(2, s * (satisfied ? 0.095 : 0.07));
  ctx.stroke();

  if (satisfied) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = alpha(c, 0.9);
    ctx.fill();
    glint(ctx, 0, 0, s * 0.45 * (0.7 + 0.3 * Math.sin(v.time * 3)), 0.7, "#ffffff");
    return;
  }

  // Channel pips: which of R/G/B this ring needs when it needs more than one.
  // White and single-channel rings are unambiguous from the ring's own colour.
  if (mask === WHITE) return;
  const chans = [Chan.R, Chan.G, Chan.B].filter((ch) => mask & ch);
  if (chans.length < 2) return;
  const gap = s * 0.075;
  chans.forEach((ch, k) => {
    ctx.beginPath();
    ctx.arc((k - (chans.length - 1) / 2) * gap, 0, s * 0.026, 0, Math.PI * 2);
    ctx.fillStyle = lightColor(ch);
    ctx.fill();
  });
}

// ---------------------------------------------------------------- the moon

function drawMoon(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  if (v.level.cube && (v.face ?? 0) !== 0) { drawFaceLabel(ctx, L, v.face ?? 0); return; }
  for (const e of v.level.emitters) {
    const px = cx(L, e.x);
    const py = L.oy - L.cell * 0.7;
    const r = L.cell * 0.38;
    const bob = Math.sin(v.time * 1.1) * L.cell * 0.035;
    const release = v.sim && v.reveal > 0 && v.reveal < 1.1 ? Math.max(0, 1 - v.reveal * 2.2) : 0;
    // The clock: the moon slowly sinks as its time runs out.
    const sink = v.timer === undefined ? 0 : (1 - v.timer) * L.cell * 0.12;
    ctx.save();
    ctx.translate(px, py + bob + sink);
    if (v.timer !== undefined) drawMoonClock(ctx, r, v.timer, v.time);
    paintMoon(ctx, r, v.moonLit ?? 0.35, v.time, release, P.moonGlow);
    ctx.restore();
  }
}

const FACE_NAMES = ["front", "right", "back", "left", "top", "bottom"];

/** Away from the front, the moon is round the other side: say which face this is. */
function drawFaceLabel(ctx: CanvasRenderingContext2D, L: Layout, face: number) {
  ctx.save();
  ctx.font = `700 ${Math.max(9, L.cell * 0.32)}px "Pixelify Sans", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = alpha("#e8dcff", 0.6);
  ctx.fillText(`${FACE_NAMES[face]} face`, L.ox + (L.w * L.cell) / 2, L.oy - L.cell * 0.6);
  ctx.restore();
}

/**
 * A ring round the moon that drains as its time runs out — gold while there
 * is plenty, turning rose and breathing faster in the last fifth.
 */
function drawMoonClock(ctx: CanvasRenderingContext2D, r: number, left: number, time: number) {
  const R = r * 1.55;
  const low = left < 0.2;
  const pulse = low ? 0.6 + 0.4 * Math.sin(time * 9) : 1;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.strokeStyle = alpha("#ffffff", 0.08);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  if (left > 0) {
    ctx.strokeStyle = alpha(low ? "#ff8fb1" : "#ffd27d", 0.85 * pulse);
    ctx.shadowColor = low ? "#ff8fb1" : "#ffd27d";
    ctx.shadowBlur = r * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.stroke();
    // A bright bead on the leading end, like the moon's own satellite.
    const a = -Math.PI / 2 + Math.PI * 2 * left;
    ctx.fillStyle = alpha("#ffffff", 0.9 * pulse);
    ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, ctx.lineWidth * 0.75, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawWinGlow(ctx: CanvasRenderingContext2D, w: number, h: number, v: ViewState) {
  // A warm wash, brightest at the top where the moon is, so winning reads as
  // the sky lifting rather than a flashbulb.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, alpha("#ffe6a8", 0.22 * v.winGlow));
  g.addColorStop(1, alpha("#c8a6ff", 0.06 * v.winGlow));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------- grain

let grain: HTMLCanvasElement | null = null;
function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // A single small noise tile, repeated: a printed, slightly analogue texture.
  if (!grain) {
    grain = document.createElement("canvas");
    grain.width = grain.height = 96;
    const g = grain.getContext("2d")!;
    const img = g.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 120 + Math.random() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 10;
    }
    g.putImageData(img, 0, 0);
  }
  const pat = ctx.createPattern(grain, "repeat");
  if (!pat) return;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------- helpers

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw a single piece into a small standalone canvas, for the tray icons.
 * Reuses the exact board drawing code so the tray can never drift from the
 * board visually.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  size: number,
  kind: Tile["kind"] | "warp" | "milkyway" | "moon" | "cube",
  mask?: Light,
  from?: Light,
) {
  ctx.clearRect(0, 0, size, size);
  // The things that are not tiles draw in canvas coordinates.
  if (kind === "milkyway") {
    const q = size / 4;
    drawMilkyWay(ctx, [{ x: q, y: q * 1.4 }, { x: q * 2.4, y: q * 2 }, { x: q * 3, y: q * 2.8 }], size * 0.45, 2);
    return;
  }
  if (kind === "warp") {
    drawWarpGate(ctx, size * 0.3, size / 2, size * 0.9, true, 0, 0.3, 0);
    drawWarpGate(ctx, size * 0.7, size / 2, size * 0.9, true, 0, 0.3, 0);
    return;
  }
  if (kind === "cube") {
    // A little isometric cube, its faces gridded like the board.
    const k = size * 0.3, ox = size / 2, oy = size / 2 + size * 0.04;
    const top: [number, number][] = [[ox, oy - k], [ox + k * 0.87, oy - k / 2], [ox, oy], [ox - k * 0.87, oy - k / 2]];
    const left: [number, number][] = [[ox - k * 0.87, oy - k / 2], [ox, oy], [ox, oy + k], [ox - k * 0.87, oy + k / 2]];
    const right: [number, number][] = [[ox, oy], [ox + k * 0.87, oy - k / 2], [ox + k * 0.87, oy + k / 2], [ox, oy + k]];
    const face = (pts: [number, number][], fill: string) => {
      ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = alpha("#ffffff", 0.5); ctx.lineWidth = Math.max(1, size * 0.03); ctx.stroke();
    };
    face(top, "#8f7bd6"); face(left, "#5b4aa8"); face(right, "#3f3384");
    // A beam over the edge, from the front-left face onto the right.
    ctx.strokeStyle = "#fff3c4"; ctx.lineWidth = Math.max(1.2, size * 0.05); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(ox - k * 0.6, oy + k * 0.15); ctx.lineTo(ox, oy + k * 0.45); ctx.lineTo(ox + k * 0.6, oy + k * 0.15); ctx.stroke();
    return;
  }
  if (kind === "moon") {
    ctx.save();
    ctx.translate(size * 0.56, size * 0.54);
    paintMoon(ctx, size * 0.3, 0.3, 0);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const s = size * 0.98;
  const still = { time: 0 };
  switch (kind) {
    case "mirrorA": drawMirror(ctx, s, -1, 1); break;
    case "mirrorB": drawMirror(ctx, s, 1, 1); break;
    case "splitter": drawSplitter(ctx, s, 1); break;
    case "crystal": drawCrystal(ctx, s, 1, 0.3); break;
    case "tint": drawTint(ctx, s, mask ?? WHITE, from, 1); break;
    case "blackhole": drawHole(ctx, s, true, still); break;
    case "whitehole": drawHole(ctx, s, false, still); break;
    case "portal": drawPortal(ctx, s, 0, still); break;
    case "star": drawStar(ctx, s, true, 0.4, 0); break;
    case "receptor": drawReceptor(ctx, s, mask ?? WHITE, false, still); break;
    case "wall": drawWall(ctx, s, { kind: "wall" }, still); break;
    case "asteroid": drawAsteroid(ctx, s, 0.5, 3, false); break;
    case "satellite": drawSatellitePiece(ctx, s, 0.2, 1, 0); break;
    case "dish": drawDish(ctx, s, 0.2, 0); break;
    case "comet": drawCometPiece(ctx, s, 0.3, 0, "active", -Math.PI * 0.75); break;
    case "terrain": drawTerrain(ctx, s, DEFAULT_THEME.terrain, 5); break;
  }
  ctx.restore();
}

export { idx };
