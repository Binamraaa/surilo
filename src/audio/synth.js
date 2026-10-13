// Tiny Web Audio player: plays detected notes (guitar-ish pluck or soft piano),
// optional backing chords, or the original recording. Calls back with the playing index.

import { midiToHz } from '../core/pitch.js';
import { voiceChord } from '../core/theory.js';

let ctx = null;
const getCtx = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx || ctx.state === 'closed') ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// Everything the synth plays goes through one compressor, so it can be loud
// without clipping when the melody and a chord sound together.
let master = null;
const getMaster = (c) => {
  if (master?.context === c) return master;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const makeup = c.createGain();
  makeup.gain.value = 1.8;
  comp.connect(makeup);
  makeup.connect(c.destination);
  master = comp;
  return master;
};

function voice(c, out, midi, when, dur, { timbre = 'guitar', gain = 0.35, sustain = false } = {}) {
  const hz = midiToHz(midi);
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  const oscs = [];
  if (timbre === 'guitar') {
    // Plucked string: bright attack, filter closes as it decays.
    for (const [type, mult, amp] of [['sawtooth', 1, 0.55], ['triangle', 2, 0.25], ['sine', 1, 0.6]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const og = c.createGain(); og.gain.value = amp; o.connect(og); og.connect(lp); oscs.push(o);
    }
    lp.frequency.setValueAtTime(Math.min(8000, hz * 10), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, hz * 2), when + Math.min(1.2, dur + 0.3));
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.35);
  } else {
    for (const [type, mult, amp] of [['triangle', 1, 0.7], ['sine', 2, 0.18], ['sine', 3, 0.06]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz * mult;
      const og = c.createGain(); og.gain.value = amp; o.connect(og); og.connect(lp); oscs.push(o);
    }
    lp.frequency.value = Math.min(6000, hz * 6);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(gain * 0.5, when + 0.4);
    // Backing chords hold for the whole phrase instead of fading out under it.
    if (sustain && dur > 0.5) g.gain.setValueAtTime(gain * 0.5, when + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.25);
  }
  lp.connect(g); g.connect(out);
  oscs.forEach((o) => { o.start(when); o.stop(when + dur + 0.5); });
  return oscs;
}

let current = null;

export function stopPlayback() {
  if (!current) return;
  current.stop();
  current = null;
}

/**
 * @param {Array<{midi,start,end}>} notes
 * @param {object} o
 * @param {'guitar'|'piano'} o.timbre
 * @param {Array<{chord:{tones:number[]}, start:number, end:number}>} [o.progression]
 * @param {(i:number|null, t:number|null)=>void} o.onTick  playing note index & time in hum-seconds
 */
export function playNotes(notes, { timbre = 'guitar', progression = null, onTick = () => {}, onEnd = () => {} } = {}) {
  stopPlayback();
  if (!notes.length) return;
  const c = getCtx();
  const out = c.createGain();
  out.gain.value = 0.9;
  out.connect(getMaster(c));
  const t0 = c.currentTime + 0.08;
  const offset = notes[0].start;
  const nodes = [];
  notes.forEach((n) => nodes.push(...voice(c, out, n.midi, t0 + n.start - offset, Math.max(0.12, n.end - n.start), { timbre })));
  if (progression) {
    progression.forEach((p, i) => {
      const end = progression[i + 1] ? progression[i + 1].start : p.end;
      // Strum it slightly so it sounds like a played chord, not one buzz.
      voiceChord(p.chord).forEach((m, j) => nodes.push(...voice(
        c, out, m, t0 + p.start - offset + j * 0.02, Math.max(0.3, end - p.start),
        { timbre: 'piano', gain: 0.16, sustain: true },
      )));
    });
  }
  const endAt = t0 + notes[notes.length - 1].end - offset + 0.3;
  let raf = 0;
  const tick = () => {
    const t = c.currentTime - t0 + offset;
    if (c.currentTime > endAt) { finish(); return; }
    const i = notes.findIndex((n) => t >= n.start && t < n.end);
    onTick(i >= 0 ? i : null, t);
    raf = requestAnimationFrame(tick);
  };
  const finish = () => {
    cancelAnimationFrame(raf);
    onTick(null, null);
    onEnd();
    if (current?.id === id) current = null;
  };
  const id = Symbol('play');
  current = {
    id,
    stop() {
      nodes.forEach((o) => { try { o.stop(); } catch { /* not started */ } });
      out.disconnect();
      finish();
    },
  };
  raf = requestAnimationFrame(tick);
}

/** Play a single note or chord immediately (tapping a block or chord chip). */
export function playOnce(midis, timbre = 'guitar') {
  const c = getCtx();
  const out = c.createGain(); out.connect(getMaster(c));
  const t = c.currentTime + 0.02;
  const chord = midis.length > 1;
  midis.forEach((m, i) => voice(c, out, m, t + i * 0.025, chord ? 1.2 : 0.7, { timbre, gain: chord ? 0.2 : 0.35 }));
}

/** Play back the original recording. */
export function playRecording({ samples, sampleRate }, { onTick = () => {}, onEnd = () => {} } = {}) {
  stopPlayback();
  const c = getCtx();
  const buf = c.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  // Laptop mics often record very quietly, so bring the peak up to near full scale.
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const boost = c.createGain();
  boost.gain.value = peak > 0 ? Math.min(30, 0.9 / peak) : 1;
  src.connect(boost);
  boost.connect(c.destination);
  const t0 = c.currentTime + 0.05;
  src.start(t0);
  let raf = 0;
  const id = Symbol('rec');
  const finish = () => { cancelAnimationFrame(raf); onTick(null, null); onEnd(); if (current?.id === id) current = null; };
  const tick = () => { onTick(null, c.currentTime - t0); raf = requestAnimationFrame(tick); };
  src.onended = finish;
  current = { id, stop() { try { src.stop(); } catch { /* ended */ } finish(); } };
  raf = requestAnimationFrame(tick);
}
