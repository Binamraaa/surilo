# Plan: metronome and rhythm (v0.4)

> Put this file at `docs/plans/metronome-rhythm.md` in the repo. Claude Code: read `CLAUDE.md` first, then work through the phases in order. Each phase ends with green tests and a commit.

## Goal

Hum to a tempo, get notes with real rhythm. The user picks a tempo and time signature and hears a count-in, the way Logic or Reaper do before recording. Then they hum, either with the click going quiet (default, works on speakers) or with the click playing throughout (headphones). Notes snap to the beat grid, so:

- the piano roll shows bars and beats, and edits snap to them
- the staff shows real note values (quarter, eighth, dotted, ties) with bar lines and rests
- **Save MIDI** carries the tempo and time signature, so the file lands on Reaper's grid with nothing to fix

The metronome also works on its own, as a practice tool for playing the melody back on guitar or piano.

## Decisions already made

| Topic | Decision |
|---|---|
| Recording flow | **Tempo first.** Pick a BPM, hear a count-in, then hum. No free-tempo guessing in v1. |
| Click while humming | Two modes. **Count-in only** (default): the click is audible for the count-in, then goes silent while the beat dots keep pulsing (and, optionally, the phone vibrates on each beat). No click reaches the mic. **Click throughout (headphones)**: the click plays for the whole hum, for the tightest timing. |
| Count-in length | 1 bar (default) or 2 bars |
| Tempo drift | Without an audible click, singers drift. The app tracks the singer's real tempo through the hum and straightens it to a steady grid. The MIDI file stays at the chosen BPM with notes on the grid. |
| Time signatures | 4/4, 3/4, 6/8 |
| Note values | whole, half, quarter and eighth notes, the dotted versions of each, ties across beats and bar lines, rests of the same values. Snap to eighths by default; sixteenths are a later option. |
| Standalone metronome | Yes, a simple one: BPM, tap tempo, time signature, accent on beat 1, visual pulse, sound on/off. |
| Uploads and samples | No click was involved. Show them as now (unquantised), with a **Set tempo…** action that quantises after the fact (phase 4). |

## Architecture (keep the existing rules)

- New pure module **`src/core/rhythm.js`**, with no DOM and no Web Audio, and tested in Node. Everything about grids, quantising and note values lives here, so the AI-producer project can reuse it later.
- New **`src/audio/metronome.js`**, the Web Audio click scheduler.
- Notes keep `start`/`end` in **seconds** (the audio truth). Quantising **adds** beat positions without throwing the seconds away:
  ```js
  { id, midi, start, end, ..., beat: 4.5, beats: 1, value: { base: 'quarter', dots: 0 }, ties: [...] }
  ```
  `beat` is the position from the start of bar 1, counted in quarter notes (4/4 and 3/4) or in eighths (6/8). Seconds = `offset + beat × secondsPerUnit`.
- New state in `app.js`: `state.tempo = { bpm, sig: '4/4', subdivision: 2, offset }`, or `null` for a hum with no click. `derive()` runs `quantize()` whenever `state.tempo` is set.
- Editing (`edit.js`) stays in seconds. With tempo on, the roll's snap turns drag distances into whole grid steps before calling `onEdit`, and `derive()` quantises again. No second source of truth.

## Phase 1: metronome engine and practice card

**`src/audio/metronome.js`**
- Lookahead scheduler (the "two clocks" pattern): a `setInterval` of about 25 ms schedules clicks up to 100 ms ahead on `AudioContext.currentTime`. Never time clicks with `setTimeout` alone.
- Clicks are short synthesised blips: about 1.5 kHz on beat 1 (the accent) and 1 kHz on other beats, roughly 30 ms with a fast decay. 6/8 accents beats 1 and 4.
- API:
  ```js
  const m = createMetronome(ctx);
  m.start({ bpm, sig, countIn: 0 | 1, onBeat(beatIndex, barIndex, when) });
  m.stop(); m.set({ bpm, sig, sound, accent });
  m.clickTimes  // AudioContext times of every scheduled click (needed in phase 2)
  ```
- `onBeat` fires near each click (via `requestAnimationFrame` checks against `currentTime`) to drive the visual pulse.
- Request a screen wake lock while it's running, and tolerate a rejection.

**`src/core/rhythm.js` (start it here)**
- `secondsPerBeat(bpm, sig)`: in 6/8, BPM counts dotted quarters (two pulses per bar); say so in the UI.
- `tapTempo(timestamps)`: median interval over the last 4–8 taps, clamped to 40–240 BPM. Reset after a 2 s gap.

**UI: a "Metronome" card at the top of the page, or a bottom-sheet on phones**
- Big BPM number with − / + buttons (hold to repeat) and a slider from 40 to 240. **Tap** button. Time-signature chips (4/4, 3/4, 6/8). Sound on/off. A row of beat dots that light up, with beat 1 in the accent colour.
- Save the last BPM and signature in `localStorage`, inside try/catch.
- Mobile first: 44 px touch targets, and the BPM readable at arm's length.

**Tests:** `secondsPerBeat` for all three signatures; `tapTempo` with jittered taps; scheduler timing tested with a fake clock (inject `now()`).

## Phase 2: record with a count-in, in one of two click modes

**Flow:** tap **Start humming** → count-in (1 or 2 bars, audible click, beat dots counting down "4, 3, 2, 1") → bar 1 beat 1: recording starts → **Stop**.

**Recording setup** (a compact row above Start humming, remembered in `localStorage`):
- **Tempo**: shows the metronome's BPM and time signature; tap to change.
- **Click while humming**, a segmented control:
  - **Count-in only** (default). The audible click stops at bar 1. The beat dots keep pulsing silently for the whole hum, big enough to follow from the corner of your eye. Add an optional **Vibrate on the beat** toggle (`navigator.vibrate`, Android only; hide it where it's unsupported).
  - **Click throughout (headphones)**. The click continues during the hum. Before the first use, show: "Plug in headphones. Without them the mic hears the click." If the output device's label (`enumerateDevices`, where labels are available) clearly looks like the built-in speaker, show that hint again; never block the user.
- **Count-in**: 1 bar or 2 bars.
- **Off**: no tempo, just record (today's behaviour, `state.tempo = null`).

**Timing alignment** (both modes):
- Start capturing mic audio at the **start of the count-in**, not at bar 1, so a note that starts slightly early (or a pickup note) isn't cut off. Note the `ctx.currentTime` of the first mic frame and of bar 1 beat 1, and convert frame times so that **t = 0 is bar 1 beat 1**. Count-in frames are masked out (see click bleed below), except that a note may begin up to half a beat before bar 1.
- Compensate for latency: subtract `ctx.outputLatency + ctx.baseLatency` where available. An estimate is fine, because the next two steps catch the rest.
- **Offset correction:** estimate how consistently early or late the singer is, from the robust (circular) median of each onset's distance to its nearest grid line, and shift every note by that amount. Store it in `state.tempo.offset` and show it in the facts row ("You sang 40 ms behind the beat. Corrected.").
- **Tempo tracking** (mainly for count-in-only mode). Add `trackTempo(onsets, tempo)` to `rhythm.js`:
  1. Assign each onset to its nearest grid step using the current time-to-beat map, which starts as the chosen BPM.
  2. Refit the map as a smooth curve, using a piecewise-linear least-squares fit over a sliding window of about 2 bars, with the tempo limited to ±12% of the chosen BPM and only gradual changes allowed.
  3. Repeat 2–3 times until the assignments stop changing.
  4. Return `{ beatAt(seconds), secondsAt(beat), drift }`, where `drift` is the start-to-end tempo change in %.
  - Quantising then works in **beats** through this map, so a singer who sped up from 90 to 96 BPM still gets every note on the grid. Show it gently: "You sped up a little (90 → 95 BPM). Straightened to 90."
  - In click-throughout mode, run it too, but with a tighter limit (±3%), since the click keeps the singer steady.
- **Click bleed** (click-throughout mode, or the count-in if the singer starts early):
  - Keep the click short (about 30 ms) and high (1–1.5 kHz), so the YIN range and clarity gate mostly reject it.
  - Pass the exact click times to `framesToNotes` as an optional `mask` (a list of time windows of about 35 ms after each click). Masked frames keep their pitch, but can't start a note on their own.
- **iOS:** the mute switch silences Web Audio. If the count-in appears silent, show: "Can't hear the click? Turn off silent mode."

**Tests:**
- `synthHum` with a known BPM (extend it to return its beat grid), ±40 ms timing jitter and a fixed 60 ms lateness. After alignment, onsets should land within one eighth of the truth and the estimated offset within ±15 ms.
- **Drift:** a synthetic hum that speeds up linearly from 90 to 97 BPM, or slows from 100 to 92, in count-in-only mode. After tracking, every note should be on its true beat, and `drift` should be within ±1.5% of the truth.
- **Bleed:** mix synthetic click blips into the hum audio at the click times. With the mask on, no extra notes, no notes dropped.
- No tempo (Off) still matches today's results exactly.

## Phase 3: quantise, then show the rhythm everywhere

**`rhythm.js` → `quantize(notes, tempo)`**
1. Snap each onset to the nearest grid step (an eighth by default) after the offset. If two notes land on the same step, push the later one to the next step or merge them; never overlap.
2. Snap each end the same way, so the length is at least one step. Legato rule: if the gap to the next onset is shorter than one step, extend the note to it.
3. Split into **notatable values**: break at bar lines, and in 4/4 at the half bar, unless the note is exactly a half or whole note starting on a strong beat. Express each piece as one of the allowed values (dotted included) and join the pieces with `tie` flags. Fill gaps of at least one step with **rests** of allowed values.
4. Return `{ notes (with beat/beats/value/ties), rests, bars }`.
- In **6/8**, group in dotted quarters, so eighth notes are beamed in threes.

**Piano roll (`roll.js`)**
- With tempo set, draw the vertical grid as bars and beats: strong lines at bars with bar numbers, lighter lines at beats, faint lines at the snap step.
- Add a **Snap** toggle, on by default when tempo is set. While snap is on, moves and resizes jump in grid steps; the seconds-based behaviour stays the same when tempo is off.
- Keep everything already in CLAUDE.md for mobile: never re-render during pointerdown, rows 30 px on touch, and so on.

**Staff (`views.js` `staffView`)**
- Time signature at the start, and bar lines.
- Heads: hollow for half and whole notes, filled otherwise. Stems on everything shorter than a whole note. Flags on single eighths, and **beams** for eighths within the same beat group. Augmentation dots. Tie arcs.
- Rests: whole, half, quarter and eighth, drawn with the Noto Music glyphs that are already loaded (𝄻 𝄼 𝄽 𝄾).
- Keep the existing spelling (sharps or flats, the guitar treble-8vb clef).
- Wrap onto new lines every few bars on narrow screens rather than scrolling one very long staff.

**Note blocks:** add the note value under each name (♩, ♪, 𝅗𝅥, "dotted ♩"), and make block widths follow beats instead of seconds.

**Tests:** `quantize` on synthetic hums in all three signatures, giving the exact expected values, rests and ties. Cover dotted rhythms (Ode to Joy has a dotted quarter + eighth at the end), notes crossing bar lines (they get tied), and 6/8 grouping.

## Phase 4: MIDI, playback and uploads

- **MIDI (`midi.js`):** write the tempo meta event (`FF 51`) at the chosen BPM and the time-signature event (`FF 58`) for 4/4, 3/4 or 6/8. Note on/off positions come from the quantised `beat` values (480 ticks per quarter note), not from seconds. Bar 1 beat 1 is tick 0. Write the chord track on bars and beats too.
  - Test: parse the file back. The tempo, time signature, first note on tick 0 and note lengths in ticks must all match the quantised notes.
- **Playback:** play quantised notes at the tempo, with an optional "click during playback" toggle.
- **Uploads and samples:** a **Set tempo…** sheet with a BPM field (tap tempo works here too), a time-signature choice, and "first note is on beat 1" or "starts on the upbeat". Applying it runs the same `quantize` path. Give the built-in samples their real tempo and time signature (`synthHum` already knows its BPM), so the demo shows rhythm straight away.

## Acceptance checklist

- [ ] On a phone, I can set 90 BPM with the big buttons or by tapping tempo, start, hear the count-in, hum along and see notes on bars and beats.
- [ ] **Count-in only** (phone speaker, no headphones): the click stops at bar 1, the dots keep pulsing, and the transcription has no click artefacts.
- [ ] **Click throughout** (headphones): the click plays for the whole hum and the notes are on the grid.
- [ ] Humming a little late (about 50 ms) still lands notes on the right beats, and the app says it corrected the timing.
- [ ] Speeding up by about 5% during a count-in-only hum still lands every note on the grid, and the app says it straightened the tempo.
- [ ] The staff shows correct note values, rests, ties and bar lines for Ode to Joy (4/4) and a 6/8 sample.
- [ ] Dragging a note in the roll with Snap on moves it by whole grid steps.
- [ ] The saved MIDI opens in Reaper at the right tempo and time signature, with notes on the grid.
- [ ] The standalone metronome keeps steady time for at least 5 minutes, with the screen kept awake.
- [ ] Recording with Hum to a click turned off behaves exactly as it does today.
- [ ] `npm test` passes, and the existing accuracy sweep is unchanged when tempo is off.

## Conventions for this work

- Follow `CLAUDE.md`: no build step, no runtime dependencies, `src/core` pure and tested, colours from tokens, beginner-friendly copy, mobile first.
- **Commits: don't add `Co-Authored-By` trailers or any other co-author or contributor line for Claude.** Claude is credited only as an acknowledgement in the README.
- Commit once per phase, with a short, plain message.
- Update the README feature list and the CLAUDE.md architecture notes at the end of each phase.

## Out of scope for v1, noted for later

- Free-tempo humming (guessing the BPM from a hum with no count-in at all; the tempo tracking above is the foundation for it)
- Sixteenths, triplets, swing, and 5/4 and 7/8 (prog odd meters, a natural next step)
- Tempo changes partway through a hum
- Count-in lengths other than one bar
