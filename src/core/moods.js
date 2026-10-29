// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Moods: the same melody, harmonised in different ways. A mood is a recipe for
// the chords underneath: which chords it uses, which moves between them it
// likes, which colour notes it allows, how it ends and how often the chords
// change. A mood never changes a note of the melody.
//
// Chords are Roman numerals counted from the home note (the key's tonic):
//   upper case = major, lower case = minor, ♭/♯ in front moves the root;
//   a suffix adds a type: 7, maj7, add9, sus2, sus4, 6 (lower case + 7 = m7);
//   V7/ii = a secondary dominant (the V7 of ii);
//   ♭VII/1 = a slash chord over a bass note, given as a scale degree (B♭/C in C).
// A mood gives separate recipes for a major home and a minor home.
//
// Recipe fields:
//   palette: chords in order of preference
//   moves:   bonuses for going from one chord to the next ("V>I"), matched on the
//            numeral without its suffix, so V7>Imaj7 counts as V>I
//   cadence: the chords it likes to end on, last one last ('IV|vi' = either)
//   avoidEnd: endings it must not use (['I'] = not on I, ['V', 'I'] = no V→I)
// Mood fields:
//   rate:    how often the chords change: 1 = once per slot, 2 = every two slots, 0.5 = twice per slot
//   colour:  allows the richer tensions (the major 7th over a major chord…)
//   extra:   more allowed melody notes per chord type, as semitones above the root
//   thirds / heldBass: bonuses for moving to a chord a third away, or keeping the bass note

export const MOODS = [
  {
    id: 'bright', name: 'Bright', theory: 'Major (Ionian)', feel: 'Happy, settled, sing-along.',
    rate: 1, colour: false,
    major: {
      palette: ['I', 'IV', 'V', 'vi', 'ii', 'V7'],
      moves: { 'V>I': 0.5, 'IV>I': 0.35, 'ii>V': 0.3, 'IV>V': 0.2, 'vi>IV': 0.2, 'I>IV': 0.15, 'vi>ii': 0.15, 'I>V': 0.1 },
      cadence: ['V', 'I'],
    },
    minor: {
      palette: ['♭III', '♭VII', '♭VI', 'I', 'IV', 'iv'],
      moves: { '♭VII>I': 0.5, '♭VI>♭VII': 0.4, '♭VII>♭III': 0.3, 'IV>I': 0.3, '♭III>♭VI': 0.2, 'I>IV': 0.2 },
      cadence: ['♭VII', 'I'],
    },
  },
  {
    id: 'bittersweet', name: 'Bittersweet', theory: 'Major, leaning on its minor chords', feel: 'Happy and sad at once. Wistful pop ballads.',
    rate: 1, colour: false,
    major: {
      palette: ['vi', 'IV', 'I', 'V', 'iii', 'ii'],
      moves: { 'vi>IV': 0.45, 'V>vi': 0.4, 'IV>I': 0.35, 'I>V': 0.35, 'iii>vi': 0.25, 'iii>IV': 0.2, 'IV>V': 0.15 },
      cadence: ['IV|vi'],
      avoidEnd: [['I']],
    },
    minor: {
      palette: ['i', '♭VI', '♭III', '♭VII', 'iv', 'v'],
      moves: { 'i>♭VI': 0.45, '♭VI>♭III': 0.35, '♭III>♭VII': 0.35, '♭VII>i': 0.3, 'iv>♭VI': 0.2, 'v>♭VI': 0.2 },
      cadence: ['♭VI|iv'],
      avoidEnd: [['i']],
    },
  },
  {
    id: 'dark', name: 'Dark', theory: 'Minor (Aeolian), borrowing from the parallel minor', feel: 'Sad, serious, emotional.',
    rate: 1, colour: false,
    major: {
      palette: ['vi', 'iv', '♭VI', '♭VII', 'v', 'iii'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>vi': 0.4, 'vi>iv': 0.3, 'iv>♭VII': 0.25, 'iv>vi': 0.25, 'vi>♭VI': 0.2, 'v>vi': 0.2, 'iii>vi': 0.2 },
      cadence: ['♭VII|iv', 'vi'],
    },
    minor: {
      palette: ['i', 'iv', '♭VI', '♭VII', 'v', '♭III'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>i': 0.45, 'iv>i': 0.3, 'i>iv': 0.25, 'i>♭VI': 0.25, 'iv>♭VII': 0.25, 'v>i': 0.2 },
      cadence: ['♭VII', 'i'],
    },
  },
  {
    id: 'hopeful', name: 'Hopeful minor', theory: 'Dorian', feel: 'Minor, but with a lift. Soul, funk, Celtic.',
    rate: 1, colour: false,
    major: {
      // A major tune made Dorian: lean on ii as its minor home chord.
      palette: ['ii', 'V', 'I', 'iii', 'vi', 'IV'],
      moves: { 'ii>V': 0.45, 'V>ii': 0.45, 'I>ii': 0.3, 'ii>I': 0.25, 'iii>ii': 0.2, 'V>I': 0.1 },
      cadence: ['V', 'ii'],
    },
    minor: {
      palette: ['i', 'IV', '♭VII', 'ii', '♭III', 'v'],
      moves: { 'i>IV': 0.45, 'IV>i': 0.45, '♭VII>i': 0.3, 'i>♭VII': 0.25, 'IV>♭VII': 0.2, 'ii>i': 0.2 },
      cadence: ['IV', 'i'],
    },
  },
  {
    id: 'bluesy', name: 'Bluesy', theory: 'Mixolydian / dominant 7ths', feel: 'Loose and gritty. Blues, rock, soul.',
    rate: 1, colour: true, extra: { 7: [3], maj: [3] }, // the ♯9 / ♭3 blue note
    major: {
      palette: ['I7', 'IV7', '♭VII', 'V7', 'I', 'IV'],
      moves: { 'IV>I': 0.45, '♭VII>IV': 0.4, 'I>♭VII': 0.35, 'I>IV': 0.3, 'V>IV': 0.3, 'V>I': 0.2, 'IV>V': 0.15 },
      cadence: ['IV', 'I'],
    },
    minor: {
      palette: ['i7', 'iv7', '♭VII', 'V7', '♭VI', '♭III'],
      moves: { 'iv>i': 0.45, 'i>iv': 0.35, '♭VI>V': 0.35, 'V>i': 0.3, 'i>♭VII': 0.3, '♭VII>iv': 0.25 },
      cadence: ['iv', 'i'],
    },
  },
  {
    id: 'dreamy', name: 'Dreamy', theory: 'Lydian', feel: 'Floating and bright. Film scores.',
    rate: 2, colour: true, extra: { maj: [6] }, // the raised 4th
    major: {
      palette: ['Imaj7', 'II', 'Iadd9', 'vi', 'Isus2', 'V', 'iii'],
      moves: { 'I>II': 0.5, 'II>I': 0.4, 'vi>II': 0.25, 'I>vi': 0.2, 'iii>II': 0.15, 'V>I': 0.1 },
      cadence: ['I|II', 'I'],
    },
    minor: {
      palette: ['♭VImaj7', '♭VII', 'i7', '♭IIIadd9', 'iv', '♭VIadd9'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>♭VI': 0.35, 'i>♭VI': 0.3, '♭VII>i': 0.25, 'iv>♭VI': 0.2 },
      cadence: ['♭VI'],
    },
  },
  {
    id: 'epic', name: 'Epic / tense', theory: 'Phrygian and harmonic minor', feel: 'Dramatic, menacing, cinematic.',
    rate: 1, colour: false,
    major: {
      // A major tune made epic: centre it on vi, with vi's ♭II (♭VII) and its major V (III).
      palette: ['vi', '♭VII', 'III', 'IV', 'ii', '♭VII/6', 'iii'],
      moves: { 'III>vi': 0.5, 'vi>♭VII': 0.45, 'IV>III': 0.45, '♭VII>vi': 0.4, 'ii>III': 0.25, 'vi>IV': 0.25 },
      cadence: ['III', 'vi'],
    },
    minor: {
      palette: ['i', '♭II', 'V', '♭VI', 'iv', '♭II/1', '♭VII'],
      moves: { 'V>i': 0.5, 'i>♭II': 0.45, '♭VI>V': 0.45, '♭II>i': 0.4, 'iv>V': 0.25, 'i>♭VI': 0.25, '♭VII>i': 0.15 },
      cadence: ['V', 'i'],
    },
  },
  {
    id: 'jazzy', name: 'Jazzy', theory: 'Functional harmony with 7ths', feel: 'Smooth and sophisticated. Jazz standards, bossa, neo-soul.',
    rate: 0.5, colour: true, extra: { 7: [1, 3] }, // altered dominants: the ♭9 and ♯9
    major: {
      palette: ['ii7', 'V7', 'Imaj7', 'vi7', 'V7/ii', 'V7/V', 'iii7', 'IVmaj7', 'I6'],
      moves: { 'ii>V': 0.5, 'V>I': 0.5, 'V/ii>ii': 0.45, 'V/V>V': 0.45, 'vi>ii': 0.35, 'iii>vi': 0.3, 'I>vi': 0.2, 'I>V/ii': 0.2, 'IV>iii': 0.15, 'IV>V': 0.1 },
      cadence: ['ii', 'V', 'I'],
    },
    minor: {
      palette: ['i7', 'iv7', 'V7', '♭IIImaj7', '♭VImaj7', '♭VII7', 'V7/iv'],
      moves: { 'V>i': 0.5, '♭VII>♭III': 0.45, 'iv>V': 0.4, 'V/iv>iv': 0.4, '♭III>♭VI': 0.3, 'i>iv': 0.25, 'i>V/iv': 0.2, '♭VI>iv': 0.2 },
      cadence: ['iv', 'V', 'i'],
    },
  },
  {
    id: 'floating', name: 'Floating / prog', theory: 'Ambiguous, Steven Wilson-style', feel: 'Open and unresolved. Prog, post-rock, ambient.',
    rate: 1, colour: true, thirds: 0.3, heldBass: 0.25,
    major: {
      palette: ['Iadd9', 'Isus2', 'IVadd9', '♭VII/1', 'IV/1', '♭VI', 'III', 'Vsus4', 'IVsus2'],
      moves: { 'I>♭VI': 0.25, '♭VI>I': 0.2, 'I>♭VII': 0.2, '♭VII>I': 0.2, 'IV>I': 0.15, 'V>I': -0.4 },
      cadence: ['I|IV|♭VI'],
      avoidEnd: [['V', 'I']],
    },
    minor: {
      palette: ['Isus2', '♭VIadd9', '♭IIIadd9', '♭VII/1', 'iv/1', 'Isus4', '♭VI', 'III', 'IVsus2'],
      moves: { 'I>♭VI': 0.25, '♭VI>I': 0.2, '♭III>♭VII': 0.15, 'V>i': -0.4, 'V>I': -0.4 },
      cadence: ['I|♭VI'],
      avoidEnd: [['V', 'i'], ['V', 'I']],
    },
  },
];

export const moodById = (id) => MOODS.find((m) => m.id === id) || null;

/** The recipe a mood uses for this home key (major or minor). */
export const recipeFor = (mood, home) => (home?.mode === 'minor' ? mood.minor : mood.major);

// ---------- Journeys: moods that change partway through the melody ----------

/**
 * Preset journeys. `moods: null` means one mood all the way through (the one picked).
 * `lift`: end on the major home chord even in a minor mood (a "Picardy third").
 */
export const JOURNEYS = [
  { id: 'steady', name: 'Steady', moods: null, about: 'One mood all the way through.' },
  { id: 'bright-dark', name: 'Bright → Dark', moods: ['bright', 'dark'], about: 'Starts happy, turns serious.' },
  { id: 'dark-hopeful', name: 'Dark → Hopeful', moods: ['dark', 'hopeful'], lift: true, about: 'Starts sad, and ends on a major home chord, like the sun coming out.' },
  { id: 'build-up', name: 'Build-up', moods: ['bright', 'epic'], about: 'Starts light, ends dramatic.' },
  { id: 'dreamy-bright', name: 'Dreamy → Bright', moods: ['dreamy', 'bright'], about: 'Floats, then lands.' },
  { id: 'bittersweet-bright', name: 'Bittersweet → Bright', moods: ['bittersweet', 'bright'], about: 'Wistful, then it all resolves.' },
];

export const journeyById = (id) => JOURNEYS.find((j) => j.id === id) || null;

/**
 * The mood of each slot for a preset journey. The change comes about halfway,
 * moved to a nearby phrase boundary if there is one; `at` sets the first slot
 * of the second mood instead.
 * @returns {string[]} one mood id per slot
 */
export function journeyFor(preset, slots, { mood = 'bright', at = null } = {}) {
  const n = slots.length;
  if (!preset?.moods) return slots.map(() => mood);
  const [a, b] = preset.moods;
  let split = at;
  if (split == null) {
    split = Math.ceil(n / 2);
    let bestD = Infinity;
    for (let i = 1; i < n; i++) {
      const d = Math.abs(i - n / 2);
      if (slots[i - 1].phraseEnd && d <= n / 4 && d < bestD) { bestD = d; split = i; }
    }
  }
  split = Math.max(n > 1 ? 1 : 0, Math.min(n, split));
  return slots.map((_, i) => (i < split ? a : b));
}
