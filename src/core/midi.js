// Minimal Standard MIDI File (format 1) writer — the bridge to a DAW (e.g. Reaper).
// Melody on track 1, optional chords on track 2. Time is kept in real seconds at 120 BPM.

const PPQ = 480;
const BPM = 120;
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

/**
 * @param {Array<{midi,start,end}>} notes
 * @param {Array<{chord:{tones:number[]},start,end}>} [progression]
 * @returns {Uint8Array} .mid file bytes
 */
export function toMidiFile(notes, progression = []) {
  const offset = notes.length ? notes[0].start : 0;
  const tempo = Math.round(60000000 / BPM);
  const conductor = track([{ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] }], 'Hum to Notes');

  const mel = [];
  notes.forEach((n) => {
    mel.push({ tick: ticks(n.start - offset), order: 1, bytes: [0x90, n.midi, 96] });
    mel.push({ tick: ticks(n.end - offset), order: 0, bytes: [0x80, n.midi, 0] });
  });
  const tracks = [conductor, track(mel, 'Melody')];

  if (progression.length) {
    const ch = [];
    const lowest = Math.min(...notes.map((n) => n.midi));
    const base = Math.floor((lowest - 7) / 12) * 12;
    progression.forEach((p, i) => {
      const end = progression[i + 1] ? progression[i + 1].start : p.end;
      p.chord.tones.forEach((pc) => {
        const m = base + pc;
        ch.push({ tick: ticks(p.start - offset), order: 1, bytes: [0x91, m, 64] });
        ch.push({ tick: ticks(end - offset), order: 0, bytes: [0x81, m, 0] });
      });
    });
    tracks.push(track(ch, 'Chords'));
  }
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...tracks.flat()]);
}
