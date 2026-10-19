// Modes: the seven scales around a home note, and spelling by scale degree.
// The moods (moods.js, harmony.js) build on these for chord names; they never
// change the melody, so nothing here rewrites notes any more.
//
// Everything here is relative to a home note (tonic, pitch class 0–11).

import { midiToName } from './notes.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * steps: the scale, in semitones above the home note.
 * char:  index into `steps` of the note that gives the mode its colour.
 * prog:  a signature progression, as scale-degree indexes (0 = home chord).
 */
export const MODES = [
  {
    id: 'ionian', name: 'Major', alt: 'Ionian', steps: [0, 2, 4, 5, 7, 9, 11],
    mood: 'Bright and settled. Most pop, folk and nursery tunes.',
    char: 6, charText: 'the major 7th leans strongly back home',
    prog: [0, 4, 5, 3],
  },
  {
    id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10],
    mood: 'Major but loose and bluesy. Rock riffs, folk, jam bands.',
    char: 6, charText: 'the flat 7th takes the edge off the major sound',
    prog: [0, 6, 3, 0],
  },
  {
    id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11],
    mood: 'Dreamy and floating. Film scores, Steven Wilson-style lift.',
    char: 3, charText: 'the raised 4th makes it float',
    prog: [0, 1, 0, 1],
  },
  {
    id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10],
    mood: 'Minor but hopeful. Funk, soul, Celtic, prog grooves.',
    char: 5, charText: 'the major 6th brightens the minor sound',
    prog: [0, 3, 0, 6],
  },
  {
    id: 'aeolian', name: 'Minor', alt: 'Aeolian', steps: [0, 2, 3, 5, 7, 8, 10],
    mood: 'Sad, serious, emotional. Ballads and a lot of rock and metal.',
    char: 5, charText: 'the flat 6th gives the darker, sadder pull',
    prog: [0, 5, 6, 0],
  },
  {
    id: 'harmonic', name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11],
    mood: 'Dramatic and exotic minor, with a strong pull home. Classical, metal, flamenco.',
    char: 6, charText: 'the raised 7th creates that tense, exotic pull',
    prog: [0, 3, 4, 0],
  },
  {
    id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10],
    mood: 'Dark and tense, Spanish or Middle-Eastern flavour. Metal and flamenco.',
    char: 1, charText: 'the flat 2nd sits right on top of home and sounds menacing',
    prog: [0, 1, 0, 6],
  },
];

const QUALITY = { '4,3': '', '3,4': 'm', '3,3': 'dim', '4,4': 'aug' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const FLAT_TONICS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

// Which scale degree each semitone above home belongs to (1 = ♭2 → 2nd degree, 6 = ♯4 → 4th…).
export const DEGREE_OF = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

/**
 * Spell a note by its scale degree, the way sheet music does: in D harmonic minor
 * the raised 7th is C♯ (not D♭); in C Phrygian the ♭2 is D♭ (not C♯).
 */
export function spell(tonic, mode, iv, degree) {
  const tonicName = midiToName(tonic, { flats: modeUsesFlats(tonic, mode), octave: false });
  const letter = (LETTERS.indexOf(tonicName[0]) + degree) % 7;
  let diff = ((((tonic + iv) - NATURAL[letter]) % 12) + 12) % 12;
  if (diff > 6) diff -= 12;
  return LETTERS[letter] + (ACC[diff] ?? '');
}

/** Prefer flat spellings for flat-side home notes and modes that darken them. */
export function modeUsesFlats(tonic, mode) {
  // Use the relative major's tonic to decide, the way key signatures do.
  const ionianOffset = { ionian: 0, mixolydian: 5, lydian: 7, dorian: 10, aeolian: 3, harmonic: 3, phrygian: 8 }[mode.id];
  const rel = (tonic + ionianOffset) % 12;
  return FLAT_TONICS.has(rel) || rel === 5;
}

/**
 * Sharps or flats for showing this melody's notes in a mode? Count how the notes
 * it actually uses are spelled: D harmonic minor without B♭ → sharps (C♯).
 */
export function prefersFlats(notes, tonic, mode) {
  let flats = 0, sharps = 0;
  const seen = new Set();
  for (const n of notes) {
    const iv = (((n.midi - tonic) % 12) + 12) % 12;
    if (seen.has(iv)) continue;
    seen.add(iv);
    const d = mode.steps.indexOf(iv);
    const name = spell(tonic, mode, iv, d >= 0 ? d : DEGREE_OF[iv]);
    if (name.includes('♭')) flats++;
    if (name.includes('♯')) sharps++;
  }
  return flats === sharps ? modeUsesFlats(tonic, mode) : flats > sharps;
}

/** Triads built on every degree of the mode, with names and Roman numerals. */
export function modeChords(tonic, mode) {
  const s = mode.steps;
  const sigDegrees = new Set(mode.prog);
  return s.map((deg, i) => {
    const third = (s[(i + 2) % 7] - deg + 12) % 12;
    const fifth = (s[(i + 4) % 7] - deg + 12) % 12;
    const quality = QUALITY[`${third},${fifth - third}`] ?? '';
    const root = (tonic + deg) % 12;
    // Numeral relative to the major scale: ♭III, ♯IV…
    const diff = deg - MAJOR[i];
    const acc = diff < 0 ? '♭' : diff > 0 ? '♯' : '';
    let rn = ROMAN[i];
    if (quality === 'm' || quality === 'dim') rn = rn.toLowerCase();
    rn = acc + rn + (quality === 'dim' ? '°' : quality === 'aug' ? '+' : '');
    return {
      root,
      tones: [0, 2, 4].map((k) => (tonic + s[(i + k) % 7]) % 12),
      quality,
      name: spell(tonic, mode, deg, i) + quality,
      numeral: rn,
      degree: i,
      // Home chord first, then the mode's signature chords; diminished chords last.
      weight: i === 0 ? 1 : quality === 'dim' ? 0.3 : sigDegrees.has(i) ? 0.9 : 0.6,
      signature: sigDegrees.has(i) && i !== 0,
    };
  });
}
