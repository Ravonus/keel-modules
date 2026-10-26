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

const STEPS_PER_BAR = 16;
const FORM_BARS = 8;
const BPM_RANGE = [64, 88] as const;
const KEYS_RANGE = [52, 76] as const;
const BASS_RANGE = [36, 47] as const;
const MELODY_RANGE = [62, 88] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const at = <T>(list: readonly T[], index: number): T => list[((index % list.length) + list.length) % list.length] as T;

// ---------------------------------------------------------------- seeded randomness

/** A 32-bit integer from a seed: a number, a 0x hex string or any text. */
export function seedNumber(seed: number | string): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.floor(seed) >>> 0;
  const text = String(seed);
  if (/^0x[0-9a-f]+$/iu.test(text)) return Number.parseInt(text.slice(2, 10), 16) >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function mixHash(...parts: readonly number[]): number {
  let hash = 0x9e3779b9;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part >>> 0), 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast, seeded generator in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOICE_SALT = { keys: 1, bass: 2, melody: 3, drums: 4, nature: 5, crackle: 6 } as const;
const barRandom = (seed: number, bar: number, voice: keyof typeof VOICE_SALT): (() => number) => random(mixHash(seed, bar, VOICE_SALT[voice]));

// ---------------------------------------------------------------- static tables

/** Chord qualities as semitones above the chord root. */
const QUALITIES: Readonly<Record<string, readonly number[]>> = {
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
type Progression = readonly (readonly [number, string])[];

export type KeysVoice = "felt" | "rhodes" | "organ" | "nylon";
export type LeadVoice = "kalimba" | "musicbox" | "flute" | "vibes";

/** A song: its chords and everything that makes it sound like itself. */
interface Song {
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
const SONGS: Readonly<Record<string, Song>> = {
  bloom: { label: "Bloom · I vi ii V", mode: "major", chords: [[0, "maj9"], [9, "m9"], [2, "m9"], [7, "sus9"]], barsPerChord: 1, tempo: 84, swing: 0.22, groove: 0, comp: 1, bassLine: 1, keys: "felt", lead: "kalimba" },
  canopy: { label: "Canopy · ii V I", mode: "major", chords: [[2, "m9"], [7, "dom13"], [0, "maj9"], [0, "six9"]], barsPerChord: 2, tempo: 74, swing: 0.18, groove: 1, comp: 0, bassLine: 3, keys: "rhodes", lead: "vibes" },
  roots: { label: "Roots · IV iii ii I", mode: "major", chords: [[5, "maj7"], [4, "m7"], [2, "m9"], [0, "maj9"]], barsPerChord: 2, tempo: 70, swing: 0.14, groove: 4, comp: 5, bassLine: 4, keys: "nylon", lead: "flute" },
  clearing: { label: "Clearing · I IV iii vi", mode: "major", chords: [[0, "maj9"], [5, "maj9"], [4, "m7"], [9, "m9"]], barsPerChord: 1, tempo: 86, swing: 0.12, groove: 2, comp: 2, bassLine: 0, keys: "organ", lead: "musicbox" },
  dusk: { label: "Dusk · i iv ♭VII ♭III", mode: "minor", chords: [[0, "m9"], [5, "m9"], [10, "dom9"], [3, "maj7"]], barsPerChord: 2, tempo: 78, swing: 0.24, groove: 0, comp: 3, bassLine: 2, keys: "rhodes", lead: "kalimba" },
  frost: { label: "Frost · i ♭VI ♭III ♭VII", mode: "minor", chords: [[0, "m9"], [8, "maj7"], [3, "maj9"], [10, "six"]], barsPerChord: 2, tempo: 66, swing: 0.12, groove: 3, comp: 4, bassLine: 4, keys: "felt", lead: "musicbox" },
  embers: { label: "Embers · i ♭III ♭VI v", mode: "minor", chords: [[0, "m9"], [3, "maj7"], [8, "maj7"], [7, "m7"]], barsPerChord: 1, tempo: 80, swing: 0.26, groove: 2, comp: 5, bassLine: 3, keys: "nylon", lead: "vibes" },
  hollow: { label: "Hollow · iv ♭VII i ♭III", mode: "minor", chords: [[5, "m9"], [10, "dom9"], [0, "m9"], [3, "maj9"]], barsPerChord: 2, tempo: 70, swing: 0.2, groove: 4, comp: 0, bassLine: 1, keys: "organ", lead: "flute" },
};
function songOf(id: string): Song {
  const song = SONGS[id];
  if (song === undefined) throw new RangeError(`Unknown lofi-grove song: ${id}.`);
  return song;
}
const songsIn = (mode: LofiMode): string[] => Object.keys(SONGS).filter((id) => SONGS[id]?.mode === mode);

/** Major tonics by pitch class: F, E flat, D, C, B flat, G, A. */
const TONICS = [5, 3, 2, 0, 10, 7, 9] as const;
const PENTATONIC = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] } as const;

/** A note of a two-bar phrase: [16th step, pentatonic degree, length in 16ths]. */
type MotifNote = readonly [number, number, number];

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
};

/** Keys comping per bar: [16th step, length in 16ths, velocity]. The last comp, `ARPEGGIO`, breaks the chord into eighths. */
const COMPS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 14, 0.7]],
  [[0, 6, 0.7], [10, 6, 0.5]],
  [[0, 3, 0.62], [6, 9, 0.55]],
  [[0, 8, 0.68], [8, 2, 0.32], [11, 5, 0.5]],
  [[0, 8, 0.6], [8, 8, 0.48]],
];
const ARPEGGIO = COMPS.length;

interface Groove {
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly hat: readonly number[];
}

const GROOVES: readonly Groove[] = [
  { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  { kick: [0, 3, 10], snare: [4, 12], hat: [2, 6, 10, 14] },
  { kick: [0, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Half-time: one snare on beat three.
  { kick: [0, 7, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  // Brushes: a soft shuffle.
  { kick: [0, 9], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14] },
];
const HAT_ACCENTS = [0.55, 0.28, 0.42, 0.3] as const;

/** Bass per bar: [16th step, chord tone ("root", "fifth", "octave"), length]. */
const BASS_LINES: readonly (readonly (readonly [number, "root" | "fifth" | "octave", number])[])[] = [
  [[0, "root", 7], [10, "root", 4]],
  [[0, "root", 6], [8, "fifth", 4], [14, "octave", 2]],
  [[0, "root", 10], [11, "fifth", 4]],
  [[0, "root", 4], [4, "fifth", 4], [8, "octave", 4], [12, "fifth", 4]],
  [[0, "root", 14]],
];

// ---------------------------------------------------------------- the score

export type LofiMode = "major" | "minor";
export type GrowthStage = "sprout" | "sapling" | "young" | "mature" | "old" | "ancient" | "dead";

export interface LofiInput {
  /** The tree's seed. */
  readonly seed: number | string;
  /** Tree species id; unknown species play the cherry phrase. */
  readonly species?: string;
  /** Season name, including the equatorial "long rains", "high sun", "short rains" and "dry season". */
  readonly season?: string;
  /** Fraction of the tree's life lived, 0 to 1. */
  readonly life?: number;
  /** 0 by day to 1 at full night. */
  readonly night?: number;
  /** "clear", "wind", "leaves", "rain" or "snow". */
  readonly weather?: string;
  readonly dead?: boolean;
  /** False where there is no living world around the tree (open space): no birds or crickets. */
  readonly nature?: boolean;
  /** Parts to hear in place of the seed's picks, for auditioning; see {@link LOFI_PARTS}. */
  readonly song?: LofiSong;
}

/** Overrides for auditioning: each replaces what the seed or the moment would choose. */
export interface LofiSong {
  /** A song id; its mode wins over the season's, and its parts become the defaults. */
  readonly progression?: string;
  /** Pitch class of the major tonic; minor progressions play its relative minor. */
  readonly key?: number;
  /** Base tempo before season, stage and night; the result stays clamped. */
  readonly tempo?: number;
  readonly groove?: number;
  readonly comp?: number;
  readonly bassLine?: number;
  readonly keys?: KeysVoice;
  readonly lead?: LeadVoice;
  /** A species id whose phrase the lead sings. */
  readonly melody?: string;
  readonly stage?: GrowthStage;
  readonly season?: string;
}

const KEY_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;

/** What can be auditioned, with labels, for a picker. */
export const LOFI_PARTS = Object.freeze({
  progressions: Object.entries(SONGS).map(([id, song]) => ({ id, mode: song.mode, label: song.label, tempo: song.tempo, keys: song.keys, lead: song.lead })),
  keys: [5, 3, 2, 0, 10, 7, 9].map((pc) => ({ id: pc, label: `${KEY_NAMES[pc] ?? "C"} major · ${KEY_NAMES[(pc + 9) % 12] ?? "A"} minor` })),
  grooves: ["Boom bap", "Lazy pocket", "Rolling", "Half-time", "Brushes"],
  comps: ["Held pads", "Push and answer", "Short stabs", "Rocking", "Half-bar swells", "Broken chord"],
  bassLines: ["Root and push", "Root, fifth, octave", "Long root", "Walking", "Sparse"],
  keysVoices: [["felt", "Felt piano"], ["rhodes", "Electric piano"], ["organ", "Soft organ"], ["nylon", "Nylon guitar"]],
  leads: [["kalimba", "Kalimba"], ["musicbox", "Music box"], ["flute", "Wooden flute"], ["vibes", "Vibraphone"]],
  stages: ["sprout", "sapling", "young", "mature", "old", "ancient", "dead"],
  seasons: ["spring", "summer", "autumn", "winter"],
} as const);

/** A note name for a pitch class. */
export const keyName = (pitchClass: number): string => at(KEY_NAMES, pitchClass);

/** Gains, 0 to 1, of every part of the band. */
export interface LofiLayers {
  readonly keys: number;
  readonly bass: number;
  readonly melody: number;
  readonly bud: number;
  readonly kick: number;
  readonly snare: number;
  readonly wood: number;
  readonly hat: number;
  readonly crackle: number;
  readonly hiss: number;
  readonly rain: number;
  readonly wind: number;
  readonly birds: number;
  readonly crickets: number;
}

export interface LofiChord {
  /** Bass note, MIDI. */
  readonly bass: number;
  /** Rootless, voice-led keys voicing, MIDI, low to high. */
  readonly keys: readonly number[];
}

export interface LofiScore {
  readonly seed: number;
  readonly species: string;
  readonly stage: GrowthStage;
  readonly mode: LofiMode;
  /** Pitch class of the tonic of `mode`. */
  readonly tonic: number;
  readonly bpm: number;
  /** Swing on the 16th notes, 0 to 0.5. */
  readonly swing: number;
  readonly progression: string;
  readonly chords: readonly LofiChord[];
  /** Pentatonic scale of the melody, MIDI, low to high, two octaves and a degree. */
  readonly scale: readonly number[];
  readonly motif: readonly MotifNote[];
  readonly comp: number;
  readonly groove: number;
  readonly bassLine: number;
  readonly barsPerChord: 1 | 2;
  readonly keysVoice: KeysVoice;
  readonly lead: LeadVoice;
  /** Fraction of melody notes kept after the first of each phrase. */
  readonly density: number;
  /** Notes in the budding figure that closes each form; falls instead of rising in autumn and winter. */
  readonly budNotes: number;
  readonly budFalls: boolean;
  readonly layers: LofiLayers;
  /** Master low-pass, hertz. */
  readonly cutoff: number;
  /** Tape wow depth, 0 to 1. */
  readonly wow: number;
  /** Reverb send, 0 to 1. */
  readonly space: number;
  /** Changes when the arrangement must change at a bar line; mix-only changes keep it. */
  readonly structure: string;
}

const SEASON_MOODS: Readonly<Record<string, { readonly mode: LofiMode; readonly bpm: number; readonly cutoff: number; readonly space: number }>> = {
  spring: { mode: "major", bpm: 2, cutoff: 1, space: 0.32 },
  summer: { mode: "major", bpm: 3, cutoff: 1.08, space: 0.28 },
  autumn: { mode: "minor", bpm: -2, cutoff: 0.86, space: 0.36 },
  winter: { mode: "minor", bpm: -4, cutoff: 0.72, space: 0.48 },
  "long rains": { mode: "major", bpm: 0, cutoff: 0.92, space: 0.36 },
  "high sun": { mode: "major", bpm: 3, cutoff: 1.08, space: 0.26 },
  "short rains": { mode: "minor", bpm: -1, cutoff: 0.9, space: 0.36 },
  "dry season": { mode: "minor", bpm: 1, cutoff: 0.95, space: 0.3 },
};

/** The growth stage for a fraction of life lived. */
export function growthStage(life: number, dead = false): GrowthStage {
  if (dead) return "dead";
  if (life < 0.05) return "sprout";
  if (life < 0.18) return "sapling";
  if (life < 0.45) return "young";
  if (life < 0.72) return "mature";
  if (life < 0.88) return "old";
  return "ancient";
}

const STAGE_LAYERS: Readonly<Record<GrowthStage, Partial<LofiLayers>>> = {
  sprout: { keys: 0.8, bud: 1 },
  sapling: { keys: 0.85, bud: 1, wood: 0.75, hat: 0.5 },
  young: { keys: 0.85, bud: 0.8, wood: 0.25, hat: 0.8, kick: 0.85, snare: 0.75, bass: 0.8 },
  mature: { keys: 0.85, bud: 0.6, hat: 0.85, kick: 0.9, snare: 0.8, bass: 0.9, melody: 0.85 },
  old: { keys: 0.85, bud: 0.6, hat: 0.6, kick: 0.8, snare: 0.7, bass: 0.85, melody: 0.75 },
  ancient: { keys: 0.8, bud: 0.5, wood: 0.3, hat: 0.4, kick: 0.6, snare: 0.5, bass: 0.75, melody: 0.6 },
  dead: { keys: 0.7 },
};
const STAGE_TEMPO: Readonly<Record<GrowthStage, number>> = { sprout: -2, sapling: -1, young: 0, mature: 0, old: -3, ancient: -5, dead: -12 };
const STAGE_DENSITY: Readonly<Record<GrowthStage, number>> = { sprout: 0, sapling: 0, young: 0, mature: 0.9, old: 0.65, ancient: 0.45, dead: 0 };
const STAGE_BUD: Readonly<Record<GrowthStage, number>> = { sprout: 2, sapling: 3, young: 4, mature: 5, old: 5, ancient: 4, dead: 0 };
const NO_LAYERS: LofiLayers = { keys: 0, bass: 0, melody: 0, bud: 0, kick: 0, snare: 0, wood: 0, hat: 0, crackle: 0, hiss: 0, rain: 0, wind: 0, birds: 0, crickets: 0 };

/** Places pitch classes as a close voicing starting at each rotation, and keeps the one nearest the previous voicing. */
function voiceLead(pitchClasses: readonly number[], previous: readonly number[]): number[] {
  const centre = previous.length > 0 ? previous.reduce((sum, note) => sum + note, 0) / previous.length : 62;
  let best: number[] = [];
  let bestCost = Infinity;
  for (let base = KEYS_RANGE[0]; base <= KEYS_RANGE[0] + 11; base += 1) {
    const voicing = closeVoicing(pitchClasses, base);
    const top = voicing[voicing.length - 1] ?? 0;
    if (top > KEYS_RANGE[1]) continue;
    const mean = voicing.reduce((sum, note) => sum + note, 0) / voicing.length;
    const cost = Math.abs(mean - centre) + (previous.length > 0 ? 0 : Math.abs(mean - 62));
    if (cost < bestCost) { bestCost = cost; best = voicing; }
  }
  return best;
}

function closeVoicing(pitchClasses: readonly number[], base: number): number[] {
  const notes: number[] = [];
  let floor = base;
  const start = pitchClasses.findIndex((pc) => pc === ((base % 12) + 12) % 12);
  if (start < 0) return [99];
  for (let index = 0; index < pitchClasses.length; index += 1) {
    const pc = at(pitchClasses, start + index);
    let note = floor + ((((pc - floor) % 12) + 12) % 12);
    if (note < floor) note += 12;
    notes.push(note);
    floor = note + 1;
  }
  return notes;
}

function placeInRange(pitchClass: number, range: readonly [number, number]): number {
  let note = range[0] + ((((pitchClass - range[0]) % 12) + 12) % 12);
  while (note > range[1]) note -= 12;
  return note;
}

function buildChords(progression: Progression, tonic: number): LofiChord[] {
  const chords: LofiChord[] = [];
  let previous: readonly number[] = [];
  for (const [offset, quality] of progression) {
    const root = (tonic + offset) % 12;
    const intervals = QUALITIES[quality] ?? [0, 4, 7];
    // Rootless voicings: the bass has the root, the keys the colour tones.
    const colour = intervals.length > 3 ? intervals.slice(1) : intervals;
    const pitchClasses = [...new Set(colour.map((interval) => (root + interval) % 12))].sort((a, b) => a - b);
    const keys = voiceLead(pitchClasses, previous);
    previous = keys;
    chords.push({ bass: placeInRange(root, BASS_RANGE), keys });
  }
  return chords;
}

function buildScale(tonic: number, mode: LofiMode): number[] {
  const base = placeInRange(tonic, [64, 75]);
  const notes: number[] = [];
  for (let degree = 0; degree <= 10; degree += 1) {
    const octave = Math.floor(degree / 5);
    notes.push(base + octave * 12 + at(PENTATONIC[mode], degree));
  }
  return notes.map((note) => {
    let folded = note;
    while (folded > MELODY_RANGE[1]) folded -= 12;
    while (folded < MELODY_RANGE[0]) folded += 12;
    return folded;
  });
}

function stageLayers(stage: GrowthStage): LofiLayers {
  return { ...NO_LAYERS, ...STAGE_LAYERS[stage] };
}

const WARM_SEASONS = new Set(["spring", "summer", "long rains", "high sun"]);
interface Air {
  readonly rain: number;
  readonly wind: number;
  /** Scales the kit: snow muffles it. */
  readonly hush: number;
  /** Scales the master low-pass. */
  readonly shade: number;
  readonly space: number;
}
const WEATHER_AIR: Readonly<Record<string, Air>> = {
  clear: { rain: 0, wind: 0, hush: 1, shade: 1, space: 0 },
  wind: { rain: 0, wind: 0.5, hush: 1, shade: 1, space: 0 },
  leaves: { rain: 0, wind: 0.35, hush: 1, shade: 1, space: 0 },
  rain: { rain: 0.7, wind: 0, hush: 1, shade: 0.85, space: 0 },
  snow: { rain: 0, wind: 0.2, hush: 0.8, shade: 0.72, space: 0.1 },
};
const airOf = (weather: string | undefined): Air => WEATHER_AIR[weather ?? "clear"] ?? { rain: 0, wind: 0, hush: 1, shade: 1, space: 0 };
const STAGE_DUST: Readonly<Record<GrowthStage, { readonly crackle: number; readonly hiss: number; readonly shade: number; readonly wow: number }>> = {
  sprout: { crackle: 0.6, hiss: 0.5, shade: 1, wow: 0.25 },
  sapling: { crackle: 0.6, hiss: 0.5, shade: 1, wow: 0.25 },
  young: { crackle: 0.6, hiss: 0.5, shade: 1, wow: 0.25 },
  mature: { crackle: 0.6, hiss: 0.5, shade: 1, wow: 0.25 },
  old: { crackle: 0.65, hiss: 0.5, shade: 0.92, wow: 0.38 },
  ancient: { crackle: 0.85, hiss: 0.55, shade: 0.8, wow: 0.5 },
  dead: { crackle: 1, hiss: 0.8, shade: 0.55, wow: 0.7 },
};

function worldLayers(layers: LofiLayers, input: LofiInput, stage: GrowthStage, season: string): LofiLayers {
  const night = clamp(input.night ?? 0, 0, 1);
  const air = airOf(input.weather);
  // Birds sing on warm days and crickets on warm nights, never in the rain or in open space.
  const alive = input.nature !== false && WARM_SEASONS.has(season) && air.rain === 0 ? 1 : 0;
  return {
    ...layers,
    kick: layers.kick * mix(1, 0.7, night) * air.hush,
    snare: layers.snare * mix(1, 0.65, night) * air.hush,
    hat: layers.hat * mix(1, 0.45, night) * air.hush,
    melody: layers.melody * mix(1, 0.85, night),
    crackle: STAGE_DUST[stage].crackle,
    hiss: STAGE_DUST[stage].hiss,
    rain: air.rain,
    wind: air.wind,
    birds: alive * clamp(1 - night * 1.6, 0, 1) * 0.8,
    crickets: alive * clamp((night - 0.55) * 2.5, 0, 1) * 0.7,
  };
}

interface SeedPicks {
  readonly major: number;
  readonly song: number;
  /** Beats per minute added to the song's tempo, -2 to 2. */
  readonly nudge: number;
}

/** What the seed fixes for the tree's whole life. */
function seedPicks(seed: number): SeedPicks {
  const pick = random(mixHash(seed, 0x10f1));
  return {
    major: at(TONICS, Math.floor(pick() * TONICS.length)),
    song: Math.floor(pick() * 4),
    nudge: Math.floor(pick() * 5) - 2,
  };
}

interface Choices {
  readonly season: string;
  readonly stage: GrowthStage;
  readonly tonic: number;
  readonly id: string;
  /** The song with any audition overrides applied. */
  readonly song: Song;
  readonly species: string;
}

function songMode(id: string | undefined): LofiMode | null {
  return id !== undefined ? (SONGS[id]?.mode ?? null) : null;
}

const stageOf = (input: LofiInput): GrowthStage => growthStage(clamp(input.life ?? 0.5, 0, 1), input.dead === true);

/** The song's own parts, the seed's nudge on its tempo, then any audition overrides. */
function arrange(base: Song, picks: SeedPicks, song: LofiSong): Song {
  const set = Object.entries({ tempo: song.tempo, groove: song.groove, comp: song.comp, bassLine: song.bassLine, keys: song.keys, lead: song.lead }).filter(([, value]) => value !== undefined);
  return { ...base, tempo: base.tempo + picks.nudge, ...Object.fromEntries(set) };
}

/** The seed's picks and the moment, with any audition overrides on top. */
function choose(input: LofiInput, seed: number): Choices {
  const overrides = input.song ?? {};
  const picks = seedPicks(seed);
  const season = known(SEASON_MOODS, overrides.season ?? input.season, "spring");
  const forced = songMode(overrides.progression);
  const mode = forced ?? SEASON_MOODS[season]?.mode ?? "major";
  const id = forced !== null ? (overrides.progression ?? "bloom") : at(songsIn(mode), picks.song);
  const major = overrides.key ?? picks.major;
  return {
    season,
    stage: overrides.stage ?? stageOf(input),
    tonic: mode === "major" ? major : (major + 9) % 12,
    id,
    song: arrange(songOf(id), picks, overrides),
    species: known(SPECIES_MOTIFS, overrides.melody ?? input.species, "cherry"),
  };
}

const known = <T>(table: Readonly<Record<string, T>>, key: string | undefined, fallback: string): string => (key !== undefined && key in table ? key : fallback);

/** The whole score for one moment of a tree's life. Pure. */
export function lofiScore(input: LofiInput): LofiScore {
  const seed = seedNumber(input.seed);
  const { season, stage, tonic, id, song, species } = choose(input, seed);
  const mood = SEASON_MOODS[season] ?? { mode: "major", bpm: 0, cutoff: 1, space: 0.32 };
  const night = clamp(input.night ?? 0, 0, 1);
  const air = airOf(input.weather);
  const parts = [song.comp, song.groove, song.bassLine, song.keys, song.lead, song.barsPerChord];
  return {
    seed,
    species,
    stage,
    mode: song.mode,
    tonic,
    bpm: Math.round(clamp(song.tempo + mood.bpm + STAGE_TEMPO[stage] - night * 3, BPM_RANGE[0], BPM_RANGE[1])),
    swing: song.swing,
    progression: id,
    chords: buildChords(song.chords, tonic),
    scale: buildScale(tonic, song.mode),
    motif: SPECIES_MOTIFS[species] ?? [],
    comp: song.comp,
    groove: song.groove,
    bassLine: song.bassLine,
    barsPerChord: song.barsPerChord,
    keysVoice: song.keys,
    lead: song.lead,
    density: STAGE_DENSITY[stage],
    budNotes: STAGE_BUD[stage],
    budFalls: song.mode === "minor",
    layers: worldLayers(stageLayers(stage), input, stage, season),
    cutoff: Math.round(6000 * mood.cutoff * mix(1, 0.7, night) * air.shade * STAGE_DUST[stage].shade),
    wow: STAGE_DUST[stage].wow,
    space: clamp(mood.space + night * 0.14 + air.space, 0, 0.7),
    structure: [seed, species, stage, season, tonic, id, ...parts].join(":"),
  };
}

// ---------------------------------------------------------------- events

export type LofiVoice = "keys" | "bass" | "melody" | "bud" | "kick" | "snare" | "wood" | "hat" | "bird" | "cricket";

/** One note to play at a 16th step. */
export interface LofiEvent {
  readonly voice: LofiVoice;
  /** MIDI notes (drums use one nominal note). */
  readonly notes: readonly number[];
  /** Length in 16ths. */
  readonly length: number;
  readonly velocity: number;
  /** Seconds after the step: a human push or drag. */
  readonly nudge: number;
  /** Seconds between notes of a chord or a figure. */
  readonly spread: number;
}

const event = (voice: LofiVoice, notes: readonly number[], length: number, velocity: number, nudge = 0, spread = 0): LofiEvent => ({
  voice, notes, length, velocity: clamp(velocity, 0.02, 1), nudge, spread,
});
const human = (rng: () => number, amount: number): number => (rng() - 0.5) * 2 * amount;

/** The chord under a bar of the form, and whether the bar is that chord's last. */
function chordAt(score: LofiScore, inForm: number): { chord: LofiChord; next: LofiChord; last: boolean } {
  const index = Math.floor(inForm / score.barsPerChord);
  return { chord: at(score.chords, index), next: at(score.chords, index + 1), last: (inForm + 1) % score.barsPerChord === 0 };
}

/** A broken chord in eighths, up and back down. */
function arpeggioEvents(score: LofiScore, chord: LofiChord, step: number, rng: () => number): LofiEvent[] {
  if (step % 2 !== 0) return [];
  const notes = [...chord.keys, ...chord.keys.slice(1, -1).reverse()];
  const note = at(notes, step / 2);
  return [event("keys", [note], 3, (step % 8 === 0 ? 0.58 : 0.44) + human(rng, 0.06), Math.abs(human(rng, 0.008)))];
}

function keysEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.keys <= 0.01) return [];
  const rng = barRandom(score.seed, bar, "keys");
  const { chord, last } = chordAt(score, bar % FORM_BARS);
  if (score.comp === ARPEGGIO) return arpeggioEvents(score, chord, step, rng);
  // The second bar of a long chord leans back to a held pad half the time.
  const held = score.barsPerChord === 2 && last && rng() < 0.5;
  const pattern = held ? at(COMPS, 0) : at(COMPS, rng() < 0.16 ? score.comp + 1 : score.comp);
  const hits = pattern.filter(([start]) => start === step);
  return hits.map(([, length, velocity]) => event("keys", chord.keys, length, velocity * (held ? 0.75 : 1) + human(rng, 0.06), Math.abs(human(rng, 0.012)), 0.011 + rng() * 0.012));
}

function bassEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.bass <= 0.01) return [];
  const rng = barRandom(score.seed, bar, "bass");
  const { chord, next, last } = chordAt(score, bar % FORM_BARS);
  const events: LofiEvent[] = [];
  for (const [start, tone, length] of at(BASS_LINES, score.bassLine)) {
    if (start !== step) continue;
    const note = tone === "fifth" ? chord.bass + 7 : tone === "octave" ? chord.bass + 12 : chord.bass;
    events.push(event("bass", [note], length, 0.75 + human(rng, 0.08), human(rng, 0.006)));
  }
  // A chromatic step into the next chord, at the end of a chord's last bar.
  if (step === 14 && last && rng() < 0.5) events.push(event("bass", [next.bass + (rng() < 0.5 ? -1 : 1)], 2, 0.55));
  return events;
}

/** The phrase plan of a form: statement, answer, varied statement, then the budding figure. */
function melodyEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.melody <= 0.01 || score.density <= 0) return [];
  const inForm = bar % FORM_BARS;
  const cycle = Math.floor(bar / FORM_BARS);
  // Every fourth pass the melody rests and lets the room breathe.
  if (inForm >= 6 || cycle % 4 === 3) return [];
  const phrase = Math.floor(inForm / 2);
  const offset = (inForm % 2) * STEPS_PER_BAR + step;
  const rng = random(mixHash(score.seed, cycle, phrase, VOICE_SALT.melody));
  const events: LofiEvent[] = [];
  score.motif.forEach(([start, degree, length], index) => {
    const keep = index === 0 || rng() < score.density;
    const moved = phrase === 2 && rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
    // The answer comes home: its last note lands on the tonic.
    const resolved = phrase === 1 && index === score.motif.length - 1 ? 0 : degree + moved;
    if (start !== offset || !keep) return;
    events.push(event("melody", [at(score.scale, clamp(resolved, 0, score.scale.length - 1))], length, 0.62 + human(rng, 0.1), Math.abs(human(rng, 0.01))));
  });
  return events;
}

/** Closes each form with a figure that grows a note with each stage of the tree. */
function budEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.bud <= 0.01 || score.budNotes <= 0 || bar % FORM_BARS !== 6 || step !== 8) return [];
  const rng = barRandom(score.seed, bar, "melody");
  const start = score.budFalls ? score.budNotes + 1 : Math.floor(rng() * 2);
  const notes = Array.from({ length: score.budNotes }, (_, index) => at(score.scale, clamp(score.budFalls ? start - index : start + index, 0, score.scale.length - 1)));
  return [event("bud", notes, 6, 0.5, 0, 60 / score.bpm / 2)];
}

interface DrumBar {
  readonly score: LofiScore;
  readonly groove: Groove;
  readonly step: number;
  readonly inForm: number;
  readonly rng: () => number;
}

function kickEvent(bar: DrumBar, breakBar: boolean): LofiEvent | null {
  const { score, groove, step, rng } = bar;
  const ghost = step === 7 && rng() < 0.18;
  if (score.layers.kick <= 0.01 || breakBar || !(groove.kick.includes(step) || ghost)) return null;
  return event("kick", [33], 2, (ghost ? 0.45 : 0.9) + human(rng, 0.06), human(rng, 0.005));
}

function snareEvent(bar: DrumBar): LofiEvent | null {
  const { score, groove, step, inForm, rng } = bar;
  const backbeat = groove.snare.includes(step);
  const fill = inForm === 7 && (step === 14 || step === 15) && rng() < 0.6;
  const ghost = step === 15 && rng() < 0.12;
  if (score.layers.snare <= 0.01 || !(backbeat || fill || ghost)) return null;
  return event("snare", [38], 2, (backbeat ? 0.8 : 0.3) + human(rng, 0.06), 0.004 + Math.abs(human(rng, 0.012)));
}

/** Before the tree has a kit, a wooden knock keeps the backbeat. */
function woodEvent(bar: DrumBar): LofiEvent | null {
  const { score, step, rng } = bar;
  const ghost = step === 14 && rng() < 0.25;
  if (score.layers.wood <= 0.01 || !(step === 4 || step === 12 || ghost)) return null;
  return event("wood", [76], 1, (ghost ? 0.35 : 0.7) + human(rng, 0.08), human(rng, 0.006));
}

function hatEvent(bar: DrumBar): LofiEvent | null {
  const { score, groove, step, rng } = bar;
  if (score.layers.hat <= 0.01 || !groove.hat.includes(step) || rng() < 0.08) return null;
  return event("hat", [42], 1, at(HAT_ACCENTS, Math.floor(step / 2)) + human(rng, 0.08), human(rng, 0.007));
}

function drumEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  const inForm = bar % FORM_BARS;
  // The last bar of every fourth pass drops the kick for a breath.
  const breakBar = inForm === 7 && Math.floor(bar / FORM_BARS) % 4 === 3;
  const drums: DrumBar = { score, groove: at(GROOVES, score.groove), step, inForm, rng: barRandom(score.seed, bar * STEPS_PER_BAR + step, "drums") };
  return [kickEvent(drums, breakBar), snareEvent(drums), woodEvent(drums), hatEvent(drums)].filter((item): item is LofiEvent => item !== null);
}

function natureEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  const rng = barRandom(score.seed, bar * STEPS_PER_BAR + step, "nature");
  const events: LofiEvent[] = [];
  if (score.layers.birds > 0.01 && rng() < 0.012 * score.layers.birds) {
    const base = 91 + Math.floor(rng() * 8);
    const notes = Array.from({ length: 2 + Math.floor(rng() * 3) }, (_, index) => base + (index % 2 === 0 ? 0 : 3 + Math.floor(rng() * 4)));
    events.push(event("bird", notes, 1, 0.5 + rng() * 0.3, rng() * 0.05, 0.06 + rng() * 0.03));
  }
  if (score.layers.crickets > 0.01 && step % 4 === 0 && rng() < 0.55) {
    events.push(event("cricket", [107, 107, 107], 1, 0.4 + rng() * 0.3, rng() * 0.08, 0.045));
  }
  return events;
}

/**
 * Everything that plays at a 16th step since the band started. Pure: the
 * same score and step always give the same events.
 */
export function stepEvents(score: LofiScore, step: number): LofiEvent[] {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  return [
    ...keysEvents(score, bar, inBar),
    ...bassEvents(score, bar, inBar),
    ...melodyEvents(score, bar, inBar),
    ...budEvents(score, bar, inBar),
    ...drumEvents(score, bar, inBar),
    ...natureEvents(score, bar, inBar),
  ];
}

// ---------------------------------------------------------------- the band (Tone.js injected)

interface ParamLike {
  value: number;
  rampTo(value: number, rampTime: number): unknown;
}
interface NodeLike {
  connect(destination: unknown): unknown;
  dispose(): unknown;
}
interface InstrumentLike extends NodeLike {
  readonly volume: ParamLike;
  triggerAttackRelease(note: number, duration: number, time?: number, velocity?: number): unknown;
  releaseAll?(time?: number): unknown;
}
interface SourceLike extends NodeLike {
  readonly volume: ParamLike;
  start(time?: number): unknown;
  stop(time?: number): unknown;
}
interface FilterLike extends NodeLike {
  readonly frequency: ParamLike;
}
interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}
interface LfoEffectLike extends NodeLike {
  readonly depth: ParamLike;
  start(time?: number): unknown;
}
interface TransportLike {
  readonly bpm: ParamLike;
  swing: number;
  swingSubdivision: string;
  scheduleRepeat(callback: (time: number) => void, interval: string, startTime?: number): number;
  clear(id: number): unknown;
  start(time?: number): unknown;
  stop(time?: number): unknown;
  cancel(after?: number): unknown;
}
type Options = Readonly<Record<string, unknown>>;

/** The parts of Tone.js 15 this module calls. Pass the Tone namespace itself. */
export interface ToneLike {
  now(): number;
  getTransport(): TransportLike;
  getDestination(): NodeLike;
  readonly PolySynth: new (voice: unknown, options?: Options) => InstrumentLike;
  readonly FMSynth: new (options?: Options) => InstrumentLike;
  readonly Synth: new (options?: Options) => InstrumentLike;
  readonly MonoSynth: new (options?: Options) => InstrumentLike;
  readonly MembraneSynth: new (options?: Options) => InstrumentLike;
  readonly NoiseSynth: new (options?: Options) => InstrumentLike & { triggerAttackRelease(duration: number, time?: number, velocity?: number): unknown };
  readonly Noise: new (options?: Options) => SourceLike;
  readonly Player: new (options?: Options) => SourceLike;
  readonly ToneAudioBuffer: { fromArray(array: Float32Array): unknown };
  readonly Filter: new (options?: Options) => FilterLike;
  readonly Gain: new (gain?: number) => GainLike;
  readonly Reverb: new (options?: Options) => NodeLike;
  readonly FeedbackDelay: new (options?: Options) => NodeLike;
  readonly Distortion: new (options?: Options) => NodeLike;
  readonly Compressor: new (options?: Options) => NodeLike;
  readonly Vibrato: new (options?: Options) => LfoEffectLike & { readonly frequency: ParamLike };
  readonly Tremolo: new (options?: Options) => LfoEffectLike;
  readonly AutoFilter: new (options?: Options) => LfoEffectLike;
}

export interface LofiBand {
  /** Starts the loop from its first bar on Tone's transport. */
  start(score: LofiScore): void;
  /**
   * Mix and tempo follow at once; a new structure waits for the next bar line.
   * `fromTop` starts the new structure from the first bar of its form.
   */
  setScore(score: LofiScore, options?: { readonly fromTop?: boolean }): void;
  stop(): void;
  dispose(): void;
  readonly playing: boolean;
  readonly score: LofiScore | null;
}

export interface LofiOptions {
  /** Where the band plays; defaults to Tone's destination (keel-audio sets its level and mute). */
  readonly destination?: unknown;
  /** Master level in decibels. Defaults to 0. */
  readonly volume?: number;
}

const hz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

function crackleBuffer(tone: ToneLike, seed: number): unknown {
  const rng = random(mixHash(seed, VOICE_SALT.crackle));
  // Seven seconds at the usual rate; a 48 kHz context just loops it a little sooner.
  const length = 44100 * 7;
  const data = new Float32Array(length);
  let tail = 0;
  for (let index = 0; index < length; index += 1) {
    const roll = rng();
    // Rare loud pops, more frequent dust, each a decaying click.
    if (roll < 0.00012) tail = (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.5);
    else if (roll < 0.0028) tail = (rng() - 0.5) * 0.12;
    data[index] = tail;
    tail *= 0.62;
  }
  return tone.ToneAudioBuffer.fromArray(data);
}

interface Rig {
  readonly instruments: Readonly<Record<LofiVoice, InstrumentLike>>;
  readonly keysVoices: Readonly<Record<KeysVoice, InstrumentLike>>;
  readonly leads: Readonly<Record<LeadVoice, InstrumentLike>>;
  readonly gains: Readonly<Record<keyof LofiLayers, GainLike>>;
  readonly sources: readonly SourceLike[];
  readonly lowpass: FilterLike;
  readonly wow: LfoEffectLike;
  readonly send: GainLike;
  readonly nodes: NodeLike[];
}

function buildBus(tone: ToneLike, options: LofiOptions, nodes: NodeLike[]): { input: GainLike; lowpass: FilterLike; send: GainLike; wow: LfoEffectLike } {
  const keep = <T extends NodeLike>(node: T): T => { nodes.push(node); return node; };
  const compressor = keep(new tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.25 }));
  compressor.connect(options.destination ?? tone.getDestination());
  const master = keep(new tone.Gain(10 ** ((options.volume ?? 0) / 20)));
  master.connect(compressor);
  const lowpass = keep(new tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -12, Q: 0.3 }));
  const tape = keep(new tone.Distortion({ distortion: 0.08, oversample: "2x", wet: 0.5 }));
  const wow = keep(new tone.Vibrato({ frequency: 0.45, depth: 0.25, maxDelay: 0.006 }));
  const input = keep(new tone.Gain(1));
  input.connect(wow);
  wow.connect(tape);
  tape.connect(lowpass);
  lowpass.connect(master);
  const reverb = keep(new tone.Reverb({ decay: 3.8, preDelay: 0.02, wet: 1 }));
  reverb.connect(lowpass);
  const send = keep(new tone.Gain(0.3));
  send.connect(reverb);
  return { input, lowpass, send, wow };
}

/** A synth patch: which Tone synth, its options, its level, a tone filter and an optional wobble. */
interface Patch {
  readonly synth: "Synth" | "FMSynth";
  readonly options: Options;
  readonly volume: number;
  readonly cutoff: number;
  readonly tremolo?: readonly [number, number];
  readonly vibrato?: readonly [number, number];
  /** Octaves the voice plays above the written notes. */
  readonly octave?: number;
}

const KEYS_PATCHES: Readonly<Record<KeysVoice, Patch>> = {
  // A soft, felted upright: a quick hammer and a long fade.
  felt: { synth: "Synth", volume: -3, cutoff: 1900, options: { oscillator: { type: "triangle" }, envelope: { attack: 0.004, decay: 1.9, sustain: 0.04, release: 1.1 } } },
  // An electric piano: bell-cored FM with a slow tremolo.
  rhodes: {
    synth: "FMSynth", volume: -4, cutoff: 2400, tremolo: [3.2, 0.3],
    options: { harmonicity: 1, modulationIndex: 1.4, oscillator: { type: "sine" }, modulation: { type: "triangle" }, envelope: { attack: 0.006, decay: 2.4, sustain: 0.14, release: 1.3 }, modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.08, release: 0.6 } },
  },
  // A breathy organ that swells and holds.
  organ: { synth: "Synth", volume: -11, cutoff: 2600, vibrato: [5.6, 0.08], options: { oscillator: { type: "custom", partials: [1, 0.45, 0.25, 0, 0.12] }, envelope: { attack: 0.07, decay: 0.3, sustain: 0.75, release: 0.9 } } },
  // A nylon-string pluck, dark and short.
  nylon: { synth: "Synth", volume: -7, cutoff: 1400, options: { oscillator: { type: "sawtooth" }, envelope: { attack: 0.002, decay: 0.55, sustain: 0, release: 0.35 } } },
};

const LEAD_PATCHES: Readonly<Record<LeadVoice, Patch>> = {
  // Woody FM pluck.
  kalimba: { synth: "FMSynth", volume: -6, cutoff: 5000, options: { harmonicity: 3.01, modulationIndex: 5, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.7 }, modulationEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 } } },
  // A small bell an octave up.
  musicbox: { synth: "FMSynth", volume: -12, cutoff: 6000, octave: 1, options: { harmonicity: 5.07, modulationIndex: 1.6, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.001, decay: 1.6, sustain: 0, release: 1.2 }, modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 } } },
  // A soft wooden flute that breathes in and wavers.
  flute: { synth: "Synth", volume: -8, cutoff: 3200, vibrato: [5, 0.12], options: { oscillator: { type: "sine" }, envelope: { attack: 0.07, decay: 0.15, sustain: 0.7, release: 0.45 } } },
  // Mallets on metal bars with the motor on.
  vibes: { synth: "FMSynth", volume: -8, cutoff: 4500, tremolo: [5.5, 0.45], options: { harmonicity: 4, modulationIndex: 1.1, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 1.6 }, modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 } } },
};

type Keep = <T extends NodeLike>(node: T) => T;

/** Builds a patch as synth → wobble → tone filter → out. */
function buildPatch(tone: ToneLike, keep: Keep, patch: Patch, out: NodeLike): InstrumentLike {
  const synth = keep(new tone.PolySynth(tone[patch.synth], patch.options));
  synth.volume.value = patch.volume;
  const filter = keep(new tone.Filter({ type: "lowpass", frequency: patch.cutoff, Q: 0.4 }));
  let head: NodeLike = synth;
  if (patch.tremolo) {
    const tremolo = keep(new tone.Tremolo({ frequency: patch.tremolo[0], depth: patch.tremolo[1], spread: 60 }));
    tremolo.start();
    head.connect(tremolo);
    head = tremolo;
  }
  if (patch.vibrato) {
    const vibrato = keep(new tone.Vibrato({ frequency: patch.vibrato[0], depth: patch.vibrato[1] }));
    head.connect(vibrato);
    head = vibrato;
  }
  head.connect(filter);
  filter.connect(out);
  return synth;
}

function buildVoices<V extends string>(tone: ToneLike, keep: Keep, patches: Readonly<Record<V, Patch>>, out: NodeLike): Record<V, InstrumentLike> {
  const voices = {} as Record<V, InstrumentLike>;
  for (const voice of Object.keys(patches) as V[]) voices[voice] = buildPatch(tone, keep, patches[voice], out);
  return voices;
}

function buildDrums(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], out: NodeLike): Pick<Rig["instruments"], "kick" | "snare" | "wood" | "hat"> {
  // The kit is dusty: low-passed and a little crushed before the tape.
  const kitTone = keep(new tone.Filter({ type: "lowpass", frequency: 5200, Q: 0.5 }));
  const grit = keep(new tone.Distortion({ distortion: 0.18, wet: 0.35 }));
  kitTone.connect(grit);
  grit.connect(out);
  const kick = keep(new tone.MembraneSynth({ pitchDecay: 0.045, octaves: 4.5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 } }));
  kick.volume.value = -8;
  const snare = keep(new tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 } }));
  snare.volume.value = -10;
  const snareBand = keep(new tone.Filter({ type: "bandpass", frequency: 1900, Q: 0.7 }));
  const wood = keep(new tone.MembraneSynth({ pitchDecay: 0.008, octaves: 1.6, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03 } }));
  wood.volume.value = -10;
  const hat = keep(new tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 } }));
  hat.volume.value = -12;
  const hatBand = keep(new tone.Filter({ type: "highpass", frequency: 7200 }));
  kick.connect(gains.kick);
  snare.connect(snareBand);
  snareBand.connect(gains.snare);
  wood.connect(gains.wood);
  hat.connect(hatBand);
  hatBand.connect(gains.hat);
  for (const key of ["kick", "snare", "wood"] as const) gains[key].connect(kitTone);
  // The hats skip the kit's low-pass, which would take them away entirely.
  gains.hat.connect(out);
  return { kick, snare, wood, hat };
}

function buildAir(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], seed: number, out: NodeLike): SourceLike[] {
  const crackle = keep(new tone.Player({ url: crackleBuffer(tone, seed), loop: true }));
  crackle.volume.value = -20;
  const hiss = keep(new tone.Noise({ type: "brown" }));
  hiss.volume.value = -42;
  const rain = keep(new tone.Noise({ type: "pink" }));
  rain.volume.value = -23;
  const rainTone = keep(new tone.Filter({ type: "bandpass", frequency: 2400, Q: 0.35 }));
  const wind = keep(new tone.Noise({ type: "pink" }));
  wind.volume.value = -20;
  const gust = keep(new tone.AutoFilter({ frequency: 0.07, baseFrequency: 160, octaves: 3.4, filter: { type: "bandpass", Q: 1.4 } }));
  gust.start();
  crackle.connect(gains.crackle);
  hiss.connect(gains.hiss);
  rain.connect(rainTone);
  rainTone.connect(gains.rain);
  wind.connect(gust);
  gust.connect(gains.wind);
  for (const key of ["crackle", "hiss", "rain", "wind"] as const) gains[key].connect(out);
  return [crackle, hiss, rain, wind];
}

function buildNature(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], out: NodeLike): Pick<Rig["instruments"], "bird" | "cricket"> {
  const bird = keep(new tone.Synth({ portamento: 0.028, oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.07, sustain: 0.2, release: 0.05 } }));
  bird.volume.value = -27;
  const cricket = keep(new tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.002, decay: 0.02, sustain: 0, release: 0.01 } }));
  cricket.volume.value = -36;
  bird.connect(gains.birds);
  cricket.connect(gains.crickets);
  gains.birds.connect(out);
  gains.crickets.connect(out);
  return { bird, cricket };
}

function buildRig(tone: ToneLike, seed: number, options: LofiOptions): Rig {
  const nodes: NodeLike[] = [];
  const keep = <T extends NodeLike>(node: T): T => { nodes.push(node); return node; };
  const bus = buildBus(tone, options, nodes);
  const gains = Object.fromEntries(Object.keys(NO_LAYERS).map((key) => [key, keep(new tone.Gain(0))])) as unknown as Rig["gains"];
  const keysVoices = buildVoices(tone, keep, KEYS_PATCHES, gains.keys);
  // The leads share a dotted-eighth echo.
  const echo = keep(new tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.26, wet: 0.24 }));
  echo.connect(gains.melody);
  const leads = buildVoices(tone, keep, LEAD_PATCHES, echo);
  // The budding figure has a kalimba of its own, so a sprout can sing before the tree has a melody.
  const bud = buildPatch(tone, keep, LEAD_PATCHES.kalimba, gains.bud);
  const bass = keep(new tone.MonoSynth({
    oscillator: { type: "triangle" },
    filter: { type: "lowpass", Q: 1 },
    envelope: { attack: 0.012, decay: 0.3, sustain: 0.65, release: 0.35 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.3, baseFrequency: 110, octaves: 2.2 },
  }));
  bass.volume.value = -11;
  bass.connect(gains.bass);
  for (const key of ["keys", "melody", "bud", "bass"] as const) gains[key].connect(bus.input);
  // The melody and keys sit in the room; the kit and bass stay close.
  gains.keys.connect(bus.send);
  gains.melody.connect(bus.send);
  gains.bud.connect(bus.send);
  const drums = buildDrums(tone, keep, gains, bus.input);
  const sources = buildAir(tone, keep, gains, seed, bus.lowpass);
  const nature = buildNature(tone, keep, gains, bus.lowpass);
  gains.birds.connect(bus.send);
  return { instruments: { keys: keysVoices.felt, melody: leads.kalimba, bud, bass, ...drums, ...nature }, keysVoices, leads, gains, sources, lowpass: bus.lowpass, wow: bus.wow, send: bus.send, nodes };
}

function applyMix(rig: Rig, score: LofiScore, ramp: number): void {
  for (const key of Object.keys(score.layers) as (keyof LofiLayers)[]) {
    rig.gains[key].gain.rampTo(score.layers[key], ramp);
  }
  rig.lowpass.frequency.rampTo(score.cutoff, ramp);
  rig.wow.depth.rampTo(score.wow, ramp);
  rig.send.gain.rampTo(score.space, ramp);
}

/** The instrument and octave shift for an event under the current song. */
function voiceFor(rig: Rig, score: LofiScore, voice: LofiVoice): [InstrumentLike, number] {
  if (voice === "keys") return [rig.keysVoices[score.keysVoice], 0];
  if (voice === "melody") return [rig.leads[score.lead], (LEAD_PATCHES[score.lead].octave ?? 0) * 12];
  return [rig.instruments[voice], 0];
}

const lastStart = new WeakMap<InstrumentLike, number>();

/**
 * Tone refuses a note that starts before an instrument's previous one, and a
 * human nudge or two lines landing on one 16th can ask for that; keep each
 * instrument's starts in order instead.
 */
function inOrder(instrument: InstrumentLike, time: number): number {
  const start = Math.max(time, (lastStart.get(instrument) ?? 0) + 0.002);
  lastStart.set(instrument, start);
  return start;
}

function play(rig: Rig, score: LofiScore, item: LofiEvent, time: number, sixteenth: number): void {
  const [instrument, shift] = voiceFor(rig, score, item.voice);
  const duration = Math.max(0.03, item.length * sixteenth);
  if (item.voice === "snare" || item.voice === "hat") {
    (instrument as InstrumentLike & { triggerAttackRelease(duration: number, time?: number, velocity?: number): unknown }).triggerAttackRelease(duration, inOrder(instrument, time + item.nudge), item.velocity);
    return;
  }
  item.notes.forEach((note, index) => {
    instrument.triggerAttackRelease(hz(note + shift), duration, inOrder(instrument, time + item.nudge + index * item.spread), item.velocity);
  });
}

function silence(rig: Rig, now: number): void {
  for (const source of rig.sources) source.stop(now + 0.05);
  for (const instrument of [...Object.values(rig.instruments), ...Object.values(rig.keysVoices), ...Object.values(rig.leads)]) instrument.releaseAll?.(now);
}

/**
 * The band: builds a small Tone.js graph and plays `stepEvents` on Tone's
 * transport. Tone is injected; the module never imports it or reads globals.
 */
export function createLofi(tone: ToneLike, options: LofiOptions = {}): LofiBand {
  let rig: Rig | null = null;
  let current: LofiScore | null = null;
  let pending: LofiScore | null = null;
  let fromTop = false;
  let repeat = -1;
  let step = 0;
  const transport = tone.getTransport();

  const tick = (time: number): void => {
    if (rig === null || current === null) return;
    if (pending !== null && step % STEPS_PER_BAR === 0) {
      [current, pending, step, fromTop] = [pending, null, fromTop ? 0 : step, false];
    }
    const sixteenth = 60 / transport.bpm.value / 4;
    for (const item of stepEvents(current, step)) play(rig, current, item, time, sixteenth);
    step += 1;
  };

  const band: LofiBand = {
    get playing() { return repeat >= 0; },
    get score() { return pending ?? current; },
    start(score) {
      band.stop();
      rig ??= buildRig(tone, score.seed, options);
      current = score;
      pending = null;
      step = 0;
      transport.bpm.value = score.bpm;
      transport.swing = score.swing;
      transport.swingSubdivision = "16n";
      applyMix(rig, score, 1.5);
      const now = tone.now();
      for (const source of rig.sources) source.start(now);
      repeat = transport.scheduleRepeat(tick, "16n", 0);
      transport.start(now + 0.1);
    },
    setScore(score, options) {
      if (rig === null || current === null) { current = score; return; }
      if (JSON.stringify(score) === JSON.stringify(pending ?? current)) return;
      applyMix(rig, score, 2.5);
      transport.bpm.rampTo(score.bpm, options?.fromTop === true ? 0.5 : 4);
      transport.swing = score.swing;
      // A routine update must not cancel a restart already waiting for the bar line.
      if (score.structure !== current.structure) [fromTop, pending] = [options?.fromTop === true || (fromTop && pending?.structure === score.structure), score];
      else { current = score; pending = null; }
    },
    stop() {
      if (repeat >= 0) { transport.clear(repeat); repeat = -1; }
      transport.stop();
      transport.cancel(0);
      if (rig !== null) silence(rig, tone.now());
    },
    dispose() {
      band.stop();
      for (const node of rig?.nodes ?? []) node.dispose();
      rig = null;
      current = null;
      pending = null;
    },
  };
  return band;
}
