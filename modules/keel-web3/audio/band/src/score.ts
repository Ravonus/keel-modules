/** The band's score: everything one seed and one style decide, before a single note sounds. Pure. MIT. */
import { at, clamp, mixHash, pick, random, seedNumber } from "./roll.js";
import { MODES, STYLE_NAMES, STYLES } from "./styles.data.js";
import type { ModeName, Style, StyleName } from "./styles.data.js";

export const STEPS_PER_BAR = 16;

/** What a host asks for. Only the seed is needed; anything left out is the seed's choice. */
export interface BandInput {
  readonly seed: number | string;
  readonly style?: StyleName;
  /** Beats per minute, 40 to 200. */
  readonly tempo?: number;
  /** The key note as a pitch class, 0 (C) to 11 (B). */
  readonly key?: number;
  readonly mode?: ModeName;
}

/** One bar's chord: its scale degree, the bass note and the notes the chord part plays, as MIDI numbers. */
export interface Chord {
  readonly degree: number;
  readonly root: number;
  readonly notes: readonly number[];
}

/** Everything fixed for a piece. `eventsAt` reads what plays at any step from it. */
export interface Score {
  readonly seed: number;
  readonly style: StyleName;
  readonly sound: Style;
  readonly tempo: number;
  readonly swing: number;
  readonly key: number;
  readonly mode: ModeName;
  /** One chord per bar; the form repeats. */
  readonly chords: readonly Chord[];
  readonly kick: string;
  readonly snare: string;
  readonly hat: string;
  readonly bass: string;
  /** The lead's contour: eight steps along the scale, relative to the bar's chord. */
  readonly motif: readonly number[];
}

/** The MIDI note of a scale degree (any whole number; it runs on through the octaves) above a base note. */
export function noteOf(mode: ModeName, base: number, degree: number): number {
  const scale = MODES[mode];
  return base + Math.floor(degree / scale.length) * 12 + at(scale, degree);
}

/** Folds a note into [low, low + 12). */
const fold = (note: number, low: number): number => low + ((((note - low) % 12) + 12) % 12);

function chordOf(mode: ModeName, key: number, degree: number, seventh: boolean): Chord {
  const steps = seventh ? [0, 2, 4, 6] : [0, 2, 4];
  const notes = steps.map((step) => fold(noteOf(mode, key, degree + step), 55)).sort((a, b) => a - b);
  return { degree, root: fold(noteOf(mode, key, degree), 36), notes };
}

/** A contour that starts on the chord, wanders by step and comes home. */
function motifOf(roll: () => number): number[] {
  const motif = [0];
  let degree = 0;
  for (let i = 1; i < 7; i += 1) {
    degree = clamp(degree + Math.round(roll() * 4 - 2), -3, 5);
    motif.push(degree);
  }
  motif.push(roll() < 0.5 ? 2 : 0);
  return motif;
}

/**
 * The score for a seed: the same input always gives the same piece.
 *
 * @param input The seed, and any of style, tempo, key and mode to pin.
 * @returns The piece's tempo, key, chords, drum and bass rows and lead contour.
 */
export function scoreOf(input: BandInput): Score {
  const seed = seedNumber(input.seed);
  const roll = random(mixHash(seed, 1));
  // Every choice takes its roll whether or not it is pinned, so pinning one thing never changes another.
  const rolls = { style: roll(), tempo: roll(), key: roll(), mode: roll() };
  const style = input.style ?? pick(STYLE_NAMES, rolls.style);
  const sound = STYLES[style];
  const span = sound.tempo[1] - sound.tempo[0];
  const tempo = clamp(Math.round(input.tempo ?? sound.tempo[0] + span * rolls.tempo), 40, 200);
  const key = (((input.key ?? Math.floor(rolls.key * 12)) % 12) + 12) % 12;
  const mode = input.mode ?? pick(sound.modes, rolls.mode);
  const chords = pick(sound.progressions, roll()).map((degree) => chordOf(mode, key, degree, roll() < sound.sevenths));
  return {
    seed, style, sound, tempo, swing: sound.swing, key, mode, chords,
    kick: pick(sound.kick, roll()),
    snare: pick(sound.snare, roll()),
    hat: pick(sound.hat, roll()),
    bass: pick(sound.bass, roll()),
    motif: motifOf(roll),
  };
}
