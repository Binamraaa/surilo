// Metronome: a lookahead click scheduler (the "two clocks" pattern).
//
// A ~25 ms timer wakes up and books every click due in the next 100 ms on the
// audio clock (ctx.currentTime), which is sample-accurate. The timer itself can
// be late by tens of milliseconds without the clicks moving. Never time clicks
// with setTimeout alone. The visual pulse (onBeat) is fired separately, from
// requestAnimationFrame, when the audio clock reaches each click.
//
// Clock, timers and the click sound can be injected, so tests run in Node.

import { secondsPerBeat, beatsPerBar, accentLevel, clampBpm } from '../core/rhythm.js';

const LOOKAHEAD = 0.1;   // s of clicks booked ahead
const INTERVAL = 25;     // ms between scheduler wake-ups
const LEAD_IN = 0.1;     // s from start() to the first click
const LATE = 0.02;       // s: a click this far in the past is skipped, not played late

/**
 * @param {AudioContext|{currentTime:number}} ctx
 * @param {object} [o]  injectable parts, for tests
 * @param {() => number} [o.now]  audio clock in seconds
 * @param {(when:number, level:0|1|2) => ({stop():void}|void)} [o.click]  play one click
 */
export function createMetronome(ctx, {
  now = () => ctx.currentTime,
  every = (fn, ms) => setInterval(fn, ms),
  cancel = (id) => clearInterval(id),
  frame = typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : null,
  cancelFrame = typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : () => {},
  click = null,
  wakeLock = globalThis.navigator?.wakeLock ?? null,
} = {}) {
  const opts = { bpm: 90, sig: '4/4', sound: true, accent: true };
  let running = false;
  let timer = 0;
  let raf = 0;
  let onBeat = () => {};
  // The next click is at anchor + n × spb, counted from the last tempo change,
  // so rounding never piles up over a long practice session.
  let anchor = 0, n = 0, spb = 0.5;
  let beat = 0, bar = 0;          // position of the next click; bar 0 is bar 1, count-in bars are negative
  let barOneAt = null;
  let clickTimes = [];
  let queue = [];                 // booked clicks waiting for their visual pulse
  let sounding = [];              // booked click sounds, so stop() can cut them

  // ---- Sound ----
  let out = null;
  function blip(when, level) {
    if (!out) {
      out = ctx.createGain();
      out.gain.value = 0.8;
      out.connect(ctx.destination);
    }
    // A short, high blip: easy to hear, and too brief and high for the pitch
    // detector to mistake for a hummed note.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = level ? 1500 : 1000;
    const peak = [0.5, 0.75, 1][level];
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + 0.04);
    return o;
  }
  const play = click || blip;

  // ---- Screen wake lock (best effort: unsupported or refused is fine) ----
  let lock = null;
  async function holdWake() {
    if (!wakeLock || lock) return;
    try {
      const l = await wakeLock.request('screen');
      if (!running) { l.release().catch(() => {}); return; }
      lock = l;
      l.addEventListener?.('release', () => { if (lock === l) lock = null; });
    } catch { /* refused (battery saver, iframe, no user gesture): keep going without it */ }
  }
  function dropWake() {
    const l = lock;
    lock = null;
    l?.release().catch(() => {});
  }
  // The browser drops the lock whenever the page is hidden; take it back on return.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (running && document.visibilityState === 'visible') holdWake();
    });
  }

  // ---- Scheduler ----
  const nextTime = () => anchor + n * spb;

  function advance() {
    n++;
    beat++;
    if (beat >= beatsPerBar(opts.sig)) { beat = 0; bar++; }
  }

  function schedule() {
    const t = now();
    // Woken up very late (the tab was in the background): skip the clicks we
    // missed instead of firing them all at once, and keep counting the bar.
    while (nextTime() < t - LATE) advance();
    while (nextTime() < t + LOOKAHEAD) {
      const when = nextTime();
      const level = opts.accent ? accentLevel(beat, opts.sig) : 0;
      if (bar === 0 && beat === 0) barOneAt = when;
      clickTimes.push(when);
      queue.push({ beat, bar, when });
      if (opts.sound) {
        const node = play(when, level);
        if (node) sounding.push({ when, node });
      }
      advance();
    }
    sounding = sounding.filter((s) => s.when > t);
    pump();
  }

  /** Fire onBeat for the latest click the audio clock has reached. */
  function pump() {
    const t = now();
    let due = null;
    while (queue.length && queue[0].when <= t) due = queue.shift();
    if (due) onBeat(due.beat, due.bar, due.when);
  }

  function loop() {
    pump();
    raf = frame(loop);
  }

  /** Start the next click on a new tempo, from where the old one would have been. */
  function reanchor() {
    anchor = nextTime();
    n = 0;
    spb = secondsPerBeat(opts.bpm, opts.sig);
  }

  function set(o = {}) {
    const bpm = o.bpm != null ? clampBpm(o.bpm) : opts.bpm;
    const tempoChanged = bpm !== opts.bpm || (o.sig != null && o.sig !== opts.sig);
    if (o.sig != null && o.sig !== opts.sig && running && beat !== 0) { beat = 0; bar++; }
    opts.bpm = bpm;
    for (const k of ['sig', 'sound', 'accent']) if (o[k] != null) opts[k] = o[k];
    if (running && tempoChanged) reanchor();
  }

  function start({ countIn = 0, onBeat: cb = () => {}, ...o } = {}) {
    if (running) stop();
    set(o);
    onBeat = cb;
    spb = secondsPerBeat(opts.bpm, opts.sig);
    anchor = now() + LEAD_IN;
    n = 0;
    beat = 0;
    bar = -countIn;
    barOneAt = anchor + countIn * beatsPerBar(opts.sig) * spb;
    clickTimes = [];
    queue = [];
    running = true;
    schedule();
    timer = every(schedule, INTERVAL);
    if (frame) raf = frame(loop);
    holdWake();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancel(timer);
    if (frame) cancelFrame(raf);
    for (const s of sounding) { try { s.node.stop(); } catch { /* already ended */ } }
    sounding = [];
    queue = [];
    dropWake();
  }

  return {
    start, stop, set,
    get running() { return running; },
    get bpm() { return opts.bpm; },
    get sig() { return opts.sig; },
    get sound() { return opts.sound; },
    get accent() { return opts.accent; },
    /** Audio-clock time of bar 1 beat 1 (after the count-in). */
    get barOneAt() { return barOneAt; },
    /** Audio-clock times of every click booked since start(). */
    get clickTimes() { return clickTimes; },
  };
}
