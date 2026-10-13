// Synthesise a realistic-ish hum so the app (and the tests) can run without a mic.
// Adds the things that make real hums hard: vibrato, scoops into notes, a slightly
// off tuning, breathy noise, soft attacks and short gaps between notes. Optionally
// also what untrained singers do: miss single notes by a few dozen cents, and
// drift flat or sharp over the course of a phrase.

import { midiToHz } from './pitch.js';

// Public-domain melodies, as [midi, beats].
export const DEMO_MELODIES = {
  'Ode to Joy': [
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
  ],
  'Twinkle Twinkle': [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ],
  'Greensleeves (minor)': [
    [57, 1], [60, 2], [62, 1], [64, 1.5], [65, 0.5], [64, 1], [62, 2], [59, 1], [55, 1.5], [57, 0.5], [59, 1], [60, 2], [57, 1], [57, 1.5], [56, 0.5], [57, 1], [59, 2], [56, 1], [52, 2],
  ],
  // Has notes outside its key (D♯ and G♯ in A minor), so it checks that guessing
  // the intended note doesn't "fix" notes that were meant.
  'Für Elise': [
    [76, 0.5], [75, 0.5], [76, 0.5], [75, 0.5], [76, 0.5], [71, 0.5], [74, 0.5], [72, 0.5], [69, 1.5],
    [60, 0.5], [64, 0.5], [69, 0.5], [71, 1.5], [64, 0.5], [68, 0.5], [71, 0.5], [72, 1.5],
  ],
};

/** Simple seeded PRNG so demos and tests are reproducible. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * @param {Array<[number, number]>} melody  [midi, beats]
 * @param {object} [o]
 * @returns {{samples: Float32Array, sampleRate: number, truth: Array<{midi:number,start:number,end:number}>}}
 */
export function synthHum(melody, o = {}) {
  const {
    sampleRate = 44100, bpm = 100, transpose = -12, detuneCents = -25,
    vibratoCents = 30, vibratoHz = 5.2, noise = 0.02, gap = 0.07, seed = 7, lead = 0.4,
    sloppyCents = 0,  // each note misses its target by up to ± this much
    driftCents = 0,   // the whole hum slides this far, linearly from start to end
  } = o;
  const rand = rng(seed);
  // Separate random stream, so adding sloppiness doesn't change the rest of the hum.
  const slop = rng(seed + 1000);
  const beat = 60 / bpm;
  const total = lead * 2 + melody.reduce((s, [, b]) => s + b * beat, 0);
  const out = new Float32Array(Math.ceil(total * sampleRate));
  const truth = [];
  let t0 = lead;
  let phase = 0;

  for (const [m, beats] of melody) {
    const dur = beats * beat;
    const sounding = Math.max(0.08, dur - gap);
    const midi = m + transpose;
    truth.push({ midi, start: t0, end: t0 + sounding });
    const s0 = Math.floor(t0 * sampleRate);
    const n = Math.floor(sounding * sampleRate);
    const scoop = -0.8 * rand(); // semitones below, at the attack
    const wobble = (rand() - 0.5) * 0.12;
    const miss = sloppyCents ? ((slop() * 2 - 1) * sloppyCents) / 100 : 0;
    const drift = ((driftCents / 100) * (t0 - lead)) / Math.max(1e-9, total - 2 * lead);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const scoopAmt = scoop * Math.exp(-t / 0.035);
      const vib = (vibratoCents / 100) * Math.sin(2 * Math.PI * vibratoHz * t) * Math.min(1, t / 0.25);
      const hz = midiToHz(midi + detuneCents / 100 + drift + miss + scoopAmt + vib + wobble);
      phase += (2 * Math.PI * hz) / sampleRate;
      // A hum is mostly fundamental with a few soft harmonics (closed-mouth "mmm").
      const voice = Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase) + 0.08 * Math.sin(4 * phase);
      const env = Math.min(1, t / 0.03) * Math.min(1, (sounding - t) / 0.05);
      out[s0 + i] += 0.25 * voice * env;
    }
    t0 += dur;
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * (rand() * 2 - 1);
  return { samples: out, sampleRate, truth };
}
