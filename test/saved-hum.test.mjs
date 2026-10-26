// Saved hums: the JSON that brings a hum back, on its own and inside a WAV file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { humMeta, readHumMeta, defaultHumName, humFileName, HUM_FORMAT } from '../src/core/saved-hum.js';
import { encodeWav, decodeWav } from '../src/core/wav.js';
import { withIds, transpose, deleteNote } from '../src/core/edit.js';

const detected = withIds([
  { midi: 60, pitch: 60.1, cents: 10, start: 0.5, end: 1.0 },
  { midi: 62, pitch: 61.6, cents: -40, start: 1.0, end: 1.5, adjusted: true, nearest: 61 },
  { midi: 64, pitch: 64, cents: 0, start: 1.6, end: 2.4 },
]);
const tempo = { bpm: 96, sig: '3/4', mode: 'countin', countIn: 1, origin: 0.5, clicks: [0.1, 0.3], starts: [0.5, 1.0, 1.6], beatAt: () => 0 };
const choices = { moodId: 'dreamy', homeKey: { tonic: 2, mode: 'minor' }, journeyId: 'custom', strip: ['dark', 'hopeful'], versions: { journey: 2 }, octave: -1 };
const base = { id: 'h1', name: 'Morning idea', createdAt: '2026-10-26T09:00:00.000Z', source: 'mic', mic: 'Phone mic', tuning: -0.2 };

test('a hum comes back as it was saved', () => {
  const edited = transpose(deleteNote(detected, 2), 0, 1);
  const back = readHumMeta(JSON.parse(JSON.stringify(humMeta({ ...base, original: detected, notes: edited, tempo, choices }))));
  assert.equal(back.name, 'Morning idea');
  assert.equal(back.tuning, -0.2);
  assert.deepEqual(back.original.map((n) => n.midi), [60, 62, 64]);
  assert.equal(back.original[1].adjusted, true);
  assert.equal(back.original[1].nearest, 61);
  assert.equal(back.original[0].id, undefined, 'ids are handed out again on opening');
  assert.deepEqual(back.notes.map((n) => [n.midi, n.start, n.end]), edited.map((n) => [n.midi, n.start, n.end]));
  assert.equal(back.notes[0].edited, true);
  assert.deepEqual(back.tempo, { bpm: 96, sig: '3/4', mode: 'countin', countIn: 1, origin: 0.5, clicks: [0.1, 0.3], starts: [0.5, 1.0, 1.6] });
  assert.deepEqual(back.choices, choices);
});

test('unedited notes are stored once', () => {
  const meta = humMeta({ ...base, original: detected, notes: detected });
  assert.equal(meta.notes, null);
  const back = readHumMeta(meta);
  assert.equal(back.notes, null);
  assert.equal(back.tempo, null);
  assert.deepEqual(back.choices, { moodId: null, homeKey: null, journeyId: 'steady', strip: null, versions: {}, octave: 0 });
});

test('a saved hum travels inside a WAV file that still plays', () => {
  const sr = 16000;
  const samples = Float32Array.from({ length: sr }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const meta = humMeta({ ...base, original: detected, notes: detected, tempo, choices });
  const file = decodeWav(encodeWav(samples, sr, meta));
  assert.equal(file.sampleRate, sr);
  assert.equal(file.samples.length, sr);
  assert.ok(Math.abs(file.samples[100] - samples[100]) < 1e-4);
  assert.equal(file.meta.format, HUM_FORMAT);
  assert.deepEqual(readHumMeta(file.meta).choices, choices);
});

test('other JSON is not a saved hum', () => {
  assert.equal(readHumMeta(null), null);
  assert.equal(readHumMeta({ format: 'hum-to-notes-test', detected: [] }), null);
  assert.equal(readHumMeta({ format: HUM_FORMAT }), null, 'no notes');
});

test('odd values are tidied up rather than trusted', () => {
  const back = readHumMeta({
    format: HUM_FORMAT, name: '  ', original: [{ midi: 60, start: 0, end: 1 }, { midi: 'x' }],
    tempo: { bpm: 'fast' }, choices: { octave: 5, homeKey: { tonic: 'C' } },
  });
  assert.equal(back.name, 'My hum');
  assert.equal(back.original.length, 1);
  assert.equal(back.tempo, null);
  assert.equal(back.choices.octave, 0);
  assert.equal(back.choices.homeKey, null);
});

test('names and file names', () => {
  assert.equal(defaultHumName(new Date(2026, 9, 26, 9, 5)), 'Hum, 26 Oct 09:05');
  assert.equal(humFileName('Morning idea!'), 'morning-idea.surilo.wav');
  assert.equal(humFileName('???'), 'hum.surilo.wav');
});
