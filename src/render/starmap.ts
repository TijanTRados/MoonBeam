/**
 * The star map: every solved night's constellation, gathered into one sky.
 *
 * Each world gets a band of the sky with its name, and each of its nights a
 * small patch where that night's stars, rings and comet pieces are drawn as
 * the light joined them. Unsolved nights are a single faint point, waiting.
 *
 * The canvas is only ever the size of the screen; the map scrolls underneath
 * it, so a long journey costs no more to draw than a short one.
 */
import type { Constellation } from "../game/medals";
import { alpha } from "./theme";
import { glint } from "./sky";

export interface MapNight { n: number; c?: Constellation; medals: number }
export interface MapWorld { name: string; color: string; nights: MapNight[] }

export interface MapBox { n: number; x: number; y: number; s: number }
export interface MapLayout { height: number; boxes: MapBox[]; titles: { x: number; y: number; text: string; color: string }[] }

const COLS = 5;

export function layoutStarMap(width: number, worlds: MapWorld[]): MapLayout {
  const pad = 16;
  const s = Math.min(110, (width - pad * 2) / COLS);
  const left = (width - s * COLS) / 2;
  const boxes: MapBox[] = [];
  const titles: MapLayout["titles"] = [];
  let y = 18;
  for (const w of worlds) {
    titles.push({ x: left + 6, y: y + 16, text: w.name, color: w.color });
    y += 30;
    w.nights.forEach((night, k) => {
      boxes.push({ n: night.n, x: left + (k % COLS) * s, y: y + Math.floor(k / COLS) * s, s });
    });
    y += Math.ceil(w.nights.length / COLS) * s + 14;
  }
  return { height: y + 20, boxes, titles };
}

/** Deterministic noise, so the dust does not crawl from frame to frame. */
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function drawStarMap(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  t: number,
  worlds: MapWorld[],
  L: MapLayout,
  scroll: number,
) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0d0a22");
  g.addColorStop(1, "#1a1338");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Dust, drifting at half the scroll speed for a little depth.
  const drift = scroll * 0.5;
  for (let k = 0; k < 160; k++) {
    const x = hash(k, 1) * w;
    const y = (((hash(k, 2) * (h + 400) - drift) % (h + 400)) + h + 400) % (h + 400) - 200;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.5 + hash(k, 3)) + k));
    ctx.fillStyle = alpha("#ffffff", 0.15 + 0.35 * tw * hash(k, 4));
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  ctx.save();
  ctx.translate(0, -scroll);

  for (const tl of L.titles) {
    if (tl.y < scroll - 40 || tl.y > scroll + h + 40) continue;
    ctx.font = `700 15px "Pixelify Sans", monospace`;
    ctx.fillStyle = tl.color;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText(tl.text, tl.x, tl.y);
  }

  const byN = new Map<number, { night: MapNight; color: string }>();
  for (const wd of worlds) for (const night of wd.nights) byN.set(night.n, { night, color: wd.color });

  for (const b of L.boxes) {
    if (b.y + b.s < scroll || b.y > scroll + h) continue;
    const e = byN.get(b.n);
    if (!e) continue;
    const { night, color } = e;
    const cx = b.x + b.s / 2, cy = b.y + b.s * 0.42;

    ctx.font = `700 10px Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = alpha("#ece5ff", night.c ? 0.55 : 0.25);
    ctx.fillText(String(b.n), cx, b.y + b.s - 6);

    if (!night.c) {
      ctx.fillStyle = alpha("#ece5ff", 0.18);
      ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
      continue;
    }

    // Frame the constellation itself, not its whole board, keeping its
    // shape: a few cells' worth at least, so a short route isn't blown up.
    const c = night.c;
    const xs = c.pts.map((i) => i % c.w), ys = c.pts.map((i) => Math.floor(i / c.w));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = (b.s * 0.56) / Math.max(3, x1 - x0, y1 - y0);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const at = (i: number) => ({ x: cx + ((i % c.w) - mx) * k, y: cy + (Math.floor(i / c.w) - my) * k });

    if (c.pts.length > 1) {
      ctx.strokeStyle = alpha(color, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      c.pts.forEach((i, j) => { const p = at(i); if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
    }
    c.pts.forEach((i, j) => {
      const p = at(i);
      const tw = 0.65 + 0.35 * Math.sin(t * 1.7 + b.n * 1.3 + j * 2.1);
      // The route starts where the moonlight came in: a little gold moon.
      if (j === 0 && c.pts.length > 1) {
        ctx.fillStyle = "#f6c64a";
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.fillStyle = alpha("#ffffff", 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 + tw * 0.6, 0, Math.PI * 2); ctx.fill();
      glint(ctx, p.x, p.y, 5 + 4 * tw, 0.55 * tw, j === c.pts.length - 1 ? "#ffe9a8" : "#ffffff");
    });

    // The medals, as three small marks under the constellation.
    for (let m = 0; m < 3; m++) {
      const on = (night.medals >> m) & 1;
      ctx.fillStyle = on ? ["#f6c64a", "#ffe066", "#bff4ff"][m] : alpha("#ece5ff", 0.15);
      ctx.beginPath(); ctx.arc(cx - 7 + m * 7, b.y + b.s - 18, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** Which night's patch is under a point on the map, or 0. */
export function boxAt(L: MapLayout, x: number, y: number): number {
  const b = L.boxes.find((q) => x >= q.x && x < q.x + q.s && y >= q.y && y < q.y + q.s);
  return b?.n ?? 0;
}
