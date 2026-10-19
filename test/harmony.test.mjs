import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonise, parseNumeral, chordFor, noteRole, supports, paletteFor, CHORD_TYPES } from '../src/core/harmony.js';
import { MOODS, moodById, recipeFor, JOURNEYS, journeyById, journeyFor } from '../src/core/moods.js';
import { phraseSlots } from '../src/core/theory.js';
import { DEMO_MELODIES } from '../src/core/demo.js';

const mel = (name) => DEMO_MELODIES[name].map(([m, b], i, a) => {
  const start = a.slice(0, i).reduce((s, [, x]) => s + x * 0.5, 0);
  return { midi: m, start, end: start + b * 0.5 - 0.05 };
});
const DEMOS = Object.keys(DEMO_MELODIES);
const C = { tonic: 0, mode: 'major' };
const Am = { tonic: 9, mode: 'minor' };
const best = (notes, journey) => harmonise(notes, { journey })[0];
const names = (prog) => prog.map((e) => e.chord.name);
const pcOf = (m) => ((m % 12) + 12) % 12;
const deepFreeze = (notes) => Object.freeze(notes.map((n) => Object.freeze({ ...n })));

test('numerals become the right chords', () => {
  const name = (home, s) => chordFor(home, s).name;
  assert.deepEqual(['I', 'ii7', 'V7', 'Imaj7', '♭VI', '♭VII/1', 'IV/1', 'V7/ii', 'V7/V', 'Iadd9', 'Isus2', 'Vsus4', 'I6', 'III'].map((s) => name(C, s)),
    ['C', 'Dm7', 'G7', 'Cmaj7', 'A♭', 'B♭/C', 'F/C', 'A7', 'D7', 'Cadd9', 'Csus2', 'Gsus4', 'C6', 'E']);
  assert.deepEqual(['i', '♭III', 'iv', 'V', '♭VI', '♭VII', '♭II', '♭II/1', 'V7/iv'].map((s) => name(Am, s)),
    ['Am', 'C', 'Dm', 'E', 'F', 'G', 'B♭', 'B♭/A', 'A7']);
  assert.deepEqual(chordFor(C, '♭VII/1').tones.sort((a, b) => a - b), [0, 2, 5, 10]); // B♭ D F over C
  assert.equal(parseNumeral('V7/ii').base, 'V/ii');
  assert.equal(parseNumeral('Imaj7').base, 'I');
  assert.throws(() => parseNumeral('X7'));
});

test('every mood is complete and its numerals all parse', () => {
  assert.equal(MOODS.length, 9);
  for (const mood of MOODS) {
    for (const home of [C, Am]) {
      const r = recipeFor(mood, home);
      assert.ok(r.palette.length >= 4, mood.id);
      assert.equal(paletteFor(mood, home).length, r.palette.length);
      const bases = new Set(r.palette.map((s) => parseNumeral(s).base));
      for (const cad of r.cadence) for (const b of cad.split('|')) parseNumeral(b);
      // Signature moves name chords the mood actually has (negative ones are warnings, and may not).
      for (const [k, v] of Object.entries(r.moves)) if (v > 0) k.split('>').forEach((b) => assert.ok(bases.has(b), `${mood.id} ${k}`));
    }
    assert.ok([0.5, 1, 2].includes(mood.rate));
  }
});

test('the compatibility table: tones, tensions and clashes', () => {
  const c = chordFor(C, 'I');
  assert.equal(noteRole(c, 4), 'tone');
  assert.equal(noteRole(c, 2), 'tension');           // the 9th
  assert.equal(noteRole(c, 5), 'avoid');             // the 4th against the major 3rd
  assert.equal(noteRole(c, 11), 'other');            // the major 7th…
  assert.equal(noteRole(c, 11, moodById('dreamy')), 'colour'); // …only in colourful moods
  const c7 = chordFor(C, 'I7');
  assert.equal(noteRole(c7, 3), 'other');
  assert.equal(noteRole(c7, 3, moodById('bluesy')), 'colour'); // the blue note
  assert.equal(noteRole(chordFor(C, 'Isus2'), 4), 'avoid'); // a 3rd over a sus chord
  assert.equal(noteRole(chordFor(C, '♭VII/1'), 0), 'tone');  // the held bass
  for (const t of Object.values(CHORD_TYPES)) {
    const all = [...t.tones, ...t.tensions, ...t.colour, ...t.avoid];
    assert.equal(new Set(all).size, all.length, 'no interval is listed twice');
  }
});

test('Rule 1: no mood changes the melody', () => {
  for (const name of DEMOS) {
    const notes = deepFreeze(mel(name));
    const before = JSON.stringify(notes);
    for (const mood of MOODS) {
      const vs = harmonise(notes, { journey: mood.id });
      assert.ok(vs.length >= 1);
      assert.equal(JSON.stringify(notes), before, `${mood.id} on ${name}`);
      for (const v of vs) {
        // The chords cover every note exactly once, in order.
        assert.deepEqual(v.flatMap((e) => Array.from({ length: e.noteCount }, (_, k) => e.firstIndex + k)), notes.map((_, i) => i));
      }
    }
  }
});

test('Rule 2: strong and long notes are chord tones or allowed tensions, or the chord is borrowed', () => {
  for (const name of DEMOS) {
    const notes = mel(name);
    for (const mood of MOODS) {
      for (const v of harmonise(notes, { journey: mood.id })) {
        for (const e of v) {
          assert.ok(e.strong.length >= 1);
          if (e.borrowed) continue;
          for (const k of e.strong) {
            assert.ok(supports(e.chord, pcOf(notes[k].midi), mood), `${mood.id} on ${name}: note ${k} over ${e.chord.name}`);
          }
        }
      }
    }
  }
});

test('Rule 3: a mood with no fitting chord borrows one and says so', () => {
  // C D E F G over a C home, in Dark: the E on the first beat fits none of Fm, A♭, B♭, Gm.
  const notes = [64, 65, 64, 62].map((m, i) => ({ midi: m, start: i * 0.5, end: i * 0.5 + 0.45 }));
  const prog = harmonise(notes, { journey: 'dark', home: C, slots: [{ first: 0, count: 4, phraseEnd: true }] })[0];
  assert.equal(prog.length, 1);
  const { chord, borrowed } = prog[0];
  assert.ok(chord.tones.includes(4), 'it has the E');
  if (borrowed) assert.match(prog[0].why, /Borrowed|rubs/);
  // A chromatic note no mood expects still gets a chord with it in.
  const odd = [{ midi: 66, start: 0, end: 2 }];
  for (const mood of MOODS) {
    const [e] = harmonise(odd, { journey: mood.id, home: C })[0];
    assert.ok(supports(e.chord, 6, mood) || e.borrowed, mood.id);
  }
});

test('Rule 4: the same input gives the same chords', () => {
  for (const mood of MOODS) {
    const a = harmonise(mel('Greensleeves (minor)'), { journey: mood.id });
    const b = harmonise(mel('Greensleeves (minor)'), { journey: mood.id });
    assert.deepEqual(a, b);
  }
});

test('the moods really differ on Ode to Joy', () => {
  const notes = mel('Ode to Joy');
  const progs = MOODS.map((m) => names(best(notes, m.id)).join(' '));
  assert.ok(new Set(progs).size >= 6, progs.join('\n'));
  const bright = new Set(names(best(notes, 'bright')));
  const dark = new Set(names(best(notes, 'dark')));
  const shared = [...dark].filter((c) => bright.has(c)).length;
  assert.ok(shared < Math.min(bright.size, dark.size) / 2, `Bright ${[...bright]} / Dark ${[...dark]}`);
});

test('known answers for Ode to Joy\'s first phrase (E E F G)', () => {
  const notes = mel('Ode to Joy');
  const first = (mood) => best(notes, mood)[0];
  assert.equal(first('bright').chord.name, 'C');
  assert.equal(first('bright').why, 'Your E is the 3rd of C.');
  const dark = first('dark').chord;
  assert.ok(['Am', 'Em'].includes(dark.name), dark.name); // E as the root or the 5th
  assert.match(first('floating').chord.type, /sus|add9/);
});

test('endings: Bright ends V→I, Bittersweet never on I, Floating never on a plain V→I', () => {
  const tw = best(mel('Twinkle Twinkle'), 'bright');
  assert.deepEqual(tw.slice(-2).map((e) => e.chord.base), ['V', 'I']);
  for (const name of DEMOS) {
    const notes = mel(name);
    for (const v of harmonise(notes, { journey: 'bittersweet' })) assert.notEqual(v.at(-1).chord.base.toUpperCase(), 'I', name);
    for (const v of harmonise(notes, { journey: 'floating' })) {
      const [a, b] = v.slice(-2).map((e) => e.chord.base.toUpperCase());
      assert.ok(!(a === 'V' && b === 'I'), name);
    }
  }
});

test('"Try another version" gives progressions that differ by at least two chords', () => {
  for (const mood of MOODS) {
    const vs = harmonise(mel('Twinkle Twinkle'), { journey: mood.id, variations: 3 });
    assert.ok(vs.length >= 2, mood.id);
    const need = vs[0].length >= 3 ? 2 : 1; // a two-chord tune can only differ by one
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const diff = vs[i].filter((e, s) => e.chord.name !== vs[j][s].chord.name).length;
        assert.ok(diff >= need, `${mood.id}: versions ${i} and ${j}`);
      }
    }
  }
});

test('chord changes follow the mood: Dreamy every two slots, Jazzy twice per slot', () => {
  const notes = mel('Ode to Joy'); // 4 slots of 4, 4, 4 and 3 notes
  assert.equal(best(notes, 'bright').length, 4);
  assert.equal(best(notes, 'dreamy').length, 2);
  assert.equal(best(notes, 'jazzy').length, 8);
});

test('explanations name the note and its job in the chord', () => {
  for (const mood of MOODS) {
    for (const e of best(mel('Für Elise'), mood.id)) {
      assert.match(e.why, /^(Your [A-G][♯♭]? is the |.+ fits the notes)/, `${mood.id}: ${e.why}`);
      if (e.borrowed && !e.clash) assert.match(e.why, /Borrowed/);
    }
  }
});

// ---------- Journeys ----------

const run = (name, preset, mood = 'bright', at = null) => {
  const notes = mel(name);
  const ids = journeyFor(preset, phraseSlots(notes), { mood, at });
  return { notes, ids, vs: harmonise(notes, { journey: ids, lift: !!preset.lift }) };
};

test('journeyFor: one mood for Steady, a change about halfway for the others', () => {
  const slots = phraseSlots(mel('Ode to Joy')); // 4 slots
  assert.deepEqual(journeyFor(journeyById('steady'), slots, { mood: 'dark' }), ['dark', 'dark', 'dark', 'dark']);
  assert.deepEqual(journeyFor(journeyById('bright-dark'), slots), ['bright', 'bright', 'dark', 'dark']);
  assert.deepEqual(journeyFor(journeyById('bright-dark'), slots, { at: 3 }), ['bright', 'bright', 'bright', 'dark']);
  // It prefers to change at the end of a phrase (after a pause).
  const paused = [0, 1, 2, 3, 4, 5].map((i) => ({ first: i, count: 1, phraseEnd: i === 1 }));
  assert.deepEqual(journeyFor(journeyById('build-up'), paused), ['bright', 'bright', 'epic', 'epic', 'epic', 'epic']);
  assert.deepEqual(journeyFor(journeyById('bright-dark'), [{ first: 0, count: 3, phraseEnd: true }]), ['bright']);
  for (const j of JOURNEYS) for (const id of j.moods || []) assert.ok(moodById(id), `${j.id}: ${id}`);
});

test('Rule 1 on journeys: no journey changes the melody', () => {
  for (const name of DEMOS) {
    const before = JSON.stringify(mel(name));
    for (const j of JOURNEYS) {
      for (const mood of j.moods ? ['bright'] : MOODS.map((m) => m.id)) {
        const { notes, vs } = run(name, j, mood);
        assert.equal(JSON.stringify(notes), before);
        for (const v of vs) assert.equal(v.reduce((n, e) => n + e.noteCount, 0), notes.length, `${j.id} on ${name}`);
      }
    }
  }
});

test('Rule 2 on journeys: every chord still supports its strong notes, or is borrowed', () => {
  for (const name of DEMOS) {
    for (const j of JOURNEYS.filter((x) => x.moods)) {
      const { notes, vs } = run(name, j);
      for (const v of vs) {
        for (const e of v) {
          if (e.borrowed) continue;
          for (const k of e.strong) assert.ok(supports(e.chord, pcOf(notes[k].midi), moodById(e.mood)), `${j.id} on ${name}: ${e.chord.name}`);
        }
      }
    }
  }
});

test('Bright → Dark changes mood at the given slot, through a pivot chord', () => {
  const { ids, vs } = run('Ode to Joy', journeyById('bright-dark'), 'bright', 2);
  const prog = vs[0];
  assert.deepEqual(ids, ['bright', 'bright', 'dark', 'dark']);
  assert.deepEqual(prog.map((e) => e.mood), ['bright', 'bright', 'dark', 'dark']);
  // Am is in both moods and fits either side of the change.
  const [a, b] = [prog[1], prog[2]];
  assert.ok(a.pivot || b.pivot, `${a.chord.name} → ${b.chord.name}`);
  const pivot = a.pivot ? a : b;
  assert.ok(paletteFor(moodById('bright'), C).some((c) => c.name === pivot.chord.name));
  assert.ok(paletteFor(moodById('dark'), C).some((c) => c.name === pivot.chord.name));
  assert.match(pivot.why, /belongs to both Bright and Dark/);
});

test('with no chord in common, a journey turns with a V7 into the new mood', () => {
  // Jazzy and Dark share no chord. G A B D | C B A A in C: E7 (B, D) leads into Am (C).
  const notes = [67, 69, 71, 74, 72, 71, 69, 69].map((m, i) => ({ midi: m, start: i * 0.5, end: i * 0.5 + 0.45 }));
  const [prog] = harmonise(notes, { journey: ['jazzy', 'dark'], home: C });
  const at = prog.findIndex((e) => e.mood === 'dark');
  const [a, b] = [prog[at - 1], prog[at]];
  assert.ok(!a.pivot && !b.pivot);
  assert.ok(a.turnaround, a.chord.name);
  assert.equal(a.chord.type, '7');
  assert.equal((a.chord.root - b.chord.root + 12) % 12, 7, `${a.chord.name} → ${b.chord.name}`);
  assert.match(a.why, /leads into/);
});

test('Dark → Hopeful ends on the major home chord (the Picardy lift)', () => {
  for (const name of ['Ode to Joy', 'Twinkle Twinkle']) {
    const { vs } = run(name, journeyById('dark-hopeful'));
    const end = vs[0].at(-1);
    assert.equal(end.chord.name, 'C', name);
    assert.ok(end.lift && !end.borrowed);
  }
  // Without the lift, the same moods don't end there.
  const notes = mel('Ode to Joy');
  assert.notEqual(harmonise(notes, { journey: ['dark', 'dark', 'hopeful', 'hopeful'] })[0].at(-1).chord.name, 'C');
});

test('journeys are repeatable', () => {
  for (const j of JOURNEYS) assert.deepEqual(run('Für Elise', j).vs, run('Für Elise', j).vs);
});
