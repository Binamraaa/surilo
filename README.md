# Hum to Notes

Hum a melody you know by ear and see the notes, where to play them on guitar or piano, the likely key, and chords that fit.

Made for beginner and intermediate players who can hum a tune but can't yet find it on their instrument. It's built for quick experimenting, not studio-grade transcription.

**Live demo:** https://binamraaa.github.io/hum-to-notes/

<!-- Add a demo GIF here: docs/demo.gif -->

## What it does

- **Live tuner.** Shows the note you're humming right now, plus a needle for how sharp or flat you are.
- **Note blocks.** Cleans up your hum and turns it into a row of notes. It smooths out vibrato and scoops, ignores breaths, and keeps repeated notes ("da-da") separate.
- **Fix the notes.** An editable piano roll. Drag a note up or down when you hummed a bit flat or sharp, drag its edges to change its length, and add, split, join or delete notes, with undo. A faint line shows your actual voice. Every other view, playback and the MIDI file follow your edits.
- **Tuning correction.** Most people hum a little sharp or flat, and drift further as they go. The app follows your tuning through the hum and snaps each note relative to where your voice is at that point.
- **Best-guess notes.** When you land halfway between two notes, the app picks the one that fits the key and the notes around it, and marks it (dashed, ≈). Tap it to keep the guess or switch to the other note. Your answers tune how much it leans on the key, saved on your device only.
- **Guitar view.** Puts each note on the fretboard in the easiest place to play. A small path-finding step (Viterbi) favours low frets and open strings and keeps your hand from jumping around.
- **Piano view.** Highlights the hummed notes on a keyboard.
- **Staff view.** Writes the notes on a staff. Guitar uses treble clef with an 8 below (guitar is written an octave higher than it sounds). Piano picks treble or bass clef to suit the range.
- **Key and chords.** Guesses the key with Krumhansl–Kessler key profiles, penalising keys that would make your notes "wrong". It then suggests one chord per phrase.
- **Playback.** Plays the notes, the notes with backing chords, or your original hum, so you can compare by ear.
- **MIDI export.** Saves the melody and chords as a `.mid` file you can drop into Reaper or any DAW.
- **Input options.** Works with the mic, with an uploaded voice memo, or with the built-in sample hums.

Everything runs in the browser. No audio leaves your device.

## Run it

It's a static site with no build step:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The microphone only works on `https://` or `localhost`.

To deploy, push to GitHub and turn on **Settings → Pages → Deploy from branch → main / root**.

## Tests

```bash
npm test
```

The tests synthesise realistic hums, with vibrato, scoops into notes, detuning, breath noise and gaps. They check that each sample melody comes back note for note, and they also cover key detection, chord choice, guitar fingering and staff spelling.

For a wider check, `node scripts/sweep.mjs` hums 522 synthetic melodies: steady singers, sloppy ones (each note off by up to ±40 cents, voice drifting by half a semitone) and tunes with notes outside their key. It reports how many come back right. On sloppy singers, best-guess notes take whole melodies right from 71% to 91%, and single notes from 93.8% to 97.9%.

## Project layout

```
src/core/      pure logic: no DOM, no Web Audio, runs in Node
  pitch.js     YIN pitch detector, loudness gate, buffer analysis
  notes.js     pitch frames → stable notes (smoothing, segmentation, tuning offset)
  intent.js    pick the note you meant: follows drift, weighs the key and nearby notes
  theory.js    key guess, chord suggestions, guitar fingering, staff spelling
  midi.js      Standard MIDI File writer
  demo.js      synthetic hum generator (samples and tests)
src/audio/     mic capture, file decoding, playback synth
src/ui/        SVG/canvas views
src/app.js     wiring
scripts/build-single.mjs   optional: bundle into one self-contained HTML file
scripts/sweep.mjs          accuracy sweep over hundreds of synthetic hums
```

`src/core` is kept separate on purpose. The same pitch-to-note module can later send hummed ideas into a DAW as MIDI.

## Roadmap

- [ ] Offline support (service worker), so it installs as a full PWA
- [ ] Rhythm: quantise note lengths to beats and show proper note values
- [ ] Spotify Basic Pitch as an optional "high quality" mode for recordings
- [ ] Chord shapes (guitar diagrams) for the suggested chords
- [ ] Transpose to a capo position or an easier key

## Tips for good results

Hum on "mmm" or "doo", one note at a time, in a quiet room. Leave a tiny gap between repeated notes.

## License

MIT
