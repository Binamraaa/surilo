# Surilo

**Surilo** (सुरिलो, Nepali for *tuneful*) turns a hummed melody into notes, chords and where to play them. Hum a tune you know by ear and see the notes, where to play them on guitar or piano, the likely key, and chords that fit in nine moods.

Made for beginner and intermediate players who can hum a tune but can't yet find it on their instrument. It's built for quick experimenting, not studio-grade transcription.

**Nothing is generated.** Surilo never writes music for you: every note is one you hummed, and a mood only changes the chords underneath. It's a tool to help you find your own music.

**Free for everyone, always.** No ads, no account, and your voice never leaves your device. If Surilo helps you, you can leave a tip; it unlocks nothing.

**Try it:** https://surilo.vercel.app

<!-- Add a demo GIF here: docs/demo.gif -->

## What it does

- **Built for phones.** Four sections, Hum, Notes, Chords and Play, with tabs at the bottom of the screen like an app, and a playback bar (notes, notes with chords, or your own hum) that stays in reach on every section. The top bar shows the key and mood; tap it to change the chords.
- **Metronome.** Set the tempo with big − / + buttons (hold to keep going), a slider, or by tapping the beat. Choose 4/4, 3/4 or 6/8. Beat 1 is louder, and a row of dots shows where you are in the bar, so you can turn the sound off and follow the dots. It keeps your screen awake while it runs, and a small bar stays at the top of the screen when you scroll down to practise the melody.
- **Hum to a beat.** Choose a tempo, hear a bar of clicks, then hum while the dots keep time (the click goes quiet, so it works on a phone speaker), or keep the click going with headphones. The app lines your notes up with the beat, allows for singing a little late, and follows you if you speed up or slow down.
- **Live tuner.** Shows the note you're humming right now, plus a needle for how sharp or flat you are.
- **Note blocks.** Cleans up your hum and turns it into a row of notes. It smooths out vibrato and scoops, ignores breaths, and keeps repeated notes ("da-da") separate.
- **Fix the notes.** An editable piano roll. Drag a note up or down when you hummed a bit flat or sharp, drag its edges to change its length, and add, split, join or delete notes, with undo. A faint line shows your actual voice. Every other view, playback and the MIDI file follow your edits. On a phone, tap a note to bring up a bottom bar with big Lower/Higher, Shorter/Longer, Split, Join and Delete buttons. Rows get taller and there's a zoom control.
- **Tuning correction.** Most people hum a little sharp or flat, and drift further as they go. The app follows your tuning through the hum and snaps each note relative to where your voice is at that point.
- **Best-guess notes.** When you land halfway between two notes, the app picks the one that fits the key and the notes around it, and marks it (dashed, ≈). Tap it to keep the guess or switch to the other note. Your answers tune how much it leans on the key, saved on your device only.
- **Guitar view.** Puts each note on the fretboard in the easiest place to play. A small path-finding step (Viterbi) favours low frets and open strings and keeps your hand from jumping around.
- **Piano view.** Highlights the hummed notes on a keyboard.
- **Real rhythm.** Hum to a beat and the notes snap to it: the piano roll shows bars and beats (and drags snap to them), each note block shows its note value, and the staff is written with a time signature, bar lines, note values, beams, ties and rests, wrapping onto new lines on a phone.
- **Staff view.** Writes the notes on a staff. Guitar uses treble clef with an 8 below (guitar is written an octave higher than it sounds). Piano picks treble or bass clef to suit the range.
- **Key and chords.** Guesses the key with Krumhansl–Kessler key profiles, penalising keys that would make your notes "wrong", then picks a chord for each part of the melody. You can override the home note. Tap a chord to hear it and see why it fits ("Your E is the 3rd of C").
- **Moods.** Hum once, then hear the same tune as Bright, Bittersweet, Dark, Hopeful minor, Bluesy, Dreamy, Epic, Jazzy or Floating. A mood never changes a note: it only changes the chords underneath. Each mood is a recipe (which chords, which moves between them, which colour notes, how it ends, how often the chords change), and a small search (a k-best Viterbi) finds the progression that fits your melody best, plus other versions to try. Every chord supports the important notes over it, or is marked as borrowed from outside the mood.
- **Mood journeys.** Change mood partway through: presets like Bright → Dark, or Dark → Hopeful (which ends on a major chord, the "Picardy third"), or tap any part of the mood strip to set its mood yourself. Where the mood changes, the app looks for a chord both moods share, or leads in with a V7, so the change sounds intentional.
- **Playback.** Plays the notes, the notes with the chosen chords (the keyboard follows along), or your original hum, so you can compare by ear. With a beat, the notes play as written at the tempo, with an optional click.
- **MIDI export.** Saves the melody and chords as a `.mid` file you can drop into Reaper or any DAW. With a beat, the file carries the tempo and time signature and every note sits on the grid, so it lands in your DAW ready to use.
- **Set tempo.** For an uploaded voice memo (or to change a hum's beat): type or tap the BPM, pick 4/4, 3/4 or 6/8, and say whether the tune starts on beat 1 or a beat early. The samples come with their own beat, so the rhythm shows straight away.
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

## Testing with real voices

The synthetic sweep checks the code, but only real hums show how well it works on real voices and phone mics. To build a set of real test hums:

1. Open the app with `?test=1` at the end of the address, e.g. `https://surilo.vercel.app/?test=1`. Test mode stays on on that device, including in the installed app, until you tap **Turn off** (or open it with `?test=0`).
2. Hum a song you know well, then fix every wrong note in the editor. The notes as you leave them are the answer key.
3. Type the song name and tap **Save as test**. On a phone this opens the share sheet: save the file to a Drive folder. On a computer it downloads.
4. Run the report on that folder:

```bash
node scripts/real-hums.mjs "G:/My Drive/Hum to Notes tests" --misses
```

Each test is a single `.wav` file at the recording's own sample rate, with the answer key (the detected notes, your corrected notes, the mic, the phone, the tempo if the metronome was on) stored inside it as JSON. It plays like any other WAV. The report runs every file through the current code and counts each kind of mistake: a semitone off, an octave off, one note split in two, two notes merged, notes missing, and extra notes. The recordings stay out of the repo.

## Project layout

```
src/core/      pure logic: no DOM, no Web Audio, runs in Node
  pitch.js     YIN pitch detector, loudness gate, pYIN-style pitch tracking
  notes.js     pitch frames → stable notes (smoothing, segmentation, tuning offset)
  intent.js    pick the note you meant: follows drift, weighs the key and nearby notes
  rhythm.js    tempo, time signatures, beat grid, tap tempo
  theory.js    key guess, phrase slots, chords for a note, guitar fingering, staff spelling
  harmony.js   chords for a melody in a mood or a journey of moods (never changes the notes)
  moods.js     the nine moods and the journey presets, as data
  modes.js     the seven modes, and spelling notes by scale degree
  midi.js      Standard MIDI File writer
  wav.js       WAV writer and reader (test hums carry their answer key inside)
  demo.js      synthetic hum generator (samples and tests)
src/audio/     mic capture, file decoding, playback synth, metronome (lookahead click scheduler)
src/ui/        SVG/canvas views
src/app.js     wiring
scripts/build-single.mjs   optional: bundle into one self-contained HTML file
scripts/sweep.mjs          accuracy sweep over hundreds of synthetic hums
scripts/real-hums.mjs      accuracy report on real test hums saved from test mode
```

`src/core` is kept separate on purpose. The same pitch-to-note module can later send hummed ideas into a DAW as MIDI.

## Roadmap

- [ ] Offline support (service worker), so it installs as a full PWA
- [ ] Rhythm: quantise note lengths to beats and show proper note values
- [ ] Spotify Basic Pitch as an optional "high quality" mode for recordings
- [ ] Chord shapes (guitar diagrams) for the suggested chords
- [ ] Package as an installable app (offline service worker, then Capacitor for the app stores)
- [ ] Transpose to a capo position or an easier key

## Tips for good results

Hum on "mmm" or "doo", one note at a time, in a quiet room. Leave a tiny gap between repeated notes.

## Acknowledgements

Built with help from [Claude](https://claude.ai), Anthropic's AI assistant, used for coding and testing.

## License

The code is MIT licensed (see `LICENSE`): use it, fork it, build on it. The name **Surilo** and its logo aren't part of that licence; see [TRADEMARK.md](TRADEMARK.md).

MIT
