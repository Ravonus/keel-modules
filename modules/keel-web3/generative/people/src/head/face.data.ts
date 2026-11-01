// The face's tables: what each age's skull is, the outlines a face leans to, its signatures and its paint.

import type { Weighted } from "../roll.js";
import type { Age, FaceHair, Sex } from "../body/person.js";

export const FACE_HAIRS: readonly (readonly [FaceHair, number])[] = [["none", 6], ["stubble", 2], ["moustache", 0.6], ["beard", 1.6]];

/**
 * How grown a face is, and how young: everything that differs by sex goes by the first, so a boy's and a girl's are
 * one.
 */
export const MATURITY: Readonly<Record<Age, number>> = { toddler: 0, child: 0, teen: 0.5, adult: 1, elder: 1 };
export const YOUTH: Readonly<Record<Age, number>> = { toddler: 1, child: 0.72, teen: 0.2, adult: 0, elder: 0 };

/** How big a nose stands at each age, as a share of a grown one. */
export const NOSE_BY: Readonly<Record<Age, number>> = { toddler: 0.68, child: 0.72, teen: 0.84, adult: 1, elder: 1 };
export const CHILD_EYE: Partial<Record<Age, number>> = { toddler: 0.145, child: 0.14 };

export type Pair = readonly [male: number, female: number];

/** A skull at each age: where two, a man's then a woman's. A child's two are the same. */
export interface SkullStage {
  readonly zyg: number;
  readonly gon: Pair;
  readonly gonY: Pair;
  readonly gonZ: number;
  readonly chin: Pair;
  readonly men: Pair;
  readonly rise: Pair;
  readonly pupil: Pair;
  readonly sub: Pair;
  readonly sto: Pair;
}

export const SKULL_STAGES: Readonly<Record<Age, SkullStage>> = {
  toddler: { zyg: 0.78, gon: [0.56, 0.56], gonY: [-0.46, -0.46], gonZ: 0.06, chin: [0.3, 0.3], men: [-0.76, -0.76], rise: [1, 1], pupil: [-0.04, -0.04], sub: [-0.3, -0.3], sto: [-0.46, -0.46] },
  child: { zyg: 0.76, gon: [0.54, 0.54], gonY: [-0.5, -0.5], gonZ: 0.04, chin: [0.27, 0.27], men: [-0.82, -0.82], rise: [1.11, 1.11], pupil: [0.01, 0.01], sub: [-0.31, -0.31], sto: [-0.49, -0.49] },
  teen: { zyg: 0.75, gon: [0.57, 0.53], gonY: [-0.6, -0.56], gonZ: 0, chin: [0.28, 0.25], men: [-0.96, -0.9], rise: [1.31, 1.29], pupil: [0.12, 0.12], sub: [-0.35, -0.33], sto: [-0.55, -0.52] },
  adult: { zyg: 0.78, gon: [0.62, 0.55], gonY: [-0.68, -0.58], gonZ: -0.01, chin: [0.31, 0.27], men: [-1.02, -0.93], rise: [1.36, 1.34], pupil: [0.14, 0.15], sub: [-0.39, -0.33], sto: [-0.6, -0.52] },
  elder: { zyg: 0.76, gon: [0.61, 0.53], gonY: [-0.7, -0.58], gonZ: -0.01, chin: [0.3, 0.25], men: [-1.03, -0.95], rise: [1.36, 1.34], pupil: [0.13, 0.14], sub: [-0.4, -0.35], sto: [-0.62, -0.55] },
};

/**
 * What a face's outline leans to, on the age's skull: shares of a head's radius from the temple down, how much longer
 * it runs, how square it is across.
 */
export interface Outline {
  readonly tem: number;
  readonly zyg: number;
  readonly mid: number;
  readonly gon: number;
  readonly gonY: number;
  readonly chin: number;
  readonly long: number;
  readonly plane: number;
}

export const OUTLINES = {
  oval: { tem: 0, zyg: 0, mid: 0, gon: 0, gonY: 0, chin: 0, long: 0, plane: 0 },
  round: { tem: 0.02, zyg: 0.03, mid: 0.08, gon: 0.05, gonY: 0.06, chin: 0.04, long: -0.08, plane: -0.15 },
  square: { tem: 0.03, zyg: -0.01, mid: 0.07, gon: 0.11, gonY: -0.03, chin: 0.09, long: -0.04, plane: 0.45 },
  heart: { tem: 0.05, zyg: 0.02, mid: -0.05, gon: -0.09, gonY: 0.03, chin: -0.06, long: 0, plane: 0 },
  diamond: { tem: -0.07, zyg: 0.06, mid: -0.03, gon: -0.07, gonY: 0, chin: -0.05, long: 0.02, plane: 0.15 },
  oblong: { tem: -0.02, zyg: -0.06, mid: -0.03, gon: -0.03, gonY: -0.02, chin: 0, long: 0.09, plane: 0.2 },
  pear: { tem: -0.08, zyg: -0.03, mid: 0.06, gon: 0.09, gonY: 0.02, chin: 0.05, long: -0.03, plane: 0.1 },
} as const satisfies Readonly<Record<string, Outline>>;

export type OutlineName = keyof typeof OUTLINES;

/**
 * Which outlines go with what: anyone can have any of them but a child, whose face is not yet any of the hard ones, and
 * is the same for a boy and a girl.
 */
export const OUTLINE_SHARES: Readonly<Record<Sex | "young", Weighted<OutlineName>>> = {
  male: [["oval", 2], ["round", 1.4], ["square", 3], ["heart", 0.6], ["diamond", 1.6], ["oblong", 2], ["pear", 1.2]],
  female: [["oval", 3], ["round", 2], ["square", 0.8], ["heart", 2.6], ["diamond", 1.6], ["oblong", 1], ["pear", 0.6]],
  young: [["oval", 2], ["round", 3], ["heart", 1.4], ["pear", 0.6]],
};

/**
 * What can stand out in a face, and what it does: at most two to a person, none of them against another, and none on
 * anyone younger than `from`.
 */
export type Trait =
  | "tip"
  | "lift"
  | "hump"
  | "alar"
  | "chinZ"
  | "chinW"
  | "full"
  | "hollow"
  | "mouth"
  | "eye"
  | "orbit"
  | "brow"
  | "ridge"
  | "len"
  | "wid"
  | "ears"
  | "lid";
export interface Signature {
  readonly kind: string;
  readonly from: number;
  readonly does: Readonly<Partial<Record<Trait, number>>>;
}

export const SIGNATURES: readonly Signature[] = [
  { kind: "nose", from: 3, does: { tip: 0.07, alar: 0.03 } },
  { kind: "nose", from: 3, does: { hump: 0.05, lift: -0.04 } },
  { kind: "nose", from: 0, does: { tip: -0.06, lift: 0.04 } },
  { kind: "chin", from: 3, does: { chinZ: 0.06, chinW: 0.07 } },
  { kind: "chin", from: 3, does: { chinZ: -0.07, chinW: -0.03 } },
  { kind: "cheek", from: 0, does: { full: 0.8 } },
  { kind: "cheek", from: 3, does: { hollow: 0.7 } },
  { kind: "mouth", from: 2, does: { mouth: 0.04 } },
  { kind: "eye", from: 0, does: { eye: 0.14 } },
  { kind: "eye", from: 3, does: { eye: -0.1, orbit: 0.03 } },
  { kind: "eye", from: 3, does: { lid: 0.16 } },
  { kind: "brow", from: 3, does: { brow: 0.3, ridge: 0.04 } },
  { kind: "shape", from: 2, does: { len: 0.07, wid: -0.05 } },
  { kind: "shape", from: 0, does: { wid: 0.08, len: -0.05 } },
  { kind: "ears", from: 0, does: { ears: 0.25 } },
];

export const AGE_ORDER: readonly Age[] = ["toddler", "child", "teen", "adult", "elder"];

export const LIPSTICK_FAIR = ["#b24a5c", "#a23838", "#c26478", "#8a2e40", "#b86a5e"] as const;
export const LIPSTICK_DEEP = ["#7a2a3a", "#8c3244", "#5c2030", "#a24a3c", "#6c3a48"] as const;
export const SHADOW = ["#7c5a48", "#8a6870", "#5e4a60", "#6c5c3e", "#4c4a5c"] as const;
