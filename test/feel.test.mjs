// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// The richer chords, and how each mood plays them. The rule that matters most:
// playback never sounds a note that isn't in the chord it is playing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonise, chordFor, paletteFor, noteRole, CHORD_TYPES } from '../src/core/harmony.js';
import { MOODS, moodById } from '../src/core/moods.js';
import { voiceChord } from '../src/core/theory.js';
import { chordSounds, FEEL_NAMES } from '../src/audio/synth.js';
import { DEMO_MELODIES } from '../src/core/demo.js';

const C = { tonic: 0, mode: 'major' };
const Am = { tonic: 9, mode: 'minor' };
const pcOf = (m) => ((m % 12) + 12) % 12;
const mel = (name) => DEMO_MELODIES[name].map(([m, b], i, a) => {
  const start = a.slice(0, i).reduce((s, [, x]) => s + x * 0.5, 0);
  return { midi: m, start, end: start + b * 0.5 - 0.05 };
});
const BEATS = [null, { pulse: 0.6, bar: 4, six: false }, { pulse: 0.5, bar: 3, six: false }, { pulse: 0.3, bar: 6, six: true }];

test('the richer numerals become the right chords', () => {
  const name = (home, s) => chordFor(home, s).name;
  assert.deepEqual(['ii9', 'V13', 'Imaj9', '♭II7', 'V7♭9', 'I7♯9', 'IVmaj7♯11', 'V7sus4', 'I5', 'iv6', 'viadd9', 'I/3', 'V/7', '♭VII9'].map((s) => name(C, s)),
    ['Dm9', 'G13', 'Cmaj9', 'D♭7', 'G7♭9', 'C7♯9', 'Fmaj7♯11', 'G7sus4', 'C5', 'Fm6', 'Am(add9)', 'C/E', 'G/B', 'B♭9']);
  assert.deepEqual(['i9', 'iiø', 'V7♭9', '♭IImaj7', 'iadd9'].map((s) => name(Am, s)), ['Am9', 'Bm7♭5', 'E7♭9', 'B♭maj7', 'Am(add9)']);
  assert.deepEqual([...chordFor(C, 'V13').tones].sort((a, b) => a - b), [2, 4, 5, 7, 11]); // G B D E F
  // The extension is part of the chord: a melody note on the 9th is a chord tone, not a passing colour.
  assert.equal(noteRole(chordFor(C, 'ii9'), 4), 'tone');
  assert.equal(noteRole(chordFor(C, 'I7♯9'), 3), 'tone'); // the blue note
  assert.equal(noteRole(chordFor(C, 'I5'), 3), 'tension'); // a power chord takes either 3rd
  assert.equal(noteRole(chordFor(C, 'I5'), 4), 'tension');
});

test('extensions are voiced on top, and big chords drop their 5th', () => {
  const [bass, ...upper] = voiceChord(chordFor(C, 'ii9')); // Dm9: D F A C E
  assert.equal(pcOf(bass), 2);
  assert.equal(pcOf(upper.at(-1)), 4, 'the 9th is the top note');
  assert.ok(upper.at(-1) - upper[0] > 12, 'more than an octave above the root');
  assert.ok(!upper.map(pcOf).includes(9), 'no plain 5th');
  for (const type of Object.keys(CHORD_TYPES)) {
    const chord = { root: 0, bass: null, type, tones: CHORD_TYPES[type].tones };
    const v = voiceChord(chord);
    assert.ok(v.every((m) => m >= 36 && m <= 79), `${type}: ${v}`);
    assert.ok(v.every((m) => chord.tones.includes(pcOf(m))), type);
  }
});

test('every mood has a way of playing its chords', () => {
  for (const mood of MOODS) assert.ok(FEEL_NAMES.includes(mood.play), `${mood.id}: ${mood.play}`);
  assert.equal(new Set(MOODS.map((m) => m.play)).size, MOODS.length, 'and no two moods play the same way');
});

test('playback only ever sounds notes of the chord: nothing is added', () => {
  for (const mood of MOODS) {
    for (const home of [C, Am]) {
      for (const chord of paletteFor(mood, home)) {
        const voices = voiceChord(chord);
        for (const beat of BEATS) {
          for (const span of [0.4, 2.4, 4.8]) {
            const sounds = chordSounds(mood.play, voices, span, beat);
            assert.ok(sounds.length >= 1, `${mood.id} ${chord.name}`);
            for (const s of sounds) {
              assert.ok(chord.tones.includes(pcOf(s.midi)), `${mood.id}: ${s.midi} is not in ${chord.name}`);
              assert.ok(s.t >= 0 && s.t < Math.max(span, 0.31), `${mood.id} ${chord.name}: starts inside the chord`);
              assert.ok(s.dur > 0 && s.gain > 0 && s.gain <= 0.2);
            }
          }
        }
      }
    }
  }
});

test('with a beat a mood plays a pattern; without one it holds the chord', () => {
  const voices = voiceChord(chordFor(C, 'I7'));
  const held = chordSounds('shuffle', voices, 2.4, null);
  assert.ok(held.every((s) => s.t < 0.2), 'one strum');
  const swung = chordSounds('shuffle', voices, 2.4, BEATS[1]);
  assert.ok(swung.length > held.length);
  assert.ok(swung.some((s) => Math.abs(s.t - 0.667 * 0.6) < 0.02), 'the chord lands on the lazy third of the beat');
  // A feel nobody defined falls back to a plain held chord.
  assert.ok(chordSounds('nonsense', voices, 2, BEATS[1]).every((s) => s.t < 0.2));
});

test('the wandering moods keep moving instead of rocking between two chords', () => {
  for (const id of ['floating', 'jazzy', 'dreamy']) {
    assert.ok(moodById(id).wander > 0);
    for (const name of Object.keys(DEMO_MELODIES)) {
      const roots = harmonise(mel(name), { journey: id })[0].map((e) => e.chord.root);
      const moves = roots.filter((r, i) => i === 0 || r !== roots[i - 1]);
      const backs = moves.filter((r, i) => i >= 2 && r === moves[i - 2]).length;
      assert.ok(backs <= Math.max(1, moves.length / 3), `${id} on ${name}: ${roots.join(' ')}`);
    }
  }
});

test('Jazzy, Bluesy and Floating reach beyond plain 7ths', () => {
  const types = (id) => new Set(Object.keys(DEMO_MELODIES).flatMap((n) => harmonise(mel(n), { journey: id }).flat().map((e) => e.chord.type)));
  assert.ok([...types('jazzy')].some((t) => ['9', '13', 'm9', 'maj9', '7b9', 'm7b5'].includes(t)), [...types('jazzy')].join(' '));
  assert.ok(types('jazzy').size >= 6);
  assert.ok([...types('bluesy')].some((t) => ['9', '13', '7s9', 'm9'].includes(t)), [...types('bluesy')].join(' '));
  assert.ok([...types('floating')].some((t) => ['maj7', 'madd9', 'maj7s11'].includes(t)), [...types('floating')].join(' '));
  assert.ok(types('floating').size >= 5);
});
