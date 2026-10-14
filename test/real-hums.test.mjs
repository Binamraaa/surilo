import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, decodeWav } from '../src/core/wav.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { transcribe } from '../src/core/intent.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';
import { compareNotes } from '../scripts/score.mjs';

test('WAV: 16-bit round trip keeps the audio and the answer key', () => {
  const sr = 48000;
  const samples = Float32Array.from({ length: 4801 }, (_, i) => 0.8 * Math.sin(i / 7));
  samples[10] = 1.5; samples[11] = -1.5; // clipped, not wrapped
  const meta = { format: 'hum-to-notes-test', song: 'Für Elise ♪', corrected: [{ midi: 64, start: 0, end: 0.1 }] };
  const bytes = encodeWav(samples, sr, meta); // odd-length JSON exercises the chunk padding
  const back = decodeWav(bytes);
  assert.equal(back.sampleRate, sr);
  assert.equal(back.samples.length, samples.length);
  for (let i = 0; i < samples.length; i++) {
    assert.ok(Math.abs(back.samples[i] - Math.max(-1, Math.min(1, samples[i]))) < 1 / 16000, `sample ${i}`);
  }
  assert.deepEqual(back.meta, meta);
  assert.equal(decodeWav(encodeWav(samples, sr)).meta, null);
  // The RIFF size covers the whole file, so strict players accept it.
  assert.equal(new DataView(bytes.buffer).getUint32(4, true), bytes.length - 8);
});

/** A WAV like a phone recorder writes: extra chunks before the audio, any encoding. */
function rawWav({ format, bits, channels, sr, frames, value }) {
  const width = bits / 8;
  const data = frames * channels * width;
  const list = 'INFOISFT\x06\x00\x00\x00phone\x00'; // a LIST chunk to skip
  const size = 12 + 24 + 8 + list.length + 8 + data;
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  let at = 0;
  const text = (s) => { for (const c of s) b[at++] = c.charCodeAt(0); };
  text('RIFF'); v.setUint32(at, size - 8, true); at += 4; text('WAVE');
  text('fmt '); v.setUint32(at, 16, true); at += 4;
  v.setUint16(at, format, true); v.setUint16(at + 2, channels, true); v.setUint32(at + 4, sr, true);
  v.setUint32(at + 8, sr * channels * width, true); v.setUint16(at + 12, channels * width, true); v.setUint16(at + 14, bits, true); at += 16;
  text('LIST'); v.setUint32(at, list.length, true); at += 4; text(list);
  text('data'); v.setUint32(at, data, true); at += 4;
  for (let i = 0; i < frames * channels; i++, at += width) {
    const x = value(i % channels);
    if (format === 3) v.setFloat32(at, x, true);
    else if (bits === 24) { const n = Math.round(x * 0x7fffff); b[at] = n & 255; b[at + 1] = (n >> 8) & 255; b[at + 2] = (n >> 16) & 255; }
    else if (bits === 32) v.setInt32(at, Math.round(x * 0x7fffffff), true);
  }
  return b;
}

test('WAV: reads 24-bit, 32-bit and float files, mixes stereo to mono, skips unknown chunks', () => {
  for (const [format, bits] of [[1, 24], [1, 32], [3, 32]]) {
    const { samples, sampleRate, meta } = decodeWav(rawWav({ format, bits, channels: 2, sr: 44100, frames: 10, value: (ch) => (ch ? -0.25 : 0.75) }));
    assert.equal(sampleRate, 44100);
    assert.equal(samples.length, 10);
    assert.equal(meta, null);
    for (const s of samples) assert.ok(Math.abs(s - 0.25) < 1e-4, `${format}/${bits}: ${s}`);
  }
  assert.throws(() => decodeWav(new Uint8Array(20)), /not a WAV/);
});

const n = (midi, start, end) => ({ midi, start, end });

test('scoring: names each kind of mistake', () => {
  const ref = [n(60, 0, 0.5), n(62, 0.5, 1), n(64, 1, 1.5), n(65, 1.5, 2), n(67, 2, 2.5), n(69, 2.5, 3), n(71, 3, 3.5), n(72, 3.5, 4), n(74, 4, 4.5)];
  const got = [
    n(60, 0.02, 0.48),                     // correct
    n(63, 0.52, 0.98),                     // semitone
    n(52, 1.0, 1.5),                       // octave
    n(70, 1.5, 2.0),                       // wrong (5 semitones)
    n(67, 2.0, 2.2), n(67, 2.25, 2.5),     // split
    n(69, 2.5, 3.45),                      // 69 and 71 sung as one: merged
    //                                        72: missing
    n(74, 4.02, 4.5),                      // correct
    n(50, 5, 5.3),                         // extra
  ];
  const r = compareNotes(ref, got);
  assert.deepEqual(r.outcomes.map((o) => o.kind), ['correct', 'semitone', 'octave', 'wrong', 'split', 'correct', 'merged', 'missing', 'correct']);
  assert.equal(r.right, 3);
  assert.equal(r.extra.length, 1);
  assert.equal(r.exact, false);
  assert.equal(r.counts.split, 1);
});

test('scoring: a hum a semitone off throughout counts as right "in some key"', () => {
  const ref = [n(60, 0, 0.5), n(62, 0.5, 1), n(64, 1, 1.5)];
  const flat = ref.map((x) => ({ ...x, midi: x.midi - 1 }));
  const r = compareNotes(ref, flat);
  assert.equal(r.right, 0);
  assert.equal(r.anyKey, true);
  assert.equal(compareNotes(ref, ref).exact, true);
  assert.equal(compareNotes(ref, [...ref, n(70, 2, 2.4)]).exact, false, 'an extra note spoils an exact hum');
});

test('end to end: a hum saved as a test file is graded exactly right', () => {
  const { samples, sampleRate, truth } = synthHum(DEMO_MELODIES['Twinkle Twinkle']);
  const file = encodeWav(samples, sampleRate, { format: 'hum-to-notes-test', corrected: truth });
  const wav = decodeWav(file);
  const { notes } = transcribe(analyseBuffer(wav.samples, wav.sampleRate));
  const r = compareNotes(wav.meta.corrected, notes);
  assert.equal(r.exact, true, JSON.stringify(r.counts));
});
