/**
 * band: a seeded generative band on plain Web Audio. MIT.
 *
 * One seed gives a whole piece in one of eight styles: a key and mode, a chord
 * progression, drum and bass rows and a lead that phrases and rests. Parts join
 * in as an energy dial rises, so a host can tie the music to a scroll, a level
 * or a mood. No audio library and no samples: every sound is a few oscillators,
 * a filter and an envelope.
 *
 *   const band = createBand(audioContext);
 *   band.start(scoreOf({ seed: "grove", style: "dream" }));
 *   band.setEnergy(0.4);                 // fewer parts
 *   band.setScore(scoreOf({ seed: 9 })); // a new piece at the next bar line
 *
 * `scoreOf` and `eventsAt` are pure and touch no audio, so a renderer, a test
 * or a visual can read what plays at any sixteenth note. `band.schedule` writes
 * a stretch into an OfflineAudioContext for a rendered loop.
 */
export { seedNumber } from "./roll.js";
export { MODES, STYLE_NAMES, STYLES } from "./styles.data.js";
export type { Comp, ModeName, Part, Style, StyleName, Timbre } from "./styles.data.js";
export { STEPS_PER_BAR, noteOf, scoreOf } from "./score.js";
export type { BandInput, Chord, Score } from "./score.js";
export { eventsAt, partsAt } from "./events.js";
export type { BandEvent } from "./events.js";
export { drum, strike } from "./voices.js";
export type { DrumRig, Hit } from "./voices.js";
export { createBand } from "./player.js";
export type { Band, BandOptions, ScheduleOptions } from "./player.js";
