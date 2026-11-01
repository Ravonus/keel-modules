// Coats and rare morphs: eye styles, coat colours varied by seed, and the albino, melanistic, golden and spirit skins.

import { clamp, mix } from "../vec.js";
import { SPECIES } from "../roster.js";
import type { Palette, Rarity, Role, SpeciesId, WorldKey } from "../roster.js";
import type { Head } from "./quad-head.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- coats and rare morphs

/**
 * Special skins. The natural ones turn up anywhere, rarely: no pigment, too
 * much, patches, pale, red. The themed ones belong to their worlds: neon in
 * synth, pastel in vapor, crystal in crystal, spirit in the cosmos.
 */
export type Morph = "normal" | "albino" | "melanistic" | "golden" | "spirit" | "piebald" | "leucistic" | "erythristic" | "neon" | "pastel" | "crystal";
export const MORPHS: Readonly<
  Record<
    Morph,
    { readonly label: string; readonly rarity: Rarity; readonly glow: number; readonly lit?: readonly Role[] }
  >
> = {
  normal: { label: "", rarity: "common", glow: 0 },
  albino: { label: "albino", rarity: "epic", glow: 0 },
  melanistic: { label: "black", rarity: "epic", glow: 0 },
  golden: { label: "golden", rarity: "legendary", glow: 0.45 },
  spirit: { label: "spirit", rarity: "epic", glow: 0.35, lit: ["eye", "glow"] },
  piebald: { label: "piebald", rarity: "rare", glow: 0 },
  leucistic: { label: "pale", rarity: "rare", glow: 0 },
  erythristic: { label: "red-phase", rarity: "epic", glow: 0 },
  neon: { label: "neon", rarity: "rare", glow: 0, lit: ["accent", "eye", "glow"] },
  pastel: { label: "pastel", rarity: "rare", glow: 0.1 },
  crystal: { label: "crystal", rarity: "rare", glow: 0.3, lit: ["eye"] },
};

/** The odds of each skin in a world: themed worlds favour their own. */
export const WORLD_SKINS: Partial<Record<WorldKey, readonly (readonly [Morph, number])[]>> = {
  synth: [["neon", 0.12]],
  vapor: [["pastel", 0.12]],
  crystal: [["crystal", 0.14], ["spirit", 0.02]],
  cosmic: [["spirit", 0.1]],
};
export const WILD_SKINS: readonly (readonly [Morph, number])[] = [
  ["albino", 0.012], ["melanistic", 0.015], ["piebald", 0.02], ["leucistic", 0.012], ["erythristic", 0.008], ["golden", 0.003], ["spirit", 0.004],
];

/** Iris colours: dark brown unless the species is known for other eyes. */
/**
 * Eyes by species: the pupil's shape (a hunter's slit, a grazer's bar, a
 * small mammal's or a songbird's eye nearly all pupil, a raccoon's a plain dark
 * bead with one hard spark on it, round otherwise), the
 * eye's size against the usual (a mouse's and a loris's big, a bear's small)
 * and whether a dark rim frames it (an owl's face disc and a parrot's bare
 * ring frame their own).
 */
export interface EyeStyle {
  readonly pupil: "round" | "slit" | "bar" | "dark" | "bead";
  readonly size: number;
  readonly rim: boolean;
  readonly almond: number;
  /**
   * Set low in the face, a flat dome with its spark on it: past the edge of the head it hides, and no fleck of it shows
   * on the rim.
   */
  readonly set?: boolean;
  /**
   * Its upper lid's share of the eye, where its pupil's usual one will not do, and its spark's size, a share of the eye
   * (a tortoise's heavy lid and clear catchlight).
   */
  readonly lid?: number;
  readonly spark?: number;
  /** Its lid is bare skin, not the coat (a macaque's). */
  readonly skinLid?: boolean;
}
export const EYE: EyeStyle = { pupil: "round", size: 1, rim: true, almond: 1 };
const eye = (pupil: EyeStyle["pupil"], size = 1, rim = true, almond = 1): EyeStyle => ({ pupil, size, rim, almond });
/** A bird's, a snake's, a lizard's eye is round, not an almond. */
const roundEye = (pupil: EyeStyle["pupil"], size = 1, rim = true): EyeStyle => eye(pupil, size, rim, 0);
const EYES: Partial<Record<SpeciesId, EyeStyle>> = {
  fox: eye("slit", 1.15), cat: eye("slit"), gecko: roundEye("slit", 1.2), snake: roundEye("slit", 1.05, false),
  deer: eye("bar", 1.15), dikdik: eye("bar", 1.3), mongoose: eye("bar"),
  rabbit: eye("dark", 1.2), mouse: eye("dark", 1.35), hedgehog: { ...roundEye("bead", 0.86, false), set: true }, squirrel: eye("dark", 1.15), marmot: eye("dark"), meerkat: eye("dark", 1.1),
  capybara: eye("dark", 0.9), kangaroo: eye("dark", 1.1), raccoon: roundEye("bead", 0.72, false), redpanda: eye("dark"), tanuki: eye("dark"), badger: eye("dark", 0.8),
  skunk: eye("dark", 0.95), possum: eye("dark", 1.3), sloth: eye("dark", 1, false), loris: eye("dark", 1.7), macaque: { ...eye("round", 1, false, 0.5), lid: 0.56, spark: 0.18, skinLid: true }, monkey: { ...eye("round", 1, false, 0.5), lid: 0.56, spark: 0.18, skinLid: true },
  wolf: eye("round", 1.1), bear: eye("round", 0.8), koala: eye("round", 0.8), tortoise: { ...roundEye("dark", 1.15, false), lid: 0.5, spark: 0.3 },
  songbird: roundEye("dark", 1.1), crow: roundEye("dark"), kookaburra: roundEye("dark", 0.75), woodpecker: roundEye("dark"), peacock: roundEye("dark"), guineafowl: roundEye("dark"),
  owl: roundEye("round", 1, false), parrot: roundEye("round", 1, false), gull: roundEye("round", 0.9, false), crane: roundEye("round", 0.9, false),
};
/**
 * Eyes by coat where a coat has its own: a barn owl's are black, a great horned owl's lemon yellow (orange would make
 * it an eagle-owl).
 */
const COAT_EYES: Readonly<Record<string, { readonly style: EyeStyle; readonly iris: string }>> = {
  barn: { style: roundEye("dark", 1, false), iris: "#1a120c" }, "great horned": { style: roundEye("round", 1, false), iris: "#f2d21b" },
  snowy: { style: roundEye("round", 1, false), iris: "#f2d030" },
  tawny: { style: roundEye("dark", 1, false), iris: "#1a120c" }, ural: { style: roundEye("dark", 1, false), iris: "#1a120c" },
};
export const eyeOfSpecies = (who: Who): Pick<Head, "eye"> => ({ eye: COAT_EYES[who.member.coat]?.style ?? EYES[who.member.species] ?? EYE });

/**
 * A cat's eyes and nose go by its coat: gold on black and orange, green on silver, a red cat's brick nose, a black
 * cat's dark one.
 */
const CAT_FACES: Readonly<Record<string, { readonly iris: string; readonly nose: string }>> = {
  tabby: { iris: "#d8bc68", nose: "#c07c68" }, black: { iris: "#dcb44c", nose: "#2c2424" },
  grey: { iris: "#a0b078", nose: "#c88c94" }, calico: { iris: "#b8a03c", nose: "#e49c9c" },
};

const IRIS: Partial<Record<SpeciesId, string>> = {
  fox: "#c8861c", wolf: "#d8a22a", cat: "#a8b830", bear: "#5a3418", deer: "#3a2414", tortoise: "#2c1c0e", owl: "#f0a820", gull: "#e8d878", parrot: "#e8d070",
  crow: "#2a2420", snake: "#d8b040", gecko: "#c8a038", raccoon: "#3c2414", crane: "#d84a20", peacock: "#3a2414",
  macaque: "#5e3c20", monkey: "#8a5a2a", koala: "#3a2a1a", kangaroo: "#3a2414", woodpecker: "#4a2c1e", crab: "#1a1410",
  tanuki: "#2a1a10", possum: "#1a1210", loris: "#4a3018", mongoose: "#8a5a1a", kookaburra: "#3a2414", guineafowl: "#5a2414",
};

export const hexRgb = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgbHex = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
export const mixColor = (a: string, b: string, k: number): string => {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex(x.map((c, i) => mix(c, y[i] ?? c, k)));
};

export type CoatColors = readonly [string, string, string, string, string];

/**
 * No two animals quite alike: each one's coat is a touch lighter or darker,
 * warmer or cooler than the breed's, and a young one's is softer.
 */
export function varied(colors: CoatColors, rand: () => number, young: boolean): CoatColors {
  const shade = (rand() - 0.5) * 0.24;
  const warmth = (rand() - 0.5) * 0.16;
  const tone = (hex: string, depth: number): string => {
    const lit = shade > 0 ? mixColor(hex, "#ffffff", shade * depth) : mixColor(hex, "#000000", -shade * depth);
    const warm = warmth > 0 ? mixColor(lit, "#c87a3a", warmth * depth) : mixColor(lit, "#7a8ab0", -warmth * depth);
    return young ? mixColor(warm, "#f4ece0", 0.12) : warm;
  };
  const [coat, alt, belly, dark, accent] = colors;
  return [tone(coat, 1), tone(alt, 1), tone(belly, 0.5), tone(dark, 0.4), accent];
}

function skinOf(base: Palette, morph: Morph): Palette {
  const { coat, alt, belly, accent } = base;
  switch (morph) {
    case "albino": return { ...base, coat: "#f6f3ee", alt: "#e9e4dc", belly: "#ffffff", eye: "#e05a6a", pupil: "#a02a3a", nose: "#e8a0a8", shell: "#efe8de" };
    case "melanistic": return { ...base, coat: mixColor(coat, "#0c0a0a", 0.75), alt: mixColor(alt, "#0c0a0a", 0.7), belly: mixColor(belly, "#1a1616", 0.65), eye: "#e8c040", shell: mixColor(base.shell, "#0c0a0a", 0.7) };
    case "golden": return { ...base, coat: "#e8b830", alt: "#c08a18", belly: "#f8e088", accent: "#fff0a0", glow: "#ffe060", horn: "#f8d050", shell: "#d8a020" };
    case "spirit": return { ...base, coat: mixColor(coat, "#bff6ff", 0.75), alt: mixColor(alt, "#7fe0ff", 0.7), belly: "#f0ffff", glow: "#9ff4ff", eye: "#ffffff", pupil: "#5ad8ff", accent: mixColor(accent, "#ffffff", 0.5), shell: mixColor(base.shell, "#7fe0ff", 0.7) };
    case "piebald": return { ...base, alt: "#f6f2ea", belly: "#ffffff", shell: "#f6f2ea" };
    case "leucistic": return { ...base, coat: mixColor(coat, "#f4ecdc", 0.72), alt: mixColor(alt, "#e8dcc8", 0.65), belly: mixColor(belly, "#ffffff", 0.6), shell: mixColor(base.shell, "#e8dcc8", 0.65) };
    case "erythristic": return { ...base, coat: mixColor(coat, "#b8482a", 0.55), alt: mixColor(alt, "#8a3018", 0.5), belly: mixColor(belly, "#e8b8a0", 0.4), shell: mixColor(base.shell, "#8a3018", 0.5) };
    case "neon": return { ...base, coat: mixColor(coat, "#16122a", 0.82), alt: mixColor(alt, "#241c44", 0.8), belly: "#2e2650", dark: "#0a0816", accent: "#ff3ad8", glow: "#3af0ff", eye: "#3af0ff", pupil: "#0a0816", horn: "#ff3ad8", shell: mixColor(base.shell, "#241c44", 0.8) };
    case "pastel": return { ...base, coat: mixColor(coat, "#f6c6de", 0.6), alt: mixColor(alt, "#b8d4ff", 0.55), belly: "#fff2f8", accent: "#a8f0dc", horn: mixColor(base.horn, "#f6c6de", 0.5), shell: mixColor(base.shell, "#b8d4ff", 0.55) };
    case "crystal": return { ...base, coat: mixColor(coat, "#d4ecff", 0.65), alt: mixColor(alt, "#9ab4ff", 0.6), belly: "#f4faff", glow: "#e8f4ff", eye: "#9ff4ff", pupil: "#3a6ad8", shell: "#c8dcff" };
    default: return base;
  }
}

/** Part way to its own grey: a plain coat sits in the scene's tones and leaves the loud colours to the tree. */
const muted = (hex: string, k: number): string => {
  const [r, g, b] = hexRgb(hex);
  const y = r * 0.3 + g * 0.59 + b * 0.11;
  return rgbHex([r, g, b].map((c) => mix(c, y, k)));
};

/**
 * A black coat painted as pixel art paints one: a cool charcoal at least `floor` light (sRGB luma),
 * so it still has shades to turn in, and only the nose and the ink line are truly black.
 */
const CHARCOAL = "#5a6274";
function charcoal(hex: string, floor: number): string {
  const luma = (h: string): number => {
    const [r, g, b] = hexRgb(h);
    return (r * 0.3 + g * 0.59 + b * 0.11) / 255;
  };
  const y = luma(hex);
  return y >= floor ? hex : mixColor(hex, CHARCOAL, (floor - y) / Math.max(0.01, luma(CHARCOAL) - y));
}

/**
 * Eye and nose: by coat where a coat has its own; a nose is its animal's dark, a cat's pink unless its coat says
 * otherwise.
 */
function faceColors(id: SpeciesId, coatName: string, accent: string, dark: string): Pick<Palette, "eye" | "nose"> {
  const own = id === "cat" ? CAT_FACES[coatName] : undefined;
  return { eye: COAT_EYES[coatName]?.iris ?? own?.iris ?? IRIS[id] ?? "#3a2a1e", nose: id === "cat" ? own?.nose ?? accent : dark };
}

/** Whether a species' horn is its claws, a darker thing than a deer's antler or a tortoise's nail. */
const clawed = (id: SpeciesId): boolean => {
  const b = SPECIES[id].build;
  return SPECIES[id].plan === "quad" && b.foot !== "hoof" && !b.extras.includes("shell");
};

export function paletteOf(id: SpeciesId, colors: CoatColors, morph: Morph, coatName = ""): Palette {
  const plain = morph === "normal" ? 0.32 : 0;
  const [coat, alt, belly, dark, accent] = colors.map((hex, i) =>
    i < 3 ? muted(hex, plain) : hex,
  ) as unknown as CoatColors;
  const base: Palette = { coat, alt, belly, dark, accent, ...faceColors(id, coatName, accent, dark), pupil: id === "raccoon" ? IRIS.raccoon ?? "#070505" : "#070505", shine: "#ffffff", glow: accent, horn: COAT_BEAKS[coatName] ?? BEAKS[id] ?? (clawed(id) ? "#5e5044" : "#cbb38c"), shell: COAT_SHELLS[coatName] ?? alt };
  const skin = skinOf(base, morph);
  // Neon is dark on purpose: its glow carries it.
  if (morph === "neon") return skin;
  const lift = blackLift(id, coatName);
  const lifted = {
    coat: charcoal(skin.coat, 0.25 * lift),
    alt: charcoal(skin.alt, 0.19 * lift),
    belly: charcoal(skin.belly, 0.34 * lift),
  };
  // (A spread train wears the shell, so a feather's paint stops at the feathers and never lands on the wings.)
  return { ...skin, ...lifted, ...(id === "peacock" ? { shell: lifted.alt } : {}) };
}

/**
 * How far a black coat is lifted toward charcoal: a bird's stays near black (sleek feathers, which
 * sdf-body's sheen and rim already pick out, where a wolf's fur needs lifting to read), and a black
 * cat's nearly all the way, the blackest thing about, its eyes bright in it.
 */
function blackLift(id: SpeciesId, coatName: string): number {
  if (SPECIES[id].plan === "bird") return 0.5;
  return id === "cat" && coatName === "black" ? 0.3 : 1;
}


/** Beak colours; the rest of a bird's look is its coat. */
const BEAKS: Partial<Record<SpeciesId, string>> = { macaque: "#5e4c3e", monkey: "#5a4a40", tortoise: "#cfc29c", sloth: "#a8a08c", songbird: "#3a2a1a", crow: "#1e1e24", owl: "#e8dcc4", parrot: "#2a2a2a", gull: "#f0c030", peacock: "#8a8a80", crane: "#c8c0a0", woodpecker: "#2a2a2a", kookaburra: "#2a2622", guineafowl: "#d8c8a0" };
/**
 * Beaks by coat where a coat has its own: a barn owl's warm ivory, a great horned owl's dark grey, a snowy owl's black.
 */
const COAT_BEAKS: Readonly<Record<string, string>> = { barn: "#e0cdbc", "great horned": "#3c3a3a", snowy: "#1c1c20" };
/**
 * A sixth colour where a coat needs one, painted as its shell (no bird has one): a great horned owl's buff breast,
 * between its white bib and its rufous face.
 */
const COAT_SHELLS: Readonly<Record<string, string>> = { "great horned": "#d4c6aa", leopard: "#bfb9a2", star: "#241c0e", snow: "#a2868c", vervet: "#1e1e1c" };
