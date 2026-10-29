// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Humming to a count-in: lining the hum up with the beat, following a singer who
// drifts, and keeping metronome clicks out of the notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gridOffset, trackTempo, stepsPerBeat, secondsPerBeat } from '../src/core/rhythm.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { transcribe } from '../src/core/intent.js';
import { framesToNotes } from '../src/core/notes.js';

// A longer tune, so drift has time to build up: Ode to Joy, then Twinkle (16 bars).
const LONG = [...DEMO_MELODIES['Ode to Joy'], [62, 2], ...DEMO_MELODIES['Twinkle Twinkle'], ...DEMO_MELODIES['Ode to Joy']];

/** Seeded ±1 noise, so the onset tests are repeatable. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** True onsets (s from bar 1) for a melody sung with a tempo changing steadily from bpm to endBpm. */
function onsetsFor(melody, { bpm, endBpm = bpm, lateMs = 0, jitterMs = 0, seed = 1 }) {
  const total = melody.reduce((s, [, b]) => s + b, 0);
  const rate = (endBpm - bpm) / total;
  const at = (b) => (rate ? (60 / rate) * Math.log((bpm + rate * b) / bpm) : (60 * b) / bpm);
  const r = rng(seed);
  let b = 0;
  return melody.map(([, beats]) => {
    const t = at(b) + (lateMs + r() * jitterMs) / 1000;
    const out = { t, beat: b };
    b += beats;
    return out;
  });
}

/** Every note lands on its own eighth-note step. */
function assertOnBeat(map, notes, sig = '4/4', label = '') {
  const sub = stepsPerBeat(sig);
  notes.forEach(({ t, beat }, i) => {
    assert.equal(Math.round(map.beatAt(t) * sub) + 0, Math.round(beat * sub), `${label} note ${i}: heard at beat ${map.beatAt(t).toFixed(2)}, belongs on ${beat}`);
  });
}

test('gridOffset: the steady lateness, ignoring one wild note', () => {
  const step = 0.3;
  const onsets = [0, 1, 2, 3, 4, 5, 7, 9].map((k) => k * step + 0.06);
  onsets.push(10 * step + 0.14); // way off
  assert.ok(Math.abs(gridOffset(onsets, step) - 0.06) < 1e-9);
  assert.ok(Math.abs(gridOffset([0.31, 0.59, 1.2].map((t) => t - 0.02), step) + 0.02) < 0.012);
  assert.equal(gridOffset([], step), 0);
});

test('trackTempo: a steady singer 60 ms late with ±40 ms of wobble', () => {
  for (const seed of [1, 2, 3]) {
    const notes = onsetsFor(DEMO_MELODIES['Ode to Joy'], { bpm: 100, lateMs: 60, jitterMs: 40, seed });
    const map = trackTempo(notes.map((n) => n.t), { bpm: 100 });
    assert.ok(Math.abs(map.offset - 0.06) <= 0.015, `seed ${seed}: offset ${(map.offset * 1000).toFixed(0)} ms`);
    assert.ok(Math.abs(map.drift) < 3, `seed ${seed}: drift ${map.drift.toFixed(1)}%`);
    assertOnBeat(map, notes, '4/4', `seed ${seed}`);
  }
});

test('trackTempo: follows a singer who speeds up (90 → 97) or slows down (100 → 92)', () => {
  for (const [bpm, endBpm] of [[90, 97], [100, 92]]) {
    const notes = onsetsFor(LONG, { bpm, endBpm, jitterMs: 25, seed: 4 });
    const map = trackTempo(notes.map((n) => n.t), { bpm });
    const truth = (endBpm / bpm - 1) * 100;
    assert.ok(Math.abs(map.drift - truth) <= 1.5, `${bpm}→${endBpm}: drift ${map.drift.toFixed(1)}%, truth ${truth.toFixed(1)}%`);
    assertOnBeat(map, notes, '4/4', `${bpm}→${endBpm}`);
    // Without following the drift, the later notes would land on the wrong beats.
    const naive = notes.filter(({ t, beat }) => Math.round((t / secondsPerBeat(bpm)) * 2) !== beat * 2);
    assert.ok(naive.length > 5, 'the drift is big enough to matter');
  }
});

test('trackTempo: 3/4 and 6/8', () => {
  // 3/4 waltz-ish, 6/8 counted in eighths (the BPM counts dotted quarters).
  const waltz = [[60, 2], [64, 1], [67, 2], [64, 1], [65, 3], [62, 2], [60, 1], [59, 3]];
  const n34 = onsetsFor(waltz, { bpm: 120, lateMs: 30, jitterMs: 30 });
  assertOnBeat(trackTempo(n34.map((n) => n.t), { bpm: 120, sig: '3/4' }), n34, '3/4');
  const jig = [[67, 1], [67, 1], [69, 1], [71, 2], [69, 1], [67, 3], [65, 1], [64, 2], [62, 3]];
  // In 6/8 a "beat" is an eighth, which lasts 60/bpm/3 s: 90 dotted quarters a minute = 270 eighths.
  const n68 = onsetsFor(jig, { bpm: 270, lateMs: 30, jitterMs: 25 });
  assertOnBeat(trackTempo(n68.map((n) => n.t), { bpm: 90, sig: '6/8' }), n68, '6/8');
});

test('trackTempo: a click throughout keeps the tempo tight (±3%)', () => {
  const notes = onsetsFor(LONG, { bpm: 90, endBpm: 97 });
  const map = trackTempo(notes.map((n) => n.t), { bpm: 90, limit: 0.03 });
  assert.ok(map.bpmEnd <= 90 * 1.03 + 1e-6 && map.bpmStart >= 90 / 1.03 - 1e-6);
});

/** Transcribe a synthetic hum and line its notes up with the beat. */
function hummed(melody, opts, { mask = null, limit } = {}) {
  const h = synthHum(melody, opts);
  const { notes } = transcribe(analyseBuffer(h.samples, h.sampleRate), { mask });
  const map = trackTempo(notes.map((n) => n.start - h.grid.origin), { bpm: opts.bpm, limit });
  return { h, notes, map };
}

test('end to end: a hum 60 ms behind the beat, ±40 ms wobble, lands on the right beats', () => {
  const { h, notes, map } = hummed(DEMO_MELODIES['Ode to Joy'], { bpm: 100, lateMs: 60, jitterMs: 40 });
  assert.equal(notes.length, h.truth.length);
  assertOnBeat(map, notes.map((n, i) => ({ t: n.start - h.grid.origin, beat: h.truth[i].beat })));
  // The detector hears each note start a little after it begins (the attack), so allow
  // for that on top of the 60 ms; the tracker corrects all of it either way.
  assert.ok(map.offset > 0.04 && map.offset < 0.11, `offset ${(map.offset * 1000).toFixed(0)} ms`);
});

test('end to end: a singer who speeds up or slows down still lands every note on its beat', () => {
  for (const [bpm, endBpm] of [[90, 97], [100, 92]]) {
    const { h, notes, map } = hummed(LONG, { bpm, endBpm, jitterMs: 20 });
    assert.equal(notes.length, h.truth.length, `${bpm}→${endBpm}`);
    assertOnBeat(map, notes.map((n, i) => ({ t: n.start - h.grid.origin, beat: h.truth[i].beat })), '4/4', `${bpm}→${endBpm}`);
    const truth = (endBpm / bpm - 1) * 100;
    assert.ok(Math.abs(map.drift - truth) <= 1.5, `drift ${map.drift.toFixed(1)}%, truth ${truth.toFixed(1)}%`);
  }
});

// Our clicks are short and high, so even unmasked they rarely survive as notes (the
// shortest-note rule drops them). The mask is the safety net for louder, ringier speakers.
test('click bleed: with the clicks masked, no extra notes and none lost', () => {
  for (const name of ['Ode to Joy', 'Twinkle Twinkle']) {
    const h = synthHum(DEMO_MELODIES[name], { bpm: 100, lead: 3, clicks: { countIn: 4 } });
    const frames = analyseBuffer(h.samples, h.sampleRate);
    const mask = h.grid.clickTimes.map((t) => [t, t + 0.035]);
    const { notes } = transcribe(frames, { mask });
    assert.deepEqual(notes.map((n) => n.midi), h.truth.map((n) => n.midi), name);
  }
});

test('the mask: a click can’t start a note, but doesn’t cut one either', () => {
  // 10 ms frames: a 150 ms high blip (long enough to count as a note), silence, then a hummed E3
  // with a click window landing in the middle of it.
  const frames = [];
  for (let t = 0; t < 1.2; t += 0.01) {
    const midi = t < 0.15 ? 84 : t >= 0.3 && t < 1.0 ? 52 : null;
    frames.push({ t: Math.round(t * 100) / 100, midi, level: midi == null ? 0 : 0.2 });
  }
  const opts = { autoTune: false };
  assert.deepEqual(framesToNotes(frames, opts).notes.map((n) => n.midi), [84, 52], 'without a mask the blip is a note');
  const { notes } = framesToNotes(frames, { ...opts, mask: [[0, 0.16], [0.6, 0.64]] });
  assert.deepEqual(notes.map((n) => n.midi), [52]);
  assert.ok(notes[0].end - notes[0].start > 0.65, 'the hummed note runs straight through the click');
});

test('with no tempo, transcription is exactly as before', () => {
  const h = synthHum(DEMO_MELODIES['Greensleeves (minor)']);
  const frames = analyseBuffer(h.samples, h.sampleRate);
  assert.deepEqual(transcribe(frames, { mask: [] }), transcribe(frames));
  assert.deepEqual(transcribe(frames, { mask: null }), transcribe(frames));
});
