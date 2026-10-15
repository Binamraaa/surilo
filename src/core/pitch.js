// Pitch detection for monophonic sources (humming, singing, whistling).
// Pure functions, no DOM or Web Audio — runs in the browser, Node, or a worker.

/**
 * Root-mean-square level of a frame. Used as a cheap loudness gate.
 * @param {Float32Array} frame
 */
export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Halve the sample rate by averaging sample pairs. Humming rarely goes above
 * ~1 kHz, so this keeps everything we need and makes YIN ~4x cheaper.
 */
export function downsample2(frame) {
  const out = new Float32Array(frame.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (frame[2 * i] + frame[2 * i + 1]);
  return out;
}

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 *
 * @param {Float32Array} frame   audio samples, ideally 40–60 ms long
 * @param {number} sampleRate
 * @param {object} [opts]
 * @param {number} [opts.minHz=65]       lowest pitch to look for (C2)
 * @param {number} [opts.maxHz=1050]     highest pitch to look for (C6)
 * @param {number} [opts.threshold=0.15] YIN absolute threshold
 * @returns {{hz:number, clarity:number} | null}
 *   clarity is 1 − the normalised difference at the chosen lag (1 = perfectly periodic).
 */
export function yin(frame, sampleRate, opts = {}) {
  const { minHz = 65, maxHz = 1050, threshold = 0.15 } = opts;
  const c = cmndOf(frame, sampleRate, minHz, maxHz);
  if (!c) return null;
  const { cmnd, tauMin, tauMax } = c;

  // Step 4: first dip below threshold, then walk to its local minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  // No dip under threshold: fall back to the global minimum if it is still decent.
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.35) return null;
    tau = best;
  }

  const hz = sampleRate / refine(cmnd, tau, tauMax);
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

/** YIN steps 2–3: the cumulative mean normalised difference for each lag. */
function cmndOf(frame, sampleRate, minHz, maxHz) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), frame.length >> 1);
  if (tauMax <= tauMin + 2) return null;

  const W = frame.length - tauMax;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const delta = frame[i] - frame[i + tau];
      s += delta * delta;
    }
    running += s;
    cmnd[tau] = running > 0 ? (s * tau) / running : 1;
  }
  return { cmnd, tauMin, tauMax };
}

/** Step 5: parabolic interpolation for sub-sample accuracy. */
function refine(cmnd, tau, tauMax) {
  if (tau <= 1 || tau >= tauMax) return tau;
  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
  const denom = a + c - 2 * b;
  return denom !== 0 ? tau + (a - c) / (2 * denom) : tau;
}

// pYIN (Mauch & Dixon, 2014): instead of one fixed threshold, try many, weighted
// by a Beta(2, 11.3) prior (mean 0.15, our fixed threshold). Each dip's chance is
// how often it would be YIN's answer. A voice with a weak fundamental gives an
// octave-up dip some of the chance and the true one the rest, so neither is lost.
const THRESHOLDS = (() => {
  const a = 2, b = 11.33;
  const s = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
  const w = s.map((x) => x ** (a - 1) * (1 - x) ** (b - 1));
  const sum = w.reduce((p, q) => p + q, 0);
  return s.map((x, i) => [x, w[i] / sum]);
})();

/**
 * Every pitch YIN could have picked in this frame, with its chance.
 * @returns {Array<{hz:number, cmnd:number, p:number}>} most likely first
 */
export function yinCandidates(frame, sampleRate, opts = {}) {
  const { minHz = 65, maxHz = 1050, octaveRatio = 0.4 } = opts;
  const c = cmndOf(frame, sampleRate, minHz, maxHz);
  if (!c) return [];
  const { cmnd, tauMin, tauMax } = c;
  const dips = [];
  for (let t = tauMin + 1; t < tauMax; t++) if (cmnd[t] < cmnd[t - 1] && cmnd[t] <= cmnd[t + 1]) dips.push(t);
  if (!dips.length) return [];
  let deepest = dips[0];
  for (const t of dips) if (cmnd[t] < cmnd[deepest]) deepest = t;
  const p = new Map();
  for (const [s, w] of THRESHOLDS) {
    const first = dips.find((t) => cmnd[t] < s);
    // No dip under this threshold: the deepest one gets a sliver (as in pYIN).
    const t = first ?? deepest;
    p.set(t, (p.get(t) ?? 0) + (first == null ? w * 0.01 : w));
  }
  // Octave-up check. When the dip at twice the lag is far deeper (a match many
  // times better), the wave only nearly repeats at this lag: the fundamental is
  // weak, and the real note is an octave lower. Move most of the chance there.
  // On a real note the dip at twice the lag is at most about twice as good.
  if (octaveRatio > 0) {
    for (const [t, q] of [...p]) {
      const t2 = dips.find((u) => Math.abs(u - 2 * t) <= 2);
      if (t2 == null || cmnd[t] <= 0) continue;
      const keep = Math.min(1, cmnd[t2] / cmnd[t] / octaveRatio) ** 2;
      if (keep >= 1) continue;
      p.set(t, q * keep);
      p.set(t2, (p.get(t2) ?? 0) + q * (1 - keep));
    }
  }
  return [...p]
    .map(([t, q]) => ({ hz: sampleRate / refine(cmnd, t, tauMax), cmnd: cmnd[t], p: q }))
    .filter((x) => x.hz >= minHz && x.hz <= maxHz && x.p > 1e-4)
    .sort((x, y) => y.p - x.p);
}

/**
 * Pick one pitch per frame from each frame's candidates so the line through
 * them is smooth (Viterbi). A jump costs as much as several frames of a
 * likelier pitch, so a brief octave flip inside a note is ignored, while a real
 * leap to a new note is taken once the new note lasts a moment.
 * @param {Array<Array<{midi:number, p:number}>|null>} cands  per frame; null = silent
 * @returns {number[]} the chosen candidate's index per frame (-1 when silent)
 */
export function trackPitch(cands, { jumpCost = 10, octaveCost = 0, dropCost = 3, maxGap = 6 } = {}) {
  const out = new Array(cands.length).fill(-1);
  // Jumps of an octave, an octave and a fifth, or two octaves are what detector
  // errors look like (the 2nd, 3rd or 4th harmonic), so they cost extra.
  const octaveish = (d) => [12, 19, 24].some((k) => Math.abs(d - k) < 1);
  const step = (a, b) => {
    const d = Math.abs(a - b);
    return d < 1 ? d : jumpCost + 0.1 * d + (octaveish(d) ? octaveCost : 0);
  };
  let run = []; // frame indices in the current voiced stretch
  let gap = 0;
  // Each frame's states: its candidates, plus "no pitch here" (the last state),
  // which costs dropCost and remembers the pitch before it. A fading voice often
  // loses its real pitch for the last few frames: better to drop them than to
  // follow an octave-down shadow.
  const solve = () => {
    if (!run.length) return;
    const first = cands[run[0]];
    let prev = [...first.map((c) => ({ cost: -Math.log(c.p), midi: c.midi })), { cost: dropCost, midi: first[0].midi }];
    const back = [];
    for (let k = 1; k < run.length; k++) {
      const B = cands[run[k]];
      const from = [...B.map((b) => {
        let best = 0, cost = Infinity;
        prev.forEach((a, j) => { const x = a.cost + step(a.midi, b.midi); if (x < cost) { cost = x; best = j; } });
        return { best, cost: cost - Math.log(b.p), midi: b.midi };
      })];
      let best = 0;
      prev.forEach((a, j) => { if (a.cost < prev[best].cost) best = j; });
      from.push({ best, cost: prev[best].cost + dropCost, midi: prev[best].midi });
      back.push(from.map((f) => f.best));
      prev = from;
    }
    let j = 0;
    prev.forEach((a, i) => { if (a.cost < prev[j].cost) j = i; });
    for (let k = run.length - 1; k >= 0; k--) {
      out[run[k]] = j < cands[run[k]].length ? j : -1;
      if (k) j = back[k - 1][j];
    }
    run = [];
  };
  cands.forEach((c, i) => {
    if (c?.length) { run.push(i); gap = 0; } else if (++gap > maxGap) solve();
  });
  solve();
  return out;
}

/**
 * Analyse one frame: loudness gate + YIN. Returns a frame record the note
 * segmenter understands. `midi` is a float (e.g. 64.3 = E4, 30 cents sharp)
 * or null when the frame is silent / breathy / unpitched.
 */
export function analyseFrame(frame, sampleRate, t, opts = {}) {
  const { gate = 0.01, minClarity = 0.65 } = opts;
  const level = rms(frame);
  if (level < gate) return { t, midi: null, level, clarity: 0 };
  const small = sampleRate > 30000 ? downsample2(frame) : frame;
  const sr = sampleRate > 30000 ? sampleRate / 2 : sampleRate;
  const p = yin(small, sr, opts);
  if (!p || p.clarity < minClarity) return { t, midi: null, level, clarity: p ? p.clarity : 0 };
  return { t, midi: hzToMidi(p.hz), hz: p.hz, level, clarity: p.clarity };
}

/**
 * Run the detector over a whole buffer (e.g. a decoded audio file). Unlike the
 * live view, which must answer frame by frame, this sees the whole hum: it keeps
 * every candidate pitch per frame and picks a smooth line through them
 * (trackPitch), which stops notes flipping an octave. `track: false` = plain YIN.
 * @returns {Array<{t:number, midi:number|null}>} one record per hop
 */
export function analyseBuffer(samples, sampleRate, opts = {}) {
  const frameSize = opts.frameSize ?? nextPow2(sampleRate * 0.046);
  const hop = opts.hop ?? Math.round(sampleRate * 0.0116);
  // Adapt the loudness gate to the recording: phones vary a lot in input gain.
  const gate = opts.gate ?? adaptiveGate(samples, frameSize, hop);
  const frames = [];
  if (opts.track === false) {
    for (let start = 0; start + frameSize <= samples.length; start += hop) {
      const frame = samples.subarray(start, start + frameSize);
      frames.push(analyseFrame(frame, sampleRate, (start + frameSize / 2) / sampleRate, { ...opts, gate }));
    }
    return frames;
  }
  const { minClarity = 0.65 } = opts;
  const half = sampleRate > 30000;
  const sr = half ? sampleRate / 2 : sampleRate;
  const cands = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);
    const level = rms(frame);
    frames.push({ t: (start + frameSize / 2) / sampleRate, midi: null, level, clarity: 0 });
    const c = level < gate ? [] : yinCandidates(half ? downsample2(frame) : frame, sr, opts);
    cands.push(c.length ? c.map((x) => ({ ...x, midi: hzToMidi(x.hz) })) : null);
  }
  // A hum stays within a fairly narrow range. When a frame could be either of
  // two pitches an octave apart, lean towards the one nearer the middle of this
  // hum. A pitch with no rival is unaffected (the chances are relative).
  const { rangeSemis = 9, rangeWeight = 0.5 } = opts;
  const tops = cands.filter(Boolean).map((c) => c[0].midi).sort((a, b) => a - b);
  if (tops.length && rangeWeight > 0) {
    const centre = tops[tops.length >> 1];
    for (const c of cands) if (c) for (const x of c) x.p *= Math.exp(-rangeWeight * Math.max(0, Math.abs(x.midi - centre) - rangeSemis));
  }
  const pick = trackPitch(cands, opts);
  frames.forEach((f, i) => {
    const c = pick[i] >= 0 && cands[i][pick[i]];
    if (!c) return;
    f.clarity = Math.max(0, Math.min(1, 1 - c.cmnd));
    if (f.clarity >= minClarity) { f.midi = c.midi; f.hz = c.hz; }
  });
  return frames;
}

/**
 * Loudness gate that adapts to the recording. Laptop and phone mics differ by
 * 40 dB or more in level, so nothing here is an absolute volume: the gate sits
 * between the room's noise floor and the loud end of the hum.
 */
export function adaptiveGate(samples, frameSize, hop) {
  const levels = [];
  for (let s = 0; s + frameSize <= samples.length; s += hop * 2) levels.push(rms(samples.subarray(s, s + frameSize)));
  if (!levels.length) return 1e-4;
  levels.sort((a, b) => a - b);
  const noise = levels[Math.floor(levels.length * 0.1)];
  const loud = levels[Math.floor(levels.length * 0.95)];
  return Math.max(1e-4, Math.min(loud * 0.25, Math.max(noise * 2, loud * 0.08)));
}

/** Level statistics for diagnostics ("is the mic even hearing anything?"). */
export function levelStats(samples, sampleRate) {
  const n = Math.round(sampleRate * 0.03);
  const levels = [];
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  for (let s = 0; s + n <= samples.length; s += n) levels.push(rms(samples.subarray(s, s + n)));
  levels.sort((a, b) => a - b);
  const q = (p) => (levels.length ? levels[Math.floor((levels.length - 1) * p)] : 0);
  return { peak, noise: q(0.1), loud: q(0.95) };
}

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const nextPow2 = (n) => 1 << Math.ceil(Math.log2(n));
