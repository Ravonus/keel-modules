// The face: its features, the bone under them and the look painted on.

import { clamp, mix } from "../vec.js";
import { DARK_IRIS, IRIS_TONES, bell, pick, streamOf, weighted } from "../roll.js";
import type { Age, Bone, Build, Face, FaceHair, Look, Sex } from "../body/person.js";
import { deepOf } from "../clothes/palette.js";
import {
  AGE_ORDER,
  CHILD_EYE,
  FACE_HAIRS,
  LIPSTICK_DEEP,
  LIPSTICK_FAIR,
  MATURITY,
  NOSE_BY,
  OUTLINES,
  OUTLINE_SHARES,
  SHADOW,
  SIGNATURES,
  SKULL_STAGES,
  YOUTH,
} from "./face.data.js";
import type { Outline, Pair, Signature, SkullStage, Trait } from "./face.data.js";

export type { Signature, Trait } from "./face.data.js";

/** A face as it is rolled, before the bone under it and the look on it are known. */
type Rolled = Omit<Face, "bone" | "look">;

const faceHairOf = (rand: () => number, age: Age, sex: Sex): FaceHair =>
  sex === "male" && (age === "adult" || age === "elder") ? weighted(rand, FACE_HAIRS) : "none";

/**
 * Each number in its place, for a seed's hair and clothes come on after these in the same stream: what is new about a
 * face has a stream of its own, in `faceFor`.
 */
export function faceOf(rand: () => number, age: Age, sex: Sex): Rolled {
  const m = MATURITY[age];
  const soft = sex === "female" ? m : 0;
  const old = age === "elder" ? 1 : 0;
  const grown = m === 1 ? 1 : 0;
  const roll = (): number => rand() * 2 - 1;
  const eyeRoll = rand();
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

/** Up to two of what a person is known by, never two of a kind, so nobody's nose is both big and snub. */
export function signaturesOf(r: () => number, age: Age): readonly Signature[] {
  const open = SIGNATURES.filter((s) => s.from <= AGE_ORDER.indexOf(age));
  const first = open[Math.floor(r() * open.length)];
  const other = open.filter((s) => s.kind !== first?.kind);
  const second = other[Math.floor(r() * other.length)];
  const wanted = r();
  const worn = [wanted < 0.8 ? first : undefined, wanted < 0.3 ? second : undefined];
  return worn.filter((s): s is Signature => s !== undefined);
}

/** What a person's signatures come to, trait by trait. */
function traitsOf(worn: readonly Signature[]): (t: Trait) => number {
  return (t) => worn.reduce((sum, s) => sum + (s.does[t] ?? 0), 0);
}

/** Round, square or sharp, as shares: one usually leads, whatever the sex, and the young lean round. */
function faceForm(r: () => number, youth: number): readonly [round: number, square: number, sharp: number] {
  const round = r() ** 2.2 + youth * 0.5;
  const square = r() ** 2.2;
  const sharp = r() ** 2.2;
  const all = round + square + sharp;
  return [round / all, square / all, sharp / all];
}

/**
 * Three soft leanings, handed down and never named: each moves a little of the face, and any value is open to anyone.
 */
function kinOf(r: () => number, deep: number): readonly [number, number, number] {
  return [clamp(bell(r, -1, 1) + 0.5 * (deep - 0.5), -1, 1), bell(r, -1, 1), bell(r, -1, 1)];
}

/** What a face leans to before it is anything: its form, its kin, its signature. */
interface Latents {
  readonly round: number;
  readonly square: number;
  readonly sharp: number;
  readonly kin: readonly [number, number, number];
  readonly by: (t: Trait) => number;
}

function latentsOf(r: () => number, age: Age, deep: number): Latents {
  const [round, square, sharp] = faceForm(r, YOUTH[age]);
  const kin = kinOf(r, deep);
  return { round, square, sharp, kin, by: traitsOf(signaturesOf(r, age)) };
}

/** How far into their years a grown person is, a little of what age does: most of them hardly any. */
const grownYears = (age: Age, roll: number): number => (age === "adult" ? roll * roll * 0.5 : 0);

/** What a skull is bent from: the rolled face and build, what it leans to, the age's stage and how grown it is. */
interface Skull {
  readonly r: () => number;
  readonly face: Rolled;
  readonly build: Build;
  readonly lat: Latents;
  readonly st: SkullStage;
  /** A man's or a woman's of a pair. */
  readonly of: (pair: Pair) => number;
  readonly m: number;
  /** How far a face has come into its own: a child's hardly varies yet. */
  readonly vary: number;
  readonly fat: number;
}

/** The outline a face leans to and how far it goes that way, with the small turns of its jaw, chin and brow. */
interface Frame {
  readonly form: Outline;
  readonly reach: number;
  readonly soft: number;
  readonly drop: number;
  readonly chinLong: number;
  readonly browUp: number;
  readonly depth: number;
}

function frameOf({ r, build, m }: Skull): Frame {
  const { sex } = build;
  const form = OUTLINES[weighted(r, OUTLINE_SHARES[m === 0 ? "young" : sex])];
  const reach = mix(0.45, 1, m) * mix(0.8, 1.2, r());
  const soft = (sex === "female" ? 1 : 0) * m;
  const drop = (r() - 0.5) * 0.1 * m;
  const chinLong = (r() - 0.5) * 0.1 * m;
  const browUp = (r() - 0.5) * 0.07 * m + mix(-0.01, 0.03, soft);
  const depth = r() * 2 - 1;
  return { form, reach, soft, drop, chinLong, browUp, depth };
}

/** How wide and long a face is, how lean, and how full its cheeks. */
interface Widths {
  readonly W: number;
  readonly L: number;
  readonly bulk: number;
  readonly full: number;
}

function widthsOf({ face, build, lat, m, vary, fat }: Skull, { form, reach }: Frame): Widths {
  const { round, sharp, kin, by } = lat;
  const { age, girth } = build;
  const W = clamp(1 + (round * 1.4 - sharp * 1.1 + kin[1] * 0.7 + face.wide * 0.7) * vary * 0.06 + by("wid"), 0.9, 1.14);
  const stretch = (0.5 * (sharp - round) + kin[0] * 0.3 * m + kin[2] * 0.3 + face.long * 0.5) * vary * 0.07;
  const L = clamp(1 + stretch + form.long * reach + by("len"), 0.88, 1.13);
  const bulk = clamp(1 - (girth - 0.78) / 0.36, 0, 1) * m;
  const full = clamp(0.6 * round + by("full") + fat + 0.7 * YOUTH[age], 0, 1);
  return { W, L, bulk, full };
}

/** The cheeks: how far out and how high, the brow's ridge, and how hollow under the bone. */
interface Cheeks {
  readonly cheek: number;
  readonly cheekY: number;
  readonly ridge: number;
  readonly hollow: number;
}

function cheeksOf({ r, lat, m, fat }: Skull, soft: number, bulk: number): Cheeks {
  const { sharp, by } = lat;
  const cheek = mix(0.05, 0.11, r()) * mix(0.35, 1, m) * mix(1, 1.1, soft);
  const cheekY = mix(-0.12, 0.02, r());
  const ridge = mix(mix(0.06, 0.11, r()), 0.02, soft) * m + by("ridge");
  const hollow = (bulk * mix(0.015, 0.05, r()) + by("hollow") * 0.04 + sharp * 0.02) * m * (fat > 0 ? 0 : 1);
  return { cheek, cheekY, ridge, hollow };
}

/** The jaw's three breadths: at the cheekbone, below it, and at its corner. */
interface Jaw {
  readonly zyg: number;
  readonly gon: number;
  readonly mid: number;
}

/** What flesh the jaw's breadths carry: how full the cheeks, and how hollow. */
interface Flesh {
  readonly full: number;
  readonly hollow: number;
}

function jawOf({ r, st, of, m, fat }: Skull, { form, reach }: Frame, lean: number, { full, hollow }: Flesh): Jaw {
  const zyg = st.zyg + form.zyg * reach + (r() - 0.5) * 0.04 * m;
  const gon = clamp(of(st.gon) + form.gon * reach + lean * 0.09 + fat * 0.09, 0.5, zyg - 0.07);
  const between = mix(zyg, gon, 0.46) + form.mid * reach + full * 0.05 + fat * 0.06 - hollow * 0.8;
  const mid = clamp(between, gon + 0.02, zyg - 0.02);
  return { zyg, gon, mid };
}

/** What a face is built on: the age's skull, bent by the form it leans to, its kin and its signature. */
function boneOf(r: () => number, face: Rolled, build: Build, lat: Latents): Bone {
  const { age, sex, girth } = build;
  const { kin, by } = lat;
  const m = MATURITY[age];
  const of = (pair: Pair): number => pair[sex === "male" ? 0 : 1];
  const st = SKULL_STAGES[age];
  const s: Skull = { r, face, build, lat, st, of, m, vary: 0.5 + 0.5 * m, fat: Math.max(0, girth - 1) };
  const { vary, fat } = s;
  const old = age === "elder" ? 1 : 0;
  const frame = frameOf(s);
  const { form, reach, soft, drop, chinLong, browUp, depth } = frame;
  const lean = 0.45 * face.jaw * vary;
  const chinY = 0.5 * face.chin * vary;
  const { W, L, bulk, full } = widthsOf(s, frame);
  const cheeks = cheeksOf(s, soft, bulk);
  const { zyg, gon, mid } = jawOf(s, frame, lean, { full, hollow: cheeks.hollow });
  return {
    m,
    W,
    L,
    D: 1 + depth * 0.045,
    fat,
    lean: bulk,
    old: age === "elder" ? 1 : grownYears(age, r()),
    rise: of(st.rise),
    pupil: of(st.pupil) + face.eyeRise * 2,
    sub: of(st.sub) + (r() - 0.5) * 0.07 * m,
    sto: of(st.sto),
    tem: 0.73 + form.tem * reach,
    zyg,
    mid,
    plane: 2.25 + form.plane * reach,
    gon,
    gonY: of(st.gonY) + form.gonY * reach - lean * 0.04 * m - fat * 0.02 + drop,
    gonZ: st.gonZ,
    chin: clamp(of(st.chin) + form.chin * reach + (lean + chinY) * 0.04 + fat * 0.03 + by("chinW"), 0.25, 0.42),
    men: of(st.men) - chinLong,
    pogZ: mix(0.94, 1.03, m) - 0.03 * soft + chinY * 0.035 * m + by("chinZ") * m - old * 0.03,
    ...cheeks,
    full,
    tipY: 0.1 + by("lift") - old * 0.03 + (kin[2] * 0.02 + (r() - 0.5) * 0.06) * m,
    hump: by("hump") + (r() - 0.5) * 0.04 * m,
    askew: (r() - 0.5) * 0.015 * m,
    orbit: by("orbit"),
    browK: 1 + by("brow"),
    arch: mix(0.005, 0.06, r()),
    browUp,
    ...restOf(r, m),
  };
}

/** How a mouth lies at rest, and the marks on a skin. */
function restOf(r: () => number, m: number): Pick<Bone, "rest" | "freckles" | "mole"> {
  const rare = r() < 0.08;
  const rest = rare ? mix(-0.15, -0.05, r()) : bell(r, -0.05, 0.45);
  const marks = r();
  const mole = r();
  return {
    rest: m < 0.5 ? Math.max(0.15, rest) : rest,
    freckles: marks < 0.14 ? 1 : 0,
    mole: mole < 0.16 && m > 0 ? mole / 0.16 : 0,
  };
}

/** How dark a line round the eyes: heavy on a bold face, less by day, least on a bare one. */
function linerOf(bold: boolean, day: boolean): number {
  if (bold) return 1;
  return day ? 0.55 : 0.35;
}

/** A made-up face: a lip and a little colour; a bold or a day's face has a lid dusted too. */
function madeUp(how: number, lip: number, lid: number, deep: number): Pick<Look, "lip" | "shadow" | "blush" | "liner"> {
  const bold = how > 0.82;
  const day = how > 0.42;
  return {
    lip: pick(() => lip, deep > 0.3 ? LIPSTICK_DEEP : LIPSTICK_FAIR),
    blush: [deep > 0.3 ? "#a04a3a" : "#dc7c70", mix(bold ? 0.2 : 0.13, 0.2, deep)],
    liner: linerOf(bold, day),
    ...(day ? { shadow: [pick(() => lid, SHADOW), bold ? 0.55 : 0.36] as const } : {}),
  };
}

/**
 * Paint, and how much: most grown women, a little or a lot, and now and then a man with a line round his eyes. Only
 * grown people; never a child or a teen.
 */
function paintOf(r: () => number, build: Build, deep: number): Pick<Look, "lip" | "shadow" | "blush" | "liner"> {
  const roll = r();
  const how = r();
  const lip = r();
  const lid = r();
  const old = build.age === "elder";
  if (build.age !== "adult" && !old) return { liner: 0 };
  if (build.sex !== "female") return { liner: roll < 0.05 ? 0.5 : 0 };
  return roll > (old ? 0.5 : 0.76) ? { liner: 0.15 } : madeUp(how, lip, lid, deep);
}

/** A spot or two, on a face grown enough to have them: the young more often. */
function spotsOf(m: number, young: boolean, [spotted, spots]: readonly [number, number]): number {
  if (m === 0) return 0;
  return spotted < (young ? 0.45 : 0.14) ? mix(0.4, 0.8, spots) : 0;
}

/** What a skin has come by: freckles at any age; a spot or two, tired eyes and moles only once it has grown up some. */
function marksOn(r: () => number, bone: Bone, young: boolean, deep: number): Pick<Look, "freckles" | "spots" | "tired" | "moles"> {
  const spotted = r();
  const spots = r();
  const tired = r();
  const second = r();
  const x = r();
  const y = r();
  const side = r() < 0.5 ? -1 : 1;
  const mole = (at: number, h: number): readonly [number, number, number] => [side * at, h, 0.02 + bone.mole * 0.012];
  const another = second < 0.2 ? [mole(-mix(0.1, 0.4, y), mix(-1, -0.5, x))] : [];
  return {
    freckles: bone.freckles * mix(0.85, 0.5, deep),
    spots: spotsOf(bone.m, young, [spotted, spots]),
    tired: bone.m === 0 ? 0 : tired * tired * 0.7 + bone.old * 0.4,
    moles: bone.mole ? [mole(mix(0.22, 0.56, x), mix(-0.8, -0.2, y)), ...another] : [],
  };
}

/**
 * A face finished: all that is new about it comes from one stream of its own, after the skin is known, so a seed's hair
 * and clothes stay as they were.
 */
export function faceFor(seed: number, rolled: Rolled, build: Build, skin: string): Face {
  const r = streamOf(seed, 0x66616365);
  const deep = deepOf(skin);
  const m = MATURITY[build.age];
  const latents = latentsOf(r, build.age, deep);
  const { kin, by } = latents;
  const bone = boneOf(r, rolled, build, latents);
  const pale = IRIS_TONES.indexOf(rolled.iris as (typeof IRIS_TONES)[number]) >= 3 && r() < 0.1 + 0.85 * deep;
  const open = 1 + ((r() - 0.5) * 0.36 + (build.sex === "female" ? 0.07 : -0.03) - bone.old * 0.1) * m;
  const set = (r() - 0.5) * 0.08 * m;
  return {
    ...rolled,
    bone,
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
  const young = build.age === "teen";
  return {
    blush: [deep > 0.3 ? "#a04a3a" : "#dc7c70", mix(0.04, 0.1, blood) * (bone.m === 0 ? 1.3 : 1)],
    ...paintOf(r, build, deep),
    ...marksOn(r, bone, young, deep),
    ...wearOf(r, bone, young),
  };
}

/** What years and luck have left on a skin. A child's is only a little uneven. */
function wearOf(r: () => number, bone: Bone, young: boolean): Pick<Look, "lines" | "rough" | "scars" | "uneven"> {
  const laugh = r();
  const rough = r();
  const scarred = r();
  const uneven = r();
  if (bone.m === 0) return { lines: 0, rough: 0, scars: 0, uneven: 0.25 };
  return {
    lines: young ? 0 : clamp(0.03 + laugh * laugh * 0.2 + bone.old * 0.75, 0, 1),
    rough: rough * rough * (young ? 0.8 : 0.6),
    scars: scarred < (young ? 0.35 : 0.22) ? mix(0.3, 0.8, rough) : 0,
    uneven: mix(0.35, 0.9, uneven),
  };
}
