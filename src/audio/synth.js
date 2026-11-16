// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Tiny Web Audio player: plays detected notes (guitar-ish pluck or soft piano),
// optional backing chords, or the original recording. Calls back with the playing index.

import { midiToHz } from '../core/pitch.js';
import { voiceChord } from '../core/theory.js';

let ctx = null;
export const getCtx = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx || ctx.state === 'closed') ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// Everything the synth plays goes through one compressor, so it can be loud
// without clipping when the melody and a chord sound together.
let master = null;
const getMaster = (c) => {
  if (master?.context === c) return master;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const makeup = c.createGain();
  makeup.gain.value = 1.8;
  comp.connect(makeup);
  makeup.connect(c.destination);
  master = comp;
  return master;
};

function voice(c, out, midi, when, dur, { timbre = 'guitar', gain = 0.35, sustain = false } = {}) {
  const hz = midiToHz(midi);
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  const oscs = [];
  if (timbre === 'pad') {
    // A soft, slow swell that holds: for moods whose chords should sit under the tune.
    for (const [type, mult, amp] of [['triangle', 1, 0.6], ['sine', 1.003, 0.4], ['sine', 2, 0.1]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const og = c.createGain(); og.gain.value = amp; o.connect(og); og.connect(lp); oscs.push(o);
    }
    lp.frequency.value = Math.min(3200, hz * 4);
    const rise = Math.min(0.35, dur / 3);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + rise);
    g.gain.setValueAtTime(gain, when + Math.max(rise, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.45);
  } else if (timbre === 'guitar') {
    // Plucked string: bright attack, filter closes as it decays.
    for (const [type, mult, amp] of [['sawtooth', 1, 0.55], ['triangle', 2, 0.25], ['sine', 1, 0.6]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const og = c.createGain(); og.gain.value = amp; o.connect(og); og.connect(lp); oscs.push(o);
    }
    lp.frequency.setValueAtTime(Math.min(8000, hz * 10), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, hz * 2), when + Math.min(1.2, dur + 0.3));
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.35);
  } else {
    for (const [type, mult, amp] of [['triangle', 1, 0.7], ['sine', 2, 0.18], ['sine', 3, 0.06]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const og = c.createGain(); og.gain.value = amp; o.connect(og); og.connect(lp); oscs.push(o);
    }
    lp.frequency.value = Math.min(6000, hz * 6);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(gain * 0.5, when + 0.4);
    // Backing chords hold for the whole phrase instead of fading out under it.
    if (sustain && dur > 0.5) g.gain.setValueAtTime(gain * 0.5, when + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.25);
  }
  lp.connect(g); g.connect(out);
  oscs.forEach((o) => { o.start(when); o.stop(when + dur + 0.5); });
  return oscs;
}

// ---------- How each mood plays its chords ----------
//
// A mood picks the chords (core/harmony.js); a feel says how they're played: strummed,
// broken into an arpeggio, held as a pad, comped. Every note a feel plays is a note
// of the chord at that moment, in the voicing voiceChord gives: it is a way of
// playing the chord, never a new line of music.
//
// Each feel has a pattern for one bar, as [position in beats, what, length in beats, loudness]:
//   'F' the full chord (bass and all)   'U' the chord without its bass   'B' the bass note
//   0, 1, 2… one note of the chord, counted from the bottom ('T' = the top one, 'T+' = an octave above it)
// `six` is the pattern for 6/8, in eighth notes. `hold` plays the chord once, for a hum with no beat.
const FEELS = {
  // Bright: a guitar strum on the strong beats, a lighter one in between.
  strum: { timbre: 'guitar', gain: 0.15, roll: 0.022,
    bar: [[0, 'F', 1.6, 1], [1.5, 'U', 0.5, 0.55], [2, 'F', 1.4, 0.85], [3.5, 'U', 0.5, 0.5]],
    six: [[0, 'F', 2.6, 1], [2, 'U', 0.8, 0.5], [3, 'F', 2.2, 0.85], [5, 'U', 0.8, 0.5]] },
  // Bittersweet: the chord one note at a time, up and back down.
  arp: { timbre: 'piano', gain: 0.17,
    bar: [[0, 'B', 2, 1], [0.5, 0, 1.5, 0.8], [1, 1, 1.5, 0.85], [1.5, 'T', 1.5, 0.9], [2, 1, 1.5, 0.8], [2.5, 0, 1.5, 0.75], [3, 1, 1, 0.8], [3.5, 'T', 0.8, 0.85]],
    six: [[0, 'B', 3, 1], [1, 0, 2, 0.8], [2, 1, 2, 0.85], [3, 'T', 2, 0.9], [4, 1, 1.5, 0.8], [5, 0, 1, 0.75]] },
  // Dark: one long, low swell.
  pad: { timbre: 'pad', gain: 0.13, low: true, bar: null },
  // Hopeful minor: short pushes off the beat, like a soul or funk keyboard.
  stabs: { timbre: 'piano', gain: 0.16, roll: 0.008,
    bar: [[0, 'F', 0.9, 1], [1.5, 'U', 0.3, 0.75], [2.5, 'U', 0.3, 0.7], [3, 'B', 0.5, 0.8], [3.5, 'U', 0.3, 0.75]],
    six: [[0, 'F', 1.6, 1], [2, 'U', 0.5, 0.7], [3, 'B', 1, 0.85], [4, 'U', 0.5, 0.7], [5, 'U', 0.5, 0.7]] },
  // Bluesy: a shuffle. The bass on the beat, the chord on the lazy third of it.
  shuffle: { timbre: 'guitar', gain: 0.15, roll: 0.012,
    bar: [[0, 'B', 0.6, 1], [0.667, 'U', 0.28, 0.8], [1, 'B', 0.6, 0.8], [1.667, 'U', 0.28, 0.75], [2, 'B', 0.6, 0.95], [2.667, 'U', 0.28, 0.8], [3, 'B', 0.6, 0.8], [3.667, 'U', 0.28, 0.75]],
    six: [[0, 'B', 1.8, 1], [2, 'U', 0.8, 0.8], [3, 'B', 1.8, 0.9], [5, 'U', 0.8, 0.8]] },
  // Dreamy: a held swell, with the chord's notes rising slowly through it, an octave up.
  shimmer: { timbre: 'pad', gain: 0.11, over: { timbre: 'piano', gain: 0.1 },
    bar: [[0, 0, 3, 1], [1, 1, 3, 1], [2, 'T', 3, 1], [3, 1, 2, 0.9]],
    six: [[0, 0, 4, 1], [2, 1, 4, 1], [4, 'T', 4, 1]] },
  // Epic: the bass drives in eighth notes, the chord lands hard on the strong beats.
  drive: { timbre: 'piano', gain: 0.17, low: true, roll: 0.006,
    bar: [[0, 'F', 1.8, 1], [0.5, 'B', 0.4, 0.6], [1, 'B', 0.4, 0.7], [1.5, 'B', 0.4, 0.6], [2, 'F', 1.8, 0.9], [2.5, 'B', 0.4, 0.6], [3, 'B', 0.4, 0.7], [3.5, 'B', 0.4, 0.65]],
    six: [[0, 'F', 2.8, 1], [1, 'B', 0.8, 0.6], [2, 'B', 0.8, 0.65], [3, 'F', 2.8, 0.9], [4, 'B', 0.8, 0.6], [5, 'B', 0.8, 0.65]] },
  // Jazzy: the bass holds the bar, the chord is placed around the beat (on 1, then just before 3).
  comp: { timbre: 'piano', gain: 0.15, roll: 0.01,
    bar: [[0, 'B', 1.9, 0.9], [0, 'U', 0.9, 0.85], [1.5, 'U', 0.35, 0.75], [2, 'B', 1.9, 0.8], [3.5, 'U', 0.4, 0.7]],
    six: [[0, 'B', 2.8, 0.9], [0, 'U', 1.2, 0.85], [2, 'U', 0.6, 0.7], [3, 'B', 2.8, 0.8], [5, 'U', 0.6, 0.7]] },
  // Floating / prog: eighth notes grouped 3 + 3 + 2 over a held bass.
  pulse: { timbre: 'piano', gain: 0.15,
    bar: [[0, 'B', 4, 1], [0, 'T', 1.2, 0.9], [0.5, 0, 1, 0.6], [1, 1, 1, 0.65], [1.5, 'T', 1.2, 0.9], [2, 0, 1, 0.6], [2.5, 1, 1, 0.65], [3, 'T', 1, 0.9], [3.5, 1, 0.8, 0.65]],
    six: [[0, 'B', 6, 1], [0, 'T', 2, 0.9], [1, 0, 2, 0.6], [2, 1, 2, 0.65], [3, 'T', 2, 0.9], [4, 0, 2, 0.6], [5, 1, 1.5, 0.65]] },
};
const HELD = { timbre: 'piano', gain: 0.16, roll: 0.02, bar: null };
export const FEEL_NAMES = Object.keys(FEELS);

/**
 * The sounds for one chord, lasting `span` seconds.
 * @param {string|null} feel  a key of FEELS (a mood's `play`), or null for a plain held chord
 * @param {number[]} voices  the chord as MIDI notes, bass first (voiceChord)
 * @param {{pulse:number, bar:number, six:boolean}|null} beat  seconds per beat and beats per bar; null = no beat
 * @returns {Array<{t:number, midi:number, dur:number, gain:number, timbre:string, sustain:boolean}>}
 */
export function chordSounds(feel, voices, span, beat = null) {
  const F = FEELS[feel] || HELD;
  const [bass, ...upper] = voices;
  const top = upper[upper.length - 1];
  const low = F.low && bass - 12 >= 28 ? [bass - 12] : [];
  const pick = (what) => (what === 'F' ? [...low, bass, ...upper] : what === 'U' ? upper : what === 'B' ? [...low, bass]
    : what === 'T' ? [top] : what === 'T+' ? [top + 12] : [upper[Math.min(what, upper.length - 1)]]);
  const out = [];
  const add = (t, notes, dur, gain, timbre, roll = 0, sustain = false) => notes.forEach((midi, j) => out.push({ t: t + j * roll, midi, dur, gain, timbre, sustain }));
  const pattern = beat && (beat.six ? F.six : F.bar);
  // A pad (and any chord with no beat to follow) is simply held for its whole span.
  if (F.timbre === 'pad' || !pattern) add(0, pick('F'), Math.max(0.3, span), F.gain, F.timbre, F.timbre === 'pad' ? 0 : (F.roll ?? 0.02) * (beat ? 1 : 1.6), true);
  if (!pattern) return out;
  const layer = F.over || (F.timbre === 'pad' ? null : F);
  if (!layer) return out;
  const { pulse, bar } = beat;
  for (let b0 = 0; b0 * pulse < span - 0.05; b0 += bar) {
    for (const [pos, what, len, loud] of pattern) {
      const t = (b0 + pos) * pulse;
      if (pos >= bar || t > span - 0.06) continue;
      // The rising notes of a shimmer sound an octave up, above the swell.
      const notes = F.over ? pick(what).map((m) => m + 12) : pick(what);
      add(t, notes, Math.max(0.12, Math.min(len * pulse, span - t + 0.25)), layer.gain * loud, layer.timbre, F.roll ?? 0);
    }
  }
  return out;
}

let current = null;

export function stopPlayback() {
  if (!current) return;
  current.stop();
  current = null;
}

/**
 * @param {Array<{midi,start,end}>} notes
 * @param {object} o
 * @param {'guitar'|'piano'} o.timbre
 * @param {Array<{chord:{tones:number[]}, start:number, end:number, play?:string}>} [o.progression]  `play`: how the chord is played (FEELS)
 * @param {{pulse:number, bar:number, six:boolean}} [o.beat]  the beat the chords are played to (none: each chord is held)
 * @param {Array<{t:number, level:0|1|2}>} [o.clicks]  a metronome click at each of these times (same clock as the notes)
 * @param {(i:number|null, t:number|null)=>void} o.onTick  playing note index & time in hum-seconds
 */
export function playNotes(notes, { timbre = 'guitar', progression = null, beat = null, clicks = null, onTick = () => {}, onEnd = () => {} } = {}) {
  stopPlayback();
  if (!notes.length) return;
  const c = getCtx();
  const out = c.createGain();
  out.gain.value = 0.9;
  out.connect(getMaster(c));
  const t0 = c.currentTime + 0.08;
  const offset = notes[0].start;
  const nodes = [];
  notes.forEach((n) => nodes.push(...voice(c, out, n.midi, t0 + n.start - offset, Math.max(0.12, n.end - n.start), { timbre })));
  if (progression) {
    progression.forEach((p, i) => {
      const end = progression[i + 1] ? progression[i + 1].start : p.end;
      // Played the way its mood plays chords (strummed, broken up, held, comped…).
      for (const s of chordSounds(p.play, voiceChord(p.chord), Math.max(0.3, end - p.start), beat)) {
        nodes.push(...voice(c, out, s.midi, t0 + p.start - offset + s.t, s.dur, { timbre: s.timbre, gain: s.gain, sustain: s.sustain }));
      }
    });
  }
  // The beat underneath: short high blips, louder on beat 1.
  for (const k of clicks || []) {
    const when = t0 + k.t - offset;
    if (when < t0 - 0.01) continue;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = k.level ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime([0.25, 0.35, 0.45][k.level], when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    o.connect(g); g.connect(out);
    o.start(when); o.stop(when + 0.04);
    nodes.push(o);
  }
  const endAt = t0 + notes[notes.length - 1].end - offset + 0.3;
  let raf = 0;
  const tick = () => {
    const t = c.currentTime - t0 + offset;
    if (c.currentTime > endAt) { finish(); return; }
    const i = notes.findIndex((n) => t >= n.start && t < n.end);
    onTick(i >= 0 ? i : null, t);
    raf = requestAnimationFrame(tick);
  };
  const finish = () => {
    cancelAnimationFrame(raf);
    onTick(null, null);
    onEnd();
    if (current?.id === id) current = null;
  };
  const id = Symbol('play');
  current = {
    id,
    stop() {
      nodes.forEach((o) => { try { o.stop(); } catch { /* not started */ } });
      out.disconnect();
      finish();
    },
  };
  raf = requestAnimationFrame(tick);
}

/** Play a single note or chord immediately (tapping a block or chord chip). */
export function playOnce(midis, timbre = 'guitar') {
  const c = getCtx();
  const out = c.createGain(); out.connect(getMaster(c));
  const t = c.currentTime + 0.02;
  const chord = midis.length > 1;
  midis.forEach((m, i) => voice(c, out, m, t + i * 0.025, chord ? 1.2 : 0.7, { timbre, gain: chord ? 0.2 : 0.35 }));
}

/** Play a list of chords one after another (each a list of MIDI notes), e.g. a mode's signature progression. */
export function playSequence(chords, { step = 0.8, timbre = 'piano' } = {}) {
  stopPlayback();
  const c = getCtx();
  const out = c.createGain(); out.connect(getMaster(c));
  const t0 = c.currentTime + 0.05;
  const nodes = [];
  chords.forEach((midis, k) => midis.forEach((m, i) => nodes.push(...voice(c, out, m, t0 + k * step + i * 0.02, step * 0.95, { timbre, gain: 0.2 }))));
  const id = Symbol('seq');
  current = { id, stop() { nodes.forEach((o) => { try { o.stop(); } catch { /* done */ } }); out.disconnect(); } };
}

/** Play back the original recording. */
export function playRecording({ samples, sampleRate }, { onTick = () => {}, onEnd = () => {} } = {}) {
  stopPlayback();
  const c = getCtx();
  const buf = c.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  // Laptop mics often record very quietly, so bring the peak up to near full scale.
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const boost = c.createGain();
  boost.gain.value = peak > 0 ? Math.min(30, 0.9 / peak) : 1;
  src.connect(boost);
  boost.connect(c.destination);
  const t0 = c.currentTime + 0.05;
  src.start(t0);
  let raf = 0;
  const id = Symbol('rec');
  const finish = () => { cancelAnimationFrame(raf); onTick(null, null); onEnd(); if (current?.id === id) current = null; };
  const tick = () => { onTick(null, c.currentTime - t0); raf = requestAnimationFrame(tick); };
  src.onended = finish;
  current = { id, stop() { try { src.stop(); } catch { /* ended */ } finish(); } };
  raf = requestAnimationFrame(tick);
}
