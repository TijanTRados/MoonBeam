/**
 * The pixel look: modern glow over low-key pixel art.
 *
 * A scene is drawn into a small offscreen canvas, at an "art resolution" of a
 * dozen or so pixels per board cell, using exactly the same drawing code as
 * the smooth look. Then two passes:
 *
 *  - the art pass posterises every pixel to a small palette with ordered
 *    (Bayer) dithering, so gradients band and stipple like a 16-bit sky, and
 *    is scaled up with smoothing off — crisp, chunky pixels;
 *  - the glow pass keeps only the brightest pixels, shrinks them and scales
 *    them back up *with* smoothing, added on top: soft modern bloom around
 *    the moon and the beams, the one thing that is not pixel art.
 *
 * At a few thousand pixels per frame both passes cost well under a
 * millisecond, which leaves the phone free for the game.
 */

interface Buffers {
  art: HTMLCanvasElement;
  artCtx: CanvasRenderingContext2D;
  glow: HTMLCanvasElement;
  glowCtx: CanvasRenderingContext2D;
  soft: HTMLCanvasElement;
  softCtx: CanvasRenderingContext2D;
}

const buffers = new WeakMap<CanvasRenderingContext2D, Buffers>();

function buffersFor(target: CanvasRenderingContext2D): Buffers {
  let b = buffers.get(target);
  if (!b) {
    const mk = () => {
      const c = document.createElement("canvas");
      return { c, x: c.getContext("2d", { willReadFrequently: true })! };
    };
    const a = mk(), g = mk(), s = mk();
    b = { art: a.c, artCtx: a.x, glow: g.c, glowCtx: g.x, soft: s.c, softCtx: s.x };
    buffers.set(target, b);
  }
  return b;
}

/** 4x4 ordered-dither thresholds, centred on zero. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

/**
 * Levels per colour channel, spaced on a square-root curve: a night sky is
 * nearly all dark tones, and even steps would band it into a checkerboard.
 * Spaced like this the darks get fine steps and the brights coarse ones —
 * the moon and the beams posterise boldly, the sky only stipples.
 */
const LEVELS = 9;
const TO_LEVEL = new Float32Array(256);
for (let v = 0; v < 256; v++) TO_LEVEL[v] = Math.sqrt(v / 255) * (LEVELS - 1);
const FROM_LEVEL = Array.from({ length: LEVELS }, (_, q) => Math.round(255 * (q / (LEVELS - 1)) ** 2));
/** How strongly to dither, in levels. Under one keeps flat areas flat. */
const DITHER = 0.65;

/**
 * Draw a scene in the pixel look. `paint` draws the scene into whatever
 * context and size it is given; `artPx` is how many screen pixels make one
 * art pixel.
 */
export function drawPixelated(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  artPx: number,
  paint: (c: CanvasRenderingContext2D, w: number, h: number) => void,
  glow = 0.55,
) {
  const b = buffersFor(ctx);
  const px = Math.max(1.5, artPx);
  const base = ctx.globalAlpha;
  const lw = Math.max(1, Math.ceil(w / px)), lh = Math.max(1, Math.ceil(h / px));
  if (b.art.width !== lw || b.art.height !== lh) {
    b.art.width = lw; b.art.height = lh;
    b.glow.width = lw; b.glow.height = lh;
    b.soft.width = Math.max(1, lw >> 1); b.soft.height = Math.max(1, lh >> 1);
  }

  const a = b.artCtx;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalAlpha = 1;
  a.globalCompositeOperation = "source-over";
  a.clearRect(0, 0, lw, lh);
  paint(a, lw, lh);

  // Posterise with ordered dithering, and lift out the bright pixels for the glow.
  const img = a.getImageData(0, 0, lw, lh);
  const d = img.data;
  const gimg = b.glowCtx.createImageData(lw, lh);
  const gd = gimg.data;
  for (let y = 0; y < lh; y++) {
    const row = (y & 3) << 2;
    for (let x = 0; x < lw; x++) {
      const o = (y * lw + x) * 4;
      const t = BAYER[row | (x & 3)];
      for (let c = 0; c < 3; c++) {
        const q = Math.round(TO_LEVEL[d[o + c]] + t * DITHER);
        d[o + c] = FROM_LEVEL[q < 0 ? 0 : q >= LEVELS ? LEVELS - 1 : q];
      }
      d[o + 3] = d[o + 3] < 96 ? 0 : 255;
      const luma = 0.3 * d[o] + 0.59 * d[o + 1] + 0.11 * d[o + 2];
      if (luma > 165 && d[o + 3]) {
        gd[o] = d[o]; gd[o + 1] = d[o + 1]; gd[o + 2] = d[o + 2];
        gd[o + 3] = Math.min(255, (luma - 165) * 2.8);
      }
    }
  }
  a.putImageData(img, 0, 0);
  b.glowCtx.putImageData(gimg, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(b.art, 0, 0, lw, lh, 0, 0, lw * px, lh * px);

  if (glow > 0) {
    // Shrink the bright pixels, then stretch them back smoothly: a blur that
    // works everywhere, with no canvas filters needed.
    const s = b.softCtx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, b.soft.width, b.soft.height);
    s.imageSmoothingEnabled = true;
    s.drawImage(b.glow, 0, 0, b.soft.width, b.soft.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = glow * base;
    ctx.drawImage(b.soft, 0, 0, b.soft.width, b.soft.height, -px, -px, lw * px + px * 2, lh * px + px * 2);
    ctx.globalAlpha = glow * 0.6 * base;
    ctx.drawImage(b.glow, 0, 0, lw, lh, 0, 0, lw * px, lh * px);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the switch

const KEY = "moonbeam.look.v1";

export function loadPixelLook(): boolean {
  try { return localStorage.getItem(KEY) !== "smooth"; } catch { return true; }
}

export function savePixelLook(on: boolean) {
  try { localStorage.setItem(KEY, on ? "pixel" : "smooth"); } catch { /* private mode */ }
}
