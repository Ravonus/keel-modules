// The songbook: the fixed numbers, songs, motifs, comps and grooves a score is written from.

import type { LofiMode } from "./score.js";

export const STEPS_PER_BAR = 16;
export const FORM_BARS = 8;
export const BPM_RANGE = [64, 88] as const;
export const KEYS_RANGE = [52, 76] as const;
export const BASS_RANGE = [36, 47] as const;
export const MELODY_RANGE = [62, 88] as const;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;
export const at = <T>(list: readonly T[], index: number): T =>
  list[((index % list.length) + list.length) % list.length] as T;


// ---------------------------------------------------------------- static tables

/** Chord qualities as semitones above the chord root. */
export const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  dom9: [0, 4, 7, 10, 14],
  dom13: [0, 4, 10, 14, 21],
  sus9: [0, 5, 7, 10, 14],
  six9: [0, 4, 9, 14],
  six: [0, 4, 7, 9],
};

/** Four chords: [semitones above the tonic, quality]. */
export type Progression = readonly (readonly [number, string])[];

export type KeysVoice = "felt" | "rhodes" | "organ" | "nylon";
export type LeadVoice = "kalimba" | "musicbox" | "flute" | "vibes";

/** A song: its chords and everything that makes it sound like itself. */
export interface Song {
  readonly label: string;
  readonly mode: LofiMode;
  readonly chords: Progression;
  /** Bars each chord lasts: 1 moves twice as fast as 2. */
  readonly barsPerChord: 1 | 2;
  readonly tempo: number;
  readonly swing: number;
  readonly groove: number;
  readonly comp: number;
  readonly bassLine: number;
  readonly keys: KeysVoice;
  readonly lead: LeadVoice;
}

/**
 * The eight songs. Spring and summer pick among the major four, autumn and
 * winter among the minor four (the relative minor of the seed's key).
 */
export const SONGS: Readonly<Record<string, Song>> = {
  bloom: { label: "Bloom · I vi ii V", mode: "major", chords: [[0, "maj9"], [9, "m9"], [2, "m9"], [7, "sus9"]], barsPerChord: 1, tempo: 84, swing: 0.22, groove: 0, comp: 1, bassLine: 1, keys: "felt", lead: "kalimba" },
  canopy: { label: "Canopy · ii V I", mode: "major", chords: [[2, "m9"], [7, "dom13"], [0, "maj9"], [0, "six9"]], barsPerChord: 2, tempo: 74, swing: 0.18, groove: 1, comp: 0, bassLine: 3, keys: "rhodes", lead: "vibes" },
  roots: { label: "Roots · IV iii ii I", mode: "major", chords: [[5, "maj7"], [4, "m7"], [2, "m9"], [0, "maj9"]], barsPerChord: 2, tempo: 70, swing: 0.14, groove: 4, comp: 5, bassLine: 4, keys: "nylon", lead: "flute" },
  clearing: { label: "Clearing · I IV iii vi", mode: "major", chords: [[0, "maj9"], [5, "maj9"], [4, "m7"], [9, "m9"]], barsPerChord: 1, tempo: 86, swing: 0.12, groove: 2, comp: 2, bassLine: 0, keys: "organ", lead: "musicbox" },
  dusk: { label: "Dusk · i iv ♭VII ♭III", mode: "minor", chords: [[0, "m9"], [5, "m9"], [10, "dom9"], [3, "maj7"]], barsPerChord: 2, tempo: 78, swing: 0.24, groove: 0, comp: 3, bassLine: 2, keys: "rhodes", lead: "kalimba" },
  frost: { label: "Frost · i ♭VI ♭III ♭VII", mode: "minor", chords: [[0, "m9"], [8, "maj7"], [3, "maj9"], [10, "six"]], barsPerChord: 2, tempo: 66, swing: 0.12, groove: 3, comp: 4, bassLine: 4, keys: "felt", lead: "musicbox" },
  embers: { label: "Embers · i ♭III ♭VI v", mode: "minor", chords: [[0, "m9"], [3, "maj7"], [8, "maj7"], [7, "m7"]], barsPerChord: 1, tempo: 80, swing: 0.26, groove: 2, comp: 5, bassLine: 3, keys: "nylon", lead: "vibes" },
  hollow: { label: "Hollow · iv ♭VII i ♭III", mode: "minor", chords: [[5, "m9"], [10, "dom9"], [0, "m9"], [3, "maj9"]], barsPerChord: 2, tempo: 70, swing: 0.2, groove: 4, comp: 0, bassLine: 1, keys: "organ", lead: "flute" },
};
export function songOf(id: string): Song {
  const song = SONGS[id];
  if (song === undefined) throw new RangeError(`Unknown lofi-grove song: ${id}.`);
  return song;
}
export const songsIn = (mode: LofiMode): string[] => Object.keys(SONGS).filter((id) => SONGS[id]?.mode === mode);

/** Major tonics by pitch class: F, E flat, D, C, B flat, G, A. */
export const TONICS = [5, 3, 2, 0, 10, 7, 9] as const;
export const PENTATONIC = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] } as const;

/** A note of a two-bar phrase: [16th step, pentatonic degree, length in 16ths]. */
export type MotifNote = readonly [number, number, number];

/**
 * Each species' own two-bar phrase, in pentatonic degrees above the tonic
 * (five per octave): the tree's leitmotif, played by the kalimba.
 */
export const SPECIES_MOTIFS: Readonly<Record<string, readonly MotifNote[]>> = {
  // Delicate, petal-light steps down.
  cherry: [[0, 4, 2], [2, 3, 2], [4, 2, 4], [10, 3, 2], [12, 1, 4], [20, 2, 2], [22, 0, 6]],
  // Sturdy quarter notes, slow to change.
  oak: [[0, 0, 4], [4, 2, 4], [8, 4, 4], [12, 3, 4], [16, 2, 8], [26, 1, 4]],
  // Long evergreen tones.
  pine: [[0, 5, 6], [6, 4, 2], [8, 2, 8], [18, 3, 4], [24, 1, 8]],
  // Light and skipping, like papery bark in a breeze.
  birch: [[0, 2, 1], [2, 4, 1], [3, 5, 2], [6, 4, 2], [10, 2, 2], [12, 3, 4], [18, 2, 1], [20, 1, 2], [24, 0, 4]],
  // Weeping lines that fall and fall again.
  willow: [[0, 7, 3], [3, 6, 3], [6, 5, 2], [8, 4, 6], [16, 5, 3], [19, 4, 3], [22, 3, 2], [24, 2, 8]],
  // Syncopated, warm, wide open.
  acacia: [[0, 2, 3], [3, 2, 1], [4, 4, 2], [7, 3, 3], [10, 2, 2], [14, 0, 2], [16, 1, 3], [19, 2, 5], [26, 4, 4]],
  // A swaying rise and fall.
  palm: [[0, 0, 2], [3, 2, 2], [6, 4, 2], [8, 5, 4], [14, 4, 2], [16, 3, 3], [19, 2, 3], [22, 1, 2], [24, 2, 6]],
  // Crisp and high, like frost on blue needles.
  spruce: [[0, 7, 2], [2, 5, 2], [4, 7, 4], [10, 6, 2], [12, 4, 4], [18, 5, 2], [20, 4, 2], [22, 2, 8]],
  // A giant's few long, low tones.
  redwood: [[0, 0, 8], [8, 1, 4], [12, 2, 4], [16, 4, 12], [28, 2, 4]],
  // Sweet and falling, then lifting again.
  maple: [[0, 6, 2], [2, 5, 2], [4, 4, 2], [6, 2, 4], [12, 3, 2], [14, 4, 2], [16, 5, 6], [24, 4, 2], [26, 2, 6]],
  // A lilting violet bloom in threes.
  jacaranda: [[0, 3, 3], [3, 4, 3], [6, 5, 2], [8, 4, 4], [14, 3, 2], [16, 2, 3], [19, 3, 3], [22, 1, 2], [24, 0, 8]],
  // Deep and bouncy, with wide leaps from the root.
  baobab: [[0, 0, 2], [2, 5, 2], [6, 0, 2], [8, 4, 4], [14, 2, 2], [16, 0, 2], [18, 5, 2], [22, 4, 2], [24, 2, 8]],
  // Round and homely, a step that settles where it began.
  apple: [[0, 2, 2], [2, 4, 2], [4, 5, 4], [10, 4, 2], [12, 2, 4], [18, 3, 2], [20, 1, 2], [22, 2, 8]],
  // Tall and leaning, a line that climbs and hangs.
  pear: [[0, 1, 4], [4, 3, 2], [6, 5, 6], [14, 4, 2], [16, 3, 4], [22, 2, 8]],
  // Soft and quick, pink and over too soon.
  peach: [[0, 5, 1], [1, 6, 1], [2, 5, 2], [6, 3, 2], [8, 4, 2], [12, 2, 4], [18, 3, 2], [20, 2, 2], [22, 0, 8]],
  // Dusky, low and sweet.
  plum: [[0, 1, 3], [3, 2, 1], [4, 3, 4], [10, 2, 2], [12, 0, 4], [18, 1, 2], [20, 2, 2], [22, 1, 8]],
  // Bright and sunny, bouncing on the off-beat.
  orange: [[0, 4, 2], [3, 5, 1], [4, 7, 3], [8, 5, 2], [11, 4, 1], [12, 2, 4], [18, 4, 2], [21, 5, 1], [22, 4, 8]],
  // Sharp little leaps, a sour twist at the end.
  lemon: [[0, 7, 1], [2, 5, 1], [3, 7, 2], [6, 4, 2], [10, 6, 2], [12, 3, 4], [18, 5, 2], [20, 6, 1], [22, 4, 8]],
  // Broad and lazy, a long afternoon.
  fig: [[0, 0, 4], [4, 3, 4], [8, 2, 2], [10, 4, 6], [16, 2, 4], [20, 1, 2], [22, 0, 8]],
  // Lush and swinging, heavy with fruit.
  mango: [[0, 2, 3], [3, 4, 3], [6, 6, 2], [8, 5, 4], [14, 3, 2], [16, 4, 3], [19, 2, 3], [22, 1, 2], [24, 0, 8]],
};

/** Keys comping per bar: [16th step, length in 16ths, velocity]. The last comp, `ARPEGGIO`, breaks the chord into eighths. */
export const COMPS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 14, 0.7]],
  [[0, 6, 0.7], [10, 6, 0.5]],
  [[0, 3, 0.62], [6, 9, 0.55]],
  [[0, 8, 0.68], [8, 2, 0.32], [11, 5, 0.5]],
  [[0, 8, 0.6], [8, 8, 0.48]],
];
export const ARPEGGIO = COMPS.length;

export interface Groove {
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly hat: readonly number[];
}

export const GROOVES: readonly Groove[] = [
  { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  { kick: [0, 3, 10], snare: [4, 12], hat: [2, 6, 10, 14] },
  { kick: [0, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Half-time: one snare on beat three.
  { kick: [0, 7, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Brushes: a soft shuffle.
  { kick: [0, 9], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14] },
];
export const HAT_ACCENTS = [0.55, 0.28, 0.42, 0.3] as const;

/** Bass per bar: [16th step, chord tone ("root", "fifth", "octave"), length]. */
export const BASS_LINES: readonly (readonly (readonly [number, "root" | "fifth" | "octave", number])[])[] = [
  [[0, "root", 7], [10, "root", 4]],
  [[0, "root", 6], [8, "fifth", 4], [14, "octave", 2]],
  [[0, "root", 10], [11, "fifth", 4]],
  [[0, "root", 4], [4, "fifth", 4], [8, "octave", 4], [12, "fifth", 4]],
  [[0, "root", 14]],
];
