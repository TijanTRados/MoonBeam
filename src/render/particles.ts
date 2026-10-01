/**
 * Particles: glitter off the beam, light fizzing away at the board's edge, and
 * the star fountains when a level is solved.
 *
 * Positions are in grid units (cells), not pixels, so a resize mid-flight
 * doesn't scatter them. Motion is closed-form — position is a function of age,
 * not integrated frame to frame — so a dropped frame never makes a particle
 * jump, and there is no per-frame update pass at all, only drawing.
 *
 * One instance per canvas: the board, the title art and the demo cards each
 * own their own, so their particles never leak into each other.
 */
import { alpha } from "./theme";

export interface Particle {
  x: number; y: number;       // grid units at birth
  vx: number; vy: number;     // grid units per second
  g: number;                  // gravity, grid units per second²  (negative = floats up)
  born: number;
  life: number;
  size: number;               // fraction of a cell
  color: string;
  glint: boolean;             // four-point spark rather than a dot
  twinkle: number;            // phase offset
}

interface Frame { cell: number; ox: number; oy: number }

export class Particles {
  private list: Particle[] = [];
  constructor(private max = 360) {}

  add(p: Particle) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(p);
  }

  clear() {
    this.list.length = 0;
  }

  get count() {
    return this.list.length;
  }

  draw(ctx: CanvasRenderingContext2D, L: Frame, now: number) {
    let write = 0;
    for (let k = 0; k < this.list.length; k++) {
      const p = this.list[k];
      const age = now - p.born;
      if (age > p.life || age < -0.5) continue; // expired: drop by not copying forward
      this.list[write++] = p;
      if (age < 0) continue;

      const t = age / p.life;
      const x = L.ox + (p.x + p.vx * age) * L.cell;
      const y = L.oy + (p.y + p.vy * age + 0.5 * p.g * age * age) * L.cell;
      // Fade in fast, out slow, and shimmer while alive.
      const fade = Math.min(1, t * 8) * (1 - t) * (0.65 + 0.35 * Math.sin(now * 18 + p.twinkle));
      if (fade <= 0.01) continue;
      const r = Math.max(0.6, p.size * L.cell * (1 - t * 0.4));

      if (p.glint) {
        ctx.fillStyle = alpha(p.color, fade);
        spark(ctx, x, y, r * 2.2);
      } else {
        ctx.fillStyle = alpha(p.color, fade);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.list.length = write;
  }
}

/** A tiny four-point star — two thin rhombi crossed. */
function spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const w = r * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + w, y); ctx.lineTo(x, y + r); ctx.lineTo(x - w, y);
  ctx.closePath();
  ctx.moveTo(x - r, y); ctx.lineTo(x, y + w); ctx.lineTo(x + r, y); ctx.lineTo(x, y - w);
  ctx.closePath();
  ctx.fill();
}

/** Deterministic-enough jitter without dragging a PRNG through every caller. */
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
