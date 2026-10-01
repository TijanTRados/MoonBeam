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
import { alpha } from "./theme";
import { CONSTELLATIONS, DEFAULT_THEME, PlanetLook, Theme } from "./themes";

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
  /** The phase's look: sky colours, its planet, its constellations. */
  theme?: Theme;
  /**
   * Where the moon hangs. Planets stay well clear of it: a dim round body
   * drifting past the dark side of a crescent reads as the rest of the moon,
   * and the moon is meant to be only what is lit.
   */
  moons?: { x: number; y: number; r: number }[];
}

let avoidRect: SkyOpts["avoid"] = undefined;
let moonSpots: NonNullable<SkyOpts["moons"]> = [];

/** 1 well away from the moon, fading to nothing as a body drifts up to it. */
function moonClearance(x: number, y: number, r: number) {
  let k = 1;
  for (const m of moonSpots) {
    const d = Math.hypot(x - m.x, y - m.y) - r;
    const near = m.r * 2.2, far = m.r * 4;
    k = Math.min(k, Math.max(0, Math.min(1, (d - near) / (far - near))));
  }
  return k;
}

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
  const th = opts.theme ?? DEFAULT_THEME;
  // Base: a deep gradient in the phase's colours, lighter near the moon.
  const g = ctx.createRadialGradient(w * 0.5, h * 0.16, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.9);
  g.addColorStop(0, th.sky[0]);
  g.addColorStop(0.5, th.sky[1]);
  g.addColorStop(1, th.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  avoidRect = opts.avoid;
  moonSpots = opts.moons ?? [];

  if (!opts.mini) drawNebula(ctx, w, h, time, th.nebula);
  drawStars(ctx, w, h, time);
  if (opts.mini) return;
  drawConstellations(ctx, w, h, time, th.constellations);
  drawBigPlanet(ctx, w, h, time, th.planet);
  drawSparkleBursts(ctx, w, h, time);
  drawOrrery(ctx, w, h, time);
  drawSatellites(ctx, w, h, time);
  drawShootingStars(ctx, w, h, time);
}

// ---------------------------------------------------------------- constellations

/**
 * Two real constellations per phase, drawn as faint lines between brighter
 * stars. They breathe slowly — lines fading up and down on a long cycle — and
 * carry their name in tiny letters, because recognising the Plough in a
 * puzzle game's sky is exactly the kind of small delight this is for.
 */
function drawConstellations(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, names: string[]) {
  const S = Math.min(w, h);
  // Two fixed homes: upper left and right of centre, clear of the moon.
  const homes: [number, number, number][] = [[0.06, 0.08, 0.26], [0.7, 0.3, 0.24]];
  names.slice(0, 2).forEach((name, k) => {
    const c = CONSTELLATIONS[name];
    if (!c) return;
    const [hx, hy, size] = homes[k];
    const box = S * size;
    const ox = hx * w, oy = hy * h;
    const pts = c.stars.map(([x, y]) => [ox + x * box, oy + y * box * 0.8] as [number, number]);
    const breathe = 0.55 + 0.45 * Math.sin(t * 0.18 + k * 2.4);

    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (const [a, b] of c.lines) {
      const mid = clearance((pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2, 20);
      ctx.strokeStyle = alpha("#cfd8ff", 0.16 * breathe * mid);
      ctx.beginPath(); ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); ctx.stroke();
    }
    pts.forEach(([x, y], n) => {
      const seen = clearance(x, y, 20);
      const tw = 0.6 + 0.4 * Math.sin(t * (1.1 + n * 0.17) + n + k);
      ctx.fillStyle = alpha("#fff6e0", 0.75 * tw * seen);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      if (tw > 0.9) glint(ctx, x, y, 6 * seen, 0.5 * seen, "#fff6e0");
    });
    const [lx, ly] = pts.reduce(([ax, ay], [x, y]) => [Math.min(ax, x), Math.max(ay, y)], [Infinity, -Infinity]);
    const labelSeen = clearance(lx, ly + 12, 20);
    ctx.fillStyle = alpha("#cfd8ff", 0.22 * breathe * labelSeen);
    ctx.font = "10px Nunito, system-ui, sans-serif";
    ctx.fillText(c.name, lx, ly + 14);
  });
}

// ---------------------------------------------------------------- the phase's planet

/**
 * The world you are visiting, huge and low in the corner: mostly off-screen,
 * just a curve of it rising behind everything. Large enough to set the mood of
 * a phase at a glance; dim and far enough out of the way never to be mistaken
 * for part of the puzzle.
 */
function drawBigPlanet(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, look: PlanetLook) {
  const S = Math.min(w, h);
  const R = S * 0.46;
  const cx = w * 0.04, cy = h + R * 0.32;
  const [base, shade, hi] = look.body;

  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.translate(cx, cy);

  if (look.kind === "blackhole") {
    drawBlackHole(ctx, R * 0.7, t, look);
    ctx.restore();
    return;
  }

  // Rings behind the body.
  if (look.kind === "saturn" || look.kind === "uranus") {
    ctx.save();
    ctx.rotate(look.kind === "uranus" ? -1.35 : -0.35);
    ctx.strokeStyle = alpha(hi, 0.45);
    ctx.lineWidth = R * 0.07;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.7, R * 0.42, 0, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Atmosphere halo.
  const halo = ctx.createRadialGradient(0, 0, R * 0.95, 0, 0, R * 1.18);
  halo.addColorStop(0, alpha(base, 0.35));
  halo.addColorStop(1, alpha(base, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, Math.PI * 2); ctx.fill();

  // The disc, lit from the upper right where the moon is.
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  const body = ctx.createRadialGradient(R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.1);
  body.addColorStop(0, base);
  body.addColorStop(1, shade);
  ctx.fillStyle = body;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  const spin = t * 0.004;
  switch (look.kind) {
    case "earth": {
      ctx.fillStyle = alpha(hi, 0.6);
      for (const [x, y, rx, ry] of [[-0.3, -0.35, 0.28, 0.18], [0.25, -0.1, 0.22, 0.3], [-0.1, 0.35, 0.3, 0.14]]) {
        const sx = ((x + spin + 1.3) % 2.6) - 1.3;
        ctx.beginPath(); ctx.ellipse(sx * R, y * R, rx * R, ry * R, 0.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = alpha("#ffffff", 0.35);
      ctx.lineWidth = R * 0.04;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(((k * 0.6 + spin * 1.6) % 2.4 - 1.2) * R, (k * 0.3 - 0.5) * R, R * 0.3, 0.2, 1.4);
        ctx.stroke();
      }
      break;
    }
    case "venus":
    case "jupiter":
    case "saturn":
    case "neptune":
    case "uranus": {
      // Bands of cloud, drifting.
      const n = look.kind === "jupiter" ? 9 : 6;
      for (let k = 0; k < n; k++) {
        const y = (-1 + (2 * (k + 0.5)) / n) * R;
        ctx.fillStyle = alpha(k % 2 ? hi : shade, look.kind === "jupiter" ? 0.3 : 0.14);
        ctx.beginPath();
        ctx.ellipse(Math.sin(spin * 8 + k) * R * 0.05, y, R * 1.1, R / n * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (look.kind === "jupiter") {
        ctx.fillStyle = alpha("#c0462a", 0.55);
        ctx.beginPath(); ctx.ellipse(R * 0.25, R * 0.22, R * 0.16, R * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (look.kind === "neptune") {
        ctx.fillStyle = alpha("#081a50", 0.5);
        ctx.beginPath(); ctx.ellipse(R * 0.1, -R * 0.2, R * 0.14, R * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "mercury": {
      ctx.fillStyle = alpha(shade, 0.35);
      for (const [x, y, r] of [[-0.3, -0.4, 0.14], [0.3, -0.2, 0.1], [0, 0.2, 0.18], [0.45, 0.35, 0.08], [-0.5, 0.1, 0.1]]) {
        ctx.beginPath(); ctx.arc(x * R, y * R, r * R, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "mars": {
      ctx.fillStyle = alpha(shade, 0.35);
      for (const [x, y, rx, ry] of [[-0.2, 0, 0.35, 0.12], [0.3, 0.3, 0.2, 0.1]]) {
        ctx.beginPath(); ctx.ellipse(x * R, y * R, rx * R, ry * R, 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = alpha(hi, 0.75);
      ctx.beginPath(); ctx.ellipse(R * 0.1, -R * 0.9, R * 0.35, R * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
  ctx.restore();

  // Rings in front of the body.
  if (look.kind === "saturn" || look.kind === "uranus") {
    ctx.save();
    ctx.rotate(look.kind === "uranus" ? -1.35 : -0.35);
    ctx.strokeStyle = alpha(hi, 0.6);
    ctx.lineWidth = R * 0.07;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.7, R * 0.42, 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** The last world is not a world: an accretion disc round a hole in the sky. */
function drawBlackHole(ctx: CanvasRenderingContext2D, R: number, t: number, look: PlanetLook) {
  const [disc, , hot] = look.body;
  ctx.save();
  ctx.rotate(-0.3);
  // The disc, spinning; the far side lensed up over the top of the hole.
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = alpha(k === 0 ? hot : disc, 0.5 - k * 0.12);
    ctx.lineWidth = R * (0.14 - k * 0.03);
    ctx.setLineDash([R * 0.3, R * 0.12]);
    ctx.lineDashOffset = -t * R * 0.25 * (k + 1);
    ctx.beginPath(); ctx.ellipse(0, 0, R * (2 - k * 0.25), R * (0.45 - k * 0.06), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  const lens = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 1.35);
  lens.addColorStop(0, alpha(hot, 0.7));
  lens.addColorStop(1, alpha(hot, 0));
  ctx.fillStyle = lens;
  ctx.beginPath(); ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#000000";
  ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- nebula

function drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, tints: [string, string]) {
  // Two soft clouds drifting on long loops. Barely there; they stop the black
  // from reading as flat, and carry most of a phase's colour.
  const clouds = [
    { x: 0.2 + 0.05 * Math.sin(t * 0.021), y: 0.72, r: 0.55, c: tints[0], a: 0.12 },
    { x: 0.85 + 0.04 * Math.cos(t * 0.017), y: 0.3, r: 0.45, c: tints[1], a: 0.09 },
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
    ctx.globalAlpha = (0.45 + 0.3 * depth) * clearance(sx, sy, r * 3) * moonClearance(sx, sy, r);
    if (ctx.globalAlpha < 0.01) { ctx.restore(); continue; }
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
