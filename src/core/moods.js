// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Moods: the same melody, harmonised in different ways. A mood is a recipe for
// the chords underneath: which chords it uses, which moves between them it
// likes, which colour notes it allows, how it ends and how often the chords
// change. A mood never changes a note of the melody.
//
// Chords are Roman numerals counted from the home note (the key's tonic):
//   upper case = major, lower case = minor, ♭/♯ in front moves the root;
//   a suffix adds a type: 7, 9, 13, maj7, maj9, maj7♯11, 6, add9, sus2, sus4, 7sus4,
//   7♯9, 7♭9, 5 (a power chord), ø (m7♭5), °7; lower case + 7 / 9 / 6 / add9 = m7 / m9 / m6 / m(add9);
//   V7/ii = a secondary dominant (the V7 of ii); ♭II7 = a tritone substitute for V7;
//   ♭VII/1 = a slash chord over a bass note, given as a scale degree (B♭/C in C; I/3 = C/E).
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
//   wander:  the cost of going straight back to the root before (Am → F → Am9), for moods that
//            should keep travelling instead of rocking between two chords
//   feel:    how playback plays the mood's chords (see FEELS in audio/synth.js): the same
//            chord, strummed, broken up, held or comped. It never adds a note of its own.

export const MOODS = [
  {
    id: 'bright', name: 'Bright', theory: 'Major (Ionian)', feel: 'Happy, settled, sing-along.',
    rate: 1, colour: false, play: 'strum',
    major: {
      palette: ['I', 'IV', 'V', 'vi', 'ii', 'V7', 'I/3', 'V/7', 'IVadd9'],
      moves: { 'V>I': 0.5, 'IV>I': 0.35, 'ii>V': 0.3, 'IV>V': 0.2, 'vi>IV': 0.2, 'I>IV': 0.15, 'vi>ii': 0.15, 'I>V': 0.1 },
      cadence: ['V', 'I'],
    },
    minor: {
      palette: ['♭III', '♭VII', '♭VI', 'I', 'IV', 'iv', '♭VIadd9', '♭VII/2'],
      moves: { '♭VII>I': 0.5, '♭VI>♭VII': 0.4, '♭VII>♭III': 0.3, 'IV>I': 0.3, '♭III>♭VI': 0.2, 'I>IV': 0.2 },
      cadence: ['♭VII', 'I'],
    },
  },
  {
    id: 'bittersweet', name: 'Bittersweet', theory: 'Major, leaning on its minor chords', feel: 'Happy and sad at once. Wistful pop ballads.',
    rate: 1, colour: false, play: 'arp',
    major: {
      palette: ['vi', 'IV', 'I', 'V', 'iii', 'ii', 'IVmaj7', 'vi7', 'I/3', 'V/7', 'iii7'],
      moves: { 'vi>IV': 0.45, 'V>vi': 0.4, 'IV>I': 0.35, 'I>V': 0.35, 'iii>vi': 0.25, 'iii>IV': 0.2, 'IV>V': 0.15 },
      cadence: ['IV|vi'],
      avoidEnd: [['I']],
    },
    minor: {
      palette: ['i', '♭VI', '♭III', '♭VII', 'iv', 'v', '♭VImaj7', 'i7', 'iv7', '♭III/5'],
      moves: { 'i>♭VI': 0.45, '♭VI>♭III': 0.35, '♭III>♭VII': 0.35, '♭VII>i': 0.3, 'iv>♭VI': 0.2, 'v>♭VI': 0.2 },
      cadence: ['♭VI|iv'],
      avoidEnd: [['i']],
    },
  },
  {
    id: 'dark', name: 'Dark', theory: 'Minor (Aeolian), borrowing from the parallel minor', feel: 'Sad, serious, emotional.',
    rate: 1, colour: false, play: 'pad',
    major: {
      palette: ['vi', 'iv', '♭VI', '♭VII', 'v', 'iii', 'viadd9', 'iv6', '♭VImaj7'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>vi': 0.4, 'vi>iv': 0.3, 'iv>♭VII': 0.25, 'iv>vi': 0.25, 'vi>♭VI': 0.2, 'v>vi': 0.2, 'iii>vi': 0.2 },
      cadence: ['♭VII|iv', 'vi'],
    },
    minor: {
      palette: ['i', 'iv', '♭VI', '♭VII', 'v', '♭III', 'iadd9', 'iv6', '♭VImaj7', 'iiø'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>i': 0.45, 'iv>i': 0.3, 'i>iv': 0.25, 'i>♭VI': 0.25, 'iv>♭VII': 0.25, 'v>i': 0.2, 'ii>v': 0.25, 'ii>i': 0.15 },
      cadence: ['♭VII', 'i'],
    },
  },
  {
    id: 'hopeful', name: 'Hopeful minor', theory: 'Dorian', feel: 'Minor, but with a lift. Soul, funk, Celtic.',
    rate: 1, colour: false, play: 'stabs',
    major: {
      // A major tune made Dorian: lean on ii as its minor home chord.
      palette: ['ii', 'V', 'I', 'iii', 'vi', 'IV', 'ii7', 'V7', 'ii9', 'V7sus4'],
      moves: { 'ii>V': 0.45, 'V>ii': 0.45, 'I>ii': 0.3, 'ii>I': 0.25, 'iii>ii': 0.2, 'V>I': 0.1 },
      cadence: ['V', 'ii'],
    },
    minor: {
      palette: ['i', 'IV', '♭VII', 'ii', '♭III', 'v', 'i7', 'IV7', 'i9', '♭VIIadd9'],
      moves: { 'i>IV': 0.45, 'IV>i': 0.45, '♭VII>i': 0.3, 'i>♭VII': 0.25, 'IV>♭VII': 0.2, 'ii>i': 0.2 },
      cadence: ['IV', 'i'],
    },
  },
  {
    id: 'bluesy', name: 'Bluesy', theory: 'Dominant 7ths and 9ths, blue notes', feel: 'Loose and gritty. Blues, rock, soul.',
    rate: 1, colour: true, play: 'shuffle', wander: 0.12,
    extra: { 7: [3], 9: [3], 13: [3], maj: [3] }, // the blue note (♭3) over a major or dominant chord
    major: {
      // The three chords of the blues, as 7ths, 9ths and 13ths; I7♯9 holds the blue note itself;
      // ♭III and ♭VII are the rock side of it.
      palette: ['I7', 'IV7', 'V7', 'IV9', 'I9', 'I7♯9', '♭VII', '♭III', 'V9', 'I13', 'V7♯9'],
      moves: {
        'I>IV': 0.4, 'IV>I': 0.45, 'V>IV': 0.45, 'IV>V': 0.2, 'V>I': 0.3, 'I>V': 0.15,
        'I>♭VII': 0.25, '♭VII>IV': 0.35, 'I>♭III': 0.25, '♭III>IV': 0.35,
      },
      cadence: ['V|IV', 'I'],
    },
    minor: {
      palette: ['i7', 'iv7', 'V7', 'i9', 'iv9', '♭VI7', '♭VII7', 'V7♯9', '♭III', 'i6', '♭VI9'],
      moves: {
        'i>iv': 0.4, 'iv>i': 0.45, '♭VI>V': 0.5, 'V>i': 0.4, 'iv>♭VI': 0.25, 'i>♭VI': 0.2,
        'i>♭VII': 0.25, '♭VII>♭VI': 0.35, '♭III>iv': 0.25, 'i>♭III': 0.2,
      },
      cadence: ['♭VI|iv', 'V|iv', 'i'],
    },
  },
  {
    id: 'dreamy', name: 'Dreamy', theory: 'Lydian', feel: 'Floating and bright. Film scores.',
    rate: 2, colour: true, play: 'shimmer', wander: 0.3, extra: { maj: [6], add9: [6] }, // the raised 4th
    major: {
      palette: ['Imaj7', 'II', 'Imaj9', 'vi9', 'IVmaj7♯11', 'iii7', 'II/1', 'Iadd9', '♭VIImaj7', 'V', 'vi'],
      moves: { 'I>II': 0.5, 'II>I': 0.4, 'vi>II': 0.25, 'I>vi': 0.25, 'iii>II': 0.2, 'II>iii': 0.2, 'I>♭VII': 0.25, '♭VII>I': 0.2, 'vi>IV': 0.2, 'IV>I': 0.15, 'V>I': 0.1 },
      cadence: ['I|II', 'I'],
    },
    minor: {
      palette: ['♭VImaj7', '♭VII', 'i9', '♭IIImaj9', 'iv9', '♭VImaj7♯11', '♭VII/1', 'i7', '♭IIIadd9', '♭VIadd9'],
      moves: { '♭VI>♭VII': 0.45, '♭VII>♭VI': 0.35, 'i>♭VI': 0.3, '♭VII>i': 0.25, 'iv>♭VI': 0.2, '♭III>♭VI': 0.25, 'i>♭III': 0.2 },
      cadence: ['♭VI'],
    },
  },
  {
    id: 'epic', name: 'Epic / tense', theory: 'Phrygian and harmonic minor', feel: 'Dramatic, menacing, cinematic.',
    rate: 1, colour: false, play: 'drive',
    major: {
      // A major tune made epic: centre it on vi, with vi's ♭II (♭VII) and its major V (III).
      palette: ['vi', '♭VII', 'III', 'IV', 'ii', '♭VII/6', 'iii', 'vi5', 'III7', 'IV5'],
      moves: { 'III>vi': 0.5, 'vi>♭VII': 0.45, 'IV>III': 0.45, '♭VII>vi': 0.4, 'ii>III': 0.25, 'vi>IV': 0.25 },
      cadence: ['III', 'vi'],
    },
    minor: {
      palette: ['i', '♭II', 'V', '♭VI', 'iv', '♭II/1', '♭VII', 'i5', 'V7♭9', '♭VI5', 'iv6'],
      moves: { 'V>i': 0.5, 'i>♭II': 0.45, '♭VI>V': 0.45, '♭II>i': 0.4, 'iv>V': 0.25, 'i>♭VI': 0.25, '♭VII>i': 0.15, '♭VI>♭VII': 0.25 },
      cadence: ['V', 'i'],
    },
  },
  {
    id: 'jazzy', name: 'Jazzy', theory: 'ii–V–I with 9ths and 13ths, and a few side doors', feel: 'Smooth and sophisticated. Jazz standards, bossa, neo-soul.',
    rate: 0.5, colour: true, play: 'comp', wander: 0.15, extra: { 7: [1, 3], 13: [1, 3] }, // altered dominants: the ♭9 and ♯9
    major: {
      // The rich versions first: a 9th or 13th in the tune gets a chord that holds it. ♭II7 is the
      // tritone substitute (it slides down to I instead of V7 falling to it); ♭VII9 the "backdoor" way home.
      palette: ['ii9', 'V13', 'Imaj9', 'vi7', 'iii7', 'IVmaj7', 'V7/ii', '♭II7', 'V9', 'ii7', 'V7', 'Imaj7', 'V7/V', '♭VII9', 'I6', 'V7♭9'],
      moves: {
        'ii>V': 0.5, 'V>I': 0.5, 'ii>♭II': 0.4, '♭II>I': 0.5, 'V/ii>ii': 0.45, 'V/V>V': 0.45, 'vi>ii': 0.35, 'iii>vi': 0.35,
        'I>vi': 0.2, 'I>V/ii': 0.25, 'iii>V/ii': 0.25, 'IV>iii': 0.2, 'IV>♭VII': 0.3, '♭VII>I': 0.4, 'I>IV': 0.15, 'IV>V': 0.1,
      },
      cadence: ['ii', 'V|♭II', 'I'],
    },
    minor: {
      palette: ['i9', 'iiø', 'V7♭9', 'iv9', '♭IIImaj9', '♭VImaj7', '♭VII9', 'i6', 'V7/iv', '♭IImaj7', 'i7', 'iv7', 'V7', '♭VII7', '♭IIImaj7'],
      moves: {
        'ii>V': 0.5, 'V>i': 0.5, 'iv>V': 0.35, '♭VII>♭III': 0.45, '♭III>♭VI': 0.3, '♭VI>ii': 0.3, 'i>iv': 0.25,
        'V/iv>iv': 0.4, 'i>V/iv': 0.2, '♭II>i': 0.4, '♭VI>♭II': 0.25, 'iv>♭VII': 0.25, '♭VI>iv': 0.15,
      },
      cadence: ['ii|iv', 'V', 'i'],
    },
  },
  {
    id: 'floating', name: 'Floating / prog', theory: 'Chords borrowed from other keys, a third apart', feel: 'Open, shifting, unresolved. Prog, post-rock, ambient.',
    rate: 1, colour: true, play: 'pulse', thirds: 0.3, heldBass: 0.2, wander: 0.45,
    major: {
      // Colour chords on the home note, then the surprises: ♭VI, ♭III and ♭II from other keys,
      // the major chord a third up (III), the major IV turning minor (iv), and chords over a held bass.
      palette: ['Iadd9', '♭VImaj7', 'IVmaj7♯11', '♭III', 'viadd9', '♭VII/1', 'III', 'ivadd9', '♭IImaj7', 'Isus2', 'Vsus4', 'IV/1', '♭VIIadd9', 'iii7', '♭VI', 'IVadd9'],
      moves: {
        'I>♭VI': 0.3, '♭VI>I': 0.2, 'I>♭III': 0.3, '♭III>♭VI': 0.25, '♭VI>♭VII': 0.25, '♭VII>I': 0.2, 'I>III': 0.25, 'III>IV': 0.2,
        'IV>iv': 0.35, 'iv>I': 0.3, '♭II>I': 0.25, 'vi>IV': 0.15, 'I>♭VII': 0.2, 'iii>♭III': 0.2, 'V>I': -0.4,
      },
      cadence: ['I|IV|♭VI'],
      avoidEnd: [['V', 'I']],
    },
    minor: {
      palette: ['iadd9', '♭VImaj7', '♭IIIadd9', 'IV', '♭VII/1', '♭IImaj7', 'vadd9', 'iv/1', 'Isus2', '♭VIadd9', 'III', '♭VII7sus4', 'i9', '♭VI', '♭IIImaj7♯11', 'Isus4'],
      moves: {
        'i>♭VI': 0.3, '♭VI>♭III': 0.25, '♭III>♭VII': 0.2, '♭VII>i': 0.15, 'i>IV': 0.3, 'IV>♭VI': 0.3, '♭II>i': 0.3, 'i>♭II': 0.2,
        'i>v': 0.2, 'v>♭VI': 0.25, 'i>III': 0.2, 'I>♭VI': 0.25, '♭VI>I': 0.2, 'V>i': -0.4, 'V>I': -0.4,
      },
      cadence: ['I|i|♭VI|IV'],
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
