// Bodies: one animal posed as capsules, with its grain, pattern, eyes and palette, and the gallery's standing poses.

import { UP, add, dirOf, frameOf, lerpV, madd, mix, scale, sub, toWorld, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom, streamOf } from "../roll.js";
import { ALL_REGIONS } from "../roster.js";
import type { Action, Palette, Plan, Role, SpeciesId, SpeciesSpec } from "../roster.js";
import { perchOf } from "../stage/stage.js";
import type { Anchor, Place } from "../stage/stage.js";
import { PACE } from "../stage/director.js";
import type { Actor, MoveMode, Scene, Segment } from "../stage/director.js";
import { FADE, paramsOf } from "../stage/moments.js";
import type { Capsule, Moment, Pose } from "../stage/moments.js";
import { buildOf, ownPhase } from "./kit.js";
import type { Kit } from "./kit.js";
import { quadSpine, shoulderOf } from "./quad.js";
import { domeOf, mantleLine, poseQuad, shellHeart } from "./quad-trunk.js";
import { macaqueKind, macaquePelt, monkeyPelt, posePrimate, slothCrown } from "./primates.js";
import { STANCES, poseBird } from "./birds.js";
import { poseSerpent } from "./serpents.js";
import { poseBug, poseCrab } from "./bugs.js";
import { EYE, MORPHS, eyeOfSpecies, mixColor } from "./coats.js";
import type { EyeStyle, Morph } from "./coats.js";
import { TOY, memberOf, poseCoat, specOf, traitsOf } from "../casting.js";
import type { CastMember, PlaneKind, PoseOptions } from "../casting.js";

// ---------------------------------------------------------------- bodies

export type Who = Pick<Actor, "member" | "spec">;

/** A coat grown from the skeleton, for sdf-body: see its Pelt and PeltBone. */
export interface PeltSpec {
  readonly flow: readonly {
    readonly a: Vec;
    readonly b: Vec;
    readonly long: readonly [number, number];
    readonly up: Vec;
    readonly girth: number;
    readonly fall?: number;
  }[];
  readonly under?: number;
  readonly thin?: number;
  readonly crease?: number;
  readonly tint?: number;
  readonly root?: string;
  readonly band?: readonly [string, number];
  readonly tip?: readonly [string, number];
  readonly back?: string;
  readonly front?: string;
  readonly dorsal?: number;
  readonly ventral?: number;
}

/** One posed animal (or plane): its capsules and the colours their roles take. */
export interface Body {
  readonly id: string;
  /** How much of it is there: traffic comes out of the sky and goes back into it. */
  readonly fade?: number;
  readonly kind: SpeciesId | PlaneKind | "bat";
  readonly label: string;
  readonly action: Action;
  readonly morph: Morph;
  readonly at: Vec;
  readonly front: Vec;
  readonly capsules: readonly Capsule[];
  readonly palette: Palette;
  /** How brightly it glows (a spirit animal, a golden one, a saucer's lights). */
  readonly glow: number;
  /** Colours that light themselves (a neon skin's markings). */
  readonly lit?: readonly Role[];
  /**
   * The coat's grain, for sdf-body: fur in locks, feathers in rows, a snake's scales; none on a bug's or crab's shell.
   */
  readonly grain?: {
    readonly kind: "fur" | "feather" | "scale" | "spine" | "plate";
    readonly size: number;
    readonly lie?: Vec;
    readonly rise?: number;
    readonly crown?: Vec;
    readonly on?: Role;
    readonly dome?: Vec;
    readonly tilt?: number;
    readonly teeth?: number;
    readonly scales?: readonly { readonly at: Vec; readonly reach: number; readonly size: number }[];
    readonly pelt?: PeltSpec;
  };
  /** How its coat takes the light beyond its grain's own way (a crow's purple-green gloss). */
  readonly material?: {
    readonly sheen?: number;
    readonly fuzz?: number;
    readonly gloss?: number;
    readonly iridescence?: number;
    readonly lift?: number;
    readonly neutral?: number;
  };
  /** The relief of muscle and bone over it, for a renderer that grows one (see sdf-body's Form). */
  readonly form?: { readonly amount: number; readonly size: number };
  /** A display train's feathers, for sdf-body to paint. */
  readonly vane?: { readonly role: Role; readonly heart: Role; readonly ring: Role; readonly gold: Role };
  /** Its eyes' lids, for a renderer that paints them (see sdf-body's Eye). */
  readonly eye?: {
    readonly role: Role;
    readonly lid: number;
    readonly slant: number;
    readonly color: string;
    readonly pupil: "round" | "slit" | "bar" | "dark";
    readonly ring: boolean;
    readonly spark?: number;
  };
  /** Bare skin's own light, for a renderer that holds it (see sdf-body's Skin). */
  readonly skin?: {
    readonly role: Role;
    readonly chroma: number;
    readonly pale?: string;
    readonly flush?: number;
    readonly depth?: number;
  };
  /**
   * A pattern grown over its coat, its own (seeded) and in one of its colours: a tabby's stripes, an owl's bars,
   * mottling on a plain coat.
   */
  readonly pattern?: {
    readonly kind:
      | "dapple"
      | "spots"
      | "stripes"
      | "streaks"
      | "bars"
      | "chevrons"
      | "mackerel"
      | "patches"
      | "grizzle"
      | "tips"
      | "scutes";
    readonly role: Role;
    readonly color?: string;
    readonly second?: string;
    readonly trunk?: Vec;
    readonly dorsal?: number;
    readonly run?: number;
    readonly scale: number;
    readonly contrast: number;
    readonly seed: number;
    readonly genes?: readonly [number, number, number, number];
  };
  /** Where it bears on the tree (a branch it sits on, wood it climbs), or null on the ground and in the air. */
  readonly contact?: Vec | null;
  /** Its weight, to bend the wood it bears on: a bird is light for its size, a bear is not. */
  readonly weight?: number;
  /** The food it is eating (a `Food.key`), while it eats. */
  readonly meal?: string;
}

const POSERS: Readonly<Record<Plan, (kit: Kit, who: Who, m: Moment) => void>> = {
  quad: poseQuad, primate: posePrimate, bird: poseBird, serpent: poseSerpent, bug: poseBug, crab: poseCrab,
};

export function poseWho(who: Who, m: Moment): Capsule[] {
  const q = m.pose;
  const roll = who.spec.plan === "quad" ? q.roll * Math.PI + q.shake * 0.45 * Math.sin(m.t * 32) : 0;
  // (A crab walks sideways: its right hand leads.)
  const f = who.spec.plan === "crab" ? { o: m.frame.o, x: m.frame.z, y: m.frame.y, z: scale(m.frame.x, -1) } : m.frame;
  const kit: Kit = { f, out: [], roll, pivot: [0, who.spec.build.body * who.member.size * 1.05, 0] };
  POSERS[who.spec.plan](kit, who, m);
  return kit.out;
}

/** Where an animal bears on the tree this moment: the branch it rests on or the wood it is climbing. */
function contactOf(m: Moment, scene: Scene): Vec | null {
  if (m.mode === "climb") return m.frame.o;
  if (m.mode !== null) return null;
  const place = m.segment.to;
  if (place.on === "perch") return perchOf(scene.stage, place.i)?.p ?? null;
  if (place.on === "trunk") return m.frame.o;
  return null;
}

const weightOf = (who: Who): number => who.member.heft ** 3 * (who.spec.plan === "bird" || who.spec.plan === "bug" ? 0.3 : 1);

/**
 * Nothing in nature is smooth: a coat parts into locks and feathers lie in
 * rows. A lock about a twentieth of the animal, a feather a fourteenth (a hedgehog's spines stand
 * apart, a tortoise's scutes are coarser); a bug's or a crab's shell, and a glowing
 * spirit, stay smooth.
 */
const GRAINS: Readonly<Record<Plan, "fur" | "feather" | "scale" | null>> = { quad: "fur", primate: "fur", bird: "feather", serpent: "scale", bug: null, crab: null };
// (An owl's plumage is soft and fine: its rows lie close, not in ridges; a cat's coat is short and sleek.)
const COARSE: Partial<Record<SpeciesId, readonly ["fur" | "feather" | "scale" | "spine" | "plate", number]>> = { hedgehog: ["spine", 0.115], tortoise: ["plate", 0.12], owl: ["feather", 0.005], cat: ["fur", 0.022], sloth: ["fur", 0.075], macaque: ["fur", 0.05], monkey: ["fur", 0.03] };
// (A sloth's long coat falls away from the top of its back in shaggy locks that break its outline.)
// (A snow macaque's coat is a pelt grown from its skeleton, on its coat role alone: its face, hands and seat stay
// bare.)
const SHAGS: Partial<Record<SpeciesId, { readonly lie?: Vec; readonly rise?: number; readonly on?: Role }>> = { sloth: { lie: [0, -1, -0.15], rise: 4.4 }, macaque: { on: "coat" }, monkey: { on: "coat" } };
/**
 * A hedgehog's spines: set about the middle of its dome, they lie back along it from its forehead to its rump and a
 * little down its flanks, and grow on its mantle alone.
 */
function quillGrain(who: Who, m: Moment): { crown: Vec; lie: Vec; rise: number; on: Role } {
  const body = quadSpine(who, m.pose, m);
  const back = unit(sub(body.P, body.S), [0, 0, -1]);
  return { crown: toWorld(m.frame, madd(mantleLine(body, 0.42), UP, body.r * 0.15)), lie: unit(madd(back, UP, -0.18)), rise: 0.8, on: "alt" };
}
/** A hide's larger scales: polygons on the crown of the head, overlapping shields down the front of each foreleg. */
function shellScales(who: Who, capsules: readonly Capsule[]): { at: Vec; reach: number; size: number }[] {
  const { size } = who.member;
  const scales: { at: Vec; reach: number; size: number }[] = [];
  const head = capsules.find((c) => c.part === "head");
  if (head) scales.push({
    at: madd(lerpV(head.a, head.b, 0.45), head.up, head.r * 0.8),
    reach: head.r * 1.05,
    size: size * 0.05,
  });
  for (const leg of ["leg.FL.lower", "leg.FR.lower"]) {
    const c = capsules.find((each) => each.part === leg);
    if (c) scales.push({ at: madd(lerpV(c.a, c.b, 0.42), c.fw, c.r * 1.05), reach: c.r * 1.75, size: size * 0.07 });
  }
  return scales;
}
/**
 * A tortoise's plates: laid over its dome wherever the dome lies and however far it has pitched, as high and as toothed
 * as this animal's shell grew.
 */
function plateGrain(
  who: Who,
  m: Moment,
  capsules: readonly Capsule[],
): {
  crown: Vec;
  dome: Vec;
  rise: number;
  on: Role;
  tilt: number;
  teeth: number;
  scales: { at: Vec; reach: number; size: number }[];
} {
  const body = quadSpine(who, m.pose, m);
  const gene = createRandom(markOf(who) ^ 0x3ac5e2f7);
  return {
    crown: toWorld(m.frame, shellHeart(body)),
    dome: domeOf(body),
    rise: mix(0.35, 1, gene()) * (who.member.coat === "star" ? 1.3 : 1),
    on: "shell",
    tilt: Math.atan2(body.P[1] - body.S[1], body.S[2] - body.P[2]),
    teeth: mix(0.012, 0.06, gene()),
    scales: shellScales(who, capsules),
  };
}
/** What a coat's grain takes from how the animal lies this moment. */
function grainPose(
  who: Who,
  m: Moment,
  capsules: readonly Capsule[],
): Partial<ReturnType<typeof quillGrain>> & Partial<ReturnType<typeof plateGrain>> & { pelt?: PeltSpec } {
  if (who.member.species === "sloth") return { crown: slothCrown(who, m) };
  if (who.member.species === "macaque") return { pelt: macaquePelt(who, m, capsules) };
  if (who.member.species === "monkey" || who.member.species === "loris") return { pelt: monkeyPelt(who, m, capsules) };
  if (who.member.species === "tortoise") return plateGrain(who, m, capsules);
  return who.member.species === "hedgehog" ? quillGrain(who, m) : {};
}
function grainOf(who: Who, m: Moment, capsules: readonly Capsule[]): Pick<Body, "grain"> {
  const [kind, share] = COARSE[who.member.species] ?? [GRAINS[who.spec.plan], who.spec.plan === "serpent" ? 0.022 : who.spec.plan === "bird" ? 0.07 : 0.05];
  // (A shell keeps its plates in any light: they are what stops its dome at the rim.)
  if (!kind || (kind !== "plate" && MORPHS[who.member.morph].glow > 0.5)) return {};
  // (An upright bird's feathers lie down it, not back along it: in rows round an owl, not stripes up it.)
  const pitch = STANCES[who.member.species]?.pitch ?? 0;
  // (A spread train's feathers wear the renderer's barbs: the body's rows stay on the body.)
  const on = m.pose.fan > 0.3 && who.spec.build.extras.includes("train") ? { on: "coat" as const } : {};
  return {
    grain: {
      kind,
      size: who.member.size * share,
      ...on,
      ...(pitch > 1.1 ? { lie: scale(dirOf(0, pitch), -1) } : {}),
      ...SHAGS[who.member.species],
      ...grainPose(who, m, capsules),
    },
  };
}

type CoatPattern = NonNullable<Body["pattern"]>;
/**
 * A pattern: its kind, its colour, its feature size in the animal's sizes, how strongly it shows, a colour of its own
 * in place of its role's, and for scutes how whole their rays run.
 */
type PatternSpec = readonly [CoatPattern["kind"], Role, number, number, (string | undefined)?, number?];
/**
 * Patterns by species, then by coat where a coat has its own (a tabby's
 * stripes, a sika's spots). Every other furred or feathered coat is softly
 * mottled in its second colour, so no coat is one flat colour.
 */
const PATTERNS: Partial<Record<SpeciesId, PatternSpec>> = {
  macaque: ["dapple", "alt", 0.24, 0.16], monkey: ["dapple", "alt", 0.2, 0.14],
  guineafowl: ["spots", "shine", 0.022, 1],
  hedgehog: ["tips", "belly", 1, 1], sloth: ["dapple", "alt", 0.2, 0.36, "#5e7038"], owl: ["bars", "alt", 0.07, 0.5], snake: ["dapple", "alt", 0.05, 0.16], cat: ["dapple", "alt", 0.3, 0.08], raccoon: ["grizzle", "alt", 0.035, 1],
};
const COAT_PATTERNS: Readonly<Record<string, PatternSpec>> = {
  grey: ["stripes", "dark", 0.14, 0.35],
  sika: ["spots", "belly", 0.06, 0.8],
  fallow: ["spots", "belly", 0.07, 0.7],
  sparrow: ["streaks", "dark", 0.09, 0.55],
  snowy: ["chevrons", "dark", 0.1, 1, "#3a2c22"],
  banded: ["dapple", "alt", 0.3, 0.1],
  // (One algorithm on a tortoise's plates: a leopard's pigment stops and starts in blotches, a star's never rests and
  // runs out in rays.)
  leopard: ["scutes", "dark", 0.021, 1, undefined, 0.15],
  star: ["scutes", "accent", 0.016, 1, undefined, 1],
  barn: ["chevrons", "dark", 0.085, 0.7],
  "great horned": ["bars", "dark", 0.055, 0.85],
  tawny: ["bars", "alt", 0.06, 0.7],
  ural: ["bars", "alt", 0.07, 0.6],
};
/** A cat's coats: a coat's name is only its own on a cat (a grey wolf is not a tabby). */
const CAT_PATTERNS: Readonly<Record<string, PatternSpec>> = {
  tabby: ["mackerel", "dark", 0.085, 0.8], grey: ["mackerel", "dark", 0.085, 0.68], calico: ["patches", "alt", 0.34, 1],
};
const MOTTLE: PatternSpec = ["dapple", "coat", 0.35, 0.3];
/** Coats that shine in colours as they turn. */
const MATERIALS: Partial<Record<SpeciesId, NonNullable<Body["material"]>>> = {
  // (Black, with its gloss on top: lifted as a wolf's coat is, a crow goes grey at noon.)
  crow: { gloss: 0.55, iridescence: 0.6, lift: 0.25 }, peacock: { gloss: 0.45, iridescence: 0.45 },
  // (A cat's black goes unlifted, so a calico's patches and a tabby's stripes are black.)
  cat: { lift: 0.3 },
  // (The mask, the bands and the paws are the raccoon, so its black stays black too.)
  raccoon: { lift: 0.22, neutral: 1 },
  // (A star tortoise's horn stays near black, for its rays to stand out on, and a shell's dull polish never blows out.)
  tortoise: { lift: 0.3, gloss: 0.12 },
  // (A pale edge along a sloth's back, where the light catches the tips of its coat.)
  sloth: { fuzz: 0.85 },
  // (The same pale edge on a snow macaque, its guard hairs catching the light.)
  macaque: { sheen: 0, fuzz: 0.5, lift: 0.25 }, monkey: { sheen: 0, fuzz: 0.4, lift: 0.25 },
};
/** A black cat is the exception: a quiet sheen and a rim along its back, head and haunch, so it keeps its shape. */
const BLACK_CAT: NonNullable<Body["material"]> = { sheen: 0.6, fuzz: 0.3, lift: 0.42, neutral: 0.85 };
export const grizzled = (who: Who): boolean => patternOf(who)?.[0] === "grizzle";
/** The pattern an animal wears, if any: its coat's own, then its species', then a soft mottle. */
function patternOf(who: Who): PatternSpec | null {
  if (!GRAINS[who.spec.plan]) return null;
  const spec = (who.member.species === "cat" ? CAT_PATTERNS[who.member.coat] : undefined) ?? COAT_PATTERNS[who.member.coat] ?? PATTERNS[who.member.species] ?? MOTTLE;
  // (A morph repaints a coat plain, but a shell's plates still grow their marks, in the morph's own colours.)
  return who.member.morph === "normal" || spec[0] === "scutes" ? spec : null;
}

/**
 * How far each pupil's kind of eye has its lid down, and how it slants: a hunter's narrowed and rising to the corner, a
 * grazer's wide and level.
 */
const LIDS: Readonly<Record<EyeStyle["pupil"], readonly [number, number]>> = { slit: [0.34, 0.32], round: [0.3, 0.18], bar: [0.24, 0.04], dark: [0.2, 0.08], bead: [0, 0] };

/** How far down a lid of skin comes to shut an eye: past its middle, the line of its lashes low on the lens. */
const SHUT_LID = 1.58;

/** Its lids and its own iris: the same kind of eye, a shade and a set of the lid no other has. */
function eyesOf(who: Who, asleep: boolean): Pick<Body, "eye" | "palette"> {
  const { palette } = who.member;
  const gene = createRandom(markOf(who) ^ 0x2f9be6cc);
  const style = eyeOfSpecies(who).eye ?? EYE;
  const { pupil } = style;
  const [lid, slant] = style.lid === undefined ? LIDS[pupil] : [style.lid, LIDS[pupil][1]];
  const masked = who.spec.build.extras.includes("mask");
  const shift = gene();
  const iris = mixColor(palette.eye, shift < 0.5 ? "#1c140e" : "#b89a58", Math.abs(shift - 0.5) * 0.5);
  const color = style.skinLid ? palette.accent : masked ? palette.dark : palette.coat;
  // (Skin lids come right down in sleep, to a dark line along the lashes.)
  const own = lid + (lid > 0 ? mix(-0.07, 0.09, gene()) : 0);
  return { eye: { role: "eye", lid: style.skinLid && asleep ? SHUT_LID : own, slant: slant * mix(0.7, 1.3, gene()), color, pupil: pupil === "bead" ? "dark" : pupil, ring: style.rim, ...(style.skinLid ? { spark: style.spark ?? 0.2 } : {}) }, palette: { ...palette, eye: iris } };
}

/**
 * Bare skin's own light, for the animals whose skin shows: a macaque's face and seat, matte, the red of the blood under
 * it.
 */
function skinOfBody(who: Who): Pick<Body, "skin"> {
  // (A guineafowl's head is bare skin, so its pearl spots stop at the neck.)
  if (who.member.species === "guineafowl") return { skin: { role: "accent", chroma: 0.9, depth: 0.9 } };
  if (!macaqueKind(who) || who.member.species === "loris") return {};
  const { accent } = who.member.palette;
  // (A vervet's face is black, and only its lids a shade off it.)
  if (who.member.coat === "vervet") return { skin: { role: "accent", chroma: 0.3, pale: mixColor(accent, "#6c5a54", 0.5), flush: 0.05, depth: 0.8 } };
  return { skin: { role: "accent", chroma: 0.8, pale: mixColor(accent, "#f4ccc4", 0.42), flush: 0.34, depth: 0.74 } };
}

/** The relief over this animal's body, its own: strongest on a mammal's frame, slight under a bird's feathers. */
function formOf(who: Who): Pick<Body, "form"> {
  if (!GRAINS[who.spec.plan] || who.spec.plan === "serpent" || MORPHS[who.member.morph].glow > 0.5) return {};
  const gene = createRandom(markOf(who) ^ 0x7c15d3a1);
  const r = who.spec.build.body * who.member.size;
  return { form: { amount: r * (who.spec.plan === "bird" ? 0.07 : who.spec.build.extras.includes("shell") ? 0.012 : macaqueKind(who) ? 0.05 : 0.17) * mix(0.75, 1.3, gene()), size: r * mix(0.85, 1.5, gene()) } };
}

/** A spread train's feathers, for the renderer to paint shaft, barbs and eye on. */
function vaneOf(who: Who, m: Moment): Pick<Body, "vane"> {
  return m.pose.fan > 0.3 && who.spec.build.extras.includes("train") ? { vane: { role: "shell", heart: "dark", ring: "coat", gold: "accent" } } : {};
}

/** The number all of this animal's marks grow from. */
export const markOf = (who: Who): number => (who.member as Partial<Pick<CastMember, "traits">>).traits?.mark ?? Math.floor(ownPhase(who) * 4294967296);

/**
 * How this animal's marks grow: not one of a list of looks but continuous
 * genes off its own mark, for the same algorithms to grow a coat no other has.
 */
function genesOf(who: Who, spec: PatternSpec): Pick<CoatPattern, "scale" | "contrast" | "seed" | "genes"> {
  const seed = markOf(who);
  const gene = createRandom(seed ^ 0x51ed270b);
  const genes = [
    mix(0.5, 1.9, gene()),
    mix(0.72, 1.45, gene()),
    mix(-0.07, 0.07, gene()),
    mix(0.08, 0.34, gene()),
  ] as const;
  return {
    scale: who.member.size * spec[2] * mix(0.78, 1.28, gene()),
    contrast: Math.min(1, contrastOf(who, spec) * mix(0.82, 1.14, gene())),
    seed,
    genes,
  };
}

function coatOf(who: Who, q: Pose): Pick<Body, "pattern" | "material"> {
  const material = who.member.species === "cat" && who.member.coat === "black" ? BLACK_CAT : MATERIALS[who.member.species];
  const spec = patternOf(who);
  // (Mottling is a darker shade of the coat itself, so it breaks a plain coat up without greying a pied one.)
  const color = spec === MOTTLE ? mixColor(who.member.palette.coat, "#000000", 0.22) : spec?.[4];
  const shade = color === undefined ? {} : { color };
  const run = spec?.[5] === undefined ? {} : { run: spec[5] };
  const pattern = spec
    ? { kind: spec[0], role: spec[1], ...shade, ...run, ...trunkOf(who, spec[0], q), ...genesOf(who, spec) }
    : undefined;
  return { ...(material ? { material } : {}), ...(pattern ? { pattern } : {}) };
}

/**
 * Where the trunk ends for a pattern that goes by it: its legs begin below it
 * standing, and only just off the ground once it sits or lies, the trunk
 * down there with them. A calico's black patches lie among its orange.
 */
function trunkOf(who: Who, kind: CoatPattern["kind"], q: Pose): Pick<CoatPattern, "trunk" | "second" | "dorsal"> {
  // (A shell's hide goes as pale as its belly where it turns under.)
  if (kind === "scutes") return { second: who.member.palette.belly };
  if (kind !== "mackerel" && kind !== "patches" && kind !== "grizzle") return {};
  const b = buildOf(who);
  const { size } = who.member;
  const r = b.body * size;
  const low = mix(shoulderOf(b, size) - r * 0.85, r * 0.15, Math.max(q.sit, q.lie));
  const trunk: Vec = [low, -(b.len * size) / 2 - r * 0.75, (b.len * size) / 2 + r * 0.7];
  // (The spine's dark line runs on a standing back only; sat up, the midline is its chest.)
  const dorsal = mix(shoulderOf(b, size) + r * (kind === "grizzle" ? 0.1 : 0.5), size * 9, Math.max(q.sit, q.lie, q.curl) > 0.1 ? 1 : 0);
  return { trunk, dorsal, ...(kind === "patches" ? { second: who.member.palette.dark } : kind === "grizzle" ? { second: who.member.palette.belly } : {}) };
}

/**
 * How strongly a pattern shows: as its kind has it, but a snowy owl hen is barred far more heavily than the cock, who
 * is nearly white.
 */
function contrastOf(who: Who, spec: PatternSpec): number {
  // (A morph's shell keeps its marks, but quieter: the morph's own colour is what shows.)
  if (spec[0] === "scutes" && who.member.morph !== "normal") return spec[3] * 0.62;
  if (who.member.coat !== "snowy") return spec[3];
  const sex = (who.member as Partial<Pick<CastMember, "traits">>).traits?.sex;
  return Math.min(1, spec[3] * (sex === "male" ? 0.85 : 1.5));
}

/** Standing on the ground and upright, so the ground is under every part of it. */
const onFloor = (m: Moment): boolean => m.mode !== "fly" && m.mode !== "climb" && m.segment.act !== "hang" && m.segment.from.on === "ground" && m.segment.to.on === "ground" && m.frame.y[1] > 0.9;

/** No part goes through the ground: a rolling head, a lying belly or a planted paw rests on it. */
function aboveFloor(capsules: readonly Capsule[], m: Moment): readonly Capsule[] {
  if (!onFloor(m)) return capsules;
  const floor = m.frame.o[1];
  return capsules.map((c) => {
    const lowA = floor + c.r - c.a[1];
    const lowB = floor + (c.r1 ?? c.r) - c.b[1];
    if (lowA <= 0 && lowB <= 0) return c;
    return {
      ...c,
      a: lowA > 0 ? [c.a[0], c.a[1] + lowA, c.a[2]] : c.a,
      b: lowB > 0 ? [c.b[0], c.b[1] + lowB, c.b[2]] : c.b,
    };
  });
}

export function bodyOf(id: string, who: Who, m: Moment, drawn: readonly Capsule[], scene?: Scene): Body {
  const capsules = aboveFloor(drawn, m);
  return {
    id,
    kind: who.member.species,
    label: who.member.label,
    action: m.segment.act,
    morph: who.member.morph,
    at: m.frame.o,
    front: m.frame.z,
    capsules,
    glow: MORPHS[who.member.morph].glow,
    lit: MORPHS[who.member.morph].lit ?? [],
    contact: scene ? contactOf(m, scene) : null,
    weight: weightOf(who),
    ...grainOf(who, m, capsules),
    ...coatOf(who, m.pose),
    ...eyesOf(who, m.segment.act === "sleep"),
    ...formOf(who),
    ...skinOfBody(who),
    ...vaneOf(who, m),
    ...(m.segment.meal === undefined ? {} : { meal: m.segment.meal }),
  };
}

/** Where a rider sits: the top of the body capsule's middle. */
export function backOf(capsules: readonly Capsule[]): Anchor | null {
  const body = capsules.find((c) => c.part === "body" || c.part === "torso");
  if (!body) return null;
  return { p: madd(lerpV(body.a, body.b, 0.5), body.up, body.r * 0.95), up: body.up, along: unit(sub(body.b, body.a)) };
}

/**
 * Any species doing any action at time `t`, standing at the origin facing +z:
 * for galleries, thumbnails and tests.
 */
export function poseSpecies(id: SpeciesId, action: Action = "stand", t = 0, options: PoseOptions = {}): Body {
  const young = options.young ?? false;
  const region = ALL_REGIONS.find((each) => each === options.region) ?? null;
  const seed = options.seed;
  const coat = options.coat ?? poseCoat(id, region, seed);
  const traits = traitsOf(seed === undefined ? null : streamOf(seed, "fauna.pose.traits"), young, options.sex ?? "male");
  const member = memberOf(
    createRandom(seed ?? 1),
    id,
    coat,
    young,
    { morph: options.morph, region: region ?? undefined },
    undefined,
    traits,
  );
  const spec = specOf(member);
  return galleryBody(id, { member, spec }, action, t);
}

/** An animal posed for the gallery. */
function galleryBody(id: SpeciesId, who: Who, action: Action, t: number): Body {
  const climbing = galleryClimb(id, action);
  const m = climbing
    ? onGalleryTrunk(galleryMoment(who.spec, action, t), who.member.size)
    : galleryMoment(who.spec, action, t);
  return bodyOf(id, who, m, [...poseWho(who, m), ...(climbing ? [galleryTrunk(who, m)] : [])]);
}

const GALLERY_MODES: Partial<Record<Action, MoveMode>> = { fly: "fly", climb: "climb", wander: "walk", run: "walk", hop: "walk", stalk: "walk" };

function galleryMoment(spec: SpeciesSpec, action: Action, t: number): Moment {
  const ground: Place = { on: "ground", x: 0, z: 0 };
  const mode = GALLERY_MODES[action] ?? null;
  const pace = mode ? spec.speed * (PACE[action] ?? 1) : 0;
  const segment: Segment = {
    act: action,
    t0: 0,
    t1: Math.max(t, 0) + 4,
    from: ground,
    to: ground,
    yaw: 0,
    face: -1,
    mode,
    pace,
  };
  // (A hanging animal hangs from a branch overhead, not from the ground.)
  // (It hangs at its drawn size, its legs dangling below its arms.)
  const phase = (t * pace) / Math.max(0.5, spec.build.len);
  const hop = action === "hop" && spec.plan === "bird" ? spec.size * 0.5 * Math.abs(Math.sin(Math.PI * phase)) : 0;
  const lift: Vec = action === "fly" ? [0, spec.size * 2, 0] : action === "hang" ? [0, Math.max(spec.size, TOY * Math.sqrt(spec.size)) * 2.4, 0] : [0, hop, 0];
  return {
    frame: frameOf(lift, [0, 0, 1]),
    phase,
    moving: mode ? 1 : 0,
    pace,
    mode,
    segment,
    pose: paramsOf(segment, t + FADE),
    t,
  };
}

/** The way out from the trunk a macaque climbs in the gallery: its flank to the gallery's camera. */
const GALLERY_BARK: Vec = unit([0.7, 0, 0.7]);
/** A macaque climbing in the gallery goes up real wood, so a climb can be judged there and not in the air. */
const galleryClimb = (id: SpeciesId, action: Action): boolean => (id === "macaque" || id === "monkey") && action === "climb";
const onGalleryTrunk = (m: Moment, size: number): Moment => ({
  ...m,
  frame: frameOf([0, size * 0.5, 0], UP, GALLERY_BARK),
});

/** That trunk, behind the animal on it. */
function galleryTrunk(who: Who, m: Moment): Capsule {
  const r = who.spec.build.body * who.member.size * 1.8;
  const at = madd(m.frame.o, m.frame.y, -r);
  return { a: add(at, [0, -who.member.size * 0.5, 0]), b: add(at, [0, who.member.size * 1.1, 0]), r, role: "horn", part: "trunk", flat: 1, up: m.frame.y, fw: m.frame.z };
}
