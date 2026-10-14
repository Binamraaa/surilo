import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeChords, rankModes, defaultModeId, rewriteInMode, prefersFlats } from '../src/core/modes.js';
import { suggestChords, guessKey } from '../src/core/theory.js';
import { DEMO_MELODIES } from '../src/core/demo.js';

const mel = (name) => DEMO_MELODIES[name].map(([m, b], i, a) => {
  const start = a.slice(0, i).reduce((s, [, x]) => s + x * 0.5, 0);
  return { midi: m, start, end: start + b * 0.5 - 0.05 };
});
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
  const ode = mel('Ode to Joy').map((n) => ({ ...n, midi: n.midi + 2 })); // in D
  const { changes } = rewriteInMode(ode, 2, MODES.find((m) => m.id === 'harmonic'));
  assert.deepEqual(changes, [{ from: 'F♯', to: 'F' }]);
  assert.deepEqual(names(6, 'ionian'), ['G♭', 'A♭m', 'B♭m', 'C♭', 'D♭', 'E♭m', 'Fdim']);
});

test('sharp-side spelling: E Dorian and A Lydian', () => {
  assert.deepEqual(names(4, 'dorian'), ['Em', 'F♯m', 'G', 'A', 'Bm', 'C♯dim', 'D']);
  assert.deepEqual(names(9, 'lydian'), ['A', 'B', 'C♯m', 'D♯dim', 'E', 'F♯m', 'G♯m']);
});

test('Ode to Joy (C D E F G only) fits both Major and Mixolydian, but not Lydian', () => {
  const r = rankModes(mel('Ode to Joy'), 0);
  const byId = Object.fromEntries(r.map((x) => [x.mode.id, x]));
  assert.equal(byId.ionian.fit, 1);
  assert.equal(byId.mixolydian.fit, 1);
  assert.ok(byId.lydian.fit < 1);
  assert.deepEqual(byId.lydian.clashes, ['F']);
  assert.equal(r[0].mode.id, 'ionian'); // familiar first on ties
});

test('a melody with a raised 4th ranks Lydian first', () => {
  const notes = [60, 62, 64, 66, 67, 66, 64, 62, 60].map((m, i) => ({ midi: m, start: i * 0.4, end: i * 0.4 + 0.35 }));
  assert.equal(rankModes(notes, 0)[0].mode.id, 'lydian');
});

test('harmonising in a chosen mode uses that mode\'s chords', () => {
  const notes = mel('Ode to Joy');
  const mixo = rankModes(notes, 0).find((x) => x.mode.id === 'mixolydian');
  const { progression } = suggestChords(notes, null, { chords: mixo.chords });
  const allowed = new Set(mixo.chords.map((c) => c.name));
  assert.ok(progression.every((p) => allowed.has(p.chord.name)));
  assert.ok(progression.some((p) => p.chord.name === 'B♭'), 'uses the Mixolydian ♭VII');
});

test('rewriting a melody into a mode moves only the clashing notes', () => {
  const notes = mel('Ode to Joy');
  const dorian = MODES.find((m) => m.id === 'dorian');
  const { notes: out, changes } = rewriteInMode(notes, 0, dorian);
  assert.deepEqual(changes, [{ from: 'E', to: 'E♭' }]);
  out.forEach((n, i) => assert.equal(n.midi, notes[i].midi === 64 ? 63 : notes[i].midi));
  assert.equal(rankModes(out, 0).find((r) => r.mode.id === 'dorian').fit, 1);
  const lyd = rewriteInMode(notes, 0, MODES.find((m) => m.id === 'lydian'));
  assert.deepEqual(lyd.changes, [{ from: 'F', to: 'F♯' }]);
});

test('default mode follows the detected key', () => {
  assert.equal(defaultModeId(guessKey(mel('Twinkle Twinkle'))[0]), 'ionian');
  const g = mel('Greensleeves (minor)');
  assert.equal(defaultModeId(guessKey(g)[0], g), 'harmonic'); // it sings G♯
});

test('note spelling follows the notes the melody uses', () => {
  const harm = MODES.find((m) => m.id === 'harmonic');
  const notes = [62, 64, 65, 67, 69, 67, 65, 64, 61, 62].map((m, i) => ({ midi: m, start: i, end: i + 0.5 }));
  assert.equal(prefersFlats(notes, 2, harm), false); // C♯, no B♭ → sharps
  assert.equal(prefersFlats([...notes, { midi: 70, start: 11, end: 12 }], 2, harm), true); // one B♭, one C♯: tie → key signature (flats)
  const phryg = MODES.find((m) => m.id === 'phrygian');
  assert.equal(prefersFlats([{ midi: 61, start: 0, end: 1 }, { midi: 60, start: 1, end: 2 }], 0, phryg), true); // D♭
});
