// Tempo, time signatures and the beat grid. Pure: no DOM, no Web Audio.
//
// A "beat" here is one grid unit, and one metronome click: a quarter note in
// 4/4 and 3/4, an eighth note in 6/8. In 6/8 the BPM counts the two big beats
// in each bar (dotted quarters), so each of those lasts three units.

export const MIN_BPM = 40;
export const MAX_BPM = 240;

export const SIGNATURES = {
  '4/4': { beats: 4, unit: 'quarter', perCount: 1, accents: [0] },
  '3/4': { beats: 3, unit: 'quarter', perCount: 1, accents: [0] },
  '6/8': { beats: 6, unit: 'eighth', perCount: 3, accents: [0, 3] },
};

const sigOf = (sig) => {
  const s = SIGNATURES[sig];
  if (!s) throw new Error(`unknown time signature ${sig}`);
  return s;
};

export const clampBpm = (bpm) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)));

/** Seconds per grid unit (one click): a quarter in 4/4 and 3/4, an eighth in 6/8. */
export function secondsPerBeat(bpm, sig = '4/4') {
  return 60 / bpm / sigOf(sig).perCount;
}

/** Grid units per bar: 4, 3 or 6. */
export const beatsPerBar = (sig) => sigOf(sig).beats;

/** How strong a click is: 2 = beat 1 of the bar, 1 = a secondary accent (beat 4 in 6/8), 0 = the rest. */
export function accentLevel(beat, sig) {
  const { accents } = sigOf(sig);
  if (beat === 0) return 2;
  return accents.includes(beat) ? 1 : 0;
}

export const TAP_RESET_MS = 2000;
const TAP_WINDOW = 8;

/**
 * Tempo from tap times (ms, e.g. performance.now()). Uses the median gap over
 * the last 8 taps, so one early or late tap doesn't throw it. A pause of more
 * than 2 s starts a new count. Returns null until there are two taps.
 */
export function tapTempo(timestamps) {
  let from = 0;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > TAP_RESET_MS) from = i;
  }
  const taps = timestamps.slice(Math.max(from, timestamps.length - TAP_WINDOW));
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const gap = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return clampBpm(60000 / gap);
}
