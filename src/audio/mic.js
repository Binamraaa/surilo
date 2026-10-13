// Live microphone capture → per-frame pitch, plus the raw recording for later.

import { analyseFrame, rms } from '../core/pitch.js';

/**
 * Start listening. `onFrame({t, midi, hz, level, clarity})` fires ~45×/s.
 * Returns a handle with stop() → {samples, sampleRate}.
 */
export async function startMic(onFrame) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-mic-api');
  const stream = await navigator.mediaDevices.getUserMedia({
    // Browser "voice" processing smears pitch; turn it off for cleaner tracking.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  await ctx.resume();
  const sr = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(stream);
  const hop = 1024;
  const frameSize = sr > 30000 ? 2048 : 1024;
  // ScriptProcessor is deprecated but works everywhere (incl. sandboxed pages where
  // AudioWorklet modules can't load). Its 1024-sample callback is our hop.
  const proc = ctx.createScriptProcessor(hop, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);

  const chunks = [];
  let total = 0;
  const ring = new Float32Array(frameSize);
  // Rolling loudness gate: sits between the room's noise and the loud end of the
  // last few seconds, so it works for quiet laptop mics and loud phone mics alike,
  // and doesn't break if you start humming the instant you press the button.
  const recent = [];
  let gate = 1e-4;
  let n = 0;

  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input);
    chunks.push(copy);
    total += copy.length;
    ring.copyWithin(0, copy.length);
    ring.set(copy, frameSize - copy.length);
    const t = total / sr;
    const level = rms(copy);
    recent.push(level);
    if (recent.length > 150) recent.shift();
    if (n++ % 8 === 0 && recent.length >= 8) {
      const sorted = [...recent].sort((a, b) => a - b);
      const noise = sorted[Math.floor(sorted.length * 0.1)];
      const loud = sorted[Math.floor(sorted.length * 0.95)];
      gate = Math.max(1e-4, Math.min(loud * 0.25, Math.max(noise * 2, loud * 0.08)));
    }
    onFrame({ ...analyseFrame(ring, sr, t - frameSize / 2 / sr, { gate }), input: level });
  };

  const track = stream.getAudioTracks()[0];
  return {
    sampleRate: sr,
    label: track?.label || 'default microphone',
    stop() {
      proc.onaudioprocess = null;
      try { src.disconnect(); proc.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((tr) => tr.stop());
      ctx.close();
      const samples = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { samples.set(c, o); o += c.length; }
      return { samples, sampleRate: sr };
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
