// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Harmonising a melody in a mood: pick one chord per slot so that every chord
// supports the notes sung over it and the progression moves the way the mood
// likes. The notes are never changed. A mood only changes the chords.

import { chordsWithNote, guessKey, keyName, phraseSlots } from './theory.js';
import { spell, DEGREE_OF } from './modes.js';
import { moodById, recipeFor } from './moods.js';

/**
 * Which melody notes sit well over each chord type, in semitones above the root.
 * tones: in the chord. tensions: extra colour notes that still sound settled.
 * colour: richer tensions, only in colourful moods. avoid: clashes, worst when held.
 */
export const CHORD_TYPES = {
  maj: { suffix: '', tones: [0, 4, 7], tensions: [2, 9], colour: [11], avoid: [1, 5] },
  min: { suffix: 'm', tones: [0, 3, 7], tensions: [2, 5, 10], colour: [9], avoid: [1, 4] },
  dim: { suffix: 'dim', tones: [0, 3, 6], tensions: [], colour: [], avoid: [] },
  sus2: { suffix: 'sus2', tones: [0, 2, 7], tensions: [5, 9], colour: [10, 11], avoid: [3, 4] },
  sus4: { suffix: 'sus4', tones: [0, 5, 7], tensions: [2, 10], colour: [9], avoid: [3, 4] },
  7: { suffix: '7', tones: [0, 4, 7, 10], tensions: [2, 9], colour: [], avoid: [5, 11] },
  maj7: { suffix: 'maj7', tones: [0, 4, 7, 11], tensions: [2, 9], colour: [6], avoid: [5] },
  m7: { suffix: 'm7', tones: [0, 3, 7, 10], tensions: [2, 5], colour: [9], avoid: [1, 4] },
  add9: { suffix: 'add9', tones: [0, 2, 4, 7], tensions: [9], colour: [6, 11], avoid: [5] },
  6: { suffix: '6', tones: [0, 4, 7, 9], tensions: [2], colour: [], avoid: [5] },
};

const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;
const dur = (n) => Math.max(0.05, n.end - n.start);

/**
 * What a melody note is over a chord: 'tone', 'tension', 'colour' (a tension only
 * this mood allows), 'avoid' or 'other' (a passing note at best).
 */
export function noteRole(chord, pc, mood = null) {
  if (chord.bass != null && pc === chord.bass) return 'tone';
  const iv = (pc - chord.root + 12) % 12;
  const t = CHORD_TYPES[chord.type];
  if (t.tones.includes(iv)) return 'tone';
  if (t.tensions.includes(iv)) return 'tension';
  if ((mood?.colour && t.colour.includes(iv)) || mood?.extra?.[chord.type]?.includes(iv)) return 'colour';
  return t.avoid.includes(iv) ? 'avoid' : 'other';
}

/** Can this note sit on a strong beat or be held over this chord? */
export const supports = (chord, pc, mood) => ['tone', 'tension', 'colour'].includes(noteRole(chord, pc, mood));

// ---------- Chords from Roman numerals ----------

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NUMS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ACC = { '♭': -1, '♯': 1, '': 0 };
const ROMAN = 'VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i';
const RN = new RegExp(`^([♭♯]?)(${ROMAN})(maj7|7|add9|sus2|sus4|6|°)?(?:/([♭♯]?)([1-7]|${ROMAN}))?$`);
const ROMAN_OF = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const EXT_OF = { maj: '', min: '', dim: '°', 7: '7', m7: '7', maj7: 'maj7', add9: 'add9', sus2: 'sus2', sus4: 'sus4', 6: '6' };

const degree = (acc, num) => {
  const d = NUMS.indexOf(num.toUpperCase());
  return { d, iv: (MAJOR[d] + ACC[acc] + 12) % 12 };
};

/**
 * Read a numeral like 'V7', '♭VII/1' or 'V7/ii' into semitones and a letter step
 * above the home note. `base` is the numeral without its suffix, used to match moves.
 */
export function parseNumeral(spec) {
  const m = RN.exec(spec);
  if (!m) throw new Error(`Unknown chord numeral: ${spec}`);
  const [, acc, num, ext = '', sAcc, target] = m;
  const minor = num === num.toLowerCase();
  let { d, iv } = degree(acc, num);
  const type = ext === '°' ? 'dim' : ext === '7' ? (minor ? 'm7' : '7') : ext || (minor ? 'min' : 'maj');
  let bass = null;
  if (target && /\d/.test(target)) {
    const bd = Number(target) - 1;
    bass = { d: bd, iv: (MAJOR[bd] + ACC[sAcc] + 12) % 12 };
  } else if (target) {
    // A secondary dominant: V7/ii is the V7 of ii.
    const t = degree(sAcc, target);
    d = (t.d + d) % 7;
    iv = (t.iv + iv) % 12;
  }
  return { iv, d, type, bass, numeral: spec, base: acc + num + (target && !bass ? `/${sAcc}${target}` : '') };
}

// Spell the home note the way the key does, then everything else by scale degree.
const homeMode = (home) => ({ id: home.mode === 'minor' ? 'aeolian' : 'ionian' });

/** A playable chord from a numeral, in the given home key. */
export function chordFor(home, spec) {
  const p = typeof spec === 'string' ? parseNumeral(spec) : spec;
  const mode = homeMode(home);
  const t = CHORD_TYPES[p.type];
  const root = (home.tonic + p.iv) % 12;
  const bass = p.bass ? (home.tonic + p.bass.iv) % 12 : null;
  const tones = t.tones.map((i) => (root + i) % 12);
  if (bass != null && !tones.includes(bass)) tones.push(bass);
  const name = spell(home.tonic, mode, p.iv, p.d) + t.suffix + (p.bass ? `/${spell(home.tonic, mode, p.bass.iv, p.bass.d)}` : '');
  return { root, bass, tones, type: p.type, quality: t.suffix, name, numeral: p.numeral, base: p.base };
}

/** The same, from a root pitch class and a chord type (for chords outside a mood). */
function chordFromRoot(home, root, type) {
  const iv = (root - home.tonic + 12) % 12;
  const minor = type === 'min' || type === 'm7' || type === 'dim';
  const num = minor ? ROMAN_OF[iv].toLowerCase() : ROMAN_OF[iv];
  return chordFor(home, num + EXT_OF[type]);
}

const paletteCache = new Map();
/** A mood's chords in this key, in order of preference. */
export function paletteFor(mood, home) {
  const k = `${mood.id}:${home.tonic}:${home.mode}`;
  if (!paletteCache.has(k)) paletteCache.set(k, recipeFor(mood, home).palette.map((s) => chordFor(home, s)));
  return paletteCache.get(k);
}

/** A melody note's name, spelled by its degree in the home key. */
function noteName(home, pc) {
  const iv = (pc - home.tonic + 12) % 12;
  return spell(home.tonic, homeMode(home), iv, DEGREE_OF[iv]);
}

// ---------- Slots and spans ----------

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Turn slots into spans (one chord each), following each mood's chord-change rate:
 * Dreamy joins two slots of the same mood into one chord, Jazzy splits a slot in two.
 * Marks the notes that must fit the chord: the first of each slot (or half slot),
 * the longest, any long note and the melody's last note.
 */
function buildSpans(notes, slots, moods) {
  const spans = [];
  // Bar slots know which notes fall on strong beats (`accents`), and where they start (`e0`, in eighths).
  const onBeats = (slot, idx) => (slot.accents ? slot.accents.filter((k) => idx.includes(k)) : null);
  slots.forEach((slot, i) => {
    const mood = moods[i];
    const idx = Array.from({ length: slot.count }, (_, k) => slot.first + k);
    const prev = spans[spans.length - 1];
    // Split a slot in two: at the half bar when there's a beat, else halfway through its notes.
    const h = slot.half != null ? slot.half - slot.first : Math.ceil(idx.length / 2);
    if (mood.rate === 2 && prev && prev.mood === mood && prev.slots.length === 1 && prev.rate2 && !prev.phraseEnd) {
      prev.slots.push(i);
      prev.indices.push(...idx);
      prev.heads.push(slot.first);
      if (prev.accents) prev.accents.push(...onBeats(slot, idx));
      prev.phraseEnd = slot.phraseEnd;
      prev.rate2 = false;
    } else if (mood.rate === 0.5 && h > 0 && h < idx.length) {
      const [a, b] = [idx.slice(0, h), idx.slice(h)];
      spans.push({ slots: [i], indices: a, heads: [a[0]], phraseEnd: false, mood, e0: slot.e0, accents: onBeats(slot, a) });
      spans.push({ slots: [i], indices: b, heads: [b[0]], phraseEnd: slot.phraseEnd, mood, e0: slot.eHalf, accents: onBeats(slot, b) });
    } else {
      spans.push({ slots: [i], indices: idx, heads: [slot.first], phraseEnd: slot.phraseEnd, mood, rate2: mood.rate === 2, e0: slot.e0, accents: onBeats(slot, idx) });
    }
  });
  const long = 1.75 * median(notes.map(dur));
  const last = notes.length - 1;
  for (const sp of spans) {
    sp.main = sp.indices.reduce((a, b) => (dur(notes[b]) > dur(notes[a]) ? b : a));
    const held = sp.indices.filter((k) => dur(notes[k]) >= long || k === last);
    // With a beat, the notes on strong beats must fit (or, in a bar that starts on a rest or a
    // held note, its first and longest); without one, each slot's first note and its longest.
    const lead = sp.accents ? (sp.accents.length ? sp.accents : [sp.heads[0], sp.main]) : [...sp.heads, sp.main];
    sp.strong = [...new Set([...lead, ...held])].sort((a, b) => a - b);
  }
  return spans;
}

/**
 * Slots from bars, for a hum with a beat: one per bar that has a note starting in it (a
 * bar where a note is only held, or that's silent, keeps the chord before). The note on
 * beat 1 is strong, and so is one held from the middle of the bar (beat 3 in 4/4, beat 4
 * in 6/8) for half a bar or more; a short note there is often just passing. `half` marks
 * the first note in the second half of the bar, for moods that change chord twice a bar.
 * @param {ReturnType<import('./rhythm.js').quantize>} rhythm
 * @returns {Array<{first, count, phraseEnd, bar, e0, eHalf, half, accents:number[]}>}
 */
export function barSlots(rhythm) {
  const { notes: t, barLen, sig, per } = rhythm;
  const halfAt = sig === '3/4' ? null : barLen / 2;
  const slots = [];
  t.forEach((n, i) => {
    const bar = Math.floor(n.e / barLen);
    const pos = n.e - bar * barLen;
    let s = slots[slots.length - 1];
    if (!s || bar > s.bar) {
      s = { first: i, count: 0, bar, e0: bar * barLen, eHalf: halfAt == null ? null : bar * barLen + halfAt, half: null, accents: [], phraseEnd: false };
      slots.push(s);
    }
    s.count++;
    if (pos === 0 || (pos === halfAt && n.len >= halfAt)) s.accents.push(i);
    if (halfAt != null && s.half == null && pos >= halfAt) s.half = i;
  });
  // A phrase ends before a rest of a beat or more, and at the end.
  slots.forEach((s, k) => {
    const next = slots[k + 1];
    const end = t[s.first + s.count - 1];
    s.phraseEnd = !next || t[next.first].e - (end.e + end.len) >= per;
  });
  return slots;
}

// ---------- Scoring ----------

function roleScore(role, strong, mood) {
  switch (role) {
    case 'tone': return 1;
    case 'tension': return mood.colour ? 0.6 : 0.35;
    case 'colour': return 0.6;
    case 'avoid': return strong ? -1 : -0.3;
    default: return strong ? -0.6 : 0.1; // a passing note is fine when it's short and weak
  }
}

/** How well a chord fits the notes of a span, from −1 to 1. Strong and long notes count most. */
function fitScore(notes, sp, chord) {
  let sum = 0, total = 0;
  for (const k of sp.indices) {
    const strong = sp.strong.includes(k);
    const w = dur(notes[k]) * (strong ? 2 : 1);
    sum += w * roleScore(noteRole(chord, pcOf(notes[k].midi), sp.mood), strong, sp.mood);
    total += w;
  }
  return sum / total;
}

const matches = (option, base) => option.split('|').includes(base);

/** Bonuses for ending the way the mood likes, at the end and (less) at phrase ends. */
function endingScore(chord, sp, fromEnd, home) {
  const r = recipeFor(sp.mood, home);
  const cad = r.cadence || [];
  let b = 0;
  if (fromEnd < cad.length) {
    if (matches(cad[cad.length - 1 - fromEnd], chord.base)) b += fromEnd === 0 ? 0.6 : 0.3;
  } else if (sp.phraseEnd && cad.length && matches(cad[cad.length - 1], chord.base)) {
    b += 0.25;
  }
  if (fromEnd === 0 && (r.avoidEnd || []).some((e) => e.length === 1 && e[0] === chord.base)) b -= 1.5;
  return b;
}

/** Every chord a span could take, each with its own score (fit, preference, ending). */
function candidates(notes, sp, fromEnd, home) {
  const palette = paletteFor(sp.mood, home);
  const pcs = sp.strong.map((k) => pcOf(notes[k].midi));
  const out = [];
  palette.forEach((chord, i) => {
    if (pcs.every((pc) => supports(chord, pc, sp.mood))) out.push({ chord, borrowed: false, pref: 0.25 * (1 - i / palette.length) });
  });
  // Borrowed: chords from outside the mood that contain the main note, in case nothing
  // in the mood fits (the key's own chords first). One that still rubs against another
  // strong note is a last resort, marked `clash`.
  const names = new Set(palette.map((c) => c.name));
  const pool = [...chordsWithNote(notes[sp.main].midi, home), ...chordsWithNote(notes[sp.main].midi, null)];
  for (const c of pool) {
    const chord = chordFromRoot(home, c.root, c.quality === 'm' ? 'min' : 'maj');
    if (names.has(chord.name)) continue;
    names.add(chord.name);
    const clash = !pcs.every((pc) => supports(chord, pc, sp.mood));
    out.push({ chord, borrowed: true, clash, from: c.inKey ? keyName(home) : null, pref: (clash ? -0.9 : -0.4) + 0.1 * c.weight });
  }
  // Nothing at all? Then the mood's own chords, clashes and all: never fail.
  if (!out.some((c) => !c.clash)) {
    for (const chord of palette) if (!out.some((c) => c.chord.name === chord.name)) out.push({ chord, borrowed: true, clash: true, pref: -0.9 });
  }
  for (const c of out) c.score = fitScore(notes, sp, c.chord) + c.pref + endingScore(c.chord, sp, fromEnd, home);
  return out;
}

const fitsSpan = (notes, sp, chord) => sp.strong.every((k) => supports(chord, pcOf(notes[k].midi), sp.mood));
const inPalette = (mood, home, chord) => paletteFor(mood, home).some((c) => c.name === chord.name);

/**
 * Where the mood changes, make the change sound intentional. Favour a pivot: a
 * chord on either side of the change that belongs to both moods. If the melody
 * allows none, offer a turnaround on the old side: the V7 of a chord the new mood
 * can start on (the bonus for actually resolving to it is in moveScore).
 */
function joinMoods(notes, spans, cands, home) {
  for (let s = 1; s < spans.length; s++) {
    const before = spans[s - 1], after = spans[s];
    if (before.mood === after.mood) continue;
    after.change = true;
    let pivots = 0;
    for (const [side, other] of [[s - 1, after.mood], [s, before.mood]]) {
      for (const c of cands[side]) {
        if (c.borrowed || !inPalette(other, home, c.chord)) continue;
        c.pivot = true;
        c.score += 0.35;
        pivots++;
      }
    }
    if (pivots) continue;
    after.turnaround = true;
    for (const target of cands[s].filter((c) => !c.borrowed)) {
      const chord = chordFromRoot(home, (target.chord.root + 7) % 12, '7');
      const have = cands[s - 1].find((c) => c.chord.name === chord.name);
      if (have) { have.turnaround = true; continue; }
      if (!fitsSpan(notes, before, chord)) continue;
      cands[s - 1].push({ chord, borrowed: false, turnaround: true, score: fitScore(notes, before, chord) });
    }
  }
}

/** The Picardy lift: let a journey end on the major home chord, when the last notes allow it. */
function addLift(notes, sp, list, home) {
  const chord = chordFor(home, 'I');
  if (!fitsSpan(notes, sp, chord)) return;
  const i = list.findIndex((c) => c.chord.name === chord.name);
  if (i >= 0) list.splice(i, 1);
  list.push({ chord, borrowed: false, lift: true, score: fitScore(notes, sp, chord) + 1.5 });
}

/** The score for moving from chord a to chord b (they're different chords). */
function moveScore(a, b, sp, final, home) {
  const r = recipeFor(sp.mood, home);
  let s = r.moves?.[`${a.base}>${b.base}`] ?? 0;
  // A turnaround into a new mood (only where no pivot fits): a dominant 7th resolving down a fifth.
  if (sp.turnaround && a.type === '7' && (a.root - b.root + 12) % 12 === 7) s += 0.9;
  s += 0.04 * Math.min(3, a.tones.filter((t) => b.tones.includes(t)).length); // smooth voice leading
  if (sp.mood.thirds && [3, 4, 8, 9].includes((b.root - a.root + 12) % 12)) s += sp.mood.thirds;
  if (sp.mood.heldBass && b.bass != null && b.bass === (a.bass ?? a.root)) s += sp.mood.heldBass;
  if (final && (r.avoidEnd || []).some((e) => e.length === 2 && e[0] === a.base && e[1] === b.base)) s -= 5;
  return s;
}

// ---------- Search ----------

/**
 * k-best Viterbi over the spans. A state is (candidate, how many times in a row
 * that chord has sounded, up to 3), so holding a chord more than twice can cost
 * extra. Returns the best paths, best first. Deterministic: no randomness.
 */
function bestPaths(cands, spans, home, { perState = 6, keep = 80 } = {}) {
  let layer = new Map();
  cands[0].forEach((c, i) => layer.set(`${i}:1`, { c: i, run: 1, list: [{ score: c.score, back: null }] }));
  for (let s = 1; s < cands.length; s++) {
    const next = new Map();
    const final = s === cands.length - 1;
    for (const st of layer.values()) {
      const a = cands[s - 1][st.c];
      cands[s].forEach((b, i) => {
        const same = a.chord.name === b.chord.name;
        const run = same ? Math.min(3, st.run + 1) : 1;
        const t = same ? (run >= 3 ? -0.3 : -0.05) : moveScore(a.chord, b.chord, spans[s], final, home);
        const key = `${i}:${run}`;
        let dst = next.get(key);
        if (!dst) next.set(key, (dst = { c: i, run, list: [] }));
        st.list.forEach((e, rank) => dst.list.push({ score: e.score + t + b.score, back: { st, rank } }));
      });
    }
    for (const st of next.values()) {
      st.list.sort((x, y) => y.score - x.score);
      st.list.length = Math.min(st.list.length, perState);
    }
    layer = next;
  }
  const ends = [];
  for (const st of layer.values()) st.list.forEach((e, rank) => ends.push({ score: e.score, st, rank }));
  ends.sort((x, y) => y.score - x.score);
  return ends.slice(0, keep).map(({ score, st, rank }) => {
    const path = [];
    for (let cur = { st, rank }; cur; cur = cur.st.list[cur.rank].back) path.unshift(cur.st.c);
    return { score, path };
  });
}

// ---------- Explanations ----------

const TONE_NAMES = { 0: 'root', 3: '3rd', 4: '3rd', 6: '5th', 7: '5th', 10: '7th', 11: '7th' };
const ADDED = { add9: { 2: '9th' }, sus2: { 2: '2nd' }, sus4: { 5: '4th' }, 6: { 9: '6th' } };
const TENSION_NAMES = { 1: '♭9th', 2: '9th', 3: '♯9th', 5: '11th', 6: '♯11th', 9: '6th', 10: '7th', 11: 'major 7th' };
const COLOUR_WORDS = {
  1: 'a tense colour', 2: 'a softer colour', 3: 'a blue note', 5: 'an open sound', 6: 'a floating colour',
  9: 'a warm colour', 10: 'a bluesy edge', 11: 'a dreamy colour',
};

/** Why this chord fits here, in plain words: "Your E is the 3rd of C". */
function explain(notes, sp, cand, home) {
  const { chord } = cand;
  const pc = pcOf(notes[sp.main].midi);
  const note = noteName(home, pc);
  const iv = (pc - chord.root + 12) % 12;
  const role = noteRole(chord, pc, sp.mood);
  let what;
  if (chord.bass != null && pc === chord.bass && !CHORD_TYPES[chord.type].tones.includes(iv)) {
    what = `Your ${note} is the bass note of ${chord.name}, held under the chord.`;
  } else if (role === 'tone') {
    const added = ADDED[chord.type]?.[iv];
    what = added ? `Your ${note} is the ${added} of ${chord.name}: ${COLOUR_WORDS[iv]}.` : `Your ${note} is the ${TONE_NAMES[iv]} of ${chord.name}.`;
  } else if (role === 'tension' || role === 'colour') {
    what = `Your ${note} is the ${TENSION_NAMES[iv]} of ${chord.name}: ${COLOUR_WORDS[iv]}.`;
  } else {
    what = `${chord.name} fits the notes around your ${note}.`;
  }
  if (cand.clash) {
    const rub = sp.strong.map((k) => pcOf(notes[k].midi)).find((p) => !supports(chord, p, sp.mood));
    what += ` It rubs a little against your ${noteName(home, rub)}, but nothing fits better here.`;
  } else if (cand.borrowed) {
    what += ` Borrowed ${cand.from ? `from ${cand.from}` : 'from outside the key'}: no ${sp.mood.name} chord fits here.`;
  }
  return what;
}

// ---------- Main ----------

/**
 * Harmonise a melody in a mood, or in a journey of moods (one per slot).
 * Never changes the notes.
 * @param {Array<{midi,start,end}>} notes
 * @param {object} [o]
 * @param {{tonic:number, mode:'major'|'minor'}} [o.home]  the home key (default: the guessed key)
 * @param {Array<{first,count,phraseEnd}>} [o.slots]  where chords may change (default: phraseSlots; barSlots with a beat)
 * @param {string|string[]} [o.journey]  one mood id, or one per slot (see journeyFor in moods.js)
 * @param {number} [o.variations]  how many different progressions to return
 * @param {boolean} [o.lift]  end on the major home chord if the melody allows (a journey's Picardy lift)
 * @returns {Array<Array<{slotIndex, slots, at, start, end, firstIndex, noteCount, chord, roman, borrowed, clash,
 *   pivot, turnaround, lift, why, mood, strong}>>}  at: where the chord starts in eighths, with bar slots
 *   the variations, best first; each is the list of chords in time order
 */
export function harmonise(notes, { home = null, slots = null, journey = 'bright', variations = 3, lift = false } = {}) {
  if (!notes.length) return [];
  home = home || guessKey(notes)[0];
  slots = slots || phraseSlots(notes);
  const ids = Array.isArray(journey) ? journey : [journey];
  const moods = slots.map((_, i) => moodById(ids[Math.min(i, ids.length - 1)]) || moodById('bright'));
  const spans = buildSpans(notes, slots, moods);
  // Ending bonuses count only inside the last mood's stretch: a Jazzy ii–V–I means
  // nothing if the tune turns Dark before the end.
  const lastMood = spans[spans.length - 1].mood;
  let tail = spans.length;
  while (tail > 0 && spans[tail - 1].mood === lastMood) tail--;
  const cands = spans.map((sp, s) => candidates(notes, sp, s >= tail ? spans.length - 1 - s : Infinity, home));
  joinMoods(notes, spans, cands, home);
  if (lift) addLift(notes, spans[spans.length - 1], cands[cands.length - 1], home);
  const paths = bestPaths(cands, spans, home);

  // Keep variations that really differ: at least two chords (one, for very short tunes).
  const minDiff = spans.length >= 3 ? 2 : 1;
  const names = (p) => p.path.map((c, s) => cands[s][c].chord.name);
  const chosen = [];
  for (const p of paths) {
    if (chosen.length >= variations) break;
    const n = names(p);
    if (chosen.every((q) => n.filter((x, s) => x !== q.names[s]).length >= minDiff)) chosen.push({ ...p, names: n });
  }

  return chosen.map(({ path }) => path.map((c, s) => {
    const sp = spans[s];
    const cand = cands[s][c];
    const next = cands[s + 1]?.[path[s + 1]];
    const first = sp.indices[0], last = sp.indices[sp.indices.length - 1];
    // How this chord joins two moods, if it sits where they meet.
    const join = { pivot: false, turnaround: false };
    let why = explain(notes, sp, cand, home);
    if (cand.pivot) {
      const [a, b] = spans[s + 1]?.change ? [sp.mood, spans[s + 1].mood] : [spans[s - 1].mood, sp.mood];
      join.pivot = true;
      why += ` It belongs to both ${a.name} and ${b.name}, so the change of mood feels smooth.`;
    } else if (cand.turnaround && next && spans[s + 1].change && (cand.chord.root - next.chord.root + 12) % 12 === 7) {
      join.turnaround = true;
      why += ` It leads into ${next.chord.name}, turning the music towards ${spans[s + 1].mood.name}.`;
    }
    if (cand.lift) why += ' Ending on the major home chord lifts the music into the light (a "Picardy third").';
    return {
      slotIndex: sp.slots[0], slots: sp.slots, at: sp.e0 ?? null,
      start: notes[first].start, end: notes[last].end, firstIndex: first, noteCount: sp.indices.length,
      chord: cand.chord, roman: cand.chord.numeral, borrowed: cand.borrowed, clash: !!cand.clash,
      ...join, lift: !!cand.lift, why, mood: sp.mood.id, strong: sp.strong,
    };
  }));
}
