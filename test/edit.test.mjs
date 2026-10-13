import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transpose, setPitch, reshape, moveNote, deleteNote, addNote, splitNote, mergeWithNext, resolveGuess, indexOfId, withIds, createHistory, MIN_LEN,
} from '../src/core/edit.js';
import { toMidiFile } from '../src/core/midi.js';

const base = () => [
  { midi: 60, start: 0.0, end: 0.5 },
  { midi: 62, start: 0.6, end: 1.0 },
  { midi: 64, start: 1.1, end: 1.6 },
];

test('edits never mutate the original array', () => {
  const a = base();
  const snapshot = JSON.stringify(a);
  transpose(a, 0, 1); reshape(a, 1, { dEnd: 0.2 }); deleteNote(a, 2); splitNote(a, 0); mergeWithNext(a, 0);
  assert.equal(JSON.stringify(a), snapshot);
});

test('transpose by semitone and octave, marking the note edited', () => {
  const up = transpose(base(), 1, 1);
  assert.equal(up[1].midi, 63);
  assert.equal(up[1].edited, true);
  assert.equal(up[0].edited, undefined);
  assert.equal(transpose(base(), 0, -12)[0].midi, 48);
  assert.equal(setPitch(base(), 2, 65)[2].midi, 65);
});

test('resizing keeps a minimum length and never goes below zero', () => {
  const shrunk = reshape(base(), 0, { dEnd: -5 });
  assert.ok(shrunk[0].end - shrunk[0].start >= MIN_LEN - 1e-9);
  const early = reshape(base(), 0, { dStart: -3 });
  assert.equal(early[0].start, 0);
});

test('moving a note past its neighbour re-sorts and its id follows it', () => {
  const a = withIds(base());
  const b = moveNote(a, 0, 1.3); // C now starts at 1.3, after E
  assert.deepEqual(b.map((n) => n.midi), [62, 64, 60]);
  assert.equal(indexOfId(b, a[0].id), 2);
  assert.ok(Math.abs(b[2].end - b[2].start - 0.5) < 1e-9, 'length kept');
});

test('add, delete, split, merge', () => {
  const added = addNote(base(), { midi: 67, start: 0.52, end: 0.58 });
  assert.deepEqual(added.map((n) => n.midi), [60, 67, 62, 64]);
  assert.equal(deleteNote(base(), 1).length, 2);
  const split = splitNote(withIds(base()), 0);
  assert.equal(split.length, 4);
  assert.notEqual(split[0].id, split[1].id);
  assert.deepEqual([split[0].end, split[1].start], [0.25, 0.25]);
  const merged = mergeWithNext(base(), 0);
  assert.equal(merged.length, 2);
  assert.deepEqual([merged[0].midi, merged[0].start, merged[0].end], [60, 0, 1.0]);
});

test('undo history', () => {
  const h = createHistory(2);
  h.push([1]); h.push([2]); h.push([3]);
  assert.deepEqual(h.undo(), [3]);
  assert.deepEqual(h.undo(), [2]);
  assert.equal(h.undo(), null);
});

test('edited notes are what goes into the MIDI file', () => {
  const edited = transpose(base(), 0, 1); // C → C#
  const bytes = toMidiFile(edited);
  const noteOns = [];
  for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === 0x90) noteOns.push(bytes[i + 1]);
  assert.deepEqual(noteOns, [61, 62, 64]);
});

test('a best-guess note can be kept, put back, or settled by editing it', () => {
  // Sung 46 cents below F♯; the app picked F.
  const guessed = [{ midi: 60, start: 0, end: 0.5 }, { midi: 65, nearest: 66, cents: 54, adjusted: true, start: 0.6, end: 1 }];
  const kept = resolveGuess(guessed, 1, true);
  assert.equal(kept[1].midi, 65);
  assert.equal(kept[1].adjusted, false);
  assert.ok(!kept[1].edited);
  const back = resolveGuess(guessed, 1, false);
  assert.equal(back[1].midi, 66);
  assert.equal(back[1].cents, -46);
  assert.equal(back[1].adjusted, false);
  assert.equal(back[1].edited, true);
  assert.equal(resolveGuess(guessed, 0, true), guessed, 'notes that were not guessed are left alone');
  assert.equal(transpose(guessed, 1, 2)[1].adjusted, false);
  assert.equal(guessed[1].adjusted, true);
});
