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
import { Segment, SimResult, resolveTiles } from "../engine/simulate";
import { PALETTE as P, alpha, lightColor } from "./theme";

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
  const moonRoom = 1.25;          // in cells
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

// ---------------------------------------------------------------- starfield

interface Star { x: number; y: number; r: number; phase: number; speed: number }
let starfield: Star[] = [];
let starfieldSize = "";

function ensureStarfield(w: number, h: number) {
  const key = `${w}x${h}`;
  if (key === starfieldSize) return;
  starfieldSize = key;
  // Deterministic so the sky does not reshuffle on every resize.
  let s = 20150601;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round((w * h) / 9000);
  starfield = Array.from({ length: n }, () => ({
    x: rnd() * w,
    y: rnd() * h,
    r: 0.4 + rnd() * 1.3,
    phase: rnd() * Math.PI * 2,
    speed: 0.3 + rnd() * 0.9,
  }));
}

// ---------------------------------------------------------------- main draw

export function draw(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  v: ViewState,
) {
  const L = computeLayout(cw, ch, v.level);

  drawSky(ctx, cw, ch, v);
  drawGrid(ctx, L, v);

  const tiles = resolveTiles(v.level, v.tick);

  // Beams sit under the furniture so pieces read as solid objects the light
  // strikes, rather than decals floating on top of it.
  if (v.sim) drawBeams(ctx, L, v);

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.kind === "empty") continue;
    drawTile(ctx, L, i, t, v);
  }

  drawMoon(ctx, L, v);
  if (v.winGlow > 0) drawWinGlow(ctx, cw, ch, v);
  drawGrain(ctx, cw, ch);
}

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, v: ViewState) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.18, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
  g.addColorStop(0, P.nightSoft);
  g.addColorStop(0.55, P.nightMid);
  g.addColorStop(1, P.nightDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ensureStarfield(w, h);
  for (const s of starfield) {
    const tw = 0.45 + 0.55 * Math.sin(v.time * s.speed + s.phase);
    ctx.globalAlpha = 0.10 + tw * 0.45;
    ctx.fillStyle = tw > 0.85 ? P.accentWarm : "#ffffff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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

function drawBeams(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  const segs = v.sim!.segments;
  if (!segs.length) return;
  const maxOrder = Math.max(...segs.map((s) => s.order));
  const front = v.reveal * (maxOrder + 1);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Two passes: a wide soft halo, then a bright narrow core. That is what sells
  // "glowing light" without an actual blur filter, which is expensive on phones.
  for (const pass of [0, 1] as const) {
    for (const s of segs) {
      if (s.order > front) continue;
      const c = lightColor(s.light);
      const fade = Math.min(1, front - s.order + 1);

      if (s.warp) { drawWarp(ctx, L, s, fade, v); continue; }

      const a = cx(L, s.x0), b = cy(L, s.y0);
      const c2 = cx(L, s.x1), d2 = cy(L, s.y1);
      // Partially reveal the leading segment so the light visibly travels.
      const p = Math.min(1, Math.max(0, front - s.order + 1));
      const ex = a + (c2 - a) * p, ey = b + (d2 - b) * p;

      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(ex, ey);
      if (pass === 0) {
        ctx.strokeStyle = alpha(c, 0.16 * fade);
        ctx.lineWidth = L.cell * 0.34;
      } else {
        ctx.strokeStyle = alpha(c, 0.95 * fade);
        ctx.lineWidth = L.cell * 0.085;
      }
      ctx.stroke();
    }
  }

  // The head of the beam: a small bright mote, a nod to the original's
  // travelling ball.
  const lead = segs.filter((s) => s.order <= front && s.order > front - 1 && !s.warp);
  for (const s of lead) {
    const p = Math.min(1, Math.max(0, front - s.order + 1));
    const hx = cx(L, s.x0) + (cx(L, s.x1) - cx(L, s.x0)) * p;
    const hy = cy(L, s.y0) + (cy(L, s.y1) - cy(L, s.y0)) * p;
    const c = lightColor(s.light);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, L.cell * 0.42);
    g.addColorStop(0, alpha(c, 0.9));
    g.addColorStop(1, alpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, L.cell * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
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
) {
  const x = i % L.w, y = Math.floor(i / L.w);
  const px = cx(L, x), py = cy(L, y);
  const s = L.cell;

  // A piece the light is currently striking brightens, which is how the
  // original signalled a hit without the ball and the object overlapping.
  const struck = v.sim?.touched.has(i) && v.reveal > 0.02;
  const lit = struck ? 1 : 0.78;

  ctx.save();
  ctx.translate(px, py);

  switch (t.kind) {
    case "wall": drawWall(ctx, s, t, v); break;
    case "mirrorA": drawMirror(ctx, s, -1, lit); break;
    case "mirrorB": drawMirror(ctx, s, 1, lit); break;
    case "splitter": drawSplitter(ctx, s, lit); break;
    case "prism": drawPrism(ctx, s, lit); break;
    case "filter": drawFilter(ctx, s, t.mask ?? WHITE, lit); break;
    case "portal": drawPortal(ctx, s, t.pair ?? 0, v); break;
    case "star": drawStar(ctx, s, v.starsLit.has(i), v); break;
    case "receptor": drawReceptor(ctx, s, t.mask ?? WHITE, v.sim?.satisfied.has(i) ?? false, v); break;
  }

  if (t.placed) {
    // A quiet dot marks pieces the player put down, so a board can be read at
    // a glance for what is yours and what is the level's.
    ctx.fillStyle = alpha(P.accent, 0.55);
    ctx.beginPath();
    ctx.arc(0, s * 0.36, s * 0.028, 0, Math.PI * 2);
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

function drawPrism(ctx: CanvasRenderingContext2D, s: number, lit: number) {
  const r = s * 0.30;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.88, r * 0.62);
  ctx.lineTo(-r * 0.88, r * 0.62);
  ctx.closePath();

  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, alpha("#ff7d9e", 0.30 * lit));
  g.addColorStop(0.5, alpha("#86f0ae", 0.26 * lit));
  g.addColorStop(1, alpha("#7cc4ff", 0.30 * lit));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha("#f2ecff", 0.92 * lit);
  ctx.lineWidth = Math.max(1.4, s * 0.045);
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawFilter(ctx: CanvasRenderingContext2D, s: number, mask: Light, lit: number) {
  const r = s * 0.26;
  roundRect(ctx, -r, -r, r * 2, r * 2, s * 0.07);
  ctx.fillStyle = alpha(lightColor(mask), 0.26 * lit);
  ctx.fill();
  ctx.strokeStyle = alpha(lightColor(mask), 0.95 * lit);
  ctx.lineWidth = Math.max(1.4, s * 0.042);
  ctx.stroke();

  // Channel pips: which of R/G/B this filter lets through.
  const chans = [Chan.R, Chan.G, Chan.B].filter((c) => mask & c);
  const gap = s * 0.085;
  chans.forEach((c, k) => {
    ctx.fillStyle = lightColor(c);
    ctx.beginPath();
    ctx.arc((k - (chans.length - 1) / 2) * gap, 0, s * 0.032, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawWall(ctx: CanvasRenderingContext2D, s: number, _t: Tile, _v: ViewState) {
  const r = s * 0.34;
  roundRect(ctx, -r, -r, r * 2, r * 2, s * 0.09);
  ctx.fillStyle = P.wall;
  ctx.fill();
  ctx.strokeStyle = P.wallEdge;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();

  // Cheap dither hatching for a lo-fi, printed feel.
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

function drawPortal(ctx: CanvasRenderingContext2D, s: number, pair: number, v: ViewState) {
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

function drawStar(ctx: CanvasRenderingContext2D, s: number, lit: boolean, v: ViewState) {
  const base = s * (lit ? 0.20 : 0.155);
  const pulse = lit ? 1 + 0.12 * Math.sin(v.time * 5) : 1;
  const r = base * pulse;

  if (lit) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
    g.addColorStop(0, alpha(P.star, 0.55));
    g.addColorStop(1, alpha(P.star, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  // Four-point sparkle with concave sides — reads as "collectible" rather than
  // as another piece of optics.
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const nx = Math.cos(a) * r, ny = Math.sin(a) * r;
    const ma = a + Math.PI / 4;
    const mx = Math.cos(ma) * r * 0.26, my = Math.sin(ma) * r * 0.26;
    if (k === 0) ctx.moveTo(nx, ny);
    else ctx.lineTo(nx, ny);
    ctx.quadraticCurveTo(mx, my, Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r);
  }
  ctx.closePath();
  ctx.fillStyle = lit ? P.star : P.starDim;
  ctx.fill();
  if (!lit) {
    ctx.strokeStyle = alpha(P.star, 0.6);
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.stroke();
  }
}

function drawReceptor(
  ctx: CanvasRenderingContext2D,
  s: number,
  mask: Light,
  satisfied: boolean,
  v: ViewState,
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
    return;
  }

  // Channel pips: exactly which of R/G/B this ring needs, drawn inside it.
  //
  // Colour alone is not enough to carry this. A ring wanting red and a ring
  // wanting red+blue are different puzzles — one beam versus two converging —
  // but as two pastel outlines they read as "the pinkish one" and the player
  // spends the level wondering why their red beam does nothing. The pips make
  // the requirement countable, and work without colour vision.
  // A single channel is unambiguous from the ring's own colour, and white is
  // the default every level opens with — neither needs annotating.
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

function drawMoon(ctx: CanvasRenderingContext2D, L: Layout, v: ViewState) {
  for (const e of v.level.emitters) {
    const px = cx(L, e.x);
    const py = L.oy - L.cell * 0.62;
    const r = L.cell * 0.34;
    const bob = Math.sin(v.time * 1.1) * L.cell * 0.035;

    ctx.save();
    ctx.translate(px, py + bob);

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.4);
    g.addColorStop(0, P.moonGlow);
    g.addColorStop(1, "rgba(255,226,154,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 3.4, 0, Math.PI * 2); ctx.fill();

    // Crescent as one even-odd path: a disc with an offset disc subtracted.
    // Doing this with `destination-out` would erase the sky behind it too,
    // punching a black hole in the canvas.
    const moon = new Path2D();
    moon.arc(0, 0, r, 0, Math.PI * 2);
    moon.arc(r * 0.46, -r * 0.22, r * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = P.moon;
    ctx.fill(moon, "evenodd");

    ctx.restore();
  }
}

function drawWinGlow(ctx: CanvasRenderingContext2D, w: number, h: number, v: ViewState) {
  ctx.fillStyle = alpha("#ffe6a8", 0.16 * v.winGlow);
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------- grain

let grain: HTMLCanvasElement | null = null;
function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // A single small noise tile, repeated. Gives the flat vector art a printed,
  // slightly analogue texture at almost no cost.
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
export function drawIcon(ctx: CanvasRenderingContext2D, size: number, kind: Tile["kind"], mask?: Light) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const s = size * 0.98;
  switch (kind) {
    case "mirrorA": drawMirror(ctx, s, -1, 1); break;
    case "mirrorB": drawMirror(ctx, s, 1, 1); break;
    case "splitter": drawSplitter(ctx, s, 1); break;
    case "prism": drawPrism(ctx, s, 1); break;
    case "filter": drawFilter(ctx, s, mask ?? WHITE, 1); break;
    case "portal": drawPortal(ctx, s, 0, { time: 0 } as ViewState); break;
    case "star": drawStar(ctx, s, true, { time: 0 } as ViewState); break;
    case "receptor": drawReceptor(ctx, s, mask ?? WHITE, false, { time: 0 } as ViewState); break;
    case "wall": drawWall(ctx, s, { kind: "wall" }, { time: 0 } as ViewState); break;
  }
  ctx.restore();
}

export { idx };
