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
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), frame.length >> 1);
  if (tauMax <= tauMin + 2) return null;

  const W = frame.length - tauMax;
  const d = new Float32Array(tauMax + 1);

  // Step 2: difference function
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const delta = frame[i] - frame[i + tau];
      s += delta * delta;
    }
    d[tau] = s;
  }

  // Step 3: cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

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

  // Step 5: parabolic interpolation for sub-sample accuracy
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a + c - 2 * b;
    if (denom !== 0) betterTau = tau + (a - c) / (2 * denom);
  }

  const hz = sampleRate / betterTau;
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
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
 * Run the detector over a whole buffer (e.g. a decoded audio file).
 * @returns {Array<{t:number, midi:number|null}>} one record per hop
 */
export function analyseBuffer(samples, sampleRate, opts = {}) {
  const frameSize = opts.frameSize ?? nextPow2(sampleRate * 0.046);
  const hop = opts.hop ?? Math.round(sampleRate * 0.0116);
  // Adapt the loudness gate to the recording: phones vary a lot in input gain.
  const gate = opts.gate ?? adaptiveGate(samples, frameSize, hop);
  const frames = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);
    frames.push(analyseFrame(frame, sampleRate, (start + frameSize / 2) / sampleRate, { ...opts, gate }));
  }
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
