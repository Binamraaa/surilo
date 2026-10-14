// Editable piano roll: the hummed notes as bars on a grid of semitones, with
// your actual pitch drawn behind them so you can see where you drifted.
//
//   drag a bar up/down     → change pitch (snaps to semitones)
//   drag a bar sideways    → move it in time
//   drag a bar's edge      → change its length
//   double-click / tap-hold empty space → add a note
//   keys: ↑↓ semitone, Shift+↑↓ octave, ←→ select previous/next, Delete, Ctrl+Z
//
// On touch screens rows are taller, a touch that starts on a note never scrolls
// the page (so drags work), edges only resize once a note is selected (so a
// sloppy finger doesn't resize by accident), and each semitone step buzzes.
// Never re-render during pointerdown: replacing the touched element makes mobile
// browsers lose the touch and scroll the page instead. Selection happens on release.

import { midiToName } from '../core/notes.js';

const LABEL_W = 44;      // px for the note-name column
const isTouchFirst = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let ROW = 18;            // px per semitone (taller on touch screens; set per render)
let EDGE = 9;            // px grab zone for resizing
const LOCK = 6;          // px of movement before a drag picks an axis
const BLACK = [1, 3, 6, 8, 10];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {HTMLElement} root  container; gets a label column + a scrolling grid
 * @param {object} h  handlers
 * @param {(i:number|null)=>void} h.onSelect
 * @param {(edit:{type:string, i?:number, semis?:number, dStart?:number, dEnd?:number, midi?:number, start?:number, end?:number})=>void} h.onEdit
 * @param {(midi:number)=>void} h.onPreview  play a short note while dragging
 */
export function createRoll(root, h) {
  root.classList.add('roll');
  // One scroller for both axes, so the grid and the note names move together
  // vertically while the names stay pinned to the left (position: sticky).
  root.innerHTML = `<div class="roll-scroll" tabindex="0" aria-label="Piano roll editor. Arrow keys change the selected note."><div class="roll-inner"><div class="roll-labels"></div><div class="roll-grid"></div></div></div>`;
  const labels = root.querySelector('.roll-labels');
  const scroll = root.querySelector('.roll-scroll');
  const grid = root.querySelector('.roll-grid');

  let view = { notes: [], frames: [], tuning: 0, shift: 0, selected: null, flats: false, zoom: 1 };
  let geo = null;
  let followed = null; // {id, midi} of the selected note at the last render
  let drag = null;   // live drag state
  let lastTap = { t: 0, x: 0, y: 0 };
  let holdTimer = 0;

  function layout(notes, frames, tuning, shift) {
    const mids = notes.map((n) => n.midi);
    const raw = frames.filter((f) => f.midi != null).map((f) => f.midi - tuning + shift);
    raw.sort((a, b) => a - b);
    const rawLo = raw.length ? raw[Math.floor(raw.length * 0.02)] : 60;
    const rawHi = raw.length ? raw[Math.floor(raw.length * 0.98)] : 60;
    let lo = Math.floor(Math.min(mids.length ? Math.min(...mids) : 57, rawLo)) - 3;
    let hi = Math.ceil(Math.max(mids.length ? Math.max(...mids) : 69, rawHi)) + 3;
    if (hi - lo < 14) { const c = Math.round((hi + lo) / 2); lo = c - 7; hi = c + 7; }
    const tEnd = Math.max(notes.length ? notes[notes.length - 1].end : 0, frames.length ? frames[frames.length - 1].t : 0, 2) + 0.6;
    const avail = Math.max(240, (scroll.clientWidth || 600) - LABEL_W);
    const pps = Math.max(isTouchFirst() ? 150 : 110, avail / tEnd) * view.zoom;
    return { lo, hi, pps, width: Math.ceil(tEnd * pps), height: (hi - lo + 1) * ROW, tEnd };
  }
  const yOf = (midi) => (geo.hi - midi) * ROW;          // top of the row
  const midiAt = (y) => geo.hi - Math.floor(y / ROW);
  const xOf = (t) => t * geo.pps;
  const gridW = () => scroll.clientWidth - LABEL_W;   // visible grid width (labels cover the rest)

  function render(next) {
    const fresh = next && (next.frames !== view.frames || next.shift !== view.shift);
    if (next) view = { ...view, ...next };
    const { notes, frames, tuning, shift, selected, flats } = view;
    const before = geo;
    const touch = isTouchFirst();
    ROW = touch ? 30 : 18;
    EDGE = touch ? 18 : 9;
    geo = layout(notes, frames, tuning, shift);
    const { lo, hi, width, height } = geo;

    // Label column (stays put while the grid scrolls sideways)
    let lab = '';
    for (let m = hi; m >= lo; m--) {
      const pc = ((m % 12) + 12) % 12;
      const y = yOf(m);
      lab += `<rect x="0" y="${y}" width="${LABEL_W}" height="${ROW}" style="fill:${BLACK.includes(pc) ? 'var(--key-black)' : 'var(--key-white)'};stroke:var(--rule)" stroke-width=".5"/>`;
      if (!BLACK.includes(pc)) lab += `<text x="${LABEL_W - 5}" y="${y + ROW - 5}" text-anchor="end" font-size="10" style="fill:var(--ink-soft)">${pc === 0 ? midiToName(m) : midiToName(m, { octave: false })}</text>`;
    }
    labels.innerHTML = `<svg width="${LABEL_W}" height="${height}" viewBox="0 0 ${LABEL_W} ${height}">${lab}</svg>`;

    // Grid
    let g = '';
    for (let m = hi; m >= lo; m--) {
      const pc = ((m % 12) + 12) % 12;
      if (BLACK.includes(pc)) g += `<rect x="0" y="${yOf(m)}" width="${width}" height="${ROW}" style="fill:var(--rule)" opacity=".35"/>`;
      if (pc === 0 || pc === 5) g += `<line x1="0" x2="${width}" y1="${yOf(m) + ROW}" y2="${yOf(m) + ROW}" style="stroke:var(--rule)"/>`;
    }
    for (let s = 0; s <= geo.tEnd; s += 0.5) {
      g += `<line x1="${xOf(s)}" x2="${xOf(s)}" y1="0" y2="${height}" style="stroke:var(--rule)" stroke-width="${s % 1 === 0 ? 1 : 0.5}" opacity="${s % 1 === 0 ? 0.9 : 0.5}"/>`;
      if (s % 1 === 0 && s > 0) g += `<text x="${xOf(s) + 3}" y="11" font-size="10" style="fill:var(--ink-soft)">${s}s</text>`;
    }

    // What you actually hummed (tuning-corrected), so drift is visible against the grid
    let d = '';
    let pen = false, prev = null;
    for (const f of frames) {
      if (f.midi == null) { pen = false; continue; }
      const m = f.midi - tuning + shift;
      if (prev != null && Math.abs(m - prev) > 2.5) pen = false;
      prev = m;
      const y = (hi - m) * ROW + ROW / 2;
      d += `${pen ? 'L' : 'M'}${xOf(f.t).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    }

    // Note bars
    notes.forEach((n, i) => {
      const x = xOf(n.start), w = Math.max(6, xOf(n.end) - x), y = yOf(n.midi) + 1;
      const sel = i === selected;
      const off = !n.edited && Math.abs(n.cents ?? 0) >= 25;
      const fill = sel ? 'var(--accent)' : 'var(--accent-wash)';
      const stroke = n.edited ? 'var(--warm)' : 'var(--accent)';
      g += `<g class="note" data-i="${i}">
        <rect x="${x}" y="${y}" width="${w}" height="${ROW - 2}" rx="3" style="fill:${fill};stroke:${stroke}" stroke-width="${sel || n.edited || n.adjusted ? 2 : 1.2}"${n.adjusted ? ' stroke-dasharray="4 3"' : ''}/>
        ${w > 30 ? `<text x="${x + 5}" y="${y + ROW / 2 + 4}" font-size="${ROW > 20 ? 13 : 11}" font-weight="700" style="fill:${sel ? 'var(--accent-ink)' : 'var(--accent)'}" pointer-events="none">${esc(midiToName(n.midi, { flats }))}</text>` : ''}
        ${off && w > 64 ? `<text x="${x + w - 4}" y="${y + ROW / 2 + 4}" text-anchor="end" font-size="9" style="fill:var(--warm)" pointer-events="none">${n.cents > 0 ? '+' : '−'}${Math.abs(n.cents)}¢</text>` : ''}
        ${sel ? `<rect x="${x}" y="${y}" width="4" height="${ROW - 2}" style="fill:var(--accent-ink)" opacity=".7" pointer-events="none"/><rect x="${x + w - 4}" y="${y}" width="4" height="${ROW - 2}" style="fill:var(--accent-ink)" opacity=".7" pointer-events="none"/>` : ''}
      </g>`;
    });
    // Drawn over the bars (but click-through) so drift shows inside each note.
    if (d) g += `<path d="${d}" fill="none" style="stroke:var(--ink)" stroke-width="1.2" opacity=".35" pointer-events="none"/>`;
    g += `<line class="roll-playhead" x1="-10" x2="-10" y1="0" y2="${height}" style="stroke:var(--warm)" stroke-width="2"/>`;
    grid.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${g}</svg>`;

    if (fresh || !before) {
      // New hum or octave switch: start at the beginning, centred on the notes.
      const mids = notes.map((n) => n.midi).sort((a, b) => a - b);
      const mid = mids.length ? mids[mids.length >> 1] : (lo + hi) / 2;
      scroll.scrollLeft = 0;
      scroll.scrollTop = Math.max(0, yOf(mid) + ROW / 2 - scroll.clientHeight / 2);
    } else if (hi !== before.hi) {
      // An edit widened or narrowed the range: keep what's on screen in place.
      scroll.scrollTop += (hi - before.hi) * ROW;
    }
    // Follow the selected note when an edit moves it (e.g. Shift+↑ an octave).
    const s = notes[selected];
    if (s && followed?.id === s.id && followed.midi !== s.midi) showRow(s.midi);
    followed = s ? { id: s.id, midi: s.midi } : null;
  }

  /** Scroll vertically, only if needed, so the row for `midi` is on screen. */
  function showRow(midi) {
    const y = yOf(midi);
    if (y < scroll.scrollTop || y + ROW > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = Math.max(0, y + ROW / 2 - scroll.clientHeight / 2);
  }

  // ---------- Pointer editing ----------

  const local = (e) => {
    const r = grid.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !grid.contains(e.target)) return;
    const p = local(e);
    const bar = e.target.closest('.note');
    if (!bar) {
      // Empty space: double-click / double-tap, or press-and-hold on touch, adds a note.
      const now = performance.now();
      const dbl = now - lastTap.t < 350 && Math.abs(p.x - lastTap.x) < 12 && Math.abs(p.y - lastTap.y) < 12;
      lastTap = { t: now, x: p.x, y: p.y };
      const add = () => h.onEdit({ type: 'add', midi: midiAt(p.y), start: Math.max(0, p.x / geo.pps - 0.05), end: p.x / geo.pps + 0.35 });
      if (dbl) { add(); lastTap.t = 0; return; }
      if (e.pointerType === 'touch') holdTimer = setTimeout(add, 550);
      h.onSelect(null);
      return;
    }
    const i = Number(bar.dataset.i);
    const n = view.notes[i];
    const x0 = xOf(n.start), x1 = xOf(n.end);
    const canResize = e.pointerType !== 'touch' || view.selected === i;
    const edge = canResize ? Math.min(EDGE, (x1 - x0) / 3) : 0;
    const mode = p.x - x0 < edge ? 'start' : x1 - p.x < edge ? 'end' : 'body';
    drag = { i, mode, p0: p, axis: mode === 'body' ? null : 'x', semis: 0, dt: 0, moved: false, wasSelected: view.selected === i };
    scroll.setPointerCapture(e.pointerId);
    // Don't select (re-render) yet; see the note at the top. Select on release.
    e.preventDefault();
  });

  scroll.addEventListener('pointermove', (e) => {
    clearTimeout(holdTimer);
    if (!drag) {
      // Cursor hint: resize arrows near a bar's edge.
      const bar = e.target.closest?.('.note');
      if (bar) {
        const n = view.notes[Number(bar.dataset.i)];
        const p = local(e);
        const x0 = xOf(n.start), x1 = xOf(n.end);
        const edge = Math.min(EDGE, (x1 - x0) / 3);
        scroll.style.cursor = p.x - x0 < edge || x1 - p.x < edge ? 'ew-resize' : 'grab';
      } else scroll.style.cursor = '';
      return;
    }
    const p = local(e);
    const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.axis) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      drag.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    }
    drag.moved = true;
    const n = view.notes[drag.i];
    if (drag.axis === 'y') {
      const semis = Math.round(-dy / ROW);
      if (semis !== drag.semis) {
        drag.semis = semis;
        h.onPreview(n.midi + semis);
        try { navigator.vibrate?.(8); } catch { /* not supported */ }
        preview();
      }
    } else {
      drag.dt = Math.round((dx / geo.pps) * 100) / 100; // snap to 10 ms
      preview();
    }
  });

  // Draw the drag result without committing it (commit happens on release).
  function preview() {
    const n = view.notes[drag.i];
    const ghost = { ...n };
    if (drag.axis === 'y') ghost.midi = n.midi + drag.semis;
    else if (drag.mode === 'body') { ghost.start = Math.max(0, n.start + drag.dt); ghost.end = ghost.start + (n.end - n.start); }
    else if (drag.mode === 'start') ghost.start = Math.min(n.end - 0.06, Math.max(0, n.start + drag.dt));
    else ghost.end = Math.max(n.start + 0.06, n.end + drag.dt);
    const bar = grid.querySelector(`.note[data-i="${drag.i}"]`);
    if (!bar) return;
    const x = xOf(ghost.start), w = Math.max(6, xOf(ghost.end) - x), y = yOf(ghost.midi) + 1;
    bar.querySelectorAll('rect').forEach((r, k) => {
      r.setAttribute('y', y);
      if (k === 0) { r.setAttribute('x', x); r.setAttribute('width', w); }
      if (k === 1) r.setAttribute('x', x);
      if (k === 2) r.setAttribute('x', x + w - 4);
    });
    bar.querySelectorAll('text').forEach((t, k) => {
      t.setAttribute('y', y + ROW / 2 + 4);
      if (k === 0) { t.setAttribute('x', x + 5); t.textContent = midiToName(ghost.midi, { flats: view.flats }); }
      else t.remove(); // the "off by N cents" tag no longer applies
    });
  }

  const end = () => {
    clearTimeout(holdTimer);
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // A plain tap on an already-selected note deselects it; any tap plays it.
      h.onPreview(view.notes[d.i].midi);
      h.onSelect(d.wasSelected ? null : d.i);
      return;
    }
    if (!d.wasSelected) h.onSelect(d.i);
    if (d.axis === 'y' && d.semis) h.onEdit({ type: 'transpose', i: d.i, semis: d.semis });
    else if (d.axis === 'x' && d.dt) {
      if (d.mode === 'body') h.onEdit({ type: 'reshape', i: d.i, dStart: d.dt, dEnd: d.dt });
      else if (d.mode === 'start') h.onEdit({ type: 'reshape', i: d.i, dStart: d.dt });
      else h.onEdit({ type: 'reshape', i: d.i, dEnd: d.dt });
    } else render();
  };
  scroll.addEventListener('pointerup', end);
  scroll.addEventListener('pointercancel', () => { drag = null; clearTimeout(holdTimer); render(); });

  scroll.addEventListener('dblclick', (e) => e.preventDefault());

  // Touch: a finger that lands on a note edits it instead of scrolling the page.
  // (Pointer events still fire; cancelling touchstart only stops the scroll gesture.)
  root.addEventListener('touchstart', (e) => {
    if (e.target.closest?.('.note')) e.preventDefault();
  }, { passive: false, capture: true });
  root.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false, capture: true });

  // ---------- Keyboard ----------
  scroll.addEventListener('keydown', (e) => {
    const i = view.selected;
    const n = view.notes.length;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); h.onEdit({ type: 'undo' }); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!n) return;
      e.preventDefault();
      const next = i == null ? 0 : Math.max(0, Math.min(n - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      h.onSelect(next);
      h.onPreview(view.notes[next].midi);
      return;
    }
    if (i == null) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      h.onEdit({ type: 'transpose', i, semis: (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      h.onEdit({ type: 'delete', i });
    }
  });

  return {
    render,
    /** Move the playhead without re-rendering (called every animation frame during playback). */
    playhead(t) {
      const line = grid.querySelector('.roll-playhead');
      if (!line || !geo) return;
      const x = t == null ? -10 : xOf(t);
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      if (t != null && (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + gridW() - 20)) scroll.scrollLeft = Math.max(0, x - 40);
    },
    /** Keep the selected note in view (e.g. after picking it from the blocks). */
    reveal(i) {
      const n = view.notes[i];
      if (!n || !geo) return;
      const x = xOf(n.start);
      if (x < scroll.scrollLeft || x > scroll.scrollLeft + gridW() - 40) scroll.scrollLeft = Math.max(0, x - 60);
      showRow(n.midi);
    },
    /** Zoom time in or out (pinch-free zoom for phones), keeping the centre in place. */
    zoom(factor) {
      const z = Math.max(0.5, Math.min(4, view.zoom * factor));
      if (z === view.zoom || !geo) return;
      const mid = (scroll.scrollLeft + gridW() / 2) / geo.pps;
      render({ zoom: z });
      scroll.scrollLeft = Math.max(0, mid * geo.pps - gridW() / 2);
    },
    focus() { scroll.focus({ preventScroll: true }); },
  };
}
