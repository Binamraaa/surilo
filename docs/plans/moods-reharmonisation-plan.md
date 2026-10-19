# Plan: moods as reharmonisation (v0.5)

> Put this file at `docs/plans/moods-reharmonisation.md`. Claude Code: read `CLAUDE.md` first, then work through the phases in order, with green tests and one commit per phase. No `Co-Authored-By` trailers or any other co-author line in commits.

## The idea in one line

**The melody never changes. A mood only changes the chords underneath it.** The user hums once, then hears the same tune as bright, dark, dreamy, bluesy and so on. They can also move between moods partway through, for example "bright verse, dark ending".

This replaces the current scale-based "modes" feature: the cards that say "change E to go this way" and the **Rewrite melody in…** button.

## Rules (these are the acceptance tests)

1. **The notes are never touched.** No mood or journey (a sequence of moods across the melody, see below) can change a note's pitch, start or end. Test this on every mood and every journey.
2. **Every chord supports the melody note it sits under.** On strong beats and long notes, the melody note must be a chord tone, or a tension (an extra colour note) the mood allows. Short notes on weak beats may be passing notes.
3. **If a mood has no chord that fits a moment, borrow one.** Use the closest chord that contains the melody note, mark it "borrowed" in the UI, and never fail.
4. **Same input, same chords.** No randomness without a fixed seed.

## Concepts

- **Slot:** a span of time that gets one chord. With tempo, from the metronome plan: one chord per bar by default, or half a bar for moods with faster chord changes. Without tempo: the existing phrase grouping (4 notes, or split on pauses).
- **Home note:** the key's tonic from `guessKey`, the same as now. The user can override it.
- **Mood:** a harmonisation recipe, not a scale. It's made of a chord palette, which chords it likes to move between, which tensions it allows, how it ends a phrase, and how fast its chords change.
- **Journey:** the mood for each slot across the melody, so moods can change partway through.

## Chord vocabulary (v1)

`maj`, `min`, `dim` (passing only), `sus2`, `sus4`, `7`, `maj7`, `m7`, `add9`, `6`, plus slash chords (a chord over a different bass note) for the Floating mood.

**Compatibility table** (`src/core/harmony.js`, plain data and tested). For each chord quality, list the melody intervals above the chord root (in semitones) that are:
- **chord tones** (score 1.0)
- **allowed tensions** (score 0.6, if the mood allows colour)
- **avoid notes** (a strong penalty on strong beats or long notes; mild on short, weak ones)

Examples:
- `maj`: tones 0, 4, 7. Tensions 2 (the 9th) and 9 (the 6th); 11 (the major 7th) only in colourful moods. Avoid 1 (♭9) and 5 (the 4th, which clashes with the major 3rd).
- `min`: tones 0, 3, 7. Tensions 2, 5 (the 11th) and 10 (the ♭7). Avoid 1 and 4.
- `sus2`/`sus4`: avoid the 3rd on long notes.
- `7`: tones 0, 4, 7, 10. In the Bluesy mood the ♯9 (3) is allowed as a blue note.

## Moods (v1)

Each card shows a beginner name plus the music-theory name in small text, and degrees are relative to the home note.

| Mood | Theory flavour | Palette (by preference) | Signature moves | Ending | Chord changes |
|---|---|---|---|---|---|
| **Bright** | Major (Ionian) | I, IV, V, vi, ii | V→I, IV→I | V→I | per bar |
| **Bittersweet** | Major, leaning on its minor chords | vi, IV, I, V, iii | vi→IV→I→V | ends on IV or vi (unresolved) | per bar |
| **Dark** | Minor (Aeolian), borrowing from the parallel minor | i/vi, iv, ♭VI, ♭VII, v | ♭VI→♭VII→i | ♭VII→i | per bar |
| **Hopeful minor** | Dorian | i, IV (major), ♭VII, ii | i→IV vamp | IV→i | per bar |
| **Bluesy** | Mixolydian / dominant | I7, IV7, ♭VII, V7 | I→♭VII→IV | IV→I | per bar |
| **Dreamy** | Lydian | Imaj7, II (major), vi, Iadd9, sus2 | I→II | stays on I | every two bars |
| **Epic / tense** | Phrygian and harmonic minor | i, ♭II, V (major), ♭VI, a pedal bass | i→♭II, ♭VI→V | V→i | per bar |
| **Jazzy** | Functional with 7ths | ii7, V7, Imaj7, vi7, secondary dominants (V7 of ii and V) | ii7→V7→Imaj7 | ii→V→I | half bar |
| **Floating / prog** | Ambiguous, Steven Wilson-style | sus2, sus4, add9, slash chords over a held bass, ♭VI and III (major), no strong V→I | moves to chords a third away, chords over a held bass | never on a plain V→I | per bar |

Store each mood as data in `src/core/moods.js` (palette, transition bonuses, allowed tensions, cadence rule, chord-change rate, short description), so new moods are easy to add.

## Engine: `src/core/harmony.js`

`harmonise(notes, { home, slots, journey, seed, variations = 3 })` returns `[{ slotIndex, chord, roman, borrowed, why }]` × `variations`.

- **Candidates per slot:** the chords in this slot's mood palette, plus every chord from `chordsWithNote` (it already exists in `theory.js`) for the slot's main melody note, marked borrowed and penalised.
- **Emission score:** the duration- and beat-weighted compatibility of every melody note in the slot, from the table, with strong beats and long notes counting more. Without tempo, the first note of the slot and the longest note count as strong.
- **Transition score:** the mood's signature-move bonuses, a voice-leading bonus for shared notes between consecutive chords, a mild penalty for repeating a chord more than twice, and the cadence rule at a phrase end and at the very end.
- **Search:** a Viterbi pass (the most likely path through the slots) for the best progression, plus a k-best Viterbi, or a beam search with a fixed seed, for the 2–3 **variations** ("Try another version"). Drop near-duplicates (variations that differ by only one chord).
- **Journeys:** at a slot where the mood changes, add a bonus for a **pivot chord** that's in both palettes. If there isn't one and the melody allows it, allow a turnaround: the V7 of the next mood's first chord.
- **`why`** gives the reason in plain words, for learning: "Your E is the 3rd of C", "Your G is the 9th of Fadd9: a softer colour", or "borrowed from minor".

`src/core/modes.js`: keep `spell()` and `prefersFlats()` for chord names. Remove `rewriteInMode` and `rankModes`, along with the UI that uses them (see Phase 3). The scale data stays as the source for the mood palettes.

## Journeys (mood transitions)

- **Presets:** `Steady` (one mood throughout), `Bright → Dark`, `Dark → Hopeful` (a minor journey ending on a major home chord, the "Picardy" lift), `Build-up` (Bright → Epic), `Dreamy → Bright`, `Bittersweet → Bright` (resolution).
- **Custom:** a mood strip under the note blocks with one segment per slot (or per phrase). Tap a segment to pick its mood; long-press to apply the same mood from that point to the end.
- A journey changes only chords: Rule 1 applies.

## UI

**Mood cards** (replace the current mode cards):
- Name and theory flavour in small text; a one-line feel ("Sad, serious, emotional"); **your melody's progression in this mood**, as chord chips with Roman numerals; borrowed chords shown dashed.
- **▶ Hear it** plays the melody with these chords.
- **Use this mood** applies it to the whole melody, or to the selected segment on the mood strip.
- **Try another version** cycles through the variations.
- The "Fits / Change C to go this way" line is gone, and nothing on a card ever suggests changing a note.

**Chords for each phrase:** each chip shows its `why` on tap, and the existing keyboard highlight keeps working.

**Mood strip and journey presets:** under the note blocks, with the preset chips beside it ("Bright → Dark", …).

**Mobile:** horizontally scrolling cards (as now), 44 px targets, and the mood strip segments at least 44 px wide (it scrolls with the roll's zoom).

Playback with chords, the MIDI chord track and the keyboard view all use the active journey.

## Phases

1. **Engine:** the `harmony.js` compatibility table, candidate generation, Viterbi plus variations, and `moods.js` with all nine moods. Unit tests (below). No UI changes yet.
2. **Journeys:** pivot and turnaround logic and the presets, with tests.
3. **UI:** replace the mode cards with mood cards, add the mood strip and the journey presets, remove the rewrite button, `rewriteInMode` and `rankModes`, and update the README and CLAUDE.md.
4. **Bars:** once metronome Phase 3 (quantising) has landed, use bars and half bars as slots, put chords on the beat grid in the MIDI chord track, and choose harmonic rhythm per mood. Until then, slots are phrases.

## Tests

- **The melody is untouched:** for every mood × every preset journey × the demo melodies, the pitches and timings of the notes are identical before and after.
- **Every chord supports its notes:** in every output, each strong-beat or long note is a chord tone or an allowed tension of its chord, or the chord is marked borrowed.
- **The moods really differ:** on Ode to Joy, at least 6 of the 9 moods give different progressions, and Bright and Dark share fewer than half their chords.
- **Known answers:** Ode to Joy's first phrase (E E F G) in Bright starts on C; in Dark, a chord with E as its root or 5th (Am or Em); in Floating, a sus or add9 chord.
- **Endings:** Bright ends V→I; Bittersweet doesn't end on I; Floating never ends on a plain V→I.
- **Journeys:** `Bright → Dark` changes mood at the given slot, uses a pivot chord when one exists, and keeps the melody untouched.
- **Repeatable:** the same input and seed give the same output.
- **MIDI:** the chord track equals the active journey's chords.

## Acceptance checklist

- [ ] I hum once, tap through the moods and hear the same tune feel different, and no note in the roll ever moves.
- [ ] "Try another version" gives a genuinely different progression in the same mood.
- [ ] I can make the last phrase Dark and the rest Bright, and the change sounds intentional (a pivot or a turnaround).
- [ ] Tapping a chord tells me why it fits ("your E is the 3rd of C").
- [ ] The saved MIDI file's chord track matches what I heard.
- [ ] Works well on a phone.
- [ ] `npm test` passes; the transcription sweep is unchanged.

## Order relative to the metronome plan

The two plans are independent. Phases 1–3 here work without tempo, because they fall back to phrases. Phase 4 needs metronome Phase 3. Either order works; doing the metronome first makes the chord changes land on bars from day one.

## Later

- Seventh-chord voicings tuned to the instrument (guitar shapes, piano voicings)
- Bass lines and arpeggio patterns per mood
- "Style of" presets inspired by producers' harmonic habits (links to the AI-producer project)
