import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeChords, prefersFlats, spell } from '../src/core/modes.js';

const names = (tonic, id) => modeChords(tonic, MODES.find((m) => m.id === id)).map((c) => c.name);

test('mode chord names and numerals are right in C', () => {
  assert.deepEqual(names(0, 'ionian'), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(names(0, 'mixolydian'), ['C', 'Dm', 'Edim', 'F', 'Gm', 'Am', 'B♭']);
  assert.deepEqual(names(0, 'lydian'), ['C', 'D', 'Em', 'F♯dim', 'G', 'Am', 'Bm']);
  assert.deepEqual(names(0, 'dorian'), ['Cm', 'Dm', 'E♭', 'F', 'Gm', 'Adim', 'B♭']);
  assert.deepEqual(names(0, 'phrygian'), ['Cm', 'D♭', 'E♭', 'Fm', 'Gdim', 'A♭', 'B♭m']);
  assert.deepEqual(names(0, 'harmonic'), ['Cm', 'Ddim', 'E♭aug', 'Fm', 'G', 'A♭', 'Bdim']);
  const mixo = modeChords(0, MODES.find((m) => m.id === 'mixolydian'));
  assert.equal(mixo[6].numeral, '♭VII');
  assert.equal(modeChords(0, MODES.find((m) => m.id === 'phrygian'))[1].numeral, '♭II');
});

test('notes are spelled by scale degree (C♯ in D harmonic minor, D♭ in C Phrygian)', () => {
  assert.deepEqual(names(2, 'harmonic'), ['Dm', 'Edim', 'Faug', 'Gm', 'A', 'B♭', 'C♯dim']);
  const mode = (id) => MODES.find((m) => m.id === id);
  assert.equal(spell(2, mode('ionian'), 4, 2), 'F♯');   // the 3rd of D major…
  assert.equal(spell(2, mode('harmonic'), 3, 2), 'F');  // …and of D minor
  assert.deepEqual(names(6, 'ionian'), ['G♭', 'A♭m', 'B♭m', 'C♭', 'D♭', 'E♭m', 'Fdim']);
});

test('sharp-side spelling: E Dorian and A Lydian', () => {
  assert.deepEqual(names(4, 'dorian'), ['Em', 'F♯m', 'G', 'A', 'Bm', 'C♯dim', 'D']);
  assert.deepEqual(names(9, 'lydian'), ['A', 'B', 'C♯m', 'D♯dim', 'E', 'F♯m', 'G♯m']);
});

test('note spelling follows the notes the melody uses', () => {
  const harm = MODES.find((m) => m.id === 'harmonic');
  const notes = [62, 64, 65, 67, 69, 67, 65, 64, 61, 62].map((m, i) => ({ midi: m, start: i, end: i + 0.5 }));
  assert.equal(prefersFlats(notes, 2, harm), false); // C♯, no B♭ → sharps
  assert.equal(prefersFlats([...notes, { midi: 70, start: 11, end: 12 }], 2, harm), true); // one B♭, one C♯: tie → key signature (flats)
  const phryg = MODES.find((m) => m.id === 'phrygian');
  assert.equal(prefersFlats([{ midi: 61, start: 0, end: 1 }, { midi: 60, start: 1, end: 2 }], 0, phryg), true); // D♭
});
