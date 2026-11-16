// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// The tempo controls, inside the "Beat" setup under the record button: BPM with
// − / + (hold to repeat), a slider, tap tempo, time signature, and "Hear this
// tempo" (a plain metronome, with a row of beat dots). While it's clicking and its
// dots have scrolled away, a small pill at the top of the screen keeps the dots
// and a "Stop the click" button in view. Nothing here says just Start or Stop:
// those words belong to the record button.
//
// Settings are remembered on this device (localStorage, if allowed).

import { createMetronome } from '../audio/metronome.js';
import { tapTempo, beatsPerBar, clampBpm, MIN_BPM, MAX_BPM, TAP_RESET_MS } from '../core/rhythm.js';

const STORE = 'hum-to-notes.metronome';
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function load() {
  const d = { bpm: 90, sig: '4/4', accent: true };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    return {
      bpm: Number.isFinite(s.bpm) ? clampBpm(s.bpm) : d.bpm,
      sig: ['4/4', '3/4', '6/8'].includes(s.sig) ? s.sig : d.sig,
      accent: typeof s.accent === 'boolean' ? s.accent : d.accent,
    };
  } catch { return d; }
}

/**
 * @param {object} o
 * @param {() => AudioContext} o.getCtx  shared audio context (created on first use, inside a tap)
 */
export function createMetronomePanel({ getCtx }) {
  const $ = (id) => document.getElementById(id);
  const s = load();
  let m = null;
  let taps = [];
  let lit = -1;
  let cardVisible = true;

  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: just don't remember */ } };
  const listeners = [];

  // ---- Drawing ----
  function drawDots() {
    const n = beatsPerBar(s.sig);
    const html = Array.from({ length: n }, (_, i) => {
      const cls = ['dot', i === 0 && 'first', s.sig === '6/8' && i === 3 && 'group'].filter(Boolean).join(' ');
      return `<span class="${cls}"></span>`;
    }).join('');
    $('metro-dots').innerHTML = html;
    $('metro-mini-dots').innerHTML = html;
    lit = -1;
  }

  function light(beat) {
    for (const box of [$('metro-dots'), $('metro-mini-dots')]) {
      const dots = box.children;
      if (dots[lit]) dots[lit].classList.remove('on');
      const d = dots[beat];
      if (!d) continue;
      d.classList.add('on');
      if (!calm() && d.animate) d.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    }
    lit = beat;
  }

  function drawSettings() {
    $('bpm-val').textContent = s.bpm;
    $('bpm-slider').value = s.bpm;
    $('metro-mini-bpm').textContent = s.bpm;
    $('bpm-unit').textContent = s.sig === '6/8' ? 'big beats per minute' : 'beats per minute';
    $('bpm-down').disabled = s.bpm <= MIN_BPM;
    $('bpm-up').disabled = s.bpm >= MAX_BPM;
    document.querySelectorAll('#metro-sig [data-sig]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sig === s.sig)));
    $('metro-accent').setAttribute('aria-pressed', String(s.accent));
    const hints = [];
    if (s.sig === '6/8') hints.push('In 6/8 the BPM counts the two big beats in each bar, not all six clicks.');
    if (m?.running && isIOS()) hints.push('Can\'t hear it? Turn off silent mode on your iPhone.');
    $('metro-hint').textContent = hints.join(' ');
    $('metro-hint').hidden = !hints.length;
  }

  function drawRunning() {
    const on = !!m?.running;
    $('metro-go').textContent = on ? 'Stop the click' : 'Hear this tempo';
    $('metro-go').setAttribute('aria-pressed', String(on));
    $('metro').classList.toggle('running', on);
    $('metro-mini').hidden = !on || cardVisible;
    if (!on) light(-1);
    drawSettings();
  }

  // ---- Changes ----
  function update(change) {
    const sigChanged = change.sig && change.sig !== s.sig;
    Object.assign(s, change);
    s.bpm = clampBpm(s.bpm);
    if (sigChanged) drawDots();
    m?.set({ bpm: s.bpm, sig: s.sig, sound: true, accent: s.accent });
    drawSettings();
    save();
    for (const fn of listeners) fn(s);
  }

  function toggle() {
    if (m?.running) { m.stop(); drawRunning(); return; }
    m ??= createMetronome(getCtx());
    m.start({ bpm: s.bpm, sig: s.sig, sound: true, accent: s.accent, onBeat: light });
    drawRunning();
  }

  // − / + : one step per tap; hold to keep going, faster the longer you hold.
  function holdToRepeat(btn, delta) {
    let timer = 0;
    let held = 0;
    const end = () => { clearTimeout(timer); timer = 0; };
    const tick = () => {
      update({ bpm: s.bpm + delta });
      held++;
      if (s.bpm <= MIN_BPM || s.bpm >= MAX_BPM) return end();
      timer = setTimeout(tick, held < 8 ? 110 : 45);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault(); // no text selection or long-press menu
      held = 0;
      update({ bpm: s.bpm + delta });
      timer = setTimeout(tick, 400);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, end);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard (Enter / Space) arrives as a click with no pointer.
    btn.addEventListener('click', (e) => { if (e.detail === 0) update({ bpm: s.bpm + delta }); });
  }

  function onTap(e) {
    if (e.type === 'click' && e.detail !== 0) return; // pointerdown already counted this tap
    if (e.type === 'pointerdown') e.preventDefault();
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > TAP_RESET_MS) taps = [];
    taps = [...taps.slice(-7), t];
    const bpm = tapTempo(taps);
    const btn = $('tap');
    btn.textContent = bpm ? `Tap again · ${bpm}` : 'Keep tapping…';
    clearTimeout(onTap.reset);
    onTap.reset = setTimeout(() => { btn.textContent = 'Tap the beat'; }, TAP_RESET_MS);
    if (bpm) update({ bpm });
  }

  // ---- Wiring ----
  $('metro-go').addEventListener('click', toggle);
  $('metro-mini-stop').addEventListener('click', toggle);
  holdToRepeat($('bpm-down'), -1);
  holdToRepeat($('bpm-up'), 1);
  $('bpm-slider').addEventListener('input', (e) => update({ bpm: Number(e.target.value) }));
  $('tap').addEventListener('pointerdown', onTap);
  $('tap').addEventListener('click', onTap);
  document.querySelectorAll('#metro-sig [data-sig]').forEach((b) => b.addEventListener('click', () => update({ sig: b.dataset.sig })));
  $('metro-accent').addEventListener('click', () => update({ accent: !s.accent }));

  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      cardVisible = entry.isIntersecting;
      $('metro-mini').hidden = !m?.running || cardVisible;
    }).observe($('metro-dots'));
  }

  drawDots();
  drawRunning();

  return {
    get bpm() { return s.bpm; },
    get sig() { return s.sig; },
    get metronome() { return m; },
    stop() { if (m?.running) { m.stop(); drawRunning(); } },
    get running() { return !!m?.running; },
    /** Hear about tempo or time-signature changes. */
    onChange(fn) { listeners.push(fn); },
  };
}
