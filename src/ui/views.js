// Views: each returns an SVG/HTML string from plain data. No state lives here.

import { midiToName } from '../core/notes.js';
import { STANDARD_TUNING, STRING_NAMES, staffSpelling } from '../core/theory.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameParts = (midi, flats) => {
  const n = midiToName(midi, { flats });
  const m = n.match(/^([A-G][#b]?)(-?\d+)$/);
  return { letter: m[1].replace('#', '♯').replace('b', '♭'), octave: m[2] };
};

// ---------------- Note blocks ----------------

export function blocksView({ notes, fingering, chordsAt, flats, instrument, active, selected }) {
  if (!notes.length) return `<div class="empty">No notes yet. Hum something, upload a voice memo, or try a sample.</div>`;
  return notes.map((n, i) => {
    const { letter, octave } = nameParts(n.midi, flats);
    const dur = n.end - n.start;
    const w = Math.round(Math.max(62, Math.min(150, 50 + dur * 60)));
    const f = fingering[i];
    const sub = instrument === 'guitar' && f
      ? `${STRING_NAMES[f.string]} string<br>${f.fret === 0 ? 'open' : 'fret ' + f.fret}`
      : `${dur.toFixed(2)} s`;
    const chord = chordsAt.get(i);
    const off = !n.edited && Math.abs(n.cents) >= 20 ? `<span class="off" title="You hummed ${Math.abs(n.cents)} cents ${n.cents > 0 ? 'sharp' : 'flat'}">${n.cents > 0 ? '+' : '−'}${Math.abs(n.cents)}¢</span>` : '';
    const cls = ['block', i === active ? 'active' : '', i === selected ? 'sel' : '', n.adjusted ? 'guess' : ''].join(' ');
    const guess = n.adjusted ? `<span class="guess-mark" title="You hummed between two notes; this is the one that fits the tune">≈</span>` : '';
    return `<div class="${cls}" data-i="${i}" role="button" tabindex="0" style="width:${w}px" aria-label="Note ${i + 1}: ${letter}${octave}${n.adjusted ? ', best guess' : ''}">${guess}
      ${chord ? `<span class="chord">${esc(chord.name)}</span>` : ''}
      <span class="n">${letter}<sub>${octave}</sub></span><span class="f">${sub}</span>${off}</div>`;
  }).join('');
}

// ---------------- Guitar fretboard ----------------

export function fretboardView({ fingering, active, selected, frets = 15 }) {
  const left = 50, top = 18, sGap = 26, height = sGap * 5;
  // Real fret spacing (each fret is 1/2^(1/12) of the last), scaled to fit.
  const scale = 1150;
  const fretX = (k) => left + scale * (1 - Math.pow(2, -k / 12)) * 1.55;
  const W = Math.ceil(fretX(frets) + 20);
  const H = top + height + 40;
  const yFor = (s) => top + (5 - s) * sGap; // string 6 (low E) at the bottom, like looking down at the neck
  const midX = (k) => (k === 0 ? left - 15 : (fretX(k - 1) + fretX(k)) / 2);

  let g = `<rect x="${left}" y="${top - 8}" width="${fretX(frets) - left}" height="${height + 16}" rx="3" style="fill:var(--wood)"/>`;
  for (const k of [3, 5, 7, 9, 15]) if (k <= frets) g += `<circle cx="${midX(k)}" cy="${top + height / 2}" r="5" style="fill:var(--inlay)" opacity=".8"/>`;
  if (frets >= 12) for (const dy of [-sGap, sGap]) g += `<circle cx="${midX(12)}" cy="${top + height / 2 + dy}" r="5" style="fill:var(--inlay)" opacity=".8"/>`;
  g += `<rect x="${left - 3}" y="${top - 8}" width="5" height="${height + 16}" style="fill:var(--inlay)"/>`; // nut
  for (let k = 1; k <= frets; k++) {
    g += `<line x1="${fretX(k)}" x2="${fretX(k)}" y1="${top - 8}" y2="${top + height + 8}" style="stroke:var(--fret)" stroke-width="2"/>`;
    g += `<text x="${midX(k)}" y="${top + height + 28}" text-anchor="middle" font-size="11" style="fill:var(--ink-soft)">${k}</text>`;
  }
  for (let s = 0; s < 6; s++) {
    const y = yFor(s);
    g += `<line x1="${left}" x2="${fretX(frets)}" y1="${y}" y2="${y}" style="stroke:var(--string)" stroke-width="${1 + (5 - s) * 0.35}"/>`;
    g += `<text x="4" y="${y + 4}" font-size="12" font-weight="700" style="fill:var(--ink-soft)">${STRING_NAMES[s]}</text>`;
  }

  // Group notes that share a position so each spot is drawn once, labelled with its order.
  const spots = new Map();
  fingering.forEach((p, i) => {
    const key = `${p.string}:${p.fret}`;
    if (!spots.has(key)) spots.set(key, { p, idx: [] });
    spots.get(key).idx.push(i);
  });
  const focus = active ?? selected;
  for (const { p, idx } of spots.values()) {
    const on = focus != null && idx.includes(focus);
    const x = midX(p.fret), y = yFor(p.string);
    const label = idx.length > 2 ? `${idx[0] + 1}…` : idx.map((i) => i + 1).join(',');
    const r = on ? 12 : 10;
    g += `<g><circle cx="${x}" cy="${y}" r="${r}" style="fill:${on ? 'var(--accent)' : 'var(--sheet)'};stroke:var(--accent)" stroke-width="2"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="${label.length > 3 ? 8 : 10}" font-weight="700" style="fill:${on ? 'var(--accent-ink)' : 'var(--accent)'}">${label}</text></g>`;
  }
  return `<svg class="fretboard" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Guitar fretboard showing where to play each note">${g}</svg>`;
}

// ---------------- Piano ----------------

const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export function pianoView({ notes, active, selected, chordTones = [] }) {
  const mids = notes.map((n) => n.midi);
  let lo = mids.length ? Math.min(...mids) : 48;
  let hi = mids.length ? Math.max(...mids) : 72;
  lo = Math.floor(lo / 12) * 12;                 // start on a C
  hi = Math.max(lo + 23, Math.ceil((hi + 1) / 12) * 12 - 1); // end on a B, at least 2 octaves
  const kw = 30, kh = 120, bw = 18, bh = 76;
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!IS_BLACK[m % 12]) whites.push(m);
  const W = whites.length * kw + 2, H = kh + 26;
  const xOfWhite = new Map(whites.map((m, i) => [m, 1 + i * kw]));

  const order = new Map();
  notes.forEach((n, i) => { if (!order.has(n.midi)) order.set(n.midi, []); order.get(n.midi).push(i); });
  const focus = active ?? selected;
  const focusMidi = focus != null && notes[focus] ? notes[focus].midi : null;
  const chordSet = new Set(chordTones);

  const fillFor = (m, black) => {
    if (m === focusMidi) return 'var(--accent)';
    if (order.has(m)) return 'var(--accent-wash)';
    if (chordSet.has(m % 12)) return 'var(--warm-wash)';
    return black ? 'var(--key-black)' : 'var(--key-white)';
  };

  let g = '';
  for (const m of whites) {
    const x = xOfWhite.get(m);
    g += `<rect x="${x}" y="1" width="${kw - 1}" height="${kh}" rx="3" style="fill:${fillFor(m, false)};stroke:var(--rule)"/>`;
    if (m % 12 === 0) g += `<text x="${x + kw / 2}" y="${kh + 18}" text-anchor="middle" font-size="11" style="fill:var(--ink-soft)">C${m / 12 - 1}</text>`;
    if (order.has(m)) g += `<text x="${x + kw / 2}" y="${kh - 10}" text-anchor="middle" font-size="10" font-weight="700" style="fill:${m === focusMidi ? 'var(--accent-ink)' : 'var(--accent)'}">${midiToName(m, { octave: false })}</text>`;
  }
  for (let m = lo; m <= hi; m++) {
    if (!IS_BLACK[m % 12]) continue;
    const x = xOfWhite.get(m - 1) + kw - bw / 2;
    const on = order.has(m);
    g += `<rect x="${x}" y="1" width="${bw}" height="${bh}" rx="2" style="fill:${fillFor(m, true)};stroke:${on ? 'var(--accent)' : 'var(--key-black)'}"/>`;
    if (on) g += `<circle cx="${x + bw / 2}" cy="${bh - 12}" r="4" style="fill:${m === focusMidi ? 'var(--accent-ink)' : 'var(--accent)'}"/>`;
  }
  return `<svg class="piano" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Piano keyboard with the hummed notes highlighted">${g}</svg>`;
}

// ---------------- Staff ----------------

export function staffView({ notes, flats, instrument, chordsAt, active, selected }) {
  if (!notes.length) return '';
  // Guitar music is written an octave higher than it sounds (treble clef with an 8 below).
  const written = instrument === 'guitar' ? notes.map((n) => n.midi + 12) : notes.map((n) => n.midi);
  const sorted = [...written].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const bass = instrument !== 'guitar' && median < 57;
  const bottomStep = bass ? 18 : 30; // G2 or E4 on the bottom line
  const gap = 10, top = 46, bottomY = top + gap * 4;
  const yOf = (step) => bottomY - (step - bottomStep) * (gap / 2);

  const left = 64;
  const xs = [];
  let x = left;
  notes.forEach((n) => { xs.push(x); x += Math.max(30, Math.min(70, 26 + (n.end - n.start) * 40)); });
  const W = x + 20;
  const H = top + gap * 4 + 74;

  let g = '';
  for (let l = 0; l < 5; l++) g += `<line x1="8" x2="${W - 8}" y1="${top + l * gap}" y2="${top + l * gap}" style="stroke:var(--ink-soft)" stroke-width="1"/>`;
  g += bass
    ? `<text x="12" y="${top + gap * 2 + 2}" font-size="38" style="fill:var(--ink);font-family:var(--font-music)">𝄢</text>`
    : `<text x="10" y="${top + gap * 4 + 10}" font-size="46" style="fill:var(--ink);font-family:var(--font-music)">𝄞</text>`;
  if (instrument === 'guitar') g += `<text x="24" y="${top + gap * 4 + 30}" font-size="11" font-weight="700" style="fill:var(--ink)">8</text>`;

  const focus = active ?? selected;
  written.forEach((m, i) => {
    const { step, accidental } = staffSpelling(m, flats);
    const cx = xs[i] + 10, cy = yOf(step);
    const on = i === focus;
    const color = on ? 'var(--accent)' : 'var(--ink)';
    // Ledger lines
    if (step < bottomStep - 1) for (let s = bottomStep - 2; s >= step; s -= 2) g += `<line x1="${cx - 11}" x2="${cx + 11}" y1="${yOf(s)}" y2="${yOf(s)}" style="stroke:var(--ink-soft)"/>`;
    if (step > bottomStep + 9) for (let s = bottomStep + 10; s <= step; s += 2) g += `<line x1="${cx - 11}" x2="${cx + 11}" y1="${yOf(s)}" y2="${yOf(s)}" style="stroke:var(--ink-soft)"/>`;
    if (accidental) g += `<text x="${cx - 19}" y="${cy + 5}" font-size="15" style="fill:${color}">${accidental}</text>`;
    g += `<ellipse cx="${cx}" cy="${cy}" rx="6.4" ry="4.6" transform="rotate(-20 ${cx} ${cy})" style="fill:${color}"/>`;
    // Stem: up below the middle line, down above it.
    const up = step < bottomStep + 4;
    g += up
      ? `<line x1="${cx + 5.8}" x2="${cx + 5.8}" y1="${cy - 1}" y2="${cy - 30}" style="stroke:${color}" stroke-width="1.3"/>`
      : `<line x1="${cx - 5.8}" x2="${cx - 5.8}" y1="${cy + 1}" y2="${cy + 30}" style="stroke:${color}" stroke-width="1.3"/>`;
    const { letter } = nameParts(notes[i].midi, flats);
    g += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" font-weight="${on ? 700 : 400}" style="fill:${on ? 'var(--accent)' : 'var(--ink-soft)'}">${letter}</text>`;
    const chord = chordsAt.get(i);
    if (chord) g += `<text x="${cx - 6}" y="16" font-size="13" font-weight="700" style="fill:var(--warm)">${esc(chord.name)}</text>`;
  });
  return `<svg class="staff" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Notes on a ${bass ? 'bass' : 'treble'} staff">${g}</svg>`;
}

// ---------------- Pitch trace (canvas) ----------------

export function drawTrace(canvas, { frames, notes, tuning = 0, now = null, playhead = null }) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const css = getComputedStyle(canvas);
  const col = (v) => css.getPropertyValue(v).trim() || '#888';

  const voiced = frames.filter((f) => f.midi != null).map((f) => f.midi);
  let lo = 45, hi = 69;
  if (voiced.length) {
    const s = [...voiced].sort((a, b) => a - b);
    lo = Math.floor(s[Math.floor(s.length * 0.02)]) - 3;
    hi = Math.ceil(s[Math.floor(s.length * 0.98)]) + 3;
    if (hi - lo < 14) { const c = (hi + lo) / 2; lo = Math.floor(c - 7); hi = Math.ceil(c + 7); }
  }
  const tEnd = frames.length ? frames[frames.length - 1].t : 4;
  const span = Math.max(4, now != null ? Math.min(tEnd, 8) : tEnd + 0.2);
  const t0 = now != null ? Math.max(0, tEnd - span) : 0;
  const padL = 34;
  const X = (t) => padL + ((t - t0) / span) * (cw - padL - 6);
  const Y = (m) => ch - 8 - ((m - lo) / (hi - lo)) * (ch - 16);

  // Note lanes: shaded rows for black keys, labels on Cs and Es.
  ctx.font = `11px ${col('--font-mono')}`;
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const y = Y(m);
    const pc = ((m % 12) + 12) % 12;
    if ([1, 3, 6, 8, 10].includes(pc)) {
      ctx.fillStyle = col('--rule'); ctx.globalAlpha = 0.35;
      ctx.fillRect(padL, y - (Y(m - 0.5) - y), cw - padL, Y(m - 0.5) - Y(m + 0.5));
      ctx.globalAlpha = 1;
    }
    if (pc === 0 || pc === 4 || pc === 7) {
      ctx.fillStyle = col('--ink-soft');
      ctx.fillText(midiToName(m), 2, y + 4);
    }
  }
  // Detected notes as bars
  ctx.fillStyle = col('--accent-wash');
  ctx.strokeStyle = col('--accent');
  for (const n of notes) {
    if (n.end < t0) continue;
    const y = Y(n.midi + tuning);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(X(n.start), y - 5, Math.max(2, X(n.end) - X(n.start)), 10);
    ctx.globalAlpha = 1;
    ctx.strokeRect(X(n.start), y - 5, Math.max(2, X(n.end) - X(n.start)), 10);
  }
  // Raw pitch line
  ctx.strokeStyle = col('--ink');
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let pen = false, prev = null;
  for (const f of frames) {
    // Lift the pen on silence, off-chart frames and big jumps (octave slips at note edges).
    if (f.t < t0 || f.midi == null || f.midi < lo || f.midi > hi) { pen = false; continue; }
    if (prev != null && Math.abs(f.midi - prev) > 2.5) pen = false;
    prev = f.midi;
    const x = X(f.t), y = Y(f.midi);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (playhead != null) {
    ctx.strokeStyle = col('--warm'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(playhead), 0); ctx.lineTo(X(playhead), ch); ctx.stroke();
  }
  if (!frames.length) {
    ctx.fillStyle = col('--ink-soft');
    ctx.font = `14px ${col('--font-body')}`;
    ctx.fillText('Your pitch will draw here as you hum.', padL + 10, ch / 2);
  }
}
