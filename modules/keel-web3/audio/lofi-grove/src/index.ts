/**
 * A lo-fi score for a living tree: felt keys over jazzy rootless chords, a
 * dusty boom-bap kit, a round bass, a wooden kalimba that sings the tree's own
 * phrase, vinyl crackle and tape wow, with rain, wind, birds and crickets from
 * the world around it. The arrangement grows with the tree: a sprout hears
 * only chords and a budding figure, a sapling adds wood knocks and hats, a
 * young tree the kit and bass, a mature one its melody, and an old one slows
 * and thins until a dead snag is a record left turning. MIT.
 *
 *   const score = lofiScore({ seed: "0x6f6e…", species: "cherry", season: "spring", life: 0.4, night: 0, weather: "rain" });
 *   const band = createLofi(Tone);   // Tone is injected, never imported
 *   band.start(score);               // inside keel-audio's onStart
 *   band.setScore(lofiScore(next));  // mix now, structure at the next bar
 *
 * The composition is static and the variation is seeded: progressions,
 * motifs, comping and grooves are fixed tables; the seed picks among them,
 * and each bar's small departures (a ghost note, a skipped hat, a moved
 * melody note) are a pure function of the seed and the bar number, so a tree
 * plays the same loop every time it is opened. `stepEvents` is that function
 * and touches no audio; `createLofi` only voices what it returns.
 */

export { SPECIES_MOTIFS } from "./songbook.js";
export type { KeysVoice, LeadVoice } from "./songbook.js";
export { seedNumber } from "./roll.js";
export { LOFI_PARTS, keyName, growthStage, lofiScore } from "./score.js";
export type { LofiMode, GrowthStage, LofiInput, LofiSong, LofiLayers, LofiChord, LofiScore } from "./score.js";
export { stepEvents } from "./events.js";
export type { LofiVoice, LofiEvent } from "./events.js";
export { createLofi } from "./band.js";
export type { ToneLike, LofiBand, LofiOptions } from "./band.js";
