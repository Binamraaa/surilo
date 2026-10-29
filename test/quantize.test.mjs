// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Snapping hummed notes to the beat and writing them as note values, ties and rests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, steadyTempo, trackTempo } from '../src/core/rhythm.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { transcribe } from '../src/core/intent.js';

const NAME = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e' };
/** "q", "q.", "h", "e~" (tied to the next piece) … */
const code = (p) => NAME[p.value.base] + (p.value.dots ? '.' : '') + (p.tie ? '~' : '');
const pieces = (r) => r.notes.map((n) => n.pieces.map(code).join(''));

/** Notes sung exactly as written: [midi, beats] at `bpm`, with hummed gaps between them. */
function sung(melody, { bpm = 100, sig = '4/4', gap = 0.07, from = 0 } = {}) {
  const spb = 60 / bpm / (sig === '6/8' ? 3 : 1);
  let b = from;
  return melody.map(([midi, beats]) => {
    const n = { midi, start: b * spb, end: (b + beats) * spb - gap };
    b += beats;
    return n;
  });
}

test('Ode to Joy: quarters, then a dotted quarter, an eighth and a half', () => {
  const notes = sung(DEMO_MELODIES['Ode to Joy']);
  const r = quantize(notes, steadyTempo({ bpm: 100 }));
  assert.deepEqual(pieces(r), [...Array(12).fill('q'), 'q.', 'e', 'h']);
  assert.deepEqual(r.bars, { first: 0, count: 4 });
  assert.deepEqual(r.rests, []);
  assert.deepEqual(r.notes.map((n) => n.beat).slice(-3), [12, 13.5, 14]);
});

test('a note across the bar line is split and tied', () => {
  // Three beats, then a half note starting on beat 4: it ties into the next bar. The last
  // note (three beats from beat 2) crosses the middle of its bar, so it's a quarter tied to a half.
  const r = quantize(sung([[60, 1], [62, 1], [64, 1], [65, 2], [64, 3]]), steadyTempo({ bpm: 100 }));
  assert.deepEqual(pieces(r), ['q', 'q', 'q', 'q~q', 'q~h']);
  assert.deepEqual(r.notes[3].pieces.map((p) => p.beat), [3, 4]);
});

test('4/4: the middle of the bar stays visible, except for a note that fills it from beat 1', () => {
  // A dotted half on beat 1 is fine; a half on beat 2 is written quarter~quarter; a whole fills a bar.
  const r = quantize(sung([[60, 3], [62, 1], [64, 1], [65, 2], [67, 1], [60, 4]]), steadyTempo({ bpm: 100 }));
  assert.deepEqual(pieces(r), ['h.', 'q', 'q', 'q~q', 'q', 'w']);
});

test('rests: gaps of an eighth or more, and a whole silent bar', () => {
  // Beat 1, rest, beat 3; then a bar of silence; then a note on beat 2.
  const notes = sung([[60, 1]]).concat(sung([[62, 1]], { from: 2 }), sung([[64, 1]], { from: 9 }));
  const r = quantize(notes, steadyTempo({ bpm: 100 }));
  assert.deepEqual(pieces(r), ['q', 'q', 'q']);
  const rests = r.rests.map((x) => `${x.beat}:${x.bar ? 'bar' : code(x)}`);
  assert.deepEqual(rests, ['1:q', '3:q', '4:bar', '8:q', '10:h']);
});

test('3/4: a waltz with a dotted half', () => {
  const waltz = [[60, 2], [64, 1], [67, 2], [64, 1], [65, 3], [62, 2], [60, 1], [59, 3]];
  const r = quantize(sung(waltz, { sig: '3/4', bpm: 120 }), steadyTempo({ bpm: 120, sig: '3/4' }));
  assert.deepEqual(pieces(r), ['h', 'q', 'h', 'q', 'h.', 'h', 'q', 'h.']);
  assert.equal(r.bars.count, 5); // 15 beats
});

test('6/8: grouped in dotted quarters', () => {
  // In 6/8 a beat is an eighth: eighth eighth eighth | quarter eighth | dotted quarter …
  const jig = [[67, 1], [67, 1], [69, 1], [71, 2], [69, 1], [67, 3], [65, 1], [64, 2], [62, 4], [60, 2]];
  const r = quantize(sung(jig, { sig: '6/8', bpm: 90 }), steadyTempo({ bpm: 90, sig: '6/8' }));
  // The 4-eighth D crosses the middle of its bar, so it's a dotted quarter tied to an eighth.
  assert.deepEqual(pieces(r), ['e', 'e', 'e', 'q', 'e', 'q.', 'e', 'q', 'q.~e', 'q']);
  assert.equal(r.barLen, 6);
});

test('two notes on the same eighth: the later one moves on; a short gap closes up', () => {
  const r = quantize([
    { start: 0, end: 0.28 },      // eighth notes at 100 BPM are 0.3 s
    { start: 0.05, end: 0.55 },   // starts on the same eighth as the first
    { start: 0.62, end: 1.2 },    // a 70 ms gap after the second: legato
  ], steadyTempo({ bpm: 100 }));
  assert.deepEqual(r.notes.map((n) => [n.e, n.len]), [[0, 1], [1, 1], [2, 2]]);
});

test('end to end: a late, drifting singer comes out in clean note values', () => {
  const melody = [...DEMO_MELODIES['Ode to Joy'], [62, 2], ...DEMO_MELODIES['Ode to Joy']];
  const h = synthHum(melody, { bpm: 90, endBpm: 96, lateMs: 50, jitterMs: 25 });
  const { notes } = transcribe(analyseBuffer(h.samples, h.sampleRate));
  const map = trackTempo(notes.map((n) => n.start - h.grid.origin), { bpm: 90 });
  const r = quantize(notes, { sig: '4/4', beatAt: (t) => map.beatAt(t - h.grid.origin) });
  const ode = [...Array(12).fill('q'), 'q.', 'e', 'h'];
  // The extra half note joins the two phrases; the second phrase starts on bar 5, beat 3,
  // and its last half note lands exactly on bar 9.
  assert.deepEqual(pieces(r), [...ode, 'h', ...ode]);
  assert.deepEqual(r.notes.map((n) => n.beat), h.truth.map((n) => n.beat));
});
