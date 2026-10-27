# lofi-grove

A lo-fi loop for a living tree. The composition is static; the seed and the
moment choose among it, and the arrangement grows with the tree.

- **Eight songs.** Four major (Bloom, Canopy, Roots, Clearing) and four minor
  (Dusk, Frost, Embers, Hollow). Each is a whole arrangement, not just a chord
  progression: rootless jazz chords (maj9, m9, 13, sus9, 6/9) at their own
  chord speed, plus a tempo, swing, groove (boom bap, lazy pocket, rolling,
  half-time, brushes), keys rhythm (held pads, push and answer, stabs,
  rocking, swells, broken chord), bass line (root and push, root-fifth-octave,
  long root, walking, sparse), keys sound (felt piano, electric piano, soft
  organ, nylon guitar) and lead (kalimba, music box, wooden flute,
  vibraphone). Every two songs differ in at least three of these.
- **Species phrases.** One two-bar lead phrase per species: cherry, oak,
  pine, birch, willow, acacia, palm, spruce, redwood, maple, jacaranda,
  baobab, and the orchard's apple, pear, peach, plum, orange, lemon, fig and
  mango.
- **Seeded picks.** The seed fixes the key (F, E♭, D, C, B♭, G or A), which of
  the season's four songs plays, and a nudge of up to ±2 BPM on its tempo,
  for the tree's whole life.
- **Small variations.** Each bar's departures — a ghost kick, a skipped hat,
  a snare fill, a chromatic bass approach, a melody note moved a step, a held
  pad — are a pure function of the seed and the bar, so the same tree plays
  the same loop every time. The melody rests one pass in four and the kick
  drops on the last bar of that pass.
- **Clamps.** Tempo 64–88 BPM, swing 0.12–0.26, keys MIDI 52–76 (voice-led),
  bass 36–47, melody 62–88 on the pentatonic of the mode.
- **Seasons.** Spring and summer are major; autumn and winter play the
  relative minor of the same key, slower, darker and wetter. The equatorial
  seasons map the same way.
- **Growth.** A sprout hears felt keys and a two-note budding figure; a
  sapling adds wood knocks and hats; a young tree the kit and bass; a mature
  tree its melody. The budding figure that closes each eight-bar form gains a
  note per stage and falls instead of rising in the minor seasons. Old trees
  slow, thin the melody and deepen the tape wow; a dead snag is keys, crackle
  and hiss, slowed to a record left turning.
- **World.** Night slows the tempo, closes the tape filter and softens the
  kit. Rain, wind and blowing leaves add their noise beds; snow muffles the
  kit and widens the room. Birds sing on warm days and crickets on warm
  nights, never in the rain or where `nature` is false.

```ts
import { createLofi, lofiScore } from "keel://module/lofi-grove.js";

const band = createLofi(Tone); // Tone.js 15, injected
KEEL_AUDIO.onStart(() => band.start(lofiScore({ seed, species: "cherry", season: "spring", life: 0.4, night: 0, weather: "clear" })));
KEEL_AUDIO.onStop(() => band.stop());
// Later, as the scene changes: the mix follows at once, a new structure at the next bar line.
band.setScore(lofiScore({ seed, species: "cherry", season: "spring", life: 0.4, night: 0.8, weather: "rain" }));
```

To audition, pass `song` overrides (`progression` for the song, then `key`,
`tempo`, `groove`, `comp`, `bassLine`, `keys`, `lead`, `melody`, `stage`,
`season` to change one part of it) and list the choices from
`LOFI_PARTS`; `band.setScore(score, { fromTop: true })` restarts the form at
the next bar.

`lofiScore` and `stepEvents(score, step)` are pure and touch no audio, so a
renderer or test can read what plays at any 16th note. `createLofi` voices
those events with Tone's synths, filters and transport; it builds every sound
from oscillators and noise (no samples) and plays into Tone's destination, so
keel-audio owns the context, gesture start, level and mute.
