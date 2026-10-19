// Surilo — UI wiring. All analysis lives in src/core (pure, testable, reusable).
// (The app was called Hum to Notes; its saved settings keep their hum-to-notes.* names.)

import { analyseBuffer, levelStats } from './core/pitch.js';
import { midiToName, centsOff } from './core/notes.js';
import { transcribe } from './core/intent.js';
import { guessKey, keyName, keyUsesFlats, phraseSlots, fingerMelody, chordsWithNote, voiceChord } from './core/theory.js';
import { synthHum, DEMO_MELODIES, DEMO_TIMING } from './core/demo.js';
import { toMidiFile } from './core/midi.js';
import {
  withIds, transpose, reshape, deleteNote, addNote, splitNote, mergeWithNext, resolveGuess, indexOfId, createHistory,
} from './core/edit.js';
import { startMic, decodeFile } from './audio/mic.js';
import { playNotes, playOnce, playRecording, stopPlayback, getCtx } from './audio/synth.js';
import { blocksView, fretboardView, pianoView, staffView, rhythmStaffView, drawTrace } from './ui/views.js';
import { createRoll } from './ui/roll.js';
import { createMetronomePanel } from './ui/metronome-panel.js';
import { createRecordSetup } from './ui/record-setup.js';
import { createMetronome } from './audio/metronome.js';
import { trackTempo, secondsPerBeat, beatsPerBar, quantize, stepsPerBeat, accentLevel, tapTempo, clampBpm, TAP_RESET_MS } from './core/rhythm.js';
import { testModeOn, turnOffTestMode, testHumFile, shareOrDownload } from './ui/test-mode.js';
import { harmonise, paletteFor, barSlots } from './core/harmony.js';
import { MOODS, moodById, JOURNEYS, journeyById, journeyFor } from './core/moods.js';

const $ = (id) => document.getElementById(id);
const inArtifact = typeof window.claude === 'object' && window.claude !== null;

// How far the tune's key may overrule this singer's pitch when picking the note they
// meant. Learnt from their Keep / Use answers, and kept on this device only.
const TRUST_KEY = 'hum-to-notes.trust';
function loadTrust() {
  try { const v = Number(localStorage.getItem(TRUST_KEY)); return v > 0 ? v : 1; } catch { return 1; }
}
function learnFromAnswer(kept) {
  // "Use the other note" is a clear signal; "keep" is often just agreeing, so it counts for less.
  state.trust = kept ? Math.min(1.5, state.trust + 0.05) : Math.max(0.25, state.trust - 0.15);
  try { localStorage.setItem(TRUST_KEY, String(state.trust)); } catch { /* private mode: just don't remember */ }
}

const state = {
  frames: [],        // raw pitch frames from the last analysis
  detected: [],      // notes as hummed — and then as edited (the source of truth)
  original: [],      // notes exactly as detected, for "Reset"
  history: createHistory(),
  tuning: 0,         // singer's offset from concert pitch, in semitones
  recording: null,   // {samples, sampleRate} for "Play my hum"
  source: null,      // where the recording came from: 'mic', 'upload' or 'sample'
  micLabel: null,
  recTempo: null,    // {bpm, sig, …} if you hummed to a beat (saved with test hums)
  tempo: null,       // the beat of this hum: {bpm, sig, mode, origin, offset, drift, bpmEnd, beatAt, secondsAt}, or null
  take: null,        // while humming to a count-in: {m (metronome), bpm, sig, mode, countIn}
  rhythm: null,      // the notes as note values (quantize), when the hum has a beat
  snap: true,        // with a beat, drags in the roll jump from eighth to eighth
  playClick: false,  // with a beat, a click under playback
  playMap: null,     // while playing on the grid: playback seconds → hum seconds (for the playhead)
  countingIn: false,
  octave: 0,
  instrument: 'guitar',
  active: null,      // index of the note currently sounding
  selected: null,    // index of the note the user tapped
  chordTones: [],    // pitch classes of a tapped chord (piano highlight)
  playhead: null,
  mic: null,
  trust: loadTrust(),
  moodId: null,      // mood the user picked (null = automatic: Bright in a major key, Dark in minor)
  homeKey: null,     // home key the user picked ({tonic, mode}); null = the guessed key
  journeyId: 'steady', // a preset from JOURNEYS, or 'custom' after editing the mood strip
  strip: null,       // the mood of each part, once edited by hand (else it comes from the preset)
  stripSel: null,    // the part selected on the mood strip
  versions: {},      // which variation ("Try another version") each mood, or 'journey', is showing
  playingProg: null, // the chords being played, so the keyboard can follow them
  playing: null,     // which playback button is playing: 'notes', 'chords', 'hum' (or 'card')
  // derived
  notes: [], key: null, keys: [], home: null, flats: false, fingering: [],
  slots: [], journey: [], mood: null, variants: [], progression: [], palette: [], chordsAt: new Map(),
  cards: {},          // each mood card's progression, as shown
  noteChords: [],     // chords containing the note in focus (playing, else selected)
};

// ---------- Analysis ----------

/**
 * Where each note sits in the bar: follow the singer's tempo through the notes,
 * from bar 1 at `tempo.origin` (s). beatAt / secondsAt use the recording's own seconds.
 */
function followTempo(tempo, notes) {
  const map = trackTempo(notes.map((n) => n.start - tempo.origin), { bpm: tempo.bpm, sig: tempo.sig, limit: tempo.mode === 'throughout' ? 0.03 : 0.12 });
  return { ...tempo, ...map, beatAt: (t) => map.beatAt(t - tempo.origin), secondsAt: (b) => tempo.origin + map.secondsAt(b) };
}

function setAnalysis({ frames, recording, mask = null, tempo = null }) {
  const { notes, tuning } = transcribe(frames, { trust: state.trust, mask });
  // Hummed to a beat: where each note sits in the bar, following the singer's own tempo.
  state.tempo = tempo ? followTempo(tempo, notes) : null;
  if (state.tempo) {
    const { bpm, sig, mode, countIn, origin, offset, drift } = state.tempo;
    state.recTempo = { bpm, sig, mode, countIn, origin, offset, drift };
  }
  state.frames = frames;
  state.detected = withIds(notes);
  state.original = state.detected;
  state.history.clear();
  state.tuning = tuning;
  state.recording = recording;
  state.selected = null;
  state.chordTones = [];
  // A new tune: new key, new parts. The chosen mood (or preset journey) carries over.
  Object.assign(state, { homeKey: null, strip: null, stripSel: null, versions: {} });
  if (state.journeyId === 'custom') state.journeyId = 'steady';
  derive();
  renderAll();
}

function derive() {
  const shift = state.octave * 12;
  state.notes = state.detected.map((n) => ({ ...n, midi: n.midi + shift, nearest: n.nearest == null ? null : n.nearest + shift }));
  state.keys = guessKey(state.notes);
  state.key = state.keys[0] || null;
  state.home = state.homeKey || state.key;
  state.flats = state.home ? keyUsesFlats(state.home) : false;

  // The mood of each part (slot), from the strip, a preset journey, or one mood throughout.
  // Moods only ever choose chords: the notes are left exactly as they are.
  // With a beat, the chords change on bars (each mood sets how often); without, on phrases.
  state.rhythm = state.tempo && state.notes.length ? quantize(state.notes, state.tempo) : null;
  state.slots = state.rhythm ? barSlots(state.rhythm) : phraseSlots(state.notes);
  state.mood = moodById(state.moodId || (state.home?.mode === 'minor' ? 'dark' : 'bright'));
  const preset = journeyById(state.journeyId);
  if (state.strip) state.journey = fitStrip(state.strip, state.slots.length);
  else if (preset?.moods) state.journey = journeyFor(preset, state.slots);
  else state.journey = state.slots.map(() => state.mood.id);
  if (state.stripSel != null && state.stripSel >= state.slots.length) state.stripSel = null;

  state.variants = state.home && state.notes.length
    ? harmonise(state.notes, { home: state.home, slots: state.slots, journey: state.journey, lift: !state.strip && !!preset?.lift })
    : [];
  const v = state.versions[versionKey()] || 0;
  state.progression = state.variants.length ? state.variants[v % state.variants.length] : [];
  state.chordsAt = new Map(state.progression.map((p) => [p.firstIndex, p.chord]));
  const focus = moodById(state.stripSel != null ? state.journey[state.stripSel] : state.journey[0]) || state.mood;
  state.palette = state.home ? paletteFor(focus, state.home) : [];
  state.fingering = fingerMelody(state.notes);
}

/** One mood all the way through? Then "Try another version" belongs to that mood's card. */
const steady = () => !state.strip && !journeyById(state.journeyId)?.moods;
const versionKey = () => (steady() ? state.mood.id : 'journey');

/** Keep a hand-made strip the right length when edits change the number of parts. */
function fitStrip(strip, n) {
  if (strip.length === n) return strip;
  return Array.from({ length: n }, (_, i) => strip[Math.min(i, strip.length - 1)]);
}

// ---------- Rendering ----------

let roll = null;
let metro = null;
let recSetup = null;

function renderRoll() {
  roll.render({
    notes: state.notes, frames: state.frames, tuning: state.tuning, shift: state.octave * 12,
    selected: state.selected, flats: state.flats,
    beatLines: beatLines(), snap: state.tempo && state.snap ? snapTime : null,
  });
  $('ed-snap').hidden = !state.tempo;
  $('play-click').hidden = !state.rhythm;
  $('tempo-open').textContent = state.tempo ? 'Change tempo…' : 'Set tempo…';
  $('tempo-open').hidden = !state.notes.length;
  $('ed-snap').setAttribute('aria-pressed', String(state.snap));
  const sel = state.selected != null;
  for (const id of ['ed-up', 'ed-down', 'ed-oct-up', 'ed-oct-down', 'ed-split', 'ed-delete', 'ed-shorter', 'ed-longer']) $(id).disabled = !sel;
  $('ed-prev').disabled = !state.notes.length || state.selected === 0;
  $('ed-next').disabled = !state.notes.length || state.selected === state.notes.length - 1;
  const cur = state.notes[state.selected];
  $('ed-name').innerHTML = cur
    ? `Note ${state.selected + 1}: ${midiToName(cur.midi, { flats: state.flats }).replace('#', '♯')}<small>${(cur.end - cur.start).toFixed(2)} s</small>`
    : 'Tap a note to edit it';
  // Phones: dock the toolbar at the bottom of the screen while a note is selected.
  const dock = sel && matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  $('ed-tools').classList.toggle('docked', dock);
  document.body.classList.toggle('has-dock', dock);
  $('ed-merge').disabled = !sel || state.selected >= state.notes.length - 1;
  $('ed-undo').disabled = !state.history.size;
  $('ed-reset').disabled = state.detected === state.original;
  const edits = state.detected.filter((n) => n.edited).length;
  $('edit-count').textContent = edits ? `${edits} note${edits === 1 ? '' : 's'} edited` : '';
  renderGuess();
}

/** Snap a time to the nearest eighth note of this hum's beat. */
function snapTime(t) {
  const per = stepsPerBeat(state.tempo.sig);
  return state.tempo.secondsAt(Math.round(state.tempo.beatAt(t) * per) / per);
}

/** The roll's grid with a beat: a line per eighth, stronger on beats, strongest (and numbered) on bars. */
function beatLines() {
  const t = state.tempo;
  if (!t) return null;
  const per = stepsPerBeat(t.sig), bar = beatsPerBar(t.sig) * per;
  const last = Math.max(state.notes.at(-1)?.end ?? 0, state.frames.at(-1)?.t ?? 0) + 2;
  const lines = [];
  for (let e = Math.floor(t.beatAt(0) * per); e <= Math.ceil(t.beatAt(last) * per); e++) {
    const kind = e % bar === 0 ? 'bar' : e % per === 0 ? 'beat' : 'step';
    lines.push({ t: t.secondsAt(e / per), kind, label: kind === 'bar' && e >= 0 ? String(e / bar + 1) : '' });
  }
  return lines;
}

/** When the selected note is a best guess, say why and offer the other note. */
function renderGuess() {
  const n = state.notes[state.selected];
  const box = $('guess');
  box.hidden = !n?.adjusted;
  if (box.hidden) return;
  const name = (m) => midiToName(m, { flats: state.flats });
  const [lo, hi] = [n.nearest, n.midi].sort((a, b) => a - b);
  const off = n.cents + (n.midi - n.nearest) * 100; // from the nearest note to what was hummed
  $('guess-text').innerHTML = `Best guess: <b>${name(n.midi)}</b>. You hummed between ${name(lo)} and ${name(hi)}, ${Math.abs(off)}¢ ${off > 0 ? 'above' : 'below'} ${name(n.nearest)}. ${name(n.midi)} fits the key and the notes around it better.<span class="small">Your answer teaches the app how you sing (saved on this device only).</span>`;
  $('guess-keep').textContent = `Keep ${name(n.midi)}`;
  $('guess-undo').textContent = `Use ${name(n.nearest)}`;
}

function renderAll() {
  renderRoll();
  renderFacts();
  renderBlocks();
  renderInstrument();
  renderChords();
  renderJourney();
  renderTrace();
  const has = state.notes.length > 0;
  for (const id of ['play-notes', 'play-chords', 'midi']) $(id).disabled = !has;
  $('play-hum').disabled = !state.recording;
  renderTestKit();
}

/** Test mode: can this hum be saved as a test? Say why not. */
function renderTestKit() {
  if ($('test-kit').hidden) return;
  const why = !state.recording ? 'Record or upload a hum to save it as a test.'
    : state.source === 'sample' ? 'Samples are made by the app. Record or upload a real hum to test with.'
    : !state.detected.length ? 'Add the notes you hummed in the editor first.'
    : '';
  $('test-save').disabled = !!why;
  $('test-why').textContent = why;
}

function renderFacts() {
  const el = $('facts');
  if (!state.notes.length) { el.innerHTML = ''; $('context').hidden = true; return; }
  const [k1, k2] = state.keys;
  const close = k2 && k1.score - k2.score < 0.08;
  const mids = state.notes.map((n) => n.midi);
  const lo = Math.min(...mids), hi = Math.max(...mids);
  const tune = Math.round(state.tuning * 100);
  const fact = (label, v, small = '') => `<div class="fact"><span class="label">${label}</span><span class="v">${v}${small ? `<small>${small}</small>` : ''}</span></div>`;
  const preset = journeyById(state.journeyId);
  const moodName = state.strip ? 'Your mix' : preset?.moods ? preset.name : state.mood.name;
  $('context').hidden = !state.home;
  if (state.home) $('context').textContent = `${keyName(state.home)} · ${moodName}`;
  el.innerHTML = [
    state.homeKey
      ? fact('Home key', keyName(state.homeKey), 'picked by you')
      : fact('Likely key', k1.name, close ? `or ${k2.name}` : ''),
    state.tempo ? fact('Tempo', `${state.tempo.bpm} BPM`, driftShown(state.tempo) ? `${state.tempo.sig} · you went ${Math.round(state.tempo.bpmStart)} → ${Math.round(state.tempo.bpmEnd)}` : state.tempo.sig) : '',
    fact('Notes', state.notes.length),
    fact('Range', `${midiToName(lo, { flats: state.flats })}–${midiToName(hi, { flats: state.flats })}`),
    fact('Your tuning', Math.abs(tune) < 8 ? 'Spot on' : `${Math.abs(tune)}¢ ${tune > 0 ? 'sharp' : 'flat'}`, Math.abs(tune) >= 8 ? 'corrected for you' : ''),
  ].join('');
}

function renderBlocks() {
  $('blocks').innerHTML = blocksView({
    notes: state.notes, fingering: state.fingering, chordsAt: state.chordsAt, flats: state.flats,
    instrument: state.instrument, active: state.active, selected: state.selected, rhythm: state.rhythm,
  });
}

function renderInstrument() {
  const box = $('instrument');
  if (!state.notes.length) { box.innerHTML = ''; $('staff').innerHTML = ''; $('inst-hint').textContent = ''; return; }
  if (state.instrument === 'guitar') {
    const maxFret = Math.max(...state.fingering.map((p) => p.fret));
    box.innerHTML = fretboardView({ fingering: state.fingering, active: state.active, selected: state.selected, frets: Math.max(12, Math.min(15, maxFret + 2)) });
    const moved = state.fingering.some((p) => p.moved);
    $('inst-hint').textContent = 'Numbers are the order you play them. The thick low E string is at the bottom, as you see the neck when you look down at it.'
      + (moved ? ' Some notes were out of guitar range, so they were moved by an octave.' : '');
  } else {
    box.innerHTML = pianoView({ notes: state.notes, active: state.active, selected: state.selected, chordTones: state.chordTones });
    $('inst-hint').textContent = 'Blue keys are the notes in your hum. The darker one is the note playing now. Orange keys show a chord you tapped.';
  }
  const staff = {
    notes: state.notes, flats: state.flats, instrument: state.instrument, chordsAt: state.chordsAt,
    active: state.active, selected: state.selected,
  };
  // With a beat: real note values, bars and rests, wrapped to the screen's width.
  $('staff').innerHTML = state.rhythm
    ? rhythmStaffView({ ...staff, rhythm: state.rhythm, width: $('staff').clientWidth || 860 })
    : staffView(staff);
}

function renderChords() {
  const chip = (c, sub, i, kind, extra = '') => `<button type="button" class="chip${extra}" data-kind="${kind}" data-i="${i}"><b>${c.name}</b><span>${sub}</span></button>`;
  const notesOf = (p) => (p.noteCount > 1 ? `notes ${p.firstIndex + 1}–${p.firstIndex + p.noteCount}` : `note ${p.firstIndex + 1}`);
  const tag = (p) => (p.pivot ? ' · pivot' : p.turnaround ? ' · turnaround' : p.lift ? ' · lift' : p.borrowed ? ' · borrowed' : '');
  $('progression').innerHTML = state.progression.length
    ? state.progression.map((p, i) => chip(p.chord, `${p.roman} · ${notesOf(p)}${tag(p)}`, i, 'prog', p.borrowed ? ' borrowed' : '')).join('')
    : '<div class="empty">Chords appear once there are notes.</div>';
  $('chord-why').textContent = state.progression.length ? 'Tap a chord to hear it and see why it fits.' : '';
  $('palette').innerHTML = state.palette.map((c, i) => chip(c, c.numeral, i, 'pal')).join('');
  const focus = moodById(state.stripSel != null ? state.journey[state.stripSel] : state.journey[0]) || state.mood;
  $('prog-label').textContent = steady() ? state.mood.name : journeyById(state.journeyId)?.name || 'Your own mix';
  $('palette-label').textContent = `All chords in ${focus.name}`;
  renderHomePicker();
  renderMoods();
  renderNoteChords();
}

/** The home note: the guessed key, or one the user picks. */
function renderHomePicker() {
  const sel = $('home-key');
  const keys = [];
  for (let t = 0; t < 12; t++) for (const mode of ['major', 'minor']) keys.push({ tonic: t, mode });
  sel.innerHTML = `<option value="">${state.key ? `Auto: ${state.key.name}` : 'Auto'}</option>`
    + keys.map((k) => `<option value="${k.tonic}:${k.mode}">${keyName(k)}</option>`).join('');
  sel.value = state.homeKey ? `${state.homeKey.tonic}:${state.homeKey.mode}` : '';
}

const attr = (s) => String(s).replace(/"/g, '&quot;');

/** Short chord list for a card: repeats joined, and long tunes trimmed. */
function progChips(prog, max = 8) {
  const parts = prog.filter((p, i) => i === 0 || p.chord.name !== prog[i - 1].chord.name);
  const chips = parts.slice(0, max).map((p) => `<span class="pc${p.borrowed ? ' borrowed' : ''}" title="${attr(p.why)}"><b>${p.chord.name}</b><i>${p.roman}</i></span>`);
  if (parts.length > max) chips.push(`<span class="more">+${parts.length - max} more</span>`);
  return chips.join('');
}

/** One card per mood: your melody's chords in that mood, to hear, use or vary. */
function renderMoods() {
  const box = $('moods');
  state.cards = {};
  if (!state.home || !state.notes.length) { box.innerHTML = ''; return; }
  const part = state.stripSel;
  box.innerHTML = MOODS.map((m) => {
    const vs = harmonise(state.notes, { home: state.home, slots: state.slots, journey: m.id });
    const k = (state.versions[m.id] || 0) % Math.max(1, vs.length);
    const prog = vs[k] || [];
    state.cards[m.id] = prog;
    const on = part != null ? state.journey[part] === m.id : steady() && state.mood.id === m.id;
    const use = on ? '<button type="button" disabled>✓ In use</button>'
      : `<button type="button" class="primary" data-act="use" data-id="${m.id}">${part != null ? `Use for ${partName(part).toLowerCase()}` : 'Use'}</button>`;
    return `<article class="mood${on ? ' on' : ''}" aria-current="${on}">
      <h3>${m.name}<small>${m.theory}</small></h3>
      <p>${m.feel}</p>
      <div class="prog">${progChips(prog)}</div>
      <div class="row">
        <button type="button" data-act="hear" data-id="${m.id}">▶ Hear</button>
        ${use}
        ${vs.length > 1 ? `<button type="button" data-act="again" data-id="${m.id}" title="Try another version" aria-label="Try another version (now ${k + 1} of ${vs.length})">↻ <span class="ver">${k + 1}/${vs.length}</span></button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function onMoodAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const mood = moodById(btn.dataset.id);
  if (!mood) return;
  if (btn.dataset.act === 'hear') {
    playMelody(state.cards[mood.id], 'card');
    setStatus(`Playing your melody in ${mood.name}. The notes are the same: only the chords changed.`);
  } else if (btn.dataset.act === 'use') {
    if (state.stripSel != null) {
      setPartMood(state.stripSel, mood.id);
    } else {
      Object.assign(state, { moodId: mood.id, journeyId: 'steady', strip: null });
      derive(); renderAll();
      setStatus(`Chords now follow ${mood.name}. Your notes haven't changed. Tap ▶ With chords to hear it.`);
    }
  } else if (btn.dataset.act === 'again') {
    state.versions[mood.id] = (state.versions[mood.id] || 0) + 1;
    derive(); renderAll();
    setStatus(`Another version of ${mood.name}.`);
  }
}

// ---------- Mood strip and journeys ----------

function renderJourney() {
  const has = state.notes.length > 0;
  $('journey').hidden = !has;
  if (!has) return;
  $('presets').innerHTML = JOURNEYS.map((j) => `<button type="button" data-journey="${j.id}" aria-pressed="${!state.strip && state.journeyId === j.id}" title="${attr(j.about)}">${j.id === 'steady' ? `Steady (${state.mood.name})` : j.name}</button>`).join('')
    + (state.strip ? '<button type="button" aria-pressed="true" disabled>Your own mix</button>' : '');
  $('journey-again').disabled = state.variants.length < 2;
  const chordsIn = (i) => state.progression.filter((p) => p.slots.includes(i)).map((p) => p.chord.name)
    .filter((n, k, a) => n !== a[k - 1]).join(' ');
  $('strip').innerHTML = state.slots.map((sl, i) => {
    const first = state.notes[sl.first], last = state.notes[sl.first + sl.count - 1];
    const w = Math.round(Math.max(56, Math.min(200, (last.end - first.start) * 45)));
    const mood = moodById(state.journey[i]);
    return `<button type="button" class="part${i === state.stripSel ? ' sel' : ''}" data-part="${i}" data-mood="${mood.id}" style="width:${w}px"
      aria-pressed="${i === state.stripSel}" aria-label="${partName(i)}, notes ${sl.first + 1} to ${sl.first + sl.count}: ${mood.name}">
      <b>${mood.name}</b><span>${chordsIn(i) || '&nbsp;'}</span></button>`;
  }).join('');
  const pick = $('strip-pick');
  pick.hidden = state.stripSel == null;
  if (pick.hidden) return;
  const i = state.stripSel, sl = state.slots[i];
  pick.innerHTML = `<p>${partName(i)} (notes ${sl.first + 1}–${sl.first + sl.count}): pick its mood.</p>
    <div class="opts">${MOODS.map((m) => `<button type="button" data-pick="${m.id}" aria-pressed="${state.journey[i] === m.id}">${m.name}</button>`).join('')}
    <button type="button" data-pick="" class="tool">Done</button></div>`;
}

/** Give one part (or every part from it to the end) its own mood. */
function setPartMood(i, id, toEnd = false) {
  const strip = [...state.journey];
  for (let k = i; k < (toEnd ? strip.length : i + 1); k++) strip[k] = id;
  Object.assign(state, { strip, journeyId: 'custom' });
  state.versions.journey = 0;
  derive(); renderAll();
  const name = moodById(id).name;
  setStatus(toEnd && i < strip.length - 1
    ? `From ${partName(i).toLowerCase()} to the end, the mood is now ${name}. Only the chords changed.`
    : `${partName(i)} is now ${name}. Only the chords changed.`);
}

/** What a part of the mood strip is called: a bar when the hum has a beat, else a part. */
function partName(i) {
  const bar = state.slots[i]?.bar;
  if (bar == null) return `Part ${i + 1}`;
  return bar < 0 ? 'The pickup' : `Bar ${bar + 1}`;
}

function initStrip() {
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-journey]');
    if (!b) return;
    Object.assign(state, { journeyId: b.dataset.journey, strip: null, stripSel: null });
    state.versions.journey = 0;
    derive(); renderAll();
    const j = journeyById(state.journeyId);
    setStatus(j.moods ? `${j.name}: ${j.about} Tap ▶ With chords to hear it.` : `One mood all the way through: ${state.mood.name}.`);
  });
  $('journey-again').addEventListener('click', () => {
    const k = versionKey();
    state.versions[k] = (state.versions[k] || 0) + 1;
    derive(); renderAll();
    setStatus('Another version of the chords. Your notes are the same.');
  });
  $('strip-pick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pick]');
    if (!b) return;
    if (!b.dataset.pick) { state.stripSel = null; derive(); renderAll(); return; }
    setPartMood(state.stripSel, b.dataset.pick);
  });
  // Tap a part to select it; press and hold to copy its mood to the end.
  const strip = $('strip');
  let hold = null;
  const cancel = () => { if (hold) clearTimeout(hold.timer); };
  strip.addEventListener('pointerdown', (e) => {
    const part = e.target.closest('.part');
    if (!part) return;
    cancel();
    const i = Number(part.dataset.part);
    hold = { x: e.clientX, y: e.clientY, i, fired: false };
    hold.timer = setTimeout(() => {
      hold.fired = true;
      state.stripSel = null;
      setPartMood(i, state.journey[i], true);
      navigator.vibrate?.(15);
    }, 550);
  });
  strip.addEventListener('pointermove', (e) => {
    if (hold && !hold.fired && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) { cancel(); hold = null; }
  });
  strip.addEventListener('pointercancel', () => { cancel(); hold = null; });
  strip.addEventListener('contextmenu', (e) => e.preventDefault());
  // The click comes after the hold fired (and the strip was redrawn): swallow it then.
  strip.addEventListener('click', (e) => {
    const fired = hold?.fired;
    cancel();
    hold = null;
    const part = e.target.closest('.part');
    if (!part || fired) return;
    const i = Number(part.dataset.part);
    state.stripSel = state.stripSel === i ? null : i;
    derive(); renderAll();
  });
}

/** Chords that contain the note playing now, or else the note you tapped. */
function renderNoteChords() {
  const i = state.active ?? state.selected;
  const n = state.notes[i];
  const box = $('note-chords');
  if (!n) {
    state.noteChords = [];
    $('note-chords-label').textContent = 'Chords for one note';
    box.innerHTML = '<div class="empty">Tap a note, or press Play, to see the chords that have that note in them.</div>';
    return;
  }
  state.noteChords = chordsWithNote(n.midi, state.home);
  const name = midiToName(n.midi, { flats: state.flats, octave: false }).replace('#', '♯').replace('b', '♭');
  const outside = !state.noteChords[0]?.inKey;
  $('note-chords-label').textContent = `Chords with ${name} in them${outside && state.key ? ' (this note is outside the key)' : ''}`;
  box.innerHTML = state.noteChords.map((c, k) => `<button type="button" class="chip" data-kind="note" data-i="${k}"><b>${c.name}</b><span>${c.numeral ? `${c.numeral} · ` : ''}${name} is the ${c.role}</span></button>`).join('');
}

function renderTrace() {
  drawTrace($('trace'), {
    frames: state.frames, notes: state.detected, tuning: state.tuning,
    now: state.mic ? true : null, playhead: state.playhead,
  });
}

/** Cheap update while playing: only what depends on the active note. */
function renderActive() {
  document.querySelectorAll('#blocks .block').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === state.active));
  renderInstrument();
  renderNoteChords();
}

// ---------- Live display ----------

function showLive(frame) {
  const live = $('live');
  if (state.countingIn) return; // the big number is the countdown
  if (!frame || frame.midi == null) {
    live.classList.add('idle');
    if (!frame) $('live-chords').textContent = '';
    return;
  }
  live.classList.remove('idle');
  const fits = chordsWithNote(frame.midi, state.key).slice(0, 3).map((c) => c.name).join(' · ');
  $('live-chords').textContent = `Chords that fit: ${fits}`;
  const name = midiToName(frame.midi, { flats: state.flats });
  const m = name.match(/^([A-G][#b]?)(-?\d+)$/);
  $('live-name').innerHTML = `${m[1].replace('#', '♯').replace('b', '♭')}<sub>${m[2]}</sub>`;
  $('live-hz').textContent = `${frame.hz.toFixed(1)} Hz`;
  const c = centsOff(frame.midi);
  const needle = $('needle');
  needle.style.left = `${50 + c}%`;
  needle.classList.toggle('in-tune', Math.abs(c) <= 10);
  $('cents').textContent = Math.abs(c) <= 10 ? 'in tune' : `${Math.abs(c)}¢ ${c > 0 ? 'sharp' : 'flat'}`;
}

function showInputLevel(level) {
  const bar = $('input-level');
  if (!bar) return;
  // Map roughly −60…0 dBFS onto the bar.
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
}

let toastTimer = 0;
/** Show a message as a toast over whichever section is open. Warnings, and messages while
 * listening, stay until tapped or replaced; the rest fade after a few seconds. */
function setStatus(msg, warn = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('warn', warn);
  s.hidden = !msg;
  clearTimeout(toastTimer);
  if (msg && !warn && !state.mic) toastTimer = setTimeout(() => { s.hidden = true; }, 4000 + msg.length * 30);
}

// ---------- Colours (light, dark or the device's choice) ----------

const THEME_KEY = 'hum-to-notes.theme';
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path class="fill" d="M12 4a8 8 0 0 1 0 16z"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
const THEME_NAMES = { auto: 'match my device', light: 'light', dark: 'dark' };

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('theme').innerHTML = THEME_ICONS[theme];
  $('theme').setAttribute('aria-label', `Colours: ${THEME_NAMES[theme]}. Tap to change.`);
  $('theme').title = `Colours: ${THEME_NAMES[theme]}`;
  // The phone's status bar follows the top bar's colour.
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#ffffff');
  renderTrace(); // the trace reads its colours when it draws
}

function initTheme() {
  let theme = 'auto';
  try { theme = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* private mode */ }
  if (!THEME_ICONS[theme]) theme = 'auto';
  applyTheme(theme);
  $('theme').addEventListener('click', () => {
    theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme];
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* just for this visit */ }
    applyTheme(theme);
    setStatus(`Colours: ${THEME_NAMES[theme]}.`);
  });
  // Following the device: redraw when it switches between light and dark.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => theme === 'auto' && applyTheme('auto'));
}

// ---------- Sections (tabs) ----------

const VIEWS = ['hum', 'notes', 'chords', 'play'];
let view = 'hum';

function showView(name) {
  view = name;
  document.querySelectorAll('#tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  window.scrollTo(0, 0);
  // The trace and the roll measure their own width, so draw them once they're on screen.
  if (name === 'hum') renderTrace();
  if (name === 'notes') renderRoll();
  if (name === 'play') renderInstrument(); // the staff wraps to the width it has
  if (name === 'chords') $('moods').querySelector('.mood.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// ---------- Playback bar ----------

const PLAY_LABELS = { notes: '▶ Notes', chords: '▶ With chords', hum: '▶ My hum' };
/** Light up the button that's playing (it becomes Stop); null when nothing plays. */
function setPlaying(kind) {
  state.playing = kind;
  document.querySelectorAll('#player [data-play]').forEach((b) => {
    const on = b.dataset.play === kind;
    b.classList.toggle('playing', on);
    b.textContent = on ? '■ Stop' : PLAY_LABELS[b.dataset.play];
  });
}

// ---------- Actions ----------

async function toggleRecording() {
  if (state.mic) return stopRecording();
  stopPlayback();
  const beat = recSetup.mode; // 'off', 'countin' or 'throughout'
  // Off, but humming along to the metronome card: remember the tempo for test hums, as before.
  state.recTempo = beat === 'off' && metro.metronome?.running ? { bpm: metro.bpm, sig: metro.sig } : null;
  if (beat !== 'off') metro.stop(); // its clicks would clash with the count-in
  setStatus('Asking for your microphone…');
  try {
    let lastRender = 0;
    state.frames = [];
    let peakInput = 0;
    const startedAt = performance.now();
    // One audio clock for the mic and the clicks, so the hum can be lined up with the beat.
    state.mic = await startMic((f) => {
      state.frames.push(f);
      showLive(f);
      peakInput = Math.max(peakInput, f.input);
      showInputLevel(f.input);
      if (performance.now() - startedAt > 3000 && peakInput < 0.002) {
        setStatus(`The mic is hardly picking anything up (${state.mic?.label}). Check that this is the microphone you're using, and that its input volume isn't muted or very low.`, true);
      }
      const now = performance.now();
      if (now - lastRender > 120) {
        lastRender = now;
        const { notes, tuning } = transcribe(state.frames, { trust: state.trust });
        state.detected = notes; state.tuning = tuning;
        derive();
        renderTrace();
        renderFacts();
        renderBlocks();
      }
    }, { ctx: getCtx() });
    $('rec').classList.add('on');
    $('rec-label').textContent = 'Stop';
    $('mode-label').textContent = 'Listening';
    if (beat === 'off') setStatus(`Listening on ${state.mic.label}. Hum one note at a time, then press Stop.`);
    else startTake(beat);
  } catch (err) {
    state.mic = null;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(
      inArtifact || err.message === 'no-mic-api'
        ? 'Live humming needs microphone access, which this preview doesn\'t allow. Record a voice memo on your phone and upload it, or open surilo.vercel.app.'
        : denied
          ? 'Microphone access was blocked. Allow it in your browser\'s site settings, or upload a recording instead.'
          : `Couldn't start the microphone (${err.name || err.message}). Try uploading a recording instead.`,
      true,
    );
  }
}

/** Count in, then keep the beat on the dots (and, with "Keep clicking", in your ears). */
function startTake(mode) {
  const { bpm, sig } = metro;
  const bpb = beatsPerBar(sig);
  const dots = $('rec-dots');
  dots.innerHTML = Array.from({ length: bpb }, (_, i) => `<span class="dot${i === 0 ? ' first' : ''}${sig === '6/8' && i === 3 ? ' group' : ''}"></span>`).join('');
  dots.hidden = false;
  const m = createMetronome(getCtx());
  state.take = { m, bpm, sig, mode, countIn: recSetup.bars };
  state.countingIn = true;
  $('live').classList.add('counting');
  $('live-name').textContent = '';
  $('live-hz').textContent = 'listen to the count-in';
  m.start({
    bpm, sig, sound: true, accent: true, countIn: recSetup.bars,
    silentFrom: mode === 'countin' ? 0 : null,
    onBeat: (b, bar) => {
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === b));
      if (recSetup.vibrate) navigator.vibrate(b === 0 ? 35 : 15);
      if (bar < 0) {
        $('live-name').textContent = String(-bar * bpb - b); // 4, 3, 2, 1
      } else if (state.countingIn) {
        state.countingIn = false;
        $('live').classList.remove('counting');
        $('live-name').textContent = 'Hum!';
        $('live-hz').textContent = 'the dots keep the beat';
        setStatus(`Hum now${mode === 'countin' ? ': the clicks stop, and the dots keep the beat' : ''}. Press Stop when you're done.`);
      }
    },
  });
  setStatus(`${bpm} BPM: ${recSetup.bars === 1 ? 'one bar' : 'two bars'} of clicks, then hum from beat 1.`);
}

/** Where bar 1 and the audible clicks fall, in the recording's own seconds. */
function takeTiming(take, startedAt) {
  const ctx = getCtx();
  // A click reaches the speaker, and the singer, a little after it's scheduled. The rest of
  // the delay (the mic's own latency) shows up as lateness, which tempo tracking corrects.
  const delay = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const toRec = (t) => t + delay - startedAt;
  const bar1 = take.m.barOneAt;
  const heard = take.m.clickTimes.filter((t) => take.mode === 'throughout' || t < bar1 - 1e-6);
  return { bpm: take.bpm, sig: take.sig, mode: take.mode, countIn: take.countIn, origin: toRec(bar1), clicks: heard.map(toRec) };
}

function stopRecording() {
  state.micLabel = state.mic.label;
  const startedAt = state.mic.startedAt;
  const rec = state.mic.stop();
  const take = state.take;
  state.take = null;
  if (take) {
    take.m.stop();
    $('rec-dots').hidden = true;
    state.countingIn = false;
    $('live').classList.remove('counting');
    $('live-hz').textContent = 'hum steadily on "mmm"';
    if (startedAt != null) rec.tempo = takeTiming(take, startedAt);
  }
  showInputLevel(0);
  state.mic = null;
  $('rec').classList.remove('on');
  $('rec-label').textContent = 'Start humming';
  $('mode-label').textContent = 'Your hum';
  showLive(null);
  state.source = 'mic';
  analyseRecording(rec, 'your hum');
}

function analyseRecording(rec, label, { quiet = false } = {}) {
  if (!quiet) setStatus('Finding the notes…');
  // Let the status paint before the (sub-second) analysis blocks the thread.
  setTimeout(() => {
    const frames = analyseBuffer(rec.samples, rec.sampleRate);
    const tempo = rec.tempo || null;
    let mask = null;
    if (tempo && (tempo.mode === 'countin' || tempo.mode === 'throughout')) {
      if (rec.samples.length / rec.sampleRate < tempo.origin + 0.2) {
        setStatus('You stopped during the count-in. Press Start humming, wait for the clicks, then hum from beat 1.', true);
        return;
      }
      // The count-in is only clicks: ignore it, except that a note may start up to
      // half a beat early (a pickup, or just eager). Clicks can't start a note.
      const from = tempo.origin - secondsPerBeat(tempo.bpm, tempo.sig) / 2;
      for (const f of frames) if (f.t < from) f.midi = null;
      mask = tempo.clicks.map((t) => [t, t + 0.035]);
    }
    setAnalysis({ frames, recording: rec, mask, tempo });
    const n = state.notes.length;
    const guesses = state.notes.filter((x) => x.adjusted).length;
    if (n) {
      if (quiet) return;
      showView('notes');
      setStatus(`Found ${n} note${n === 1 ? '' : 's'} in ${label}.${guesses ? ` ${guesses === 1 ? 'One was' : `${guesses} were`} between two notes, so I picked the one that fits the tune (dashed, marked ≈). Tap it to check.` : ''}${timingNote()}`);
      return;
    }
    // Explain *why* nothing was found, so it's clear whether it's the mic or the hum.
    const { peak, noise, loud } = levelStats(rec.samples, rec.sampleRate);
    const voiced = frames.filter((f) => f.midi != null).length;
    const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-6)));
    const levels = `Peak ${db(peak)} dB, hum ${db(loud)} dB, background ${db(noise)} dB.`;
    if (peak < 0.002) {
      setStatus(`The recording is almost silent, so the mic isn't picking you up${state.micLabel ? ` (${state.micLabel})` : ''}. Check the input device and its volume in your system sound settings. ${levels}`, true);
    } else if (loud < noise * 2) {
      setStatus(`Your hum is about as loud as the background noise. Move closer to the mic or away from fans and traffic. ${levels}`, true);
    } else {
      setStatus(`I heard sound but no steady pitch (${voiced} pitched moments). Hum on a steady "mmm" for at least half a second per note. ${levels}`, true);
    }
  }, 30);
}

/** Worth mentioning a tempo change? Only a clear one, measured over enough bars to trust. */
const driftShown = (t) => Math.abs(t.drift) >= 3 && t.bars >= 4;

/** What the app noticed about your timing, in plain words (empty if you were on the beat). */
function timingNote() {
  const t = state.tempo;
  if (!t) return '';
  const parts = [];
  const ms = Math.round(t.offset * 1000);
  if (Math.abs(ms) >= 25) parts.push(`You sang about ${Math.abs(ms)} ms ${ms > 0 ? 'behind' : 'ahead of'} the beat; the app allows for that.`);
  if (driftShown(t)) {
    parts.push(`You ${t.drift > 0 ? 'sped up' : 'slowed down'} a little (about ${Math.round(t.bpmStart)} → ${Math.round(t.bpmEnd)} BPM); the app follows you, so your notes stay on their beats.`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

async function onFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  stopPlayback();
  setStatus(`Opening ${file.name}…`);
  try {
    const rec = await decodeFile(file);
    if (rec.samples.length / rec.sampleRate > 60) {
      rec.samples = rec.samples.subarray(0, rec.sampleRate * 60);
      setStatus('Using the first 60 seconds.');
    }
    $('mode-label').textContent = 'Uploaded';
    $('sample').value = '';
    Object.assign(state, { source: 'upload', micLabel: file.name, recTempo: null });
    rec.tempo = null;
    analyseRecording(rec, file.name);
  } catch {
    setStatus('That file couldn\'t be read as audio. Try a .m4a, .mp3 or .wav voice memo.', true);
  }
  e.target.value = '';
}

function loadSample(name, { quiet = false } = {}) {
  if (!DEMO_MELODIES[name]) return;
  stopPlayback();
  const rec = synthHum(DEMO_MELODIES[name]);
  // Samples are made at 100 BPM, so they come with their beat (and any pickup before bar 1).
  const { sig, pickup } = DEMO_TIMING[name];
  rec.tempo = { bpm: 100, sig, mode: 'sample', origin: 0.4 + pickup * secondsPerBeat(100, sig), clicks: [] };
  $('mode-label').textContent = `Sample · ${name}`;
  Object.assign(state, { source: 'sample', micLabel: null, recTempo: null });
  analyseRecording(rec, `the "${name}" sample`, { quiet });
}

const tick = (i, t) => {
  if (i !== state.active) {
    state.active = i;
    // Playing with chords: the keyboard lights up the chord under each note.
    const p = i != null && state.playingProg?.find((x) => i >= x.firstIndex && i < x.firstIndex + x.noteCount);
    if (p) state.chordTones = p.chord.tones;
    else if (t == null && state.playingProg) { state.chordTones = []; state.playingProg = null; }
    renderActive();
  }
  // Played on the grid: show the playhead where that moment is in your hum.
  state.playhead = t != null && state.playMap ? state.playMap(t) : t;
  renderTrace();
  roll.playhead(state.playhead);
};

/**
 * What to play. With a beat, the notes as written: on the grid at a steady tempo
 * (tied pieces as one note), the chords with them, and the click if it's on.
 */
function playable(progression) {
  const r = state.rhythm, t = state.tempo;
  if (!r) return { notes: state.notes, progression, clicks: null, toHum: null };
  const per = stepsPerBeat(t.sig);
  const eighth = secondsPerBeat(t.bpm, t.sig) / per;
  const at = (e) => e * eighth;
  const last = r.notes[r.notes.length - 1];
  const notes = state.notes.map((n, i) => ({ ...n, start: at(r.notes[i].e), end: at(r.notes[i].e + r.notes[i].len) - 0.03 }));
  const prog = progression && progression.map((p) => ({ ...p, start: at(Math.max(p.at ?? r.notes[p.firstIndex].e, r.notes[0].e)), end: at(last.e + last.len) }));
  let clicks = null;
  if (state.playClick) {
    clicks = [];
    const bpb = beatsPerBar(t.sig);
    for (let b = Math.floor(r.notes[0].e / per); b * per < last.e + last.len; b++) {
      clicks.push({ t: at(b * per), level: accentLevel(((b % bpb) + bpb) % bpb, t.sig) });
    }
  }
  return { notes, progression: prog, clicks, toHum: (x) => t.secondsAt(x / eighth / per) };
}

/** Play the notes, with a progression underneath (or none). */
function playMelody(progression = null, kind = progression ? 'chords' : 'notes') {
  const p = playable(progression);
  // Starting stops whatever was playing, and that resets the bar, so mark the new one after.
  playNotes(p.notes, { timbre: state.instrument, progression: p.progression, clicks: p.clicks, onTick: tick, onEnd: () => setPlaying(null) });
  state.playingProg = progression;
  state.playMap = p.toHum;
  setPlaying(kind);
}

async function saveMidi() {
  const bytes = toMidiFile(state.notes, state.progression, { rhythm: state.rhythm, tempo: state.tempo });
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hum-${state.key ? state.key.name.replace(' ', '-') : 'melody'}.mid`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  setStatus(state.rhythm
    ? `Saved a MIDI file at ${state.tempo.bpm} BPM in ${state.tempo.sig}, with the melody and chords on the grid. Drag it into your music software.`
    : 'Saved a MIDI file with the melody and chords. Drag it into Reaper or any DAW.');
}

async function saveTestHum() {
  const song = $('test-song').value.trim();
  if (!song) {
    setStatus('Type the song name first, so the test is easy to find later.', true);
    $('test-song').focus();
    return;
  }
  // Build the file straight away: sharing only works close to the tap.
  const file = testHumFile({
    song, recording: state.recording, original: state.original, corrected: state.detected,
    tuning: state.tuning, trust: state.trust, source: state.source, mic: state.micLabel, tempo: state.recTempo,
  });
  const how = await shareOrDownload(file);
  const mb = (file.size / 1e6).toFixed(1);
  setStatus({
    shared: `Shared ${file.name} (${mb} MB). Save it in the "Hum to Notes tests" folder in Drive.`,
    downloaded: `Downloaded ${file.name} (${mb} MB). Move it to the "Hum to Notes tests" folder in Drive.`,
    cancelled: 'Not saved.',
  }[how]);
}

// ---------- Set tempo (uploads, samples, or to change a hum's beat) ----------

/** The sheet under the facts: a BPM (typed, stepped or tapped), a time signature, and where bar 1 starts. */
function initTempoSheet() {
  const sheet = $('tempo-sheet');
  let sig = '4/4', pickup = 0, taps = [];
  const bpmIn = $('ts-bpm');
  const draw = () => {
    document.querySelectorAll('#ts-sig [data-sig]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sig === sig)));
    document.querySelectorAll('#ts-start [data-pickup]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.pickup) === pickup)));
    $('ts-clear').hidden = !state.tempo;
  };
  const setBpm = (v) => { bpmIn.value = clampBpm(Number(v) || 90); };
  $('tempo-open').addEventListener('click', () => {
    sheet.hidden = !sheet.hidden;
    if (sheet.hidden) return;
    setBpm(state.tempo?.bpm ?? metro.bpm);
    sig = state.tempo?.sig ?? metro.sig;
    pickup = 0;
    taps = [];
    draw();
  });
  $('ts-down').addEventListener('click', () => setBpm(Number(bpmIn.value) - 1));
  $('ts-up').addEventListener('click', () => setBpm(Number(bpmIn.value) + 1));
  bpmIn.addEventListener('change', () => setBpm(bpmIn.value));
  $('ts-tap').addEventListener('click', () => {
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > TAP_RESET_MS) taps = [];
    taps = [...taps.slice(-7), t];
    const bpm = tapTempo(taps);
    if (bpm) setBpm(bpm);
    $('ts-tap').textContent = bpm ? `Tap again · ${bpm}` : 'Keep tapping…';
  });
  $('ts-sig').addEventListener('click', (e) => { const b = e.target.closest('[data-sig]'); if (b) { sig = b.dataset.sig; draw(); } });
  $('ts-start').addEventListener('click', (e) => { const b = e.target.closest('[data-pickup]'); if (b) { pickup = Number(b.dataset.pickup); draw(); } });
  $('ts-cancel').addEventListener('click', () => { sheet.hidden = true; $('ts-tap').textContent = 'Tap the beat'; });
  $('ts-clear').addEventListener('click', () => {
    state.tempo = null;
    sheet.hidden = true;
    derive(); renderAll();
    setStatus('No tempo: the notes keep their timing as hummed.');
  });
  $('ts-apply').addEventListener('click', () => {
    if (!state.detected.length) return;
    const bpm = clampBpm(Number(bpmIn.value) || 90);
    // Bar 1 starts on the first note, or one beat after it for a pickup.
    const origin = state.detected[0].start + pickup * secondsPerBeat(bpm, sig);
    state.tempo = followTempo({ bpm, sig, mode: 'set', origin, clicks: [] }, state.detected);
    sheet.hidden = true;
    $('ts-tap').textContent = 'Tap the beat';
    derive(); renderAll();
    setStatus(`Rhythm written at ${bpm} BPM in ${sig}. Check the staff on the Play tab.${timingNote()}`);
  });
}

// ---------- Editing ----------

/** Apply one edit to the notes, keep it undoable, and redraw everything from it. */
function applyEdit(edit) {
  const before = state.detected;
  const shift = state.octave * 12;
  const i = edit.i ?? state.selected;
  const selId = state.selected != null ? before[state.selected]?.id : null;
  let after = before;
  switch (edit.type) {
    case 'transpose': after = transpose(before, i, edit.semis); break;
    case 'reshape': after = reshape(before, i, edit); break;
    case 'delete': after = deleteNote(before, i); break;
    case 'add': after = addNote(before, { midi: edit.midi - shift, start: edit.start, end: edit.end }); break;
    case 'split': after = splitNote(before, i); break;
    case 'merge': after = mergeWithNext(before, i); break;
    case 'guess': after = resolveGuess(before, i, edit.keep); break;
    case 'reset': after = state.original; break;
    case 'undo': after = state.history.undo() ?? before; break;
    default: return;
  }
  if (after === before) return;
  if (edit.type !== 'undo') state.history.push(before);
  if (edit.type === 'guess') learnFromAnswer(edit.keep);
  state.detected = after;

  // Keep a sensible selection.
  if (edit.type === 'add') {
    const ids = new Set(before.map((n) => n.id));
    state.selected = after.findIndex((n) => !ids.has(n.id));
  } else if (edit.type === 'delete') {
    // Two neighbours joined into one: select it. Otherwise the note that took the deleted one's place.
    const joined = after.length === before.length - 2;
    state.selected = after.length ? Math.min(joined ? i - 1 : i, after.length - 1) : null;
    edit.healed = joined || after.some((n, k) => n !== before[k < i ? k : k + 1]);
  } else {
    state.selected = indexOfId(after, selId);
  }
  derive();
  renderAll();
  const sel = state.notes[state.selected];
  if (sel && ['transpose', 'add', 'split', 'merge', 'guess'].includes(edit.type)) playOnce([sel.midi], state.instrument);
  const msg = {
    transpose: () => `Moved to ${midiToName(sel.midi, { flats: state.flats })}.`,
    reshape: () => 'Timing changed.',
    delete: () => (edit.healed ? 'Note deleted. The notes next to it now fill its time.' : 'Note deleted.'),
    add: () => 'Note added. Drag it into place.',
    split: () => 'Note split in two.',
    merge: () => 'Joined with the next note.',
    guess: () => (edit.keep ? `Kept ${midiToName(sel.midi, { flats: state.flats })}.` : `Changed to ${midiToName(sel.midi, { flats: state.flats })}, the note closest to what you hummed.`),
    reset: () => 'Back to exactly what you hummed.',
    undo: () => 'Undone.',
  }[edit.type];
  if (msg && (edit.type !== 'transpose' || sel)) setStatus(msg());
}

// ---------- Wiring ----------

function init() {
  initTheme();
  // Surilo is free; a tip is optional and unlocks nothing. The button shows the eSewa QR.
  $('tip').addEventListener('click', () => {
    const box = $('tip-box');
    box.hidden = !box.hidden;
    $('tip').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) box.scrollIntoView({ block: 'nearest' });
  });
  metro = createMetronomePanel({ getCtx });
  recSetup = createRecordSetup({ metro, say: setStatus });
  if (testModeOn()) $('test-kit').hidden = false;
  $('test-save').addEventListener('click', saveTestHum);
  $('test-song').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveTestHum(); } });
  $('test-off').addEventListener('click', () => {
    turnOffTestMode();
    $('test-kit').hidden = true;
    setStatus('Test mode is off. Open the app with ?test=1 to turn it back on.');
  });
  roll = createRoll($('roll'), {
    onSelect: (i) => {
      if (i === state.selected) return;
      state.selected = i;
      renderRoll(); renderBlocks(); renderInstrument(); renderNoteChords();
    },
    onEdit: applyEdit,
    onPreview: (midi) => playOnce([midi], state.instrument),
  });
  $('ed-up').addEventListener('click', () => applyEdit({ type: 'transpose', semis: 1 }));
  $('ed-down').addEventListener('click', () => applyEdit({ type: 'transpose', semis: -1 }));
  $('ed-oct-up').addEventListener('click', () => applyEdit({ type: 'transpose', semis: 12 }));
  $('ed-oct-down').addEventListener('click', () => applyEdit({ type: 'transpose', semis: -12 }));
  $('ed-split').addEventListener('click', () => applyEdit({ type: 'split' }));
  $('ed-merge').addEventListener('click', () => applyEdit({ type: 'merge' }));
  $('ed-delete').addEventListener('click', () => applyEdit({ type: 'delete' }));
  $('ed-undo').addEventListener('click', () => applyEdit({ type: 'undo' }));
  $('ed-reset').addEventListener('click', () => applyEdit({ type: 'reset' }));
  $('guess-keep').addEventListener('click', () => applyEdit({ type: 'guess', keep: true }));
  $('ed-shorter').addEventListener('click', () => applyEdit({ type: 'reshape', dEnd: -0.1 }));
  $('ed-longer').addEventListener('click', () => applyEdit({ type: 'reshape', dEnd: 0.1 }));
  const step = (d) => {
    if (!state.notes.length) return;
    const i = state.selected == null ? 0 : Math.max(0, Math.min(state.notes.length - 1, state.selected + d));
    state.selected = i;
    renderRoll(); renderBlocks(); renderInstrument(); renderNoteChords();
    roll.reveal(i);
    playOnce([state.notes[i].midi], state.instrument);
  };
  $('ed-prev').addEventListener('click', () => step(-1));
  $('ed-next').addEventListener('click', () => step(1));
  $('ed-done').addEventListener('click', () => { state.selected = null; renderRoll(); renderBlocks(); renderInstrument(); renderNoteChords(); });
  $('zoom-in').addEventListener('click', () => roll.zoom(1.5));
  initTempoSheet();
  $('play-click').addEventListener('click', () => {
    state.playClick = !state.playClick;
    $('play-click').setAttribute('aria-pressed', String(state.playClick));
    setStatus(state.playClick ? 'The beat clicks under playback.' : 'No click under playback.');
  });
  $('ed-snap').addEventListener('click', () => {
    state.snap = !state.snap;
    renderRoll();
    setStatus(state.snap ? 'Snap on: dragged notes jump to the nearest eighth note.' : 'Snap off: drag notes freely.');
  });
  $('zoom-out').addEventListener('click', () => roll.zoom(1 / 1.5));
  $('moods').addEventListener('click', onMoodAction);
  initStrip();
  $('home-key').addEventListener('change', (e) => {
    const [tonic, mode] = e.target.value.split(':');
    state.homeKey = e.target.value ? { tonic: Number(tonic), mode } : null;
    derive(); renderAll();
    setStatus(state.homeKey ? `Home note set to ${keyName(state.homeKey)}. The chords now centre on it.` : 'Home note follows the key the app hears again.');
  });
  $('guess-undo').addEventListener('click', () => applyEdit({ type: 'guess', keep: false }));

  const sel = $('sample');
  for (const name of Object.keys(DEMO_MELODIES)) sel.add(new Option(name, name));
  sel.addEventListener('change', () => loadSample(sel.value));
  $('rec').addEventListener('click', toggleRecording);
  $('file').addEventListener('change', onFile);
  // Each playback button starts its sound, or stops it if it's the one playing.
  const playButton = (kind, start) => $(`play-${kind}`).addEventListener('click', () => (state.playing === kind ? stopPlayback() : start()));
  playButton('notes', () => playMelody());
  playButton('chords', () => playMelody(state.progression));
  playButton('hum', () => {
    if (!state.recording) return;
    playRecording(state.recording, { onTick: tick, onEnd: () => setPlaying(null) });
    state.playMap = null;
    setPlaying('hum');
  });
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view); });
  $('context').addEventListener('click', () => showView('chords'));
  $('status').addEventListener('click', () => { $('status').hidden = true; });
  // The metronome's floating pill takes you back to the metronome, on the Hum section.
  $('metro-mini-show').addEventListener('click', () => { showView('hum'); $('metro').scrollIntoView({ block: 'start' }); });
  $('midi').addEventListener('click', saveMidi);
  // Downloads started by the page are blocked inside a Claude artifact; MIDI export is for the hosted version.
  if (inArtifact) $('midi').hidden = true;

  document.querySelectorAll('[data-oct]').forEach((b) => b.addEventListener('click', () => {
    state.octave = Number(b.dataset.oct);
    document.querySelectorAll('[data-oct]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    derive(); renderAll();
  }));
  document.querySelectorAll('[data-inst]').forEach((b) => b.addEventListener('click', () => {
    state.instrument = b.dataset.inst;
    document.querySelectorAll('[data-inst]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderBlocks(); renderInstrument();
  }));

  const pickBlock = (el) => {
    const i = Number(el.dataset.i);
    state.selected = state.selected === i ? null : i;
    if (state.selected != null) playOnce([state.notes[i].midi], state.instrument);
    renderBlocks(); renderInstrument(); renderRoll(); renderNoteChords();
    if (state.selected != null) roll.reveal(state.selected);
  };
  $('blocks').addEventListener('click', (e) => { const b = e.target.closest('.block'); if (b) pickBlock(b); });
  $('blocks').addEventListener('keydown', (e) => {
    const b = e.target.closest('.block');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickBlock(b); }
  });

  const onChord = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const { kind, i } = chip.dataset;
    const chord = kind === 'prog' ? state.progression[i].chord : kind === 'note' ? state.noteChords[i] : state.palette[i];
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.chordTones = chord.tones;
    if (kind === 'prog') $('chord-why').textContent = state.progression[i].why;
    playOnce(voiceChord(chord), 'piano');
    if (state.instrument === 'piano') renderInstrument();
  };
  $('progression').addEventListener('click', onChord);
  $('palette').addEventListener('click', onChord);
  $('note-chords').addEventListener('click', onChord);

  window.addEventListener('resize', () => { renderTrace(); renderRoll(); });
  loadSample('Ode to Joy', { quiet: true });
  sel.value = 'Ode to Joy';
}

init();
