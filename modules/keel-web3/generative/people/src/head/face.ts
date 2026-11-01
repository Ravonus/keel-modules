// The face: its features, the bone under them and the look painted on.

import { clamp, mix } from "../vec.js";
import { DARK_IRIS, IRIS_TONES, bell, pick, streamOf, weighted } from "../roll.js";
import type { Weighted } from "../roll.js";
import type { Age, Bone, Build, Face, FaceHair, Look, Sex } from "../body/person.js";
import { deepOf } from "../clothes/palette.js";

const FACE_HAIRS: readonly (readonly [FaceHair, number])[] = [["none", 6], ["stubble", 2], ["moustache", 0.6], ["beard", 1.6]];


/**
 * How grown a face is, and how young: everything that differs by sex goes by the first, so a boy's and a girl's are
 * one.
 */
const MATURITY: Readonly<Record<Age, number>> = { toddler: 0, child: 0, teen: 0.5, adult: 1, elder: 1 };
const YOUTH: Readonly<Record<Age, number>> = { toddler: 1, child: 0.72, teen: 0.2, adult: 0, elder: 0 };

/** How big a nose stands at each age, as a share of a grown one. */
const NOSE_BY: Readonly<Record<Age, number>> = { toddler: 0.68, child: 0.72, teen: 0.84, adult: 1, elder: 1 };
const CHILD_EYE: Partial<Record<Age, number>> = { toddler: 0.145, child: 0.14 };

const faceHairOf = (rand: () => number, age: Age, sex: Sex): FaceHair => (sex === "male" && (age === "adult" || age === "elder") ? weighted(rand, FACE_HAIRS) : "none");

/**
 * Each number in its place, for a seed's hair and clothes come on after these in the same stream: what is new about a
 * face has a stream of its own, in `faceFor`.
 */
export function faceOf(rand: () => number, age: Age, sex: Sex): Omit<Face, "bone" | "look"> {
  const m = MATURITY[age], soft = sex === "female" ? m : 0, old = age === "elder" ? 1 : 0, grown = m === 1 ? 1 : 0, roll = (): number => rand() * 2 - 1, eyeRoll = rand();
  return {
    eye: CHILD_EYE[age] ?? 0.115 + 0.02 * eyeRoll,
    apart: mix(0.335, 0.385, rand()),
    lid: mix(0.02, 0.1, rand()) * mix(0.6, 1, m) + old * 0.07,
    slant: mix(-0.04, 0.1, rand()),
    brow: mix(0.45, 1, rand()) * (1 - soft * 0.3),
    browTilt: mix(-0.06, 0.07, rand()) * mix(0.3, 1, m),
    nose: mix(0.17, 0.3, rand()) * NOSE_BY[age],
    noseWide: mix(0.16, 0.25, rand()) * mix(0.8, 1, m),
    lips: 1 + ((rand() - 0.5) * 0.3 + (2 * soft - 1) * 0.06) * grown,
    mouthWide: mix(0.235, 0.3, rand()) * mix(0.76, 1, m),
    jaw: roll(),
    chin: roll(),
    ears: mix(0.2, 0.3, rand()) + old * 0.03,
    wide: roll(),
    long: roll(),
    eyeRise: mix(-0.025, 0.025, rand()),
    iris: pick(rand, IRIS_TONES),
    hair: faceHairOf(rand, age, sex),
  };
}

type Pair = readonly [male: number, female: number];

/** A skull at each age: where two, a man's then a woman's. A child's two are the same. */
interface SkullStage { readonly zyg: number; readonly gon: Pair; readonly gonY: Pair; readonly gonZ: number; readonly chin: Pair; readonly men: Pair; readonly rise: Pair; readonly pupil: Pair; readonly sub: Pair; readonly sto: Pair }

const SKULL_STAGES: Readonly<Record<Age, SkullStage>> = {
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
interface Outline { readonly tem: number; readonly zyg: number; readonly mid: number; readonly gon: number; readonly gonY: number; readonly chin: number; readonly long: number; readonly plane: number }

const OUTLINES = {
  oval: { tem: 0, zyg: 0, mid: 0, gon: 0, gonY: 0, chin: 0, long: 0, plane: 0 },
  round: { tem: 0.02, zyg: 0.03, mid: 0.08, gon: 0.05, gonY: 0.06, chin: 0.04, long: -0.08, plane: -0.15 },
  square: { tem: 0.03, zyg: -0.01, mid: 0.07, gon: 0.11, gonY: -0.03, chin: 0.09, long: -0.04, plane: 0.45 },
  heart: { tem: 0.05, zyg: 0.02, mid: -0.05, gon: -0.09, gonY: 0.03, chin: -0.06, long: 0, plane: 0 },
  diamond: { tem: -0.07, zyg: 0.06, mid: -0.03, gon: -0.07, gonY: 0, chin: -0.05, long: 0.02, plane: 0.15 },
  oblong: { tem: -0.02, zyg: -0.06, mid: -0.03, gon: -0.03, gonY: -0.02, chin: 0, long: 0.09, plane: 0.2 },
  pear: { tem: -0.08, zyg: -0.03, mid: 0.06, gon: 0.09, gonY: 0.02, chin: 0.05, long: -0.03, plane: 0.1 },
} as const satisfies Readonly<Record<string, Outline>>;

type OutlineName = keyof typeof OUTLINES;

/**
 * Which outlines go with what: anyone can have any of them but a child, whose face is not yet any of the hard ones, and
 * is the same for a boy and a girl.
 */
const OUTLINE_SHARES: Readonly<Record<Sex | "young", Weighted<OutlineName>>> = {
  male: [["oval", 2], ["round", 1.4], ["square", 3], ["heart", 0.6], ["diamond", 1.6], ["oblong", 2], ["pear", 1.2]],
  female: [["oval", 3], ["round", 2], ["square", 0.8], ["heart", 2.6], ["diamond", 1.6], ["oblong", 1], ["pear", 0.6]],
  young: [["oval", 2], ["round", 3], ["heart", 1.4], ["pear", 0.6]],
};

/**
 * What can stand out in a face, and what it does: at most two to a person, none of them against another, and none on
 * anyone younger than `from`.
 */
export type Trait = "tip" | "lift" | "hump" | "alar" | "chinZ" | "chinW" | "full" | "hollow" | "mouth" | "eye" | "orbit" | "brow" | "ridge" | "len" | "wid" | "ears" | "lid";
export interface Signature { readonly kind: string; readonly from: number; readonly does: Readonly<Partial<Record<Trait, number>>> }

const SIGNATURES: readonly Signature[] = [
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

const AGE_ORDER: readonly Age[] = ["toddler", "child", "teen", "adult", "elder"];

/** Up to two of what a person is known by, never two of a kind, so nobody's nose is both big and snub. */
export function signaturesOf(r: () => number, age: Age): readonly Signature[] {
  const open = SIGNATURES.filter((s) => s.from <= AGE_ORDER.indexOf(age));
  const first = open[Math.floor(r() * open.length)], other = open.filter((s) => s.kind !== first?.kind), second = other[Math.floor(r() * other.length)], wanted = r();
  return [wanted < 0.8 ? first : undefined, wanted < 0.3 ? second : undefined].filter((s): s is Signature => s !== undefined);
}

/** What a person's signatures come to, trait by trait. */
function traitsOf(worn: readonly Signature[]): (t: Trait) => number {
  return (t) => worn.reduce((sum, s) => sum + (s.does[t] ?? 0), 0);
}

/** Round, square or sharp, as shares: one usually leads, whatever the sex, and the young lean round. */
function faceForm(r: () => number, youth: number): readonly [round: number, square: number, sharp: number] {
  const round = r() ** 2.2 + youth * 0.5, square = r() ** 2.2, sharp = r() ** 2.2, all = round + square + sharp;
  return [round / all, square / all, sharp / all];
}

/**
 * Three soft leanings, handed down and never named: each moves a little of the face, and any value is open to anyone.
 */
function kinOf(r: () => number, deep: number): readonly [number, number, number] {
  return [clamp(bell(r, -1, 1) + 0.5 * (deep - 0.5), -1, 1), bell(r, -1, 1), bell(r, -1, 1)];
}

/** What a face leans to before it is anything: its form, its kin, its signature. */
interface Latents { readonly round: number; readonly square: number; readonly sharp: number; readonly kin: readonly [number, number, number]; readonly by: (t: Trait) => number }

function latentsOf(r: () => number, age: Age, deep: number): Latents {
  const [round, square, sharp] = faceForm(r, YOUTH[age]), kin = kinOf(r, deep);
  return { round, square, sharp, kin, by: traitsOf(signaturesOf(r, age)) };
}

/** How far into their years a grown person is, a little of what age does: most of them hardly any. */
const grownYears = (age: Age, roll: number): number => (age === "adult" ? roll * roll * 0.5 : 0);

/** What a face is built on: the age's skull, bent by the form it leans to, its kin and its signature. */
function boneOf(r: () => number, face: Omit<Face, "bone" | "look">, build: Build, { round, sharp, kin, by }: Latents): Bone {
  const { age, sex, girth } = build, st = SKULL_STAGES[age], of = (pair: Pair): number => pair[sex === "male" ? 0 : 1];
  const m = MATURITY[age], vary = 0.5 + 0.5 * m, fat = Math.max(0, girth - 1), old = age === "elder" ? 1 : 0;
  const form = OUTLINES[weighted(r, OUTLINE_SHARES[m === 0 ? "young" : sex])], reach = mix(0.45, 1, m) * mix(0.8, 1.2, r());
  const soft = (sex === "female" ? 1 : 0) * m, drop = (r() - 0.5) * 0.1 * m, chinLong = (r() - 0.5) * 0.1 * m, browUp = (r() - 0.5) * 0.07 * m + mix(-0.01, 0.03, soft);
  const lean = 0.45 * face.jaw * vary, chinY = 0.5 * face.chin * vary, depth = r() * 2 - 1;
  const W = clamp(1 + (round * 1.4 - sharp * 1.1 + kin[1] * 0.7 + face.wide * 0.7) * vary * 0.06 + by("wid"), 0.9, 1.14);
  const L = clamp(1 + (0.5 * (sharp - round) + kin[0] * 0.3 * m + kin[2] * 0.3 + face.long * 0.5) * vary * 0.07 + form.long * reach + by("len"), 0.88, 1.13);
  const bulk = clamp(1 - (girth - 0.78) / 0.36, 0, 1) * m, full = clamp(0.6 * round + by("full") + fat + 0.7 * YOUTH[age], 0, 1);
  const cheek = mix(0.05, 0.11, r()) * mix(0.35, 1, m) * mix(1, 1.1, soft), cheekY = mix(-0.12, 0.02, r());
  const ridge = mix(mix(0.06, 0.11, r()), 0.02, soft) * m + by("ridge");
  const hollow = (bulk * mix(0.015, 0.05, r()) + by("hollow") * 0.04 + sharp * 0.02) * m * (fat > 0 ? 0 : 1);
  const zyg = st.zyg + form.zyg * reach + (r() - 0.5) * 0.04 * m, gon = clamp(of(st.gon) + form.gon * reach + lean * 0.09 + fat * 0.09, 0.5, zyg - 0.07);
  const mid = clamp(mix(zyg, gon, 0.46) + form.mid * reach + full * 0.05 + fat * 0.06 - hollow * 0.8, gon + 0.02, zyg - 0.02);
  return {
    m, W, L, D: 1 + depth * 0.045, fat, lean: bulk, old: age === "elder" ? 1 : grownYears(age, r()), rise: of(st.rise),
    pupil: of(st.pupil) + face.eyeRise * 2, sub: of(st.sub) + (r() - 0.5) * 0.07 * m, sto: of(st.sto), tem: 0.73 + form.tem * reach, zyg, mid, plane: 2.25 + form.plane * reach,
    gon, gonY: of(st.gonY) + form.gonY * reach - lean * 0.04 * m - fat * 0.02 + drop, gonZ: st.gonZ,
    chin: clamp(of(st.chin) + form.chin * reach + (lean + chinY) * 0.04 + fat * 0.03 + by("chinW"), 0.25, 0.42), men: of(st.men) - chinLong,
    pogZ: mix(0.94, 1.03, m) - 0.03 * soft + chinY * 0.035 * m + by("chinZ") * m - old * 0.03,
    cheek, cheekY, ridge, hollow, full,
    tipY: 0.1 + by("lift") - old * 0.03 + (kin[2] * 0.02 + (r() - 0.5) * 0.06) * m, hump: by("hump") + (r() - 0.5) * 0.04 * m, askew: (r() - 0.5) * 0.015 * m,
    orbit: by("orbit"), browK: 1 + by("brow"), arch: mix(0.005, 0.06, r()), browUp,
    ...restOf(r, m),
  };
}

/** How a mouth lies at rest, and the marks on a skin. */
function restOf(r: () => number, m: number): Pick<Bone, "rest" | "freckles" | "mole"> {
  const rare = r() < 0.08, rest = rare ? mix(-0.15, -0.05, r()) : bell(r, -0.05, 0.45), marks = r(), mole = r();
  return { rest: m < 0.5 ? Math.max(0.15, rest) : rest, freckles: marks < 0.14 ? 1 : 0, mole: mole < 0.16 && m > 0 ? mole / 0.16 : 0 };
}

const LIPSTICK_FAIR = ["#b24a5c", "#a23838", "#c26478", "#8a2e40", "#b86a5e"] as const;
const LIPSTICK_DEEP = ["#7a2a3a", "#8c3244", "#5c2030", "#a24a3c", "#6c3a48"] as const;
const SHADOW = ["#7c5a48", "#8a6870", "#5e4a60", "#6c5c3e", "#4c4a5c"] as const;

/** A made-up face: a lip and a little colour; a bold or a day's face has a lid dusted too. */
function madeUp(how: number, lip: number, lid: number, deep: number): Pick<Look, "lip" | "shadow" | "blush" | "liner"> {
  const bold = how > 0.82, day = how > 0.42;
  return {
    lip: pick(() => lip, deep > 0.3 ? LIPSTICK_DEEP : LIPSTICK_FAIR),
    blush: [deep > 0.3 ? "#a04a3a" : "#dc7c70", mix(bold ? 0.2 : 0.13, 0.2, deep)],
    liner: bold ? 1 : day ? 0.55 : 0.35,
    ...(day ? { shadow: [pick(() => lid, SHADOW), bold ? 0.55 : 0.36] as const } : {}),
  };
}

/**
 * Paint, and how much: most grown women, a little or a lot, and now and then a man with a line round his eyes. Only
 * grown people; never a child or a teen.
 */
function paintOf(r: () => number, build: Build, deep: number): Pick<Look, "lip" | "shadow" | "blush" | "liner"> {
  const roll = r(), how = r(), lip = r(), lid = r(), old = build.age === "elder";
  if (build.age !== "adult" && !old) return { liner: 0 };
  if (build.sex !== "female") return { liner: roll < 0.05 ? 0.5 : 0 };
  return roll > (old ? 0.5 : 0.76) ? { liner: 0.15 } : madeUp(how, lip, lid, deep);
}

/** What a skin has come by: freckles at any age; a spot or two, tired eyes and moles only once it has grown up some. */
function marksOn(r: () => number, bone: Bone, young: boolean, deep: number): Pick<Look, "freckles" | "spots" | "tired" | "moles"> {
  const spotted = r(), spots = r(), tired = r(), second = r(), x = r(), y = r(), side = r() < 0.5 ? -1 : 1;
  const mole = (at: number, h: number): readonly [number, number, number] => [side * at, h, 0.02 + bone.mole * 0.012];
  return {
    freckles: bone.freckles * mix(0.85, 0.5, deep),
    spots: bone.m === 0 ? 0 : spotted < (young ? 0.45 : 0.14) ? mix(0.4, 0.8, spots) : 0,
    tired: bone.m === 0 ? 0 : tired * tired * 0.7 + bone.old * 0.4,
    moles: bone.mole ? [mole(mix(0.22, 0.56, x), mix(-0.8, -0.2, y)), ...(second < 0.2 ? [mole(-mix(0.1, 0.4, y), mix(-1, -0.5, x))] : [])] : [],
  };
}

/**
 * A face finished: all that is new about it comes from one stream of its own, after the skin is known, so a seed's hair
 * and clothes stay as they were.
 */
export function faceFor(seed: number, rolled: Omit<Face, "bone" | "look">, build: Build, skin: string): Face {
  const r = streamOf(seed, 0x66616365), deep = deepOf(skin), m = MATURITY[build.age], latents = latentsOf(r, build.age, deep), { kin, by } = latents;
  const bone = boneOf(r, rolled, build, latents);
  const pale = IRIS_TONES.indexOf(rolled.iris as typeof IRIS_TONES[number]) >= 3 && r() < 0.1 + 0.85 * deep;
  const open = 1 + ((r() - 0.5) * 0.36 + (build.sex === "female" ? 0.07 : -0.03) - bone.old * 0.1) * m, set = (r() - 0.5) * 0.08 * m;
  return {
    ...rolled, bone,
    eye: clamp(rolled.eye * 1.03 * (1 + by("eye")) * open, 0.108, 0.155),
    apart: rolled.apart + set + 0.02,
    lid: rolled.lid + by("lid"),
    nose: clamp(rolled.nose + by("tip"), 0.09, 0.36),
    noseWide: clamp(rolled.noseWide + 0.03 * kin[0] * m + 0.012 * kin[1] + by("alar"), 0.13, 0.27),
    mouthWide: clamp((rolled.mouthWide + (-0.02 * kin[1] + 0.01 * kin[0] + by("mouth")) * m) * 1.1, 0.2, 0.37),
    lips: m === 0 ? 1 : Math.min(clamp(rolled.lips + 0.14 * kin[0] * m, 0.72, 1.3), build.age === "teen" ? 1 : 1.3),
    ears: rolled.ears * (1 + by("ears")),
    iris: pale ? pick(r, DARK_IRIS) : rolled.iris,
    look: lookOf(seed, build, deep, bone),
  };
}

function lookOf(seed: number, build: Build, deep: number, bone: Bone): Look {
  const r = streamOf(seed, 0x6c6f6f6b);
  const blood = r();
  return { blush: [deep > 0.3 ? "#a04a3a" : "#dc7c70", mix(0.04, 0.1, blood) * (bone.m === 0 ? 1.3 : 1)], ...paintOf(r, build, deep), ...marksOn(r, bone, build.age === "teen", deep), ...wearOf(r, bone, build.age === "teen") };
}

/** What years and luck have left on a skin. A child's is only a little uneven. */
function wearOf(r: () => number, bone: Bone, young: boolean): Pick<Look, "lines" | "rough" | "scars" | "uneven"> {
  const laugh = r(), rough = r(), scarred = r(), uneven = r();
  if (bone.m === 0) return { lines: 0, rough: 0, scars: 0, uneven: 0.25 };
  return { lines: young ? 0 : clamp(0.03 + laugh * laugh * 0.2 + bone.old * 0.75, 0, 1), rough: rough * rough * (young ? 0.8 : 0.6), scars: scarred < (young ? 0.35 : 0.22) ? mix(0.3, 0.8, rough) : 0, uneven: mix(0.35, 0.9, uneven) };
}
