/**
 * Transient effects.
 *
 * Deliberately not part of game state: an effect is a thing that happened, not
 * a thing that is true, so it lives here, expires on its own, and the engine
 * never has to know it existed. Everything is procedural and allocation-light —
 * a handful of short-lived records, no particle pool, no textures.
 */
import { Light } from "../engine/types";
import { Layout } from "./renderer";
import { alpha, lightColor, PALETTE as P } from "./theme";

export type FxKind =
  | "place"    // a piece went down
  | "rotate"   // a mirror flipped
  | "remove"   // a piece came back up
  | "star"     // a star was collected
  | "ring"     // a receptor lit
  | "absorb";  // light fell into a black hole

interface Fx {
  kind: FxKind;
  /** Cell index; resolved to pixels at draw time so it survives a resize. */
  i: number;
  /** Seconds, from the shared clock. */
  born: number;
  life: number;
  light: Light;
}

const active: Fx[] = [];

/** Longest any effect runs, per kind. */
const LIFE: Record<FxKind, number> = {
  place: 0.34, rotate: 0.26, remove: 0.28, star: 0.7, ring: 0.9, absorb: 0.55,
};

export function spawnFx(i: number, kind: FxKind, now: number, light: Light = 7) {
  if (i < 0) return;
  // One of each kind per cell at a time — rapid tapping should not stack up.
  for (let k = active.length - 1; k >= 0; k--) {
    if (active[k].i === i && active[k].kind === kind) active.splice(k, 1);
  }
  active.push({ kind, i, born: now, life: LIFE[kind], light });
  if (active.length > 64) active.splice(0, active.length - 64);
}

export function clearFx() {
  active.length = 0;
}

/** Ease-out so everything decelerates instead of ending abruptly. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function drawFx(ctx: CanvasRenderingContext2D, L: Layout, now: number) {
  for (let k = active.length - 1; k >= 0; k--) {
    const f = active[k];
    const t = (now - f.born) / f.life;
    if (t >= 1 || t < 0) { active.splice(k, 1); continue; }

    const x = L.ox + ((f.i % L.w) + 0.5) * L.cell;
    const y = L.oy + (Math.floor(f.i / L.w) + 0.5) * L.cell;
    const e = easeOut(t);

    ctx.save();
    ctx.translate(x, y);

    switch (f.kind) {
      case "place": {
        // A ring snapping inward, so the piece reads as landing rather than
        // appearing.
        const r = L.cell * (0.72 - 0.30 * e);
        ctx.strokeStyle = alpha(P.accent, 0.75 * (1 - t));
        ctx.lineWidth = Math.max(1.5, L.cell * 0.05 * (1 - t * 0.6));
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        break;
      }

      case "rotate": {
        // A short arc sweeping round, showing which way it turned.
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
        // Sparks thrown outward, plus a quick flash.
        const n = 7;
        for (let s = 0; s < n; s++) {
          const a = (s / n) * Math.PI * 2 + f.i;
          const d = L.cell * (0.14 + 0.52 * e);
          ctx.fillStyle = alpha(P.star, 0.9 * (1 - t));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, L.cell * 0.035 * (1 - t), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = alpha("#fff6e0", 0.5 * (1 - t) ** 2);
        ctx.beginPath(); ctx.arc(0, 0, L.cell * 0.3 * (1 - t), 0, Math.PI * 2); ctx.fill();
        break;
      }

      case "ring": {
        // Two rings expanding out of a satisfied receptor, offset in time.
        const c = lightColor(f.light);
        for (const off of [0, 0.28]) {
          const tt = (t - off) / (1 - off);
          if (tt <= 0) continue;
          const ee = easeOut(tt);
          ctx.strokeStyle = alpha(c, 0.7 * (1 - tt));
          ctx.lineWidth = Math.max(1.5, L.cell * 0.06 * (1 - tt));
          ctx.beginPath(); ctx.arc(0, 0, L.cell * (0.26 + 0.7 * ee), 0, Math.PI * 2); ctx.stroke();
        }
        break;
      }

      case "absorb": {
        // Light spiralling inward and winking out.
        const c = lightColor(f.light);
        for (let s = 0; s < 5; s++) {
          const a = (s / 5) * Math.PI * 2 + e * 5;
          const d = L.cell * 0.55 * (1 - e);
          ctx.fillStyle = alpha(c, 0.85 * (1 - t));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * d, Math.sin(a) * d, L.cell * 0.03, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }

    ctx.restore();
  }
}
