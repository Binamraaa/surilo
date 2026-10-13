// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { intendNotes, transcribe } from '../src/core/intent.js';
import { framesToNotes } from '../src/core/notes.js';
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

test('a note hummed halfway between two goes to the one that fits the key', () => {
  // C major; the fourth note is 46 cents below F♯, i.e. closer to F♯ than to F.
  const pitches = [...UP_AND_DOWN];
  pitches[3] = 65.54;
  const { notes, key } = intendNotes(sung(pitches));
  assert.equal(key.name, 'C major');
  assert.equal(notes[3].nearest, 66);
  assert.equal(notes[3].midi, 65);
  assert.equal(notes[3].adjusted, true);
  assert.equal(notes[3].cents, 54);
  assert.equal(notes.filter((n) => n.adjusted).length, 1);
});

test('with no trust in the key, the nearest note wins', () => {
  const pitches = [...UP_AND_DOWN];
  pitches[3] = 65.54;
  const { notes } = intendNotes(sung(pitches), { trust: 0 });
  assert.equal(notes[3].midi, 66);
  assert.ok(notes.every((n) => !n.adjusted));
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
