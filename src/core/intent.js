// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// From sung pitches to notes, without guessing for the singer.
//
// Nobody hums at concert pitch: a voice sits a little sharp or flat, and often
// sinks or rises slowly as it goes. So the one thing worked out here is the
// singer's own tuning: a single straight line through the hum (where the voice
// started, and how far it drifted by the end). Every note is then simply the
// nearest note to what was sung, measured against that line. Nothing else moves
// a note.
//
// A hum that lands between two notes is still ambiguous, and the tune itself
// often says which one was meant (the key, and small steps between notes). That
// reading is worked out too, but only as a suggestion (`suggest`): the roll
// shows what was hummed, and the other note is one tap away.

import { framesToNotes } from './notes.js';
import { guessKey } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// Natural minor plus the raised 6th and 7th that minor tunes borrow all the time.
const MINOR = [0, 2, 3, 5, 7, 8, 9, 10, 11];

// Roughly how often each melodic step size (in semitones) appears in folk and pop
// tunes. Only the ratios matter: they decide close calls between two candidates.
const STEP_FREQ = [0.19, 0.16, 0.3, 0.11, 0.09, 0.07, 0.01, 0.04, 0.01, 0.01, 0.005, 0.003, 0.01];
const stepLogP = (semis) => Math.log(STEP_FREQ[Math.abs(semis)] ?? 0.002);

export const INTENT_DEFAULTS = {
  lockCents: 20,      // notes sung closer than this to a note get no suggestion
  sigmaCents: 22,     // how far a singer typically misses a note they meant
  keyPenalty: 1.5,    // cost of a note outside the key (mild: tunes do leave their key)
  stepWeight: 0.25,   // how much the size of the step from the last note counts
  maxDrift: 1,        // the voice may sink or rise this many semitones over the hum
  driftPenalty: 0.02, // a drifting line must fit clearly better than a level one
  trust: 1,           // scales how far the key and steps count in a suggestion
};

const wrap = (x) => x - Math.round(x); // to −0.5…+0.5

/**
 * The singer's tuning as one straight line: `start` semitones off concert pitch at
 * the first note, `end` at the last. Found by trying every line and keeping the one
 * the sung pitches sit closest to (long notes count more). A level line wins unless
 * a drifting one fits clearly better. Tuned on scripts/sweep.mjs and checked on real
 * hums: following nearby notes instead (as before) ran away on loose singers.
 * @param {Array<{pitch:number, start:number, end:number}>} notes
 * @returns {{start:number, end:number, at:(t:number)=>number}}
 */
export function steadyTuning(notes, { maxDrift = INTENT_DEFAULTS.maxDrift, driftPenalty = INTENT_DEFAULTS.driftPenalty } = {}) {
  const level = (a) => ({ start: a, end: a, at: () => a });
  if (!notes.length) return level(0);
  const t0 = notes[0].start;
  const span = notes[notes.length - 1].start - t0;
  const w = notes.map((n) => Math.min(1, Math.max(0.1, n.end - n.start)));
  const total = w.reduce((a, b) => a + b, 0);
  const pos = notes.map((n) => (span > 0 ? (n.start - t0) / span : 0));
  // Too few notes, or too short a hum, to tell drift from a missed note.
  const drifts = notes.length >= 6 && span >= 2 ? Math.round(maxDrift / 0.05) : 0;
  let best = { a: 0, d: 0 }, bestCost = Infinity;
  for (let k = -drifts; k <= drifts; k++) {
    const d = k * 0.05;
    for (let j = -25; j < 25; j++) {
      const a = j * 0.02;
      let c = 0;
      for (let i = 0; i < notes.length; i++) c += w[i] * wrap(notes[i].pitch - a - d * pos[i]) ** 2;
      // Near a tie, prefer the line closest to concert pitch and the least drift.
      c = c / total + driftPenalty * Math.abs(d) + 1e-4 * Math.abs(a + d / 2);
      if (c < bestCost - 1e-12) { bestCost = c; best = { a, d }; }
    }
  }
  const { a, d } = best;
  return { start: a, end: a + d, at: (t) => a + d * (span > 0 ? Math.min(1, Math.max(0, (t - t0) / span)) : 0) };
}

function inKey(midi, key) {
  const pc = (((midi - key.tonic) % 12) + 12) % 12;
  return (key.mode === 'major' ? MAJOR : MINOR).includes(pc);
}

/**
 * @param {Array<{pitch:number, start:number, end:number}>} notes  from framesToNotes
 * @param {object} [o]  see INTENT_DEFAULTS
 * @returns {{notes: Array, key: object|null, tuning: {start:number, end:number}}}
 *   each note's `midi` is the note nearest to what was sung (against the singer's
 *   tuning), `cents` how far off it was. A note sung between two gets `suggest`:
 *   the other note, when the key and the notes around it point that way.
 */
export function intendNotes(notes, o = {}) {
  const { lockCents, sigmaCents, keyPenalty, stepWeight, maxDrift, driftPenalty, trust } = { ...INTENT_DEFAULTS, ...o };
  if (!notes.length) return { notes: [], key: null, tuning: { start: 0, end: 0 } };

  const line = steadyTuning(notes, { maxDrift, driftPenalty });
  const xs = notes.map((n) => n.pitch - line.at(n.start));
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

  // The suggestions: guess the key from the notes as hummed, pick the likeliest
  // melody, then re-check the key once.
  const asNotes = (midis) => notes.map((n, i) => ({ ...n, midi: midis[i] }));
  let key = guessKey(asNotes(nearest))[0] ?? null;
  let path = trust > 0 ? solve(key) : nearest;
  if (trust > 0) {
    const again = guessKey(asNotes(path))[0] ?? null;
    if (again && key && (again.tonic !== key.tonic || again.mode !== key.mode)) { key = again; path = solve(key); }
  }

  return {
    key,
    tuning: { start: line.start, end: line.end },
    notes: notes.map((n, i) => {
      const out = { ...n, midi: nearest[i], cents: Math.round((xs[i] - nearest[i]) * 100) };
      if (path[i] !== nearest[i]) out.suggest = path[i];
      return out;
    }),
  };
}

/**
 * Frames → notes: each one the nearest note to what was sung, against the singer's
 * own tuning. `tuning` is that tuning's average (semitones off concert pitch), and
 * `drift` how far it moved from the first note to the last.
 */
export function transcribe(frames, opts = {}) {
  const { notes } = framesToNotes(frames, { ...opts, autoTune: false });
  return finishNotes(notes, opts);
}

/** The same, from notes already segmented (see liveNotes in notes.js). */
export function finishNotes(rawNotes, opts = {}) {
  const { notes, key, tuning } = intendNotes(rawNotes, opts);
  return { notes, key, tuning: (tuning.start + tuning.end) / 2, drift: tuning.end - tuning.start };
}
