// Turn a wobbly stream of pitch frames into a clean list of notes.
// Pure functions — this is the module meant to be reused (e.g. hum → MIDI → Reaper).

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "E4", "Bb3"… Middle C = C4 = MIDI 60. */
export function midiToName(midi, { flats = false, octave = true } = {}) {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const name = (flats ? FLAT_NAMES : SHARP_NAMES)[pc];
  return octave ? name + (Math.floor(m / 12) - 1) : name;
}

/** Cents away from the nearest equal-tempered note, −50…+50. */
export const centsOff = (midi) => Math.round((midi - Math.round(midi)) * 100);

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
};

/**
 * Median-smooth the voiced frames to kill single-frame octave errors and jitter.
 * Unvoiced frames stay null.
 */
export function smoothFrames(frames, radius = 2) {
  return frames.map((f, i) => {
    if (f.midi == null) return f;
    const win = [];
    for (let j = i - radius; j <= i + radius; j++) {
      const g = frames[j];
      if (g && g.midi != null) win.push(g.midi);
    }
    return { ...f, midi: median(win) };
  });
}

/**
 * Most hummers are consistently a little sharp or flat. Estimate that offset
 * (in semitones, −0.5…+0.5) as the circular mean of each frame's distance from
 * the nearest note, so the whole melody can be snapped relative to the voice.
 */
export function estimateTuningOffset(frames, minCount = 5) {
  let x = 0, y = 0, n = 0;
  for (const f of frames) {
    if (f.midi == null) continue;
    const a = 2 * Math.PI * (f.midi - Math.round(f.midi));
    x += Math.cos(a); y += Math.sin(a); n++;
  }
  if (n < minCount) return 0;
  // Only trust it when the deviations agree with each other.
  const R = Math.hypot(x, y) / n;
  if (R < 0.3) return 0;
  return Math.atan2(y, x) / (2 * Math.PI);
}

/**
 * Segment frames into notes.
 *
 * @param {Array<{t:number, midi:number|null}>} frames  evenly spaced in time
 * @param {object} [opts]
 * @param {number} [opts.minNoteMs=90]    drop blips shorter than this
 * @param {number} [opts.maxGapMs=70]     an unvoiced gap longer than this ends a note
 * @param {number} [opts.changeSemis=0.6] how far the pitch must move to count as a new note
 * @param {number} [opts.changeMs=80]     …and for how long (rides through vibrato & scoops)
 * @param {number} [opts.mergeGapMs=0]    join same-pitch notes split by a dropout shorter than this
 * @param {number} [opts.dipRatio=0.45]   a loudness dip below this × the note's peak…
 * @param {number} [opts.riseRatio=0.75]  …followed by a rise above this re-articulates (repeated notes: "mm-mm")
 * @param {boolean} [opts.autoTune=true]  snap relative to the singer's own tuning
 * @returns {{notes: Array<{midi:number, start:number, end:number, cents:number, pitch:number}>, tuning:number}}
 *   midi = snapped integer note; pitch = raw median pitch; cents = how far off the hum was.
 */
export function framesToNotes(frames, opts = {}) {
  const {
    minNoteMs = 90, maxGapMs = 70, changeSemis = 0.6, changeMs = 80,
    mergeGapMs = 0, autoTune = true, smoothRadius = 2, dipRatio = 0.45, riseRatio = 0.75,
  } = opts;
  if (frames.length < 2) return { notes: [], tuning: 0 };

  const hop = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) || 0.0116;
  const maxGap = Math.max(1, Math.round(maxGapMs / 1000 / hop));
  const changeRun = Math.max(2, Math.round(changeMs / 1000 / hop));

  const sm = smoothFrames(frames, smoothRadius);

  const segments = [];
  let cur = null;      // { frames: [...] }
  let gap = 0;
  let pending = [];    // frames that disagree with the current note
  let peak = 0;        // loudest level in the current note
  let dip = false;     // has the level dropped since the peak?
  const minFrames = Math.max(2, Math.round(minNoteMs / 1000 / hop));

  const close = () => {
    if (cur && cur.frames.length) segments.push(cur.frames);
    cur = null; pending = []; gap = 0; peak = 0; dip = false;
  };
  const start = (fs) => { cur = { frames: fs }; peak = Math.max(...fs.map((x) => x.level ?? 0)); dip = false; };
  // Median over a long window (~0.7 s) so the centre doesn't chase vibrato.
  const centre = (seg) => median(seg.frames.slice(-60).map((f) => f.midi));

  for (const f of sm) {
    const level = f.level ?? 0;
    if (cur && level < peak * dipRatio) dip = true;
    if (f.midi == null) {
      gap++;
      if (gap > maxGap) close();
      continue;
    }
    gap = 0;
    if (!cur) { start([f]); continue; }

    // Re-articulation: same pitch, but the voice dipped and came back ("da-da").
    if (dip && level >= peak * riseRatio && cur.frames.length >= minFrames) {
      if (pending.length) cur.frames.push(...pending);
      segments.push(cur.frames);
      start([f]);
      continue;
    }
    if (!dip) peak = Math.max(peak, level);

    if (Math.abs(f.midi - centre(cur)) < changeSemis) {
      // Back on the note: a short excursion was just vibrato or a scoop.
      if (pending.length) { cur.frames.push(...pending); pending = []; }
      cur.frames.push(f);
    } else {
      // A run of disagreeing frames must itself be stable to start a new note.
      if (pending.length && Math.abs(f.midi - median(pending.map((p) => p.midi))) >= changeSemis) pending = [];
      pending.push(f);
      if (pending.length >= changeRun) {
        segments.push(cur.frames);
        start(pending);
        pending = [];
      }
    }
  }
  if (cur) { if (pending.length) cur.frames.push(...pending); close(); }

  // Ignore the attack (first ~25%) when deciding pitch: hums often scoop up into a note.
  const raw = segments
    .map((seg) => {
      const body = seg.length > 6 ? seg.slice(Math.floor(seg.length * 0.25)) : seg;
      return { pitch: median(body.map((f) => f.midi)), start: seg[0].t - hop / 2, end: seg[seg.length - 1].t + hop / 2 };
    })
    .filter((n) => (n.end - n.start) * 1000 >= minNoteMs);

  // Estimate the singer's tuning from note centres (stable) rather than raw frames (vibrato).
  const tuning = autoTune ? estimateTuningOffset(raw.map((n) => ({ midi: n.pitch })), 3) : 0;

  const notes = raw
    .map((n) => {
      const midi = Math.round(n.pitch - tuning);
      return { midi, pitch: n.pitch, cents: Math.round((n.pitch - tuning - midi) * 100), start: n.start, end: n.end };
    });

  // Merge same-pitch neighbours separated by a dropout.
  const merged = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (mergeGapMs > 0 && prev && prev.midi === n.midi && (n.start - prev.end) * 1000 <= mergeGapMs) {
      prev.end = n.end;
    } else merged.push({ ...n });
  }
  return { notes: merged, tuning };
}

/**
 * Shift notes by whole octaves so they sit in a target range (e.g. a low male hum
 * shown in guitar range, or centred around middle C for piano).
 */
export function fitOctave(notes, { low, high }) {
  if (!notes.length) return { notes, shift: 0 };
  const mid = median(notes.map((n) => n.midi));
  const target = (low + high) / 2;
  const shift = 12 * Math.round((target - mid) / 12);
  return { notes: notes.map((n) => ({ ...n, midi: n.midi + shift })), shift };
}
