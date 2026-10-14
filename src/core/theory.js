// Music theory helpers: key guess, chord suggestions, guitar fingering, staff spelling.

import { midiToName } from './notes.js';

// Krumhansl–Kessler key profiles (probe-tone ratings).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Keys conventionally written with flats.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);        // F Bb Eb Ab Db
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);     // Dm Gm Cm Fm Bbm Ebm

export const keyUsesFlats = (key) => (key.mode === 'major' ? FLAT_MAJOR : FLAT_MINOR).has(key.tonic);

function correlate(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  const mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Duration-weighted pitch-class histogram. Longer notes count more. */
export function pitchClassHistogram(notes) {
  const h = new Array(12).fill(0);
  for (const n of notes) h[((n.midi % 12) + 12) % 12] += Math.max(0.05, n.end - n.start);
  return h;
}

/**
 * Guess the key of a melody. Returns the ranked candidates; a short hum is
 * genuinely ambiguous, so the UI should show the runner-up too.
 * @returns {Array<{tonic:number, mode:'major'|'minor', name:string, score:number}>}
 */
export function guessKey(notes) {
  if (!notes.length) return [];
  const h = pitchClassHistogram(notes);
  const out = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      const prof = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = prof.map((_, i) => prof[(i - tonic + 12) % 12]);
      let score = correlate(h, rotated);
      // Penalise keys that would need the hummed notes to be "wrong" (outside the scale).
      const scale = (mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11]).map((d) => (d + tonic) % 12);
      const total = h.reduce((a, b) => a + b, 0) || 1;
      const outside = h.reduce((a, v, pc) => a + (scale.includes(pc) ? 0 : v), 0) / total;
      score -= 0.8 * outside;
      // Tie-break: melodies very often end on the tonic.
      const last = ((notes[notes.length - 1].midi % 12) + 12) % 12;
      if (last === tonic) score += 0.03;
      // Slight prior for major: in short, ambiguous hums it is the more common answer.
      if (mode === 'major') score += 0.02;
      out.push({ tonic, mode, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((k) => ({ ...k, name: keyName(k) }));
}

export function keyName({ tonic, mode }) {
  const flats = (mode === 'major' ? FLAT_MAJOR : FLAT_MINOR).has(tonic);
  return `${midiToName(tonic, { flats, octave: false })} ${mode}`;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'];
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''];
const MAJOR_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const MINOR_NUMERALS = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
// How "home-friendly" each degree is for a beginner progression.
const MAJOR_WEIGHT = [1.0, 0.75, 0.55, 0.95, 0.95, 0.85, 0.3];
const MINOR_WEIGHT = [1.0, 0.3, 0.85, 0.9, 0.7, 0.85, 0.85];

/** The diatonic triads of a key, with chord tones as pitch classes. */
export function diatonicChords(key) {
  const minor = key.mode === 'minor';
  const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
  const flats = keyUsesFlats(key);
  return scale.map((deg, i) => {
    const root = (key.tonic + deg) % 12;
    const tones = [0, 2, 4].map((step) => (key.tonic + scale[(i + step) % 7]) % 12);
    const quality = (minor ? MINOR_QUALITIES : MAJOR_QUALITIES)[i];
    // In minor, offer the major V (harmonic minor) — it's what most songs actually use.
    return {
      root, tones, quality,
      name: midiToName(root, { flats, octave: false }) + quality,
      numeral: (minor ? MINOR_NUMERALS : MAJOR_NUMERALS)[i],
      weight: (minor ? MINOR_WEIGHT : MAJOR_WEIGHT)[i],
    };
  });
}

/**
 * Suggest chords for a melody: split it into phrases of ~`notesPerChord` notes
 * (or by long pauses) and pick, for each, the diatonic chord whose tones cover
 * the most melody time. Also returns the overall best-fitting chords.
 */
export function suggestChords(notes, key, { notesPerChord = 4, chords: chordSet = null } = {}) {
  if (!notes.length || (!key && !chordSet)) return { progression: [], palette: [] };
  // `chords` lets a chosen mood (mode) supply its own chord set (see modes.js).
  const chords = chordSet || diatonicChords(key);

  const fit = (chord, group, cadence = false) => {
    let covered = 0, total = 0;
    group.forEach((n, i) => {
      // First note of a group and long notes matter most (they're usually "on the beat");
      // the very last note of a melody is where it resolves, so it counts double.
      const last = cadence && i === group.length - 1;
      const w = Math.max(0.05, n.end - n.start) * (i === 0 ? 1.5 : 1) * (last ? 2 : 1);
      total += w;
      if (chord.tones.includes(((n.midi % 12) + 12) % 12)) covered += w;
    });
    return total ? (covered / total) * 0.8 + chord.weight * 0.2 : 0;
  };

  // Group notes into phrases.
  const groups = [];
  let g = [];
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    const pause = prev ? n.start - prev.end : 0;
    if (g.length && (g.length >= notesPerChord || pause > 0.45)) { groups.push(g); g = []; }
    g.push(n);
  });
  if (g.length) groups.push(g);

  const progression = groups.map((grp, i) => {
    let ranked = chords.map((c) => ({ chord: c, score: fit(c, grp, i === groups.length - 1) })).sort((a, b) => b.score - a.score);
    // End on the home chord when it fits reasonably well.
    if (i === groups.length - 1) {
      const home = ranked.find((r) => r.chord.numeral.toLowerCase() === 'i');
      if (home && home.score > ranked[0].score - 0.12) ranked = [home, ...ranked.filter((r) => r !== home)];
    }
    return { chord: ranked[0].chord, start: grp[0].start, end: grp[grp.length - 1].end, noteCount: grp.length, firstIndex: notes.indexOf(grp[0]) };
  });

  const palette = chords
    .map((c) => ({ chord: c, score: fit(c, notes) }))
    .sort((a, b) => b.score - a.score)
    .filter((r) => r.chord.quality !== 'dim')
    .slice(0, 4)
    .map((r) => r.chord);

  return { progression, palette };
}

const ROLES = ['root', '3rd', '5th'];
// Triads that contain a note, for when there's no key or the note is outside it:
// [quality, interval from the chord's root to the note, how common the result is].
const ANY_KEY = [['', 0, 1], ['', 7, 0.9], ['m', 3, 0.85], ['m', 0, 0.6], ['', 4, 0.5], ['m', 7, 0.5]];

/**
 * Chords that have this note in them, so you can harmonise one note at a time.
 * In a key: the key's own chords that contain the note, most common first.
 * With no key, or for a note outside the key: the major and minor chords that contain it.
 * `role` says which part of the chord the note is (root, 3rd or 5th).
 * @returns {Array<{root, tones, quality, name, numeral, weight, role, inKey:boolean}>}
 */
export function chordsWithNote(midi, key) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  if (key) {
    const fits = diatonicChords(key).filter((c) => c.quality !== 'dim' && c.tones.includes(pc));
    if (fits.length) {
      return fits
        .map((c) => ({ ...c, role: ROLES[c.tones.indexOf(pc)], inKey: true }))
        .sort((a, b) => b.weight - a.weight);
    }
  }
  const flats = key ? keyUsesFlats(key) : false;
  return ANY_KEY.map(([quality, offset, weight]) => {
    const root = (pc - offset + 12) % 12;
    const tones = [0, quality === 'm' ? 3 : 4, 7].map((d) => (root + d) % 12);
    return {
      root, tones, quality, weight, inKey: false, numeral: '',
      name: midiToName(root, { flats, octave: false }) + quality,
      role: ROLES[tones.indexOf(pc)],
    };
  });
}

/**
 * MIDI notes for playing a chord out loud: root position with the root between
 * E3 and D♯4 (where laptop and phone speakers still sound full), plus the root
 * an octave lower as a bass note.
 */
export function voiceChord(chord, { bass = true } = {}) {
  const root = 52 + (((chord.root % 12) - 4 + 12) % 12);
  const notes = chord.tones.map((pc) => root + ((pc - (root % 12) + 12) % 12)).sort((a, b) => a - b);
  return bass ? [root - 12, ...notes] : notes;
}

// ---------- Guitar ----------

export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (string 6 → 1)
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/** Every place a note can be played, frets 0…maxFret. */
export function positionsFor(midi, { tuning = STANDARD_TUNING, maxFret = 15 } = {}) {
  const out = [];
  tuning.forEach((open, s) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret });
  });
  return out;
}

/**
 * Choose one fret position per note so the whole phrase is easy to play:
 * prefer low frets and open strings, and penalise big hand shifts.
 * Dynamic programming over all candidate positions (Viterbi-style).
 * Notes outside the guitar's range are moved by octaves first.
 */
export function fingerMelody(notes, { tuning = STANDARD_TUNING, maxFret = 15 } = {}) {
  const lo = tuning[0], hi = tuning[tuning.length - 1] + maxFret;
  const fitted = notes.map((n) => {
    let m = n.midi;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  });
  const cands = fitted.map((m) => positionsFor(m, { tuning, maxFret }));
  if (!cands.length) return [];

  const handPos = (p) => (p.fret === 0 ? null : p.fret);
  const local = (p) => (p.fret === 0 ? 0 : 0.6 + p.fret * 0.35) + (p.fret > 12 ? 2 : 0);
  const move = (a, b) => {
    const ha = handPos(a), hb = handPos(b);
    let c = 0;
    if (ha != null && hb != null) {
      const d = Math.abs(ha - hb);
      c += d <= 3 ? d * 0.2 : 0.6 + (d - 3) * 0.8; // within a 4-fret box is cheap
    }
    c += Math.abs(a.string - b.string) * 0.15;
    return c;
  };

  let cost = cands[0].map(local);
  const back = [cands[0].map(() => -1)];
  for (let i = 1; i < cands.length; i++) {
    const nc = [], nb = [];
    cands[i].forEach((p) => {
      let best = Infinity, arg = 0;
      cands[i - 1].forEach((q, j) => {
        const c = cost[j] + move(q, p);
        if (c < best) { best = c; arg = j; }
      });
      nc.push(best + local(p));
      nb.push(arg);
    });
    cost = nc; back.push(nb);
  }
  let k = cost.indexOf(Math.min(...cost));
  const path = new Array(cands.length);
  for (let i = cands.length - 1; i >= 0; i--) {
    path[i] = { ...cands[i][k], midi: fitted[i], moved: fitted[i] !== notes[i].midi };
    k = back[i][k];
  }
  return path;
}

// ---------- Staff ----------

const LETTER_STEPS_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C# D D# E F F# G G# A A# B
const LETTER_STEPS_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];  // C Db D Eb E F Gb G Ab A Bb B
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/**
 * Where a note sits on the staff: a diatonic step count from C0 plus an accidental.
 * Accidentals are shown on every note (no key signature) — clearer for beginners.
 */
export function staffSpelling(midi, flats) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const letter = (flats ? LETTER_STEPS_FLAT : LETTER_STEPS_SHARP)[pc];
  const acc = pc - NATURAL_PC[letter]; // -1, 0, +1
  return { step: octave * 7 + letter, accidental: acc === 1 ? '♯' : acc === -1 ? '♭' : '' };
}
