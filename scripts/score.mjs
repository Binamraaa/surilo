// Compare the notes the app found with the notes they should have been (the
// answer key you fixed by hand), and say what kind of mistake each one is.
// Notes are matched by how much they overlap in time, so the answer key's
// timings only need to be roughly right.

export const KINDS = ['correct', 'semitone', 'octave', 'wrong', 'split', 'merged', 'missing'];

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const len = (n) => Math.max(1e-6, n.end - n.start);

/**
 * @param {Array<{midi,start,end}>} ref  the answer key
 * @param {Array<{midi,start,end}>} got  what the app found
 * @returns {{
 *   outcomes: Array<{i:number, kind:string, ref:object, got:object[], shift:number|null}>,
 *   counts: Record<string, number>, extra: object[], total: number, right: number,
 *   exact: boolean, anyKey: boolean,
 * }}
 *   kind, per answer-key note (worst first): missing (nothing there), merged (sung
 *   into a neighbouring note), split (found as two or more notes), octave, semitone
 *   (1–2 semitones off), wrong (further off), correct. `extra` lists found notes
 *   that match nothing. `anyKey`: right apart from the whole hum being ±1 semitone off.
 */
export function compareNotes(ref, got) {
  // Each found note belongs to the answer-key note it overlaps most, if that
  // covers at least 30% of it; otherwise it's an extra note.
  const owner = got.map((g) => {
    let best = -1, most = 0;
    ref.forEach((r, i) => { const o = overlap(r, g); if (o > most) { most = o; best = i; } });
    return most >= 0.3 * len(g) ? best : -1;
  });

  const outcomes = ref.map((r, i) => {
    const mine = got.filter((_, j) => owner[j] === i);
    if (!mine.length) {
      // Covered by a found note that belongs to a neighbour: the two were sung as one.
      const cover = got.find((g) => overlap(r, g) >= 0.5 * len(r));
      return { i, ref: r, got: cover ? [cover] : [], kind: cover ? 'merged' : 'missing', shift: null };
    }
    const main = mine.reduce((a, b) => (overlap(r, b) > overlap(r, a) ? b : a));
    const shift = main.midi - r.midi;
    const kind = mine.length > 1 ? 'split'
      : shift === 0 ? 'correct'
      : shift % 12 === 0 ? 'octave'
      : Math.abs(shift) <= 2 ? 'semitone'
      : 'wrong';
    return { i, ref: r, got: mine, kind, shift };
  });

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const o of outcomes) counts[o.kind]++;
  const extra = got.filter((_, j) => owner[j] === -1);
  const right = counts.correct;
  const single = outcomes.every((o) => o.got.length === 1 && o.kind !== 'merged');
  const anyKey = !extra.length && single && [-1, 0, 1].some((s) => outcomes.every((o) => o.shift === s));
  return { outcomes, counts, extra, total: ref.length, right, exact: right === ref.length && !extra.length, anyKey };
}
