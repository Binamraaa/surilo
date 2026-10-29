// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Notes on the grid, on the way out: the MIDI file, and the built-in samples' rhythm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toMidiFile } from '../src/core/midi.js';
import { quantize, steadyTempo, trackTempo, secondsPerBeat } from '../src/core/rhythm.js';
import { synthHum, DEMO_MELODIES, DEMO_TIMING } from '../src/core/demo.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { transcribe } from '../src/core/intent.js';
import { harmonise } from '../src/core/harmony.js';

/** Read a format-1 MIDI file back: every event per track as {tick, type, ...}. */
function readMidi(bytes) {
  const ppq = (bytes[12] << 8) | bytes[13];
  const tracks = [];
  let i = 14;
  while (i < bytes.length) {
    const len = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
    let j = i + 8, tick = 0;
    const end = j + len, events = [];
    while (j < end) {
      let d = 0;
      do { d = (d << 7) | (bytes[j] & 0x7f); } while (bytes[j++] & 0x80);
      tick += d;
      const st = bytes[j];
      if (st === 0xff) {
        const type = bytes[j + 1], n = bytes[j + 2], data = [...bytes.slice(j + 3, j + 3 + n)];
        if (type === 0x51) events.push({ tick, type: 'tempo', us: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x58) events.push({ tick, type: 'sig', num: data[0], den: 2 ** data[1] });
        j += 3 + n;
        continue;
      }
      const kind = st & 0xf0;
      if (kind === 0x90) events.push({ tick, type: 'on', note: bytes[j + 1] });
      if (kind === 0x80) events.push({ tick, type: 'off', note: bytes[j + 1] });
      j += 3;
    }
    tracks.push(events);
    i = end;
  }
  return { ppq, tracks };
}

/** Notes sung exactly as written: [midi, beats] at `bpm`. */
function sung(melody, { bpm = 100, sig = '4/4', from = 0 } = {}) {
  const spb = secondsPerBeat(bpm, sig);
  let b = from;
  return melody.map(([midi, beats]) => {
    const n = { midi, start: b * spb, end: (b + beats) * spb - 0.07 };
    b += beats;
    return n;
  });
}

test('MIDI on the grid: tempo, time signature, bar 1 beat 1 at tick 0, lengths in ticks', () => {
  const notes = sung(DEMO_MELODIES['Ode to Joy'], { bpm: 92 });
  const tempo = steadyTempo({ bpm: 92 });
  const rhythm = quantize(notes, tempo);
  const prog = harmonise(notes, { journey: 'bright' })[0];
  const { ppq, tracks: [conductor, melody, chords] } = readMidi(toMidiFile(notes, prog, { rhythm, tempo }));
  assert.equal(ppq, 480);
  assert.deepEqual(conductor.find((e) => e.type === 'tempo'), { tick: 0, type: 'tempo', us: Math.round(60e6 / 92) });
  assert.deepEqual(conductor.find((e) => e.type === 'sig'), { tick: 0, type: 'sig', num: 4, den: 4 });
  const ons = melody.filter((e) => e.type === 'on');
  const offs = melody.filter((e) => e.type === 'off');
  assert.equal(ons[0].tick, 0);
  assert.deepEqual(ons.map((e) => e.tick), rhythm.notes.map((n) => n.e * 240));
  assert.deepEqual(offs.map((e) => e.tick), rhythm.notes.map((n) => (n.e + n.len) * 240));
  // The dotted quarter, eighth and half at the end of Ode to Joy: 720, 240 and 960 ticks.
  assert.deepEqual(rhythm.notes.slice(-3).map((n) => n.len * 240), [720, 240, 960]);
  // Every chord starts on a note of the grid, and the chords cover the tune to its last tick.
  const chordOns = [...new Set(chords.filter((e) => e.type === 'on').map((e) => e.tick))];
  assert.deepEqual(chordOns, prog.map((p) => rhythm.notes[p.firstIndex].e * 240));
  assert.equal(Math.max(...chords.map((e) => e.tick)), Math.max(...offs.map((e) => e.tick)));
});

test('MIDI in 6/8 and 3/4: the time signature, and 6/8 tempo counted in quarter notes', () => {
  const six = readMidi(toMidiFile(sung([[67, 3], [69, 3]], { sig: '6/8', bpm: 80 }), [], {
    rhythm: quantize(sung([[67, 3], [69, 3]], { sig: '6/8', bpm: 80 }), steadyTempo({ bpm: 80, sig: '6/8' })),
    tempo: { bpm: 80, sig: '6/8' },
  }));
  assert.deepEqual(six.tracks[0].find((e) => e.type === 'sig'), { tick: 0, type: 'sig', num: 6, den: 8 });
  assert.equal(six.tracks[0].find((e) => e.type === 'tempo').us, Math.round(60e6 / 120)); // 80 dotted quarters = 120 quarters
  // A pickup before bar 1: the file starts at the pickup bar, so nothing is before tick 0.
  const notes = sung([[57, 1], [60, 2], [62, 1]], { sig: '3/4', from: -1 });
  const rhythm = quantize(notes, steadyTempo({ bpm: 100, sig: '3/4' }));
  const ons = readMidi(toMidiFile(notes, [], { rhythm, tempo: { bpm: 100, sig: '3/4' } })).tracks[1].filter((e) => e.type === 'on');
  assert.deepEqual(ons.map((e) => e.tick), [2 * 480, 3 * 480, 5 * 480]); // the pickup is beat 3 of bar 0
});

test('MIDI without a beat is unchanged: real seconds at 120 BPM', () => {
  const notes = [{ midi: 60, start: 1, end: 1.5 }, { midi: 62, start: 1.5, end: 2.25 }];
  const { tracks } = readMidi(toMidiFile(notes));
  assert.equal(tracks[0].find((e) => e.type === 'tempo').us, 500000);
  assert.equal(tracks[0].find((e) => e.type === 'sig'), undefined);
  assert.deepEqual(tracks[1].filter((e) => e.type === 'on').map((e) => e.tick), [0, 480]);
});

test('the samples come with their real rhythm, pickups and all', () => {
  const code = (p) => ({ whole: 'w', half: 'h', quarter: 'q', eighth: 'e' }[p.value.base]) + (p.value.dots ? '.' : '') + (p.tie ? '~' : '');
  const expect = {
    'Ode to Joy': [...Array(12).fill('q'), 'q.', 'e', 'h'],
    'Twinkle Twinkle': ['q', 'q', 'q', 'q', 'q', 'q', 'h', 'q', 'q', 'q', 'q', 'q', 'q', 'h'],
    'Greensleeves (minor)': ['q', 'h', 'q', 'q.', 'e', 'q', 'h', 'q', 'q.', 'e', 'q', 'h', 'q', 'q.', 'e', 'q', 'h', 'q', 'h'],
    'Für Elise': ['e', 'e', 'e', 'e', 'e', 'e', 'e', 'e', 'q.', 'e', 'e', 'e', 'q.', 'e', 'e', 'e', 'q.'],
  };
  for (const [name, melody] of Object.entries(DEMO_MELODIES)) {
    const { sig, pickup } = DEMO_TIMING[name];
    const h = synthHum(melody);
    const { notes } = transcribe(analyseBuffer(h.samples, h.sampleRate));
    const origin = h.grid.origin + pickup * secondsPerBeat(100, sig);
    const map = trackTempo(notes.map((n) => n.start - origin), { bpm: 100, sig });
    const r = quantize(notes, { sig, beatAt: (t) => map.beatAt(t - origin) });
    assert.deepEqual(r.notes.map((n) => n.pieces.map(code).join('')), expect[name], name);
    assert.equal(r.bars.first, pickup ? -1 : 0, `${name} starts ${pickup ? 'with a pickup' : 'on bar 1'}`);
    assert.ok(r.rests.every((x) => x.e >= r.notes[0].e), `${name}: no rests before the first note`);
  }
});

// ---------- Chords on bars ----------

import { barSlots, supports } from '../src/core/harmony.js';
import { MOODS, moodById } from '../src/core/moods.js';

const C = { tonic: 0, mode: 'major' };
const onGrid = (melody, sig = '4/4', from = 0) => {
  const notes = sung(melody, { sig, from });
  return { notes, rhythm: quantize(notes, steadyTempo({ bpm: 100, sig })) };
};

test('bar slots: one per bar, strong beats marked, the half bar found', () => {
  const { rhythm } = onGrid(DEMO_MELODIES['Ode to Joy']);
  const slots = barSlots(rhythm);
  assert.deepEqual(slots.map((s) => [s.bar, s.first, s.count]), [[0, 0, 4], [1, 4, 4], [2, 8, 4], [3, 12, 3]]);
  assert.deepEqual(slots[0].accents, [0]);      // beat 1 (the F on beat 3 is a passing note)
  assert.deepEqual(slots[3].accents, [12, 14]); // E. on beat 1, and the half note held from beat 3
  assert.equal(slots[3].half, 14);
  assert.deepEqual(slots.map((s) => s.phraseEnd), [false, false, false, true]);
});

test('chords change on bars: per bar, twice a bar (Jazzy), every two bars (Dreamy)', () => {
  const { notes, rhythm } = onGrid(DEMO_MELODIES['Ode to Joy']);
  const slots = barSlots(rhythm);
  const at = (mood) => harmonise(notes, { home: C, slots, journey: mood })[0].map((e) => e.at);
  assert.deepEqual(at('bright'), [0, 8, 16, 24]);
  assert.deepEqual(at('jazzy'), [0, 4, 8, 12, 16, 20, 24, 28]);
  assert.deepEqual(at('dreamy'), [0, 16]);
  // The notes that must fit are the ones on strong beats, so bar 1 (E E F G) is C, as usual.
  const [first] = harmonise(notes, { home: C, slots, journey: 'bright' })[0];
  assert.deepEqual(first.strong, [0]);
  assert.equal(first.chord.name, 'C');
});

test('with bars, the rules still hold: no note changes, strong beats fit or the chord is borrowed', () => {
  for (const [name, melody] of Object.entries(DEMO_MELODIES)) {
    const { sig, pickup } = DEMO_TIMING[name];
    const { notes, rhythm } = onGrid(melody, sig, -pickup);
    const before = JSON.stringify(notes);
    const slots = barSlots(rhythm);
    for (const mood of MOODS) {
      for (const v of harmonise(notes, { slots, journey: mood.id })) {
        assert.equal(v.reduce((n, e) => n + e.noteCount, 0), notes.length, `${mood.id} on ${name}`);
        for (const e of v) {
          if (e.borrowed) continue;
          for (const k of e.strong) assert.ok(supports(e.chord, ((notes[k].midi % 12) + 12) % 12, moodById(e.mood)), `${mood.id} on ${name}`);
        }
      }
    }
    assert.equal(JSON.stringify(notes), before);
  }
});

test('the MIDI chord track lands on bar lines, even after a rest or a held note', () => {
  // The F from beat 3 of bar 2 is held into bar 3, whose first new note only comes on beat 3.
  const { notes, rhythm } = onGrid([[60, 4], [64, 1], [67, 1], [65, 4], [64, 2], [60, 4]]);
  const slots = barSlots(rhythm);
  const prog = harmonise(notes, { home: C, slots, journey: 'bright' })[0];
  const { tracks } = readMidi(toMidiFile(notes, prog, { rhythm, tempo: { bpm: 100, sig: '4/4' } }));
  const starts = [...new Set(tracks[2].filter((e) => e.type === 'on').map((e) => e.tick))];
  assert.ok(starts.every((t) => t % 1920 === 0), `chords at ${starts}`);
  // A pickup's chord starts with the pickup note, not before the music.
  const g = onGrid(DEMO_MELODIES['Greensleeves (minor)'], '3/4', -1);
  const gp = harmonise(g.notes, { slots: barSlots(g.rhythm), journey: 'dark' })[0];
  const gs = readMidi(toMidiFile(g.notes, gp, { rhythm: g.rhythm, tempo: { bpm: 100, sig: '3/4' } })).tracks[2].filter((e) => e.type === 'on');
  assert.equal(Math.min(...gs.map((e) => e.tick)), 2 * 480);
});
