/**
 * Sound effects, and the audio core the music shares.
 *
 * Everything is synthesised: oscillators, a little filtered noise, and one
 * generated reverb. No files to fetch, nothing in the bundle but code.
 *
 * Signal flow
 *
 *     sfx voices ──► sfxBus ──┬──────────────────────────► master ─► comp ─► out
 *                             └─► send ─► reverb ─────────►   ▲
 *     music voices ► musicBus ─► musicFilter ─────────────────┤
 *                             └─► send ─► reverb ─────────────┘
 *
 * The music runs through its own low-pass, which the game sweeps open while
 * the beam is travelling and slams wide at the moment a level is solved. That
 * one filter does more for "excitement" than any single sound effect.
 *
 * Key: C major. The sound effects use the C-major pentatonic (A C D E G),
 * which has no wrong notes against the music's chords — so a star chime can
 * land on any beat, over any chord, and still sound intended.
 */

interface Core {
  ctx: AudioContext;
  master: GainNode;
  sfxBus: GainNode;
  musicBus: GainNode;
  musicFilter: BiquadFilterNode;
  reverb: ConvolverNode;
  noise: AudioBuffer;
}

let core: Core | null = null;
let sfxMuted = false;
let musicMuted = false;

const SFX_KEY = "moonbeam.muted.v1";     // kept from before, so old saves carry over
const MUSIC_KEY = "moonbeam.music-muted.v1";

try {
  sfxMuted = localStorage.getItem(SFX_KEY) === "1";
  musicMuted = localStorage.getItem(MUSIC_KEY) === "1";
} catch { /* private mode or blocked storage — default to audible */ }

/** C-major pentatonic from A3 up three octaves. Index = rung on the ladder. */
export const SCALE = [
  220.0, 261.63, 293.66, 329.63, 392.0,
  440.0, 523.25, 587.33, 659.25, 783.99,
  880.0, 1046.5, 1174.66, 1318.51, 1567.98,
];

/**
 * Build the graph lazily. Browsers refuse to start audio before a user gesture,
 * and every sound here follows a tap, so the first sound is also the first
 * moment it is legal to create the context.
 */
export function audioCore(): Core | null {
  if (core) {
    if (core.ctx.state === "suspended") core.ctx.resume().catch(() => {});
    return core;
  }
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);

    // Generated reverb: two channels of noise under an exponential decay. It is
    // what turns plain sine blips into something that sounds like it is ringing
    // out across a night sky.
    const reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    reverb.connect(master);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxMuted ? 0 : 0.55;
    sfxBus.connect(master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.26;
    sfxBus.connect(sfxSend);
    sfxSend.connect(reverb);

    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 2400;
    musicFilter.Q.value = 0.7;
    musicFilter.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = musicMuted ? 0 : 0.42;
    musicBus.connect(musicFilter);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.2;
    musicBus.connect(musicSend);
    musicSend.connect(reverb);

    core = { ctx, master, sfxBus, musicBus, musicFilter, reverb, noise };
    return core;
  } catch {
    return null; // no audio hardware, or blocked: stay silent rather than break
  }
}

// ---------------------------------------------------------------- voices

export interface ToneOpts {
  freq: number;
  /** Seconds from now (or from `t0` if given). */
  at?: number;
  t0?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  /** Slide to this frequency across the note. */
  glide?: number;
  pan?: number;
  bus?: AudioNode;
}

/** One oscillator through a bell-shaped envelope. The workhorse. */
export function tone(o: ToneOpts) {
  const c = audioCore();
  if (!c) return;
  const { ctx } = c;
  const t0 = (o.t0 ?? ctx.currentTime) + (o.at ?? 0);
  const dur = o.dur ?? 0.28;
  const gain = o.gain ?? 0.5;

  const osc = ctx.createOscillator();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.glide !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glide), t0 + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  connectPanned(ctx, env, o.pan, o.bus ?? c.sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/**
 * A bell: a fundamental plus two inharmonic partials that die faster. This is
 * the "ding" in dingly — glockenspiel, music box, a spoon on a glass.
 */
export function bell(o: ToneOpts) {
  const dur = o.dur ?? 0.9;
  const gain = o.gain ?? 0.4;
  tone({ ...o, type: "sine", dur, gain });
  tone({ ...o, type: "sine", freq: o.freq * 2.756, dur: dur * 0.45, gain: gain * 0.32, glide: undefined });
  tone({ ...o, type: "sine", freq: o.freq * 5.404, dur: dur * 0.18, gain: gain * 0.12, glide: undefined });
}

/** Filtered noise: breaths, fizzes, whooshes, hats, claps. */
export function noiseHit(o: {
  at?: number; t0?: number; dur?: number; gain?: number;
  type?: BiquadFilterType; freq?: number; sweepTo?: number; q?: number; pan?: number; bus?: AudioNode;
}) {
  const c = audioCore();
  if (!c) return;
  const { ctx } = c;
  const t0 = (o.t0 ?? ctx.currentTime) + (o.at ?? 0);
  const dur = o.dur ?? 0.2;

  const src = ctx.createBufferSource();
  src.buffer = c.noise;
  // Start somewhere random in the buffer, so repeated hits are not identical.
  const offset = Math.random() * 0.5;

  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? "bandpass";
  filter.frequency.setValueAtTime(o.freq ?? 2000, t0);
  if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur);
  filter.Q.value = o.q ?? 0.9;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + Math.min(0.02, dur * 0.3));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(env);
  connectPanned(ctx, env, o.pan, o.bus ?? c.sfxBus);
  src.start(t0, offset, dur + 0.05);
}

function connectPanned(ctx: AudioContext, node: AudioNode, pan: number | undefined, dest: AudioNode) {
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    p.connect(dest);
  } else {
    node.connect(dest);
  }
}

const rung = (i: number) => SCALE[Math.max(0, Math.min(SCALE.length - 1, i))];

// ---------------------------------------------------------------- building

/** A piece lands on the board. */
export function sfxPlace() {
  bell({ freq: 783.99, dur: 0.22, gain: 0.22 });
  tone({ freq: 392, dur: 0.1, gain: 0.26, type: "sine" });
}

/** A mirror turns. Two quick steps, so flipping feels like a ratchet. */
export function sfxRotate() {
  tone({ freq: 523.25, dur: 0.06, gain: 0.2, type: "sine" });
  tone({ freq: 659.25, at: 0.045, dur: 0.08, gain: 0.18, type: "sine" });
}

/** A piece comes back up: the place sound, falling instead of landing. */
export function sfxRemove() {
  tone({ freq: 330, dur: 0.14, gain: 0.22, type: "sine", glide: 247 });
  noiseHit({ dur: 0.08, gain: 0.05, freq: 3000, type: "highpass" });
}

/** A tray slot is chosen. */
export function sfxSelect() {
  tone({ freq: 1046.5, dur: 0.05, gain: 0.1, type: "sine" });
}

/** Tapping a level piece to read about it. */
export function sfxInfo() {
  bell({ freq: 659.25, dur: 0.35, gain: 0.14 });
}

/** A hint is shown: a curious little two-note "hm?". */
export function sfxHint() {
  bell({ freq: 587.33, dur: 0.4, gain: 0.18 });
  bell({ freq: 783.99, at: 0.12, dur: 0.5, gain: 0.16 });
}

/** Moving between screens. */
export function sfxWhoosh() {
  noiseHit({ dur: 0.45, gain: 0.08, type: "bandpass", freq: 600, sweepTo: 3200, q: 0.6 });
}

// ---------------------------------------------------------------- the run

/** The moon lets the light go: a low swell with a rising sparkle on top. */
export function sfxShine() {
  tone({ freq: 110, dur: 0.9, gain: 0.26, type: "sine", glide: 165 });
  noiseHit({ dur: 0.7, gain: 0.07, type: "bandpass", freq: 900, sweepTo: 6000, q: 0.5 });
  [0, 2, 4].forEach((k, n) => bell({ freq: rung(5 + k), at: 0.05 + n * 0.06, dur: 0.6, gain: 0.12 }));
}

/**
 * The beam reaches a piece. Each hit in a run climbs one rung up the scale, so
 * the reveal plays as a rising phrase that gets higher the closer the light
 * gets to the finish — the build-up is literally audible.
 */
export function sfxHit(kind: string, rungIndex: number) {
  const f = rung(rungIndex);
  const pan = ((rungIndex * 37) % 11) / 11 - 0.5;
  switch (kind) {
    case "mirrorA": case "mirrorB":
      bell({ freq: f, dur: 0.45, gain: 0.22, pan });
      break;
    case "splitter":
      bell({ freq: f, dur: 0.5, gain: 0.18, pan: -0.4 });
      bell({ freq: f * 1.25, dur: 0.5, gain: 0.16, pan: 0.4 });
      break;
    case "crystal":
      // A rainbow glissando: the crystal gets the most elaborate sound because
      // it is the most elaborate thing that happens to the light.
      for (let k = 0; k < 6; k++) {
        bell({ freq: rung(rungIndex + k), at: k * 0.045, dur: 0.7, gain: 0.16, pan: (k - 2.5) / 3 });
      }
      noiseHit({ dur: 0.6, gain: 0.05, type: "highpass", freq: 6000 });
      break;
    case "tint":
      tone({ freq: f, glide: f * 1.12, dur: 0.35, gain: 0.2, pan });
      bell({ freq: f * 2, at: 0.05, dur: 0.4, gain: 0.08, pan });
      break;
    case "portal":
      noiseHit({ dur: 0.35, gain: 0.1, type: "bandpass", freq: 400, sweepTo: 4000 });
      bell({ freq: f, dur: 0.3, gain: 0.14 });
      bell({ freq: f * 2, at: 0.12, dur: 0.5, gain: 0.14 });
      break;
    case "blackhole":
      tone({ freq: f, glide: f / 4, dur: 0.6, gain: 0.24, type: "sine" });
      noiseHit({ dur: 0.5, gain: 0.08, type: "lowpass", freq: 1800, sweepTo: 200 });
      break;
    case "whitehole":
      tone({ freq: f / 2, glide: f, dur: 0.45, gain: 0.2, type: "sine" });
      bell({ freq: f * 2, at: 0.2, dur: 0.6, gain: 0.12 });
      break;
    case "wall":
      tone({ freq: 90, glide: 60, dur: 0.18, gain: 0.2, type: "sine" });
      break;
  }
}

/** A star is collected. Climbs with every star, over a shimmer of highs. */
export function sfxStar(rungIndex: number) {
  const f = rung(rungIndex);
  bell({ freq: f, dur: 0.9, gain: 0.3 });
  bell({ freq: f * 2, at: 0.03, dur: 0.6, gain: 0.12 });
  bell({ freq: f * 3, at: 0.06, dur: 0.4, gain: 0.05 });
}

/** A ring lights. A soft open fifth, which reads as "that one is settled". */
export function sfxRing(rungIndex = 3) {
  const f = rung(rungIndex);
  bell({ freq: f, dur: 1.0, gain: 0.26 });
  bell({ freq: f * 1.5, at: 0.05, dur: 0.9, gain: 0.2 });
  bell({ freq: f * 2, at: 0.1, dur: 0.8, gain: 0.12 });
}

/** Light hits a ring of the wrong colour. Gentle — information, not a scolding. */
export function sfxWrongRing() {
  tone({ freq: 311.13, dur: 0.3, gain: 0.14, type: "sine" });
  tone({ freq: 293.66, at: 0.08, dur: 0.35, gain: 0.12, type: "sine" });
}

/** Light leaves the board and dissolves. */
export function sfxDissolve() {
  noiseHit({ dur: 0.35, gain: 0.035, type: "highpass", freq: 5000, sweepTo: 9000, pan: Math.random() - 0.5 });
}

/**
 * The approach. When the light is about to complete a solution, time slows
 * and this rises underneath it — a held breath before the payoff.
 */
export function sfxRiser(seconds: number) {
  const d = Math.max(0.4, seconds);
  noiseHit({ dur: d, gain: 0.09, type: "bandpass", freq: 500, sweepTo: 7000, q: 1.4 });
  tone({ freq: 220, glide: 440, dur: d, gain: 0.08, type: "sawtooth" });
  tone({ freq: 55, dur: d, gain: 0.14, type: "sine" });
}

/**
 * The moment of solving. A shimmering crash, a big major chord, and a cascade
 * of high bells falling like glitter.
 */
export function sfxClimax() {
  noiseHit({ dur: 1.8, gain: 0.14, type: "highpass", freq: 4000 });
  [261.63, 329.63, 392.0, 523.25, 659.25].forEach((f, k) =>
    bell({ freq: f, at: k * 0.02, dur: 2.2, gain: 0.2 }));
  tone({ freq: 65.41, dur: 1.6, gain: 0.3, type: "sine" });
  for (let k = 0; k < 10; k++) {
    bell({ freq: rung(14 - k), at: 0.18 + k * 0.07, dur: 0.8, gain: 0.07, pan: ((k % 4) - 1.5) / 2 });
  }
}

/** One star popping onto the results card. */
export function sfxCardStar(k: number) {
  bell({ freq: rung(6 + k * 2), dur: 0.8, gain: 0.26 });
  bell({ freq: rung(9 + k * 2), at: 0.03, dur: 0.5, gain: 0.1 });
}

/** The run finished without solving. A shrug, not a buzzer. */
export function sfxMiss() {
  tone({ freq: 329.63, glide: 261.63, dur: 0.5, gain: 0.18, type: "sine" });
  bell({ freq: 220, at: 0.15, dur: 0.8, gain: 0.1 });
}

// ---------------------------------------------------------------- the music hooks

/**
 * Tension control. `open` 0..1 sweeps the music's low-pass from muffled to
 * bright; the game opens it as the beam travels and throws it wide on a win.
 */
export function musicBrightness(open: number, seconds = 0.4) {
  const c = audioCore();
  if (!c) return;
  const f = 900 + Math.pow(Math.max(0, Math.min(1, open)), 1.6) * 11000;
  const t = c.ctx.currentTime;
  c.musicFilter.frequency.cancelScheduledValues(t);
  c.musicFilter.frequency.setValueAtTime(c.musicFilter.frequency.value, t);
  c.musicFilter.frequency.exponentialRampToValueAtTime(f, t + seconds);
}

/** Pull the music down briefly so a big moment can be heard over it. */
export function musicDuck(depth = 0.35, seconds = 1.2) {
  const c = audioCore();
  if (!c || musicMuted) return;
  const g = c.musicBus.gain;
  const t = c.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.42 * depth, t + 0.05);
  g.linearRampToValueAtTime(0.42, t + seconds);
}

// ---------------------------------------------------------------- mute

export const isMuted = () => sfxMuted;
export const isMusicMuted = () => musicMuted;

export function toggleMuted(): boolean {
  sfxMuted = !sfxMuted;
  try { localStorage.setItem(SFX_KEY, sfxMuted ? "1" : "0"); } catch { /* ignore */ }
  if (core) core.sfxBus.gain.setTargetAtTime(sfxMuted ? 0 : 0.55, core.ctx.currentTime, 0.05);
  return sfxMuted;
}

export function toggleMusicMuted(): boolean {
  musicMuted = !musicMuted;
  try { localStorage.setItem(MUSIC_KEY, musicMuted ? "1" : "0"); } catch { /* ignore */ }
  if (core) core.musicBus.gain.setTargetAtTime(musicMuted ? 0 : 0.42, core.ctx.currentTime, 0.2);
  return musicMuted;
}

/** Kept for callers that only know about one switch. */
export function setMuted(next: boolean) {
  if (next !== sfxMuted) toggleMuted();
}
