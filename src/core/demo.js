// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
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

/**
 * How each sample is written: its time signature, and how many beats come before
 * bar 1 (a pickup). Greensleeves and Für Elise both start on the beat before bar 1.
 */
export const DEMO_TIMING = {
  'Ode to Joy': { sig: '4/4', pickup: 0 },
  'Twinkle Twinkle': { sig: '4/4', pickup: 0 },
  'Greensleeves (minor)': { sig: '3/4', pickup: 1 },
  'Für Elise': { sig: '3/4', pickup: 1 },
};

/** Simple seeded PRNG so demos and tests are reproducible. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * @param {Array<[number, number]>} melody  [midi, beats]
 * @param {object} [o]
 * @returns {{samples: Float32Array, sampleRate: number,
 *   truth: Array<{midi:number, start:number, end:number, beat:number, beats:number}>,
 *   grid: {bpm:number, endBpm:number, origin:number, timeAt(beat:number):number, clickTimes:number[]}}}
 *   truth.beat: where each note belongs (quarter-note beats from the first note);
 *   grid.origin: the time of beat 0; grid.timeAt: the true beat → seconds map (follows endBpm)
 */
export function synthHum(melody, o = {}) {
  const {
    sampleRate = 44100, bpm = 100, transpose = -12, detuneCents = -25,
    vibratoCents = 30, vibratoHz = 5.2, noise = 0.02, gap = 0.07, seed = 7, lead = 0.4,
    sloppyCents = 0,  // each note misses its target by up to ± this much
    driftCents = 0,   // the whole hum slides this far, linearly from start to end
    endBpm = bpm,     // the tempo changes steadily from bpm to this by the end
    jitterMs = 0,     // each note starts up to ± this early or late
    lateMs = 0,       // the whole hum is this far behind the beat
    clicks = null,    // {countIn, perBeat, hz, ms, gain}: mix in metronome clicks on every beat (click bleed)
  } = o;
  const rand = rng(seed);
  // Separate random stream, so adding sloppiness doesn't change the rest of the hum.
  const slop = rng(seed + 1000);
  const beat = 60 / bpm;
  // Seconds from beat 0 to beat b, for a tempo changing steadily from bpm to endBpm.
  const beatsTotal = melody.reduce((s, [, b]) => s + b, 0);
  const rate = (endBpm - bpm) / beatsTotal;
  const steady = endBpm === bpm;
  const timeAt = (b) => (steady ? b * beat : (60 / rate) * Math.log((bpm + rate * b) / bpm));
  const timing = jitterMs || lateMs;
  const total = lead * 2 + (steady ? melody.reduce((s, [, b]) => s + b * beat, 0) : timeAt(beatsTotal))
    + (timing ? (lateMs + jitterMs) / 1000 : 0);
  const out = new Float32Array(Math.ceil(total * sampleRate));
  const truth = [];
  const jit = rng(seed + 2000); // its own stream, so timing options don't change anything else
  let t0 = lead;
  let b0 = 0;
  let phase = 0;

  for (const [m, beats] of melody) {
    const dur = steady ? beats * beat : timeAt(b0 + beats) - timeAt(b0);
    // A late or jittery singer starts off the beat but still lets go on time.
    const shift = timing ? (lateMs + (jit() * 2 - 1) * jitterMs) / 1000 : 0;
    const start = timing ? t0 + shift : t0;
    const sounding = Math.max(0.08, dur - gap - (timing ? shift - lateMs / 1000 : 0));
    const midi = m + transpose;
    truth.push({ midi, start, end: start + sounding, beat: b0, beats });
    const s0 = Math.floor(start * sampleRate);
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
    b0 += beats;
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * (rand() * 2 - 1);

  // Metronome clicks leaking into the mic: short high blips on every beat.
  const clickTimes = [];
  if (clicks) {
    const { countIn = 4, perBeat = 1, hz: pitch = null, ms = 30, gain = 0.35 } = clicks;
    for (let k = -countIn * perBeat; k <= beatsTotal * perBeat; k++) {
      const when = lead + (k < 0 ? (k / perBeat) * beat : timeAt(k / perBeat));
      if (when < 0) continue;
      clickTimes.push(when);
      const hz = pitch ?? (k % (4 * perBeat) === 0 ? 1500 : 1000);
      const s1 = Math.floor(when * sampleRate);
      for (let i = 0; i < (ms / 1000) * sampleRate && s1 + i < out.length; i++) {
        out[s1 + i] += gain * Math.sin((2 * Math.PI * hz * i) / sampleRate) * Math.exp(-i / sampleRate / ((ms / 1000) * 0.27));
      }
    }
  }
  return { samples: out, sampleRate, truth, grid: { bpm, endBpm, origin: lead, timeAt: (b) => lead + timeAt(b), clickTimes } };
}
