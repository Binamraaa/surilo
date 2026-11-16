// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// Live microphone capture → per-frame pitch, plus the raw recording for later.

import { rms, createPitchStream } from '../core/pitch.js';

// The audio is captured on the audio thread (an AudioWorklet), so a busy page can
// never drop part of the hum, and handed over in small blocks (about 10 ms), so
// the pitch line follows the voice closely. The module is inlined as a Blob: no
// extra file to serve, and it survives the single-file build.
const BLOCK = 512;
const WORKLET = `
class SuriloCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${BLOCK}); this.n = 0; this.first = true; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.first) { this.first = false; this.port.postMessage({ startedAt: currentTime }); }
    let i = 0;
    while (i < ch.length) {
      const k = Math.min(ch.length - i, this.buf.length - this.n);
      this.buf.set(ch.subarray(i, i + k), this.n);
      this.n += k; i += k;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('surilo-capture', SuriloCapture);`;

const loaded = new WeakMap(); // AudioContext → promise that the capture module is in
function captureNode(ctx) {
  if (!ctx.audioWorklet || typeof AudioWorkletNode !== 'function') return Promise.reject(new Error('no-worklet'));
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    loaded.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
  }
  return loaded.get(ctx).then(() => new AudioWorkletNode(ctx, 'surilo-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 }));
}

/**
 * Start listening. `onFrame({t, midi, hz, level, clarity, input})` fires for every
 * analysis frame (about 86 a second). Pass the app's AudioContext as `ctx` to share
 * its clock with the metronome: `startedAt` is then the context time of the
 * recording's first sample, so a hum can be lined up with the clicks.
 * Returns a handle with stop() → {samples, sampleRate, frames}: `frames` is the
 * finished pitch analysis of the whole take (see createPitchStream), ready at once
 * because it was worked out while you hummed.
 */
export async function startMic(onFrame, { ctx: shared = null } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-mic-api');
  const stream = await navigator.mediaDevices.getUserMedia({
    // Browser "voice" processing smears pitch; turn it off for cleaner tracking.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = shared || new AC();
  await ctx.resume();
  const sr = ctx.sampleRate;
  let startedAt = null;
  const src = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const chunks = [];
  let total = 0;
  let live = true;
  const pitch = createPitchStream(sr);
  const take = (chunk) => {
    if (!live) return;
    chunks.push(chunk);
    total += chunk.length;
    const input = rms(chunk);
    for (const f of pitch.push(chunk)) onFrame({ ...f, input });
  };

  let node;
  try {
    node = await captureNode(ctx);
    node.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) take(e.data);
      else if (startedAt == null && e.data?.startedAt != null) startedAt = e.data.startedAt;
    };
  } catch {
    // Older browsers, and sandboxed pages where worklet modules can't load: the
    // deprecated ScriptProcessor, which runs on the page's own thread.
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => {
      const copy = new Float32Array(e.inputBuffer.getChannelData(0));
      // This buffer has just filled, so its first sample is one buffer back from now.
      if (startedAt == null) startedAt = ctx.currentTime - copy.length / sr;
      take(copy);
    };
  }
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);

  const track = stream.getAudioTracks()[0];
  return {
    sampleRate: sr,
    label: track?.label || 'default microphone',
    /** Context time of the first recorded sample (null until audio arrives). */
    get startedAt() { return startedAt; },
    stop() {
      live = false;
      if (node.port) node.port.onmessage = null; else node.onaudioprocess = null;
      try { src.disconnect(); node.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((tr) => tr.stop());
      if (!shared) ctx.close();
      try { mute.disconnect(); } catch { /* already gone */ }
      const samples = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { samples.set(c, o); o += c.length; }
      return { samples, sampleRate: sr, frames: pitch.finish() };
    },
  };
}

/** Decode an uploaded audio file (voice memo, .wav, .m4a, .mp3…) to mono samples. */
export async function decodeFile(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    return { samples: mono, sampleRate: buf.sampleRate };
  } finally {
    ctx.close();
  }
}
