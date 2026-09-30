/**
 * Transient effects.
 *
 * Deliberately not part of game state: an effect is a thing that happened, not
 * a thing that is true, so it lives here, expires on its own, and the engine
 * never has to know it existed. Everything is procedural — a handful of
 * short-lived records, no textures.
 */
import { Light } from "../engine/types";
import { Layout } from "./renderer";
import { alpha, lightColor, PALETTE as P } from "./theme";
import { glint } from "./sky";

export type FxKind =
  | "place"          // a piece went down
  | "rotate"         // a mirror flipped
  | "remove"         // a piece came back up
  | "star"           // a star was collected
  | "ring"           // a receptor lit
  | "wrong"          // light hit a ring of the wrong colour
  | "absorb"         // light fell into a black hole
  | "prism"          // white light split by a crystal — the rainbow pulse
  | "shockwave"      // the moment of solving
  | "constellation"  // the solved level, joined up like a star map
  | "points"         // a score popping up and floating away
  | "shatter"        // light smashing into an asteroid
  | "cometLeap"      // a shooting star streaking to its next piece
  | "warpFlash";     // light passing through a warp gate

/** A straight run of light, in grid coordinates, at some depth from its source. */
export interface PathSeg { x0: number; y0: number; x1: number; y1: number; depth: number; light: Light }

interface Fx {
  kind: FxKind;
  /** Cell index; resolved to pixels at draw time so it survives a resize. */
  i: number;
  born: number;
  life: number;
  light: Light;
  /** For `prism`: every segment downstream of the crystal. */
  paths?: PathSeg[];
  /** For `constellation`: the cells to join, in order. */
  points?: number[];
  /** Grid position (cell units, may be off the board), used instead of `i`. */
  at?: { x: number; y: number };
  /** For `cometLeap`: where it lands. */
  to?: { x: number; y: number };
  text?: string;
  color?: string;
}

const active: Fx[] = [];

const LIFE: Record<FxKind, number> = {
  place: 0.34, rotate: 0.26, remove: 0.28, star: 0.8, ring: 1.0, wrong: 0.6,
  absorb: 0.55, prism: 1.6, shockwave: 1.3, constellation: 3.4,
  points: 1.1, shatter: 0.8, cometLeap: 0.55, warpFlash: 0.6,
};

export function spawnFx(
  i: number,
  kind: FxKind,
  now: number,
  light: Light = 7,
  extra: { paths?: PathSeg[]; points?: number[] } = {},
) {
  if (i < 0) return;
  // One of each kind per cell at a time — rapid tapping should not stack up.
  for (let k = active.length - 1; k >= 0; k--) {
    if (active[k].i === i && active[k].kind === kind) active.splice(k, 1);
  }
  active.push({ kind, i, born: now, life: LIFE[kind], light, ...extra });
  if (active.length > 80) active.splice(0, active.length - 80);
}

/** An effect at a grid position rather than a cell — off the board, or between cells. */
export function spawnFxAt(
  x: number, y: number,
  kind: FxKind,
  now: number,
  extra: { to?: { x: number; y: number }; text?: string; color?: string; light?: Light } = {},
) {
  active.push({ kind, i: -1, born: now, life: LIFE[kind], light: extra.light ?? 7, at: { x, y }, ...extra });
  if (active.length > 80) active.splice(0, active.length - 80);
}

export function clearFx() {
  active.length = 0;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Rainbow hues for the prism effects, running red → violet. */
const RAINBOW = ["#ff6b6b", "#ffb86b", "#ffe66b", "#86f0ae", "#6ee7e0", "#7cc4ff", "#c98bff"];

export function drawFx(ctx: CanvasRenderingContext2D, L: Layout, now: number) {
  for (let k = active.length - 1; k >= 0; k--) {
    const f = active[k];
    const t = (now - f.born) / f.life;
    if (t >= 1) { active.splice(k, 1); continue; }
    // Scheduled for a moment that has not arrived yet. This used to delete the
    // effect outright, which is why staggered ring bursts never showed past
    // the first one.
    if (t < 0) continue;

    const x = f.at ? L.ox + (f.at.x + 0.5) * L.cell : L.ox + ((f.i % L.w) + 0.5) * L.cell;
    const y = f.at ? L.oy + (f.at.y + 0.5) * L.cell : L.oy + (Math.floor(f.i / L.w) + 0.5) * L.cell;
    const e = easeOut(t);

    if (f.kind === "cometLeap") { drawCometLeap(ctx, L, f, t, x, y); continue; }

    // Board-wide effects draw in board space, not around a cell.
    if (f.kind === "prism") { drawPrismBurst(ctx, L, f, t, x, y); continue; }
    if (f.kind === "constellation") { drawConstellation(ctx, L, f, t); continue; }

    ctx.save();
    ctx.translate(x, y);

    switch (f.kind) {
      case "place": {
        const r = L.cell * (0.72 - 0.30 * e);
        ctx.strokeStyle = alpha(P.accent, 0.75 * (1 - t));
        ctx.lineWidth = Math.max(1.5, L.cell * 0.05 * (1 - t * 0.6));
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        glint(ctx, 0, 0, L.cell * 0.5 * (1 - t), 0.7 * (1 - t), "#ffffff");
        break;
      }

      case "rotate": {
        ctx.rotate(-Math.PI / 2 + e * Math.PI * 1.6);
        ctx.strokeStyle = alpha(P.accent, 0.8 * (1 - t));
        ctx.lineWidth = Math.max(1.5, L.cell * 0.045);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, L.cell * 0.38, 0, Math.PI * 0.5);
        ctx.stroke();
        break;
      }

      case "remove": {
        const r = L.cell * (0.30 + 0.34 * e);
        ctx.strokeStyle = alpha(P.inkDim, 0.6 * (1 - t));
        ctx.lineWidth = Math.max(1.2, L.cell * 0.035);
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        break;
      }

      case "star": {
        const n = 9;
        for (let s = 0; s < n; s++) {
          const a = (s / n) * Math.PI * 2 + f.i;
          const d = L.cell * (0.14 + 0.62 * e);
          ctx.fillStyle = alpha(RAINBOW[s % RAINBOW.length], 0.9 * (1 - t));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, L.cell * 0.035 * (1 - t), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = alpha("#fff6e0", 0.55 * (1 - t) ** 2);
        ctx.beginPath(); ctx.arc(0, 0, L.cell * 0.34 * (1 - t), 0, Math.PI * 2); ctx.fill();
        glint(ctx, 0, 0, L.cell * 0.9 * (1 - t), 0.9 * (1 - t), "#fff6e0");
        break;
      }

      case "ring": {
        const c = lightColor(f.light);
        for (const off of [0, 0.22, 0.44]) {
          const tt = (t - off) / (1 - off);
          if (tt <= 0) continue;
          const ee = easeOut(tt);
          ctx.strokeStyle = alpha(c, 0.75 * (1 - tt));
          ctx.lineWidth = Math.max(1.5, L.cell * 0.07 * (1 - tt));
          ctx.beginPath(); ctx.arc(0, 0, L.cell * (0.26 + 0.9 * ee), 0, Math.PI * 2); ctx.stroke();
        }
        glint(ctx, 0, 0, L.cell * 1.1 * (1 - t), 0.8 * (1 - t), c);
        break;
      }

      case "wrong": {
        // A quick shake of the ring's outline: "that's not the colour I want".
        const c = lightColor(f.light);
        const wob = Math.sin(t * Math.PI * 7) * (1 - t) * L.cell * 0.05;
        ctx.strokeStyle = alpha(c, 0.7 * (1 - t));
        ctx.lineWidth = Math.max(1.5, L.cell * 0.05);
        ctx.beginPath(); ctx.arc(wob, 0, L.cell * 0.34, 0, Math.PI * 2); ctx.stroke();
        break;
      }

      case "absorb": {
        const c = lightColor(f.light);
        for (let s = 0; s < 6; s++) {
          const a = (s / 6) * Math.PI * 2 + e * 5;
          const d = L.cell * 0.6 * (1 - e);
          ctx.fillStyle = alpha(c, 0.85 * (1 - t));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, L.cell * 0.03, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case "points": {
        // Floats up and fades; bigger numbers are drawn bigger.
        const big = Math.abs(Number(f.text?.replace(/[^0-9-]/g, "") ?? 0)) >= 50;
        const size = L.cell * (big ? 0.36 : 0.24) * (1 + 0.25 * (1 - e));
        ctx.font = `700 ${size}px "Pixelify Sans", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lift = -L.cell * (0.35 + 0.6 * e);
        const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.lineWidth = Math.max(2, size * 0.18);
        ctx.strokeStyle = alpha("#120e26", 0.8 * fade);
        ctx.strokeText(f.text ?? "", 0, lift);
        ctx.fillStyle = alpha(f.color ?? "#ffe066", fade);
        ctx.fillText(f.text ?? "", 0, lift);
        break;
      }

      case "shatter": {
        // Shards of broken light flung off the rock, spinning.
        const c = lightColor(f.light);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + k * 0.7;
          const d = L.cell * (0.15 + 0.7 * e);
          ctx.save();
          ctx.translate(Math.cos(a) * d, Math.sin(a) * d + e * e * L.cell * 0.3);
          ctx.rotate(t * 8 + k);
          ctx.fillStyle = alpha(k % 3 ? c : "#ffffff", 0.9 * (1 - t));
          const sz = L.cell * 0.07 * (1 - t * 0.5);
          ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.6, sz); ctx.lineTo(-sz * 0.6, sz * 0.4); ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.strokeStyle = alpha("#ffb08a", 0.8 * (1 - t));
        ctx.lineWidth = Math.max(1, L.cell * 0.025);
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = k * 1.3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * L.cell * 0.35 * e, Math.sin(a) * L.cell * 0.35 * e);
        }
        ctx.stroke();
        break;
      }

      case "warpFlash": {
        const c = f.color ?? "#ffb86b";
        for (const off of [0, 0.3]) {
          const tt = (t - off) / (1 - off);
          if (tt <= 0) continue;
          ctx.strokeStyle = alpha(c, 0.8 * (1 - tt));
          ctx.lineWidth = Math.max(1.5, L.cell * 0.05 * (1 - tt));
          ctx.beginPath(); ctx.arc(0, 0, L.cell * (0.15 + 0.6 * easeOut(tt)), 0, Math.PI * 2); ctx.stroke();
        }
        glint(ctx, 0, 0, L.cell * 0.7 * (1 - t), 0.9 * (1 - t), c);
        break;
      }

      case "shockwave": {
        // A wide soft ring sweeping the whole board, rainbow-edged, from the
        // cell that completed the solution.
        const R = L.cell * (0.4 + 9 * e);
        ctx.lineWidth = Math.max(2, L.cell * 0.18 * (1 - t));
        RAINBOW.forEach((col, n) => {
          ctx.strokeStyle = alpha(col, 0.22 * (1 - t));
          ctx.beginPath();
          ctx.arc(0, 0, R - n * L.cell * 0.05, 0, Math.PI * 2);
          ctx.stroke();
        });
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, alpha("#fff6e0", 0.35 * (1 - t)));
        g.addColorStop(1, alpha("#fff6e0", 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }

    ctx.restore();
  }
}

/**
 * The crystal moment.
 *
 * Two parts. First, a rainbow bloom opens around the crystal and fades. Second,
 * a pulse of rainbow light races out along every path the separated colours
 * will actually take — through mirrors, round corners, into rings — ahead of
 * the beam itself. It shows, once, exactly where the light is about to go,
 * then settles back into the real colours.
 */
function drawPrismBurst(ctx: CanvasRenderingContext2D, L: Layout, f: Fx, t: number, x: number, y: number) {
  // Part one: the bloom.
  const bloomT = Math.min(1, t / 0.55);
  if (bloomT < 1) {
    const R = L.cell * (0.3 + 2.3 * easeOut(bloomT));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 3);
    const n = RAINBOW.length;
    for (let s = 0; s < n * 2; s++) {
      const a0 = (s / (n * 2)) * Math.PI * 2;
      ctx.fillStyle = alpha(RAINBOW[s % n], 0.4 * (1 - bloomT));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a0, a0 + (Math.PI * 2) / (n * 2) * 0.72);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    glint(ctx, x, y, L.cell * 1.4 * (1 - bloomT), 0.9 * (1 - bloomT), "#ffffff");
  }

  // Part two: the pulse along the real downstream paths.
  if (!f.paths?.length) return;
  const SPEED = 32; // hops per second: three times the beam, so it runs visibly ahead
  const head = t * f.life * SPEED;
  const fadeAll = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;

  ctx.save();
  ctx.lineCap = "round";
  for (const s of f.paths) {
    const local = head - s.depth;        // how far the pulse is past this segment's start
    if (local <= 0) continue;
    const p = Math.min(1, local);
    const ax = L.ox + (s.x0 + 0.5) * L.cell, ay = L.oy + (s.y0 + 0.5) * L.cell;
    const bx = L.ox + (s.x1 + 0.5) * L.cell, by = L.oy + (s.y1 + 0.5) * L.cell;
    const ex = ax + (bx - ax) * p, ey = ay + (by - ay) * p;
    // Behind the pulse the trail shimmers through the rainbow, then relaxes.
    const trail = Math.max(0, 1 - (local - 1) / 5) * fadeAll;
    if (trail <= 0) continue;
    const hue = RAINBOW[Math.floor((s.depth + t * 20) % RAINBOW.length)];
    ctx.strokeStyle = alpha(hue, 0.5 * trail);
    ctx.lineWidth = L.cell * 0.22;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = alpha("#ffffff", 0.55 * trail);
    ctx.lineWidth = L.cell * 0.05;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    if (p < 1) glint(ctx, ex, ey, L.cell * 0.55, 0.95 * fadeAll, hue);
  }
  ctx.restore();
}

/**
 * A shooting star leaving the piece just collected and streaking to the next:
 * a bright head with a tail, arcing a little, with a flash where it lands.
 */
function drawCometLeap(ctx: CanvasRenderingContext2D, L: Layout, f: Fx, t: number, x0: number, y0: number) {
  if (!f.to) return;
  const x1 = L.ox + (f.to.x + 0.5) * L.cell, y1 = L.oy + (f.to.y + 0.5) * L.cell;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - L.cell * 0.8;
  const at = (k: number) => {
    const q = 1 - k;
    return { x: q * q * x0 + 2 * q * k * mx + k * k * x1, y: q * q * y0 + 2 * q * k * my + k * k * y1 };
  };
  const k = easeOut(Math.min(1, t / 0.8));
  ctx.save();
  ctx.lineCap = "round";
  for (let j = 0; j < 8; j++) {
    const a = at(Math.max(0, k - j * 0.04)), b = at(Math.max(0, k - (j + 1) * 0.04));
    ctx.strokeStyle = alpha("#bff4ff", 0.8 * (1 - j / 8));
    ctx.lineWidth = L.cell * 0.12 * (1 - j / 8);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  const h = at(k);
  glint(ctx, h.x, h.y, L.cell * 0.6, 0.95, "#ffffff");
  if (t > 0.75) glint(ctx, x1, y1, L.cell * 1.2 * (1 - (t - 0.75) / 0.25), 1, "#bff4ff");
  glint(ctx, x0, y0, L.cell * 0.9 * Math.max(0, 1 - t * 3), 1, "#ffffff");
  ctx.restore();
}

/**
 * The solved level, drawn as a constellation: a golden line threading every
 * collected star and lit ring in the order the light found them. It draws
 * itself in, holds, and fades — the board's own star map of what you did.
 */
function drawConstellation(ctx: CanvasRenderingContext2D, L: Layout, f: Fx, t: number) {
  const pts = (f.points ?? []).map((i) => ({
    x: L.ox + ((i % L.w) + 0.5) * L.cell,
    y: L.oy + (Math.floor(i / L.w) + 0.5) * L.cell,
  }));
  if (pts.length < 2) return;
  const drawIn = Math.min(1, t / 0.35);
  const fade = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
  const upto = drawIn * (pts.length - 1);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [w, a] of [[0.14, 0.18], [0.035, 0.85]] as const) {
    ctx.strokeStyle = alpha(P.accentWarm, a * fade);
    ctx.lineWidth = L.cell * w;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) {
      if (k - 1 >= upto) break;
      const seg = Math.min(1, upto - (k - 1));
      ctx.lineTo(pts[k - 1].x + (pts[k].x - pts[k - 1].x) * seg,
                 pts[k - 1].y + (pts[k].y - pts[k - 1].y) * seg);
    }
    ctx.stroke();
  }
  pts.forEach((p, k) => {
    if (k > upto + 0.01) return;
    glint(ctx, p.x, p.y, L.cell * 0.55, 0.9 * fade, "#fff6e0");
  });
  ctx.restore();
}
