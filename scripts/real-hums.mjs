// Real-voice report: run every test hum saved from the app's test mode through
// the current code, and compare with the answer key inside each file.
//
//   node scripts/real-hums.mjs [folder] [--misses]
//
// The folder is the argument, else $HUM_TESTS, else testdata/hums (gitignored).
// Subfolders are included. --misses lists every note that came out wrong.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { decodeWav } from '../src/core/wav.js';
import { analyseBuffer } from '../src/core/pitch.js';
import { transcribe } from '../src/core/intent.js';
import { midiToName } from '../src/core/notes.js';
import { compareNotes, KINDS } from './score.mjs';

const args = process.argv.slice(2);
const folder = resolve(args.find((a) => !a.startsWith('--')) || process.env.HUM_TESTS || 'testdata/hums');
const showMisses = args.includes('--misses');

if (!existsSync(folder)) {
  console.error(`No folder at ${folder}.\nPass the folder with your test hums, e.g.\n  node scripts/real-hums.mjs "G:/My Drive/Hum to Notes tests"`);
  process.exit(1);
}

const wavs = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return wavs(p);
  return /\.wav$/i.test(f) ? [p] : [];
});

const files = wavs(folder).sort();
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const name = (m) => midiToName(m).replace('#', '♯');
const SHORT = { semitone: 'semi', octave: 'oct', wrong: 'wrong', split: 'split', merged: 'merge', missing: 'miss' };

const rows = [];
const skipped = [];
const total = { hums: 0, exact: 0, anyKey: 0, notes: 0, right: 0, rightThen: 0, extra: 0, ...Object.fromEntries(KINDS.map((k) => [k, 0])) };

for (const path of files) {
  let wav;
  try { wav = decodeWav(readFileSync(path)); } catch (e) { skipped.push(`${basename(path)}: ${e.message}`); continue; }
  const meta = wav.meta;
  if (meta?.format !== 'hum-to-notes-test') { skipped.push(`${basename(path)}: no answer key (not saved from test mode)`); continue; }
  if (!meta.corrected?.length) { skipped.push(`${basename(path)}: the answer key is empty`); continue; }

  const frames = analyseBuffer(wav.samples, wav.sampleRate);
  const { notes } = transcribe(frames);
  const now = compareNotes(meta.corrected, notes);
  const then = compareNotes(meta.corrected, meta.detected || []);
  rows.push({ path, meta, now, then });

  total.hums++;
  total.notes += now.total;
  total.right += now.right;
  total.rightThen += then.right;
  total.extra += now.extra.length;
  if (now.exact) total.exact++;
  if (now.anyKey) total.anyKey++;
  for (const k of KINDS) total[k] += now.counts[k];
}

if (!rows.length) {
  console.log(`No test hums found in ${folder}.`);
} else {
  const W = 34;
  const errCols = Object.keys(SHORT);
  console.log(`\n${rows.length} test hum${rows.length === 1 ? '' : 's'} in ${folder}`);
  console.log('right = notes exactly right with the current code · then = what the app found when you saved it\n');
  console.log(`${'hum'.padEnd(W)}${'notes'.padStart(6)}${'right'.padStart(7)}${'then'.padStart(6)} ${errCols.map((k) => SHORT[k].padStart(6)).join('')}${'extra'.padStart(7)}`);
  const line = (label, notes, right, then, counts, extra) => console.log(
    `${label.slice(0, W - 1).padEnd(W)}${String(notes).padStart(6)}${pct(right, notes).padStart(7)}${pct(then, notes).padStart(6)} `
    + `${errCols.map((k) => String(counts[k] || '·').padStart(6)).join('')}${String(extra || '·').padStart(7)}`,
  );
  // Worst first, so the hums worth listening to are at the top.
  rows.sort((a, b) => a.now.right / a.now.total - b.now.right / b.now.total);
  for (const r of rows) line(basename(r.path, '.wav'), r.now.total, r.now.right, r.then.right, r.now.counts, r.now.extra.length);
  console.log('-'.repeat(W + 19 + errCols.length * 6 + 7));
  line('all', total.notes, total.right, total.rightThen, total, total.extra);
  console.log(`\nWhole hums exactly right: ${total.exact} of ${total.hums} (${pct(total.exact, total.hums)}). Right, or right apart from the whole hum being a semitone off: ${total.anyKey} of ${total.hums}.`);
  console.log('semi = 1–2 semitones off · oct = octave off · wrong = further off · split = one note found as several · merge = sung into a neighbour · miss = not found · extra = found but not in the answer key');

  if (showMisses) {
    for (const r of rows) {
      const bad = r.now.outcomes.filter((o) => o.kind !== 'correct');
      if (!bad.length && !r.now.extra.length) continue;
      console.log(`\n${basename(r.path)} (${r.meta.song || 'untitled'}):`);
      for (const o of bad) {
        const found = o.got.length ? o.got.map((g) => name(g.midi)).join(' + ') : 'nothing';
        console.log(`  note ${String(o.i + 1).padStart(2)} at ${o.ref.start.toFixed(2)} s: should be ${name(o.ref.midi)}, found ${found} (${o.kind})`);
      }
      for (const g of r.now.extra) console.log(`  extra ${name(g.midi)} at ${g.start.toFixed(2)} s`);
    }
  }
}
if (skipped.length) console.log(`\nSkipped:\n${skipped.map((s) => `  ${s}`).join('\n')}`);
