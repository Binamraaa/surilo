// Hum to Notes — UI wiring. All analysis lives in src/core (pure, testable, reusable).

import { analyseBuffer, levelStats } from './core/pitch.js';
import { midiToName, centsOff } from './core/notes.js';
import { transcribe } from './core/intent.js';
import { guessKey, keyUsesFlats, suggestChords, fingerMelody, chordsWithNote, voiceChord } from './core/theory.js';
import { synthHum, DEMO_MELODIES } from './core/demo.js';
import { toMidiFile } from './core/midi.js';
import {
  withIds, transpose, reshape, deleteNote, addNote, splitNote, mergeWithNext, resolveGuess, indexOfId, createHistory,
} from './core/edit.js';
import { startMic, decodeFile } from './audio/mic.js';
import { playNotes, playOnce, playRecording, playSequence, stopPlayback, getCtx } from './audio/synth.js';
import { blocksView, fretboardView, pianoView, staffView, drawTrace } from './ui/views.js';
import { createRoll } from './ui/roll.js';
import { createMetronomePanel } from './ui/metronome-panel.js';
import { testModeOn, turnOffTestMode, testHumFile, shareOrDownload } from './ui/test-mode.js';
import { rankModes, defaultModeId, rewriteInMode, prefersFlats } from './core/modes.js';

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
  recTempo: null,    // {bpm, sig} if the metronome was running while you hummed
  octave: 0,
  instrument: 'guitar',
  active: null,      // index of the note currently sounding
  selected: null,    // index of the note the user tapped
  chordTones: [],    // pitch classes of a tapped chord (piano highlight)
  playhead: null,
  mic: null,
  trust: loadTrust(),
  modeId: null,      // mood the user picked (null = follow the detected key)
  tonic: null,       // home note, locked once a mood is picked
  modes: [], mode: null,
  // derived
  notes: [], key: null, keys: [], flats: false, fingering: [], progression: [], palette: [], chordsAt: new Map(),
  noteChords: [],     // chords containing the note in focus (playing, else selected)
};

// ---------- Analysis ----------

function setAnalysis({ frames, recording }) {
  const { notes, tuning } = transcribe(frames, { trust: state.trust });
  state.frames = frames;
  state.detected = withIds(notes);
  state.original = state.detected;
  state.history.clear();
  state.tuning = tuning;
  state.recording = recording;
  state.selected = null;
  state.chordTones = [];
  state.modeId = null;
  state.tonic = null;
  derive();
  renderAll();
}

function derive() {
  const shift = state.octave * 12;
  state.notes = state.detected.map((n) => ({ ...n, midi: n.midi + shift, nearest: n.nearest == null ? null : n.nearest + shift }));
  state.keys = guessKey(state.notes);
  state.key = state.keys[0] || null;
  state.flats = state.key ? keyUsesFlats(state.key) : false;

  // Moods (modes) around the home note; the chosen one supplies the chord set.
  const tonic = state.tonic ?? state.key?.tonic;
  const auto = defaultModeId(state.key, state.notes);
  state.modes = tonic != null && state.notes.length ? rankModes(state.notes, tonic, state.modeId || auto) : [];
  state.mode = state.modes.find((m) => m.mode.id === (state.modeId || auto)) || state.modes[0] || null;
  if (state.mode && state.modeId) state.flats = prefersFlats(state.notes, tonic, state.mode.mode);

  const { progression } = suggestChords(state.notes, state.key, { chords: state.mode?.chords });
  const palette = (state.mode?.chords || [])
    .filter((c) => c.quality !== 'dim')
    .sort((a, b) => b.weight - a.weight || a.degree - b.degree);
  state.progression = progression;
  state.palette = palette;
  state.chordsAt = new Map(progression.map((p) => [p.firstIndex, p.chord]));
  state.fingering = fingerMelody(state.notes);
}

// ---------- Rendering ----------

let roll = null;
let metro = null;

function renderRoll() {
  roll.render({
    notes: state.notes, frames: state.frames, tuning: state.tuning, shift: state.octave * 12,
    selected: state.selected, flats: state.flats,
  });
  const sel = state.selected != null;
  for (const id of ['ed-up', 'ed-down', 'ed-split', 'ed-delete', 'ed-shorter', 'ed-longer']) $(id).disabled = !sel;
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
  if (!state.notes.length) { el.innerHTML = ''; return; }
  const [k1, k2] = state.keys;
  const close = k2 && k1.score - k2.score < 0.08;
  const mids = state.notes.map((n) => n.midi);
  const lo = Math.min(...mids), hi = Math.max(...mids);
  const tune = Math.round(state.tuning * 100);
  const fact = (label, v, small = '') => `<div class="fact"><span class="label">${label}</span><span class="v">${v}${small ? `<small>${small}</small>` : ''}</span></div>`;
  el.innerHTML = [
    state.modeId && state.mode
      ? fact('Mood', state.mode.name, 'picked by you')
      : fact('Likely key', k1.name, close ? `or ${k2.name}` : ''),
    fact('Notes', state.notes.length),
    fact('Range', `${midiToName(lo, { flats: state.flats })}–${midiToName(hi, { flats: state.flats })}`),
    fact('Your tuning', Math.abs(tune) < 8 ? 'Spot on' : `${Math.abs(tune)}¢ ${tune > 0 ? 'sharp' : 'flat'}`, Math.abs(tune) >= 8 ? 'corrected for you' : ''),
  ].join('');
  $('key-label').textContent = state.mode ? `Home note ${state.mode.name.split(' ')[0]}` : '';
}

function renderBlocks() {
  $('blocks').innerHTML = blocksView({
    notes: state.notes, fingering: state.fingering, chordsAt: state.chordsAt, flats: state.flats,
    instrument: state.instrument, active: state.active, selected: state.selected,
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
  $('staff').innerHTML = staffView({
    notes: state.notes, flats: state.flats, instrument: state.instrument, chordsAt: state.chordsAt,
    active: state.active, selected: state.selected,
  });
}

function renderChords() {
  const chip = (c, sub, i, kind) => `<button type="button" class="chip${c.signature ? ' sig' : ''}" data-kind="${kind}" data-i="${i}"><b>${c.name}</b><span>${sub}</span></button>`;
  $('progression').innerHTML = state.progression.length
    ? state.progression.map((p, i) => chip(p.chord, `${p.chord.numeral} · notes ${p.firstIndex + 1}–${p.firstIndex + p.noteCount}`, i, 'prog')).join('')
    : '<div class="empty">Chords appear once there are notes.</div>';
  $('palette').innerHTML = state.palette.map((c, i) => chip(c, c.signature ? `${c.numeral} · signature` : c.numeral, i, 'pal')).join('');
  $('prog-label').textContent = state.mode ? `For each phrase, in order · ${state.mode.name}` : 'For each phrase, in order';
  $('palette-label').textContent = state.mode ? `All chords in ${state.mode.name}` : 'Other chords';
  renderModes();
  renderNoteChords();
}

/** One card per mood: does the melody fit, what gives it its colour, its signature progression. */
function renderModes() {
  const chosen = state.mode?.mode.id;
  $('modes').innerHTML = state.modes.map((r) => {
    const sig = r.mode.prog.map((d) => r.chords[d]);
    const fits = r.fit >= 0.999;
    const fitLine = fits
      ? '<span class="fit ok">✓ Fits your melody as hummed</span>'
      : `<span class="fit change">Change ${r.clashes.join(', ')} to go this way</span>`;
    const on = r.mode.id === chosen;
    return `<article class="mode${on ? ' on' : ''}" aria-current="${on}">
      <h3>${r.name}${r.mode.alt ? `<small>${r.mode.alt}</small>` : ''}</h3>
      <p>${r.mode.mood}</p>
      ${fitLine}
      <div class="sig"><span>${sig.map((c) => `<b>${c.name}</b>`).join(' → ')}</span><span class="nums">${sig.map((c) => c.numeral).join(' – ')}</span></div>
      <p class="colour"><b>${r.colourNote}</b> is the key note here: ${r.mode.charText}.${r.showsColour ? ' Your melody already uses it.' : ''}</p>
      <div class="row">
        <button type="button" data-act="hear" data-id="${r.mode.id}">▶ Hear it</button>
        ${on ? '<button type="button" disabled>Using this</button>'
          : fits ? `<button type="button" class="primary" data-act="use" data-id="${r.mode.id}">Use these chords</button>`
          : `<button type="button" data-act="rewrite" data-id="${r.mode.id}">Rewrite melody in ${r.mode.name}</button>`}
      </div>
    </article>`;
  }).join('');
}

function onModeAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const r = state.modes.find((m) => m.mode.id === btn.dataset.id);
  if (!r) return;
  if (btn.dataset.act === 'hear') {
    playSequence([...r.mode.prog.map((d) => voiceChord(r.chords[d])), voiceChord(r.chords[0])]);
  } else if (btn.dataset.act === 'use') {
    state.tonic = r.tonic;
    state.modeId = r.mode.id;
    derive(); renderAll();
    setStatus(`Chords now follow ${r.name}. Press "Play with chords" to hear your melody in this mood.`);
  } else if (btn.dataset.act === 'rewrite') {
    applyEdit({ type: 'mode', modeId: r.mode.id, tonic: r.tonic });
  }
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
  state.noteChords = chordsWithNote(n.midi, state.key);
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

function setStatus(msg, warn = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('warn', warn);
}

// ---------- Actions ----------

async function toggleRecording() {
  if (state.mic) return stopRecording();
  stopPlayback();
  state.recTempo = metro.metronome?.running ? { bpm: metro.bpm, sig: metro.sig } : null;
  setStatus('Asking for your microphone…');
  try {
    let lastRender = 0;
    state.frames = [];
    let peakInput = 0;
    const startedAt = performance.now();
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
    });
    $('rec').classList.add('on');
    $('rec-label').textContent = 'Stop';
    $('mode-label').textContent = 'Listening';
    setStatus(`Listening on ${state.mic.label}. Hum one note at a time, then press Stop.`);
  } catch (err) {
    state.mic = null;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(
      inArtifact || err.message === 'no-mic-api'
        ? 'Live humming needs microphone access, which this preview doesn\'t allow. Record a voice memo on your phone and upload it, or open the GitHub Pages version.'
        : denied
          ? 'Microphone access was blocked. Allow it in your browser\'s site settings, or upload a recording instead.'
          : `Couldn't start the microphone (${err.name || err.message}). Try uploading a recording instead.`,
      true,
    );
  }
}

function stopRecording() {
  state.micLabel = state.mic.label;
  const rec = state.mic.stop();
  showInputLevel(0);
  state.mic = null;
  $('rec').classList.remove('on');
  $('rec-label').textContent = 'Start humming';
  $('mode-label').textContent = 'Your hum';
  showLive(null);
  state.source = 'mic';
  analyseRecording(rec, 'your hum');
}

function analyseRecording(rec, label) {
  setStatus('Finding the notes…');
  // Let the status paint before the (sub-second) analysis blocks the thread.
  setTimeout(() => {
    const frames = analyseBuffer(rec.samples, rec.sampleRate);
    setAnalysis({ frames, recording: rec });
    const n = state.notes.length;
    const guesses = state.notes.filter((x) => x.adjusted).length;
    if (n) {
      setStatus(`Found ${n} note${n === 1 ? '' : 's'} in ${label}.${guesses ? ` ${guesses === 1 ? 'One was' : `${guesses} were`} between two notes, so I picked the one that fits the tune (dashed, marked ≈). Tap it to check.` : ''}`);
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
    analyseRecording(rec, file.name);
  } catch {
    setStatus('That file couldn\'t be read as audio. Try a .m4a, .mp3 or .wav voice memo.', true);
  }
  e.target.value = '';
}

function loadSample(name) {
  if (!DEMO_MELODIES[name]) return;
  stopPlayback();
  const rec = synthHum(DEMO_MELODIES[name]);
  $('mode-label').textContent = `Sample · ${name}`;
  Object.assign(state, { source: 'sample', micLabel: null, recTempo: null });
  analyseRecording(rec, `the "${name}" sample`);
}

const tick = (i, t) => {
  if (i !== state.active) { state.active = i; renderActive(); }
  state.playhead = t;
  renderTrace();
  roll.playhead(t);
};

function playMelody(withChords) {
  playNotes(state.notes, {
    timbre: state.instrument,
    progression: withChords ? state.progression : null,
    onTick: tick,
  });
}

async function saveMidi() {
  const bytes = toMidiFile(state.notes, state.progression);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hum-${state.key ? state.key.name.replace(' ', '-') : 'melody'}.mid`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  setStatus('Saved a MIDI file with the melody and chords. Drag it into Reaper or any DAW.');
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
    case 'mode': {
      const r = state.modes.find((m) => m.mode.id === edit.modeId);
      if (!r) return;
      const res = rewriteInMode(before, edit.tonic, r.mode);
      after = res.notes.map((n, k) => (n === before[k] ? n : { ...n, adjusted: false }));
      state.tonic = edit.tonic;
      state.modeId = edit.modeId;
      edit.changes = res.changes;
      edit.name = r.name;
      if (!res.changes.length) { derive(); renderAll(); return; }
      break;
    }
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
    state.selected = after.length ? Math.min(i, after.length - 1) : null;
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
    delete: () => 'Note deleted.',
    add: () => 'Note added. Drag it into place.',
    split: () => 'Note split in two.',
    merge: () => 'Joined with the next note.',
    mode: () => `Rewrote your melody in ${edit.name}: ${edit.changes.map((c) => `${c.from} → ${c.to}`).join(', ')}. Press Undo to go back.`,
    guess: () => (edit.keep ? `Kept ${midiToName(sel.midi, { flats: state.flats })}.` : `Changed to ${midiToName(sel.midi, { flats: state.flats })}, the note closest to what you hummed.`),
    reset: () => 'Back to exactly what you hummed.',
    undo: () => 'Undone.',
  }[edit.type];
  if (msg && (edit.type !== 'transpose' || sel)) setStatus(msg());
}

// ---------- Wiring ----------

function init() {
  metro = createMetronomePanel({ getCtx });
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
  $('zoom-out').addEventListener('click', () => roll.zoom(1 / 1.5));
  $('modes').addEventListener('click', onModeAction);
  $('guess-undo').addEventListener('click', () => applyEdit({ type: 'guess', keep: false }));

  const sel = $('sample');
  for (const name of Object.keys(DEMO_MELODIES)) sel.add(new Option(name, name));
  sel.addEventListener('change', () => loadSample(sel.value));
  $('rec').addEventListener('click', toggleRecording);
  $('file').addEventListener('change', onFile);
  $('play-notes').addEventListener('click', () => playMelody(false));
  $('play-chords').addEventListener('click', () => playMelody(true));
  $('play-hum').addEventListener('click', () => state.recording && playRecording(state.recording, { onTick: tick }));
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
    playOnce(voiceChord(chord), 'piano');
    if (state.instrument === 'piano') renderInstrument();
  };
  $('progression').addEventListener('click', onChord);
  $('palette').addEventListener('click', onChord);
  $('note-chords').addEventListener('click', onChord);

  window.addEventListener('resize', () => { renderTrace(); renderRoll(); });
  loadSample('Ode to Joy');
  sel.value = 'Ode to Joy';
}

init();
