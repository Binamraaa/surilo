// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Minimal Standard MIDI File (format 1) writer — the bridge to a DAW (e.g. Reaper).
// Melody on track 1, optional chords on track 2. Without a beat, time is kept in real
// seconds at 120 BPM. With one (a quantised hum), the file carries the tempo and time
// signature, and every note sits on the grid: bar 1 beat 1 is tick 0.

const PPQ = 480;
const BPM = 120;
const EIGHTH = PPQ / 2;
const ticks = (sec) => Math.max(0, Math.round((sec * BPM / 60) * PPQ));

const vlq = (n) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];

function track(events, name) {
  // events: [{tick, bytes}] — sorted, with note-offs before note-ons on ties.
  const data = [0, 0xff, 0x03, ...vlq(name.length), ...str(name)];
  let last = 0;
  for (const e of events.sort((a, b) => a.tick - b.tick || a.order - b.order)) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return [...str('MTrk'), ...u32(data.length), ...data];
}

const tempoEvent = (quarterBpm) => {
  const us = Math.round(60000000 / quarterBpm);
  return { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
};
// Time signature: numerator, denominator as a power of two, MIDI clocks per click, 32nds per quarter.
const SIG_EVENT = { '4/4': [4, 2, 24, 8], '3/4': [3, 2, 24, 8], '6/8': [6, 3, 36, 8] };

/**
 * @param {Array<{midi,start,end}>} notes
 * @param {Array<{chord:{tones:number[], root:number, bass?:number}, start, end, firstIndex?:number, noteCount?:number}>} [progression]
 * @param {object} [o]
 * @param {object} [o.rhythm]  quantize() output for these notes: write on the grid
 * @param {{bpm:number, sig:string}} [o.tempo]  the chosen tempo (BPM counts dotted quarters in 6/8)
 * @returns {Uint8Array} .mid file bytes
 */
export function toMidiFile(notes, progression = [], { rhythm = null, tempo = null } = {}) {
  const grid = rhythm && tempo;
  // On the grid: ticks from bar 1 beat 1 (or from the pickup bar, if the tune starts early).
  const from = grid ? Math.min(0, rhythm.bars.first * rhythm.barLen) : 0;
  const tickOfE = (e) => (e - from) * EIGHTH;
  const offset = notes.length ? notes[0].start : 0;
  const conductor = track(grid
    ? [tempoEvent(tempo.sig === '6/8' ? tempo.bpm * 1.5 : tempo.bpm), { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, ...SIG_EVENT[tempo.sig]] }]
    : [tempoEvent(BPM)], 'Surilo');

  const mel = [];
  notes.forEach((n, i) => {
    const t = grid ? rhythm.notes[i] : null;
    const on = t ? tickOfE(t.e) : ticks(n.start - offset);
    const off = t ? tickOfE(t.e + t.len) : ticks(n.end - offset);
    mel.push({ tick: on, order: 1, bytes: [0x90, n.midi, 96] });
    mel.push({ tick: off, order: 0, bytes: [0x80, n.midi, 0] });
  });
  const tracks = [conductor, track(mel, 'Melody')];

  if (progression.length) {
    const ch = [];
    const lowest = Math.min(...notes.map((n) => n.midi));
    const base = Math.floor((lowest - 7) / 12) * 12;
    // On the grid, a chord starts on its bar line (or with its first note) and lasts until the next chord.
    const startOf = (p) => (!grid ? ticks(p.start - offset)
      : p.at != null ? tickOfE(Math.max(p.at, rhythm.notes[0].e))
      : p.firstIndex != null ? tickOfE(rhythm.notes[p.firstIndex].e) : ticks(p.start - offset));
    const lastNote = grid ? rhythm.notes[rhythm.notes.length - 1] : null;
    progression.forEach((p, i) => {
      const next = progression[i + 1];
      const end = next ? startOf(next) : grid ? tickOfE(lastNote.e + lastNote.len) : ticks(p.end - offset);
      // A slash chord's bass note goes underneath (B♭/C: C, then B♭ D F).
      const slash = p.chord.bass != null && p.chord.bass !== p.chord.root;
      p.chord.tones.forEach((pc) => {
        const m = slash && pc === p.chord.bass ? base - 12 + pc : base + pc;
        ch.push({ tick: startOf(p), order: 1, bytes: [0x91, m, 64] });
        ch.push({ tick: end, order: 0, bytes: [0x81, m, 0] });
      });
    });
    tracks.push(track(ch, 'Chords'));
  }
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...tracks.flat()]);
}
