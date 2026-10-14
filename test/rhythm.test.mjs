import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsPerBeat, beatsPerBar, accentLevel, tapTempo, clampBpm } from '../src/core/rhythm.js';
import { createMetronome } from '../src/audio/metronome.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('secondsPerBeat: quarters in 4/4 and 3/4, eighths in 6/8 (BPM counts dotted quarters)', () => {
  assert.equal(secondsPerBeat(120, '4/4'), 0.5);
  assert.equal(secondsPerBeat(60, '3/4'), 1);
  assert.ok(near(secondsPerBeat(60, '6/8'), 1 / 3));
  // A 6/8 bar at 60 BPM is two dotted quarters: 2 s, same as a 2/4 bar at 60.
  assert.ok(near(secondsPerBeat(60, '6/8') * beatsPerBar('6/8'), 2));
  assert.deepEqual(['4/4', '3/4', '6/8'].map(beatsPerBar), [4, 3, 6]);
  assert.throws(() => secondsPerBeat(90, '5/4'));
});

test('accents: beat 1 everywhere, plus beat 4 in 6/8', () => {
  assert.deepEqual([0, 1, 2, 3].map((b) => accentLevel(b, '4/4')), [2, 0, 0, 0]);
  assert.deepEqual([0, 1, 2].map((b) => accentLevel(b, '3/4')), [2, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((b) => accentLevel(b, '6/8')), [2, 0, 0, 1, 0, 0]);
});

test('tapTempo: median of jittered taps, clamped, reset after a pause', () => {
  // 100 BPM = 600 ms, each tap up to ±20 ms off, and one tap badly late.
  const jitter = [0, 15, -10, 20, -20, 5, 120, -5, 10];
  const taps = jitter.map((j, i) => 1000 + i * 600 + j);
  const bpm = tapTempo(taps);
  assert.ok(Math.abs(bpm - 100) <= 3, `got ${bpm}`);

  assert.equal(tapTempo([]), null);
  assert.equal(tapTempo([500]), null);
  assert.equal(tapTempo([0, 500]), 120);
  assert.equal(tapTempo([0, 100, 200, 300]), 240, 'clamped to 240');
  assert.equal(tapTempo([0, 1900]), 40, 'clamped to 40');
  // A 2 s pause starts again: the old 120 BPM taps are forgotten.
  assert.equal(tapTempo([0, 500, 1000, 1500, 4000, 4750, 5500]), 80);
  assert.equal(tapTempo([0, 500, 1000, 4000]), null);
  // Only the last 8 taps count, so a change of mind settles quickly.
  const slowThenFast = [...Array(8)].map((_, i) => i * 1000).concat([...Array(8)].map((_, i) => 8000 + (i + 1) * 500));
  assert.equal(tapTempo(slowThenFast), 120);
  assert.equal(clampBpm(12), 40);
  assert.equal(clampBpm(90.4), 90);
});

/** A metronome on a fake clock. `run(seconds)` steps time in 25 ms wake-ups. */
function fakeMetronome({ step = 0.025 } = {}) {
  const clock = { t: 10 };
  let tickFn = null;
  const clicks = [];
  const beats = [];
  const m = createMetronome({ currentTime: 0 }, {
    now: () => clock.t,
    every: (fn) => { tickFn = fn; return 1; },
    cancel: () => { tickFn = null; },
    frame: null,
    wakeLock: null,
    click: (when, level) => { clicks.push({ when, level, bookedAt: clock.t }); },
  });
  const run = (seconds) => {
    const end = clock.t + seconds;
    while (clock.t < end - 1e-12) { clock.t += step; tickFn?.(); }
  };
  const onBeat = (beat, bar, when) => beats.push({ beat, bar, when, at: clock.t });
  return { m, clock, clicks, beats, run, onBeat, jump: (s) => { clock.t += s; tickFn?.(); } };
}

test('scheduler: clicks land exactly on the grid, booked ahead of time', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 120, sig: '4/4', onBeat: f.onBeat });
  f.run(10);
  const { clicks } = f;
  assert.ok(clicks.length >= 19 && clicks.length <= 21, `${clicks.length} clicks`);
  clicks.forEach((c, i) => {
    assert.ok(near(c.when, clicks[0].when + i * 0.5), `click ${i} at ${c.when}`);
    assert.ok(c.when >= c.bookedAt, 'never booked in the past');
    assert.ok(c.when - c.bookedAt <= 0.1 + 1e-9, 'booked at most 100 ms ahead');
    assert.equal(c.level, i % 4 === 0 ? 2 : 0);
  });
  assert.deepEqual(f.m.clickTimes, clicks.map((c) => c.when));
  // The visual pulse follows the audio clock, within one wake-up.
  for (const b of f.beats) assert.ok(b.at >= b.when && b.at - b.when <= 0.025 + 1e-9);
  assert.deepEqual(f.beats.slice(0, 6).map((b) => b.beat), [0, 1, 2, 3, 0, 1]);
});

test('scheduler: steady over five minutes at an awkward tempo', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 97, sig: '3/4' });
  f.run(300);
  const spb = 60 / 97;
  const first = f.clicks[0].when;
  f.clicks.forEach((c, i) => assert.ok(near(c.when, first + i * spb, 1e-9)));
  assert.equal(f.clicks.length, Math.floor((f.clock.t + 0.1 - first) / spb) + 1);
});

test('scheduler: count-in bars are negative and bar 1 beat 1 is known', () => {
  const f = fakeMetronome();
  const t0 = f.clock.t;
  f.m.start({ bpm: 90, sig: '4/4', countIn: 2, onBeat: f.onBeat });
  const spb = 60 / 90;
  assert.ok(near(f.m.barOneAt, t0 + 0.1 + 8 * spb));
  f.run(9);
  const firstOfBar = f.beats.filter((b) => b.beat === 0).map((b) => b.bar);
  assert.deepEqual(firstOfBar.slice(0, 4), [-2, -1, 0, 1]);
  const bar1 = f.beats.find((b) => b.bar === 0 && b.beat === 0);
  assert.ok(near(bar1.when, f.m.barOneAt));
});

test('scheduler: 6/8 clicks on eighths, accenting beats 1 and 4', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 60, sig: '6/8' });
  f.run(4);
  const gaps = f.clicks.slice(1).map((c, i) => c.when - f.clicks[i].when);
  for (const g of gaps) assert.ok(near(g, 1 / 3));
  assert.deepEqual(f.clicks.slice(0, 7).map((c) => c.level), [2, 0, 0, 1, 0, 0, 2]);
});

test('scheduler: a tempo change takes effect from the next click, without a jump', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 120, sig: '4/4' });
  f.run(2.02);
  const before = f.clicks.length;
  f.m.set({ bpm: 60 });
  f.run(4);
  const c = f.clicks;
  // The click already booked stays put; after it, the gaps are 1 s.
  assert.ok(near(c[before].when - c[before - 1].when, 0.5));
  for (let i = before + 1; i < c.length; i++) assert.ok(near(c[i].when - c[i - 1].when, 1));
  assert.equal(f.m.bpm, 60);
  f.m.set({ bpm: 900 });
  assert.equal(f.m.bpm, 240);
});

test('scheduler: changing the time signature starts a new bar', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 120, sig: '4/4', onBeat: f.onBeat });
  f.run(1.1); // beats 0, 1, 2 have played
  f.m.set({ sig: '3/4' });
  f.run(4);
  const levels = f.clicks.map((c) => c.level);
  const firstNew = f.clicks.findIndex((c, i) => i > 0 && c.level === 2);
  assert.ok(firstNew <= 4, 'the new bar starts straight away, not after beat 4');
  assert.deepEqual(levels.slice(firstNew, firstNew + 7), [2, 0, 0, 2, 0, 0, 2]);
});

test('scheduler: after a long stall it skips missed clicks instead of bursting', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 120, sig: '4/4' });
  f.run(1);
  const before = f.clicks.length;
  f.jump(3); // the tab was hidden for 3 s
  const booked = f.clicks.slice(before);
  assert.ok(booked.length <= 1, `${booked.length} clicks fired at once`);
  for (const c of booked) assert.ok(c.when >= f.clock.t - 0.02);
  f.run(2);
  // Still on the original grid, and still counting the bar correctly.
  const first = f.clicks[0].when;
  for (const c of f.clicks) {
    const k = Math.round((c.when - first) / 0.5);
    assert.ok(near(c.when, first + k * 0.5));
    assert.equal(c.level, k % 4 === 0 ? 2 : 0);
  }
});

test('scheduler: stop() books nothing more; sound off still pulses', () => {
  const f = fakeMetronome();
  f.m.start({ bpm: 120, sig: '4/4', sound: false, onBeat: f.onBeat });
  f.run(2);
  assert.equal(f.clicks.length, 0);
  assert.ok(f.beats.length >= 4);
  f.m.stop();
  assert.equal(f.m.running, false);
  const n = f.beats.length;
  f.run(2);
  assert.equal(f.beats.length, n);
});
