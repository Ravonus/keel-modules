# band

A seeded generative band on plain Web Audio. One seed gives a whole piece: a
key and mode, a chord progression, drum and bass rows and a lead that phrases
and rests. There is no audio library and there are no samples: every sound is
a few oscillators, a filter and an envelope.

```js
import { createBand, scoreOf } from "keel://module/band.js";

const band = createBand(audioContext);           // start the context from a tap or key
band.start(scoreOf({ seed: "grove", style: "dream" }));
band.setEnergy(0.4);                             // fewer parts play
band.setScore(scoreOf({ seed: 9 }));             // a new piece, from the next bar line
band.setGain(0, 1.5);                            // fade out
```

- **Eight styles.** `ambient`, `lofi`, `synthwave`, `chiptune`, `house`,
  `cinematic`, `folk` and `dream`. A style is one row of data in
  `styles.data.ts`: a tempo range, swing, the modes it likes, chord
  progressions, drum and bass rows, how the chords are played (held, stabbed,
  pulsed or broken), the lead's density, an instrument per part, and how much
  room and echo. Add a row and the band plays it.
- **Seeded picks.** The seed fixes the style (unless pinned), the tempo
  within the style's range, the key, the mode, the progression, which chords
  take a seventh, the drum and bass rows and the lead's contour. `style`,
  `tempo`, `key` and `mode` can each be pinned.
- **Energy.** `setEnergy(0..1)` says how much of the band plays. Parts join
  in the style's own order (`layers`), so house starts from its kick and
  ambient from its pad. A host can tie it to a scroll position, a level or a
  mood; it takes effect on the next sixteenth.
- **Small variations.** Fills, ghost notes and the lead's choices are a pure
  function of the seed, the bar and the step, so the same piece plays the same
  way every time. The lead plays two-bar phrases and rests one pass in four.
- **Instruments.** `soft`, `keys`, `pluck`, `pad`, `bell` (two-operator FM),
  `saw`, `square` and `sub`, plus a kick, snare and hat cut from seeded noise.
  A convolver room (its impulse is generated, not loaded) and a tempo-timed
  echo sit on sends.
- **Offline.** `band.schedule(score, { steps })` writes a stretch into an
  `OfflineAudioContext` at once and returns where it ends, for a rendered
  loop or a film's score.

`scoreOf(input)` and `eventsAt(score, step, energy)` are pure and touch no
audio, so a renderer, a test or a visual can read what plays at any sixteenth
note and move with it. `strike` and `drum` play one note of an instrument for
a host that wants its own sequencer.

The audio context is injected: the module never makes one and never touches
globals other than the timer its live clock runs on.

MIT.
