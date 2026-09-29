/**
 * Background music.
 *
 * An original 16-bar loop in the style of late-90s bubblegum pop — bouncy
 * octave bass, a clap on two and four, syncopated chord stabs, and a
 * glockenspiel arpeggio doing the sparkle — written for this game. It borrows
 * the genre's instrumentation and energy, not anybody's melody: the hook in
 * section B was composed here from the chord tones of its own progression.
 *
 * It is a step sequencer on the audio clock, not setTimeout: every note is
 * scheduled on `AudioContext.currentTime` a little ahead of when it sounds, so
 * the groove stays tight even when the main thread is busy generating a level.
 *
 *   A section  | Am  | F   | C   | G   | Am  | F   | C   | G   |
 *   B section  | F   | G   | Em  | Am  | F   | G   | C   | C   |
 *
 * All in C major, so the game's pentatonic sound effects sit inside it.
 */
import { audioCore, bell, noiseHit, tone, isMusicMuted } from "./audio";

const BPM = 104;
const STEP = 60 / BPM / 4;        // one sixteenth note
const BARS = 16;
const STEPS = BARS * 16;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Chord { bass: number; tones: [number, number, number] }

// Voiced close together so the stabs move smoothly from chord to chord.
const Am: Chord = { bass: 45, tones: [57, 60, 64] };
const F: Chord  = { bass: 41, tones: [57, 60, 65] };
const C: Chord  = { bass: 48, tones: [55, 60, 64] };
const G: Chord  = { bass: 43, tones: [55, 59, 62] };
const Em: Chord = { bass: 40, tones: [55, 59, 64] };

const PROGRESSION: Chord[] = [
  Am, F, C, G, Am, F, C, G,   // A
  F, G, Em, Am, F, G, C, C,   // B
];

/**
 * The hook, bars 8-15. [step within bar, MIDI note, length in sixteenths].
 * Every note is a tone of the chord underneath it, which is what keeps a
 * synthesised lead sounding sweet rather than wandering.
 */
const HOOK: [number, number, number][][] = [
  [[0, 84, 3], [3, 81, 3], [6, 84, 4], [10, 86, 2], [12, 84, 4]],   // F
  [[0, 83, 3], [3, 79, 3], [6, 83, 4], [10, 86, 6]],                 // G
  [[0, 88, 8], [8, 86, 4], [12, 83, 4]],                             // Em
  [[0, 84, 6], [6, 81, 4], [10, 76, 6]],                             // Am
  [[0, 81, 3], [3, 84, 3], [6, 89, 4], [10, 88, 6]],                 // F
  [[0, 86, 4], [4, 83, 4], [8, 79, 4], [12, 83, 4]],                 // G
  [[0, 84, 8], [8, 88, 4], [12, 91, 4]],                             // C
  [[0, 84, 10]],                                                     // C — breathe before the loop
];

let playing = false;
let step = 0;
let nextTime = 0;
let timer = 0;

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

function schedule() {
  const c = audioCore();
  if (!c || !playing) return;
  // After the tab was hidden the clock has run on without us; jump forward
  // rather than firing every missed note at once.
  if (nextTime < c.ctx.currentTime - 0.1) nextTime = c.ctx.currentTime + 0.05;
  while (nextTime < c.ctx.currentTime + 0.14) {
    play(step, nextTime, c.musicBus);
    nextTime += STEP;
    step = (step + 1) % STEPS;
  }
}

let resumeOnShow = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (playing) { stopMusic(); resumeOnShow = true; } }
  else if (resumeOnShow) { resumeOnShow = false; startMusic(); }
});

function play(n: number, t: number, bus: AudioNode) {
  const bar = Math.floor(n / 16);
  const s = n % 16;
  const chord = PROGRESSION[bar];
  const inB = bar >= 8;
  // A breath of human timing: velocities wobble a touch so the loop never feels
  // like a metronome, deterministically so it wobbles the same way every pass.
  const v = 0.9 + (((n * 7919) % 17) / 17) * 0.2;

  // ------------------------------------------------ drums
  if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1) || (inB && s === 6)) {
    tone({ t0: t, freq: 140, glide: 46, dur: 0.22, gain: 0.55 * v, type: "sine", bus });
  }
  if (s === 4 || s === 12) {
    noiseHit({ t0: t, dur: 0.16, gain: 0.2 * v, type: "bandpass", freq: 1500, q: 0.8, bus });
    noiseHit({ t0: t + 0.012, dur: 0.12, gain: 0.1 * v, type: "bandpass", freq: 2400, q: 1.2, bus });
  }
  if (s % 2 === 0 || (inB && s % 2 === 1 && s > 11)) {
    const accent = s % 4 === 2 ? 1 : 0.55;
    noiseHit({ t0: t, dur: 0.035, gain: 0.05 * accent * v, type: "highpass", freq: 8500, pan: 0.25, bus });
  }
  if (s === 14 && bar % 2 === 1) {
    noiseHit({ t0: t, dur: 0.28, gain: 0.04, type: "highpass", freq: 7000, pan: 0.25, bus });
  }
  // A soft crash at the top of each section, so the loop has a shape.
  if (s === 0 && (bar === 0 || bar === 8)) {
    noiseHit({ t0: t, dur: 1.6, gain: 0.07, type: "highpass", freq: 5000, bus });
  }

  // ------------------------------------------------ bass: bouncy octaves
  const bassSteps: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 };
  if (s in bassSteps) {
    const f = midi(chord.bass + bassSteps[s]);
    tone({ t0: t, freq: f, dur: STEP * 2.4, gain: 0.26 * v, type: "triangle", bus });
    tone({ t0: t, freq: f, dur: STEP * 2.0, gain: 0.14 * v, type: "sine", bus });
  }

  // ------------------------------------------------ pad: warmth under everything
  if (s === 0) {
    for (const note of chord.tones) {
      tone({ t0: t, freq: midi(note), dur: STEP * 15, gain: 0.028, type: "sine", bus });
    }
  }

  // ------------------------------------------------ stabs: the syncopated pop piano
  if (s === 0 || s === 6 || s === 10 || (inB && s === 13)) {
    chord.tones.forEach((note, k) => {
      tone({ t0: t, freq: midi(note + 12), dur: STEP * 1.6, gain: 0.06 * v, type: "triangle", pan: (k - 1) * 0.3, bus });
    });
  }

  // ------------------------------------------------ glockenspiel: the sparkle
  if (s % 2 === 0) {
    const up = [chord.tones[0] + 24, chord.tones[1] + 24, chord.tones[2] + 24, chord.tones[0] + 36];
    const pattern = inB ? [3, 2, 1, 0, 1, 2, 3, 2] : [0, 2, 1, 2, 3, 2, 1, 2];
    const note = up[pattern[s / 2]];
    bell({ t0: t, freq: midi(note), dur: 0.7, gain: (inB ? 0.045 : 0.065) * v, pan: s % 4 === 0 ? -0.35 : 0.35, bus });
  }

  // ------------------------------------------------ the hook (B section)
  if (inB) {
    for (const [at, note, len] of HOOK[bar - 8]) {
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
