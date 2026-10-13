// Guess the note the singer meant, not just the nearest one to what they sang.
//
// Rounding to the nearest note fails when a hum lands between two notes. People
// miss single notes by 30–50 cents and drift flat or sharp as they go. When that
// happens, the music itself says which note was meant: the key the tune is in, and
// the fact that melodies mostly move in small steps. So each uncertain note gets
// two candidates (the notes either side of the pitch). We score every path through
// them and keep the most likely melody (Viterbi). Notes sung clearly on pitch are
// never changed.

import { framesToNotes } from './notes.js';
import { guessKey } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// Natural minor plus the raised 6th and 7th that minor tunes borrow all the time.
const MINOR = [0, 2, 3, 5, 7, 8, 9, 10, 11];

// Roughly how often each melodic step size (in semitones) appears in folk and pop
// tunes. Only the ratios matter: they decide close calls between two candidates.
const STEP_FREQ = [0.19, 0.16, 0.3, 0.11, 0.09, 0.07, 0.01, 0.04, 0.01, 0.01, 0.005, 0.003, 0.01];
const stepLogP = (semis) => Math.log(STEP_FREQ[Math.abs(semis)] ?? 0.002);

// Tuned on scripts/sweep.mjs. Following drift does most of the work; the key and
// step terms only settle notes sung within a few cents of halfway.
export const INTENT_DEFAULTS = {
  lockCents: 20,      // notes sung closer than this to a note are left alone
  sigmaCents: 22,     // how far a singer typically misses a note they meant
  keyPenalty: 1.5,    // cost of a note outside the key (mild: tunes do leave their key)
  stepWeight: 0.25,   // how much the size of the step from the last note counts
  driftNotes: 6,      // follow the singer's tuning over this many notes either side
  trust: 1,           // learnt per singer: scales how far the music may overrule the pitch
};

const wrap = (x) => x - Math.round(x); // to −0.5…+0.5

/**
 * The singer's tuning around each note (in semitones), so slow drift doesn't
 * push later notes over the halfway line. Circular mean of nearby notes'
 * offsets, unwrapped note by note, so a voice can drift by more than half a
 * semitone over a long hum without suddenly reading as the next note.
 */
export function localTuning(notes, tuning, radius) {
  // Start from the opening notes (before any drift), on the same side as the whole hum's tuning.
  let last = null;
  return notes.map((_, i) => {
    let x = 0, y = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(notes.length - 1, i + radius); j++) {
      // Leave the note itself out, or a note sung 40 cents sharp would pull its own reference sharp.
      if (j === i && notes.length > 1) continue;
      const n = notes[j];
      const w = Math.min(1, Math.max(0.1, n.end - n.start)) / (1 + Math.abs(i - j) / (radius + 1));
      const a = 2 * Math.PI * wrap(n.pitch);
      x += w * Math.cos(a); y += w * Math.sin(a);
    }
    if (Math.hypot(x, y) < 1e-9) return last ?? tuning;
    const here = Math.atan2(y, x) / (2 * Math.PI);
    last = last == null ? tuning + wrap(here - tuning) : last + wrap(here - last);
    return last;
  });
}

function inKey(midi, key) {
  const pc = (((midi - key.tonic) % 12) + 12) % 12;
  return (key.mode === 'major' ? MAJOR : MINOR).includes(pc);
}

/**
 * @param {Array<{pitch:number, start:number, end:number}>} notes  from framesToNotes
 * @param {object} [o]  see INTENT_DEFAULTS, plus `tuning` (the hum's overall offset)
 * @returns {{notes: Array, key: object|null}} each note gains `nearest` (the
 *   note closest to what was sung) and `adjusted` (true when the intended note differs)
 */
export function intendNotes(notes, o = {}) {
  const { tuning = 0, lockCents, sigmaCents, keyPenalty, stepWeight, driftNotes, trust } = { ...INTENT_DEFAULTS, ...o };
  if (!notes.length) return { notes: [], key: null };

  const tunes = localTuning(notes, tuning, driftNotes);
  const xs = notes.map((n, i) => n.pitch - tunes[i]);
  const nearest = xs.map(Math.round);
  // Uncertain notes get both neighbours as candidates; clear ones only their own.
  const cands = xs.map((x) => (Math.abs(wrap(x)) * 100 < lockCents ? [Math.round(x)] : [Math.floor(x), Math.floor(x) + 1]));

  // Too few notes to know the key: lean on it less.
  const keyWeight = trust * Math.min(1, notes.length / 8);
  const solve = (key) => {
    const emit = (i, c) => {
      const off = (xs[i] - c) * 100;
      return -(off * off) / (2 * sigmaCents * sigmaCents) - (key && !inKey(c, key) ? keyPenalty * keyWeight : 0);
    };
    let prev = cands[0].map((c) => ({ c, score: emit(0, c), path: [c] }));
    for (let i = 1; i < notes.length; i++) {
      // A long pause starts a new phrase: the step from the last note says less.
      const linked = notes[i].start - notes[i - 1].end < 1 ? stepWeight * trust : 0;
      prev = cands[i].map((c) => {
        const best = prev.reduce((a, p) => {
          const s = p.score + linked * stepLogP(c - p.c);
          return s > a.s ? { s, p } : a;
        }, { s: -Infinity, p: null });
        return { c, score: best.s + emit(i, c), path: [...best.p.path, c] };
      });
    }
    return prev.reduce((a, b) => (b.score > a.score ? b : a)).path;
  };

  // Guess the key from the plain notes, pick notes, then re-check the key once.
  const asNotes = (midis) => notes.map((n, i) => ({ ...n, midi: midis[i] }));
  let key = guessKey(asNotes(nearest))[0] ?? null;
  let path = solve(key);
  const again = guessKey(asNotes(path))[0] ?? null;
  if (again && key && (again.tonic !== key.tonic || again.mode !== key.mode)) { key = again; path = solve(key); }

  return {
    key,
    notes: notes.map((n, i) => ({
      ...n,
      midi: path[i],
      nearest: nearest[i],
      adjusted: path[i] !== nearest[i],
      cents: Math.round((xs[i] - path[i]) * 100),
    })),
  };
}

/** Frames → notes, with each note set to the one the singer most likely meant. */
export function transcribe(frames, opts = {}) {
  const { notes, tuning } = framesToNotes(frames, opts);
  const { notes: intended, key } = intendNotes(notes, { ...opts, tuning });
  return { notes: intended, tuning, key };
}
