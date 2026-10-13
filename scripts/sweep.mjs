// Stress sweep: hum hundreds of synthetic melodies and count how many come back
// exactly note for note. Run before and after changing segmentation or note-picking.
//
//   node scripts/sweep.mjs            all sets
//   node scripts/sweep.mjs sloppy     one set
//
// Pitch analysis is the slow part and doesn't depend on note-picking, so its
// output is cached in .cache/ (delete the folder after changing src/core/pitch.js).

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyseBuffer } from '../src/core/pitch.js';
import { framesToNotes } from '../src/core/notes.js';
import { synthHum, DEMO_MELODIES } from '../src/core/demo.js';

const CHROMATIC_RUN = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72].map((m) => [m, 1]);
const melody = (name) => (name === 'Chromatic run' ? CHROMATIC_RUN : DEMO_MELODIES[name]);
const DIATONIC = ['Ode to Joy', 'Twinkle Twinkle', 'Greensleeves (minor)'];

/** Every hum in the sweep: a melody plus how the synthetic singer sings it. */
function cases() {
  const out = [];
  const add = (set, name, o) => out.push({ set, name, o, id: `${set}|${name}|${JSON.stringify(o)}` });
  // The original 270: steady singers, detuned as a whole, more or less vibrato.
  for (const name of DIATONIC) for (const detuneCents of [-40, -20, 0, 20, 40]) for (const vibratoCents of [20, 40, 60])
    for (const bpm of [90, 120]) for (const seed of [1, 2, 3]) add('steady', name, { detuneCents, vibratoCents, bpm, seed });
  // Untrained singers: each note misses by up to ±25–40 cents, and the voice drifts.
  for (const name of [...DIATONIC, 'Für Elise']) for (const sloppyCents of [25, 40]) for (const driftCents of [-50, 0, 50])
    for (const detuneCents of [-30, 10]) for (const seed of [1, 2, 3, 4]) add('sloppy', name, { sloppyCents, driftCents, detuneCents, seed });
  // Notes outside the key, sung steadily: guessing the intended note must leave these alone.
  for (const name of ['Für Elise', 'Chromatic run']) for (const detuneCents of [-40, -20, 0, 20, 40]) for (const vibratoCents of [20, 40])
    for (const seed of [1, 2, 3]) add('chromatic', name, { detuneCents, vibratoCents, seed });
  return out;
}

const truthOf = (c) => melody(c.name).map(([m]) => m + (c.o.transpose ?? -12));

function analyse(c) {
  const { samples, sampleRate } = synthHum(melody(c.name), c.o);
  // Keep only what note-picking reads, rounded, so the cache stays small.
  return analyseBuffer(samples, sampleRate).map((f) => ({
    t: +f.t.toFixed(5), midi: f.midi == null ? null : +f.midi.toFixed(4), level: +f.level.toFixed(5),
  }));
}

if (!isMainThread) {
  for (const c of workerData) parentPort.postMessage({ id: c.id, frames: analyse(c) });
  process.exit(0);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = `${root}.cache`;
const cacheFile = `${cacheDir}/sweep-frames.json`;

async function framesFor(list) {
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const todo = list.filter((c) => !cache[c.id]);
  if (todo.length) {
    const n = Math.max(1, Math.min(cpus().length - 1, todo.length));
    process.stdout.write(`Analysing ${todo.length} hums on ${n} threads`);
    let done = 0;
    await Promise.all(Array.from({ length: n }, (_, k) => new Promise((resolve, reject) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: todo.filter((_, j) => j % n === k) });
      w.on('message', ({ id, frames }) => {
        cache[id] = frames;
        if (++done % 25 === 0) process.stdout.write('.');
      });
      w.on('error', reject);
      w.on('exit', resolve);
    })));
    process.stdout.write('\n');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return cache;
}

/**
 * Score one way of turning frames into notes against the truth. Nobody can tell
 * whether a singer who is 55 cents flat throughout meant this key or the one a
 * semitone down, so a hum also counts as right "in some key" when every note is
 * off by the same ±1 semitone.
 */
function score(list, cache, toMidis) {
  const bySet = {};
  for (const c of list) {
    const s = (bySet[c.set] ??= { hums: 0, exact: 0, anyKey: 0, notes: 0, right: 0, misses: [] });
    const truth = truthOf(c);
    const got = toMidis(cache[c.id]);
    s.hums++;
    if (got.length !== truth.length) { s.misses.push(`${c.name} ${JSON.stringify(c.o)}: ${got.length} notes, expected ${truth.length}`); continue; }
    const rightWith = (shift) => got.filter((m, i) => m === truth[i] + shift).length;
    const best = Math.max(rightWith(-1), rightWith(0), rightWith(1));
    s.notes += truth.length; s.right += best;
    if (rightWith(0) === truth.length) s.exact++;
    if (best === truth.length) s.anyKey++;
    else s.misses.push(`${c.name} ${JSON.stringify(c.o)}: ${truth.length - best} wrong`);
  }
  return bySet;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');

const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const list = cases().filter((c) => !only || c.set === only);
const cache = await framesFor(list);

const methods = { nearest: (frames) => framesToNotes(frames).notes.map((n) => n.midi) };
try {
  const { transcribe } = await import('../src/core/intent.js');
  methods.intended = (frames) => transcribe(frames).notes.map((n) => n.midi);
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

const results = Object.fromEntries(Object.entries(methods).map(([k, f]) => [k, score(list, cache, f)]));
const sets = [...new Set(list.map((c) => c.set))];
console.log('\nexact = every note right · any key = right apart from the whole hum being a semitone off · notes = notes right (in the best key)');
console.log(`${''.padEnd(16)}${Object.keys(methods).map((m) => m.padEnd(30)).join('')}`);
console.log(`${'set'.padEnd(10)}${'hums'.padStart(5)} ${Object.keys(methods).map(() => `${'exact'.padStart(7)}${'any key'.padStart(9)}${'notes'.padStart(8)}`.padEnd(30)).join('')}`);
for (const set of sets) {
  const cols = Object.values(results).map((r) => {
    const s = r[set];
    return `${pct(s.exact, s.hums).padStart(7)}${pct(s.anyKey, s.hums).padStart(9)}${pct(s.right, s.notes).padStart(8)}`.padEnd(30);
  });
  console.log(`${set.padEnd(10)}${String(results.nearest[set].hums).padStart(5)} ${cols.join('')}`);
}
if (process.argv.includes('--misses')) {
  for (const [m, r] of Object.entries(results)) for (const set of sets) {
    console.log(`\n${m} · ${set}:`);
    r[set].misses.forEach((x) => console.log(`  ${x}`));
  }
}
