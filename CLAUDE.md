# Hum to Notes: notes for Claude Code

A browser app: hum a melody, then see the notes as blocks, on a guitar fretboard, a piano and a staff, with a key guess and chord suggestions. It's a public GitHub portfolio project. It's meant for quick experimenting, not studio-grade transcription.

## Stack and constraints
- Vanilla JS ES modules, no framework and **no build step**. `index.html` loads `src/app.js` directly. Keep it that way so GitHub Pages serves the repo root as-is.
- No runtime dependencies. `esbuild` is a dev-only dependency, used only by `scripts/build-single.mjs` (an optional single-file bundle in `dist/`, which is gitignored).
- The mic needs `https://` or `localhost`.

## Commands
- `npm test`: Node's built-in test runner on `test/*.test.mjs`. Run it after any change to `src/core`.
- `node scripts/sweep.mjs [steady|sloppy|chromatic] [--misses]`: accuracy sweep over 522 synthetic hums. Caches pitch frames in `.cache/` (gitignored); delete it after changing `pitch.js` or `demo.js`.
- `python -m http.server 8000` (or `npx serve`), then open http://localhost:8000
- `npm run build`: bundles `dist/hum-to-notes.html` and `dist/embed.html` (needs `npm i`)

## Architecture
- `src/core/`: **pure logic, with no DOM and no Web Audio**. It must keep running in Node. This module will later feed hummed ideas as MIDI into a separate Reaper-based "AI producer" project, so keep it clean and dependency-free.
  - `pitch.js`: YIN detector (input is downsampled ×2 when the sample rate is above 30 kHz), RMS gate, `analyseBuffer`, adaptive gate
  - `notes.js`: `framesToNotes`. Median smoothing, then segmentation: a pitch change has to hold for `changeMs`, a loudness dip followed by a rise re-articulates repeated notes, the attack (first 25%) is ignored when picking a note's pitch, and the tuning offset is estimated from note centres (circular mean)
  - `theory.js`: Krumhansl–Kessler key profiles plus an out-of-scale penalty and a small major-key prior; chord suggestions per phrase (groups of 4 notes or split on pauses, with a cadence bonus on the last note); `chordsWithNote` (the chords that contain one note, used live and for the playing or selected note); `voiceChord` (plays chords around E3–D♯4 so small speakers can reproduce them); Viterbi guitar fingering; staff spelling
  - `intent.js`: `transcribe` = `framesToNotes` + `intendNotes`. Follows the singer's drift (circular mean over ±6 neighbouring notes, unwrapped note by note, leaving the note itself out). Notes more than 20¢ from a semitone get two candidates, and a Viterbi pass scores pitch distance, a mild out-of-key penalty and melodic step size. Notes it moves get `adjusted: true` + `nearest`. `trust` (learnt in app.js from Keep/Use answers, kept in localStorage) scales the key and step terms
  - `modes.js`: seven moods around a home note (Ionian, Mixolydian, Lydian, Dorian, Aeolian, harmonic minor, Phrygian). `rankModes` scores how well the melody fits each one and lists the clashing notes, `modeChords` builds triads with Roman numerals, and `rewriteInMode` moves clashing notes degree by degree. **Spelling goes by scale degree** (`spell()`, `prefersFlats()`): C♯ in D harmonic minor, D♭ in C Phrygian
  - `edit.js`: pure note-editing operations (transpose, reshape, add, delete, split, merge) plus an undo stack. Every operation returns a new array, and notes carry a stable `id` so the selection follows a note when the array is re-sorted
  - `midi.js`: SMF format 1 writer (conductor track, melody track, chords track)
  - `demo.js`: synthetic hum generator (vibrato, scoops, detune, noise, plus optional `sloppyCents` per-note misses and `driftCents`). Used by the sample dropdown, the tests and the sweep
- `src/audio/`: `mic.js` (ScriptProcessor, hop 1024, rolling loudness gate between the room noise and the loud end of the last ~3 s, so it works with quiet laptop mics), `synth.js` (playback)
- `src/ui/views.js`: functions that return SVG/HTML strings, plus `drawTrace` (canvas). They hold no state.
- `src/ui/roll.js`: the editable piano roll. **Mobile is the priority, because this is heading towards an app.** Rows are 30 px and resize zones 18 px on `(pointer: coarse)`. A touch that starts on a note calls `preventDefault` on `touchstart` (a non-passive listener, in the capture phase), so the page doesn't scroll. **Never re-render the roll during pointerdown**: it replaces the touched element, and mobile browsers then lose the touch and scroll the page. Selection is applied on pointerup. On phones the toolbar docks to the bottom of the screen (`.tools.docked`) while a note is selected. Zoom is `roll.zoom(factor)`. Pointer drags lock to one axis (vertical = pitch, horizontal = time or edge resize), and only the dragged bar is redrawn until you let go. It sends `onEdit({type, ...})` to `applyEdit` in app.js
- **Moods:** `state.modeId` and `state.tonic` are null until the user picks a mood; then the home note is locked, so rewriting the melody doesn't move it. `derive()` passes the chosen mode's chords to `suggestChords({chords})`.
- **Editing model:** `state.detected` is the single source of truth (detected first, then edited); `state.original` holds the notes as detected, for Reset. `derive()` feeds everything else from `state.detected`, including playback and the MIDI file.
- `src/app.js`: a single `state` object; `derive()` recomputes everything that depends on the notes, and the `render*()` functions draw it.

## Conventions
- Pitch is a float MIDI number throughout (69 = A4, middle C = C4 = 60). Notes are `{midi, pitch, cents, start, end}`, with times in seconds.
- All colours come from CSS custom properties in `styles.css`, in light and dark sets. Use `style="fill:var(--x)"` in SVG, never hard-coded colours.
- Copy is written for beginners: plain words, no jargon without explanation.

## Accuracy baseline
`scripts/sweep.mjs`, as of 2026-10-13. "Any key" counts a hum as right if every note is off by the same semitone: a singer 55¢ flat throughout could have meant either key.
- steady (270 hums): 100% exact, with plain rounding and with intent.
- sloppy (192): plain rounding 66.1% exact / 71.4% any key / 93.8% notes. With intent: 81.3% / 90.6% / 97.9%. Most of the gain comes from following drift. Only about 2 in 3 key-based adjustments are right (19 of 29), which is why they're marked and one tap undoes them.
- chromatic (60): 100% with both.
Re-run before and after changing segmentation or intent parameters. Tune on some seeds and check on others, because the synthetic singers are only a stand-in for real voices.

## Roadmap
Demo GIF for the README · real-voice testing on phones · installable app (offline service worker → Capacitor) · service worker (offline PWA) · rhythm quantisation · Spotify Basic Pitch as an optional high-quality mode · chord shape diagrams · capo/transpose.
