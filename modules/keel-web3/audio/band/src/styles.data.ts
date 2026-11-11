/** The band's styles and scales, as data. A style is a row: change a row, or add one, and the band plays it. MIT. */

export type Part = "kick" | "snare" | "hat" | "bass" | "chord" | "lead";
export type Timbre = "soft" | "keys" | "pluck" | "pad" | "bell" | "saw" | "square" | "sub";
export type ModeName = "major" | "minor" | "dorian" | "mixolydian" | "lydian" | "phrygian";
/** How the chord part plays its chord: held, stabbed, pulsed in eighths, or broken into single notes. */
export type Comp = "pad" | "stab" | "pulse" | "arp";

/** Semitones of each scale degree above the key note. */
export const MODES: Readonly<Record<ModeName, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/**
 * One style. Drum rows are sixteen steps: `x` a hit, `o` a soft hit, `.` a rest. The bass row reads `r` root,
 * `5` fifth, `o` octave, `.` rest. Progressions are scale degrees from 0, one per bar.
 */
export interface Style {
  readonly tempo: readonly [number, number];
  /** How late the off sixteenths fall, as a share of a step. */
  readonly swing: number;
  readonly modes: readonly ModeName[];
  readonly progressions: readonly (readonly number[])[];
  /** Chance a chord takes a seventh. */
  readonly sevenths: number;
  readonly kick: readonly string[];
  readonly snare: readonly string[];
  readonly hat: readonly string[];
  readonly bass: readonly string[];
  readonly comp: Comp;
  /** Share of eighth notes the lead plays. */
  readonly lead: number;
  readonly voices: Readonly<Record<"chord" | "bass" | "lead", Timbre>>;
  /** Reverb and echo sends, 0 to 1. */
  readonly space: number;
  readonly echo: number;
  /** The order parts join in as energy rises. */
  readonly layers: readonly Part[];
}

export type StyleName = "ambient" | "lofi" | "synthwave" | "chiptune" | "house" | "cinematic" | "folk" | "dream";

export const STYLES: Readonly<Record<StyleName, Style>> = {
  ambient: {
    tempo: [56, 72], swing: 0, modes: ["lydian", "major", "dorian"],
    progressions: [[0, 3, 0, 4], [0, 5, 3, 4], [0, 2, 3, 0], [3, 0, 4, 0]], sevenths: 0.8,
    kick: ["................"], snare: ["................"], hat: ["..........o.....", "......o........."],
    bass: ["r...............", "r.......5......."], comp: "pad", lead: 0.16,
    voices: { chord: "pad", bass: "sub", lead: "bell" }, space: 0.85, echo: 0.5,
    layers: ["chord", "bass", "lead", "hat", "kick", "snare"],
  },
  lofi: {
    tempo: [68, 86], swing: 0.2, modes: ["dorian", "major", "minor"],
    progressions: [[1, 4, 0, 5], [0, 5, 1, 4], [3, 4, 2, 5], [0, 3, 1, 4]], sevenths: 1,
    kick: ["x.....x...x.....", "x......x..x.....", "x.........x..o.."], snare: ["....x.......x...", "....x.......x..o"],
    hat: ["x.x.x.x.x.x.x.x.", "x.xox.x.x.xox.x."], bass: ["r.....r...5.....", "r..r......o.....", "r.........r..5.."],
    comp: "stab", lead: 0.3, voices: { chord: "keys", bass: "sub", lead: "pluck" }, space: 0.4, echo: 0.25,
    layers: ["chord", "hat", "kick", "bass", "snare", "lead"],
  },
  synthwave: {
    tempo: [92, 116], swing: 0, modes: ["minor", "dorian"],
    progressions: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 2, 5, 4]], sevenths: 0.2,
    kick: ["x...x...x...x..."], snare: ["....x.......x...", "....x.......x.x."], hat: ["..x...x...x...x.", "x.x.x.x.x.x.x.x."],
    bass: ["r.r.r.r.r.r.r.r.", "r.r.o.r.r.r.o.r."], comp: "arp", lead: 0.4,
    voices: { chord: "saw", bass: "saw", lead: "saw" }, space: 0.5, echo: 0.45,
    layers: ["bass", "kick", "chord", "snare", "hat", "lead"],
  },
  chiptune: {
    tempo: [120, 156], swing: 0, modes: ["major", "mixolydian", "minor"],
    progressions: [[0, 4, 5, 3], [0, 3, 4, 4], [0, 5, 3, 4], [5, 3, 0, 4]], sevenths: 0,
    kick: ["x...x...x...x...", "x.....x.x...x..."], snare: ["....x.......x...", "....x..x....x..."], hat: ["x.x.x.x.x.x.x.x."],
    bass: ["r.o.r.o.r.o.r.o.", "r..r..5.r..r..5."], comp: "arp", lead: 0.6,
    voices: { chord: "square", bass: "square", lead: "square" }, space: 0.08, echo: 0.2,
    layers: ["lead", "bass", "chord", "kick", "snare", "hat"],
  },
  house: {
    tempo: [118, 126], swing: 0.06, modes: ["minor", "dorian", "mixolydian"],
    progressions: [[0, 0, 5, 6], [0, 3, 0, 4], [0, 6, 5, 3], [0, 0, 3, 3]], sevenths: 0.7,
    kick: ["x...x...x...x..."], snare: ["....x.......x...", "....x.......x..o"], hat: ["..x...x...x...x.", "o.x.o.x.o.x.o.x."],
    bass: ["..r...r...r...r.", "..r..r....r..o.."], comp: "stab", lead: 0.25,
    voices: { chord: "keys", bass: "sub", lead: "pluck" }, space: 0.35, echo: 0.35,
    layers: ["kick", "hat", "bass", "chord", "snare", "lead"],
  },
  cinematic: {
    tempo: [62, 84], swing: 0, modes: ["minor", "phrygian", "dorian"],
    progressions: [[0, 5, 3, 4], [0, 2, 5, 6], [0, 6, 5, 4], [0, 3, 5, 4]], sevenths: 0.3,
    kick: ["x.......x.......", "x.....x.x......."], snare: ["............x...", "........x...x.x."], hat: ["................"],
    bass: ["r...............", "r.......r......."], comp: "pulse", lead: 0.22,
    voices: { chord: "pad", bass: "sub", lead: "soft" }, space: 0.75, echo: 0.3,
    layers: ["chord", "bass", "kick", "lead", "snare", "hat"],
  },
  folk: {
    tempo: [84, 110], swing: 0.12, modes: ["major", "mixolydian", "dorian"],
    progressions: [[0, 3, 0, 4], [0, 4, 5, 3], [0, 0, 3, 4], [5, 3, 0, 4]], sevenths: 0.1,
    kick: ["x.......x.......", "x.....x.x......."], snare: ["....o.......o...", "................"], hat: ["..o...o...o...o."],
    bass: ["r.......5.......", "r.....5.r.....5."], comp: "arp", lead: 0.45,
    voices: { chord: "pluck", bass: "sub", lead: "soft" }, space: 0.3, echo: 0.15,
    layers: ["chord", "bass", "lead", "kick", "hat", "snare"],
  },
  dream: {
    tempo: [74, 96], swing: 0.08, modes: ["lydian", "major", "mixolydian"],
    progressions: [[0, 4, 5, 3], [3, 0, 4, 5], [0, 2, 3, 3], [0, 5, 3, 4]], sevenths: 0.9,
    kick: ["x.........x.....", "x.......x......."], snare: ["....o.......x...", "............x..."], hat: ["x.o.x.o.x.o.x.o.", "..x...x...x...x."],
    bass: ["r.........r.....", "r.......5.....o."], comp: "pulse", lead: 0.35,
    voices: { chord: "bell", bass: "sub", lead: "soft" }, space: 0.7, echo: 0.55,
    layers: ["chord", "lead", "bass", "hat", "kick", "snare"],
  },
};

export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
