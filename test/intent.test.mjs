// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { intendNotes, transcribe, steadyTuning } from '../src/core/intent.js';
import { framesToNotes, createLiveNotes, dropBlips } from '../src/core/notes.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';

// Notes as framesToNotes gives them: a raw sung pitch, half a second apart.
const sung = (pitches) => pitches.map((pitch, i) => ({ pitch, start: i * 0.5, end: i * 0.5 + 0.4 }));
const UP_AND_DOWN = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60];

test('notes sung clearly on pitch are never changed, even outside the key', () => {
  const pitches = [60, 62, 64, 66.1, 67, 69, 71, 72, 71, 69, 67, 66.12, 64, 62, 61.9, 60];
  const { notes } = intendNotes(sung(pitches));
  assert.deepEqual(notes.map((n) => n.midi), pitches.map(Math.round));
  assert.ok(notes.every((n) => !n.adjusted));
});

test('a note hummed halfway between two stays the nearest note, and the note that fits the key is only suggested', () => {
  // C major; the fourth note is 46 cents below F♯, i.e. closer to F♯ than to F.
  const pitches = [...UP_AND_DOWN];
  pitches[3] = 65.54;
  const { notes, key } = intendNotes(sung(pitches));
  assert.equal(key.name, 'C major');
  assert.equal(notes[3].midi, 66, 'what was hummed is what is shown');
  assert.equal(notes[3].suggest, 65, 'the note that fits the tune is only offered');
  assert.ok(Math.abs(notes[3].cents + 46) <= 3, 'still shown as flat of F♯');
  assert.equal(notes.filter((n) => n.suggest != null).length, 1);
  assert.ok(notes.every((n) => !n.adjusted));
});

test('with no trust in the key, nothing is suggested', () => {
  const pitches = [...UP_AND_DOWN];
  pitches[3] = 65.54;
  const { notes } = intendNotes(sung(pitches), { trust: 0 });
  assert.equal(notes[3].midi, 66);
  assert.ok(notes.every((n) => n.suggest == null));
});

test('the tuning is one steady line: level for a steady voice, sloping for a drifting one', () => {
  const level = steadyTuning(sung(UP_AND_DOWN.map((m) => m + 0.3)));
  assert.ok(Math.abs(level.start - 0.3) < 0.03 && Math.abs(level.end - 0.3) < 0.03);
  const sinking = steadyTuning(sung(UP_AND_DOWN.map((m, i) => m - (0.9 * i) / (UP_AND_DOWN.length - 1))));
  assert.ok(Math.abs(sinking.start) < 0.08, 'starts in tune');
  assert.ok(Math.abs(sinking.end + 0.9) < 0.08, 'ends most of a semitone flat');
  // A handful of notes can't tell drift from a missed note: the line stays level.
  const few = steadyTuning(sung([60, 62.2, 64.4]));
  assert.equal(few.start, few.end);
});

test('a voice that drifts most of a semitone flat is followed, not misread', () => {
  const pitches = UP_AND_DOWN.map((m, i) => m - (0.9 * i) / (UP_AND_DOWN.length - 1));
  const { notes } = intendNotes(sung(pitches));
  assert.deepEqual(notes.map((n) => n.midi), UP_AND_DOWN);
});

test('a sloppy, drifting synthetic singer is transcribed note for note', () => {
  // Each note misses by up to ±40 cents and the voice sinks 50 cents. Plain rounding
  // gets a note wrong; following the drift and the key gets them all.
  const melody = DEMO_MELODIES['Twinkle Twinkle'];
  const { samples, sampleRate, truth } = synthHum(melody, { sloppyCents: 40, driftCents: -50, detuneCents: 10, seed: 1 });
  const frames = analyseBuffer(samples, sampleRate);
  const plain = framesToNotes(frames).notes.map((n) => n.midi);
  const { notes } = transcribe(frames);
  assert.equal(notes.length, truth.length);
  assert.notDeepEqual(plain, truth.map((t) => t.midi));
  assert.deepEqual(notes.map((n) => n.midi), truth.map((t) => t.midi));
});

test('live notes match the finished analysis, without redoing the whole hum', () => {
  const melody = [...DEMO_MELODIES['Ode to Joy'], ...DEMO_MELODIES['Twinkle Twinkle']];
  const { samples, sampleRate } = synthHum(melody, { seed: 3 });
  const frames = analyseBuffer(samples, sampleRate);
  const live = createLiveNotes();
  let got;
  for (let n = 40; n < frames.length; n += 37) got = live.update(frames.slice(0, n));
  got = live.update(frames);
  const want = framesToNotes(frames);
  assert.equal(got.tuning, want.tuning);
  assert.deepEqual(got.notes, want.notes);
});

test('while humming, the note being sung shows at once', () => {
  const { samples, sampleRate } = synthHum([[60, 2]], { seed: 1 });
  const frames = analyseBuffer(samples, sampleRate);
  const first = frames.findIndex((f) => f.midi != null);
  const soon = frames.slice(0, first + 3); // three frames in: about 35 ms of voice
  assert.equal(framesToNotes(soon).notes.length, 0, 'too short to count as a finished note');
  assert.equal(createLiveNotes().update(soon).notes.length, 1);
});

test('a short sound far quieter than the hum is not a note', () => {
  const note = (start, peak, len = 0.4) => ({ pitch: 60, start, end: start + len, peak });
  const hum = [note(0, 0.02, 0.12), note(1, 0.1), note(2, 0.11), note(3, 0.09), note(4, 0.1)];
  assert.equal(dropBlips(hum).length, 4, 'the quiet blip goes');
  assert.equal(dropBlips([note(0, 0.02, 0.5), ...hum.slice(1)]).length, 5, 'a quiet note held long enough stays');
  assert.equal(dropBlips(hum.slice(0, 3)).length, 3, 'too few notes to know what is typical');
});
