// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// A saved hum: everything needed to pick it up again later, exactly as you left it.
// The notes (as detected and as edited), the beat, and the chord choices, as plain
// JSON. Pure: runs in the browser and in Node.
//
// The same JSON goes into the on-device history and, when you save a hum as a file,
// into the WAV's "json" chunk (see wav.js), so opening that file brings it all back.
// The audio isn't part of it: frames are cheap to work out again from the recording.

export const HUM_FORMAT = 'surilo-hum';
export const HUM_VERSION = 1;

// What a note keeps. Its `id` is left out: ids are handed out afresh when it's opened.
const NOTE_KEYS = ['midi', 'pitch', 'cents', 'start', 'end', 'edited', 'adjusted', 'nearest', 'added'];

function cleanNote(n) {
  const out = {};
  for (const k of NOTE_KEYS) if (n[k] != null && n[k] !== false) out[k] = n[k];
  return out;
}

const isNote = (n) => n && Number.isFinite(n.midi) && Number.isFinite(n.start) && Number.isFinite(n.end);
const readNotes = (a) => (Array.isArray(a) ? a.filter(isNote).map(cleanNote) : null);

/**
 * The JSON for a hum.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.name
 * @param {string} o.createdAt  ISO time
 * @param {Array} o.original    notes as detected
 * @param {Array} o.notes       notes as edited (the same array as `original` if nothing was edited)
 * @param {number} o.tuning
 * @param {object|null} o.tempo  the beat: {bpm, sig, mode, countIn, origin, clicks, starts}, or null.
 *   `starts` are the note starts the tempo was followed through, so it comes back the same.
 * @param {object} o.choices  {moodId, homeKey, journeyId, strip, versions, octave}
 */
export function humMeta({ id, name, createdAt, source = null, mic = null, original, notes, tuning = 0, tempo = null, choices = {} }) {
  const orig = original.map(cleanNote);
  return {
    format: HUM_FORMAT,
    version: HUM_VERSION,
    id,
    name,
    createdAt,
    source,
    mic,
    tuning,
    original: orig,
    notes: notes === original ? null : notes.map(cleanNote), // null: as detected
    tempo: tempo && {
      bpm: tempo.bpm, sig: tempo.sig, mode: tempo.mode, countIn: tempo.countIn ?? null,
      origin: tempo.origin, clicks: tempo.clicks || [], starts: tempo.starts || [],
    },
    choices: {
      moodId: choices.moodId ?? null,
      homeKey: choices.homeKey ?? null,
      journeyId: choices.journeyId || 'steady',
      strip: choices.strip ?? null,
      versions: choices.versions || {},
      octave: choices.octave || 0,
    },
  };
}

/**
 * A saved hum's JSON → the parts to restore, with anything missing filled in, or null
 * if it isn't a saved hum (a test hum, or some other WAV's JSON).
 * `notes` is null when they're unchanged from `original`.
 */
export function readHumMeta(meta) {
  if (!meta || meta.format !== HUM_FORMAT) return null;
  const original = readNotes(meta.original);
  if (!original) return null;
  const t = meta.tempo;
  const tempo = t && Number.isFinite(t.bpm) && typeof t.sig === 'string' && Number.isFinite(t.origin)
    ? { bpm: t.bpm, sig: t.sig, mode: t.mode || 'set', countIn: t.countIn ?? null, origin: t.origin, clicks: t.clicks || [], starts: t.starts || [] }
    : null;
  const c = meta.choices || {};
  return {
    version: meta.version || 1,
    id: typeof meta.id === 'string' ? meta.id : null,
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name : 'My hum',
    createdAt: meta.createdAt || null,
    source: meta.source || null,
    mic: meta.mic || null,
    tuning: Number.isFinite(meta.tuning) ? meta.tuning : 0,
    original,
    notes: readNotes(meta.notes),
    tempo,
    choices: {
      moodId: c.moodId ?? null,
      homeKey: c.homeKey && Number.isInteger(c.homeKey.tonic) ? { tonic: c.homeKey.tonic, mode: c.homeKey.mode === 'minor' ? 'minor' : 'major' } : null,
      journeyId: c.journeyId || 'steady',
      strip: Array.isArray(c.strip) ? c.strip : null,
      versions: c.versions && typeof c.versions === 'object' ? c.versions : {},
      octave: [-1, 0, 1].includes(c.octave) ? c.octave : 0,
    },
  };
}

/** A default name for a new hum, from when it was made: "Hum, 26 Oct 14:05". */
export function defaultHumName(date = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `Hum, ${date.getDate()} ${months[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A file name for a hum: its name, lower-case, with dashes. */
export function humFileName(name) {
  const slug = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 40);
  return `${slug || 'hum'}.surilo.wav`;
}
