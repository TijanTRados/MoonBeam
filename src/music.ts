/**
 * Background music: one song per planet.
 *
 * Every song is an original 16-bar loop written for this game, played by the
 * same little band — kick, clap, hats, a bass, a pad, piano stabs, a
 * glockenspiel and a lead — so moving between planets feels like the same
 * radio station changing records, not a different game. What changes is the
 * tempo, the chords, the groove, and who sits out: Earth is bouncy late-90s
 * bubblegum pop; the further out you go, the slower, sparser and colder it
 * gets, until the black hole is little more than a heartbeat and a drone.
 *
 * It is a step sequencer on the audio clock, not setTimeout: every note is
 * scheduled on `AudioContext.currentTime` a little ahead of when it sounds, so
 * the groove stays tight even when the main thread is busy generating a level.
 *
 * All songs stay in C major (or its relative A minor), so the game's
 * pentatonic sound effects sit inside whichever one is playing.
 */
import { audioCore, bell, noiseHit, tone, isMusicMuted } from "./audio";
import type { PhaseKey } from "./engine/phases";

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Chord { bass: number; tones: [number, number, number] }

// Voiced close together so the stabs move smoothly from chord to chord.
const Am: Chord = { bass: 45, tones: [57, 60, 64] };
const F: Chord  = { bass: 41, tones: [57, 60, 65] };
const C: Chord  = { bass: 48, tones: [55, 60, 64] };
const G: Chord  = { bass: 43, tones: [55, 59, 62] };
const Em: Chord = { bass: 40, tones: [55, 59, 64] };
const Dm: Chord = { bass: 38, tones: [57, 62, 65] };
// Colour chords: still only white notes, just stacked differently.
const Fmaj7: Chord = { bass: 41, tones: [57, 64, 65] };
const Cadd9: Chord = { bass: 48, tones: [55, 62, 64] };
const Gsus: Chord  = { bass: 43, tones: [55, 60, 62] };
const Am7: Chord   = { bass: 45, tones: [55, 60, 64] };

type Note = [number, number, number];   // [step within bar, MIDI note, length in sixteenths]

interface Song {
  bpm: number;
  /** 16 bars: 0-7 are the A section, 8-15 the B section. */
  prog: Chord[];
  /** The B-section lead, one array per bar, or a rhythm to build one from chord tones. */
  hook: Note[][] | { rhythm: [number, number][]; shape: number[]; octave: number } | null;
  drums: "pop" | "half" | "sparse" | "pulse" | "none";
  /** Bass: step → interval above the chord's root. */
  bass: Record<number, number>;
  bassTone: OscillatorType;
  /** Glockenspiel: every 2 steps (eighths) or 1 (sixteenths), with an A and B pattern. */
  glock: { every: 1 | 2; a: number[]; b: number[]; gain: number } | null;
  stabs: boolean;
  pad: number;
  /** A low drone under everything (the outer planets). */
  drone?: number;
}

const POP_BASS = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 };

/**
 * Earth's hook, bars 8-15. Every note is a tone of the chord underneath it,
 * which is what keeps a synthesised lead sounding sweet rather than wandering.
 */
const EARTH_HOOK: Note[][] = [
  [[0, 84, 3], [3, 81, 3], [6, 84, 4], [10, 86, 2], [12, 84, 4]],   // F
  [[0, 83, 3], [3, 79, 3], [6, 83, 4], [10, 86, 6]],                 // G
  [[0, 88, 8], [8, 86, 4], [12, 83, 4]],                             // Em
  [[0, 84, 6], [6, 81, 4], [10, 76, 6]],                             // Am
  [[0, 81, 3], [3, 84, 3], [6, 89, 4], [10, 88, 6]],                 // F
  [[0, 86, 4], [4, 83, 4], [8, 79, 4], [12, 83, 4]],                 // G
  [[0, 84, 8], [8, 88, 4], [12, 91, 4]],                             // C
  [[0, 84, 10]],                                                     // C — breathe before the loop
];

export const SONGS: Record<PhaseKey, Song> = {
  // Bubblegum pop at home.
  earth: {
    bpm: 104, prog: [Am, F, C, G, Am, F, C, G, F, G, Em, Am, F, G, C, C],
    hook: EARTH_HOOK, drums: "pop", bass: POP_BASS, bassTone: "triangle",
    glock: { every: 2, a: [0, 2, 1, 2, 3, 2, 1, 2], b: [3, 2, 1, 0, 1, 2, 3, 2], gain: 0.065 },
    stabs: true, pad: 0.028,
  },
  // Warm, hazy, a little slower and swingier: sevenths under the clouds.
  venus: {
    bpm: 94, prog: [Fmaj7, Em, Dm, Cadd9, Fmaj7, Em, Dm, Gsus, Am7, Fmaj7, C, G, Am7, Fmaj7, Gsus, Cadd9],
    hook: { rhythm: [[0, 4], [4, 2], [6, 6], [12, 4]], shape: [2, 1, 0, 1], octave: 24 },
    drums: "pop", bass: { 0: 0, 6: 0, 8: 7, 14: 12 }, bassTone: "sine",
    glock: { every: 2, a: [0, 1, 2, 3, 2, 1, 2, 1], b: [3, 1, 2, 0, 3, 1, 2, 0], gain: 0.05 },
    stabs: true, pad: 0.04,
  },
  // Quick and bright, racing the sun: sixteenth-note sparkle.
  mercury: {
    bpm: 122, prog: [C, G, Am, F, C, G, F, G, Am, F, C, G, Am, F, G, G],
    hook: { rhythm: [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], shape: [0, 1, 2, 1, 2, 3], octave: 24 },
    drums: "pop", bass: { 0: 0, 2: 12, 4: 0, 6: 12, 8: 0, 10: 12, 12: 0, 14: 12 }, bassTone: "triangle",
    glock: { every: 1, a: [0, 1, 2, 3], b: [3, 2, 1, 0], gain: 0.035 },
    stabs: true, pad: 0.02,
  },
  // Dusty and heavier: half-time drums in A minor.
  mars: {
    bpm: 90, prog: [Am, Am, F, G, Am, Am, F, Em, F, G, Am, Am, F, G, Em, Em],
    hook: { rhythm: [[0, 6], [6, 2], [8, 8]], shape: [0, 2, 1], octave: 12 },
    drums: "half", bass: { 0: 0, 3: 0, 10: 0, 14: 7 }, bassTone: "sawtooth",
    glock: { every: 2, a: [0, 0, 2, 0, 1, 0, 2, 0], b: [3, 0, 2, 0, 1, 0, 2, 0], gain: 0.04 },
    stabs: false, pad: 0.035,
  },
  // Stately and big: the giant's anthem.
  jupiter: {
    bpm: 100, prog: [C, F, C, G, Am, F, G, G, F, C, G, Am, F, C, G, C],
    hook: { rhythm: [[0, 8], [8, 4], [12, 4]], shape: [2, 1, 0], octave: 24 },
    drums: "pop", bass: { 0: 0, 8: 0, 12: 7 }, bassTone: "triangle",
    glock: { every: 2, a: [0, 1, 2, 3, 2, 1, 0, 1], b: [0, 2, 3, 2, 0, 2, 3, 2], gain: 0.05 },
    stabs: true, pad: 0.05,
  },
  // Dreamy and circling, like its rings: arpeggios that go round and round.
  saturn: {
    bpm: 96, prog: [Am7, Fmaj7, Cadd9, Gsus, Am7, Fmaj7, Cadd9, G, Dm, Fmaj7, Am7, Gsus, Dm, Fmaj7, Gsus, G],
    hook: { rhythm: [[0, 3], [3, 3], [6, 3], [9, 7]], shape: [0, 1, 2, 3], octave: 24 },
    drums: "half", bass: { 0: 0, 6: 7, 8: 12, 14: 7 }, bassTone: "sine",
    glock: { every: 1, a: [0, 1, 2, 1], b: [0, 2, 1, 3], gain: 0.03 },
    stabs: false, pad: 0.045,
  },
  // Icy and tilted: sparse, glassy, lots of space.
  uranus: {
    bpm: 86, prog: [Em, C, G, Dm, Em, C, G, G, Am, Em, F, C, Am, Em, Dm, G],
    hook: { rhythm: [[0, 4], [8, 8]], shape: [3, 1], octave: 24 },
    drums: "sparse", bass: { 0: 0, 10: 7 }, bassTone: "sine",
    glock: { every: 2, a: [3, 1, 2, 0, 3, 2, 1, 0], b: [0, 3, 1, 2, 0, 3, 2, 1], gain: 0.05 },
    stabs: false, pad: 0.05, drone: 0.03,
  },
  // Deep and oceanic: slow swells, the lead far away.
  neptune: {
    bpm: 76, prog: [Am, Am, F, F, C, C, G, G, Dm, Dm, Am, Am, F, F, Em, Em],
    hook: { rhythm: [[0, 12]], shape: [2], octave: 12 },
    drums: "sparse", bass: { 0: 0 }, bassTone: "sine",
    glock: { every: 2, a: [0, 2, 3, 2, 0, 2, 3, 2], b: [1, 3, 2, 0, 1, 3, 2, 0], gain: 0.035 },
    stabs: false, pad: 0.065, drone: 0.05,
  },
  // A heartbeat, a drone, and a few notes falling in.
  blackhole: {
    bpm: 64, prog: [Am, Am, Am, Am, F, F, Em, Em, Am, Am, Dm, Dm, F, F, Em, Em],
    hook: null,
    drums: "pulse", bass: { 0: 0 }, bassTone: "sine",
    glock: { every: 2, a: [3, -1, -1, 2, -1, -1, 1, -1], b: [2, -1, 0, -1, -1, 3, -1, -1], gain: 0.04 },
    stabs: false, pad: 0.07, drone: 0.08,
  },
};

let song: Song = SONGS.earth;
let pending: Song | null = null;
let playing = false;
let step = 0;
let nextTime = 0;
let timer = 0;

const stepSeconds = (s: Song) => 60 / s.bpm / 4;    // one sixteenth note

/** Begin (or resume) the loop. Safe to call repeatedly. */
export function startMusic() {
  if (isMusicMuted()) return;
  const c = audioCore();
  if (!c || playing) return;
  playing = true;
  nextTime = c.ctx.currentTime + 0.08;
  timer = window.setInterval(schedule, 30);
}

export function stopMusic() {
  playing = false;
  window.clearInterval(timer);
}

export const isMusicPlaying = () => playing;

/**
 * Change record. While playing, the new song comes in at the next bar line so
 * the groove never stumbles; while stopped it is simply queued.
 */
export function setSong(key: PhaseKey) {
  const next = SONGS[key] ?? SONGS.earth;
  if (next === song) { pending = null; return; }
  if (!playing) { song = next; step = 0; pending = null; return; }
  pending = next;
}

function schedule() {
  const c = audioCore();
  if (!c || !playing) return;
  // After the tab was hidden the clock has run on without us; jump forward
  // rather than firing every missed note at once.
  if (nextTime < c.ctx.currentTime - 0.1) nextTime = c.ctx.currentTime + 0.05;
  while (nextTime < c.ctx.currentTime + 0.14) {
    if (pending && step % 16 === 0) {
      // A soft crash to mark the change of planet.
      noiseHit({ t0: nextTime, dur: 2, gain: 0.08, type: "highpass", freq: 4000, bus: c.musicBus });
      song = pending; pending = null; step = 0;
    }
    play(song, step, nextTime, c.musicBus);
    nextTime += stepSeconds(song);
    step = (step + 1) % (song.prog.length * 16);
  }
}

let resumeOnShow = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (playing) { stopMusic(); resumeOnShow = true; } }
  else if (resumeOnShow) { resumeOnShow = false; startMusic(); }
});

/** The B-section lead for a bar, either written out or built from the chord's own tones. */
function hookFor(sg: Song, bar: number): Note[] {
  const h = sg.hook;
  if (!h) return [];
  if (Array.isArray(h)) return h[bar - 8] ?? [];
  const chord = sg.prog[bar];
  const tones = [...chord.tones, chord.tones[0] + 12];
  // Turn the shape over every other bar so the line answers itself.
  const flip = bar % 2 === 1;
  return h.rhythm.map(([at, len], k) => {
    const j = h.shape[k % h.shape.length];
    return [at, tones[flip ? 3 - j : j] + h.octave, len] as Note;
  });
}

function play(sg: Song, n: number, t: number, bus: AudioNode) {
  const STEP = stepSeconds(sg);
  const bar = Math.floor(n / 16);
  const s = n % 16;
  const chord = sg.prog[bar];
  const inB = bar >= 8;
  // A breath of human timing: velocities wobble a touch so the loop never feels
  // like a metronome, deterministically so it wobbles the same way every pass.
  const v = 0.9 + (((n * 7919) % 17) / 17) * 0.2;

  // ------------------------------------------------ drums
  const kick = (g = 0.55) => tone({ t0: t, freq: 140, glide: 46, dur: 0.22, gain: g * v, type: "sine", bus });
  const clap = (g = 1) => {
    noiseHit({ t0: t, dur: 0.16, gain: 0.2 * g * v, type: "bandpass", freq: 1500, q: 0.8, bus });
    noiseHit({ t0: t + 0.012, dur: 0.12, gain: 0.1 * g * v, type: "bandpass", freq: 2400, q: 1.2, bus });
  };
  const hat = (g: number) => noiseHit({ t0: t, dur: 0.035, gain: 0.05 * g * v, type: "highpass", freq: 8500, pan: 0.25, bus });
  switch (sg.drums) {
    case "pop":
      if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1) || (inB && s === 6)) kick();
      if (s === 4 || s === 12) clap();
      if (s % 2 === 0 || (inB && s % 2 === 1 && s > 11)) hat(s % 4 === 2 ? 1 : 0.55);
      if (s === 14 && bar % 2 === 1) noiseHit({ t0: t, dur: 0.28, gain: 0.04, type: "highpass", freq: 7000, pan: 0.25, bus });
      break;
    case "half":
      if (s === 0 || (s === 10 && inB)) kick(0.6);
      if (s === 8) clap(1.1);
      if (s % 2 === 0) hat(s % 4 === 0 ? 0.5 : 0.9);
      break;
    case "sparse":
      if (s === 0 && bar % 2 === 0) kick(0.4);
      if (s === 8 && inB) clap(0.5);
      if (s % 4 === 2) hat(0.5);
      break;
    case "pulse":
      // Lub-dub, once a bar.
      if (s === 0) kick(0.5);
      if (s === 3) kick(0.3);
      break;
    case "none": break;
  }
  // A soft crash at the top of each section, so the loop has a shape.
  if (s === 0 && (bar === 0 || bar === 8) && sg.drums !== "none") {
    noiseHit({ t0: t, dur: 1.6, gain: 0.07, type: "highpass", freq: 5000, bus });
  }

  // ------------------------------------------------ bass
  if (s in sg.bass) {
    const f = midi(chord.bass + sg.bass[s]);
    const soft = sg.bassTone === "sawtooth" ? 0.08 : 0.26;
    tone({ t0: t, freq: f, dur: STEP * 2.4, gain: soft * v, type: sg.bassTone, bus });
    tone({ t0: t, freq: f, dur: STEP * 2.0, gain: 0.14 * v, type: "sine", bus });
  }

  // ------------------------------------------------ pad and drone: warmth under everything
  if (s === 0) {
    for (const note of chord.tones) {
      tone({ t0: t, freq: midi(note), dur: STEP * 15, gain: sg.pad, type: "sine", bus });
    }
    if (sg.drone && bar % 4 === 0) {
      tone({ t0: t, freq: midi(33), dur: STEP * 64, gain: sg.drone, type: "sine", bus });
      tone({ t0: t, freq: midi(33) * 1.004, dur: STEP * 64, gain: sg.drone * 0.6, type: "triangle", bus });
    }
  }

  // ------------------------------------------------ stabs: the syncopated pop piano
  if (sg.stabs && (s === 0 || s === 6 || s === 10 || (inB && s === 13))) {
    chord.tones.forEach((note, k) => {
      tone({ t0: t, freq: midi(note + 12), dur: STEP * 1.6, gain: 0.06 * v, type: "triangle", pan: (k - 1) * 0.3, bus });
    });
  }

  // ------------------------------------------------ glockenspiel: the sparkle
  const g = sg.glock;
  if (g && s % g.every === 0) {
    const up = [chord.tones[0] + 24, chord.tones[1] + 24, chord.tones[2] + 24, chord.tones[0] + 36];
    const pattern = inB ? g.b : g.a;
    const j = pattern[(s / g.every) % pattern.length];
    if (j >= 0) {
      bell({ t0: t, freq: midi(up[j]), dur: 0.7, gain: (inB ? g.gain * 0.7 : g.gain) * v, pan: s % 4 === 0 ? -0.35 : 0.35, bus });
    }
  }

  // ------------------------------------------------ the hook (B section)
  if (inB) {
    for (const [at, note, len] of hookFor(sg, bar)) {
      if (at !== s) continue;
      const d = STEP * len * 1.05;
      tone({ t0: t, freq: midi(note), dur: d, gain: 0.1, type: "triangle", bus });
      bell({ t0: t, freq: midi(note), dur: Math.min(1, d + 0.2), gain: 0.07, bus });
    }
  }

  // ------------------------------------------------ wind chimes into each section
  if ((bar === 7 || bar === 15) && s >= 8) {
    const fall = [100, 98, 96, 93, 91, 88, 86, 84];
    bell({ t0: t, freq: midi(fall[s - 8]), dur: 0.6, gain: 0.05, pan: ((s % 3) - 1) * 0.5, bus });
  }
}
