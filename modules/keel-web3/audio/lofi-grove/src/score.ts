// The score: the input's season, stage, hour and weather arranged into layers, chords and picks.

import {
  BASS_RANGE, BPM_RANGE, KEYS_RANGE, MELODY_RANGE, PENTATONIC, QUALITIES, SONGS, SPECIES_MOTIFS, TONICS, at, clamp,
  mix, songOf, songsIn,
} from "./songbook.js";
import type { KeysVoice, LeadVoice, MotifNote, Progression, Song } from "./songbook.js";
import { mixHash, random, seedNumber } from "./roll.js";

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
export const NO_LAYERS: LofiLayers = { keys: 0, bass: 0, melody: 0, bud: 0, kick: 0, snare: 0, wood: 0, hat: 0, crackle: 0, hiss: 0, rain: 0, wind: 0, birds: 0, crickets: 0 };

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
