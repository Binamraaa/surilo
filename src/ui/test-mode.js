// Test mode: save a real hum, with the notes you fixed by hand as its answer
// key, so scripts/real-hums.mjs can grade the app on real voices.
//
// Open the app with ?test=1 to turn it on (remembered on this device, so an
// installed app keeps it), ?test=0 to turn it off. On phones the file goes to
// the share sheet (save it to Drive); elsewhere it downloads.

import { encodeWav } from '../core/wav.js';

const KEY = 'hum-to-notes.test';
export const TEST_FORMAT = 'hum-to-notes-test';

export function testModeOn() {
  const q = new URLSearchParams(location.search).get('test');
  try {
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return q === '1'; // storage blocked: only for this visit
  }
}

export function turnOffTestMode() {
  try { localStorage.removeItem(KEY); } catch { /* nothing remembered */ }
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 40);
const pad = (n) => String(n).padStart(2, '0');
const ms = (t) => Math.round(t * 1000) / 1000;

/**
 * One WAV file holding the hum and, inside it, the answer key.
 * @param {object} o
 * @param {string} o.song
 * @param {{samples: Float32Array, sampleRate: number}} o.recording
 * @param {Array} o.original   notes as the app detected them
 * @param {Array} o.corrected  notes after your fixes (the answer key)
 */
export function testHumFile({ song, recording, original, corrected, tuning, trust, source, mic, tempo }) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const meta = {
    format: TEST_FORMAT,
    version: 1,
    song,
    savedAt: now.toISOString(),
    source,                       // 'mic' or 'upload'
    mic: mic || null,
    device: navigator.userAgent,
    sampleRate: recording.sampleRate,
    duration: ms(recording.samples.length / recording.sampleRate),
    tuning: Math.round(tuning * 1000) / 1000,
    trust,
    tempo: tempo || null,         // {bpm, sig} if the metronome was running while you hummed
    edits: corrected.filter((n) => n.edited).length,
    detected: original.map((n) => ({
      midi: n.midi, start: ms(n.start), end: ms(n.end), cents: n.cents,
      ...(n.adjusted && { adjusted: true, nearest: n.nearest }),
    })),
    corrected: corrected.map((n) => ({ midi: n.midi, start: ms(n.start), end: ms(n.end) })),
  };
  const bytes = encodeWav(recording.samples, recording.sampleRate, meta);
  return new File([bytes], `${slug(song) || 'hum'}-${stamp}.wav`, { type: 'audio/wav' });
}

/** Phones: the share sheet (→ Drive). Elsewhere, or if sharing isn't possible: a download. */
export async function shareOrDownload(file) {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Anything else (no permission, too big…): fall back to a download.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}
