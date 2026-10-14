// WAV files: write the hum as 16-bit PCM mono (at its own sample rate, so the
// pitch analysis of the file matches what the app did), and read PCM or float
// WAVs back. Pure: runs in the browser and in Node.
//
// A test hum carries its answer key inside the file, as JSON in an extra "json"
// chunk after the audio. Players skip chunks they don't know, so the file still
// plays anywhere, and there's only one file to share (Android's share sheet
// won't share .json files on their own).

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Mono samples (−1…1) → a 16-bit PCM WAV file, optionally carrying `meta` as JSON. */
export function encodeWav(samples, sampleRate, meta = null) {
  const json = meta == null ? null : enc.encode(JSON.stringify(meta));
  const dataSize = samples.length * 2;
  const jsonSize = json ? 8 + json.length + (json.length & 1) : 0;
  const bytes = new Uint8Array(44 + dataSize + jsonSize);
  const v = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  v.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);         // fmt chunk size
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);          // bytes per frame
  v.setUint16(34, 16, true);         // bits per sample
  text(36, 'data');
  v.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  if (json) {
    const at = 44 + dataSize;
    text(at, 'json');
    v.setUint32(at + 4, json.length, true);
    bytes.set(json, at + 8);
  }
  return bytes;
}

/**
 * A WAV file (16/24/32-bit PCM or 32-bit float, any number of channels) →
 * {samples (mono), sampleRate, meta}. Skips chunks it doesn't know (LIST,
 * fact…), as phone recorders add them. `meta` is the embedded JSON, or null.
 */
export function decodeWav(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, data = null, meta = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    const end = Math.min(bytes.length, body + size);
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(body, true), channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe) fmt.format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      data = { body, end };
    } else if (id === 'json') {
      meta = JSON.parse(dec.decode(bytes.subarray(body, end)));
    }
    at = body + size + (size & 1); // chunks are padded to an even length
  }
  if (!fmt) throw new Error('WAV file has no format chunk');
  if (!data) throw new Error('WAV file has no audio data');

  const { format, channels, bits, sampleRate } = fmt;
  const width = bits / 8;
  const read = format === 3 && bits === 32 ? (p) => v.getFloat32(p, true)
    : format === 1 && bits === 16 ? (p) => v.getInt16(p, true) / 0x8000
    : format === 1 && bits === 24 ? (p) => (((bytes[p + 2] << 24) | (bytes[p + 1] << 16) | (bytes[p] << 8)) >> 8) / 0x800000
    : format === 1 && bits === 32 ? (p) => v.getInt32(p, true) / 0x80000000
    : null;
  if (!read) throw new Error(`unsupported WAV encoding (format ${format}, ${bits}-bit)`);
  const frames = Math.floor((data.end - data.body) / (width * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(data.body + (i * channels + c) * width);
    samples[i] = sum / channels;
  }
  return { samples, sampleRate, meta };
}
