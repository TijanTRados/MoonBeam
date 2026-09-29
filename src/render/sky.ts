/**
 * The sky behind the board.
 *
 * Everything here is a pure function of the clock: no state advances frame to
 * frame, so the sky looks the same wherever you pause it and costs nothing to
 * resize. Shooting stars and satellites are scheduled by hashing the time slot
 * they fall in, which gives "random" arrivals without a random-number stream
 * that would drift or need saving.
 *
 * The rule for all of it: the board is the subject. Planets are small and dim,
 * satellites are specks, and nothing in the sky is brighter than a beam.
 */
import { PALETTE as P, alpha } from "./theme";

interface SkyStar {
  x: number; y: number;       // 0..1
  r: number;
  phase: number; speed: number;
  tint: string;
  /** Bright ones throw a cross-shaped glint every so often. */
  glint: boolean;
}

let stars: SkyStar[] = [];
let starsFor = "";

const TINTS = ["#ffffff", "#ffffff", "#fff3d6", "#dfe8ff", "#ffe0f0", "#e6ffe9"];

/** A small, fast, portable hash → [0, 1). */
function hash(n: number) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function ensureStars(w: number, h: number) {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  if (key === starsFor) return;
  starsFor = key;
  let s = 20150601; // the thesis month; deterministic so the sky never reshuffles
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round((w * h) / 7000);
  stars = Array.from({ length: n }, () => {
    const r = 0.35 + Math.pow(rnd(), 2.2) * 1.7;
    return {
      x: rnd(), y: rnd(), r,
      phase: rnd() * Math.PI * 2,
      speed: 0.4 + rnd() * 1.4,
      tint: TINTS[Math.floor(rnd() * TINTS.length)],
      glint: r > 1.35,
    };
  });
}

export interface SkyOpts {
  /** Skip the planets, satellites and shooting stars — for tiny demo boards. */
  mini?: boolean;
  /**
   * The board, in pixels. Anything that drifts behind it is dimmed almost to
   * nothing: behind a mostly transparent grid a passing planet reads as a game
   * piece, and a player should never have to wonder whether a dot is part of
   * the puzzle.
   */
  avoid?: { x: number; y: number; w: number; h: number };
}

let avoidRect: SkyOpts["avoid"] = undefined;

/** 1 in open sky, fading to 0.1 as a point moves in behind the board. */
function clearance(x: number, y: number, margin = 14) {
  const r = avoidRect;
  if (!r) return 1;
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  const d = Math.hypot(dx, dy);
  if (d > margin) return 1;
  const inside = x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  return inside ? 0.1 : 0.1 + 0.9 * (d / margin);
}

export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, opts: SkyOpts = {}) {
  // Base: a deep gradient, lighter near the moon at the top.
  const g = ctx.createRadialGradient(w * 0.5, h * 0.16, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.9);
  g.addColorStop(0, P.nightSoft);
  g.addColorStop(0.5, P.nightMid);
  g.addColorStop(1, P.nightDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  avoidRect = opts.avoid;

  if (!opts.mini) drawNebula(ctx, w, h, time);
  drawStars(ctx, w, h, time);
  if (opts.mini) return;
  drawSparkleBursts(ctx, w, h, time);
  drawOrrery(ctx, w, h, time);
  drawSatellites(ctx, w, h, time);
  drawShootingStars(ctx, w, h, time);
}

// ---------------------------------------------------------------- nebula

function drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // Two soft clouds drifting on long loops. Barely there; they stop the black
  // from reading as flat.
  const clouds = [
    { x: 0.2 + 0.05 * Math.sin(t * 0.021), y: 0.72, r: 0.55, c: "#6b3fa0", a: 0.10 },
    { x: 0.85 + 0.04 * Math.cos(t * 0.017), y: 0.3, r: 0.45, c: "#2f6f8f", a: 0.08 },
  ];
  for (const k of clouds) {
    const R = Math.max(w, h) * k.r;
    const gg = ctx.createRadialGradient(k.x * w, k.y * h, 0, k.x * w, k.y * h, R);
    gg.addColorStop(0, alpha(k.c, k.a));
    gg.addColorStop(1, alpha(k.c, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------- stars

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ensureStars(w, h);
  for (const s of stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
    const x = s.x * w, y = s.y * h;
    ctx.globalAlpha = 0.12 + tw * 0.55;
    ctx.fillStyle = s.tint;
    ctx.beginPath();
    ctx.arc(x, y, s.r * (0.85 + tw * 0.3), 0, Math.PI * 2);
    ctx.fill();

    // The sparkle: at the top of its twinkle, a bright star flares into a cross.
    if (s.glint && tw > 0.82) {
      const k = (tw - 0.82) / 0.18;
      glint(ctx, x, y, s.r * (3 + 6 * k), 0.55 * k, s.tint);
    }
  }
  ctx.globalAlpha = 1;
}

/** A four-spike glint: two thin crossed streaks fading from the centre. */
export function glint(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, a: number, color = "#ffffff") {
  if (a <= 0.01 || len <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(rot);
    const lg = ctx.createLinearGradient(-len, 0, len, 0);
    lg.addColorStop(0, alpha(color, 0));
    lg.addColorStop(0.5, alpha(color, a));
    lg.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(-len, -Math.max(0.5, len * 0.06), len * 2, Math.max(1, len * 0.12));
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Sparkles that are not attached to any star: every 1.6s a few points of the
 * sky flash briefly, like frost catching the light. Scheduled by hashing the
 * time slot, so they are scattered but never flicker on resize.
 */
function drawSparkleBursts(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const SLOT = 1.6;
  const slot = Math.floor(t / SLOT);
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 3; j++) {
      const id = (slot - k) * 7 + j;
      const born = (slot - k) * SLOT + hash(id * 3 + 1) * SLOT;
      const age = t - born;
      if (age < 0 || age > 0.7) continue;
      const life = Math.sin((age / 0.7) * Math.PI);
      const x = hash(id * 5 + 2) * w, y = hash(id * 11 + 3) * h;
      glint(ctx, x, y, 5 + 7 * life, 0.7 * life, TINTS[Math.floor(hash(id) * TINTS.length)]);
    }
  }
}

// ---------------------------------------------------------------- orrery

interface Planet {
  a: number; b: number;       // ellipse radii as a fraction of the short side
  period: number;             // seconds per orbit
  phase: number;
  size: number;               // fraction of the short side
  body: [string, string];     // lit side, shadow side
  ring?: string;
}

/**
 * A little orrery: three planets on tilted, flattened ellipses round the middle
 * of the screen, so they drift past behind the board on long, lazy loops. The
 * faint dotted orbit lines are half the charm — a diagram of a solar system,
 * not a photograph of one.
 */
const PLANETS: Planet[] = [
  { a: 0.62, b: 0.22, period: 95,  phase: 0.3, size: 0.020, body: ["#ffcf9e", "#8a4f3a"] },
  { a: 0.86, b: 0.33, period: 160, phase: 2.4, size: 0.028, body: ["#b8d7ff", "#3b4f8a"], ring: "#e8dcff" },
  { a: 1.10, b: 0.44, period: 260, phase: 4.6, size: 0.016, body: ["#d8ffcf", "#3f7a5a"] },
];

function drawOrrery(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const S = Math.min(w, h);
  const ox = w * 0.5, oy = h * 0.52;
  const tilt = -0.22;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(tilt);

  ctx.setLineDash([2, 7]);
  ctx.lineWidth = 1;
  for (const p of PLANETS) {
    ctx.strokeStyle = alpha("#c8a6ff", 0.07);
    ctx.beginPath();
    ctx.ellipse(0, 0, p.a * S, p.b * S, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const p of PLANETS) {
    const th = (t / p.period) * Math.PI * 2 + p.phase;
    const x = Math.cos(th) * p.a * S;
    const y = Math.sin(th) * p.b * S;
    // Behind (top of the ellipse) reads further away: smaller and dimmer.
    const depth = 0.5 + 0.5 * Math.sin(th);
    const r = p.size * S * (0.75 + 0.35 * depth);
    const sx = ox + x * Math.cos(tilt) - y * Math.sin(tilt);
    const sy = oy + x * Math.sin(tilt) + y * Math.cos(tilt);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-tilt);
    ctx.globalAlpha = (0.45 + 0.3 * depth) * clearance(sx, sy, r * 3);
    drawPlanet(ctx, r, p);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawPlanet(ctx: CanvasRenderingContext2D, r: number, p: Planet) {
  if (p.ring) {
    // Back half of the ring, behind the body.
    ctx.strokeStyle = alpha(p.ring, 0.5);
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2.0, r * 0.55, -0.35, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  // Lit from the upper left, where the moon hangs.
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, p.body[0]);
  g.addColorStop(1, p.body[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  if (p.ring) {
    ctx.strokeStyle = alpha(p.ring, 0.75);
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2.0, r * 0.55, -0.35, 0, Math.PI);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- satellites

/**
 * Satellites cross in straight lines, slowly, with a blinking light. One pass
 * every forty-odd seconds per lane, each lane on its own offset so they rarely
 * overlap. They are the least moon-like thing in the sky, which is exactly why
 * they are fun to spot.
 */
function drawSatellites(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const lanes = [
    { period: 43, dur: 26, offset: 4 },
    { period: 61, dur: 34, offset: 29 },
  ];
  lanes.forEach((lane, li) => {
    const pass = Math.floor((t + lane.offset) / lane.period);
    const age = (t + lane.offset) - pass * lane.period;
    if (age > lane.dur) return;
    const k = age / lane.dur;
    const seed = pass * 13 + li * 101;
    // Enter on one edge, leave on the opposite one.
    const fromLeft = hash(seed) < 0.5;
    const y0 = (0.08 + hash(seed + 1) * 0.5) * h;
    const y1 = y0 + (hash(seed + 2) - 0.3) * h * 0.35;
    const x = fromLeft ? -20 + (w + 40) * k : w + 20 - (w + 40) * k;
    const y = y0 + (y1 - y0) * k;
    const heading = Math.atan2(y1 - y0, fromLeft ? w : -w);

    const seen = clearance(x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.globalAlpha = 0.7 * seen;
    // Body and two solar panels.
    ctx.fillStyle = "#cfc6e8";
    ctx.fillRect(-2, -1.5, 4, 3);
    ctx.fillStyle = "#6f8ad0";
    ctx.fillRect(-9, -1.2, 6, 2.4);
    ctx.fillRect(3, -1.2, 6, 2.4);
    ctx.strokeStyle = alpha("#cfc6e8", 0.6);
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.stroke();
    ctx.restore();

    // The blink.
    if ((age * 1.1) % 1 < 0.12 && seen > 0.5) {
      ctx.fillStyle = alpha(li % 2 ? "#ff8a8a" : "#ffffff", 0.95);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      glint(ctx, x, y, 5, 0.6, li % 2 ? "#ff8a8a" : "#ffffff");
    }
    ctx.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------- shooting stars

function drawShootingStars(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const SLOT = 7.5;
  const slot = Math.floor(t / SLOT);
  for (const sl of [slot, slot - 1]) {
    if (hash(sl * 3) < 0.35) continue;               // not every slot has one
    const born = sl * SLOT + hash(sl * 5) * (SLOT - 1);
    const age = t - born;
    const LIFE = 0.9;
    if (age < 0 || age > LIFE) continue;
    const k = age / LIFE;
    const x0 = hash(sl * 7) * w * 0.9 + w * 0.05;
    const y0 = hash(sl * 11) * h * 0.4;
    const ang = 0.5 + hash(sl * 13) * 0.6;           // heading down and across
    const dir = hash(sl * 17) < 0.5 ? 1 : -1;
    const dist = Math.min(w, h) * 0.45;
    const hx = x0 + Math.cos(ang) * dist * k * dir;
    const hy = y0 + Math.sin(ang) * dist * k;
    const tail = dist * 0.28;
    const tx = hx - Math.cos(ang) * tail * dir;
    const ty = hy - Math.sin(ang) * tail;
    const fade = Math.sin(k * Math.PI) * clearance(hx, hy, 30);

    const lg = ctx.createLinearGradient(tx, ty, hx, hy);
    lg.addColorStop(0, alpha("#ffffff", 0));
    lg.addColorStop(1, alpha("#fff3d6", 0.9 * fade));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    glint(ctx, hx, hy, 6 * fade, 0.8 * fade, "#fff3d6");
  }
}
