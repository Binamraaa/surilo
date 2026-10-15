// Run: node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { yin, analyseBuffer, trackPitch, midiToHz } from '../src/core/pitch.js';
import { framesToNotes, midiToName, centsOff } from '../src/core/notes.js';
import { guessKey, suggestChords, fingerMelody, staffSpelling, chordsWithNote, voiceChord } from '../src/core/theory.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';

const sine = (hz, sr = 44100, dur = 0.05) => {
  const a = new Float32Array(Math.floor(sr * dur));
  for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * hz * i) / sr);
  return a;
};

test('YIN finds pure tones across the humming range within 5 cents', () => {
  for (const hz of [82.41, 110, 146.83, 220, 329.63, 523.25, 880]) {
    const r = yin(sine(hz, 22050, 0.06), 22050);
    assert.ok(r, `no pitch for ${hz}`);
    const cents = 1200 * Math.log2(r.hz / hz);
    assert.ok(Math.abs(cents) < 5, `${hz} Hz off by ${cents.toFixed(1)} cents`);
  }
});

/** A hum whose middle note has a weak fundamental and weak odd harmonics, like "mmm" on a phone mic. */
function weakHum(sr = 48000) {
  const plan = [[50, 1, 0.5], [55, 1, 0.5], [57, 0.2, 0.6], [55, 1, 0.5], [50, 1, 0.6]];
  const x = new Float32Array(Math.round(sr * plan.reduce((s, p) => s + p[2], 0)));
  let i = 0, ph = 0;
  for (const [m, h1, dur] of plan) {
    const f0 = midiToHz(m);
    for (let k = 0; k < sr * dur; k++, i++) {
      const t = k / sr;
      ph += (2 * Math.PI * f0 * (1 + 0.003 * Math.sin(2 * Math.PI * 5.5 * t))) / sr;
      const env = Math.min(1, t / 0.03, (dur - t) / 0.03);
      const odd = h1 < 1 ? 0.05 : 0.3;
      x[i] = 0.3 * env * (h1 * Math.sin(ph) + Math.sin(2 * ph + 0.5) + odd * Math.sin(3 * ph + 1) + 0.3 * Math.sin(4 * ph));
    }
  }
  return { samples: x, sampleRate: sr };
}

test('a note with a weak fundamental is not read an octave up', () => {
  const { samples, sampleRate } = weakHum();
  const plain = framesToNotes(analyseBuffer(samples, sampleRate, { track: false })).notes.map((n) => n.midi);
  assert.deepEqual(plain, [50, 55, 69, 55, 50], 'plain YIN should show the problem');
  const tracked = framesToNotes(analyseBuffer(samples, sampleRate)).notes.map((n) => n.midi);
  assert.deepEqual(tracked, [50, 55, 57, 55, 50]);
});

test('pitch tracking: ignores a brief octave flip, follows a real leap, drops a fading shadow', () => {
  const frame = (main, alt, pMain) => [{ midi: main, p: pMain }, { midi: alt, p: 1 - pMain }];
  const flip = [
    ...Array.from({ length: 20 }, () => frame(50, 62, 0.8)),
    ...Array.from({ length: 6 }, () => frame(62, 50, 0.7)), // a 70 ms flip up
    ...Array.from({ length: 20 }, () => frame(50, 62, 0.8)),
  ];
  const pick = trackPitch(flip);
  assert.ok(pick.every((j, i) => flip[i][j].midi === 50), 'stays on D3');

  const leap = [...Array.from({ length: 20 }, () => frame(50, 38, 0.8)), ...Array.from({ length: 40 }, () => frame(62, 50, 0.8))];
  const leapPick = trackPitch(leap).map((j, i) => leap[i][j].midi);
  assert.deepEqual([leapPick[10], leapPick[59]], [50, 62], 'takes an octave leap that lasts');

  const fade = [...Array.from({ length: 20 }, () => frame(56, 44, 0.8)), [{ midi: 44, p: 0.9 }], [{ midi: 44, p: 0.9 }]];
  assert.deepEqual(trackPitch(fade).slice(-3), [0, -1, -1], 'the octave-down tail is dropped, not followed');
});

test('note naming', () => {
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(70, { flats: true }), 'Bb4');
  assert.equal(midiToName(40), 'E2');
  assert.equal(centsOff(64.3), 30);
});

for (const [name, melody] of Object.entries(DEMO_MELODIES)) {
  test(`synthetic hum "${name}" is transcribed note-for-note`, () => {
    const { samples, sampleRate, truth } = synthHum(melody);
    const frames = analyseBuffer(samples, sampleRate);
    const { notes, tuning } = framesToNotes(frames);
    const got = notes.map((n) => n.midi);
    const want = truth.map((n) => n.midi);
    assert.deepEqual(got, want, `got ${got.map((m) => midiToName(m))}\nwant ${want.map((m) => midiToName(m))}`);
    assert.ok(tuning < -0.1 && tuning > -0.4, `tuning offset ${tuning}`);
  });
}

test('hum transcription survives a different singer (sharper, faster, more vibrato)', () => {
  const { samples, sampleRate, truth } = synthHum(DEMO_MELODIES['Twinkle Twinkle'], {
    bpm: 130, detuneCents: 35, vibratoCents: 45, transpose: 0, seed: 99, noise: 0.03,
  });
  const { notes } = framesToNotes(analyseBuffer(samples, sampleRate));
  assert.deepEqual(notes.map((n) => n.midi), truth.map((n) => n.midi));
});

test('key guesses', () => {
  const mk = (ms) => ms.map((m, i) => ({ midi: m, start: i * 0.4, end: i * 0.4 + 0.35 }));
  assert.equal(guessKey(mk(DEMO_MELODIES['Ode to Joy'].map(([m]) => m)))[0].name, 'C major');
  assert.equal(guessKey(mk(DEMO_MELODIES['Twinkle Twinkle'].map(([m]) => m)))[0].name, 'C major');
  assert.equal(guessKey(mk(DEMO_MELODIES['Greensleeves (minor)'].map(([m]) => m)))[0].name, 'A minor');
});

test('chord suggestions stay in key and end on the home chord', () => {
  const notes = DEMO_MELODIES['Twinkle Twinkle'].map(([m], i) => ({ midi: m, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const key = guessKey(notes)[0];
  const { progression, palette } = suggestChords(notes, key);
  assert.ok(progression.length >= 3);
  assert.equal(progression[progression.length - 1].chord.name, 'C');
  assert.ok(palette.map((c) => c.name).includes('C'));
  assert.ok(progression.every((p) => ['C', 'Dm', 'Em', 'F', 'G', 'Am'].includes(p.chord.name)));
});

test('chords for a single note contain that note', () => {
  const cMajor = { tonic: 0, mode: 'major' };
  const names = (midi, key) => chordsWithNote(midi, key).map((c) => c.name);
  assert.deepEqual(names(60, cMajor), ['C', 'F', 'Am']);
  assert.deepEqual(names(71, cMajor), ['G', 'Em']); // B: the diminished chord is left out
  const e = chordsWithNote(64.3, cMajor);
  assert.deepEqual(e.map((c) => [c.name, c.role]), [['C', '3rd'], ['Am', '5th'], ['Em', 'root']]);
  // Outside the key, or with no key yet: any major or minor chord with the note in it.
  const sharp = chordsWithNote(61, cMajor);
  assert.ok(sharp.every((c) => !c.inKey && c.tones.includes(1)));
  assert.equal(sharp.length, 6);
  for (let pc = 0; pc < 12; pc++) assert.ok(chordsWithNote(48 + pc, null).every((c) => c.tones.includes(pc)));
});

test('chords are voiced where small speakers can play them', () => {
  for (const c of chordsWithNote(60, null)) {
    const [bass, ...upper] = voiceChord(c);
    assert.equal(bass % 12, c.root);
    assert.ok(upper[0] >= 52 && upper[0] <= 63, `${c.name} root ${upper[0]}`);
    assert.deepEqual(upper.map((m) => m % 12).sort(), [...c.tones].sort());
  }
});

test('guitar fingering is playable and in range', () => {
  const notes = [40, 45, 52, 55, 57, 59, 60, 64, 67, 30, 90].map((m) => ({ midi: m }));
  const path = fingerMelody(notes);
  path.forEach((p, i) => {
    assert.ok(p.fret >= 0 && p.fret <= 15);
    assert.equal([40, 45, 50, 55, 59, 64][p.string] + p.fret, p.midi);
  });
  assert.equal(path[0].fret, 0); // low E open
  assert.ok(path[9].moved && path[10].moved); // out of range notes moved by octaves
});

test('staff spelling', () => {
  assert.deepEqual(staffSpelling(60, false), { step: 28, accidental: '' });
  assert.deepEqual(staffSpelling(61, false), { step: 28, accidental: '♯' });
  assert.deepEqual(staffSpelling(61, true), { step: 29, accidental: '♭' });
  assert.equal(midiToHz(69), 440);
});

test('quiet laptop-style mic input (−40 to −60 dB) still finds every note', () => {
  for (const gain of [0.02, 0.005, 0.001]) {
    const { samples, sampleRate, truth } = synthHum(DEMO_MELODIES['Twinkle Twinkle'], { sampleRate: 48000, noise: 0.01 });
    const quiet = samples.map((x) => x * gain);
    const { notes } = framesToNotes(analyseBuffer(quiet, sampleRate));
    assert.deepEqual(notes.map((n) => n.midi), truth.map((n) => n.midi), `gain ${gain}`);
  }
});

test('background noise alone produces no notes', () => {
  let r = 1;
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const noise = new Float32Array(48000 * 4).map(() => 0.003 * rnd());
  assert.equal(framesToNotes(analyseBuffer(noise, 48000)).notes.length, 0);
});
