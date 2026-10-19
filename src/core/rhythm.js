// Tempo, time signatures and the beat grid. Pure: no DOM, no Web Audio.
//
// A "beat" here is one grid unit, and one metronome click: a quarter note in
// 4/4 and 3/4, an eighth note in 6/8. In 6/8 the BPM counts the two big beats
// in each bar (dotted quarters), so each of those lasts three units.

export const MIN_BPM = 40;
export const MAX_BPM = 240;

export const SIGNATURES = {
  '4/4': { beats: 4, unit: 'quarter', perCount: 1, accents: [0] },
  '3/4': { beats: 3, unit: 'quarter', perCount: 1, accents: [0] },
  '6/8': { beats: 6, unit: 'eighth', perCount: 3, accents: [0, 3] },
};

const sigOf = (sig) => {
  const s = SIGNATURES[sig];
  if (!s) throw new Error(`unknown time signature ${sig}`);
  return s;
};

export const clampBpm = (bpm) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)));

/** Seconds per grid unit (one click): a quarter in 4/4 and 3/4, an eighth in 6/8. */
export function secondsPerBeat(bpm, sig = '4/4') {
  return 60 / bpm / sigOf(sig).perCount;
}

/** Grid units per bar: 4, 3 or 6. */
export const beatsPerBar = (sig) => sigOf(sig).beats;

/** How strong a click is: 2 = beat 1 of the bar, 1 = a secondary accent (beat 4 in 6/8), 0 = the rest. */
export function accentLevel(beat, sig) {
  const { accents } = sigOf(sig);
  if (beat === 0) return 2;
  return accents.includes(beat) ? 1 : 0;
}

export const TAP_RESET_MS = 2000;
const TAP_WINDOW = 8;

/**
 * Tempo from tap times (ms, e.g. performance.now()). Uses the median gap over
 * the last 8 taps, so one early or late tap doesn't throw it. A pause of more
 * than 2 s starts a new count. Returns null until there are two taps.
 */
export function tapTempo(timestamps) {
  let from = 0;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > TAP_RESET_MS) from = i;
  }
  const taps = timestamps.slice(Math.max(from, timestamps.length - TAP_WINDOW));
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const gap = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return clampBpm(60000 / gap);
}

// ---------- Following a singer's timing ----------

/** Least-squares y ≈ c0 + c1·x + c2·x². Returns [c0, c1, c2], or null if the points can't tell. */
function quadFit(pts) {
  // Centre x for a well-conditioned solve, then shift back.
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const S = new Array(5).fill(0), T = [0, 0, 0];
  for (const [x0, y] of pts) {
    const x = x0 - mx;
    let p = 1;
    for (let i = 0; i < 5; i++) { S[i] += p; if (i < 3) T[i] += p * y; p *= x; }
  }
  const A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  const col = (i) => A.map((row, r) => row.map((v, c) => (c === i ? T[r] : v)));
  const [a, b, c] = [0, 1, 2].map((i) => det(col(i)) / D);
  // y = a + b(x − mx) + c(x − mx)²
  return [a - b * mx + c * mx * mx, b - 2 * c * mx, c];
}

/** The snapping grid is eighth notes: half a beat in 4/4 and 3/4; in 6/8 a beat already is one. */
export const stepsPerBeat = (sig) => (sigOf(sig).unit === 'eighth' ? 1 : 2);

/**
 * How consistently early (−) or late (+) a set of onsets is against a grid of
 * `step` seconds: the circular median of each onset's distance from its nearest
 * grid line, so a few wild notes don't drag it. Seconds, in (−step/2, step/2].
 */
export function gridOffset(onsets, step) {
  if (!onsets.length) return 0;
  const phase = onsets.map((t) => (((t / step) % 1) + 1) % 1);
  const dist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
  let best = 0, bestCost = Infinity;
  for (const c of phase) {
    const cost = phase.reduce((s, p) => s + dist(p, c), 0);
    if (cost < bestCost - 1e-12) { bestCost = cost; best = c; }
  }
  return (best > 0.5 ? best - 1 : best) * step;
}

/**
 * Follow the singer's tempo through a hum sung after a count-in. Without a click to
 * lean on, singers drift; this finds where each note really sits in the bar, so a
 * singer who sped up from 90 to 96 BPM still gets every note on its beat.
 *
 * 1. A first pass walks through the notes in order, predicting each one's grid step
 *    from a straight-line fit to the notes of the last two bars (so the tempo can
 *    change, but only gradually, and within ±limit of the chosen BPM).
 * 2. Then it refits around every note, looking both ways, and reassigns the steps,
 *    until nothing moves.
 *
 * @param {number[]} onsets  note starts in seconds, where 0 is bar 1 beat 1 of the click
 * @param {object} o
 * @param {number} o.bpm  the chosen tempo
 * @param {string} [o.sig]
 * @param {number} [o.limit]  how far the tempo may stray: 0.12 = ±12% (count-in only), 0.03 with a click throughout
 * @returns {{beatAt(t:number):number, secondsAt(beat:number):number, offset:number, drift:number, bpmStart:number, bpmEnd:number}}
 *   beatAt / secondsAt convert between the singer's seconds and beats (0 = bar 1 beat 1);
 *   offset: where the singer's bar 1 fell (s, + = late); drift: tempo change start → end in % (+ = sped up);
 *   bars: how many bars the notes span (a drift measured over less than ~4 bars is a rough guess)
 */
export function trackTempo(onsets, { bpm, sig = '4/4', limit = 0.12 } = {}) {
  const sub = stepsPerBeat(sig);
  const s0 = secondsPerBeat(bpm, sig) / sub;   // seconds per grid step at the chosen tempo
  const lo = s0 / (1 + limit), hi = s0 / (1 - limit);
  const W = 2 * beatsPerBar(sig) * sub;         // about two bars, in steps
  const ts = [...onsets].sort((a, b) => a - b);

  // Straight-line fit t ≈ a + b·k, weighted towards k0, with the slope kept in range.
  const fit = (pts, k0) => {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (const [k, t] of pts) {
      const w = 1 - Math.abs(k - k0) / (W + 1);
      if (w <= 0) continue;
      sw += w; sk += w * k; st += w * t; skk += w * k * k; skt += w * k * t;
    }
    if (!sw) return null;
    const den = sw * skk - sk * sk;
    let b = den > 1e-9 ? (sw * skt - sk * st) / den : s0;
    b = Math.min(hi, Math.max(lo, b));
    return { a: (st - b * sk) / sw, b };
  };

  // Where bar 1 really is: the singer's steady lateness, from the first two bars.
  const early = ts.filter((t) => t < W * s0);
  const off0 = gridOffset(early.length ? early : ts, s0);

  // 1. Forward pass.
  let ks = [];
  ts.forEach((t, i) => {
    const last = ks[i - 1];
    const recent = ks.map((k, j) => [k, ts[j]]).filter(([k]) => k >= last - W);
    let m;
    if (recent.length >= 3) m = fit(recent, last);
    else if (recent.length) m = { a: recent.reduce((s, [k, tt]) => s + tt - k * s0, 0) / recent.length, b: s0 };
    else m = { a: off0, b: s0 };
    let k = Math.round((t - m.a) / m.b);
    if (i && k < last) k = last;
    ks.push(k);
  });

  // 2. Look both ways: a smooth time for each step that has notes, then reassign.
  const knotsFor = (steps) => {
    const pts = steps.map((k, j) => [k, ts[j]]);
    const uniq = [...new Set(steps)].sort((a, b) => a - b);
    const knots = uniq.map((k) => {
      const m = fit(pts.filter(([kk]) => Math.abs(kk - k) <= W), k) || { a: off0, b: s0 };
      return { k, t: m.a + m.b * k, b: m.b };
    });
    // Keep time moving forward at an allowed pace between neighbouring knots.
    for (let j = 1; j < knots.length; j++) {
      const dk = knots[j].k - knots[j - 1].k;
      knots[j].t = Math.min(knots[j - 1].t + dk * hi, Math.max(knots[j - 1].t + dk * lo, knots[j].t));
    }
    return knots;
  };
  const stepAt = (knots, t) => {
    if (!knots.length) return (t - off0) / s0;
    const f = knots[0], l = knots[knots.length - 1];
    if (t <= f.t) return f.k + (t - f.t) / f.b;
    if (t >= l.t) return l.k + (t - l.t) / l.b;
    let j = 1;
    while (knots[j].t < t) j++;
    const p = knots[j - 1], q = knots[j];
    return p.k + ((t - p.t) / (q.t - p.t)) * (q.k - p.k);
  };
  const timeAt = (knots, k) => {
    if (!knots.length) return off0 + k * s0;
    const f = knots[0], l = knots[knots.length - 1];
    if (k <= f.k) return f.t + (k - f.k) * f.b;
    if (k >= l.k) return l.t + (k - l.k) * l.b;
    let j = 1;
    while (knots[j].k < k) j++;
    const p = knots[j - 1], q = knots[j];
    return p.t + ((k - p.k) / (q.k - p.k)) * (q.t - p.t);
  };

  let knots = knotsFor(ks);
  for (let it = 0; it < 4; it++) {
    const next = ts.map((t) => Math.round(stepAt(knots, t)));
    for (let j = 1; j < next.length; j++) if (next[j] < next[j - 1]) next[j] = next[j - 1];
    if (next.every((k, j) => k === ks[j])) break;
    ks = next;
    knots = knotsFor(ks);
  }

  // Start and end tempo, from one smooth curve through the whole hum (t ≈ a + b·k + c·k²):
  // the local fits only see one side at the ends, which would understate the drift.
  let bStart = knots.length ? knots[0].b : s0;
  let bEnd = knots.length ? knots[knots.length - 1].b : s0;
  if (knots.length >= 4 && knots[knots.length - 1].k - knots[0].k >= W) {
    const q = quadFit(knots.map((n) => [n.k, n.t]));
    if (q) {
      const clamp = (v) => Math.min(hi, Math.max(lo, v));
      bStart = clamp(q[1] + 2 * q[2] * knots[0].k);
      bEnd = clamp(q[1] + 2 * q[2] * knots[knots.length - 1].k);
    }
  }
  return {
    beatAt: (t) => stepAt(knots, t) / sub,
    secondsAt: (beat) => timeAt(knots, beat * sub),
    offset: timeAt(knots, 0),
    drift: (bStart / bEnd - 1) * 100,
    bpmStart: (bpm * s0) / bStart,
    bpmEnd: (bpm * s0) / bEnd,
    bars: knots.length ? (knots[knots.length - 1].k - knots[0].k) / (sub * beatsPerBar(sig)) : 0,
  };
}
