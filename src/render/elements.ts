/**
 * Drawings for the newer pieces: asteroids, satellites and dishes, shooting
 * stars, rough ground, warp gates, and the Milky Way.
 *
 * Same rules as the rest of the renderer: procedural, drawn at the origin of a
 * cell of size `s`, readable at a glance on a phone.
 */
import { alpha } from "./theme";
import { glint } from "./sky";
import { sparklePath } from "./moon";

/** Warp gate colours. Kept away from the light colours, so a gate never reads as a filter. */
export const WARP_HUES = ["#ffb86b", "#ff7ad9", "#b8ff6b", "#7af0ff"];

/** A cheap deterministic wobble, so every rock has its own lumpy outline. */
const wob = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- asteroid

export function drawAsteroid(ctx: CanvasRenderingContext2D, s: number, t: number, seed: number, hit: boolean) {
  const r = s * 0.3;
  ctx.save();
  ctx.rotate(t * 0.6 + seed);

  const n = 11;
  const rock = new Path2D();
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.78 + 0.3 * wob(seed, k % n));
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (k === 0) rock.moveTo(x, y); else rock.lineTo(x, y);
  }
  rock.closePath();

  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, hit ? "#ffb08a" : "#b7a8c8");
  g.addColorStop(1, hit ? "#6a2a1a" : "#4a3e5e");
  ctx.fillStyle = g;
  ctx.fill(rock);
  ctx.strokeStyle = alpha("#1e1630", 0.85);
  ctx.lineWidth = Math.max(1.2, s * 0.035);
  ctx.lineJoin = "round";
  ctx.stroke(rock);

  ctx.fillStyle = alpha("#2e2440", 0.55);
  for (const [x, y, cr] of [[0.25, -0.2, 0.2], [-0.3, 0.2, 0.16], [0.1, 0.35, 0.1]]) {
    ctx.beginPath(); ctx.arc(x * r, y * r, cr * r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  if (hit) glint(ctx, 0, 0, s * 0.5, 0.8, "#ffb08a");
}

// ---------------------------------------------------------------- satellite and dish

export function drawSatellitePiece(ctx: CanvasRenderingContext2D, s: number, t: number, delay: number, carrying: number) {
  const r = s * 0.3;
  ctx.save();
  ctx.rotate(-0.35 + Math.sin(t * 0.8) * 0.06);

  // Solar panels.
  ctx.fillStyle = "#4f6fc0";
  ctx.strokeStyle = alpha("#1a2450", 0.9);
  ctx.lineWidth = Math.max(1, s * 0.022);
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(dx > 0 ? r * 0.35 : -r * 1.15, -r * 0.3, r * 0.8, r * 0.6);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = alpha("#a0c0ff", 0.5);
    ctx.beginPath();
    for (let k = 1; k < 3; k++) {
      const x = (dx > 0 ? r * 0.35 : -r * 1.15) + (r * 0.8 * k) / 3;
      ctx.moveTo(x, -r * 0.3); ctx.lineTo(x, r * 0.3);
    }
    ctx.stroke();
    ctx.strokeStyle = alpha("#1a2450", 0.9);
  }

  // Body.
  ctx.fillStyle = carrying > 0 ? "#fff3c8" : "#e8e0f5";
  ctx.beginPath(); ctx.rect(-r * 0.35, -r * 0.4, r * 0.7, r * 0.8); ctx.fill(); ctx.stroke();

  // Antenna.
  ctx.strokeStyle = alpha("#e8e0f5", 0.9);
  ctx.beginPath(); ctx.moveTo(0, -r * 0.4); ctx.lineTo(0, -r * 0.75); ctx.stroke();
  ctx.fillStyle = (Math.floor(t * 2) % 2 === 0 || carrying > 0) ? "#ff8a8a" : "#5a2a3a";
  ctx.beginPath(); ctx.arc(0, -r * 0.8, s * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Delay pips: how many ticks it holds the light.
  for (let k = 0; k < delay; k++) {
    ctx.fillStyle = alpha("#ffe066", 0.95);
    ctx.beginPath(); ctx.arc((k - (delay - 1) / 2) * s * 0.09, s * 0.38, s * 0.03, 0, Math.PI * 2); ctx.fill();
  }
  if (carrying > 0) glint(ctx, 0, 0, s * 0.55 * carrying, 0.8, "#fff3c8");
}

export function drawDish(ctx: CanvasRenderingContext2D, s: number, t: number, receiving: number) {
  const r = s * 0.3;
  ctx.save();
  // Stand.
  ctx.strokeStyle = alpha("#d8d0ea", 0.9);
  ctx.lineWidth = Math.max(1.2, s * 0.04);
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, r * 0.1); ctx.lineTo(-r * 0.3, r * 0.75); ctx.moveTo(0, r * 0.1); ctx.lineTo(r * 0.3, r * 0.75); ctx.stroke();
  // Bowl, tipped up towards the sky.
  ctx.rotate(-0.5);
  ctx.fillStyle = receiving > 0 ? "#fff3c8" : "#e8e0f5";
  ctx.strokeStyle = alpha("#2a2240", 0.85);
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.05, r * 0.75, r * 0.32, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Feed horn.
  ctx.beginPath(); ctx.moveTo(0, -r * 0.05); ctx.lineTo(0, -r * 0.6); ctx.stroke();
  ctx.fillStyle = "#ffe066";
  ctx.beginPath(); ctx.arc(0, -r * 0.62, s * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Little radio waves, pulsing.
  const pulse = (t * 1.2) % 1;
  ctx.strokeStyle = alpha("#ffe066", 0.5 * (1 - pulse));
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath(); ctx.arc(-r * 0.05, -r * 0.5, r * (0.3 + pulse * 0.5), -2.4, -0.9); ctx.stroke();
  if (receiving > 0) glint(ctx, 0, -r * 0.3, s * 0.55 * receiving, 0.8, "#fff3c8");
}

// ---------------------------------------------------------------- shooting star

/**
 * A piece of a shooting star.
 *
 * The active piece — the one the light must reach next — is big and bright
 * with a streaming tail. Waiting pieces are small, dim, and numbered, so the
 * order you must pass through them is right there on the board. Collected
 * pieces leave a faint ring where they were.
 */
export function drawCometPiece(
  ctx: CanvasRenderingContext2D,
  s: number,
  t: number,
  seq: number,
  state: "active" | "waiting" | "collected",
  tailDir: number,
) {
  const ice = "#bff4ff";
  if (state === "collected") {
    ctx.strokeStyle = alpha(ice, 0.25);
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.setLineDash([s * 0.04, s * 0.05]);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (state === "active") {
    // Tail, streaming away behind the head.
    ctx.save();
    ctx.rotate(tailDir);
    const tail = ctx.createLinearGradient(0, 0, s * 0.62, 0);
    tail.addColorStop(0, alpha(ice, 0.75));
    tail.addColorStop(1, alpha(ice, 0));
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.12);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.05, s * 0.64, 0);
    ctx.quadraticCurveTo(s * 0.35, s * 0.05, 0, s * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const pulse = 1 + 0.1 * Math.sin(t * 6);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
    g.addColorStop(0, alpha(ice, 0.6));
    g.addColorStop(1, alpha(ice, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();

    const sp = sparklePath(s * 0.27 * pulse, s * 0.22 * pulse);
    ctx.fillStyle = "#ffffff";
    ctx.fill(sp);
    ctx.strokeStyle = alpha("#2a6a8a", 0.8);
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke(sp);
    glint(ctx, 0, 0, s * 0.45, 0.7 + 0.3 * Math.sin(t * 7), "#ffffff");
    return;
  }

  // Waiting: small, dim, numbered.
  const sp = sparklePath(s * 0.13, s * 0.11);
  ctx.fillStyle = alpha(ice, 0.4);
  ctx.fill(sp);
  ctx.strokeStyle = alpha(ice, 0.65);
  ctx.lineWidth = Math.max(0.8, s * 0.018);
  ctx.stroke(sp);
  ctx.fillStyle = alpha(ice, 0.8);
  ctx.font = `700 ${Math.max(8, s * 0.17)}px "Pixelify Sans", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(seq + 1), s * 0.2, s * 0.2);
}

// ---------------------------------------------------------------- rough ground

export function drawTerrain(ctx: CanvasRenderingContext2D, s: number, colours: [string, string], seed: number) {
  const r = s * 0.44;
  const n = 10;
  const ground = new Path2D();
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.86 + 0.14 * wob(seed, k % n));
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (k === 0) ground.moveTo(x, y); else ground.lineTo(x, y);
  }
  ground.closePath();
  ctx.fillStyle = alpha(colours[0], 0.75);
  ctx.fill(ground);
  ctx.save();
  ctx.clip(ground);
  // Pebbles and cracks: texture that says "rough" without looking like a piece.
  ctx.fillStyle = alpha(colours[1], 0.8);
  for (let k = 0; k < 6; k++) {
    const x = (wob(seed, k + 20) - 0.5) * r * 1.5, y = (wob(seed, k + 40) - 0.5) * r * 1.5;
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.05, s * 0.035, k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = alpha("#000000", 0.18);
  ctx.lineWidth = Math.max(0.8, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.1); ctx.lineTo(-r * 0.1, r * 0.1); ctx.lineTo(r * 0.3, -r * 0.2); ctx.lineTo(r * 0.6, 0);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = alpha(colours[1], 0.6);
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke(ground);
}

// ---------------------------------------------------------------- warp gates

/**
 * A warp gate on the board's rim, seen edge-on: a ring flattened against the
 * edge, spinning, in its pair's colour. `vertical` is true for gates on the
 * left and right edges.
 */
export function drawWarpGate(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  cell: number,
  vertical: boolean,
  hue: number,
  t: number,
  flash: number,
) {
  const c = WARP_HUES[hue % WARP_HUES.length];
  const long = cell * 0.42, short = cell * 0.13;
  ctx.save();
  ctx.translate(x, y);
  if (!vertical) ctx.rotate(Math.PI / 2);

  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, long * 1.3);
  g.addColorStop(0, alpha(c, 0.35 + flash * 0.5));
  g.addColorStop(1, alpha(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, short * 2.4, long * 1.3, 0, 0, Math.PI * 2); ctx.fill();

  ctx.lineWidth = Math.max(1.5, cell * 0.045);
  for (let k = 0; k < 2; k++) {
    ctx.strokeStyle = alpha(c, 0.9 - k * 0.35);
    ctx.setLineDash([cell * 0.12, cell * 0.07]);
    ctx.lineDashOffset = (k ? -1 : 1) * t * cell * 0.5;
    ctx.beginPath(); ctx.ellipse(0, 0, short * (1 - k * 0.4), long * (1 - k * 0.25), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  if (flash > 0) glint(ctx, x, y, cell * 0.8 * flash, flash, c);
}

// ---------------------------------------------------------------- the Milky Way

/**
 * A stretch of the Milky Way across some cells: soft clouds of pink, violet and
 * blue with dust stars twinkling in them, and a slow swirl at the centre. Light
 * crossing it shines brighter and earns more.
 */
export function drawMilkyWay(
  ctx: CanvasRenderingContext2D,
  cells: { x: number; y: number }[],
  cell: number,
  t: number,
) {
  if (!cells.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const tints = ["#b04aa0", "#5a4ad0", "#3a8ad0", "#d06a9a"];
  cells.forEach((p, k) => {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cell * 0.95);
    g.addColorStop(0, alpha(tints[k % tints.length], 0.26));
    g.addColorStop(1, alpha(tints[k % tints.length], 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, cell * 0.95, 0, Math.PI * 2); ctx.fill();
  });

  // Dust stars, a dozen per cell, each twinkling on its own clock.
  cells.forEach((p, k) => {
    for (let j = 0; j < 12; j++) {
      const dx = (wob(k * 31 + 7, j) - 0.5) * cell, dy = (wob(k * 17 + 3, j + 50) - 0.5) * cell;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + wob(k, j) * 2) + j);
      ctx.fillStyle = alpha("#ffffff", 0.2 + 0.5 * tw);
      ctx.beginPath(); ctx.arc(p.x + dx, p.y + dy, 0.6 + wob(j, k) * 1.1, 0, Math.PI * 2); ctx.fill();
    }
  });

  // A slow spiral at the middle of the patch.
  const mx = cells.reduce((a, p) => a + p.x, 0) / cells.length;
  const my = cells.reduce((a, p) => a + p.y, 0) / cells.length;
  ctx.translate(mx, my);
  ctx.rotate(t * 0.12);
  ctx.strokeStyle = alpha("#e8d8ff", 0.14);
  ctx.lineWidth = cell * 0.08;
  ctx.lineCap = "round";
  for (let arm = 0; arm < 2; arm++) {
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = arm * Math.PI + k * 0.22;
      const rr = cell * 0.08 * k * 0.22 * 3;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.6;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
