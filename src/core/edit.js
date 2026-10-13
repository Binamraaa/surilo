// Note-editing operations for the piano roll. Pure: every function returns a new,
// time-sorted array and never mutates its input, so undo is just "keep the old array".
// Notes are {midi, start, end, ...}; edited notes get `edited: true`. A note the app
// moved to the one you probably meant has `adjusted: true` and keeps `nearest`.
// Changing its pitch by hand settles it, so it's no longer marked.

export const MIN_LEN = 0.06; // seconds — shorter than this isn't a playable note

let nextId = 1;
const newId = () => `n${nextId++}`;

/** Give every note a stable id, so the UI can follow a note through re-sorting. */
export function withIds(notes) {
  return notes.map((n) => (n.id ? n : { ...n, id: newId() }));
}

const sortNotes = (notes) => [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
const clampMidi = (m) => Math.max(21, Math.min(108, m)); // piano range A0–C8

/** Change pitch by `semis` (±1 = semitone, ±12 = octave). */
export function transpose(notes, i, semis) {
  if (!notes[i] || !semis) return notes;
  return notes.map((n, j) => (j === i ? { ...n, midi: clampMidi(n.midi + semis), edited: true, adjusted: false } : n));
}

/** Set an absolute pitch. */
export function setPitch(notes, i, midi) {
  if (!notes[i] || notes[i].midi === midi) return notes;
  return notes.map((n, j) => (j === i ? { ...n, midi: clampMidi(midi), edited: true, adjusted: false } : n));
}

/**
 * Settle a note the app adjusted: keep its guess, or go back to the note
 * nearest to what was actually sung.
 */
export function resolveGuess(notes, i, keep) {
  const n = notes[i];
  if (!n?.adjusted) return notes;
  return notes.map((m, j) => {
    if (j !== i) return m;
    return keep ? { ...m, adjusted: false } : { ...m, midi: m.nearest, cents: m.cents + (m.midi - m.nearest) * 100, adjusted: false, edited: true };
  });
}

/**
 * Move a note in time and/or change its edges. Deltas are in seconds.
 * Keeps start ≥ 0 and length ≥ MIN_LEN; re-sorts by start time.
 */
export function reshape(notes, i, { dStart = 0, dEnd = 0 } = {}) {
  const n = notes[i];
  if (!n || (!dStart && !dEnd)) return notes;
  let start = n.start + dStart;
  let end = n.end + dEnd;
  if (dStart && dEnd) {
    // A move: keep the length, stop at zero.
    if (start < 0) { end -= start; start = 0; }
  } else {
    start = Math.max(0, start);
    if (end - start < MIN_LEN) dStart ? (start = end - MIN_LEN) : (end = start + MIN_LEN);
  }
  const changed = { ...n, start, end, edited: true };
  return sortNotes(notes.map((m, j) => (j === i ? changed : m)));
}

export const moveNote = (notes, i, dt) => reshape(notes, i, { dStart: dt, dEnd: dt });

export function deleteNote(notes, i) {
  if (!notes[i]) return notes;
  return notes.filter((_, j) => j !== i);
}

export function addNote(notes, { midi, start, end }) {
  const n = { id: newId(), midi: clampMidi(Math.round(midi)), start: Math.max(0, start), end: Math.max(start + MIN_LEN, end), pitch: midi, cents: 0, edited: true, added: true };
  return sortNotes([...notes, n]);
}

/** Split a note in two at time `t` (defaults to its middle). */
export function splitNote(notes, i, t) {
  const n = notes[i];
  if (!n) return notes;
  const at = t ?? (n.start + n.end) / 2;
  if (at - n.start < MIN_LEN || n.end - at < MIN_LEN) return notes;
  const a = { ...n, end: at, edited: true };
  const b = { ...n, id: newId(), start: at, edited: true };
  return sortNotes([...notes.slice(0, i), a, b, ...notes.slice(i + 1)]);
}

/** Merge a note with the next one: keeps the first note's pitch, spans both. */
export function mergeWithNext(notes, i) {
  const n = notes[i], next = notes[i + 1];
  if (!n || !next) return notes;
  const merged = { ...n, end: Math.max(n.end, next.end), edited: true };
  return [...notes.slice(0, i), merged, ...notes.slice(i + 2)];
}

/** Where a note (by id) ended up after an operation re-sorted the array. */
export function indexOfId(notes, id) {
  if (id == null) return null;
  const i = notes.findIndex((n) => n.id === id);
  return i < 0 ? null : i;
}

/** Simple bounded undo stack of note arrays. */
export function createHistory(limit = 100) {
  const past = [];
  return {
    push(notes) { past.push(notes); if (past.length > limit) past.shift(); },
    undo() { return past.pop() ?? null; },
    clear() { past.length = 0; },
    get size() { return past.length; },
  };
}
