/**
 * The moon, drawn by its phase.
 *
 * The lit part of the moon is bounded by two curves: half of the moon's rim on
 * the sunward side, and the terminator — the line between day and night — which
 * seen from Earth is half of an ellipse. Its width depends on the phase: at a
 * thin crescent it bows out towards the rim, at first quarter it is a straight
 * line, and at gibbous it bows the other way.
 *
 * So the lit shape is one closed path: rim from the top pole to the bottom one,
 * then back up along the terminator. That matters. An earlier version made the
 * crescent by subtracting one full circle from another, and outlining that path
 * traced *both circles in full* — including the part of the second circle
 * hanging outside the moon, which read as a ghostly other half. There is no
 * other half here to draw.
 *
 * `lit` is the illuminated fraction, 0 (new) to 1 (full). Waxing, as seen from
 * the northern hemisphere, so the light grows from the right.
 */
import { alpha } from "./theme";

/** The lit shape: rim on the right from pole to pole, back along the terminator. */
export function moonPath(r: number, lit: number): Path2D {
  const k = Math.max(0.02, Math.min(1, lit));
  const p = new Path2D();
  if (k >= 0.999) {
    p.arc(0, 0, r, 0, Math.PI * 2);
    return p;
  }
  // Terminator half-width: r at new/full, 0 at the quarters.
  const tx = r * Math.abs(1 - 2 * k);
  p.moveTo(0, -r);
  p.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);            // lit rim, down the right side
  if (k < 0.5) {
    // Crescent: the terminator bows right, cutting into the lit half.
    p.ellipse(0, 0, tx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  } else {
    // Gibbous: it bows left, adding to it.
    p.ellipse(0, 0, tx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  }
  p.closePath();
  return p;
}

/** The terminator curve alone, for the lighter band that runs along it. */
function terminatorPath(r: number, lit: number): Path2D {
  const k = Math.max(0.02, Math.min(1, lit));
  const tx = r * Math.abs(1 - 2 * k);
  const p = new Path2D();
  if (k >= 0.999) return p;
  if (k < 0.5) p.ellipse(0, 0, tx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  else p.ellipse(0, 0, tx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  return p;
}

/** Four-point sticker sparkle with pinched sides. */
export function sparklePath(rv: number, rh: number, pinch = 0.2): Path2D {
  const p = new Path2D();
  p.moveTo(0, -rv);
  p.quadraticCurveTo(rh * pinch, -rv * pinch, rh, 0);
  p.quadraticCurveTo(rh * pinch, rv * pinch, 0, rv);
  p.quadraticCurveTo(-rh * pinch, rv * pinch, -rh, 0);
  p.quadraticCurveTo(-rh * pinch, -rv * pinch, 0, -rv);
  p.closePath();
  return p;
}

const OUTLINE = "#5b3a12";

/**
 * Draw the moon at the origin. `release` 0..1 brightens it as it lets the
 * light go; `glow` is its halo colour.
 */
export function drawMoon(
  ctx: CanvasRenderingContext2D,
  r: number,
  lit: number,
  time: number,
  release = 0,
  glow = "rgba(255, 226, 154, 0.42)",
) {
  const shape = moonPath(r, lit);

  ctx.save();
  ctx.rotate(-0.22); // the small tilt of a moon low in the sky

  // Halo hugging the lit shape only — a disc behind it would show the dark
  // part of the moon as a pale ghost.
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = r * (1.5 + release * 2.5);
  ctx.fillStyle = "#f6c64a";
  ctx.fill(shape);
  ctx.restore();

  ctx.fillStyle = "#f6c64a";
  ctx.fill(shape);

  // Two-tone shading, clipped to the lit shape: a paler band along the
  // terminator and deeper gold at the rim, the sticker look of the reference.
  ctx.save();
  ctx.clip(shape);
  ctx.strokeStyle = "#ffe98f";
  ctx.lineWidth = r * 0.42;
  ctx.stroke(terminatorPath(r, lit));
  if (lit >= 0.999) {
    // Full: the light band sits off-centre instead.
    ctx.fillStyle = alpha("#ffe98f", 0.7);
    ctx.beginPath(); ctx.arc(-r * 0.18, -r * 0.18, r * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = alpha("#e39b2e", 0.55);
  ctx.lineWidth = r * 0.16;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  // A few soft craters, only where the moon is lit.
  ctx.fillStyle = alpha("#e3a53a", 0.35);
  for (const [cx, cy, cr] of [[0.45, -0.35, 0.16], [0.2, 0.42, 0.12], [0.62, 0.18, 0.09], [-0.3, 0.1, 0.13]]) {
    ctx.beginPath(); ctx.arc(cx * r, cy * r, cr * r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = alpha(OUTLINE, 0.75);
  ctx.lineWidth = Math.max(1.2, r * 0.075);
  ctx.lineJoin = "round";
  ctx.stroke(shape);

  if (release > 0) {
    ctx.save();
    ctx.globalAlpha = release * 0.6;
    ctx.fillStyle = "#fffdf0";
    ctx.fill(shape);
    ctx.restore();
  }
  ctx.restore();

  // Two sparkles keeping it company, twinkling out of step, on the dark side
  // where they are not lost in the moon's own light.
  const tw = (k: number) => 0.8 + 0.25 * Math.sin(time * 2.6 + k * 2.1);
  const spots: [number, number, number][] = [[-r * 1.05, -r * 0.62, r * 0.34], [-r * 0.55, r * 0.72, r * 0.22]];
  spots.forEach(([sx, sy, sr], k) => {
    ctx.save();
    ctx.translate(sx, sy);
    const q = tw(k);
    const sp = sparklePath(sr * q, sr * q * 0.82);
    ctx.fillStyle = "#ffe066";
    ctx.fill(sp);
    ctx.strokeStyle = alpha(OUTLINE, 0.7);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineJoin = "round";
    ctx.stroke(sp);
    ctx.restore();
  });
}

/** How full the moon is on a given night of a ten-night phase: a young crescent to full. */
export function moonForNight(index: number): number {
  const i = ((index % 10) + 10) % 10;
  return 0.1 + (0.9 * i) / 9;
}
