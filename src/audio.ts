/**
 * Sound.
 *
 * Synthesised, not sampled: a handful of oscillators and envelopes, no files to
 * load and nothing to bloat the bundle. The game is small and cozy and the audio
 * should match — soft triangle waves through a low-pass, short attacks, long
 * tails, nothing percussive enough to startle.
 *
 * Everything is on a **minor pentatonic scale**, which is the important choice.
 * There are no wrong notes in a pentatonic scale, so stars collected in any
 * order still sound like music rather than a mistake. That matters now because
 * beam order is not something the player fully controls, and it matters more if
 * ordered "melody stars" ever land: the scale is already the right one.
 *
 * Browsers refuse to start audio before a user gesture, so the context is
 * created lazily on the first sound — which by construction follows a tap.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const KEY = "moonbeam.muted.v1";

try {
  muted = localStorage.getItem(KEY) === "1";
} catch { /* private mode or blocked storage — default to audible */ }

/** A minor pentatonic run, in Hz. Low A upward. */
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];

function ensure(): AudioContext | null {
  if (muted) return null;
  if (ctx) {
    // Browsers suspend the context when a tab is backgrounded.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;           // the whole game sits well below full scale
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 2600;      // shaves the digital edge off the oscillators
    soften.Q.value = 0.4;
    master.connect(soften);
    soften.connect(ctx.destination);
    return ctx;
  } catch {
    return null;                        // no audio hardware, or blocked; stay silent
  }
}

interface ToneOpts {
  freq: number;
  /** Seconds from now. */
  at?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  /** Slide to this frequency across the note. */
  glide?: number;
}

function tone({ freq, at = 0, dur = 0.28, gain = 0.5, type = "triangle", glide }: ToneOpts) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + at;

  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);

  // Gentle bell envelope: quick but not clicky in, slow out.
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// ---------------------------------------------------------------- the sounds

/** A piece lands on the board. */
export function sfxPlace() {
  tone({ freq: 392, dur: 0.1, gain: 0.32, type: "sine" });
}

/** A mirror turns. Two quick steps, so flipping feels like a ratchet. */
export function sfxRotate() {
  tone({ freq: 440, dur: 0.06, gain: 0.22, type: "sine" });
  tone({ freq: 523.25, at: 0.045, dur: 0.07, gain: 0.2, type: "sine" });
}

/** A piece comes back up. The place sound, falling instead of flat. */
export function sfxRemove() {
  tone({ freq: 330, dur: 0.12, gain: 0.24, type: "sine", glide: 247 });
}

/** The moon lets the light go. */
export function sfxShine() {
  tone({ freq: 110, dur: 0.7, gain: 0.3, type: "sine", glide: 165 });
  tone({ freq: 440, at: 0.04, dur: 0.5, gain: 0.14, type: "triangle" });
}

/**
 * A star is collected. Climbs the scale with each one, so a run of stars in a
 * single level plays as a rising phrase rather than the same blip repeated.
 */
export function sfxStar(index: number) {
  const f = SCALE[Math.min(index, SCALE.length - 1)];
  tone({ freq: f, dur: 0.5, gain: 0.4 });
  tone({ freq: f * 2, at: 0.01, dur: 0.35, gain: 0.12, type: "sine" });
}

/** A ring lights. A soft fifth, which reads as "that one is settled". */
export function sfxRing() {
  tone({ freq: 329.63, dur: 0.55, gain: 0.3 });
  tone({ freq: 493.88, at: 0.05, dur: 0.5, gain: 0.22 });
}

/** The level is solved. */
export function sfxWin() {
  [0, 2, 4, 5].forEach((step, k) => {
    tone({ freq: SCALE[step], at: k * 0.1, dur: 0.9 - k * 0.05, gain: 0.34 });
  });
  tone({ freq: SCALE[0] / 2, dur: 1.2, gain: 0.2, type: "sine" });
}

/** The run finished without solving. Deliberately soft — a shrug, not a buzzer. */
export function sfxMiss() {
  tone({ freq: 233.08, dur: 0.4, gain: 0.22, type: "sine", glide: 196 });
}

// ---------------------------------------------------------------- mute

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* nothing we can do */ }
  if (muted && ctx) ctx.suspend().catch(() => {});
  if (!muted) ensure();
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}
