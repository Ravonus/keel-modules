/**
 * Seeded generative people. One seed is one whole person: a build, a face, hair
 * and clothes, all stood on one skeleton, so a portrait, a pedestrian and a
 * driver are the same person seen differently. Pure and renderer-free: a pose
 * is a list of capsules, for sdf-body to raymarch or anything else to draw.
 * Front is +z, right +x, up +y, in metres, the feet on y = 0.
 */

export type Vec = readonly [number, number, number];

const UP: Vec = [0, 1, 0];
const FRONT: Vec = [0, 0, 1];
const SIDE: Vec = [1, 0, 0];
const TAU = Math.PI * 2;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const madd = (a: Vec, b: Vec, k: number): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerpV = (a: Vec, b: Vec, k: number): Vec => madd(a, sub(b, a), k);
const unit = (a: Vec, fallback: Vec = FRONT): Vec => { const l = Math.hypot(...a); return l > 1e-9 ? scale(a, 1 / l) : fallback; };
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- the roll

/** A seed's stream of numbers, 0 to 1: the same on every machine. */
function streamOf(seed: number, salt: number): () => number {
  let s = (Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand: () => number, list: readonly string[]): string => list[Math.floor(rand() * list.length)] ?? "#000000";

/** Bell-shaped: most people near the middle of a range, few at its ends. */
const bell = (rand: () => number, a: number, b: number): number => mix(a, b, (rand() + rand() + rand()) / 3);

function weighted<T>(rand: () => number, list: readonly (readonly [T, number])[]): T {
  let left = rand() * list.reduce((sum, [, w]) => sum + w, 0);
  const hit = list.find(([, w]) => { left -= w; return left <= 0; });
  const [first] = list;
  if (!first) throw new Error("nothing to pick from");
  return (hit ?? first)[0];
}

const hex = (v: number): string => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");

/** A colour from hue (turns), saturation and lightness. */
function hsl(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Skin, from deep to fair: lightness rolled freely, its warmth its own. */
const SKIN_RAMP = ["#3f2619", "#5e3a26", "#80533a", "#a67351", "#c49270", "#ddb195", "#efcfb9"] as const;
const skinTone = (rand: () => number): string => {
  const at = rand() * (SKIN_RAMP.length - 1), i = Math.floor(at);
  const tone = blend(SKIN_RAMP[i] ?? "#a67351", SKIN_RAMP[Math.min(i + 1, SKIN_RAMP.length - 1)] ?? "#a67351", at - i);
  return blend(tone, rand() < 0.5 ? "#d98c80" : "#d9ad66", rand() * 0.14);
};

const HAIR_TONES = ["#14100e", "#1f1612", "#33221a", "#4e3424", "#6e4a2c", "#8e6a3c", "#b89560", "#8c3a1e", "#d8b878", "#c9a25e", "#a0522a"] as const;
const LOUD_HAIR = ["#d0408c", "#3a6ad8", "#2ea880", "#8a48d0"] as const;
const IRIS_TONES = ["#2e1c10", "#46291a", "#5c3a1e", "#3a5a78", "#4e7a5a", "#6a7a84"] as const;
const DARK_IRIS = ["#1c100a", "#2e1c10", "#46291a", "#6e4a24"] as const;

export type HairStyle = "bald" | "crop" | "side" | "curly" | "afro" | "bob" | "long" | "bun" | "pony" | "mohawk" | "shag" | "bangs" | "wavy" | "braids" | "locs" | "twintails" | "undercut";
export type Sex = "female" | "male";
/** The kind of clothes someone goes for. */
export type Genre = "casual" | "street" | "formal" | "sport" | "goth" | "work" | "boho" | "preppy";
export type FaceHair = "none" | "stubble" | "moustache" | "beard";
export type Top = "tee" | "tank" | "long" | "hoodie" | "jacket" | "dress" | "blazer" | "coat" | "robe" | "polo" | "raincoat" | "puffer" | "swimsuit" | "bikini" | "string" | "bare";
export type Bottom = "jeans" | "trousers" | "shorts" | "skirt" | "leggings" | "cargo" | "swim" | "briefs";
/** The day a person has dressed for. */
export type Weather = "mild" | "rain" | "cold" | "hot" | "beach";
export type Carry = "none" | "umbrella";
/** A job or a getup that replaces what they would wear. */
export type Costume = "none" | "suit" | "firefighter" | "police" | "cowboy" | "fursuit" | "latex";
export type Shoe = "sneaker" | "boot" | "sandal" | "loafer";
export type Hat = "none" | "cap" | "beanie" | "fedora" | "sunhat" | "hood" | "helmet" | "peaked" | "stetson" | "bucket" | "beret" | "flatcap" | "bowler" | "tophat" | "pompom" | "hardhat" | "bandana" | "headwrap" | "visor";

/** What a person wears that is not clothes: on the face, in the ears and nose, at the neck and in the hair. */
export interface Gear {
  readonly glasses: "none" | "clear" | "round" | "cat" | "sun";
  readonly ears: "none" | "stud" | "hoop" | "drop";
  readonly nose: "none" | "stud" | "ring";
  readonly neck: "none" | "chain" | "pendant";
  readonly hair: "none" | "clip" | "clips" | "bow" | "band";
  readonly phones: boolean;
}

/** How far through a life: each changes their size and how they are put together. */
export type Age = "toddler" | "child" | "teen" | "adult" | "elder";

export type Shape = "slim" | "lean" | "average" | "athletic" | "muscular" | "stocky" | "curvy" | "heavy" | "large";

export interface Build {
  readonly age: Age;
  readonly sex: Sex;
  /** How tall they really stand, metres. */
  readonly height: number;
  /** That over `TALL`: everything is drawn at `TALL` and scaled down by this, so a child's bones are a child's. */
  readonly size: number;
  /** How far an old back bends forward. */
  readonly stoop: number;
  /** Half widths at the shoulders and hips, metres. */
  readonly shoulder: number;
  readonly hip: number;
  /** What kind of body it is. */
  readonly shape: Shape;
  /** How much of them there is: 1 average, thinner under, fuller over. */
  readonly girth: number;
  /** The waist against the average one, and how far the stomach stands out. */
  readonly waist: number;
  readonly belly: number;
  /** How much meat is on the limbs, the size of the bust (a man's chest), the seat, and the feet's length, each 1 average. */
  readonly limb: number;
  readonly bust: number;
  readonly rear: number;
  readonly foot: number;
  readonly head: number;
  /** The legs' share of the height. */
  readonly legs: number;
  /** How far the chest stands forward of the waist. */
  readonly chest: number;
}

/** What is worn on a face or lies on its skin; a child's is freckles alone. */
export interface Look {
  readonly lip?: string;
  readonly shadow?: readonly [string, number];
  readonly blush?: readonly [string, number];
  readonly liner: number;
  readonly freckles: number;
  readonly spots: number;
  readonly tired: number;
  /** How lined, how rough, how marked by old spots, how uneven in tone: all 0 to 1, and little of any on a child. */
  readonly lines: number;
  readonly rough: number;
  readonly scars: number;
  readonly uneven: number;
  readonly moles: readonly (readonly [number, number, number])[];
}

export interface Face {
  /** An eye's half height, and how far out from the middle it sits, in head radii. */
  readonly eye: number;
  readonly apart: number;
  readonly lid: number;
  readonly slant: number;
  readonly brow: number;
  readonly browTilt: number;
  /** How far the nose stands off the face, and how wide its wings, in head radii. */
  readonly nose: number;
  readonly noseWide: number;
  /** How full the lips are: 1 average, and always 1 on a child. */
  readonly lips: number;
  readonly mouthWide: number;
  /** A person's own lean, -1 to 1, in the jaw, the chin, the width and the length. */
  readonly jaw: number;
  readonly chin: number;
  readonly ears: number;
  readonly wide: number;
  readonly long: number;
  /** How high the eyes sit against the rest of their age, head radii. */
  readonly eyeRise: number;
  readonly iris: string;
  readonly hair: FaceHair;
  readonly bone: Bone;
  readonly look: Look;
}

/** What a face is built on, in head radii: `y` up from the head's centre, `z` forward of it, `x` out from the middle. */
export interface Bone {
  /** How grown it is, 0 a child's to 1 an adult's: every difference by sex goes by this. */
  readonly m: number;
  /** The skull's width, the face's length and the skull's depth, each 1 average. */
  readonly W: number;
  readonly L: number;
  readonly D: number;
  /** How much of the head is flesh over the bone, and how little on a lean grown face. */
  readonly fat: number;
  readonly lean: number;
  /** How far above the base of the neck the head's centre rides. */
  readonly rise: number;
  readonly pupil: number;
  /** Where the nose meets the lip, and the lips each other: before `L`, as all heights under the centre are. */
  readonly sub: number;
  readonly sto: number;
  /** How wide the face runs: at the temples, the cheekbones, and the waist between them and the jaw. */
  readonly tem: number;
  readonly zyg: number;
  readonly mid: number;
  /** How square a face is across its front: 2 a true round, more for a flatter plane with harder corners. */
  readonly plane: number;
  /** The jaw's corner: how wide, how low, how far back. */
  readonly gon: number;
  readonly gonY: number;
  readonly gonZ: number;
  readonly chin: number;
  readonly men: number;
  readonly pogZ: number;
  /** The cheekbone's height off the face and where it sits, and how far the brow stands. */
  readonly cheek: number;
  readonly cheekY: number;
  readonly ridge: number;
  readonly hollow: number;
  readonly full: number;
  readonly old: number;
  /** How far the tip stands off the face, how far it lifts, how far the bridge bows, how far off centre it lies. */
  readonly tipY: number;
  readonly hump: number;
  readonly askew: number;
  /** How much deeper the sockets go, how much thicker the brows, and how the mouth lies at rest. */
  readonly orbit: number;
  readonly browK: number;
  readonly arch: number;
  /** How far the brow lies above where the eye would put it. */
  readonly browUp: number;
  readonly rest: number;
  readonly freckles: number;
  readonly mole: number;
}

export interface Outfit {
  readonly genre: Genre;
  /** How it fits: 0 close to the body, 1 baggy. */
  readonly fit: number;
  readonly top: Top;
  readonly bottom: Bottom;
  readonly shoe: Shoe;
  readonly hat: Hat;
  /** What they have in their hand. */
  readonly carry: Carry;
  readonly costume: Costume;
  /** Stripes across a top, how many (0 plain). */
  readonly stripes: number;
}

export interface Person {
  readonly seed: number;
  readonly build: Build;
  readonly face: Face;
  readonly hair: HairStyle;
  readonly outfit: Outfit;
  readonly gear: Gear;
  readonly palette: Readonly<Record<string, string>>;
  readonly gait: Gait;
}

/** How a person moves, theirs as their face is. Two strangers never run alike, and few people run alike on both sides. */
export interface Gait {
  /** Steps as against the common pace. */
  readonly cadence: number;
  /** How long the stride is, how high the heel comes up, how far the arms go. */
  readonly stride: number;
  readonly kick: number;
  readonly swing: number;
  /** How closed each hand is, left and right, running and walking. */
  readonly running: readonly [number, number];
  readonly walking: readonly [number, number];
  /** Each elbow's bend, running. */
  readonly pump: readonly [number, number];
  /** How high the arms are carried, how far the elbows stand out. */
  readonly carry: number;
  readonly flare: number;
  /** The arm that swings less, and by how much: -1 left, 1 right, 0 neither. */
  readonly lazy: number;
  readonly lazyBy: number;
  readonly lean: number;
  readonly bounce: number;
  readonly sway: number;
  readonly twist: number;
  readonly turned: number;
  /** How far the forearms come in across the body, how far apart the feet go, and where in a stride they happen to be. */
  readonly across: number;
  readonly wide: number;
  readonly offset: number;
  /** Which of the ways of dancing and of standing about are theirs. */
  readonly dance: number;
  readonly idle: number;
}

const GREY_HAIR: readonly string[] = ["#d8d6d2", "#b9b7b4", "#8f8e8c", "#ecebe6"];

type Weighted<T> = readonly (readonly [T, number])[];

const HAIRS: Readonly<Record<Sex, Weighted<HairStyle>>> = {
  female: [["long", 4], ["wavy", 3.4], ["bob", 3], ["bangs", 2.6], ["pony", 2.4], ["bun", 2], ["braids", 2], ["twintails", 1.4], ["curly", 2], ["afro", 1.2], ["locs", 1.2], ["shag", 2], ["side", 0.8], ["undercut", 0.5]],
  male: [["crop", 4], ["side", 3.4], ["undercut", 2.6], ["curly", 2], ["shag", 1.6], ["afro", 1.2], ["locs", 0.6], ["mohawk", 0.5], ["bald", 1.4], ["long", 0.25], ["wavy", 0.25], ["bun", 0.12], ["pony", 0.12]],
};

interface Wardrobe {
  readonly tops: Weighted<Top>;
  readonly bottoms: Weighted<Bottom>;
  readonly shoes: Weighted<Shoe>;
  readonly hats: Weighted<Hat>;
  readonly fit: readonly [number, number];
}

const GENRES: Weighted<Genre> = [["casual", 5], ["street", 2.4], ["formal", 1.8], ["sport", 1.6], ["goth", 0.9], ["work", 1.4], ["boho", 1.2], ["preppy", 1.2]];

const WARDROBES: Readonly<Record<Genre, Wardrobe>> = {
  casual: { tops: [["tee", 5], ["long", 3], ["hoodie", 1.6], ["polo", 1], ["dress", 2], ["tank", 1.2]], bottoms: [["jeans", 5], ["shorts", 1.6], ["skirt", 1.6], ["trousers", 1.4]], shoes: [["sneaker", 5], ["sandal", 1.2], ["boot", 1]], hats: [["none", 9], ["cap", 1]], fit: [0.2, 0.55] },
  street: { tops: [["hoodie", 5], ["tee", 3], ["jacket", 2]], bottoms: [["cargo", 4], ["jeans", 3], ["shorts", 1]], shoes: [["sneaker", 6], ["boot", 1.4]], hats: [["none", 4], ["cap", 2.4], ["beanie", 2.4]], fit: [0.6, 1] },
  formal: { tops: [["blazer", 6], ["dress", 2.6], ["coat", 1.4]], bottoms: [["trousers", 6], ["skirt", 2]], shoes: [["boot", 1], ["loafer", 6]] as Weighted<Shoe>, hats: [["none", 9], ["fedora", 0.8]], fit: [0.15, 0.4] },
  sport: { tops: [["tee", 4], ["tank", 4], ["hoodie", 1.4]], bottoms: [["shorts", 4], ["leggings", 4]], shoes: [["sneaker", 1]], hats: [["none", 6], ["cap", 2]], fit: [0, 0.3] },
  goth: { tops: [["long", 3], ["coat", 3], ["dress", 2], ["tee", 1.4]], bottoms: [["leggings", 3], ["skirt", 2], ["jeans", 2]], shoes: [["boot", 1]], hats: [["none", 8], ["beanie", 1]], fit: [0.1, 0.5] },
  work: { tops: [["jacket", 3], ["long", 3], ["tee", 2], ["tank", 0.7]], bottoms: [["cargo", 4], ["jeans", 3], ["trousers", 2]], shoes: [["boot", 1]], hats: [["none", 5], ["cap", 2.4], ["beanie", 1.4]], fit: [0.4, 0.75] },
  boho: { tops: [["robe", 3], ["dress", 3], ["tank", 1], ["long", 1.4]], bottoms: [["skirt", 4], ["trousers", 2]], shoes: [["sandal", 4], ["boot", 1]], hats: [["none", 6], ["sunhat", 2]], fit: [0.55, 1] },
  preppy: { tops: [["polo", 5], ["long", 2], ["blazer", 1.4], ["dress", 1]], bottoms: [["trousers", 4], ["shorts", 2], ["skirt", 1.6]], shoes: [["loafer", 4], ["sneaker", 2]] as Weighted<Shoe>, hats: [["none", 8], ["cap", 1]], fit: [0.2, 0.45] },
};

const FACE_HAIRS: readonly (readonly [FaceHair, number])[] = [["none", 6], ["stubble", 2], ["moustache", 0.6], ["beard", 1.6]];

/** The height everybody is drawn at, before `size`. */
const TALL = 1.72;

const AGES: readonly (readonly [Age, number])[] = [["toddler", 0.7], ["child", 2.2], ["teen", 1.6], ["adult", 8], ["elder", 2]];

interface Stage { readonly tall: readonly [number, number]; readonly heads: readonly [number, number]; readonly legs: readonly [number, number]; readonly narrow: number }

/** Heads hardly vary, in a whole body's terms: `heads` is how many of them tall a person stands, so nobody short gets a huge one, nor anybody tall a tiny one. */
const STAGES: Readonly<Record<Age, Stage>> = {
  toddler: { tall: [0.8, 0.98], heads: [5.3, 5.6], legs: [0.36, 0.39], narrow: 0.84 },
  child: { tall: [1.05, 1.4], heads: [6.2, 6.8], legs: [0.42, 0.45], narrow: 0.84 },
  teen: { tall: [1.46, 1.76], heads: [7.2, 7.7], legs: [0.46, 0.49], narrow: 0.92 },
  adult: { tall: [1.5, 1.9], heads: [7.6, 8.2], legs: [0.44, 0.49], narrow: 1 },
  elder: { tall: [1.46, 1.84], heads: [7.5, 8.1], legs: [0.44, 0.47], narrow: 1 },
};

interface ShapeRow {
  readonly girth: readonly [number, number];
  readonly shoulder: number;
  readonly waist: number;
  readonly hip: number;
  readonly limb: number;
  readonly belly: number;
  readonly bust: number;
}

const SHAPES: Readonly<Record<Shape, ShapeRow>> = {
  slim: { girth: [0.76, 0.86], shoulder: 0.92, waist: 0.92, hip: 0.94, limb: 0.84, belly: 0, bust: 0.7 },
  lean: { girth: [0.84, 0.94], shoulder: 0.97, waist: 0.9, hip: 0.96, limb: 0.94, belly: 0, bust: 0.85 },
  average: { girth: [0.94, 1.08], shoulder: 1, waist: 1, hip: 1, limb: 1, belly: 0, bust: 1 },
  athletic: { girth: [0.96, 1.06], shoulder: 1.18, waist: 0.86, hip: 0.96, limb: 1.08, belly: 0, bust: 0.95 },
  muscular: { girth: [1, 1.08], shoulder: 1.28, waist: 0.84, hip: 0.98, limb: 1.2, belly: 0, bust: 1 },
  stocky: { girth: [1.08, 1.18], shoulder: 1.1, waist: 1.08, hip: 1.06, limb: 1.14, belly: 0.03, bust: 1 },
  curvy: { girth: [1.04, 1.14], shoulder: 0.96, waist: 0.8, hip: 1.2, limb: 1.1, belly: 0, bust: 1.35 },
  heavy: { girth: [1.2, 1.32], shoulder: 1.04, waist: 1.04, hip: 1.1, limb: 1.22, belly: 0.05, bust: 1.15 },
  large: { girth: [1.34, 1.46], shoulder: 1.08, waist: 1.08, hip: 1.14, limb: 1.36, belly: 0.09, bust: 1.25 },
};

const GROWN_SHAPES: readonly (readonly [Shape, number])[] = [["slim", 2], ["lean", 2], ["average", 4], ["athletic", 2], ["muscular", 1], ["stocky", 2], ["curvy", 2], ["heavy", 2], ["large", 1]];
const YOUNG_SHAPES: readonly (readonly [Shape, number])[] = [["slim", 2], ["average", 5], ["stocky", 2], ["heavy", 1]];

function shapeOf(rand: () => number, sex: Sex, grown: number): Shape {
  const shape = weighted(rand, grown === 1 ? GROWN_SHAPES : YOUNG_SHAPES);
  return shape === "curvy" && sex === "male" ? "stocky" : shape;
}

function buildOf(rand: () => number): Build {
  const age = weighted(rand, AGES);
  const sex: Sex = rand() < 0.5 ? "female" : "male";
  const grown = age === "toddler" || age === "child" ? 0 : age === "teen" ? 0.7 : 1;
  const stage = STAGES[age];
  const height = bell(rand, stage.tall[0], stage.tall[1]) * (1 + (sex === "male" ? 0.035 : -0.035) * grown) * (1 + mix(-0.06, 0.07, rand()) * grown);
  const size = height / TALL;
  const shape = shapeOf(rand, sex, grown);
  const row = SHAPES[shape];
  const girth = mix(row.girth[0], row.girth[1], rand());
  const frame = rand();
  return {
    age,
    sex,
    height,
    size,
    stoop: age === "elder" ? mix(0.06, 0.2, rand()) : 0,
    shape,
    girth,
    waist: row.waist,
    belly: row.belly,
    limb: row.limb,
    bust: Math.min(2, row.bust * (1 + mix(-0.45, 0.85, rand()) * grown)),
    rear: 1 + mix(-0.5, 1, rand()) * grown,
    foot: mix(0.9, 1.12, rand()) * (1 + (sex === "male" ? 0.05 : -0.05) * grown),
    shoulder: mix(0.168, 0.192, frame) * row.shoulder * stage.narrow * mix(0.95, 1.08, girth - 0.78) * (1 + (sex === "male" ? 0.06 : -0.08) * grown),
    hip: mix(0.185, 0.155, frame * rand()) * row.hip * stage.narrow * mix(0.94, 1.16, girth - 0.78) * (1 + (sex === "male" ? -0.08 : 0.1) * grown),
    head: (TALL / (2 * mix(stage.heads[0], stage.heads[1], rand()))) * (1 + Math.max(0, girth - 1) * 0.12),
    legs: mix(stage.legs[0], stage.legs[1], rand()),
    chest: mix(0.01, 0.04, rand()),
  };
}

/** How grown a face is, and how young: everything that differs by sex goes by the first, so a boy's and a girl's are one. */
const MATURITY: Readonly<Record<Age, number>> = { toddler: 0, child: 0, teen: 0.5, adult: 1, elder: 1 };
const YOUTH: Readonly<Record<Age, number>> = { toddler: 1, child: 0.72, teen: 0.2, adult: 0, elder: 0 };

/** How big a nose stands at each age, as a share of a grown one. */
const NOSE_BY: Readonly<Record<Age, number>> = { toddler: 0.68, child: 0.72, teen: 0.84, adult: 1, elder: 1 };
const CHILD_EYE: Partial<Record<Age, number>> = { toddler: 0.145, child: 0.14 };

const faceHairOf = (rand: () => number, age: Age, sex: Sex): FaceHair => (sex === "male" && (age === "adult" || age === "elder") ? weighted(rand, FACE_HAIRS) : "none");

/** Each number in its place, for a seed's hair and clothes come on after these in the same stream: what is new about a face has a stream of its own, in `faceFor`. */
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

/** What a face's outline leans to, on the age's skull: shares of a head's radius from the temple down, how much longer it runs, how square it is across. */
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

/** Which outlines go with what: anyone can have any of them but a child, whose face is not yet any of the hard ones, and is the same for a boy and a girl. */
const OUTLINE_SHARES: Readonly<Record<Sex | "young", Weighted<OutlineName>>> = {
  male: [["oval", 2], ["round", 1.4], ["square", 3], ["heart", 0.6], ["diamond", 1.6], ["oblong", 2], ["pear", 1.2]],
  female: [["oval", 3], ["round", 2], ["square", 0.8], ["heart", 2.6], ["diamond", 1.6], ["oblong", 1], ["pear", 0.6]],
  young: [["oval", 2], ["round", 3], ["heart", 1.4], ["pear", 0.6]],
};

/** What can stand out in a face, and what it does: at most two to a person, none of them against another, and none on anyone younger than `from`. */
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

/** Three soft leanings, handed down and never named: each moves a little of the face, and any value is open to anyone. */
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

/** Paint, and how much: most grown women, a little or a lot, and now and then a man with a line round his eyes. Only grown people; never a child or a teen. */
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

/** A face finished: all that is new about it comes from one stream of its own, after the skin is known, so a seed's hair and clothes stay as they were. */
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

/** Two hex colours, `k` of the way from the first to the second. */
function blend(a: string, b: string, k: number): string {
  const at = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number): string => Math.round(mix(at(a, i), at(b, i), k)).toString(16).padStart(2, "0");
  return `#${part(0)}${part(1)}${part(2)}`;
}

/** Colours that go together: a main colour, a muted second, and one small loud one. */
function clothesColours(rand: () => number): Record<string, string> {
  const hue = rand();
  const loud = rand() < 0.3;
  const top = hsl(hue, loud ? mix(0.45, 0.7, rand()) : mix(0.08, 0.34, rand()), mix(0.26, 0.66, rand()));
  const blue = rand() < 0.55;
  const bottom = blue ? hsl(mix(0.58, 0.62, rand()), mix(0.26, 0.42, rand()), mix(0.2, 0.42, rand())) : hsl(hue + 0.5, mix(0.04, 0.18, rand()), mix(0.16, 0.5, rand()));
  return { top, bottom, trim: hsl(hue + mix(0.3, 0.7, rand()), mix(0.4, 0.7, rand()), mix(0.36, 0.76, rand())), shoe: hsl(rand(), mix(0, 0.26, rand()), mix(0.14, 0.72, rand())), sole: hsl(0.1, 0.1, mix(0.2, 0.86, rand())) };
}

const SHADES: Readonly<Record<Genre, (rand: () => number) => Readonly<Record<string, string>>>> = {
  casual: () => ({}),
  street: (rand) => ({ top: hsl(rand(), 0.14, mix(0.2, 0.5, rand())), bottom: hsl(0.1, 0.1, mix(0.22, 0.42, rand())), trim: hsl(rand(), 0.8, 0.55), sole: "#e8e6e0" }),
  formal: (rand) => { const suit = hsl(mix(0.58, 0.68, rand()), 0.22, mix(0.12, 0.26, rand())); return { top: suit, bottom: suit, trim: "#ece8e0", shoe: "#1c1614", sole: "#141010" }; },
  sport: (rand) => ({ top: hsl(rand(), 0.72, 0.5), bottom: hsl(0.62, 0.2, 0.16), trim: "#f0f0ee", shoe: "#e8e6e2", sole: "#ffffff" }),
  goth: (rand) => ({ top: "#1a1720", bottom: "#141216", trim: hsl(mix(0.95, 1, rand()) % 1, 0.6, 0.3), shoe: "#121014", sole: "#0c0a0e" }),
  work: (rand) => ({ top: hsl(mix(0.09, 0.26, rand()), 0.3, mix(0.26, 0.42, rand())), bottom: hsl(mix(0.58, 0.62, rand()), 0.3, mix(0.2, 0.3, rand())), trim: "#d8782a", shoe: "#5a3c24", sole: "#241810" }),
  boho: (rand) => ({ top: hsl(mix(0.42, 0.6, rand()), 0.34, mix(0.3, 0.46, rand())), bottom: hsl(mix(0.04, 0.5, rand()), 0.3, mix(0.3, 0.5, rand())), trim: hsl(mix(0.45, 0.55, rand()), 0.4, 0.5), shoe: "#8a5a34" }),
  preppy: (rand) => ({ top: hsl(rand(), 0.42, mix(0.68, 0.82, rand())), bottom: hsl(0.11, 0.3, mix(0.6, 0.72, rand())), trim: "#28386a", shoe: "#6a3c22", sole: "#2a1a10" }),
};

/** How much light a colour gives back, as the eye weighs it, 0 to 1. */
const glowOf = (hex: string): number => [[1, 0.2126], [3, 0.7152], [5, 0.0722]].reduce((sum, [i = 1, k = 0]) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return sum + k * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}, 0);

/** How deep a skin is, 0 from a mid brown up to 1: a multiply hardly shows on it, so whatever draws a feature must work harder. */
const deepOf = (skin: string): number => clamp((0.2 - glowOf(skin)) / 0.16, 0, 1);

/** Hair the same light as the skin reads as a bald head, so on fair skin it goes darker. On dark skin dark hair is left be: a rim of light parts it from the face. */
function apart(hair: string, skin: string): string {
  const light = (hex: string): number => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0) / 765;
  if (Math.abs(light(hair) - light(skin)) > 0.28 || light(skin) <= 0.3) return hair;
  return blend(hair, "#2a1a12", 0.45);
}

/** Trousers the same light as the shirt read as one sack: they go darker, or lighter under a dark top. */
function parted(bottom: string, top: string): string {
  const light = (hex: string): number => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0) / 765;
  if (Math.abs(light(bottom) - light(top)) > 0.15) return bottom;
  return blend(bottom, light(top) > 0.3 ? "#14141c" : "#a8a49c", 0.5);
}

/** A tone of hair from one roll: the darker it is, the likelier on darker skin, and any of them can be had by anyone. */
function hairTone(roll: number, deep: number): string {
  const low = HAIR_TONES.slice(0, 5), high = HAIR_TONES.slice(5), dark = mix(low.length / HAIR_TONES.length, 0.93, deep);
  const [list, at] = roll < dark ? [low, roll / dark] : [high, (roll - dark) / (1 - dark)];
  return list[Math.floor(at * list.length)] ?? "#14100e";
}

/** A brow goes with its hair, as far as it can and still be a brow: never so near the skin that light takes it off the face, nor so far from it that it is a bar. */
function browOn(skin: string, hair: string): string {
  const brow = blend(hair, "#2a1a16", 0.3), own = glowOf(brow), most = glowOf(skin) * 0.4, least = glowOf(skin) * 0.2;
  if (own > most) return blend(brow, "#120a07", 1 - Math.sqrt(most / own));
  return own < least ? blend(brow, skin, (1 - Math.sqrt(own / least)) * 0.8) : brow;
}

/** The colours of a brow, a lip and a flush, from what they lie on. */
function faceColours(skin: string, hair: string, wash: string): Record<string, string> {
  const deep = deepOf(skin);
  return {
    brow: browOn(skin, hair),
    beard: blend(hair, "#1a100b", mix(0.25, 0.6, deep)),
    lip: blend(skin, blend(wash, "#8c464c", deep), mix(0.58, 0.54, deep)),
    crease: blend(skin, "#3a1a16", mix(0.3, 0.6, deep)),
    flush: blend(skin, deep > 0.3 ? "#a8402c" : "#e0705c", 0.045),
    stub: blend(skin, hair, 0.22),
  };
}

function paletteOf(rand: () => number, skin: string, age: Age, iris: string, genre: Genre): Record<string, string> {
  const dyed = rand() < 0.04, roll = rand();
  const natural = dyed ? LOUD_HAIR[Math.floor(roll * LOUD_HAIR.length)] ?? "#3a6ad8" : hairTone(roll, deepOf(skin));
  const hair = blend(apart(age === "elder" ? pick(rand, GREY_HAIR) : natural, skin), "#4c4650", 0.16);
  return { skin, hair, ...faceColours(skin, hair, hsl(mix(0.97, 1.02, rand()) % 1, 0.4, 0.42)), dark: "#2a1a16", eye: iris, ...clothesColours(rand), ...SHADES[genre](rand) };
}

const COILED: readonly HairStyle[] = ["curly", "afro", "locs", "braids"];
const FINE: readonly HairStyle[] = ["long", "side", "wavy"];

/** Hair as a sex wears it, on this skin: the same roll for everyone, so a seed keeps its style, and only fine straight hair may turn to coils, likelier the darker the skin. Every style stays open to all. */
function hairOn(seed: number, sex: Sex, deep: number, roll: number): HairStyle {
  const chosen = weighted(() => roll, HAIRS[sex]);
  if (!FINE.includes(chosen) || hashed(seed, 907) >= deep * 0.7) return chosen;
  return weighted(() => hashed(seed, 911), HAIRS[sex].filter(([style]) => COILED.includes(style)));
}

/** The hats a head with none might wear after all, by how likely each is. A child's are only soft ones. */
const SPARE_HATS: Readonly<Record<Genre, Weighted<Hat>>> = {
  casual: [["bucket", 3], ["pompom", 1.6], ["visor", 1.4], ["flatcap", 1], ["beret", 0.8], ["bandana", 1]],
  street: [["bucket", 3], ["bandana", 2.4], ["pompom", 1], ["headwrap", 1.4]],
  formal: [["bowler", 2], ["flatcap", 2], ["beret", 1.4], ["tophat", 0.6]],
  sport: [["visor", 4], ["bandana", 2], ["bucket", 1]],
  goth: [["beret", 2], ["tophat", 1.4], ["bandana", 1], ["headwrap", 1]],
  work: [["hardhat", 4], ["flatcap", 2], ["bandana", 2]],
  boho: [["headwrap", 3], ["bucket", 1.6], ["beret", 1.4], ["bandana", 1.4]],
  preppy: [["visor", 2], ["flatcap", 2], ["beret", 1.4], ["bowler", 0.6]],
};

const SOFT_HATS: Weighted<Hat> = [["bucket", 3], ["pompom", 3], ["visor", 1]];

/** Whether a build is a child's. */
const childish = (build: Build): boolean => build.age === "toddler" || build.age === "child";

/** A bare head's chance of a hat from the wider rack, from a stream of its own. */
function hatted(seed: number, build: Build, outfit: Outfit): Outfit {
  const r = streamOf(seed, 0x68617473);
  if (outfit.hat !== "none" || outfit.costume !== "none" || r() > 0.26) return outfit;
  return { ...outfit, hat: weighted(r, childish(build) ? SOFT_HATS : SPARE_HATS[outfit.genre]) };
}

/** One of `list`, or the first if `chance` misses. */
const someOf = <T>(r: () => number, chance: number, list: readonly T[]): T => { const hit = r(), pick = r(); return list[hit < chance ? 1 + Math.floor(pick * (list.length - 1)) : 0] as T; };

/** How likely each is to wear each. */
const GEAR_ODDS = { child: { ears: 0, neck: 0, hair: 0.5 }, woman: { ears: 0.55, neck: 0.3, hair: 0.3 }, man: { ears: 0.14, neck: 0.12, hair: 0.05 } } as const;

/** What a person has on them. A child has clips, a bow and maybe glasses, and nothing pierced; a teen's ears may be. */
function gearOf(seed: number, build: Build, outfit: Outfit): Gear {
  const r = streamOf(seed, 0x67656172), child = childish(build), grown = !child && build.age !== "teen", bare = outfit.hat === "none";
  const odds = GEAR_ODDS[child ? "child" : build.sex === "female" ? "woman" : "man"];
  return {
    glasses: someOf<Gear["glasses"]>(r, build.age === "elder" ? 0.5 : 0.2, child ? ["none", "clear", "round"] : ["none", "clear", "round", "cat", "sun"]),
    ears: someOf<Gear["ears"]>(r, odds.ears, grown ? ["none", "stud", "hoop", "drop"] : ["none", "stud", "hoop"]),
    nose: someOf<Gear["nose"]>(r, grown ? 0.07 : 0, ["none", "stud", "ring"]),
    neck: someOf<Gear["neck"]>(r, odds.neck, ["none", "chain", "pendant"]),
    hair: someOf<Gear["hair"]>(r, bare ? odds.hair : 0, ["none", "clip", "clips", "bow", "band"]),
    phones: !child && bare && r() < 0.05,
  };
}

/** The little metal and glass a person wears, and a bright colour for what is in their hair. */
function gearColours(seed: number): Record<string, string> {
  const r = streamOf(seed, 0x6d65746c), bright = ["#d8423c", "#e8b23a", "#3a7ad8", "#e86aa8", "#46b078", "#f4f0e8", "#7a4ac8"];
  return { metal: r() < 0.5 ? "#d8b35a" : "#c8c8cc", lens: r() < 0.5 ? "#16181c" : "#2c2418", clip: bright[Math.floor(r() * bright.length)] ?? "#d8423c" };
}

/** The shirt in a jacket's front: pale under a dark one and dark under a pale, never a bright. */
const shirtUnder = (top: string): string => (glowOf(top) > 0.4 ? "#3a4252" : "#ece8e0");

/** The person a seed is, always the same one. */
export function personOf(seed: number, weather: Weather = "mild", costume?: Costume): Person {
  const rand = streamOf(seed, 0x70656f70);
  const build = buildOf(rand);
  const rolled = faceOf(rand, build.age, build.sex);
  const hairRoll = rand();
  const base = outfitOf(rand, build);
  const skin = skinTone(rand);
  const face = faceFor(seed, rolled, build, skin);
  const chosen = hairOn(seed, build.sex, deepOf(skin), hairRoll);
  const hair = chosen === "bald" && (build.sex === "female" || build.age === "toddler" || build.age === "child" || build.age === "teen") ? "crop" : chosen;
  const palette = paletteOf(rand, skin, build.age, face.iris, base.genre);
  const day = streamOf(seed, 0x77656174);
  const outfit = hatted(seed, build, inCostume(day, build, dressedFor(day, build, base, weather), weather, costume));
  const big = outfit.costume === "fursuit" ? { ...build, head: build.head * 1.16 } : build;
  const worn = { ...palette, ...colourFor(day, outfit), ...gearColours(seed) };
  return { seed, build: big, face, hair: outfit.costume === "fursuit" ? "bald" : hair, outfit, gear: gearOf(seed, build, outfit), palette: { ...worn, shirt: shirtUnder(worn.top ?? "#777777"), bottom: parted(worn.bottom ?? "#333333", worn.top ?? "#777777") }, gait: gaitOf(streamOf(seed, 0x67616974), build) };
}

/** A hand on the move, how closed: a fist, loose, cupped, or flat as a blade. */
const HANDS: Weighted<number> = [[1.5, 3], [0.98, 3], [0.56, 2.4], [0.18, 2]];

/** What an age does to anyone's stride. */
const AGE_GAIT: Readonly<Record<Age, { readonly cadence: number; readonly stride: number; readonly swing: number; readonly bounce: number; readonly flare: number; readonly lean: number }>> = {
  toddler: { cadence: 1.26, stride: 0.8, swing: 0.8, bounce: 1.2, flare: 0.14, lean: 0.03 },
  child: { cadence: 1.12, stride: 0.95, swing: 1.1, bounce: 1.25, flare: 0.03, lean: 0 },
  teen: { cadence: 1.03, stride: 1.02, swing: 1, bounce: 1.1, flare: 0, lean: 0 },
  adult: { cadence: 1, stride: 1, swing: 1, bounce: 1, flare: 0, lean: 0 },
  elder: { cadence: 0.84, stride: 0.72, swing: 0.68, bounce: 0.45, flare: 0.03, lean: 0.05 },
};

/** A person's own way of moving, from a stream of its own so it changes nothing of how they look. */
function gaitOf(rand: () => number, build: Build): Gait {
  const age = AGE_GAIT[build.age], heavy = clamp(build.girth - 1, 0, 1);
  const hand = weighted(rand, HANDS), other = rand() < 0.3 ? weighted(rand, HANDS) : hand, off = mix(-0.08, 0.08, rand());
  const easy = mix(0.2, 0.62, rand()), elbow = mix(0.95, 1.95, rand()), odd = mix(-0.2, 0.2, rand());
  const lazy = rand() < 0.3 ? (rand() < 0.5 ? -1 : 1) : 0;
  return {
    cadence: mix(0.93, 1.09, rand()) * age.cadence * (build.sex === "female" ? 1.04 : 1),
    stride: mix(0.72, 1.24, rand()) * age.stride * (1 - heavy * 0.25),
    kick: mix(0.72, 1.28, rand()) * Math.sqrt(age.stride),
    swing: mix(0.55, 1.5, rand()) * age.swing,
    running: [hand + off, other - off],
    walking: [easy, easy + mix(-0.14, 0.14, rand())],
    pump: [elbow + odd, elbow - odd],
    carry: mix(-0.22, 0.25, rand()),
    across: mix(0, 0.62, rand()) ** 2 * 2.2,
    wide: mix(0.72, 1.32, rand()) * (1 + heavy * 0.2),
    offset: rand() * TAU,
    dance: Math.floor(rand() * 4),
    idle: Math.floor(rand() * 3),
    flare: mix(0, 0.15, rand()) ** 1.4 * 2.2 + age.flare,
    lazy,
    lazyBy: mix(0.5, 0.85, rand()),
    lean: mix(-0.06, 0.14, rand()) + age.lean,
    bounce: mix(0.65, 1.3, rand()) * age.bounce * (1 - heavy * 0.25),
    sway: mix(0.6, 1.5, rand()),
    twist: mix(0.7, 1.4, rand()),
    turned: mix(0.02, 0.2, rand()),
  };
}

/** Skirts and dresses mostly to women, and now and then to anyone: a choice, not a rule. */
const worn = <T extends string>(list: Weighted<T>, sex: Sex): Weighted<T> => list.map(([item, share]) => [item, sex === "male" && SKIRTED.includes(item) ? share * 0.06 : share]);

const SKIRTED: readonly string[] = ["dress", "skirt", "robe"];

const FOR_WEATHER: Readonly<Record<Exclude<Weather, "mild" | "beach">, { readonly tops: Weighted<Top>; readonly shoes: Weighted<Shoe>; readonly hats: Weighted<Hat>; readonly carry: number }>> = {
  rain: { tops: [["raincoat", 5], ["hoodie", 2.4], ["coat", 1.6], ["jacket", 1.6]], shoes: [["boot", 4], ["sneaker", 1]], hats: [["hood", 4], ["none", 3], ["cap", 1]], carry: 0.45 },
  cold: { tops: [["puffer", 4], ["coat", 3], ["hoodie", 2], ["jacket", 2]], shoes: [["boot", 5], ["sneaker", 1]], hats: [["beanie", 4], ["none", 3], ["hood", 1]], carry: 0 },
  hot: { tops: [["tee", 4], ["tank", 4], ["dress", 2], ["polo", 1]], shoes: [["sandal", 3], ["sneaker", 2]], hats: [["none", 5], ["sunhat", 2], ["cap", 2]], carry: 0 },
};

/** What a person wears at the beach: nothing here is cut for a child but a tee and swim shorts. */
function beachOf(rand: () => number, build: Build, base: Outfit): Outfit {
  const grown = build.age === "adult" || build.age === "elder";
  const female = build.sex === "female";
  const cut = rand();
  const top: Top = !grown ? "tee" : !female ? "bare" : cut < 0.34 ? "swimsuit" : cut < 0.67 ? "bikini" : "string";
  return { ...base, top, bottom: top === "string" || top === "swimsuit" ? "briefs" : "swim", shoe: "sandal", hat: rand() < 0.3 ? "sunhat" : "none", stripes: 0, fit: 0.1 };
}

const legsFor = (rand: () => number, bottom: Bottom, weather: Weather): Bottom => {
  if (weather === "hot") return rand() < 0.7 ? "shorts" : "skirt";
  return bottom === "shorts" || bottom === "skirt" ? "jeans" : bottom;
};

/** A person's clothes for the day: the same person, what suits the weather. */
function dressedFor(rand: () => number, build: Build, base: Outfit, weather: Weather): Outfit {
  if (weather === "mild") return base;
  if (weather === "beach") return beachOf(rand, build, base);
  const w = FOR_WEATHER[weather];
  const top = weighted(rand, w.tops);
  const legs = legsFor(rand, base.bottom, weather);
  const hat = weighted(rand, w.hats);
  const hooded = top === "raincoat" || top === "hoodie" || top === "puffer";
  const small = build.age === "toddler";
  return { ...base, top, bottom: legs, shoe: weighted(rand, w.shoes), hat: hat === "hood" && !hooded ? "none" : hat, carry: !small && rand() < w.carry ? "umbrella" : "none", stripes: 0 };
}

const COSTUMES: Readonly<Record<Exclude<Costume, "none">, Pick<Outfit, "top" | "bottom" | "shoe" | "hat" | "stripes" | "fit">>> = {
  suit: { top: "blazer", bottom: "trousers", shoe: "loafer", hat: "none", stripes: 0, fit: 0.2 },
  firefighter: { top: "jacket", bottom: "trousers", shoe: "boot", hat: "helmet", stripes: 2, fit: 0.6 },
  police: { top: "long", bottom: "trousers", shoe: "boot", hat: "peaked", stripes: 0, fit: 0.25 },
  cowboy: { top: "long", bottom: "jeans", shoe: "boot", hat: "stetson", stripes: 0, fit: 0.3 },
  fursuit: { top: "bare", bottom: "swim", shoe: "sandal", hat: "none", stripes: 0, fit: 0 },
  latex: { top: "long", bottom: "leggings", shoe: "boot", hat: "none", stripes: 0, fit: 0 },
};
const COSTUME_SHARE: Weighted<Exclude<Costume, "none">> = [["suit", 4], ["police", 1], ["firefighter", 1], ["cowboy", 1], ["fursuit", 0.6], ["latex", 0.3]];
const FUR = ["#c87a3a", "#8a8a92", "#3a3a44", "#e8e0d4", "#4a78c8", "#a848a0", "#3aa888"] as const;

/** A job or getup for those of age: asked for, or now and then on a mild day. */
function inCostume(rand: () => number, build: Build, outfit: Outfit, weather: Weather, asked?: Costume): Outfit {
  if (build.age !== "adult" && build.age !== "elder" && build.age !== "teen") return outfit;
  const costume = asked ?? (weather === "mild" && rand() < 0.08 ? weighted(rand, COSTUME_SHARE) : "none");
  if (costume === "none" || (costume === "latex" && build.age === "teen")) return outfit;
  return { ...outfit, ...COSTUMES[costume], carry: "none", costume };
}

const RAINCOATS = ["#d8a820", "#c83a2a", "#2a5a8a", "#2f6a4a", "#e0d8c4"] as const;
const JOB_COLOURS: Partial<Record<Costume, (rand: () => number) => Record<string, string>>> = {
  suit: (rand) => ({ top: pick(rand, ["#20242e", "#2c2c30", "#343a44"]), bottom: pick(rand, ["#20242e", "#2c2c30"]), trim: "#e8e6e0", dark: "#7a2030", shoe: "#1a1412" }),
  firefighter: () => ({ top: "#57503c", bottom: "#57503c", trim: "#d8c030", shoe: "#141210", sole: "#141210" }),
  police: () => ({ top: "#1e2a44", bottom: "#161e30", trim: "#14182a", badge: "#d8b840", shoe: "#101014", sole: "#101014" }),
  latex: (rand) => ({ top: "#101014", bottom: "#101014", shoe: "#101014", sole: "#101014", trim: pick(rand, ["#101014", "#8a1020", "#402060"]) }),
  cowboy: (rand) => ({ top: pick(rand, ["#8a3a2a", "#6a7a8a", "#3a6a6a"]), bottom: "#2e4468", trim: "#6a4426", shoe: "#5a3a20", sole: "#3a2614" }),
};

/** Colours only the day's clothes want: a bright raincoat, a loud swimsuit, an umbrella, a pelt. */
function colourFor(rand: () => number, outfit: Outfit): Record<string, string> {
  if (outfit.costume === "fursuit") { const fur = pick(rand, FUR); return { skin: fur, belly: blend(fur, "#f4ece0", 0.66), bottom: fur, shoe: fur, sole: fur, trim: fur, lip: fur, brow: blend(fur, "#1a1412", 0.5) }; }
  const job = JOB_COLOURS[outfit.costume]?.(rand) ?? {};
  const loud = hsl(0.2 + rand() * 0.75, 0.62, 0.48);  // (Never near a skin's hue, so a swimsuit never reads as bare.)
  const swim = outfit.bottom === "swim" || outfit.bottom === "briefs" ? { bottom: loud, top: outfit.top === "tee" ? hsl(rand(), 0.4, 0.6) : loud } : {};
  const coat = outfit.top === "raincoat" && outfit.costume === "none" ? { top: pick(rand, RAINCOATS) } : {};
  return { ...swim, ...coat, brolly: hsl(rand(), 0.5, 0.34), ...job };
}

function outfitOf(rand: () => number, build: Build): Outfit {
  const small = build.age === "toddler" || build.age === "child";
  const genre = small ? "casual" : weighted(rand, GENRES);
  const w = WARDROBES[genre];
  return {
    genre,
    fit: mix(w.fit[0], w.fit[1], rand()),
    top: weighted(rand, worn(w.tops, build.sex)),
    bottom: weighted(rand, worn(w.bottoms, build.sex)),
    shoe: weighted(rand, w.shoes),
    hat: weighted(rand, w.hats),
    carry: "none",
    costume: "none",
    stripes: rand() < 0.16 ? 2 : 0,
  };
}

// ---------------------------------------------------------------- the skeleton

export type Action = "rest" | "seated" | "stand" | "idle" | "walk" | "power" | "jog" | "run" | "sprint" | "jump" | "sit" | "crouch" | "wave" | "clap" | "laugh" | "cheer" | "dance" | "shrug" | "bow" | "nod" | "fold" | "hips" | "think" | "talk" | "stretch";
export const ACTIONS: readonly Action[] = ["stand", "idle", "walk", "power", "jog", "run", "sprint", "jump", "sit", "crouch", "wave", "clap", "laugh", "cheer", "dance", "shrug", "bow", "nod", "fold", "hips", "think", "talk", "stretch"];

/** How a mesh is built: arms and legs held clear of the body, so no surface joins what must part. */
const REST: Swing = { thigh: 0, knee: 0.02, upper: 0, fore: 0, out: 30, splay: 0.17 };

interface Leg { readonly hip: Vec; readonly knee: Vec; readonly ankle: Vec; readonly toe: Vec; /** The toes' ends: they stay flat on the ground as the heel comes up. */ readonly end: Vec }
interface Arm { /** Where the thumb ends: in over the palm as the hand shuts. */ readonly thumb: Vec; readonly shoulder: Vec; readonly elbow: Vec; readonly wrist: Vec; readonly hand: Vec; /** Where the fingers end: bent in toward the palm as far as the hand is closed. */ readonly tip: Vec; /** Which way the palm is turned to face. */ readonly faces: Vec; /** How far the wrist is bent toward the palm. */ readonly flex: number; /** The line across the knuckles. */ readonly knuckles: Vec; /** And where their last joints end. */ readonly nail: Vec }

/** Where the bones are, on the frame of a person facing +z: everything drawn hangs on this. */
export interface Skeleton {
  /** How far the shoulders have turned against the hips. */
  readonly spin: number;
  /** How far the head has turned from straight ahead, radians. */
  readonly turn: number;
  readonly pelvis: Vec;
  readonly waist: Vec;
  readonly chest: Vec;
  readonly neck: Vec;
  readonly head: Vec;
  readonly left: { readonly leg: Leg; readonly arm: Arm };
  readonly right: { readonly leg: Leg; readonly arm: Arm };
}

/** A leg's and an arm's angles at one moment, radians forward of hanging straight down. */
interface Swing {
  /** How far a leg stands out from the body. */
  readonly splay?: number; readonly thigh: number; readonly knee: number; readonly upper: number; readonly fore: number; readonly out: number; /** How far the fingers are closed, radians at the knuckles. */ readonly curl?: number; /** Which way the palm faces, where it is not in toward the body. */ readonly palm?: Vec | undefined; /** How far the toes are raised past what the leg gives them. */ readonly pitch?: number; /** How far the toes turn out. */ readonly turned?: number; /** How far the forearm comes in across the body. */ readonly across?: number; /** Where the wrist is to go, from the chest: out to its own side, up, forward. The arm finds its own way there. */ readonly reach?: Vec | undefined; /** How far the wrist bends toward the palm. */ readonly flex?: number }

/** What the trunk and head are doing, all but the height of the hips optional. */
interface Body {
  readonly hips: number;
  /** Forward, radians; how much more the upper back bends; over to the left or right. */
  readonly lean?: number; readonly curve?: number; readonly side?: number;
  /** How far the shoulders turn, metres at the joint; the hips to one side; the swinging hip's dip. */
  readonly twist?: number; readonly shift?: number; readonly drop?: number;
  /** The head: down, over to a side, and round. */
  readonly nod?: number; readonly tilt?: number; readonly turn?: number;
  readonly breath?: number;
  /** How far apart the feet are, of the hips' width. */
  readonly wide?: number;
  /** Each shoulder lifted, metres. */
  readonly shrug?: readonly [number, number];
}

/** One moment of a body: everything a motion has to say. */
interface Pose { readonly left: Swing; readonly right: Swing; readonly body: Body }

/** A way of moving: how many beats a second, how many heights a second it carries a body, and the pose at any point of a beat. Adding one is adding a line to `MOTIONS`. */
interface Motion { readonly beat: number; readonly pace?: number; /** Personal: taken at a person's own cadence, out of step with everyone else. */ readonly own?: boolean; readonly at: (p: Person, phase: number) => Pose }

const pitched = (a: number): Vec => [0, -Math.cos(a), Math.sin(a)];

const STILL: Swing = { thigh: 0.02, knee: 0.04, upper: 0.03, fore: 0.16, out: 0.05, curl: 0.32, flex: 0.1 };

/** One side's swing: `phase` runs a full stride, the other side half a stride behind. */
/** A jump's body, at `u` of the way through it: how deep the crouch, how high off the ground, how far the arms have swung up. */
function jumpAt(u: number): { readonly crouch: number; readonly high: number; readonly arms: number } {
  const ease = (v: number): number => { const k = clamp(v, 0, 1); return k * k * (3 - 2 * k); };
  const air = (u - 0.3) / 0.46;
  const flying = air > 0 && air < 1;
  const crouch = u < 0.3 ? ease(u / 0.2) * (1 - ease((u - 0.22) / 0.08)) : flying ? 0.28 * Math.sin(air * Math.PI) : (1 - ease((u - 0.82) / 0.18)) * 0.8 * ease((u - 0.76) / 0.06);
  return { crouch, high: flying ? 0.44 * 4 * air * (1 - air) : 0, arms: flying ? Math.sin(air * Math.PI) : -crouch };
}

const sideIndex = (side: number): 0 | 1 => (side < 0 ? 0 : 1);

const swungJump = (phase: number, offset: number): Swing => {
  const { crouch, arms } = jumpAt(((phase / TAU) % 1 + 1) % 1);
  return { thigh: 0.02 + 1.05 * crouch + offset, knee: 0.04 + 2 * crouch + 0.7 * Math.max(0, arms), upper: 0.03 + (arms > 0 ? 2.2 * arms : 0.8 * arms), fore: 0.3 + 0.2 * Math.abs(arms), out: 0.08 + 0.2 * Math.max(0, arms), curl: 0.6, flex: 0.1 };
};

const bump = (phase: number, at: number, wide: number): number => {
  const d = Math.atan2(Math.sin(phase - at), Math.cos(phase - at)) / wide;
  return Math.exp(-d * d);
};

/** How far an arm swings: most people favour one. */
const armSwing = (g: Gait, side: number): number => g.swing * (side === g.lazy ? g.lazyBy : 1);

/** Walking, one side at `phase`: the leg forward at the heel's strike, a knee that gives as it takes the weight, and that bends most just after the thigh has passed under the hip. The arms hang and swing a little further back than forward. */
function walkSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase), arm = armSwing(g, side);
  return { thigh: 0.05 + 0.38 * g.stride * s, knee: 0.05 + 0.76 * g.kick * bump(phase, 0.5, 0.75) + 0.2 * bump(phase, 2.1, 0.35), upper: -0.06 + g.carry * 0.3 - 0.4 * arm * s, fore: 0.26 + 0.16 * arm * (1 - s), out: 0.03 + g.flare * 0.4, pitch: 0.34 * bump(phase, 1.6, 0.4) - 0.5 * bump(phase, -1.35, 0.45), turned: g.turned, curl: g.walking[sideIndex(side)], flex: 0.14 };
}

/** Power walking: a walk's legs, long and quick and one foot always down, with a runner's arms. */
function powerSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase);
  return { ...walkSwing({ ...g, stride: g.stride * 1.28, kick: g.kick * 0.8 }, phase, side), upper: -0.12 + g.carry * 0.5 - 0.5 * armSwing(g, side) * s, fore: g.pump[sideIndex(side)], out: 0.08 + g.flare, across: g.across * 0.7, curl: g.running[sideIndex(side)], flex: 0.04 };
}

/** How far a knee shuts: past this the calf is through the thigh. */
const FOLD = 2.2;

/** Running at `effort`, one side at `phase`: pushed off behind at -π/2, the heel folds up under the hip, the knee drives through high, and the foot comes down bent-kneed under the body. */
function runSwing(g: Gait, phase: number, side: number, effort: number): Swing {
  const s = Math.sin(phase);
  return { thigh: 0.26 + (0.4 + 0.32 * effort) * g.stride * s, knee: Math.min(FOLD, 0.22 + (0.9 + 1.1 * effort) * g.kick * bump(phase, -0.32, 0.85) + 0.42 * bump(phase, 1.5, 0.55) + 0.4 * bump(phase, 2.7, 0.55)), upper: -0.16 + g.carry - (0.3 + 0.34 * effort) * armSwing(g, side) * s, fore: g.pump[sideIndex(side)], out: 0.06 + g.flare, across: g.across, turned: g.turned * 0.6, curl: g.running[sideIndex(side)], flex: 0.03 };
}

/** The weight going from foot to foot, and with it the pelvis, the spine and the shoulders: women's hips travel further than men's, whose shoulders turn more. */
function strideBody(p: Person, phase: number, hips: number, sway: number, lean: number): Body {
  const grown = GROWN_GAIT.includes(p.build.age), female = p.build.sex === "female" && grown, g = p.gait, c = Math.cos(phase);
  return { hips, lean, twist: 0.05 * (p.build.sex === "male" && grown ? 1.3 : 0.8) * g.twist * Math.sin(phase), shift: c * sway * (female ? 0.024 : 0.014) * g.sway, drop: c * Math.min(1, sway) * (female ? 0.016 : 0.01) * g.sway, wide: (female ? 0.46 : 0.6) * g.wide };
}

const opposed = (p: Person, phase: number, swing: (g: Gait, phase: number, side: number) => Swing): readonly [Swing, Swing] => [swing(p.gait, phase, -1), swing(p.gait, phase + Math.PI, 1)];

function walked(p: Person, phase: number, swing: (g: Gait, phase: number, side: number) => Swing, sway: number, lean: number): Pose {
  const [left, right] = opposed(p, phase, swing);
  return { left, right, body: strideBody(p, phase, feetDown(p, left, right), sway, lean) };
}

/** Both feet leave the ground between steps: the hips lowest over the foot and highest in the air. */
function ran(p: Person, phase: number, effort: number): Pose {
  const [left, right] = opposed(p, phase, (g, at, side) => runSwing(g, at, side, effort));
  return { left, right, body: strideBody(p, phase, standHips(p) - 0.13 + 0.05 * effort * p.gait.bounce * (1 - Math.cos(2 * phase)), 0.6, 0.07 + 0.15 * effort + p.gait.lean) };
}

/** A pose on the ground, the hips as high as the feet let them be. */
const grounded = (p: Person, left: Swing, right: Swing, body: Omit<Body, "hips"> = {}): Pose => ({ left, right, body: { hips: feetDown(p, left, right), ...body } });

/** The same on both sides. */
const held = (p: Person, swing: (side: number) => Swing, body: Omit<Body, "hips"> = {}): Pose => grounded(p, swing(-1), swing(1), body);

/** Knees giving in time, as anything to a beat. */
const bouncing = (phase: number, deep: number, side = 0): Swing => ({ ...STILL, thigh: 0.1 + deep * (1 + Math.cos(phase * 2 + side)), knee: 0.2 + deep * 2 * (1 + Math.cos(phase * 2 + side)) });

function danced(p: Person, phase: number): Pose {
  const s = Math.sin(phase), c = Math.cos(phase), flip = (side: number): number => (side < 0 ? 1 : -1);
  const body = { shift: 0.085 * s, side: -0.085 * s, turn: 0.2 * s, wide: 0.9, tilt: 0.06 * c };
  const moves: readonly ((side: number) => Swing)[] = [
    (side) => ({ ...bouncing(phase, 0.1), upper: 0.25 + 0.3 * s * flip(side), fore: 1.5, out: 0.2, curl: 1 }),
    (side) => ({ ...bouncing(phase, 0.08), reach: [0.26, 0.6 + 0.14 * s * flip(side), 0.12], palm: [-side, 0, 0.3], curl: 0.5 }),
    (side) => ({ ...bouncing(phase, 0.1, side), reach: [0.3 + 0.05 * s, -0.08 + 0.1 * c, 0.26], palm: [0, -1, 0], curl: 0.4, flex: 0.3 }),
    (side) => ({ ...bouncing(phase, 0.12), reach: s * flip(side) > 0 ? [0.34, 0.5, 0.2] : [0.12, -0.14, 0.26], curl: 0.9 }),
  ];
  return held(p, moves[p.gait.dance % (p.build.age === "adult" || p.build.age === "elder" ? 4 : 2)] ?? (() => STILL), { ...body, curve: 0.08 * c });
}

function laughed(p: Person, phase: number): Pose {
  const shake = Math.sin(phase * 3), k = Math.sin(phase);
  const left: Swing = { ...STILL, reach: [0.05, -0.22, 0.2], palm: [0, 0, -1], curl: 0.3 };
  const right: Swing = { ...STILL, reach: [0.1 + 0.02 * shake, -0.14, 0.2], palm: [0, 0, -1], curl: 0.3 };
  return grounded(p, left, right, { lean: -0.1 + 0.08 * k, curve: 0.1 + 0.2 * k, nod: -0.34 + 0.3 * k, shrug: [0.012 * shake, 0.012 * shake], tilt: 0.08, breath: 0.012 * shake });
}

const idled = (p: Person, phase: number): Pose => {
  const s = Math.sin(phase * 0.5), turn = Math.sin(phase * 0.21 + p.seed) * 0.42, hand = p.gait.idle === 1 ? { reach: [0.21, -0.2, 0.03] as Vec, palm: [-0.7, 0, -1] as Vec, curl: 0.3 } : {};
  return { left: { ...STILL, upper: 0.03 + 0.02 * Math.sin(phase - 1), fore: 0.16 + 0.03 * Math.sin(phase * 0.7), curl: 0.36 }, right: { ...STILL, upper: 0.03 + 0.02 * Math.sin(phase + 1), fore: 0.16 + 0.03 * Math.sin(phase * 0.7), curl: 0.36, ...hand }, body: { hips: feetDown(p, STILL, STILL), lean: s * 0.02, shift: s * 0.035, turn, breath: Math.sin(phase) * 0.014, side: -s * 0.02 } };
};

const bowed = (p: Person, phase: number): Pose => {
  const k = (1 - Math.cos(phase)) / 2;
  return held(p, () => ({ ...STILL, upper: 0.2 * k, curl: 0.3 }), { lean: 0.86 * k, curve: 0.2 * k, nod: 0.3 * k });
};

const MOTIONS: Readonly<Record<Action, Motion>> = {
  rest: { beat: 0, at: (p) => ({ left: REST, right: REST, body: { hips: feetDown(p, STILL, STILL) } }) },
  // (Sitting with the arms held out, so that nothing lies over what the cloth is doing: for looking at clothes.)
  seated: { beat: 0, at: (p) => { const sat = MOTIONS.sit.at(p, 0), arms = { upper: 0, fore: 0, out: REST.out, curl: 0, flex: 0 }; return { ...sat, left: { ...sat.left, ...arms }, right: { ...sat.right, ...arms } }; } },
  stand: { beat: 0.28, at: (p, phase) => held(p, () => STILL, { breath: Math.sin(phase) * 0.014 }) },
  idle: { beat: 0.28, at: idled },
  walk: { beat: 0.92, pace: 0.8, own: true, at: (p, phase) => walked(p, phase, walkSwing, 1, 0.03 + p.gait.lean * 0.4) },
  power: { beat: 1.2, pace: 1.3, own: true, at: (p, phase) => walked(p, phase, powerSwing, 1.5, 0.08 + p.gait.lean * 0.6) },
  jog: { beat: 1.3, pace: 1.5, own: true, at: (p, phase) => ran(p, phase, 0.55) },
  run: { beat: 1.55, pace: 2.6, own: true, at: (p, phase) => ran(p, phase, 1) },
  sprint: { beat: 1.9, pace: 3.8, own: true, at: (p, phase) => ran(p, phase, 1.35) },
  jump: { beat: 0.8, at: (p, phase) => { const { high } = jumpAt(((phase / TAU) % 1 + 1) % 1), left = swungJump(phase, -0.04), right = swungJump(phase, 0.04); return { left, right, body: { hips: high > 0 ? standHips(p) + high : feetDown(p, left, right) } }; } },
  sit: { beat: 0.28, at: (p, phase) => { const leg: Swing = { thigh: 1.5, knee: 1.5, upper: 0.35, fore: 0.95, out: 0.12, curl: 0.4, flex: 0.2 }; return { left: leg, right: leg, body: { hips: standHips(p) * 0.56, breath: Math.sin(phase) * 0.014 } }; } },
  crouch: { beat: 0.28, at: (p, phase) => held(p, () => ({ ...STILL, thigh: 1.5, knee: 2.3, pitch: 0.5, upper: 0.5, fore: 1.2, out: 0.2, curl: 0.4 }), { lean: 0.5, wide: 1, breath: Math.sin(phase) * 0.014 }) },
  wave: { beat: 1.6, at: (p, phase) => grounded(p, STILL, { ...STILL, reach: [0.3 + 0.08 * Math.sin(phase), 0.48, 0.12], palm: FRONT, curl: 0.08, flex: -0.15 + 0.3 * Math.sin(phase) }, { tilt: 0.05, side: -0.03 }) },
  clap: { beat: 2.1, at: (p, phase) => held(p, (side) => ({ ...STILL, reach: [0.036 + 0.075 * (0.5 + 0.5 * Math.cos(phase)), -0.03, 0.27], palm: [-side, 0, 0], curl: 0.1, flex: 0 })) },
  laugh: { beat: 0.9, at: laughed },
  cheer: { beat: 1.4, at: (p, phase) => held(p, (side) => ({ ...bouncing(phase, 0.1), reach: [0.34, 0.72 + 0.08 * Math.sin(phase * 2), 0.12], palm: [-side, 0, 0.4], curl: 1.2 }), { nod: -0.25 }) },
  dance: { beat: 1, at: danced },
  shrug: { beat: 0.6, at: (p, phase) => { const k = Math.max(0, Math.sin(phase)); return held(p, (side) => ({ ...STILL, reach: [0.3 + 0.1 * k, -0.2 + 0.1 * k, 0.2], palm: [-side * 0.3, 1, 0], curl: 0.12 }), { shrug: [0.09 * k, 0.09 * k], tilt: 0.14 * k }); } },
  bow: { beat: 0.4, at: bowed },
  nod: { beat: 1.2, at: (p, phase) => held(p, () => STILL, { nod: 0.1 + 0.2 * Math.sin(phase) }) },
  fold: { beat: 0.28, at: (p, phase) => grounded(p, { ...STILL, reach: [-0.1, -0.09, 0.19], palm: [0, 1, 0.3], curl: 0.6 }, { ...STILL, reach: [-0.1, -0.13, 0.2], palm: [0, -1, 0.3], curl: 0.6 }, { breath: Math.sin(phase) * 0.014, lean: -0.02 }) },
  hips: { beat: 0.28, at: (p, phase) => held(p, () => ({ ...STILL, reach: [0.24, -0.2, 0], palm: [-0.7, 0, -1], curl: 0.3, flex: -0.2 }), { breath: Math.sin(phase) * 0.014 }) },
  think: { beat: 0.28, at: (p, phase) => grounded(p, { ...STILL, reach: [-0.08, -0.12, 0.17], palm: [0, 1, 0], curl: 0.5 }, { ...STILL, reach: [0.02, 0.28, 0.2], palm: [-1, 0.3, 0], curl: 0.9 }, { nod: 0.1, tilt: 0.1, breath: Math.sin(phase) * 0.014 }) },
  talk: { beat: 0.8, at: (p, phase) => held(p, (side) => ({ ...STILL, reach: [0.2 + 0.06 * Math.sin(phase + side), -0.14 + 0.05 * Math.sin(phase * 2 + side), 0.24], palm: [-side * 0.5, 0.8, 0], curl: 0.4 }), { nod: 0.06 * Math.sin(phase * 2), turn: 0.14 * Math.sin(phase * 0.5) }) },
  stretch: { beat: 0.3, at: (p, phase) => { const k = (1 - Math.cos(phase)) / 2; return held(p, (side) => ({ ...STILL, reach: [0.3 - 0.14 * k, -0.2 + 0.86 * k, 0.1 - 0.02 * k], palm: [-side, k, 0], curl: 0.3 }), { nod: -0.3 * k, curve: -0.12 * k, breath: 0.02 * k }); } },
};

function legOf(p: Person, hip: Vec, swing: Swing, side = 0): Leg {
  const length = TALL * p.build.legs * 0.5;
  const out = (a: number): Vec => unit(add(pitched(a), [side * (swing.splay ?? 0), 0, 0]));
  const knee = madd(hip, out(swing.thigh), length);
  const ankle = madd(knee, out(swing.thigh - swing.knee), length * 0.96);
  // (The foot stays near level, tipping only as the leg swings through.)
  const toe = madd(add(ankle, [0, -0.02, 0]), unit([side * (swing.turned ?? 0), -0.12 + clamp(swing.thigh - swing.knee, -1, 1) * 1.1 + (swing.pitch ?? 0), 1]), TALL * 0.08 * p.build.foot);
  return { hip, knee, ankle, toe, end: madd(toe, unit(sub(toe, ankle)), 0.05) };
}

/** A foot that would go through the ground stays on it, the knee taking up the slack. */
function planted(p: Person, leg: Leg): Leg {
  if (leg.ankle[1] >= SOLE + 0.019) return leg;
  const length = TALL * p.build.legs * 0.5;
  const ankle: Vec = [leg.ankle[0], SOLE + 0.02, leg.ankle[2]];
  const reach = Math.min(sub(ankle, leg.hip).reduce((n, v) => n + v * v, 0) ** 0.5, length * 1.95);
  const along = unit(sub(ankle, leg.hip));
  const up = (reach * reach + length * length - (length * 0.96) ** 2) / (2 * reach);
  const bend = Math.sqrt(Math.max(0, length * length - up * up));
  const knee = madd(madd(leg.hip, along, up), unit([0, along[2], -along[1]]), bend);
  return { ...leg, knee, ankle, toe: add(leg.toe, [0, ankle[1] - leg.ankle[1], 0]) };
}

/** An elbow and wrist that put the wrist at `to`, the elbow falling out and back as elbows do. */
function reached(shoulder: Vec, to: Vec, side: number, upper: number, fore: number): { readonly elbow: Vec; readonly wrist: Vec } {
  const way = sub(to, shoulder), along = unit(way, FRONT), far = clamp(Math.hypot(...way), Math.abs(upper - fore) + 0.02, (upper + fore) * 0.985);
  const a = (far * far + upper * upper - fore * fore) / (2 * far), rise = Math.sqrt(Math.max(0, upper * upper - a * a));
  const pole: Vec = [side * 0.7, -0.6, -0.4], off = unit(sub(pole, scale(along, dot(pole, along))), scale(UP, -1));
  return { elbow: madd(madd(shoulder, along, a), off, rise), wrist: madd(shoulder, along, far) };
}

function armOf(p: Person, shoulder: Vec, side: number, swing: Swing, chest: Vec): Arm {
  const length = TALL * 0.186, forearm = length * 0.8;
  const clear = swing.out + Math.max(0, p.build.girth - 1) * 0.28 + (LONG_TOP[p.outfit.top] === undefined ? 0 : 0.1 + p.outfit.fit * 0.08);
  const down = (a: number, out: number): Vec => unit(add(pitched(a), [side * out, 0, 0]));
  const elbow = madd(shoulder, down(swing.upper, clear), length);
  // (A bent forearm comes back in across the body; it does not stick out where the upper arm is going.)
  const free = { elbow, wrist: madd(elbow, down(swing.upper + swing.fore, clear * (1 - 1.5 * clamp(swing.fore / 1.5, 0, 1)) - (swing.across ?? 0)), forearm) };
  // (A hand reaching round a big body has further to go.)
  const big = Math.max(0, p.build.girth - 1), joints = swing.reach ? reached(shoulder, add(chest, [side * (swing.reach[0] + (swing.reach[1] < 0.1 ? big * 0.1 : 0)), swing.reach[1], swing.reach[2] + (swing.reach[1] < 0.1 ? big * 0.2 : 0)]), side, length, forearm) : free;
  return handed({ shoulder, ...joints, faces: swing.palm ?? [-side, -0.3, 0], flex: swing.flex ?? 0 }, side, swing.curl ?? 0);
}

/** How long the hand's own bone is, wrist to knuckles. */
const PALM = TALL * 0.058;

/** A hand on the end of a forearm, bent at the wrist as far as it is. */
function handed(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb" | "hand">, side: number, curl: number): Arm {
  const along = unit(sub(arm.wrist, arm.elbow)), palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  return tipped({ ...arm, hand: madd(arm.wrist, add(scale(along, Math.cos(arm.flex)), scale(palm, Math.sin(arm.flex))), PALM) }, side, curl);
}

/** A hand's fingers, bent `curl` from its line in toward its palm, which turns to face the body wherever the arm goes: thumb up on a forearm held out, as a forearm really rolls. */
function tipped(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb">, side: number, curl: number): Arm {
  const along = unit(sub(arm.hand, arm.wrist)), palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  const bent = (a: number): Vec => add(scale(along, Math.cos(a)), scale(palm, Math.sin(a)));
  const tip = madd(arm.hand, bent(curl), 0.046);
  const knuckles = cross(along, palm), shut = clamp(curl / 1.2, 0, 1);
  const thumb = madd(madd(madd(arm.wrist, along, 0.06 + 0.03 * shut), knuckles, -side * 0.042 * (1 - 1.4 * shut)), palm, 0.036 * shut);
  return { ...arm, tip, nail: madd(tip, bent(curl * 2), 0.04), knuckles, thumb };
}

/** How far under the pelvis the hip joints sit. */
const HIP_DROP = 0.04;

/** How high the sole stands under the lowest point of a foot's bones. */
const SOLE = 0.083;

/** How high the hips sit to put the lower foot, whatever its angle, on the ground. */
function feetDown(p: Person, a: Swing, b: Swing): number {
  const lowest = (s: Swing): number => { const { ankle, toe } = legOf(p, [0, 0, 0], s); return Math.min(ankle[1] - 0.02, toe[1] - Math.max(0, ankle[1] - toe[1] - 0.05) * 0.5); };
  return SOLE + HIP_DROP - Math.min(lowest(a), lowest(b));
}

const standHips = (p: Person): number => feetDown(p, STILL, STILL);

/** Legs stand apart as far as thick thighs need, so they meet and no more. */
function stance(p: Person, swing: Swing): Swing {
  const crowded = 0.09 * limbWide(p.build) - p.build.hip * 0.6;
  return { ...swing, splay: Math.max(swing.splay ?? 0, clamp(crowded / 0.42, 0, 0.22)) };
}

/** The arm that holds an umbrella up, whatever the rest of them does. */
const HOLDING = { upper: 0.36, fore: 1.62, out: 0.16, curl: 0, flex: 0, across: 0, reach: undefined, palm: undefined };

const GROWN_GAIT: readonly Age[] = ["teen", "adult", "elder"];

/** The bones of a pose. */
function skeletonFrom(p: Person, pose: Pose, loose: boolean): Skeleton {
  const { shoulder, hip, stoop } = p.build, leftSwing = stance(p, pose.left);
  const body = { lean: 0, curve: 0, side: 0, twist: 0, shift: 0, drop: 0, nod: 0, tilt: 0, turn: 0, breath: 0, wide: 0.6, shrug: [0, 0] as const, ...pose.body };
  const rightSwing = stance(p, p.outfit.carry === "umbrella" && !loose ? { ...pose.right, ...HOLDING } : pose.right);
  const pelvis: Vec = [body.shift, body.hips, 0], { breath, drop, curve, twist } = body;
  // (What the height leaves between the standing hips and the crown.)
  const trunk = TALL - standHips(p) - p.build.head * (p.face.bone.rise + 1.28);
  const bent = (more: number): Vec => unit([body.side, 1, stoop + body.lean + more]);
  const low = madd(pelvis, bent(0), trunk * 0.22);
  // (The waist leans the way the pelvis tips, so the pelvis itself drops over the swinging leg.)
  const waist = add(low, [-drop * trunk * 0.22 / hip, 0, 0]);
  const chest = madd(low, bent(curve * 0.5), trunk * 0.36 + breath), top = bent(curve), neck = madd(chest, top, trunk * 0.42);
  const head = madd(neck, unit([body.tilt, 1, stoop * 2 + body.nod]), p.build.head * p.face.bone.rise);
  const sideOf = (side: number, s: Swing): { leg: Leg; arm: Arm } => ({
    leg: planted(p, legOf(p, add(pelvis, [side * hip * body.wide, -HIP_DROP + side * drop, -side * twist * 0.6]), s, side)),
    arm: armOf(p, add(madd(neck, top, -trunk * 0.13), [side * shoulder, body.shrug[sideIndex(side)], side * twist]), side, s, chest),
  });
  const posed: Skeleton = { turn: body.turn, spin: Math.asin(clamp(twist / shoulder, -1, 1)), pelvis, waist, chest, neck, head, left: sideOf(-1, leftSwing), right: sideOf(1, rightSwing) };
  return loose ? posed : untangled(p, posed, leftSwing.curl ?? 0, rightSwing.curl ?? 0);
}

/** A person's bones in an action: `phase` is how far along its beat, radians. */
export const skeletonOf = (p: Person, action: Action, phase: number): Skeleton => skeletonFrom(p, MOTIONS[action].at(p, phase), action === "rest");

/** Two sets of bones `k` of the way from one to the other, however the two got there: what makes any motion fade into any other. */
function blended<T>(a: T, b: T, k: number): T {
  if (typeof a === "number" && typeof b === "number") return mix(a, b, k) as T;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v: unknown, i) => blended(v, b[i] as unknown, k)) as T;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) return Object.fromEntries(Object.entries(a).map(([key, v]) => [key, blended(v as unknown, (b as Record<string, unknown>)[key], k)])) as T;
  return a;
}

/** How thick the limbs that can meet are, and how wide what they meet is at a height, as it is worn. */
interface Solid { readonly arm: number; readonly thigh: number; readonly at: (y: number) => { readonly wide: number; readonly front: number; readonly back: number } | undefined }

const solids = new WeakMap<Person, Solid>();

/** A person's solid shape, standing: the same stations their surface is lofted through, and what they have on over it. */
function solidOf(p: Person): Solid {
  const known = solids.get(p);
  if (known) return known;
  const rest = restSkeleton(p), rings = torsoStations(p, rest), { top, bottom, fit } = p.outfit;
  const k = limbWide(p.build), sleeved = SLEEVE_RINGS[top] > 2 ? topLift(top, fit) : 0;
  const hung = LONG_TOP[top] !== undefined || bottom === "skirt", hem = hung ? hemOf(p) : FAR, tube = hung ? 1.22 + fit * 0.14 : 1;
  const fall = rings[1], ring = (y: number): Station | undefined => [...rings].reverse().find((r) => r.at[1] <= y);
  const solid: Solid = {
    arm: 0.04 * k + sleeved,
    thigh: 0.09 * k,
    at: (y) => {
      const lower = hung && y < rest.pelvis[1] && y >= hem - 0.1;
      const a = lower ? fall : ring(y), b = lower ? fall : rings[(a ? rings.indexOf(a) : 0) + 1];
      if (!a || !b || y > rest.left.arm.shoulder[1] - 0.05) return undefined;
      const t = clamp((y - a.at[1]) / Math.max(0.001, b.at[1] - a.at[1]), 0, 1), lift = topLift(top, fit), wrap = lower ? tube : 1;
      return { wide: mix(a.wide, b.wide, t) * wrap + lift, front: (mix(a.front, b.front, t) + (a.bust ?? 0) * 0.6) * wrap + lift, back: (mix(a.back, b.back, t) + (a.rear ?? 0)) * wrap + lift };
    },
  };
  solids.set(p, solid);
  return solid;
}

/** A point out of the trunk, to its surface, the way it is nearest. */
function outOfTrunk(p: Person, s: Skeleton, at: Vec): Vec {
  const solid = solidOf(p), rest = restSkeleton(p), rise = s.pelvis[1] - rest.pelvis[1];
  const ring = solid.at(at[1] - rise);
  if (!ring) return at;
  const k = clamp((at[1] - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]), 0, 1), middle = mix(s.pelvis[2], s.neck[2], k), z = at[2] - middle;
  const wide = ring.wide + solid.arm, deep = (z > 0 ? ring.front : ring.back) + solid.arm, q = Math.hypot(at[0] / wide, z / deep);
  if (q >= 1) return at;
  if (q < 1e-3) return [wide, at[1], at[2]];
  return [at[0] / q, at[1], middle + z / q];
}

/** A point off a limb running from `a` to `b`, a capsule `r` round it. */
function offLimb(at: Vec, a: Vec, b: Vec, r: number): Vec {
  const d = sub(b, a), t = clamp(dot(sub(at, a), d) / Math.max(1e-6, dot(d, d)), 0, 1), near = madd(a, d, t), off = sub(at, near), l = Math.hypot(...off);
  return l >= r ? at : madd(near, unit(off, SIDE), r);
}

/** An arm kept out of the body, bone by bone, each keeping its length. */
function armClear(p: Person, s: Skeleton, arm: Arm, side: number, curl: number): Arm {
  const { thigh, arm: r } = solidOf(p);
  const off = (at: Vec): Vec => [s.left.leg, s.right.leg].reduce((n, leg) => offLimb(n, leg.hip, leg.knee, thigh + r), outOfTrunk(p, s, at));
  const held = (from: Vec, to: Vec, length: number): Vec => madd(from, unit(sub(off(to), from)), length);
  const upper = Math.hypot(...sub(arm.elbow, arm.shoulder)), fore = Math.hypot(...sub(arm.wrist, arm.elbow)), palm = Math.hypot(...sub(arm.hand, arm.wrist));
  const elbow = held(arm.shoulder, arm.elbow, upper);
  const wrist = held(elbow, add(arm.wrist, sub(elbow, arm.elbow)), fore);
  const hand = handed({ ...arm, elbow, wrist }, side, curl).hand;
  return tipped({ ...arm, elbow, wrist, hand: held(wrist, hand, palm) }, side, curl);
}

/** A foot never goes under the ground: its toe comes up to it. */
function footClear(leg: Leg): Leg {
  const toe: Vec = [leg.toe[0], Math.max(leg.toe[1], SOLE), leg.toe[2]];
  const along = unit(sub(toe, leg.ankle)), flat = unit([along[0], 0, along[2]]);
  // (Toes bend back only against the ground: a foot in the air is stiff to its tip.)
  const off = clamp((toe[1] - SOLE) / 0.05, 0, 1);
  return { ...leg, toe, end: madd(toe, along[1] < 0 ? unit(lerpV(flat, along, off)) : along, 0.05) };
}

/** A pose with nothing through anything: arms outside the body and legs, feet on or over the ground. */
function untangled(p: Person, s: Skeleton, leftCurl: number, rightCurl: number): Skeleton {
  return { ...s, left: { leg: footClear(s.left.leg), arm: armClear(p, s, s.left.arm, -1, leftCurl) }, right: { leg: footClear(s.right.leg), arm: armClear(p, s, s.right.arm, 1, rightCurl) } };
}

// ---------------------------------------------------------------- parts

/** How thick a neck goes against the head: a man's thicker, a woman's less, a child's thin and the same for both. */
const neckBy = (p: Person): number => mix(0.8, p.build.sex === "male" ? 1 : 0.8, p.face.bone.m);

/** One drawn part: sdf-body's shape, named for what it is. */
export interface Capsule {
  readonly part: string;
  readonly role: string;
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly r1?: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly melt?: number;
  readonly decal?: boolean;
  readonly carve?: boolean;
  readonly detail?: number;
  /** A row of this many beads, each drawn out by `reach` into a digit: a hand's fingers as one part. */
  readonly row?: number;
  readonly reach?: Vec;
  /** A mesh cuts it off level at this height: a hem. */
  readonly hem?: number;
  /** Whether it casts a shadow: a hat's or hair's would lie across the face and hide it. */
  readonly shadow?: boolean;
}

type Finish = Partial<Pick<Capsule, "r1" | "flat" | "up" | "melt" | "decal" | "carve" | "detail" | "row" | "reach" | "shadow" | "hem">>;
type Kit = Capsule[];

const put = (kit: Kit, part: string, role: string, a: Vec, b: Vec, r: number, finish: Finish = {}): void => { kit.push({ part, role, a, b, r, flat: 1, up: UP, ...finish }); };
const ball = (kit: Kit, part: string, role: string, p: Vec, r: number, finish: Finish = {}): void => { put(kit, part, role, p, p, r, finish); };
/** A level band round whatever passes through it, a thin sheet that finds the surface wherever it lies: a stripe, a belt. */
const band = (kit: Kit, part: string, role: string, at: Vec, wide: number, thick: number): void => { put(kit, part, role, at, at, wide, { decal: true, flat: thick / wide, up: UP, melt: 0.2 }); };
const paint = (kit: Kit, part: string, role: string, a: Vec, b: Vec, r: number): void => { put(kit, part, role, a, b, r, { decal: true }); };

const TOP_SLEEVE: Readonly<Record<Top, number>> = { tee: 0.5, polo: 0.46, tank: 0, long: 1, hoodie: 1, jacket: 1, blazer: 1, coat: 1, robe: 0.8, dress: 0.3, raincoat: 1, puffer: 1, swimsuit: 0, bikini: 0, string: 0, bare: 0 };

/** A top that goes on down over the legs. */
const LONG_TOP: Partial<Record<Top, number>> = { dress: 0.96, coat: 1.2, robe: 1.9, raincoat: 1 };

/** How much bigger than the limb its cloth is, at a fit. */
const clothWide = (fit: number): number => 1.04 + fit * 0.14;

/** How much thicker than average a body's limbs are: less than its trunk, where most of anybody's weight goes. */
const limbWide = (b: Build): number => mix(1, Math.sqrt(b.girth * b.limb), 0.85);

/** A limb's stretch from `a` to `b`, swelling at `belly` of the way: a muscle, not a tube, in `role`. */
function muscle(kit: Kit, part: string, role: string, a: Vec, b: Vec, r: readonly [number, number, number], belly: number, on: Vec): void {
  const mid = madd(lerpV(a, b, belly), on, r[1] * 0.1);
  put(kit, `${part}.0`, role, a, mid, r[0], { r1: r[1], melt: 0.8 });
  put(kit, `${part}.1`, role, mid, b, r[1], { r1: r[2], melt: 0.8 });
}

/** Skin, or the cloth over it, up to `upto` of the limb's length. */
function clad(kit: Kit, part: string, role: string, a: Vec, b: Vec, r: readonly [number, number, number], upto: number, on: Vec, fit: number): void {
  const k = clothWide(fit);
  const wide: readonly [number, number, number] = [r[0] * k, r[1] * k, r[2] * k * (1 + fit * 0.12)];
  if (upto >= 1) { muscle(kit, part, role, a, b, wide, 0.34, on); return; }
  if (upto <= 0) { muscle(kit, part, "skin", a, b, r, 0.34, on); return; }
  const cut = lerpV(a, b, upto);
  put(kit, `${part}.cloth`, role, a, cut, wide[0], { r1: wide[1] * 1.04, melt: 0.2 });
  put(kit, part, "skin", cut, b, r[1], { r1: r[2], melt: 0.2 });
}

/** Which way an umbrella's shaft leans, held up and over its holder. */
const SHAFT: Vec = unit([-0.2, 0.98, 0.02]);

/** A vector carried the shortest way round from one direction to another, with no twist about it. */
function swung(d: Vec, from: Vec, to: Vec): Vec {
  const axis = cross(from, to), c = dot(from, to);
  if (c < -0.9999) return add(scale(UP, 2 * dot(UP, d)), scale(d, -1));
  return add(add(scale(d, c), cross(axis, d)), scale(axis, dot(axis, d) / (1 + c)));
}

/** A rest frame as an arm's bone carries it to a pose: swung, never wrung round its own length, so a shoulder is not twisted shut. */
function swungFrame(frame: readonly [Vec, Vec, Vec], ra: Vec, rb: Vec, na: Vec, nb: Vec): readonly [Vec, Vec, Vec] {
  const from = unit(sub(rb, ra)), to = unit(sub(nb, na));
  const [x, y, z] = frame;
  return [swung(x, from, to), swung(y, from, to), swung(z, from, to)];
}

/** A hand's bone's frame: its own line, and the knuckles' line square to it, so the roll of a forearm comes with it. */
function handFrame(a: Vec, b: Vec, knuckles: Vec): readonly [Vec, Vec, Vec] {
  const along = unit(sub(b, a), UP), x = unit(sub(knuckles, scale(along, dot(knuckles, along))), SIDE);
  return [x, along, cross(x, along)];
}

/** The right hand's way from holding pose to rest and back: anything carried is made where it is held, and ridden home to the bone. */
function heldHand(p: Person): { readonly toRest: (at: Vec) => Vec; readonly toHeld: (at: Vec) => Vec; readonly spin: (d: Vec) => Vec } {
  const held = { ...p, outfit: { ...p.outfit, carry: "umbrella" as const } };
  const rest = restSkeleton(p).right.arm, now = skeletonOf(held, "stand", 0).right.arm;
  const r = handFrame(rest.wrist, rest.hand, rest.knuckles), m = handFrame(now.wrist, now.hand, now.knuckles);
  const swap = (from: readonly [Vec, Vec, Vec], to: readonly [Vec, Vec, Vec], d: Vec): Vec => from.reduce<Vec>((n, axis, i) => madd(n, to[i] ?? axis, dot(axis, d)), [0, 0, 0]);
  return {
    toRest: (at) => add(rest.wrist, swap(m, r, sub(at, now.wrist))),
    toHeld: (at) => add(now.wrist, swap(r, m, sub(at, rest.wrist))),
    spin: (d) => swap(m, r, d),
  };
}

/** Where a fist's middle is, the shaft running through it, on a hand at rest. */
function gripOf(arm: Arm, u: Vec): { readonly centre: Vec; readonly along: Vec; readonly round: Vec } {
  const along = unit(sub(arm.hand, arm.wrist), SIDE);
  const flat = unit(sub(u, scale(along, dot(u, along))));
  const round = unit(cross(along, flat));
  return { centre: madd(madd(arm.wrist, along, 0.075), round, 0.03), along, round };
}

/** A hand shut round a shaft: a palm against it, four fingers and a thumb coming back the other way. */
function drawFist(kit: Kit, p: Person, arm: Arm): void {
  const u = unit(heldHand(p).spin(SHAFT));
  const { centre, along, round } = gripOf(arm, u);
  const finger = 0.0088;
  put(kit, "palm.R", "skin", madd(arm.wrist, along, 0.012), madd(centre, round, -0.02), 0.032, { r1: 0.038, flat: 0.6, up: round, melt: 0.8 });
  for (let i = 0; i < 4; i += 1) {
    const at = madd(centre, u, (i - 1.5) * 0.021);
    const knuckle = madd(madd(at, along, 0.024), round, -0.024), bend = madd(madd(at, along, 0.03), round, 0.012), tip = madd(madd(at, along, -0.002), round, 0.03);
    put(kit, `fingers.R.${String(i)}.0`, "skin", knuckle, bend, finger * 1.1, { r1: finger, melt: 0.3, detail: 1 });
    put(kit, `fingers.R.${String(i)}.1`, "skin", bend, tip, finger, { r1: finger * 0.8, melt: 0.3, detail: 1 });
  }
  const root = madd(madd(centre, along, -0.04), u, 0.03);
  put(kit, "thumb.R", "skin", root, madd(madd(centre, u, 0.036), round, 0.024), 0.0125, { r1: 0.009, melt: 0.4, detail: 1 });
}

function drawHand(kit: Kit, p: Person, arm: Arm, side: number, L: string): void {
  if (p.outfit.carry === "umbrella" && side > 0 && unit(sub(arm.hand, arm.wrist))[0] > 0.9) { drawFist(kit, p, arm); return; }
  const along = unit(sub(arm.hand, arm.wrist), scale(UP, -1));
  const across = FRONT;
  const palm = lerpV(arm.wrist, arm.hand, 0.75);
  put(kit, `palm.${L}`, "skin", madd(arm.wrist, along, 0.02), madd(palm, along, 0.012), 0.027, { r1: 0.041, flat: 0.5, up: unit(cross(along, FRONT)), melt: 0.8 });
  put(kit, `fingers.${L}`, "skin", madd(arm.hand, across, -0.03), madd(arm.hand, across, 0.03), 0.0098, { row: 4, reach: sub(arm.tip, arm.hand), detail: 1 });
  put(kit, `tips.${L}`, "skin", madd(arm.tip, across, -0.03), madd(arm.tip, across, 0.03), 0.0088, { row: 4, reach: sub(arm.nail, arm.tip), detail: 1 });
  put(kit, `thumb.${L}`, "skin", madd(arm.wrist, FRONT, 0.024), add(madd(palm, FRONT, 0.042), [-side * 0.01, 0, 0]), 0.012, { r1: 0.009, detail: 1 });
}

function drawArm(kit: Kit, p: Person, arm: Arm, side: number): void {
  const L = side < 0 ? "L" : "R";
  const k = limbWide(p.build);
  const sleeve = TOP_SLEEVE[p.outfit.top];
  const out: Vec = [side, 0, 0];
  clad(kit, `arm.${L}`, "top", arm.shoulder, arm.elbow, [0.044 * k, 0.047 * k, 0.037 * k], Math.min(1, sleeve * 2), out, p.outfit.fit);
  clad(kit, `fore.${L}`, "top", arm.elbow, arm.wrist, [0.038 * k, 0.041 * k, 0.027], Math.max(0, sleeve * 2 - 1), FRONT, p.outfit.fit);
  drawHand(kit, p, arm, side, L);
}

function drawShoe(kit: Kit, p: Person, leg: Leg, L: string): void {
  const { shoe } = p.outfit;
  const back = unit(sub(leg.ankle, leg.toe));
  const { foot } = p.build;
  const heel = add(madd(leg.ankle, back, 0.03 * foot), [0, -0.038, 0]);
  const arch = add(lerpV(leg.ankle, leg.toe, 0.7), [0, -0.036, 0]);
  const sandal = shoe === "sandal";
  if (shoe === "boot") put(kit, `boot.${L}`, "shoe", lerpV(leg.knee, leg.ankle, 0.6), leg.ankle, 0.05, { r1: 0.052 });
  put(kit, `shoe.${L}`, sandal ? "skin" : "shoe", heel, arch, (sandal ? 0.036 : 0.05) * foot, { r1: (sandal ? 0.034 : 0.046) * foot, flat: 0.8, up: UP });
  put(kit, `toe.${L}`, sandal ? "skin" : "shoe", arch, add(leg.toe, [0, -0.044, 0]), (sandal ? 0.034 : 0.046) * foot, { r1: 0.04 * foot, flat: 0.72, up: UP });
  put(kit, `sole.${L}`, "sole", add(heel, [0, -0.036, 0]), add(leg.toe, [0, -0.07, 0]), 0.05 * foot, { r1: 0.044 * foot, flat: 0.16, up: UP, melt: 0, detail: 2 });
}

function drawLeg(kit: Kit, p: Person, leg: Leg, L: string): void {
  const k = limbWide(p.build);
  const { bottom, top } = p.outfit;
  const skirted = bottom === "skirt" || top === "dress" || top === "robe";
  const fit = bottom === "leggings" ? 0 : p.outfit.fit;
  const shorts = bottom === "shorts";
  clad(kit, `thigh.${L}`, "bottom", leg.hip, leg.knee, [0.09 * k, 0.082 * k, 0.056 * k], skirted ? 0 : shorts ? 0.72 : 1, FRONT, fit);
  clad(kit, `shin.${L}`, "bottom", leg.knee, leg.ankle, [0.054 * k, 0.058 * k, 0.036], skirted || shorts ? 0 : 1, scale(FRONT, -1), fit);
  drawShoe(kit, p, leg, L);
}

/** Round a torso's station: its half width and depth at a height. */
function drawTorso(kit: Kit, p: Person, s: Skeleton): void {
  const { shoulder, hip, girth, chest, head } = p.build;
  const up = FRONT;
  const { top } = p.outfit;
  const low = LONG_TOP[top] === undefined ? "bottom" : "top";
  const belly = Math.max(0, girth - 1) * 0.06 + p.build.belly;
  const waist = mix(hip, shoulder, 0.16) * mix(0.76, 1.08, girth - 0.78) * p.build.waist;
  const ribs = madd(s.chest, FRONT, chest);
  put(kit, "hips", low, madd(s.pelvis, FRONT, -0.008), lerpV(s.pelvis, s.waist, 0.72), hip * 1.04 * Math.sqrt(girth), { r1: waist * 1.02, flat: 0.72, up, melt: 0.12 });
  put(kit, "belly", "top", madd(lerpV(s.pelvis, s.waist, 0.72), FRONT, belly), ribs, waist * 1.03, { r1: shoulder * 0.88, flat: 0.66, up, melt: 1 });
  put(kit, "ribs", "top", ribs, lerpV(ribs, s.neck, 0.38), shoulder * 0.88, { r1: shoulder * 0.6, flat: 0.6, up, melt: 1 });
  for (const [x, arm] of [[-1, s.left.arm], [1, s.right.arm]] as const) put(kit, `yoke.${String(x)}`, "top", add(s.neck, [x * 0.03, -0.075, -0.012]), arm.shoulder, 0.034, { r1: 0.052, melt: 1 });
  if (p.build.sex === "female" && p.build.age !== "toddler" && p.build.age !== "child") for (const x of [-1, 1]) ball(kit, `bust.${String(x)}`, "top", add(ribs, [x * shoulder * 0.42, -0.015, shoulder * 0.42]), shoulder * (p.build.age === "teen" ? 0.26 : 0.34) * p.build.bust, { melt: 1.4 });
  put(kit, "neck", "skin", add(s.neck, [0, -0.03, -0.012]), madd(madd(s.head, UP, -head * 0.62), FRONT, -head * 0.08), head * 0.54 * neckBy(p) * Math.sqrt(girth * p.build.limb), { r1: head * 0.47 * neckBy(p) * Math.sqrt(p.build.limb), melt: 1 });
}

/** A skirt, or the lower half of something long: a cone flaring from the hips, cut off level at its hem. */
function drawSkirt(kit: Kit, p: Person, s: Skeleton): void {
  const { hip } = p.build;
  const { top, bottom, fit } = p.outfit;
  const long = LONG_TOP[top];
  if (long === undefined && bottom !== "skirt") return;
  const reach = long ?? 0.78;
  const hem = lerpV(lerpV(s.left.leg.hip, s.left.leg.knee, reach), lerpV(s.right.leg.hip, s.right.leg.knee, reach), 0.5);
  const flare = hip * (1.26 + fit * 0.4);
  put(kit, "skirt", long === undefined ? "bottom" : "top", s.pelvis, madd(hem, UP, -flare * 0.72), hip * 1.04, { r1: flare, flat: 0.78, up: FRONT, melt: 0.5, hem: hem[1] });
}

/** A collar, a shirt and a tie under a jacket. */
function drawLapels(kit: Kit, s: Skeleton): void {
  put(kit, "collar", "top", add(s.neck, [-0.075, -0.045, -0.01]), add(s.neck, [0.075, -0.045, -0.01]), 0.034, { flat: 0.6, up: UP, melt: 0.3 });
}

function drawStripes(kit: Kit, p: Person, s: Skeleton, ribs: Vec): void {
  const { top, stripes, costume } = p.outfit;
  if (LONG_TOP[top] !== undefined && costume !== "firefighter") return;
  for (let i = 0; i < stripes; i += 1) band(kit, `stripe.${String(i)}`, "trim", lerpV(s.waist, ribs, (i + 0.5) / stripes), p.build.shoulder * 1.4, 0.013);
}

/** A hood that is down: its opening a thick roll of cloth round the neck, crossing at the throat, and the bag of it lying flat on the back; two cords down the front. Only the bag where parts are few. */
function drawHood(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { head } = p.build, r = head * 0.62, base = add(s.neck, [0, -0.035, -0.006]);
  const rim = (t: number, side: number): Vec => add(base, [side * Math.sin(t) * r, 0.022 * (1 - Math.cos(t)) - 0.018 * Math.max(0, Math.cos(t)), Math.cos(t) * r * 0.86]);
  if (rich) for (const side of [-1, 1]) for (let i = 0; i < 4; i += 1) put(kit, `hood.rim.${String(side)}.${String(i)}`, "top", rim(-0.12 + i * 1.02, side), rim(-0.12 + (i + 1) * 1.02, side), head * 0.2, { melt: 0.5 });
  const back = lerpV(s.neck, s.chest, 0.5);
  put(kit, "hood.bag", "top", add(lerpV(s.neck, s.chest, 0.2), [0, 0, -0.095]), add(back, [0, -0.06, -0.125]), head * 0.62, { r1: head * 0.22, flat: 0.16, up: FRONT, melt: 0.8 });
  if (rich) for (const side of [-1, 1]) put(kit, `cord.${String(side)}`, "trim", add(s.neck, [side * 0.03, -0.06, 0.14]), add(lerpV(s.neck, s.chest, 0.82), [side * 0.036, -0.09, 0.15]), 0.012, { decal: true, flat: 0.5, up: FRONT, melt: 0.2 });
}

function drawClothes(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { top, bottom } = p.outfit;
  const { hip, chest } = p.build;
  const ribs = madd(s.chest, FRONT, chest);
  if (top === "hoodie") {
    drawHood(kit, p, s, rich);
    const low = lerpV(s.waist, s.pelvis, 0.12);
    put(kit, "pouch", "trim", add(low, [-hip * 0.5, 0, 0.1]), add(low, [hip * 0.5, 0, 0.1]), 0.075, { decal: true, flat: 0.5, up: UP, melt: 0.2 });
  }
  if (top === "jacket" || top === "blazer" || top === "coat") drawLapels(kit, s);
  if (top === "polo") put(kit, "collar", "trim", add(s.neck, [-0.06, -0.045, 0.02]), add(s.neck, [0.06, -0.045, 0.02]), 0.026, { flat: 0.6, up: UP, melt: 0.3 });
  drawStripes(kit, p, s, ribs);
  const belt = lerpV(s.pelvis, s.waist, 0.72);
  if (bottom === "jeans" || bottom === "trousers" || bottom === "cargo") band(kit, "belt", "dark", belt, hip * 1.2, 0.013);
  drawSkirt(kit, p, s);
  if (p.outfit.costume === "fursuit") put(kit, "brush", "skin", add(s.pelvis, [0, 0, -0.12]), add(s.pelvis, [0, -0.24, -0.56]), 0.07, { r1: 0.13, melt: 0.6 });
}

// ---------------------------------------------------------------- the head

/** A head's room. `at` is the old frame hair and hats hang on, x in shares of the skull's width; `bone` and `mark` take x in head radii, `mark` for what stays put whatever the skull's width. */
interface HeadFrame { readonly c: Vec; readonly r: number; readonly at: (x: number, y: number, z: number) => Vec; readonly bone: (x: number, y: number, z: number) => Vec; readonly mark: (x: number, y: number, z: number) => Vec }

function headFrame(s: Skeleton, r: number, face: Face): HeadFrame {
  const { W, L, D } = face.bone;
  const on = (x: number, y: number, z: number): Vec => add(s.head, [x * r, (y < 0 ? y * L : y) * r, (z < 0 ? z * D : z) * r]);
  return { c: s.head, r, at: (x, y, z) => on(x * W * 0.84, y, z), bone: (x, y, z) => on(x * W, y, z), mark: on };
}

/** A melt that is the same share of any head, a child's as a grown one's. */
const meltBy = (p: Person) => (share: number): number => (share * p.build.head * p.build.size) / 0.03;

function drawEyes(kit: Kit, p: Person, h: HeadFrame): void {
  const { face } = p;
  const { r } = h;
  for (const x of [-1, 1]) {
    const L = x < 0 ? "L" : "R";
    const at = h.mark(x * face.apart, face.bone.pupil, 0.74);
    const eye = r * face.eye;
    // (Drawn out across the face and sunk under the skin: sdf-body paints the eye on whatever lies over it.)
    put(kit, `eye.${L}`, "eye", add(at, [-eye * 0.42, 0, 0]), add(at, [eye * 0.42, 0, 0]), eye * 0.74, { flat: 0.3, up: unit([x * 0.16, 0, 1]), melt: 0 });
    const brow = h.mark(x * face.apart, face.bone.pupil + 0.28, 0.94);
    paint(kit, `brow.${L}`, "brow", add(brow, [-x * r * 0.2, -face.browTilt * r * 0.6, 0]), add(brow, [x * r * 0.2, face.browTilt * r * 0.6, -r * 0.04]), r * 0.05 * (0.5 + face.brow * 0.7));
  }
}

/** How far forward the lip lies under the nose, on any head: a nose stands off this, so no jaw can bury it. */
const NOSE_ROOT = 1.02;

function drawNose(kit: Kit, p: Person, h: HeadFrame): void {
  const { nose, noseWide, bone: b } = p.face, melt = meltBy(p), r = h.r, fine = p.build.sex === "female" ? mix(1, 0.8, b.m) : 1;
  const top = b.pupil + 0.02, y = b.sub + b.tipY, far = Math.min(NOSE_ROOT + nose * 0.62 * mix(1, 0.86, 1 - fine), 1.3);
  const bulb = mix(0.095, 0.125, b.m), tip = h.mark(b.askew, y, far - bulb);
  put(kit, "bridge", "skin", h.mark(0, top, 0.8), madd(tip, [0, 1, -0.3], r * 0.05), r * mix(0.075, 0.1, b.m) * fine, { r1: r * mix(0.085, 0.125, b.m) * fine, flat: 0.85, up: SIDE, melt: melt(0.07) });
  ball(kit, "tip", "skin", tip, r * bulb, { melt: melt(0.07) });
  for (const x of [-1, 1]) ball(kit, `ala.${String(x)}`, "skin", h.mark(x * (noseWide - mix(0.05, 0.08, b.m)) + b.askew * 0.5, b.sub + 0.05, NOSE_ROOT - 0.04), r * mix(0.06, 0.09, b.m), { flat: 0.8, up: SIDE, melt: melt(0.07) });
  if (b.hump > 0.02) ball(kit, "hump", "skin", h.mark(0, (top + y) * 0.52, (0.86 + far) * 0.5 + b.hump - 0.03), r * 0.08, { flat: 0.75, up: SIDE, melt: melt(0.05) });
}

/** A line and no more, the lower lip only hinted under it: thin sheets through the face, so they find it wherever it lies and never stand off it as a beak. */
function drawMouth(kit: Kit, p: Person, h: HeadFrame): void {
  const { mouthWide: w, lips, bone } = p.face;
  const y = bone.sto;
  put(kit, "mouth", "dark", h.mark(0, y, 0.5), h.mark(0, y, 1.2), h.r * w * 0.78, { decal: true, flat: 0.085, up: UP, melt: 0.2 });
  // (A full lower lip, melted into the face.)
  put(kit, "lip", "lip", h.mark(-w * 0.42, y - 0.085, 0.92), h.mark(w * 0.42, y - 0.085, 0.92), h.r * lips * 0.07, { flat: 0.6, up: UP, melt: 0.2 });
  put(kit, "lip.top", "lip", h.mark(-w * 0.5, y + 0.05, 0.92), h.mark(w * 0.5, y + 0.05, 0.92), h.r * lips * 0.05, { flat: 0.55, up: UP, melt: 0.18 });
}

/** A renderer that paints a part on gets a beard as paint. On a mesh it is painted on the vertices, by `faceBake`, and stands proud of the jaw. */
function drawFaceHair(kit: Kit, p: Person, h: HeadFrame, rich: boolean): void {
  const { hair, mouthWide: w, bone: b } = p.face;
  if (hair !== "beard" && hair !== "moustache") return;
  if (rich) { if (hair === "beard") beardVolume(kit, p, h); return; }
  if (hair === "beard") paint(kit, "beard", "hair", h.bone(0, b.men + 0.2, 0.5), h.bone(0, b.men + 0.3, 0.7), h.r * 0.42);
  paint(kit, "tache", "hair", h.mark(-w * 1.05, b.sub - 0.08, 0.96), h.mark(w * 1.05, b.sub - 0.08, 0.96), h.r * 0.075);
}

/** A beard is one clean shape first: a shell that stands off the jaw from the ear round the chin and up over the lip, its edge wherever it leaves the skin, and the mouth left clear. */
function beardVolume(kit: Kit, p: Person, h: HeadFrame): void {
  const { mouthWide: w, bone: b } = p.face, melt = meltBy(p), r = h.r, y = b.men + 0.17, z = b.pogZ - 0.16;
  ball(kit, "beard.chin", "beard", h.bone(0, y, z), r * 0.25, { melt: melt(0.14) });
  put(kit, "beard.lip", "beard", h.mark(-w * 1.02, b.sub - 0.09, 0.9), h.mark(w * 1.02, b.sub - 0.09, 0.9), r * 0.075, { melt: melt(0.06) });
  for (const x of [-1, 1]) {
    const side = String(x), corner = h.bone(x * (b.gon - 0.14), b.gonY + 0.14, b.gonZ + 0.16);
    put(kit, `beard.jaw.${side}`, "beard", corner, h.bone(x * 0.12, y, z - 0.02), r * 0.2, { r1: r * 0.23, melt: melt(0.14) });
    put(kit, `beard.burn.${side}`, "beard", h.bone(x * (b.zyg - 0.1), -0.04, 0.02), corner, r * 0.09, { r1: r * 0.17, melt: melt(0.12) });
    put(kit, `beard.soul.${side}`, "beard", h.mark(x * (w + 0.1), b.sub - 0.09, 0.84), h.bone(x * (w + 0.06), b.sto - 0.2, 0.74), r * 0.08, { r1: r * 0.11, melt: melt(0.1) });
  }
}

function drawEars(kit: Kit, p: Person, h: HeadFrame): void {
  const tucks = tuckOf(p);
  [-1, 1].forEach((x, side) => {
    const size = p.face.ears * (tucks[side] ? 1 : 0.3);
    put(kit, `ear.${String(x)}`, "skin", h.at(x * 0.92, 0.12, -0.06), h.at(x * 0.9, -0.16, 0.02), h.r * size, { r1: h.r * size * 0.66, flat: 0.34, up: unit([x, 0, 0.3]), melt: 0.3, detail: 1 });
  });
}

/** How wide each hat's brim runs all round, in head radii. */
const BRIMS: Partial<Record<Hat, number>> = { fedora: 1.5, sunhat: 2, stetson: 1.9, helmet: 1.5, bucket: 1.42, bowler: 1.34, tophat: 1.36 };

/** How much taller than the skull each hat's crown stands. */
const CROWN_RISE: Partial<Record<Hat, number>> = { stetson: 0.24, peaked: 0.24, bowler: 0.12, bucket: 0.07, beret: 0.1, headwrap: 0.2, hardhat: 0.1 };

/** The crown is the skull's own shape a little bigger, cut off level across the forehead: it sits on the head, not over it. A hood and a helmet stand well clear of it. */
function drawCrown(kit: Kit, hat: Hat, h: HeadFrame, wide: number): void {
  const clear = hat === "hood" || hat === "helmet" || hat === "hardhat", brim = h.at(0, hat === "hood" ? -0.1 : clear ? 0.58 : 0.5, 0)[1];
  const tall = CROWN_RISE[hat] ?? 0;
  put(kit, "hat", hat === "hood" ? "top" : "trim", h.at(0, 0.3, -0.12), h.at(0, 0.14 + tall, -0.06), h.r * (clear ? 1.2 : 1.16) * mix(1, wide, 0.75), { flat: clear ? 0.88 : 0.76, up: SIDE, melt: 0.08, hem: brim, shadow: false });
}

/** What makes one hat not another: a bobble, a ridge, a knot. */
function drawTrim(kit: Kit, hat: Hat, h: HeadFrame): void {
  if (hat === "pompom") ball(kit, "hat.pom", "trim", h.at(0, 1.42, -0.1), h.r * 0.3, { melt: 0.2, shadow: false });
  if (hat === "hardhat") put(kit, "hat.ridge", "trim", h.at(0, 1.2, 0.5), h.at(0, 1.2, -0.7), h.r * 0.18, { melt: 0.5, shadow: false });
  if (hat === "headwrap") ball(kit, "hat.knot", "trim", h.at(0.16, 1.2, 0.5), h.r * 0.3, { melt: 0.3, shadow: false });
  if (hat === "bandana") for (const x of [-1, 1]) put(kit, `hat.tail.${String(x)}`, "trim", h.at(x * 0.05, 0.5, -1.16), h.at(x * 0.26, -0.1, -1.3), h.r * 0.1, { r1: h.r * 0.04, flat: 0.4, up: FRONT, melt: 0.3, shadow: false });
}

function drawHat(kit: Kit, p: Person, h: HeadFrame): void {
  const { hat } = p.outfit;
  if (hat === "none") return;
  if (hat === "beret") { ball(kit, "hat", "trim", h.at(0.1, 0.72, -0.14), h.r * 1.04, { flat: 0.5, up: UP, melt: 0.08, shadow: false }); return; }
  if (hat === "tophat") put(kit, "hat.top", "trim", h.at(0, 0.62, -0.1), h.at(0, 1.42, -0.1), h.r * 0.92, { melt: 0.05, shadow: false });
  else if (hat !== "visor") drawCrown(kit, hat, h, p.face.bone.W);
  drawTrim(kit, hat, h);
  const wide = BRIMS[hat];
  if (wide !== undefined) ball(kit, "peak", "trim", h.at(0, 0.6, hat === "helmet" ? -0.26 : -0.1), h.r * wide, { flat: 0.06, up: UP, melt: 0.1, shadow: false });
  if (hat === "cap" || hat === "peaked" || hat === "flatcap" || hat === "visor" || hat === "hardhat") put(kit, "peak", "trim", h.at(0, 0.56, 0.9), h.at(0, 0.46, 1.4), h.r * 0.5, { r1: h.r * 0.38, flat: 0.22, up: unit([0, 1, 0.2]), melt: 0.5, shadow: false });
}

/** A fursuit's head: a muzzle, a nose and ears, in the pelt. */
function drawFur(kit: Kit, h: HeadFrame): void {
  put(kit, "muzzle", "belly", h.at(0, -0.3, 0.9), h.at(0, -0.36, 1.4), h.r * 0.48, { r1: h.r * 0.3, melt: 1 });
  ball(kit, "snout", "dark", h.at(0, -0.26, 1.68), h.r * 0.13, { melt: 0.2 });
  for (const x of [-1, 1]) put(kit, `ear.${String(x)}`, "skin", h.at(x * 0.6, 0.9, -0.1), h.at(x * 0.86, 1.86, -0.12), h.r * 0.44, { r1: h.r * 0.06, flat: 0.5, up: FRONT, melt: 0.5 });
}

/** The hair's shell: up over the crown and down the back of the skull, its line clear of the brow and the ears' fronts. */
const hairCap = (kit: Kit, h: HeadFrame, k: number): void => { put(kit, "hair", "hair", h.at(0, 0.56, -0.26), h.at(0, 0.24, -0.42), h.r * 0.98 * k, { melt: 0.1, shadow: false }); };

/** The hair, on a head: each style a few parts, the same on every side of them. */
const HAIR_STYLES: Readonly<Record<HairStyle, (kit: Kit, h: HeadFrame) => void>> = {
  bald: () => undefined,
  crop: (kit, h) => { hairCap(kit, h, 0.98); },
  side: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "fringe", "hair", h.at(-0.5, 0.86, 0.5), h.at(0.68, 0.62, 0.58), h.r * 0.2, { r1: h.r * 0.13, melt: 0.7 });
  },
  curly: (kit, h) => {
    hairCap(kit, h, 0.98);
    for (const [i, [x, y, z]] of ([[0, 1.08, 0.2], [-0.66, 0.84, 0.16], [0.66, 0.84, 0.16], [-0.72, 0.5, -0.5], [0.72, 0.5, -0.5], [0, 0.78, -0.9]] as const).entries()) ball(kit, `curl.${String(i)}`, "hair", h.at(x, y, z), h.r * 0.42, { melt: 0.3 });
  },
  afro: (kit, h) => { ball(kit, "hair", "hair", h.at(AFRO_AT[0], AFRO_AT[1], AFRO_AT[2]), h.r * AFRO, { melt: 0.1, shadow: false }); },
  bob: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const x of [-1, 1]) put(kit, `bob.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.2), h.at(x * 0.82, -0.82, -0.14), h.r * 0.36, { r1: h.r * 0.3, melt: 0.6 });
    put(kit, "bob.back", "hair", h.at(0, 0.2, -0.76), h.at(0, -0.86, -0.72), h.r * 0.86, { melt: 0.6, flat: 0.6, up: FRONT });
  },
  long: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const x of [-1, 1]) put(kit, `lock.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.24), h.at(x * 0.92, -1.5, -0.2), h.r * 0.34, { r1: h.r * 0.2, melt: 0.6 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2.5, -0.96), h.r * 0.92, { r1: h.r * 0.56, flat: 0.5, up: FRONT, melt: 0.6 });
  },
  bun: (kit, h) => {
    hairCap(kit, h, 1);
    ball(kit, "bun", "hair", h.at(0, 1.26, -0.5), h.r * 0.42, { melt: 0.3 });
  },
  pony: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "tail", "hair", h.at(0, 0.7, -1.1), h.at(0, -1.5, -1.5), h.r * 0.3, { r1: h.r * 0.1, melt: 0.3 });
  },
  shag: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const [i, [x, z]] of ([[-0.9, 0.1], [0.9, 0.1], [-0.7, -0.6], [0.7, -0.6], [0, -0.96]] as const).entries()) put(kit, `lock.${String(i)}`, "hair", h.at(x, 0.4, z), h.at(x * 1.08, -0.95, z * 1.1), h.r * 0.34, { r1: h.r * 0.1, melt: 0.5 });
    put(kit, "fringe", "hair", h.at(-0.5, 0.74, 0.62), h.at(0.5, 0.74, 0.62), h.r * 0.24, { melt: 0.6 });
  },
  bangs: (kit, h) => {
    hairCap(kit, h, 1.02);
    put(kit, "fringe", "hair", h.at(-0.6, 0.66, 0.66), h.at(0.6, 0.66, 0.66), h.r * 0.36, { melt: 1.2 });
    for (const x of [-1, 1]) put(kit, `lock.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.24), h.at(x * 0.9, -1.3, -0.2), h.r * 0.32, { r1: h.r * 0.2, melt: 0.6 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2, -0.9), h.r * 0.9, { r1: h.r * 0.6, flat: 0.5, up: FRONT, melt: 0.6 });
  },
  wavy: (kit, h) => {
    hairCap(kit, h, 1.04);
    for (const x of [-1, 1]) for (const [i, y] of [0.1, -0.6, -1.3].entries()) ball(kit, `wave.${String(x)}.${String(i)}`, "hair", h.at(x * (0.86 + (i % 2) * 0.16), y, -0.2), h.r * (0.42 - i * 0.05), { melt: 1.2 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2, -0.9), h.r * 0.94, { r1: h.r * 0.66, flat: 0.5, up: FRONT, melt: 0.8 });
  },
  braids: (kit, h) => {
    hairCap(kit, h, 1);
    for (const x of [-1, 1]) for (let i = 0; i < 5; i += 1) ball(kit, `plait.${String(x)}.${String(i)}`, "hair", h.at(x * (0.86 - i * 0.03) + (i % 2) * 0.05, -0.4 - i * 0.4, 0), h.r * (0.2 - i * 0.012), { melt: 0.5 });
  },
  locs: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "locs", "hair", h.at(-0.95, 0.2, -0.5), h.at(0.95, 0.2, -0.5), h.r * 0.16, { row: 7, reach: [0, -h.r * 2.3, -h.r * 0.2] });
    put(kit, "locs.back", "hair", h.at(-0.6, 0.3, -1), h.at(0.6, 0.3, -1), h.r * 0.16, { row: 5, reach: [0, -h.r * 2.5, -h.r * 0.2] });
  },
  twintails: (kit, h) => {
    hairCap(kit, h, 1);
    for (const x of [-1, 1]) put(kit, `tail.${String(x)}`, "hair", h.at(x * 1, 0.6, -0.3), h.at(x * 1.34, -1.2, -0.4), h.r * 0.3, { r1: h.r * 0.1, melt: 0.3 });
  },
  undercut: (kit, h) => {
    put(kit, "hair", "hair", h.at(0, 0.84, -0.06), h.at(0, 0.7, -0.4), h.r * 0.74, { melt: 0.1, shadow: false });
    put(kit, "fringe", "hair", h.at(-0.34, 1.06, 0.56), h.at(0.5, 0.98, 0.62), h.r * 0.24, { melt: 0.6 });
  },
  mohawk: (kit, h) => { put(kit, "hair", "hair", h.at(0, 1.34, 0.5), h.at(0, 1.22, -0.92), h.r * 0.34, { flat: 0.34, up: SIDE, melt: 0.3 }); },
};

/** What each style comes to under a hat. */
const HATTED: Partial<Record<HairStyle, HairStyle>> = { afro: "crop", curly: "crop", mohawk: "crop", undercut: "crop", bun: "bob", twintails: "bob" };

/** A head for a renderer with few parts to spare: the same masses as `boneHead`, each stood for by one. */
function leanHead(kit: Kit, p: Person, h: HeadFrame): void {
  const b = p.face.bone, r = h.r, melt = meltBy(p), inX = b.gon - 0.13;
  put(kit, "maxilla", "skin", h.bone(0, 0.14, 0.3), h.bone(0, b.sto, 0.56), r * 0.6, { r1: r * 0.44, melt: melt(0.18) });
  put(kit, "floor", "skin", h.bone(0, b.gonY + 0.02, 0.08), h.bone(0, b.men + 0.22, 0.6), r * 0.34, { r1: r * 0.2, flat: 0.62, up: UP, melt: melt(0.1) });
  put(kit, "chin", "skin", h.bone(-Math.max(0.02, b.chin - 0.14), b.men + 0.16, b.pogZ - 0.14), h.bone(Math.max(0.02, b.chin - 0.14), b.men + 0.16, b.pogZ - 0.14), r * 0.14, { melt: melt(0.07) });
  for (const x of [-1, 1]) {
    ball(kit, `cheek.${String(x)}`, "skin", h.bone(x * 0.46, b.cheekY, 0.5), r * 0.24, { melt: melt(0.16) });
    ball(kit, `gonion.${String(x)}`, "skin", h.bone(x * inX, b.gonY + 0.1, 0.1), r * 0.2, { melt: melt(0.15) });
  }
}

/** A head for a mesh: the face's solid is `loftOf`'s, so only what stands on it is melted in: the chin's seat, and lips that catch the light. */
function boneHead(kit: Kit, p: Person, h: HeadFrame): void {
  const { lips, mouthWide: w, bone: b } = p.face, r = h.r, melt = meltBy(p);
  ball(kit, "chin", "skin", h.bone(0, b.men + 0.14, b.pogZ - 0.2), r * 0.13, { melt: melt(0.05) });
  put(kit, "lips.up", "skin", h.mark(-w * 0.62, b.sto + 0.05, 0.95), h.mark(w * 0.62, b.sto + 0.05, 0.95), r * 0.05 * mix(0.8, 1, b.m) * lips, { flat: 0.7, up: UP, melt: melt(0.05) });
  put(kit, "lips.low", "skin", h.mark(-w * 0.5, b.sto - 0.07, 0.94), h.mark(w * 0.5, b.sto - 0.07, 0.94), r * 0.065 * mix(0.8, 1, b.m) * lips, { flat: 0.75, up: UP, melt: melt(0.05) });
}

/** `rich` for a mesh, which can carry as many parts as it likes; sdf-body has only so many. */
function drawHead(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { head } = p.build, b = p.face.bone;
  const h = headFrame(s, head, p.face);
  // (The braincase, its lower end kept up so it never sets the width of the jaw.)
  put(kit, "skull", "skin", h.bone(0, 0.3, -1.12 + 1 / b.D), h.bone(0, 0.3, -0.06), head, { flat: 0.74 * b.W, up: SIDE });
  (rich ? boneHead : leanHead)(kit, p, h);
  drawEyes(kit, p, h);
  drawNose(kit, p, h);
  drawMouth(kit, p, h);
  drawEars(kit, p, h);
  drawFaceHair(kit, p, h, rich);
  HAIR_STYLES[p.outfit.hat === "none" ? p.hair : HATTED[p.hair] ?? p.hair](kit, h);
  drawHat(kit, p, h);
  if (p.outfit.costume === "fursuit") drawFur(kit, h);
}

// ---------------------------------------------------------------- a posed person

/** What a renderer needs of one person, posed: sdf-body takes it as it is. */
export interface PersonBody {
  readonly id: string;
  readonly capsules: readonly Capsule[];
  readonly palette: Readonly<Record<string, string>>;
  readonly at: Vec;
  readonly front: Vec;
  readonly skeleton: Skeleton;
  readonly eye: { readonly role: string; readonly lid: number; readonly slant: number; readonly color: string; readonly pupil: "round"; readonly ring: boolean; readonly spark: number; readonly white: string; readonly look: readonly [number, number] };
  readonly skin: { readonly role: string; readonly chroma: number; readonly flush: number; readonly depth: number };
  readonly material: { readonly sheen: number; readonly fuzz: number };
  readonly grain: {
    readonly kind: "fur";
    readonly size: number;
    readonly on: string;
    readonly lie: Vec;
    readonly pelt: {
      readonly flow: readonly { readonly a: Vec; readonly b: Vec; readonly long: readonly [number, number]; readonly up: Vec; readonly girth: number; readonly fall: number }[];
      readonly under: number;
      readonly thin: number;
      readonly crease: number;
      readonly root: string;
      readonly tint: number;
    };
  };
}

/** Where hair grows and how long, in grains: over the crown from the brow, down the back of the skull and past each ear. */
function hairFlow(p: Person, s: Skeleton): PersonBody["grain"]["pelt"]["flow"] {
  const h = headFrame(s, p.build.head, p.face);
  const { r } = h;
  const long = p.hair === "long" || p.hair === "bob" || p.hair === "pony" ? 1.5 : p.hair === "afro" || p.hair === "curly" ? 1.1 : 0.7;
  const bone = (a: Vec, b: Vec, ends: readonly [number, number], up: Vec): PersonBody["grain"]["pelt"]["flow"][number] => ({ a, b, long: ends, up, girth: r * 0.84, fall: 0.15 });
  return [
    bone(h.at(0, 0.8, 0.8), h.at(0, 0.7, -1), [0.5, long], UP),
    bone(h.at(0, 0.7, -1), h.at(0, -2.6, -1), [long, long], scale(FRONT, -1)),
    bone(h.at(-0.9, 0.6, 0), h.at(-0.9, -1.6, -0.2), [long * 0.8, long], scale(SIDE, -1)),
    bone(h.at(0.9, 0.6, 0), h.at(0.9, -1.6, -0.2), [long * 0.8, long], SIDE),
  ];
}

/** A blink every few seconds, each person on their own beat: the lid down fast and up a little slower. */
const hashed = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

function lidAt(p: Person, t: number): number {
  // (Each gap its own length, two to six seconds: nobody blinks like a clock.)
  let since = t + p.seed * 1.37, n = 0;
  for (let gap = 2 + 4 * hashed(p.seed, n); since > gap && n < 400; gap = 2 + 4 * hashed(p.seed, n)) { since -= gap; n += 1; }
  const shut = since < 0.07 ? since / 0.07 : since < 0.2 ? 1 - (since - 0.07) / 0.13 : 0;
  return mix(p.face.lid, 1, shut);
}

/** Where they are looking: mostly ahead, glancing off now and then, a slow wander and never a stare. */
function lookAt(p: Person, t: number): readonly [number, number] {
  const swing = Math.sin(t * 0.7 + p.seed);
  const glance = Math.abs(swing) > 0.92 ? Math.sign(swing) : 0;
  return [glance * 0.22 + Math.sin(t * 0.31 + p.seed * 2.1) * 0.06, Math.sin(t * 0.23 + p.seed) * 0.06];
}

/** How far through a beat a person is at `t`: no two in step. */
const phaseOf = (p: Person, action: Action, t: number): number => t * strideOf(p, action) * TAU + (MOTIONS[action].own === true ? p.gait.offset : 0);

/** Strides a second, as this person takes them. */
export const strideOf = (p: Person, action: Action): number => MOTIONS[action].beat * (MOTIONS[action].own === true ? p.gait.cadence : 1);

/** Turned about the vertical by `yaw`, and stood at `at`. */
const placed = (v: Vec, at: Vec, yaw: number): Vec => [at[0] + v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), at[1] + v[1], at[2] - v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];

const turned = (c: Capsule, at: Vec, yaw: number, size: number): Capsule => ({
  ...c,
  a: placed(scale(c.a, size), at, yaw),
  b: placed(scale(c.b, size), at, yaw),
  r: c.r * size,
  ...(c.r1 === undefined ? {} : { r1: c.r1 * size }),
  ...(c.hem === undefined ? {} : { hem: c.hem * size + at[1] }),
  ...(c.reach ? { reach: placed(scale(c.reach, size), [0, 0, 0], yaw) } : {}),
  ...(c.up ? { up: placed(c.up, [0, 0, 0], yaw) } : {}),
});

/** A person in an action at time `t`, seconds, standing at `at` and turned by `yaw`. */
export const posePerson = (p: Person, action: Action, t: number, at: Vec = [0, 0, 0], yaw = 0): PersonBody => bodyOf(p, action, t, at, yaw, false);

/** A posed person, with the head a mesh is built from if `rich`, or the one that costs a raymarcher few parts. */
function bodyOf(p: Person, action: Action, t: number, at: Vec, yaw: number, rich: boolean): PersonBody {
  const phase = phaseOf(p, action, t);
  const s = skeletonOf(p, action, phase);
  const kit: Kit = [];
  drawTorso(kit, p, s);
  drawArm(kit, p, s.left.arm, -1);
  drawArm(kit, p, s.right.arm, 1);
  drawLeg(kit, p, s.left.leg, "L");
  drawLeg(kit, p, s.right.leg, "R");
  drawClothes(kit, p, s, rich);
  drawHead(kit, p, s, rich);
  return {
    id: `person.${String(p.seed)}`,
    capsules: kit.map((c) => turned(c, at, yaw, p.build.size)),
    palette: p.palette,
    at,
    front: placed(FRONT, [0, 0, 0], yaw),
    skeleton: s,
    eye: { role: "eye", lid: lidAt(p, t), slant: p.face.slant, color: p.palette.skin ?? "#c89878", pupil: "round", ring: false, spark: 0.13, white: "#ece6dc", look: lookAt(p, t) },
    skin: { role: "skin", chroma: 0.8, flush: 0.15, depth: 1 },
    material: { sheen: 0.12, fuzz: 0.2 },
    grain: {
      kind: "fur",
      size: 0.018 * p.build.size,
      on: "hair",
      lie: [0, -1, -0.5],
      pelt: {
        flow: hairFlow(p, s).map((b) => ({ ...b, a: placed(scale(b.a, p.build.size), at, yaw), b: placed(scale(b.b, p.build.size), at, yaw), up: placed(b.up, [0, 0, 0], yaw), girth: b.girth * p.build.size })),
        under: 0.45,
        thin: 0.2,
        crease: 0.3,
        root: "#3a2a22",
        tint: 0.06,
      },
    },
  };
}

// ---------------------------------------------------------------- the skinned mesh

/** Every bone, in the order a pose's matrices come: its joint, the way it runs, and what of a skeleton gives them. */
/** How much of a forward swing the back of a skirt takes: drawn under the thighs of someone sitting, not left hanging behind them. */
const BACK_DRAWN = 0.5;
/** How much of the thigh's length a panel is: what lies on a lap from a hinge ahead of the hips reaches the knee and no further. */
const PANEL_LONG = 0.72;
/** Where a panel hinges, in front of or behind the hips by their width, the front over the top of the thighs: on the surface, so what turns lies on the lap and not under it. */
const HINGE_OUT = 0.6, HINGE_UP = 0.11;
/** How far the front of a skirt is shoved ahead of a leg coming forward, of how far the knee has come. */
const PUSHED = 0.4, PUSHED_MOST = 0.05;

/** A panel of a skirt, from between the hips to level with the knees: the front is pushed by whichever leg leads, the back by whichever trails, so neither leg ever comes through it. */
function panelOf(s: Skeleton, side: 1 | -1): readonly [Vec, Vec] {
  const { left, right } = s, from = lerpV(left.leg.hip, right.leg.hip, 0.5);
  const swings = [left, right].map(({ leg }) => sub(leg.knee, leg.hip)), lead = swings.reduce((a, b) => (b[2] * side > a[2] * side ? b : a));
  const z = (lead[2] * side > 0 ? lead[2] : side > 0 ? 0 : Math.max(0, lead[2]) * BACK_DRAWN) * PANEL_LONG;
  const span = Math.hypot(...lead) * PANEL_LONG, down = Math.sqrt(Math.max(0, span * span - z * z));
  const hinge = add(from, [0, side > 0 ? HINGE_UP : 0, side * Math.abs(left.leg.hip[0] - right.leg.hip[0]) * HINGE_OUT + (side > 0 ? Math.min(z * PUSHED, PUSHED_MOST) : 0)]);
  return [hinge, add(hinge, [0, -down, z])];
}

/** Below the knees cloth has nothing under it, and falls straight down. */
function hangOf(s: Skeleton, side: 1 | -1): readonly [Vec, Vec] {
  const [, end] = panelOf(s, side);
  return [end, add(end, [0, -0.3, 0])];
}

const BONES: readonly (readonly [string, (s: Skeleton) => readonly [Vec, Vec]])[] = [
  ["pelvis", (s) => [s.pelvis, s.waist]],
  ["spine", (s) => [s.waist, s.chest]],
  ["chest", (s) => [s.chest, s.neck]],
  ["neck", (s) => [s.neck, s.head]],
  ["head", (s) => [s.head, add(s.head, sub(s.head, s.neck))]],
  ...(["left", "right"] as const).flatMap((side) => {
    const L = side === "left" ? "L" : "R";
    return [
      [`upper.${L}`, (s: Skeleton) => [s[side].arm.shoulder, s[side].arm.elbow]],
      [`fore.${L}`, (s: Skeleton) => [s[side].arm.elbow, s[side].arm.wrist]],
      [`hand.${L}`, (s: Skeleton) => [s[side].arm.wrist, s[side].arm.hand]],
      [`thigh.${L}`, (s: Skeleton) => [s[side].leg.hip, s[side].leg.knee]],
      [`shin.${L}`, (s: Skeleton) => [s[side].leg.knee, s[side].leg.ankle]],
      [`foot.${L}`, (s: Skeleton) => [s[side].leg.ankle, s[side].leg.toe]],
    ] as readonly (readonly [string, (s: Skeleton) => readonly [Vec, Vec]])[];
  }),
  // (Last, so the bones before keep their numbers. A hand's fingers on their own bone, so it can open and shut.)
  ["fingers.L", (s) => [s.left.arm.hand, s.left.arm.tip]],
  ["fingers.R", (s) => [s.right.arm.hand, s.right.arm.tip]],
  ["tips.L", (s) => [s.left.arm.tip, s.left.arm.nail]],
  ["tips.R", (s) => [s.right.arm.tip, s.right.arm.nail]],
  ["toes.L", (s) => [s.left.leg.toe, s.left.leg.end]],
  ["toes.R", (s) => [s.right.leg.toe, s.right.leg.end]],
  ["thumb.L", (s) => [s.left.arm.wrist, s.left.arm.thumb]],
  ["thumb.R", (s) => [s.right.arm.wrist, s.right.arm.thumb]],
  // (Cloth has no bones of its own in a body: these are the legs as a skirt feels them.)
  ["skirt.front", (s) => panelOf(s, 1)],
  ["skirt.back", (s) => panelOf(s, -1)],
  ["hang.front", (s) => hangOf(s, 1)],
  ["hang.back", (s) => hangOf(s, -1)],
];

export const BONE_COUNT = BONES.length;

const boneIndex = (name: string): number => BONES.findIndex(([bone]) => bone === name);

/** The forearms, which take half a hand's roll. */
const FOREARMS: ReadonlyMap<number, "left" | "right"> = new Map([[boneIndex("fore.L"), "left"], [boneIndex("fore.R"), "right"]]);

/** The bones of a hand, and whose knuckles they turn with. */
const HAND_BONES: ReadonlyMap<number, "left" | "right"> = new Map((["left", "right"] as const).flatMap((side) => ["hand", "fingers", "tips", "thumb"].map((bone) => [boneIndex(`${bone}.${side === "left" ? "L" : "R"}`), side] as const)));

const PART_BONES: readonly (readonly [RegExp, (side: string) => string])[] = [
  [/^arm\.([LR])/, (L) => `upper.${L}`],
  [/^fore\.([LR])/, (L) => `fore.${L}`],
  [/^tips\.([LR])/, (L) => `tips.${L}`],
  [/^fingers\.([LR])/, (L) => `fingers.${L}`],
  [/^thumb\.([LR])/, (L) => `thumb.${L}`],
  [/^palm\.([LR])/, (L) => `hand.${L}`],
  [/^thigh\.([LR])/, (L) => `thigh.${L}`],
  [/^shin\.([LR])/, (L) => `shin.${L}`],
  [/^boot\.([LR])/, (L) => `shin.${L}`],
  [/^(?:shoe|toe|sole)\.([LR])/, (L) => `foot.${L}`],
  [/^(hips|skirt|brush)/, () => "pelvis"],
  [/^belly/, () => "spine"],
  [/^(ribs|bust|yoke|hood|collar)/, () => "chest"],
  [/^neck/, () => "neck"],
];

/** The bone a drawn part hangs from; whatever is on the head, by default. */
function boneOfPart(part: string): number {
  for (const [match, name] of PART_BONES) {
    const hit = match.exec(part);
    if (hit) return boneIndex(name(hit[1] ?? ""));
  }
  return boneIndex("head");
}

const HEAD = boneIndex("head");
const ARM_BONES = new Set(BONES.flatMap(([name], i) => (/^(upper|fore|hand|fingers|tips|thumb)\./.test(name) ? [i] : [])));
const PELVIS = boneIndex("pelvis");

/** A row of digits as the capsules it stands for. */
const unrolled = (c: Capsule): readonly Capsule[] => {
  const { row, reach } = c;
  if (!row || !reach) return [c];
  return Array.from({ length: row }, (_, i) => {
    const at = lerpV(c.a, c.b, i / (row - 1));
    return { part: c.part, role: c.role, a: at, b: add(at, reach), r: c.r, r1: c.r * 0.72, melt: 0.25 };
  });
};

/** A part's distance from a point, as sdf-body draws it. */
function partDistance(c: Capsule, x: number, y: number, z: number): number {
  const ax = x - c.a[0], ay = y - c.a[1], az = z - c.a[2];
  const bx = c.b[0] - c.a[0], by = c.b[1] - c.a[1], bz = c.b[2] - c.a[2];
  const l2 = Math.max(bx * bx + by * by + bz * bz, 1e-9);
  const h = clamp((ax * bx + ay * by + az * bz) / l2, 0, 1);
  const r1 = c.r1 ?? c.r;
  const r = mix(c.r, r1, h);
  let vx = ax - bx * h, vy = ay - by * h, vz = az - bz * h;
  const f = c.flat ?? 1;
  const u = c.up ?? UP;
  const slope = 1 / Math.sqrt(1 + (c.r - r1) ** 2 / l2);
  if (f >= 0.998) return (Math.hypot(vx, vy, vz) - r) * slope;
  const t = (vx * u[0] + vy * u[1] + vz * u[2]) * (1 / f - 1);
  vx += u[0] * t; vy += u[1] * t; vz += u[2] * t;
  return (Math.hypot(vx, vy, vz) - r) * f * slope;
}

/** How far an empty cell counts as being from any surface. */
const FAR = 1e3;

interface Grid { readonly min: Vec; readonly h: number; readonly n: readonly [number, number, number]; readonly field: Float32Array; readonly owner: Int16Array }

function gridOver(parts: readonly Capsule[], h: number): Grid {
  const pad = (c: Capsule): number => Math.max(c.r, c.r1 ?? 0);
  const low = (i: number): number => Math.min(...parts.map((c) => Math.min(c.a[i] ?? 0, c.b[i] ?? 0) - pad(c)));
  const high = (i: number): number => Math.max(...parts.map((c) => Math.max(c.a[i] ?? 0, c.b[i] ?? 0) + pad(c)));
  const min: Vec = [low(0) - h * 3, low(1) - h * 3, low(2) - h * 3];
  const n: [number, number, number] = [0, 1, 2].map((i) => Math.ceil((high(i) - low(i)) / h) + 6) as [number, number, number];
  const size = n[0] * n[1] * n[2];
  return { min, h, n, field: new Float32Array(size).fill(FAR), owner: new Int16Array(size).fill(-1) };
}

/** One part melted into the field, over only the cells it can reach. */
function meltIn(grid: Grid, c: Capsule, index: number): void {
  const { min, h, n, field, owner } = grid;
  const k = Math.max(Math.min(0.03 * (c.melt ?? 1), (c.r + (c.r1 ?? c.r)) * 0.4), 1e-5);
  const pad = Math.max(c.r, c.r1 ?? 0) + k * 2 + h * 2;
  const span = (i: number): readonly [number, number] => [
    Math.max(0, Math.floor((Math.min(c.a[i] ?? 0, c.b[i] ?? 0) - pad - (min[i] ?? 0)) / h)),
    Math.min((n[i] ?? 1) - 1, Math.ceil((Math.max(c.a[i] ?? 0, c.b[i] ?? 0) + pad - (min[i] ?? 0)) / h)),
  ];
  const [x0, x1] = span(0), [y0, y1] = span(1), [z0, z1] = span(2);
  const row = (y: number, z: number): void => {
    for (let x = x0; x <= x1; x += 1) {
      const at = x + y * n[0] + z * n[0] * n[1];
      const d = Math.max(partDistance(c, min[0] + x * h, min[1] + y * h, min[2] + z * h), (c.hem ?? -FAR) - (min[1] + y * h));
      const was = field[at] ?? FAR;
      const w = clamp(0.5 + (0.5 * (was - d)) / k, 0, 1);
      field[at] = mix(was, d, w) - k * w * (1 - w);
      if (w > 0.5) owner[at] = index;
    }
  };
  for (let z = z0; z <= z1; z += 1) for (let y = y0; y <= y1; y += 1) row(y, z);
}

/** A cell's twelve edges: a corner, and the way the edge runs from it. */
const CELL_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [0, 1].flatMap((u) => [0, 1].flatMap((v) => [[0, u, v, 1, 0, 0], [u, 0, v, 0, 1, 0], [u, v, 0, 0, 0, 1]] as const));

/** A cell's surface point, the mean of where its edges cross the surface; null if none do. */
function cellPoint(grid: Grid, x: number, y: number, z: number): Vec | null {
  const { n, field, min, h } = grid;
  const value = (i: number, j: number, k: number): number => field[x + i + (y + j) * n[0] + (z + k) * n[0] * n[1]] ?? FAR;
  let sum: Vec = [0, 0, 0], hits = 0;
  for (const [i, j, k, ax, ay, az] of CELL_EDGES) {
    const a = value(i, j, k), b = value(i + ax, j + ay, k + az);
    if (a < 0 === b < 0) continue;
    const t = a / (a - b);
    sum = add(sum, [i + ax * t, j + ay * t, k + az * t]);
    hits += 1;
  }
  if (!hits) return null;
  return [min[0] + (x + sum[0] / hits) * h, min[1] + (y + sum[1] / hits) * h, min[2] + (z + sum[2] / hits) * h];
}

/** A vertex's two bones and the first's share: the nearest part's, and the nearest of any other bone's, blended across a joint. */
function weightsAt(parts: readonly Capsule[], bones: readonly number[], at: Vec): readonly [number, number, number] {
  let first = 0, near = FAR, second = 0, next = FAR;
  const best = new Map<number, number>();
  parts.forEach((c, i) => {
    const bone = bones[i] ?? 0;
    const d = partDistance(c, at[0], at[1], at[2]);
    if (d < (best.get(bone) ?? FAR)) best.set(bone, d);
  });
  for (const [bone, d] of best) {
    if (d < near) { second = first; next = near; first = bone; near = d; continue; }
    if (d < next) { second = bone; next = d; }
  }
  return [first, second, clamp(0.5 + (next - near) / 0.14, 0.5, 1)];
}

/** How thick a leg is at the hip, knee and ankle to what hangs over it, a little more than it really is, for the cloth to clear it. */
const LEG_THICK = [0.1, 0.07, 0.055] as const;

function legsOf(p: Person): PersonMesh["legs"] {
  const { left, right } = restSkeleton(p), wide = limbWide(p.build), size = p.build.size;
  const joints = [left, right].flatMap(({ leg }) => [leg.hip, leg.knee, leg.ankle].flatMap((at, i) => [...scale(at, size), (LEG_THICK[i] ?? 0) * wide * size]));
  return { bones: [boneIndex("thigh.L"), boneIndex("shin.L"), boneIndex("thigh.R"), boneIndex("shin.R")], joints, cloth: boneIndex("skirt.front") };
}

/** A person's mesh, at rest: what `poseMesh` moves. Colours are by `roles`, one per vertex, from `palette`. */
export interface PersonMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Each vertex's index into `roles`. */
  readonly role: Uint8Array;
  readonly roles: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  /** Two bones a vertex, and the first's weight. */
  readonly bones: Uint8Array;
  readonly weight: Float32Array;
  /** What each vertex is: one of `FABRICS`. */
  readonly fabric: Uint8Array;
  /** How free of the body it hangs, 0 to 1. */
  readonly loose: Float32Array;
  /** Four a vertex, how cloth lies on it: where it is round its limb (x, z off the limb's line), how far along it, and how far from the garment's edge in metres. */
  readonly cloth: Float32Array;
  /** How open each vertex lies to the light, 0 down in a crease to 1 in the open, and a little over 1 where a face is lit from within it: nothing clamps it. */
  readonly shade: Float32Array;
  /** How much soft flesh rides on it, 0 to 1: what `jiggleAt` moves. */
  readonly soft: Float32Array;
  readonly index: Uint32Array;
  /** Where each eye sits at rest, and how big, and the mouth: what the face is painted from. */
  /** What cloth may never be inside: its renderer pushes it out, whatever the pose. */
  readonly legs: { readonly bones: readonly [number, number, number, number]; readonly joints: readonly number[]; readonly cloth: number };
  readonly face: { readonly eyes: readonly [Vec, Vec]; readonly eye: number; readonly mouth: Vec; readonly mouthWide: number; readonly head: number; readonly iris: string; readonly lip: string; readonly brow: string; readonly browLine: readonly [number, number, number, number]; readonly look: Partial<Look> & { readonly seed?: number }; readonly lash: string; readonly white: string };
}

function normalAt(grid: Grid, x: number, y: number, z: number): Vec {
  const { n, field } = grid;
  const at = (i: number, j: number, k: number): number => field[x + i + (y + j) * n[0] + (z + k) * n[0] * n[1]] ?? FAR;
  return unit([at(1, 0, 0) - at(-1, 0, 0) + at(2, 0, 0) - at(0, 0, 0), at(0, 1, 0) - at(0, -1, 0) + at(0, 2, 0) - at(0, 0, 0), at(0, 0, 1) - at(0, 0, -1) + at(0, 0, 2) - at(0, 0, 0)], UP);
}

/** Each cell of a grid, skipping its rim. */
function eachCell(n: Grid["n"], visit: (x: number, y: number, z: number) => void): void {
  for (let z = 1; z < n[2] - 2; z += 1) for (let y = 1; y < n[1] - 2; y += 1) for (let x = 1; x < n[0] - 2; x += 1) visit(x, y, z);
}

/** Quads between the cells round each grid edge that crosses the surface. */
function netFaces(grid: Grid, cells: Int32Array): number[] {
  const { n, field } = grid;
  const nx = n[0], nxy = n[0] * n[1];
  const out: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    const [v0, v1, v2, v3] = [cells[a] ?? -1, cells[b] ?? -1, cells[c] ?? -1, cells[d] ?? -1];
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) out.push(v0, v1, v2, v0, v2, v3); else out.push(v0, v2, v1, v0, v3, v2);
  };
  eachCell(n, (x, y, z) => {
    const i = x + y * nx + z * nxy;
    const here = (field[i] ?? FAR) < 0;
    if (here !== (field[i + 1] ?? FAR) < 0) quad(i, i - nxy, i - nxy - nx, i - nx, !here);
    if (here !== (field[i + nx] ?? FAR) < 0) quad(i, i - 1, i - 1 - nxy, i - nxy, !here);
    if (here !== (field[i + nxy] ?? FAR) < 0) quad(i, i - nx, i - nx - 1, i - 1, !here);
  });
  return out;
}

/** The bones of a rest pose, inverted: what takes a vertex from rest back to its bone's own frame. */
const restSkeleton = (p: Person): Skeleton => skeletonOf(p, "rest", 0);

/** What the mesh's renderer paints per pixel, sharper than any vertex. */
const FACE_PAINT = /^(mouth|brow|shirt|tie)/;

interface Net { readonly position: number[]; readonly normal: number[]; readonly role: number[]; readonly bones: number[]; readonly weight: number[]; readonly fabric: number[]; readonly loose: number[]; readonly cloth: number[]; readonly soft: number[]; readonly index: number[] }

/** What owns a surface cell: its own part, or a neighbour's on the far side of the surface. */
function ownerOf(grid: Grid, parts: readonly Capsule[], i: number): Capsule | undefined {
  const [nx, ny] = grid.n;
  return [i, i + 1, i + nx, i + nx * ny].map((c) => parts[grid.owner[c] ?? -1]).find(Boolean);
}

/** What a layer of a person is made of and how it hangs. */
interface Layer {
  readonly parts: readonly Capsule[];
  /** Grid size, as a share of the body's. */
  readonly fine: number;
  /** What the renderer dresses it in. */
  readonly fabric: number;
  /** How far it stands off the body beneath it. */
  readonly lift: number;
  /** A solid melted in straight after the skull. */
  readonly loft?: Loft;
  /** What is pressed into its surface once it is melted. */
  readonly dents?: readonly Dent[];
  /** Where its fixed mesh goes, for a head near enough to want one. */
  readonly wrap?: Wrap;
  /** Whether it rides the head's bone alone: a jaw sits so near a short neck that it would otherwise go with that. */
  readonly rigid?: boolean;
  /** Locks on its surface, round the head at `head`. */
  readonly locks?: { readonly head: Vec; readonly kind: "strand" | "curl" | "tuft"; readonly size: number };
  /** What is worn over it: a body is not built where none of it can be seen. */
  readonly under?: readonly Capsule[];
  /** How near one of those a vertex of it may come; inside them when under nought. */
  readonly tuck?: number;
  /** How many times its surface is relaxed, so what melted together leaves no crease. */
  readonly relax?: number;
  /** Nothing of it is built above this height: what is under a hat stays under the hat. */
  readonly roof?: number;
  /** Where it starts to hang free, and how far down it is wholly free: nothing above `from` moves on its own. */
  readonly free?: readonly [from: number, span: number];
}

/** A hollow or a rise pressed into a finished surface, a little way round `at`: what is melted in can only add, and bone needs both. */
interface Dent { readonly at: Vec; readonly r: Vec; readonly by: number }

/** Each dent let into the field, over only the cells it can reach. */
function dented(grid: Grid, dents: readonly Dent[]): void {
  const { n, field, min, h } = grid;
  for (const d of dents) {
    const box = (i: number): readonly [number, number] => [Math.max(1, Math.floor(((d.at[i] ?? 0) - (d.r[i] ?? 0) - (min[i] ?? 0)) / h)), Math.min((n[i] ?? 3) - 2, Math.ceil(((d.at[i] ?? 0) + (d.r[i] ?? 0) - (min[i] ?? 0)) / h))];
    const [x0, x1] = box(0), [y0, y1] = box(1), [z0, z1] = box(2);
    const row = (y: number, z: number): void => {
      const b = (min[1] + y * h - d.at[1]) / d.r[1], c = (min[2] + z * h - d.at[2]) / d.r[2], rest = b * b + c * c;
      for (let x = x0; x <= x1; x += 1) {
        const a = (min[0] + x * h - d.at[0]) / d.r[0], q = a * a + rest, i = x + y * n[0] + z * n[0] * n[1];
        if (q < 1) field[i] = (field[i] ?? FAR) - d.by * (1 - q) * (1 - q);
      }
    };
    for (let z = z0; z <= z1; z += 1) for (let y = y0; y <= y1; y += 1) row(y, z);
  }
}

/** A run through knots, `at` rising, that goes no further than they do between them: an outline with no wobble in it. */
function eased(knots: readonly (readonly [number, number])[]): (at: number) => number {
  const gap = knots.slice(1).map(([x, y], i) => { const [px = 0, py = 0] = knots[i] ?? []; return [x - px, (y - py) / (x - px)] as const; });
  const lean = knots.map((_, i) => {
    const a = gap[i - 1]?.[1] ?? gap[i]?.[1] ?? 0, b = gap[i]?.[1] ?? a;
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return (at) => {
    const next = clamp(knots.findIndex(([x]) => x > at), 1, knots.length - 1), [x0 = 0, y0 = 0] = knots[next - 1] ?? [], [x1 = 1, y1 = 0] = knots[next] ?? [], w = x1 - x0, t = clamp((at - x0) / w, 0, 1);
    return (2 * t ** 3 - 3 * t * t + 1) * y0 + (t ** 3 - 2 * t * t + t) * w * (lean[next - 1] ?? 0) + (3 * t * t - 2 * t ** 3) * y1 + (t ** 3 - t * t) * w * (lean[next] ?? 0);
  };
}

/** One slice of a face, level, in head radii: how wide, where it is widest, how far forward of that and how far back. */
interface Slice { readonly x: number; readonly at: number; readonly front: number; readonly back: number }

/** How wide a face runs at each height, chin to crown. */
function widthOf(b: Bone): (y: number) => number {
  const under = b.men + 0.16, midJaw = (under + b.gonY) / 2;
  return eased([[b.men - 0.02, b.chin * 0.92], [under, b.chin + 0.06], [midJaw, mix(b.gon, b.chin, 0.37)], [b.gonY, b.gon], [(b.gonY + b.cheekY) / 2, b.mid], [b.cheekY, b.zyg], [0.3, b.tem], [0.62, b.tem * 0.86], [0.86, 0.46]]);
}

/** How far forward a face lies at each height, down its middle before a nose: brow, the dip at the eyes, the fullness of the mouth, the fold over the chin. */
function depthOf(b: Bone): (y: number) => number {
  const under = b.men + 0.16, muzzle = mix(0.95, 1, b.m);
  return eased([[b.men - 0.02, b.pogZ - 0.06], [under, b.pogZ], [(under + b.sto) / 2, Math.min(b.pogZ, muzzle) - 0.045], [b.sto, muzzle], [b.sub, muzzle - 0.01], [b.pupil - 0.32, 0.91], [b.pupil, 0.84], [b.pupil + 0.2, 0.9], [0.62, 0.9], [0.86, 0.66]]);
}

/** A face's slices: below its corners the jaw draws forward to the chin, and at the chin all of it rounds off to nothing. */
function slicesOf(b: Bone): (y: number) => Slice {
  const wide = widthOf(b), deep = depthOf(b), low = b.men + 0.17, curl = 2.3 + (b.plane - 2) * 1.2;
  return (y) => {
    const t = clamp((b.gonY - y) / (b.gonY - b.men), 0, 1), end = clamp((low - y) / (low - b.men), 0, 1), round = (1 - end ** curl) ** (1 / curl);
    const at = mix(b.gonZ + 0.04, b.pogZ - 0.3, t ** 1.2), rear = mix(b.gonZ - 0.24, b.pogZ - 0.46, t ** 0.9);
    return { x: Math.max(0.01, wide(y) * round), at, front: Math.max(0.01, (deep(y) - at) * round), back: Math.max(0.01, (at - rear) * round) };
  };
}

/** A face's solid as a distance from it, slice by slice. */
interface Loft { readonly from: number; readonly to: number; readonly slice: (y: number) => (x: number, z: number) => number; readonly melt: number }

function loftOf(p: Person): Loft {
  const b = p.face.bone, size = p.build.size, c = scale(headFrame(restSkeleton(p), p.build.head, p.face).c, size), R = p.build.head * size, slices = slicesOf(b);
  const slice = (Y: number): ((x: number, z: number) => number) => {
    const local = (Y - c[1]) / R, s = slices(local < 0 ? local / b.L : local), least = Math.max(0.14, Math.min(s.x, s.front));
    return (X, Z) => {
      const z = (Z - c[2]) / R, along = (z < 0 ? z / b.D : z) - s.at, power = along > 0 ? mix(2, b.plane, 0.3) : 2;
      return (((Math.abs(X - c[0]) / (R * b.W * s.x)) ** power + (Math.abs(along) / (along > 0 ? s.front : s.back)) ** power) ** (1 / power) - 1) * least * R;
    };
  };
  return { from: c[1] + (b.men - 0.02) * b.L * R, to: c[1] + 0.86 * R, slice, melt: 0.1 * R };
}

/** A loft melted into the field, as a part is. */
function lofted(grid: Grid, loft: Loft): void {
  const { min, h, n } = grid, k = loft.melt;
  for (let y = 0; y < n[1]; y += 1) {
    const Y = min[1] + y * h;
    if (Y < loft.from || Y > loft.to) continue;
    const at = loft.slice(Y);
    for (let z = 0; z < n[2]; z += 1) meltRow(grid, y, z, (x) => at(min[0] + x * h, min[2] + z * h), k);
  }
}

function meltRow(grid: Grid, y: number, z: number, distance: (x: number) => number, k: number): void {
  const { n, field } = grid;
  for (let x = 0; x < n[0]; x += 1) {
    const i = x + y * n[0] + z * n[0] * n[1], d = distance(x), was = field[i] ?? FAR, w = clamp(0.5 + (0.5 * (was - d)) / k, 0, 1);
    field[i] = mix(was, d, w) - k * w * (1 - w);
  }
}

/** The bone a face shows, as dents on the rest head: brow, cheekbone, sockets, the hollows under them, the root of the nose, the fold over the chin and the chin itself. */
function dentsOf(p: Person, eyed = false): readonly Dent[] {
  if (p.outfit.costume === "fursuit") return [];
  const b = p.face.bone, size = p.build.size, g = headFrame(restSkeleton(p), p.build.head, p.face), R = p.build.head * size;
  const dent = (x: number, y: number, z: number, r: Vec, by: number): Dent => ({ at: scale(g.bone(x, y, z), size), r: scale(r, R), by: by * R });
  const pair = (x: number, y: number, z: number, r: Vec, by: number): readonly Dent[] => [dent(-x, y, z, r, by), dent(x, y, z, r, by)];
  return [
    ...pair(0.29, b.pupil + 0.22, 0.96, [0.25, 0.12, 0.3], b.ridge),
    ...pair(0.5, b.cheekY, 0.66, [0.24, 0.17, 0.3], b.cheek),
    ...pair(0.36, b.pupil, 0.86, [0.21, 0.13, 0.3], (-0.045 - b.orbit) * (eyed ? 0.4 : 1)),
    ...pair(0.54, -0.44, 0.56, [0.26, 0.2, 0.34], (-b.hollow - b.old * 0.02) * (eyed ? 0.55 : 1)),
    ...(b.old ? pair(0.63, 0.42, 0.48, [0.2, 0.25, 0.32], -0.05 * b.old) : []),
    dent(0, b.pupil + 0.02, 0.96, [0.14, 0.1, 0.22], -0.05 * mix(0.5, 1, b.m) * (1 - b.old * 0.5)),
    dent(0, b.men + 0.27, b.pogZ - 0.05, [0.24, 0.075, 0.25], -0.04 * mix(0.4, 1, b.m)),
    dent(0, 1.34, -0.1, [0.95, 0.4, 1.05], -(styleOf(p) === "bald" ? 0.13 : 0.05) * b.m),
    dent(0, b.men + 0.14, b.pogZ, [0.2, 0.11, 0.22], 0.03 * mix(0.3, 1, b.m)),
  ];
}

/** Locks on a hair's surface, how it should lie round `at`: `strand` ridges down from the crown, `curl` all over. */
function roughen(grid: Grid, at: Vec, kind: "strand" | "curl" | "tuft", size: number): void {
  const { n, field, min, h } = grid;
  const f = 170 / size;
  eachCell(n, (x, y, z) => {
    const i = x + y * n[0] + z * n[0] * n[1];
    const was = field[i] ?? FAR;
    if (Math.abs(was) > 0.03) return;
    const px = min[0] + x * h - at[0], py = min[1] + y * h - at[1], pz = min[2] + z * h - at[2];
    const line = Math.sin(Math.atan2(px, pz) * 26 + py * 11 / size + Math.sin(py * 26 / size) * 0.7) * 0.0042 * size;
    // (Each axis pushed about by the others, or the bumps fall in rows and a small head of them is a checkerboard.)
    const wx = px * f + 1.6 * Math.sin(py * f * 0.41 + pz * f * 0.29), wy = py * f + 1.6 * Math.sin(pz * f * 0.37 - px * f * 0.31 + 2), wz = pz * f + 1.6 * Math.sin(px * f * 0.43 + py * f * 0.23 + 4);
    const bump = (Math.sin(wx) * Math.sin(wy * 1.37 + 1.3) * Math.sin(wz * 0.83 + 0.7) + 0.5 * Math.sin((wx + wy) * 1.9) * Math.sin((wz - wy) * 2.3)) * size;
    field[i] = was - (kind === "strand" ? line : bump * (kind === "tuft" ? 0.011 : 0.006));
  });
}


const inflated = (c: Capsule, by: number): Capsule => ({ ...c, r: c.r + by, ...(c.r1 === undefined ? {} : { r1: c.r1 + by }) });

/** Front to back across a skirt's depth, and how far it takes. */
const PANEL_DEEP = 0.16;
/** How far either side of a panel's end cloth goes over from lying to hanging. */
const KNEE_BLEND = 0.08;

/** A skirt goes with its two panels, front and back meeting at the sides, and below `knee` it hangs from them. Its own folds and sway come from `free`. */
function skirtWeights(at: Vec, knee = -FAR, hinge = FAR): readonly [number, number, number] {
  if (at[1] > hinge) return [PELVIS, PELVIS, 1];
  const blend = (at[1] - knee + KNEE_BLEND) / (2 * KNEE_BLEND);
  if (blend > 0 && blend < 1) { const panel = at[2] < 0 ? "back" : "front"; return [boneIndex(`skirt.${panel}`), boneIndex(`hang.${panel}`), blend * blend * (3 - 2 * blend)]; }
  const low = at[1] < knee;
  return [boneIndex(low ? "hang.front" : "skirt.front"), boneIndex(low ? "hang.back" : "skirt.back"), clamp(0.5 + at[2] / PANEL_DEEP, 0, 1)];
}

/** Whether something over a layer leaves this point of it out of sight. */
const unseen = (layer: Layer, at: Vec): boolean => at[1] > (layer.roof ?? FAR) || (layer.under?.some((c) => partDistance(c, at[0], at[1], at[2]) < (layer.tuck ?? 0.012)) ?? false);

/** Where a head's fixed mesh goes: its centre and radius in metres, and each landmark it is laid through, in head radii, as they lie on the finished head. */
interface Wrap {
  readonly c: Vec;
  readonly R: number;
  readonly eyeX: number;
  readonly eye: number;
  readonly pupil: number;
  readonly sn: number;
  readonly sto: number;
  readonly men: number;
  readonly mouth: number;
  /** The neck it runs down into, as `lower` meets it: how far back its middle lies, how wide it is and how deep behind, all in head radii. */
  readonly neck: readonly [z: number, wide: number, back: number];
  /** How many times its rows and columns are halved. */
  readonly level: number;
}

/** How far round a landmark `x` lies, and how high a landmark `y`, seen from a head's centre on a face about a radius off. */
const bearing = (v: number): number => Math.atan2(v, 0.95);
/** How far an eye opens at `u` eyes outward of its middle, up and down: the same almond the renderer paints, set a little down at its inner end. */
function lidsAt(u: number): readonly [number, number] {
  const w = 1.42, k = clamp(1 - (u * u) / (w * w), 0, 1), m = clamp(-u / w, -1.4, 1.4);
  return [0.5 * k ** 0.62 * (1 - 0.2 * m) - 0.1 * m + 0.02, -0.34 * k ** 0.8 * (1 - 0.4 * m) - 0.1 * m + 0.02];
}

/** How near two rows or columns of a head may lie, in radians of it. */
const MESH_GAP = 0.016;

/** A sorted list with anything nearer its neighbour than `gap` left out, then halved `level` times. */
function spaced(list: readonly number[], gap: number, level: number): readonly number[] {
  const kept = [...list].sort((a, b) => a - b).reduce<number[]>((so, v) => (so.length === 0 || v - (so[so.length - 1] ?? v) > gap ? [...so, v] : so), []);
  return level > 0 ? spaced(kept.flatMap((v, i) => (i === 0 ? [v] : [((kept[i - 1] ?? v) + v) / 2, v])), MESH_GAP, level - 1) : kept;
}

/** A head's rows, chin to crown, one along every line of a face. */
function rowsOf(w: Wrap): readonly number[] {
  const { pupil: y, eye: e, sn, sto, men } = w;
  const face = [men, men + 0.12, (men + sto) / 2, sto - 0.2, sto - 0.1, sto - 0.03, sto, sto + 0.03, sto + 0.09, (sto + sn) / 2, sn, sn + 0.1, y - e * 0.36 - 0.12, y - e * 0.36, y - e * 0.1, y + e * 0.22, y + e * 0.54, y + e * 0.8, y + e * 1.6, y + e * 2.6, 0.72, 0.95, 1.2];
  return spaced([-1.5, -1.3, -1.12, ...face.map(bearing), 1.05, 1.22, 1.38, 1.5], 0.012, w.level);
}

/** A head's columns, right round from the back: every landmark across a face, both sides alike. */
function columnsOf(w: Wrap): readonly number[] {
  const { eyeX: x, eye: e, mouth } = w;
  const one = [0.05, 0.1, 0.17, mouth, x - e * 1.42, x - e * 0.7, x, x + e * 0.7, x + e * 1.42, x + e * 1.42 + 0.08].map(bearing);
  const half = [...one, 0.9, 1.1, 1.3, 1.57, 1.85, 2.2, 2.55, 2.85];
  // (Thinned on one side and mirrored, or an eye's corner could land on a column on its left and miss one on its right.)
  const side = spaced([0, ...half, Math.PI], 0.012, w.level).slice(1, -1);
  return [...side.map((a) => -a).reverse(), 0, ...side, Math.PI];
}

/** How deep the field is at a point. */
function fieldAt(grid: Grid, at: Vec): number {
  const { n, field, min, h } = grid;
  const g = [0, 1, 2].map((i) => clamp(((at[i] ?? 0) - (min[i] ?? 0)) / h, 0, (n[i] ?? 2) - 1.001));
  const [x = 0, y = 0, z = 0] = g, x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const f = (a: number, b: number, c: number): number => field[x0 + a + (y0 + b) * n[0] + (z0 + c) * n[0] * n[1]] ?? FAR;
  return mix(mix(mix(f(0, 0, 0), f(1, 0, 0), fx), mix(f(0, 1, 0), f(1, 1, 0), fx), fy), mix(mix(f(0, 0, 1), f(1, 0, 1), fx), mix(f(0, 1, 1), f(1, 1, 1), fx), fy), fz);
}

/** The four weights of a cubic B-spline a share `t` of the way along a cell. */
const splineOf = (t: number): readonly number[] => { const u = 1 - t; return [(u * u * u) / 6, (3 * t * t * t - 6 * t * t + 4) / 6, (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6, (t * t * t) / 6]; };

/** The field at a point, smoothly: a grid's linear cells would print on a fixed mesh fine enough to show them. */
function smoothAt(grid: Grid, at: Vec): number {
  const { n, field, min, h } = grid, [gx = 0, gy = 0, gz = 0] = [0, 1, 2].map((i) => clamp(((at[i] ?? 0) - (min[i] ?? 0)) / h, 1, (n[i] ?? 4) - 3.001));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), wx = splineOf(gx - x0), wy = splineOf(gy - y0), wz = splineOf(gz - z0);
  let sum = 0;
  for (let c = 0; c < 4; c += 1) for (let b = 0; b < 4; b += 1) for (let a = 0; a < 4; a += 1) {
    sum += (wx[a] ?? 0) * (wy[b] ?? 0) * (wz[c] ?? 0) * (field[x0 + a - 1 + (y0 + b - 1) * n[0] + (z0 + c - 1) * n[0] * n[1]] ?? FAR);
  }
  return sum;
}

/** How far along a ray from a head's centre its surface lies, coming in from outside. */
function shotAt(grid: Grid, w: Wrap, dir: Vec): number {
  const step = grid.h * 0.75, along = (t: number): Vec => madd(w.c, dir, t);
  let t = w.R * 2.1;
  while (t > 0 && fieldAt(grid, along(t)) > 0) t -= step;
  if (t <= 0) return w.R * 0.8;
  let [low, high] = [t - step, t + step * 2];
  for (let i = 0; i < 9; i += 1) { const mid = (low + high) / 2; if (smoothAt(grid, along(mid)) > 0) high = mid; else low = mid; }
  return (low + high) / 2;
}

/** A head's distances eased along its rows and columns, so a step in the solid does not print through. */
function smoothedFar(far: Float64Array, rows: number, cols: number, passes: number): void {
  for (let i = 0; i < passes; i += 1) {
    const was = far.slice();
    const prior = (r: number, c: number): number => was[clamp(r, 0, rows - 1) * cols + ((c + cols) % cols)] ?? 0;
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) far[r * cols + c] = 0.5 * prior(r, c) + 0.125 * (prior(r - 1, c) + prior(r + 1, c) + prior(r, c - 1) + prior(r, c + 1));
  }
}

/** How far past a corner of an eye its lids have let go of the rows they bend. */
const LID_REACH = 2.4;

/** One column's lids: its rows through the eye bent onto the almond, letting go past each corner so no row steps. */
function lidRows(rows: readonly number[], w: Wrap, a: number): ((row: number) => number) | null {
  const u = (Math.abs(Math.tan(a) * 0.95) - w.eyeX) / w.eye, free = smooth(1.42, LID_REACH, Math.abs(u));
  if (Math.abs(a) > 1.2 || free >= 1) return null;
  const top = rows.indexOf(openRow(rows, w, 0.54)), low = rows.indexOf(openRow(rows, w, -0.36)), [up, down] = lidsAt(u);
  const high = bearing(w.pupil + up * w.eye), under = bearing(w.pupil + down * w.eye);
  const lifted = (rows[top] ?? 0) - high, dropped = under - (rows[low] ?? 0), span = bearing(w.eye * 1.7);
  return (row) => {
    const was = rows[row] ?? 0, out = row > top ? was - (rows[top] ?? 0) : (rows[low] ?? 0) - was;
    const bent = row > top ? was - lifted * (1 - smooth(0, span, out)) : row < low ? was + dropped * (1 - smooth(0, span, out)) : mix(under, high, (row - low) / Math.max(1, top - low));
    return mix(bent, was, free);
  };
}

/** The row nearest a share of an eye off its pupil. */
const openRow = (rows: readonly number[], w: Wrap, by: number): number => {
  const want = bearing(w.pupil + by * w.eye);
  return rows.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
};

/** Whether a quad of a head is the opening of an eye. */
function inEye(cols: readonly number[], rows: readonly number[], w: Wrap, row: number, col: number): boolean {
  const top = rows.indexOf(openRow(rows, w, 0.54)), low = rows.indexOf(openRow(rows, w, -0.36));
  const within = (a: number): boolean => Math.abs(a) < 1.2 && Math.abs(Math.abs(Math.tan(a) * 0.95) - w.eyeX) <= w.eye * 1.4201;
  return row >= low && row < top && within(cols[col] ?? 9) && within(cols[(col + 1) % cols.length] ?? 9);
}

/** A ball of an eye: where it lies and how big. */
interface Ball { readonly at: Vec; readonly r: number }

/** What one ball of an eye is: where it lies and how big, sat just behind the lids. */
function ballOf(net: Net, from: number, w: Wrap, side: number): Ball {
  const r = w.R * w.eye * 1.5, x = w.c[0] + side * w.eyeX * w.R, y = w.c[1] + w.pupil * w.R;
  // (A ball rests where the lower lid does: any further forward and it pushes a pouch through the cheek.)
  let [front, seen] = [0, 0];
  for (let v = from; v < net.position.length / 3; v += 1) {
    const dx = Math.abs((net.position[v * 3] ?? 0) - x) / (w.R * w.eye), dy = Math.abs((net.position[v * 3 + 1] ?? 0) - y + w.R * w.eye * 0.5) / (w.R * w.eye);
    if (dx < 0.7 && dy < 0.3 && (net.position[v * 3 + 2] ?? 0) > w.c[2]) { front += net.position[v * 3 + 2] ?? 0; seen += 1; }
  }
  return { at: [x, y, (seen > 0 ? front / seen : w.c[2] + w.R * 0.8) - r + w.R * 0.006], r };
}

/** A ball of an eye, its front half: the renderer paints the white and the iris on it, and a lid over it when it shuts. */
function eyeball(net: Net, ball: Ball, skin: number): void {
  const first = net.position.length / 3, rings = 7, around = 16;
  const put1 = (th: number, ph: number): void => {
    const n: Vec = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)], at = madd(ball.at, n, ball.r);
    net.position.push(...at); net.normal.push(...n); net.role.push(skin); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.skin); net.loose.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE); net.soft.push(0);
  };
  for (let i = 0; i <= rings; i += 1) for (let j = 0; j < around; j += 1) put1((i / rings) * 1.3 + 1e-3, (j / around) * Math.PI * 2);
  for (let i = 0; i < rings; i += 1) for (let j = 0; j < around; j += 1) {
    const a = first + i * around + j, b = first + i * around + (j + 1) % around, c = a + around, d = b + around;
    net.index.push(a, c, d, a, d, b);
  }
}

/** Lays a head's skin over the balls of its eyes, as a lid lies, and seats the edge of each lid on its ball, so the eye sits in them. */
function overBalls(net: Net, from: number, rim: ReadonlySet<number>, balls: readonly Ball[], lift: number): void {
  for (let v = from; v < net.position.length / 3; v += 1) for (const ball of balls) {
    const dx = (net.position[v * 3] ?? 0) - ball.at[0], dy = (net.position[v * 3 + 1] ?? 0) - ball.at[1], left = ball.r * ball.r - dx * dx - dy * dy;
    if (left <= 0) continue;
    const over = ball.at[2] + Math.sqrt(left) + lift, z = net.position[v * 3 + 2] ?? 0, gap = over - z, ease = ball.r * 0.16;
    if (z < ball.at[2]) continue;
    net.position[v * 3 + 2] = rim.has(v) ? over : z + 0.5 * (gap + Math.sqrt(gap * gap + ease * ease)) * smooth(0, 0.8, left / (ball.r * ball.r));
  }
}

/** Normals of a fixed head, from its own rows and columns. */
function headNormals(net: Net, from: number, rows: number, cols: number): void {
  const at = (r: number, c: number): Vec => { const v = from + clamp(r, 0, rows - 1) * cols + ((c + cols) % cols); return [net.position[v * 3] ?? 0, net.position[v * 3 + 1] ?? 0, net.position[v * 3 + 2] ?? 0]; };
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const n = unit(cross(sub(at(r, c + 1), at(r, c - 1)), sub(at(r + 1, c), at(r - 1, c))), UP), v = from + r * cols + c;
    net.normal[v * 3] = n[0]; net.normal[v * 3 + 1] = n[1]; net.normal[v * 3 + 2] = n[2];
  }
}

/** How far lips stand off a face at `x`, `y`, in head radii: an upper and a fuller lower, parted by the line between them. */
function lipAt(w: Wrap, x: number, y: number): number {
  const k = clamp(1 - (x * x) / (w.mouth * w.mouth * 1.1), 0, 1), up = (y - w.sto - 0.06 * k) / 0.05, down = (y - w.sto + 0.08 * k) / 0.065;
  return k ** 0.5 * (0.026 * Math.exp(-up * up) + 0.034 * Math.exp(-down * down)) - 0.03 * k ** 0.5 * Math.exp(-(((y - w.sto) / 0.014) ** 2));
}

/** The back of a skull comes in to the neck under it, and the corners of the jaw tuck in with it: nothing behind the face hangs out over the neck like a bowl. */
function napeOf(w: Wrap, at: Vec): Vec {
  const q = scale(sub(at, w.c), 1 / w.R), [nz, wide, back] = w.neck, pull = smooth(0.3, -0.8, q[1]) * smooth(0.5, -0.1, q[2]);
  if (pull <= 0) return at;
  const a = Math.atan2(q[0] / wide, (q[2] - nz) / back);
  return madd(w.c, [mix(q[0], Math.sin(a) * wide, pull), q[1], mix(q[2], nz + Math.cos(a) * back, pull)], w.R);
}

/** A head as a fixed mesh: every person the same rows and columns, laid through the same lines of a face, shot onto the solid their head is melted from. */
function wrapHead(net: Net, layer: Layer, grid: Grid, w: Wrap, roles: readonly string[]): void {
  const rows = rowsOf(w), cols = columnsOf(w), from = net.position.length / 3, firstIndex = net.index.length, skin = Math.max(0, roles.indexOf("skin"));
  const lids = cols.map((a) => lidRows(rows, w, a)), rim = new Set<number>(), hidden = new Set<number>();
  const top = rows.indexOf(openRow(rows, w, 0.54)), low = rows.indexOf(openRow(rows, w, -0.36));
  const ray = (r: number, c: number): Vec => { const a = cols[c] ?? 0, el = lids[c]?.(r) ?? rows[r] ?? 0; return [Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)]; };
  const far = new Float64Array(rows.length * cols.length);
  rows.forEach((_, r) => { cols.forEach((__, c) => { far[r * cols.length + c] = shotAt(grid, w, ray(r, c)); }); });
  smoothedFar(far, rows.length, cols.length, 2);
  rows.forEach((_, r) => { cols.forEach((a, c) => {
    const dir = ray(r, c), el = Math.asin(dir[1]);
    const v = from + r * cols.length + c, at = napeOf(w, madd(w.c, dir, (far[r * cols.length + c] ?? 0) + w.R * lipAt(w, Math.tan(a) * 0.95, Math.tan(el) * 0.95)));
    if (inEye(cols, rows, w, Math.min(r, top - 1), c) || inEye(cols, rows, w, Math.min(r, top - 1), c - 1 < 0 ? cols.length - 1 : c - 1)) { if (r === top || r === low) rim.add(v); }
    if (unseen(layer, at)) hidden.add(v);
    net.position.push(...at); net.normal.push(...dir); net.role.push(skin); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(layer.fabric); net.loose.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE); net.soft.push(0);
  }); });
  for (let r = 0; r + 1 < rows.length; r += 1) for (let c = 0; c < cols.length; c += 1) {
    if (inEye(cols, rows, w, r, c)) continue;
    const next = (c + 1) % cols.length, a = from + r * cols.length + c, b = from + r * cols.length + next, d = a + cols.length, e = b + cols.length;
    if (!(hidden.has(a) && hidden.has(b) && hidden.has(d) && hidden.has(e))) net.index.push(a, b, e, a, e, d);
  }
  relaxed(net, from, firstIndex, layer.relax ?? 0);
  const balls = [-1, 1].map((side) => ballOf(net, from, w, side));
  overBalls(net, from, rim, balls, w.R * 0.004);
  headNormals(net, from, rows.length, cols.length);
  balls.forEach((ball) => { eyeball(net, ball, skin); });
}

/** One closed shell of a person, added to `net`, its bones from `weighed`. */
function netOf(net: Net, layer: Layer, decals: readonly Capsule[], weighed: readonly Capsule[], roles: readonly string[], cell: number): void {
  const parts = layer.parts.map((c) => inflated(c, layer.lift));
  const bones = weighed.map((c) => boneOfPart(c.part));
  const grid = gridOver(parts, cell * layer.fine);
  parts.forEach((c, i) => {
    meltIn(grid, c, i);
    if (layer.loft && c.part === "skull") lofted(grid, layer.loft);
  });
  if (layer.dents) dented(grid, layer.dents);
  if (layer.locks) roughen(grid, layer.locks.head, layer.locks.kind, layer.locks.size);
  if (layer.wrap) { wrapHead(net, layer, grid, layer.wrap, roles); return; }
  const { n } = grid;
  const firstVertex = net.position.length / 3, firstIndex = net.index.length;
  const cells = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  const hidden = new Set<number>();
  eachCell(n, (x, y, z) => {
    const at = cellPoint(grid, x, y, z);
    if (!at) return;
    const i = x + y * n[0] + z * n[0] * n[1];
    cells[i] = net.position.length / 3;
    if (unseen(layer, at)) hidden.add(cells[i] ?? -1);
    net.position.push(...at);
    net.normal.push(...normalAt(grid, x, y, z));
    const painted = decals.find((c) => partDistance(c, at[0], at[1], at[2]) < 0);
    net.role.push(Math.max(0, roles.indexOf((painted ?? ownerOf(grid, parts, i))?.role ?? "skin")));
    const [a, b, w] = ownerOf(grid, parts, i)?.part === "skirt" ? skirtWeights(at) : weightsAt(weighed, bones, at);
    net.bones.push(a, b);
    net.weight.push(w);
    net.fabric.push(layer.fabric);
    net.loose.push(layer.free ? clamp((layer.free[0] - at[1]) / layer.free[1], 0, 1) : 0);
    net.cloth.push(at[0], at[2], at[1], NO_EDGE);
    net.soft.push(0);
  });
  const faces = netFaces(grid, cells);
  for (let i = 0; i < faces.length; i += 3) {
    const [a, b, c] = [faces[i] ?? 0, faces[i + 1] ?? 0, faces[i + 2] ?? 0];
    if (!(hidden.has(a) && hidden.has(b) && hidden.has(c))) net.index.push(a, b, c);
  }
  relaxed(net, firstVertex, firstIndex, layer.relax ?? 0);
}

/** Who each vertex shares a triangle with, from `from` on. */
function neighboursOf(index: readonly number[], from: number): Map<number, Set<number>> {
  const near = new Map<number, Set<number>>();
  for (let i = from; i < index.length; i += 3) {
    const tri = [index[i] ?? 0, index[i + 1] ?? 0, index[i + 2] ?? 0];
    tri.forEach((a, j) => { near.set(a, (near.get(a) ?? new Set<number>()).add(tri[(j + 1) % 3] ?? a).add(tri[(j + 2) % 3] ?? a)); });
  }
  return near;
}

/** A net's newest vertices each drawn toward their neighbours, a few times over: the positions a little, the normals most of the way, for all the way loses a nose's flank. */
function relaxed(net: Net, firstVertex: number, firstIndex: number, passes: number): void {
  if (passes === 0) return;
  const near = neighboursOf(net.index, firstIndex);
  const blur = (list: number[], share: number): void => {
    const was = list.slice(firstVertex * 3);
    for (const [v, ns] of near) for (let c = 0; c < 3; c += 1) {
      const mean = [...ns].reduce((sum, n) => sum + (was[(n - firstVertex) * 3 + c] ?? 0), 0) / ns.size;
      list[v * 3 + c] = mix(was[(v - firstVertex) * 3 + c] ?? 0, mean, share);
    }
  };
  for (let pass = 0; pass < passes; pass += 1) { blur(net.position, 0.55); blur(net.normal, 0.8); }
  for (const v of near.keys()) net.normal.splice(v * 3, 3, ...unit([net.normal[v * 3] ?? 0, net.normal[v * 3 + 1] ?? 0, net.normal[v * 3 + 2] ?? 0], UP));
}

/** A person with nothing on: every limb bare, so a body is whole under whatever is worn over it. */
function bareParts(p: Person): readonly Capsule[] {
  const bare: Person = { ...p, outfit: { ...p.outfit, top: "tank", bottom: "skirt", shoe: "sandal", hat: "none", stripes: 0 } };
  return bodyOf(bare, "rest", 0, [0, 0, 0], 0, true).capsules
    .filter((c) => c.decal !== true && c.carve !== true && !/^(skirt|sole|hair|fringe|curl|bob|lock|fall|bun|tail)/.test(c.part) && c.role !== "eye" && c.role !== "lip" && c.role !== "hair" && c.role !== "beard")
    .flatMap(unrolled)
    .map((c) => ({ ...c, role: c.role === "belly" || c.part === "snout" ? c.role : "skin" }));
}

// ---------------------------------------------------------------- the body's cage

/** One point of a cage: where it is, then how much each bone has of it, so subdividing carries both. */
type Row = number[];
interface Cage { readonly rows: Row[]; readonly quads: (readonly [number, number, number, number])[]; readonly tags: number[] }

/** Where on the body a quad is: a limb's kind, and how far along it the ring. */
const TORSO = 0, ARM = 100, LEG = 200, FOOT = 300;
/** A vertex this far or further from any edge of what it is part of, in metres. */
const NO_EDGE = 0.09;
const TOP_RING = 13;
/** The torso's rings the arm's opening is cut from, and how many spokes a torso has. */
const ARMPIT = 8, SPOKES = 12;

const rowOf = (at: Vec, weights: readonly (readonly [string, number])[]): Row => {
  const row: Row = [...at, ...new Array<number>(BONE_COUNT).fill(0)];
  for (const [bone, w] of weights) row[3 + boneIndex(bone)] = w;
  return row;
};
const pointOf = (row: Row | undefined): Vec => [row?.[0] ?? 0, row?.[1] ?? 0, row?.[2] ?? 0];

/** A quad, wound to face away from `inside`. */
function quad(cage: Cage, q: readonly [number, number, number, number], inside: Vec, tag: number): void {
  const [a, b, c, d] = q.map((i) => pointOf(cage.rows[i])) as unknown as readonly [Vec, Vec, Vec, Vec];
  const facing = cross(sub(c, a), sub(d, b));
  const out = sub(scale(add(add(a, b), add(c, d)), 0.25), inside);
  cage.quads.push(dot(facing, out) < 0 ? [q[3], q[2], q[1], q[0]] : q);
  cage.tags.push(tag);
}

/** The quads between two rings of the same size. */
function joined(cage: Cage, a: readonly number[], b: readonly number[], tag: number): void {
  const inside = scale([...a, ...b].reduce<Vec>((n, i) => add(n, pointOf(cage.rows[i])), [0, 0, 0]), 1 / (a.length + b.length));
  a.forEach((v, i) => {
    const j = (i + 1) % a.length;
    quad(cage, [v, a[j] ?? 0, b[j] ?? 0, b[i] ?? 0], inside, tag);
  });
}

/** An even ring closed over a point past its middle. */
function capped(cage: Cage, ring: readonly number[], tip: Vec, tag: number): void {
  const inside = scale(ring.reduce<Vec>((n, i) => add(n, pointOf(cage.rows[i])), [0, 0, 0]), 1 / ring.length);
  const row = rowOf(tip, []);
  (cage.rows[ring[0] ?? 0] ?? []).slice(3).forEach((w, i) => { row[3 + i] = w; });
  cage.rows.push(row);
  const pole = cage.rows.length - 1;
  for (let i = 0; i < ring.length; i += 2) quad(cage, [pole, ring[i] ?? 0, ring[i + 1] ?? 0, ring[(i + 2) % ring.length] ?? 0], inside, tag);
}

interface Station { readonly at: Vec; readonly wide: number; readonly front: number; readonly back: number; readonly bones: readonly (readonly [string, number])[]; readonly bust?: number; readonly rear?: number }

/** A squared circle's point at `a`, front and back each their own depth. */
function spokeOf(st: Station, k: number): Vec {
  const a = (k / SPOKES) * TAU;
  const soft = (v: number): number => Math.sign(v) * Math.abs(v) ** 0.78;
  const c = Math.cos(a), s = Math.sin(a);
  const lobe = (centre: number): number => Math.exp(-(((Math.abs(((a + Math.PI) % TAU) - Math.PI) - centre) / 0.62) ** 2));
  const z = (c > 0 ? st.front + (st.bust ?? 0) * lobe(0.5) : st.back + (st.rear ?? 0) * lobe(2.6)) * soft(c);
  return add(st.at, [st.wide * soft(s), 0, z]);
}

/** The torso's rings, hips to the top of the neck. */
function torsoStations(p: Person, s: Skeleton): readonly Station[] {
  const { shoulder, hip, girth, head, chest, waist, belly, bust, rear, sex } = p.build;
  const fat = Math.max(0, girth - 1);
  const hipW = hip * 1.02 * (1 + fat * 0.3), mid = mix(hip, shoulder, 0.16) * mix(0.76, 1.08, girth - 0.78) * waist;
  const shoulderW = shoulder * 0.98 * (1 + fat * 0.22), grown = p.build.age === "adult" || p.build.age === "elder" ? 1 : p.build.age === "teen" ? 0.6 : 0;
  const chestY = s.left.arm.shoulder[1], crotch = s.left.leg.hip[1], neckR = Math.min(head * 0.5 * neckBy(p) * Math.sqrt(girth * p.build.limb), shoulder * 0.3), nape = head * 0.1 * p.face.bone.m;
  const curve = sex === "female" ? 1.1 : 1;
  const at = (y: number, forward = 0): Vec => {
    const k = (y - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]);
    return [0, y, lerpV(s.pelvis, s.neck, k)[2] + forward];
  };
  const low: readonly (readonly [string, number])[] = [["pelvis", 1]], waistB: readonly (readonly [string, number])[] = [["pelvis", 0.4], ["spine", 0.6]];
  const ribsB: readonly (readonly [string, number])[] = [["spine", 0.5], ["chest", 0.5]], chestB: readonly (readonly [string, number])[] = [["chest", 1]];
  const muscle = clamp((p.build.limb - 1) / 0.2, 0, 1) * (waist < 0.9 ? 1 : 0);
  // (A grown woman's is shaped on the finished surface, by `bustOf`; the cage carries only what is broad.)
  const bustSize = sex === "male" ? (0.012 + muscle * 0.03) * bust : grown === 1 ? 0 : 0.05 * bust * grown;
  const stomach = fat * 0.08 + belly;
  const y = (k: number): number => mix(crotch, chestY, k);
  return [
    { at: at(crotch - 0.05), wide: hipW * 0.86, front: hipW * 0.5, back: hipW * 0.56, bones: low },
    { at: at(crotch + 0.04), wide: hipW, front: hipW * 0.62 + stomach * 0.5, back: hipW * 0.72, rear: (0.024 * curve + fat * 0.02) * rear, bones: low },
    { at: at(y(0.17)), wide: hipW * 0.97, front: hipW * 0.6 + stomach * 0.85, back: hipW * 0.66, rear: 0.012 * curve * rear, bones: low },
    { at: at(y(0.29)), wide: mix(hipW, mid, 0.62), front: mid * 0.62 + stomach, back: mid * 0.62, bones: waistB },
    { at: at(y(0.41)), wide: mid, front: mid * 0.6 + stomach * 0.95, back: mid * 0.56, bones: waistB },
    { at: at(y(0.52)), wide: mix(mid, shoulderW * 0.82, 0.32), front: mid * 0.62 + stomach * 0.75, back: mid * 0.58, bones: ribsB },
    { at: at(y(0.64)), wide: mix(mid, shoulderW * 0.86, 0.7), front: shoulderW * 0.5 + chest * 0.5 + stomach * 0.45, back: shoulderW * 0.5, bust: bustSize * 0.4, bones: ribsB },
    { at: at(y(0.76), chest * 0.4), wide: shoulderW * 0.86, front: shoulderW * 0.54 + chest * 0.6, back: shoulderW * 0.52, bust: bustSize, bones: chestB },
    { at: at(y(0.86), chest * 0.3), wide: shoulderW * 0.9, front: shoulderW * 0.5 + chest * 0.4, back: shoulderW * 0.52, bust: bustSize * 0.5, bones: chestB },
    { at: at(chestY), wide: shoulderW * 1.02, front: shoulderW * 0.44, back: shoulderW * 0.48, bones: chestB },
    { at: at(chestY + 0.045), wide: mix(shoulderW, neckR * 1.8, 0.4), front: shoulderW * 0.31, back: shoulderW * 0.38, bones: chestB },
    { at: add(s.neck, [0, -0.01, -0.008]), wide: neckR * 1.62, front: neckR * 0.98, back: neckR * 1.42, bones: [["chest", 0.6], ["neck", 0.4]] },
    { at: madd(lerpV(s.neck, s.head, 0.26), FRONT, -nape * 0.4), wide: neckR * 0.9, front: neckR * 0.84, back: neckR * 0.98, bones: [["neck", 1]] },
    { at: madd(lerpV(s.neck, s.head, 0.72), FRONT, -nape), wide: neckR * 0.86, front: neckR * 0.8, back: neckR * 0.96, bones: [["neck", 0.6], ["head", 0.4]] },
  ];
}

/** The torso: rings of spokes, with the two quads each arm comes out of left open. */
function torsoOf(cage: Cage, stations: readonly Station[]): readonly (readonly number[])[] {
  const rings = stations.map((st) => Array.from({ length: SPOKES }, (_, k) => {
    cage.rows.push(rowOf(spokeOf(st, k), st.bones));
    return cage.rows.length - 1;
  }));
  const open = (r: number, k: number): boolean => r >= ARMPIT && r < ARMPIT + 2 && [2, 3, 8, 9].includes(k);
  rings.slice(0, -1).forEach((ring, r) => {
    const next = rings[r + 1] ?? [];
    const inside = stations[r]?.at ?? [0, 0, 0];
    ring.forEach((v, k) => {
      if (open(r, k)) return;
      const j = (k + 1) % SPOKES;
      quad(cage, [v, ring[j] ?? 0, next[j] ?? 0, next[k] ?? 0], lerpV(inside, stations[r + 1]?.at ?? inside, 0.5), TORSO + r);
    });
  });
  capped(cage, rings[TOP_RING] ?? [], add(stations[TOP_RING]?.at ?? [0, 0, 0], [0, 0.02, 0]), TORSO + TOP_RING);
  return rings;
}

interface Hoop { readonly at: Vec; readonly a: Vec; readonly b: Vec; readonly ra: number; readonly rb: number; readonly bones: readonly (readonly [string, number])[]; readonly tag: number }

/** A ring of eight round `at`, on the axes `a` and `b`. */
function hoop(cage: Cage, h: Hoop, angleOf: (i: number) => number): readonly number[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = angleOf(i);
    cage.rows.push(rowOf(madd(madd(h.at, h.a, Math.cos(t) * h.ra), h.b, Math.sin(t) * h.rb), h.bones));
    return cage.rows.length - 1;
  });
}

/** The second axis of a limb at `along`, kept as near `like` as it can be. */
const across = (along: Vec, like: Vec): Vec => unit(sub(like, scale(along, dot(like, along))), SIDE);

/** An arm out of its opening in the torso, ending inside the hand. */
function armOf8(cage: Cage, p: Person, rings: readonly (readonly number[])[], arm: Arm, side: number): void {
  const L = side < 0 ? "L" : "R", k = limbWide(p.build) * (p.build.sex === "male" ? 1 : 0.9);
  const c = side > 0 ? 3 : 9;
  const pump = 1 + clamp((p.build.limb - 1) / 0.2, 0, 1) * (p.build.waist < 0.9 ? 0.3 : 0);
  const at = (r: number, s: number): number => rings[ARMPIT + r]?.[(c + s + SPOKES) % SPOKES] ?? 0;
  const mouth = [at(0, -1), at(0, 0), at(0, 1), at(1, 1), at(2, 1), at(2, 0), at(2, -1), at(1, -1)];
  const angle = (i: number): number => { const t = ((-45 - 45 * i) * Math.PI) / 180; return side > 0 ? t : Math.PI - t; };
  const up: readonly (readonly [string, number])[] = [[`upper.${L}`, 1]], fore: readonly (readonly [string, number])[] = [[`fore.${L}`, 1]];
  const stops: readonly (readonly [Vec, Vec, number, number, readonly (readonly [string, number])[]])[] = [
    [arm.shoulder, arm.elbow, 0.14, 0.052 * pump, [["chest", 0.45], [`upper.${L}`, 0.55]]],
    [arm.shoulder, arm.elbow, 0.4, 0.05 * pump, [["chest", 0.12], [`upper.${L}`, 0.88]]], [arm.shoulder, arm.elbow, 0.72, 0.042, up],
    [arm.shoulder, arm.elbow, 0.92, 0.037, [[`upper.${L}`, 0.85], [`fore.${L}`, 0.15]]],
    [arm.shoulder, arm.elbow, 1, 0.036, [[`upper.${L}`, 0.5], [`fore.${L}`, 0.5]]],
    [arm.elbow, arm.wrist, 0.1, 0.038, [[`upper.${L}`, 0.15], [`fore.${L}`, 0.85]]],
    [arm.elbow, arm.wrist, 0.3, 0.041, fore], [arm.elbow, arm.wrist, 0.68, 0.032, fore], [arm.elbow, arm.wrist, 0.92, 0.0265, [[`fore.${L}`, 0.7], [`hand.${L}`, 0.3]]], [arm.elbow, arm.wrist, 1.06, 0.0255, [[`hand.${L}`, 1]]],
  ];
  let prev: readonly number[] = mouth, front = FRONT;
  stops.forEach(([a, b, t, r, bones], i) => {
    const along = unit(sub(b, a));
    front = across(along, front);
    // (A wrist is flat, broader across the back of the hand than through it.)
    const flat = i >= 7 ? 0.74 : 1;
    const ring = hoop(cage, { at: lerpV(a, b, t), a: front, b: scale(unit(cross(along, front)), -side), ra: r * k * (i >= 7 ? 1.14 : 1), rb: r * k * flat, bones, tag: ARM + i }, angle);
    joined(cage, prev, ring, ARM + i);
    prev = ring;
  });
  capped(cage, prev, madd(arm.wrist, unit(sub(arm.wrist, arm.elbow)), 0.034), ARM + stops.length);
}

/** One leg's rings, the first the half of the torso's last on its side; the foot follows on. */
function legOf8(cage: Cage, p: Person, bottom: readonly number[], crotch: number, leg: Leg, side: number): void {
  const L = side < 0 ? "L" : "R", k = limbWide(p.build);
  const half = side > 0 ? [0, 1, 2, 3, 4, 5, 6] : [0, 11, 10, 9, 8, 7, 6];
  const mouth = [...half.map((i) => bottom[i] ?? 0), crotch];
  const angle = (i: number): number => ((135 - 45 * i) * Math.PI) / 180;
  const th: readonly (readonly [string, number])[] = [[`thigh.${L}`, 1]], sh: readonly (readonly [string, number])[] = [[`shin.${L}`, 1]];
  const stops: readonly (readonly [Vec, Vec, number, number, number, number, readonly (readonly [string, number])[]])[] = [
    [leg.hip, leg.knee, 0.2, 0.094, 0.096, 0, [["pelvis", 0.35], [`thigh.${L}`, 0.65]]],
    [leg.hip, leg.knee, 0.42, 0.084, 0.09, 0.004, th], [leg.hip, leg.knee, 0.7, 0.066, 0.072, 0.004, th],
    [leg.hip, leg.knee, 0.92, 0.054, 0.056, 0.002, [[`thigh.${L}`, 0.85], [`shin.${L}`, 0.15]]],
    [leg.hip, leg.knee, 1, 0.052, 0.054, 0.006, [[`thigh.${L}`, 0.5], [`shin.${L}`, 0.5]]],
    [leg.knee, leg.ankle, 0.1, 0.05, 0.052, 0, [[`thigh.${L}`, 0.15], [`shin.${L}`, 0.85]]],
    [leg.knee, leg.ankle, 0.3, 0.054, 0.061, -0.012, sh], [leg.knee, leg.ankle, 0.62, 0.042, 0.046, -0.006, sh], [leg.knee, leg.ankle, 0.92, 0.03, 0.034, 0, [[`shin.${L}`, 0.8], [`foot.${L}`, 0.2]]],
  ];
  const fill = mix(k, (p.build.hip / 0.17) * Math.sqrt(p.build.girth), 0.6);
  let prev: readonly number[] = mouth, front = FRONT;
  stops.forEach(([a, b, t, rx, rz, z, bones], i) => {
    const along = unit(sub(b, a));
    front = across(along, front);
    const ring = hoop(cage, { at: madd(lerpV(a, b, t), front, z), a: [side, 0, 0], b: front, ra: rx * (i < 3 ? fill : k), rb: rz * (i < 3 ? fill : k), bones, tag: LEG + i }, angle);
    joined(cage, prev, ring, LEG + i);
    prev = ring;
  });
  footOf8(cage, p, prev, leg, side, angle);
}

/** The foot: rings that swing from lying flat round the ankle to standing across the toes. */
function footOf8(cage: Cage, p: Person, from: readonly number[], leg: Leg, side: number, angle: (i: number) => number): void {
  const L = side < 0 ? "L" : "R", f = p.build.foot;
  const ahead = unit([0, 0, Math.max(0.01, leg.toe[2] - leg.ankle[2])]);
  const bones: readonly (readonly [string, number])[] = [[`foot.${L}`, 1]];
  const out: Vec = [side, 0, 0];
  const lift = (forward: number, up: number): Vec => add(madd(leg.ankle, ahead, forward * f), [0, up, 0]);
  const stops: readonly (readonly [Vec, Vec, number, number])[] = [
    [lift(-0.005, -0.05), unit(add(ahead, UP)), 0.04, 0.076],
    [lift(0.05, -0.058), UP, 0.043, 0.042],
    [lift(0.112, -0.071), UP, 0.051, 0.03],
    [lift(0.16, -0.079), UP, 0.046, 0.021],
  ];
  let prev: readonly number[] = from;
  const toes: readonly (readonly [string, number])[] = [[`toes.${L}`, 1]], ball: readonly (readonly [string, number])[] = [[`foot.${L}`, 0.5], [`toes.${L}`, 0.5]];
  stops.forEach(([at, b, rx, rz], i) => {
    const ring = hoop(cage, { at, a: out, b, ra: rx * f, rb: rz, bones: i === 3 ? toes : i === 2 ? ball : bones, tag: FOOT + i }, angle);
    joined(cage, prev, ring, FOOT + i);
    prev = ring;
  });
  capped(cage, prev, lift(0.2, -0.084), FOOT + stops.length);
}

/** A person's one closed body, in its resting pose. */
function cageOf(p: Person): Cage {
  const s = restSkeleton(p);
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const rings = torsoOf(cage, torsoStations(p, s));
  const bottom = rings[0] ?? [];
  cage.rows.push(rowOf(add(s.pelvis, [0, -HIP_DROP - 0.1, 0]), [["pelvis", 0.5], ["thigh.L", 0.25], ["thigh.R", 0.25]]));
  const crotch = cage.rows.length - 1;
  bottom.forEach((v, k) => {
    const row = cage.rows[v];
    if (!row || k % 6 === 0) return;
    row[3 + PELVIS] = 0.6;
    row[3 + boneIndex(k < 6 ? "thigh.R" : "thigh.L")] = 0.4;
  });
  armOf8(cage, p, rings, s.left.arm, -1);
  armOf8(cage, p, rings, s.right.arm, 1);
  legOf8(cage, p, bottom, crotch, s.left.leg, -1);
  legOf8(cage, p, bottom, crotch, s.right.leg, 1);
  return cage;
}

/** One step of Catmull-Clark: a closed quad mesh into one four times as fine, bone shares and all. */
function subdivided(cage: Cage): Cage {
  const { rows, quads, tags } = cage;
  const width = rows[0]?.length ?? 0, n = rows.length;
  const sum = (list: readonly Row[], k: number): Row => Array.from({ length: width }, (_, c) => list.reduce((t, r) => t + (r[c] ?? 0), 0) * k);
  const corners = (q: readonly number[]): Row[] => q.map((i) => rows[i] ?? []);
  const faces = quads.map((q) => sum(corners(q), 0.25));
  const edges = new Map<number, { readonly a: number; readonly b: number; readonly faces: number[]; id: number }>();
  const touched = rows.map(() => ({ faces: [] as number[], near: new Set<number>() }));
  quads.forEach((q, f) => {
    q.forEach((a, i) => {
      const b = q[(i + 1) % 4] ?? 0, key = Math.min(a, b) * n + Math.max(a, b);
      const e = edges.get(key) ?? { a, b, faces: [], id: 0 };
      e.faces.push(f);
      edges.set(key, e);
      touched[a]?.faces.push(f);
      touched[a]?.near.add(b);
      touched[b]?.near.add(a);
    });
  });
  const next: Cage = { rows: [], quads: [], tags: [] };
  rows.forEach((row, i) => {
    const t = touched[i], v = t?.near.size ?? 0;
    if (!t || v === 0) { next.rows.push(row); return; }
    const f = sum(t.faces.map((x) => faces[x] ?? []), 1 / t.faces.length);
    const r = sum([...t.near].map((x) => rows[x] ?? []), 1 / v);
    next.rows.push(row.map((c, k) => ((f[k] ?? 0) + 2 * (r[k] ?? 0) + (v - 3) * c) / v));
  });
  const faceBase = next.rows.length;
  next.rows.push(...faces);
  for (const e of edges.values()) {
    e.id = next.rows.length;
    next.rows.push(sum([rows[e.a] ?? [], rows[e.b] ?? [], ...e.faces.map((x) => faces[x] ?? [])], 1 / (2 + e.faces.length)));
  }
  const edgeOf = (a: number, b: number): number => edges.get(Math.min(a, b) * n + Math.max(a, b))?.id ?? 0;
  quads.forEach((q, f) => {
    q.forEach((v, i) => {
      next.quads.push([v, edgeOf(v, q[(i + 1) % 4] ?? 0), faceBase + f, edgeOf(q[(i + 3) % 4] ?? 0, v)]);
      next.tags.push(tags[f] ?? 0);
    });
  });
  return next;
}

/** Every point's normal, from the quads round it. */
function normalsOf(cage: Cage): readonly Vec[] {
  const out = cage.rows.map((): Vec => [0, 0, 0]);
  for (const q of cage.quads) {
    const [a, b, c, d] = q.map((i) => pointOf(cage.rows[i])) as unknown as readonly [Vec, Vec, Vec, Vec];
    const n = cross(sub(c, a), sub(d, b));
    for (const i of q) out[i] = add(out[i] ?? [0, 0, 0], n);
  }
  return out.map((n) => unit(n, UP));
}

/** The two bones with most of a point. */
function strongest(row: Row): readonly [number, number, number] {
  const shares = row.slice(3);
  let a = 0, b = 0;
  shares.forEach((w, i) => { if (w > (shares[a] ?? 0)) a = i; });
  if (a === 0) b = 1;
  shares.forEach((w, i) => { if (i !== a && w > (shares[b] ?? 0)) b = i; });
  const wa = shares[a] ?? 0, wb = shares[b] ?? 0;
  return [a, b, wa / Math.max(1e-6, wa + wb)];
}

type Cut = (at: Vec) => number;

interface Shell {
  /** Which of the body's quads it is. */
  readonly on: (tag: number) => boolean;
  readonly lift: number;
  readonly role: (at: Vec, vertex?: number) => string;
  readonly fabric: number;
  /** How deep a shag stands off it. */
  readonly shag?: number;
  /** How it hangs, if not as the body under it does: its two bones, the first's share, and how free. */
  readonly hang?: (at: Vec, row: Row) => readonly [number, number, number, number];
  /** How cloth lies on it: where a point is round its limb, and along it. */
  readonly lay?: (at: Vec, tag: number) => Vec;
  /** Whether an open edge here is an edge at all, not a join to more of the same garment. */
  readonly edge?: (at: Vec) => boolean;
  /** Which of its quads to build, by their middles. */
  readonly keep?: (at: Vec, tag: number) => boolean;
  /** A cut through it that does not follow the rings: how far inside it a point is. */
  readonly cut?: Cut | undefined;
  /** How much soft flesh rides under a point of it. */
  readonly soft?: (at: Vec) => number;
  /** How far forward a vertex stands, over what it does not follow in. */
  readonly span?: (at: Vec) => number;
  /** How far under the surface a vertex is pushed: skin nothing shows of goes in under what covers it. */
  readonly sink?: (vertex: number) => number;
}

const edgeKey = (a: number, b: number): number => Math.min(a, b) * 1048576 + Math.max(a, b);

/** The vertices of a set of quads on an open edge, and who each vertex neighbours. */
function edgesOf(quads: readonly (readonly number[])[]): { readonly open: Set<number>; readonly next: Map<number, Set<number>> } {
  const seen = new Map<number, number>(), next = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => { next.set(a, (next.get(a) ?? new Set<number>()).add(b)); };
  for (const q of quads) q.forEach((a, i) => {
    const b = q[(i + 1) % q.length] ?? a, key = edgeKey(a, b);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    link(a, b);
    link(b, a);
  });
  const open = new Set<number>();
  for (const [key, count] of seen) if (count === 1) { open.add(Math.floor(key / 1048576)); open.add(key % 1048576); }
  return { open, next };
}

/** How far each vertex of a set of quads is from its open edges, walking the surface, up to `NO_EDGE`. */
function edgeDistance(quads: readonly (readonly number[])[], point: (v: number) => Vec, isEdge: (at: Vec) => boolean): Map<number, number> {
  const { open, next } = edgesOf(quads);
  const far = new Map<number, number>();
  const queue = [...open].filter((v) => isEdge(point(v)));
  for (const v of queue) far.set(v, 0);
  while (queue.length > 0) {
    const v = queue.pop() ?? 0, at = point(v), so = far.get(v) ?? 0;
    for (const n of next.get(v) ?? []) {
      const d = so + Math.hypot(...sub(point(n), at));
      if (d < NO_EDGE && d < (far.get(n) ?? NO_EDGE)) { far.set(n, d); queue.push(n); }
    }
  }
  return far;
}

/** How cloth lies on a body: arms and legs each along their own bone, the rest upright round the trunk. */
function layOf(p: Person): (at: Vec, tag: number) => Vec {
  const s = restSkeleton(p);
  const round = (at: Vec, from: Vec, to: Vec, a: Vec, b: Vec): Vec => {
    const d = unit(sub(to, from)), r = sub(at, from);
    return [dot(r, a), dot(r, b), dot(r, d)];
  };
  return (at, tag) => {
    const side = at[0] > 0 ? s.right : s.left;
    if (tag >= LEG && tag < FOOT) return round(at, side.leg.hip, side.leg.ankle, SIDE, FRONT);
    if (tag >= ARM && tag < LEG) return round(at, side.arm.shoulder, side.arm.wrist, UP, FRONT);
    return [at[0], at[2] - s.chest[2], at[1]];
  };
}

/** Tufts: a rough 0 to 1 over the surface, drawn out downward as fur lies. */
const shagAt = (at: Vec): number => 0.5 + 0.25 * Math.sin(at[0] * 83 + at[2] * 61) * Math.sin(at[1] * 37 + at[0] * 29) + 0.25 * Math.sin(at[2] * 113 - at[1] * 53);

/** What a vertex's edge number is: how far inside a cut, if it has one, or from its open edge. */
const edgeOf = (shell: Shell, at: Vec, edge: number): number => (shell.cut ? clamp(shell.cut(at), -NO_EDGE, NO_EDGE) : edge);

/** How far off the surface a shell stands at a vertex. */
const standOff = (shell: Shell, at: Vec, i: number): number => shell.lift + (shell.shag ?? 0) * shagAt(at) - (shell.sink?.(i) ?? 0);

/** One vertex of a shell, into the net. */
function vertexOf(net: Net, body: Cage, normal: Vec, shell: Shell, [roles, size]: readonly [readonly string[], number], i: number, tag: number, edge: number): void {
  const at = pointOf(body.rows[i]);
  net.position.push(...scale(add(madd(at, normal, standOff(shell, at, i)), [0, 0, shell.span?.(at) ?? 0]), size));
  net.normal.push(...normal);
  net.role.push(Math.max(0, roles.indexOf(shell.role(at, i))));
  const row = body.rows[i] ?? [];
  const [a, b, w, free = 0] = shell.hang?.(at, row) ?? strongest(row);
  net.bones.push(a, b);
  net.weight.push(w);
  net.fabric.push(shell.fabric);
  net.loose.push(free);
  net.soft.push(shell.soft?.(at) ?? 0);
  net.cloth.push(...(shell.lay?.(at, tag) ?? [at[0], at[2], at[1]]), edgeOf(shell, at, edge));
}

/** Part of the body, stood off it, into the net. */
function shellOf(net: Net, body: Cage, normals: readonly Vec[], shell: Shell, roles: readonly string[], size: number): void {
  const base = new Map<number, number>();
  const middleOf = (q: readonly number[]): Vec => q.reduce<Vec>((n, v) => madd(n, pointOf(body.rows[v]), 1 / q.length), [0, 0, 0]);
  const wanted = (q: readonly number[], tag: number): boolean => shell.on(tag) && (shell.keep?.(middleOf(q), tag) ?? true) && (shell.cut?.(middleOf(q)) ?? 1) > -0.04;
  const chosen = body.quads.filter((q, f) => wanted(q, body.tags[f] ?? 0));
  const edges = edgeDistance(chosen, (v) => pointOf(body.rows[v]), shell.edge ?? (() => true));
  body.quads.forEach((q, f) => {
    const tag = body.tags[f] ?? 0;
    if (!wanted(q, tag)) return;
    const ids = q.map((i) => {
      const seen = base.get(i);
      if (seen !== undefined) return seen;
      const id = net.position.length / 3;
      base.set(i, id);
      vertexOf(net, body, normals[i] ?? UP, shell, [roles, size], i, tag, edges.get(i) ?? NO_EDGE);
      return id;
    });
    const [a = 0, b = 0, c = 0, d = 0] = ids;
    net.index.push(a, b, c, a, c, d);
  });
}

/** How far down each top comes, a ring of the torso; a long top goes on past it. */
const TOP_HEM: Readonly<Record<Top, number>> = { tank: 2, tee: 1, polo: 1, long: 1, hoodie: 1, jacket: 0, blazer: 0, coat: 3, robe: 3, dress: 3, raincoat: 3, puffer: 1, swimsuit: 1, bikini: 6, string: 4, bare: 99 };
/** Where a top stops at the chest, if not at the neck. */
const TOP_END: Partial<Record<Top, number>> = { bikini: 8, string: 10 };
/** Each stuff a person can be made of or dressed in, as `fabric` numbers them. */
export const FABRICS = { skin: 0, cotton: 1, denim: 2, hair: 3, knit: 4, leather: 5, fur: 6, wool: 7, satin: 8, latex: 9, nylon: 10, quilted: 11, tartan: 12, pinstripe: 13, corduroy: 14 } as const;
type Fabric = keyof typeof FABRICS;

/** What each garment may be cut from, a seed choosing. */
const TOP_CLOTH: Readonly<Record<Top, readonly Fabric[]>> = {
  tee: ["cotton"], polo: ["cotton"], tank: ["cotton"], long: ["cotton", "cotton", "tartan", "knit"], hoodie: ["knit"], jacket: ["leather", "denim", "wool"], blazer: ["wool", "wool", "pinstripe"],
  coat: ["wool"], robe: ["satin"], dress: ["cotton", "satin", "tartan"], raincoat: ["nylon", "nylon", "latex"], puffer: ["quilted"], swimsuit: ["cotton", "satin", "nylon"], bikini: ["cotton", "nylon"], string: ["cotton", "satin"], bare: ["cotton"],
};
const BOTTOM_CLOTH: Readonly<Record<Bottom, readonly Fabric[]>> = { jeans: ["denim"], trousers: ["wool", "corduroy", "pinstripe"], shorts: ["cotton", "denim"], skirt: ["cotton", "tartan", "satin", "wool"], leggings: ["knit"], cargo: ["cotton", "corduroy"], swim: ["cotton", "nylon"], briefs: ["cotton", "satin"] };
/** A uniform is cut from one thing, whatever its seed. */
const COSTUME_CLOTH: Partial<Readonly<Record<Costume, Fabric>>> = { suit: "wool", firefighter: "nylon", police: "cotton", latex: "latex" };

const chosenCloth = (p: Person, list: readonly Fabric[], salt: number): number => FABRICS[COSTUME_CLOTH[p.outfit.costume] ?? list[Math.floor(hashed(p.seed, salt) * list.length)] ?? "cotton"];
const topCloth = (p: Person): number => chosenCloth(p, TOP_CLOTH[p.outfit.top], 311);
const lowerCloth = (p: Person): number => chosenCloth(p, BOTTOM_CLOTH[p.outfit.bottom], 523);
/** What a hat is made of. */
const HAT_CLOTH: Partial<Record<Hat, keyof typeof FABRICS>> = { helmet: "latex", hardhat: "latex", beanie: "knit", pompom: "knit", cap: "cotton", hood: "cotton", bucket: "cotton", visor: "cotton", bandana: "cotton", headwrap: "cotton" };
const hatCloth = (hat: Hat): number => FABRICS[HAT_CLOTH[hat] ?? "wool"];

const inRange = (tag: number, from: number, to: number): boolean => tag >= from && tag <= to;

/** The ring of the finished surface where a skirt starts, stood off it by `lift`, in order round the body. */
function waistLoop(body: Cage, normals: readonly Vec[], lift: number): readonly Row[] {
  const on = (tag: number): Set<number> => new Set(body.quads.flatMap((q, f) => (body.tags[f] === tag ? [...q] : [])));
  const above = on(TORSO + 3), shared = [...on(TORSO + 2)].filter((i) => above.has(i));
  const middle = shared.reduce((n, i) => n + (body.rows[i]?.[2] ?? 0), 0) / Math.max(1, shared.length);
  const angle = (i: number): number => Math.atan2(body.rows[i]?.[0] ?? 0, (body.rows[i]?.[2] ?? 0) - middle);
  return shared.sort((a, b) => angle(a) - angle(b)).map((i) => [...madd(pointOf(body.rows[i]), normals[i] ?? UP, lift), ...(body.rows[i] ?? []).slice(3)]);
}

/** How far out from the body's middle it reaches, at an angle round it and a height. */
type Bulk = (angle: number, y: number) => number;
const BULK_ROUND = 40, BULK_HIGH = 14;

/** Whether a part of a body is one a hanging garment falls over. */
const hungOver = (tag: number): boolean => inRange(tag, TORSO, TORSO + 4) || inRange(tag, LEG, FOOT - 1);

/** The widest a body gets, all round it, between two heights: what anything hung from the waist has to clear, however fat it is. */
function bulkOf(body: Cage, top: number, hem: number, middle: number): Bulk {
  const reach = new Float32Array(BULK_ROUND * BULK_HIGH);
  const binOf = (a: number, y: number): number => Math.floor((((a / TAU) % 1) + 1) % 1 * BULK_ROUND) % BULK_ROUND + clamp(Math.floor(((top - y) / Math.max(0.01, top - hem)) * BULK_HIGH), 0, BULK_HIGH - 1) * BULK_ROUND;
  body.quads.forEach((q, f) => {
    if (!hungOver(body.tags[f] ?? 0)) return;
    for (const v of q) {
      const at = pointOf(body.rows[v]), bin = binOf(Math.atan2(at[0], at[2] - middle), at[1]);
      if (at[1] <= top + 0.02 && at[1] >= hem) reach[bin] = Math.max(reach[bin] ?? 0, Math.hypot(at[0], at[2] - middle));
    }
  });
  return (a, y) => {
    const step = TAU / BULK_ROUND;
    return Math.max(...[-2, -1, 0, 1, 2].map((d) => reach[binOf(a + d * step, y)] ?? 0));
  };
}

/** A skirt, or what falls below a long top: grown out of the finished surface itself, so it is one piece, folding deeper toward the hem. */
function skirtCage(p: Person, loop: readonly Row[], hem: number, clear: number, bulk: Bulk): Cage {
  const flare = (LONG_TOP[p.outfit.top] === undefined ? 1.1 : 1.04) + p.outfit.fit * 0.16;
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const around = loop.length, down = 14;
  const top = loop.reduce((n, v) => n + (v[1] ?? 0), 0) / Math.max(1, around), middle = loop.reduce((n, v) => n + (v[2] ?? 0), 0) / Math.max(1, around);
  for (let j = 0; j <= down; j += 1) loop.forEach((row, i) => {
    const ring = pointOf(row);
    const k = j / down, a = (i / around) * TAU;
    const pleat = 1 + 0.045 * k * Math.sin(a * 9 + Math.sin(a * 4) * 1.4);
    const wide = mix(mix(1, clear, clamp(k * 3.4, 0, 1)), flare * clear, k) * pleat, y = mix(ring[1], hem, k), x = ring[0] * wide;
    const splayed = 0.9 * clamp(Math.abs(x) / 0.06, 0, 1) * (top - y) * Math.sin(REST.splay ?? 0);
    const out = [x + Math.sign(x) * splayed, middle + (ring[2] - middle) * wide - middle] as const;
    const round = Math.hypot(out[0], out[1]), wrap = mix(1, Math.max(1, (bulk(Math.atan2(out[0], out[1]), y) + 0.02) / Math.max(0.01, round)), Math.min(1, j / 2));
    cage.rows.push([out[0] * wrap, y, middle + out[1] * wrap, ...(j < 2 ? row.slice(3) : new Array<number>(BONE_COUNT).fill(0))]);
  });
  for (let j = 0; j < down; j += 1) for (let i = 0; i < around; i += 1) {
    const at = (x: number, y: number): number => y * around + (x % around);
    quad(cage, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], [0, mix(top, hem, j / down), middle], 0);
  }
  return cage;
}

/** How many of the arm's rings each sleeve runs down: nine is to the wrist. */
const SLEEVE_RINGS: Readonly<Record<Top, number>> = { tank: 0, swimsuit: 0, bikini: 0, string: 0, bare: 0, dress: 1, tee: 2, polo: 2, robe: 7, long: 9, hoodie: 9, jacket: 9, blazer: 9, coat: 9, raincoat: 9, puffer: 9 };
const SKINTIGHT: readonly Top[] = ["swimsuit", "bikini", "string"];

/** The ring a top stops at: over a skirt, at the skirt's waist, or the two come through each other all round it. */
const hemRing = ({ top, bottom }: Person["outfit"]): number => (bottom === "skirt" && LONG_TOP[top] === undefined ? Math.max(TOP_HEM[top], 3) : TOP_HEM[top]);

function coverOf(p: Person): { readonly top: (t: number) => boolean; readonly lower: (t: number) => boolean; readonly feet: (t: number) => boolean; readonly bare: boolean } {
  const { top, bottom, shoe } = p.outfit;
  const bare = bottom === "skirt" ? false : top === "dress" || top === "robe";
  const skirted = bottom === "skirt" || bare;
  const sleeve = SLEEVE_RINGS[top];
  const trunks = p.build.sex === "male" || p.build.age !== "adult" ? 3 : 0;
  const legsTo = bottom === "briefs" ? 1 : bottom === "swim" ? trunks : bottom === "shorts" ? 3 : 8;
  return {
    bare,
    top: (t) => inRange(t, TORSO + hemRing(p.outfit), TORSO + (TOP_END[top] ?? 10)) || inRange(t, ARM, ARM + sleeve - 1),
    lower: (t) => inRange(t, TORSO + (skirted ? 3 : 0), TORSO + 3) || (!skirted && inRange(t, LEG, LEG + legsTo)),
    feet: (t) => inRange(t, FOOT, FOOT + 9) || (shoe === "boot" && inRange(t, LEG + 6, LEG + 9)),
  };
}

/** A jacket's open front, a narrowing V of shirt, and a formal one's tie down the middle of it; a coat's belt. */
function frontOf(p: Person, under: (at: Vec) => string, cell: number): (at: Vec) => string {
  const { top, costume } = p.outfit;
  if (top === "coat" || top === "raincoat") return bandsAt([restSkeleton(p).pelvis[1] + 0.12], 0.02, "dark", under);
  if ((top !== "jacket" && top !== "blazer") || costume === "firefighter" || cell < WRAPPED) return under;
  const s = restSkeleton(p), from = s.neck[1] - 0.02, to = s.waist[1] + 0.04;
  return (at) => {
    const k = (at[1] - to) / (from - to);
    if (at[2] < s.chest[2] || k < 0 || k > 1 || Math.abs(at[0]) > 0.012 + k * 0.08) return under(at);
    return top === "blazer" && Math.abs(at[0]) < 0.014 ? "dark" : "trim";
  };
}

const topLift = (top: Top, fit: number): number => (top === "puffer" ? 0.03 : SKINTIGHT.includes(top) ? 0.002 : 0.01 + fit * 0.012);
const lowerLift = (bottom: Bottom, fit: number): number => (bottom === "leggings" ? 0.002 : 0.005 + fit * 0.008);

/** A fursuit is the whole body, shagged, paler down the front. */
const PELT: Shell = { on: () => true, lift: 0.006, shag: 0.022, role: (at) => (at[2] > 0.02 && Math.abs(at[0]) < 0.1 && at[1] > 0.86 && at[1] < 1.42 ? "belly" : "skin"), fabric: FABRICS.fur };

/** Everything of the body that is seen or worn: skin where nothing covers it, and each garment cut from the same surface. */
/** A grown woman's bust: where each side sits, and how it falls off, longer above than below and to the side, as weight settles it low. */
interface Form { readonly x: number; readonly y: number; readonly z: number; readonly deep: number; readonly wide: number; readonly above: number; readonly below: number }

function formOf(p: Person): Form | undefined {
  const { sex, age, bust, shoulder } = p.build;
  if (sex !== "female" || (age !== "adult" && age !== "elder")) return undefined;
  const s = restSkeleton(p), full = Math.sqrt(bust), sag = age === "elder" ? 0.03 : 0.012;
  return { x: shoulder * 0.5, y: s.chest[1] + 0.012 - sag * bust, z: s.chest[2], deep: 0.05 * bust, wide: 0.06 * full, above: 0.09 * full, below: 0.05 * full };
}

/** How far one side stands out at a point of the chest. */
const sideAt = (f: Form, x: number, y: number): number => {
  const up = (y - f.y) / (y > f.y ? f.above : f.below), out = (x - f.x) / f.wide;
  return f.deep * Math.exp(-(up * up + out * out));
};
const formAt = (f: Form, at: Vec): number => (at[2] < f.z ? 0 : sideAt(f, Math.abs(at[0]), at[1]));

/** The body with the form on it: on the finished surface, where there are vertices enough for two sides and the hollow between. */
function shaped(body: Cage, form: Form | undefined): Cage {
  if (!form) return body;
  const torso = new Set(body.quads.flatMap((q, f) => (inRange(body.tags[f] ?? 0, TORSO + 4, TORSO + 10) ? [...q] : [])));
  return { ...body, rows: body.rows.map((row, i) => (torso.has(i) ? row.map((v, c) => (c === 2 ? v + formAt(form, pointOf(row)) : v)) : row)) };
}

/** Where a grown body is soft: its bust, a belly in proportion to its fat, its seat. Nothing on a child or a teenager moves this way. */
function softOf(p: Person, form: Form | undefined): (at: Vec) => number {
  const { age, girth, rear, belly } = p.build;
  if (age !== "adult" && age !== "elder") return () => 0;
  const s = restSkeleton(p), fat = Math.max(0, girth - 1) + belly, low = s.waist[1] - 0.05, seat = s.left.leg.hip[1] + 0.05;
  const bell = (x: number, y: number): number => Math.exp(-(x * x + y * y));
  return (at) => {
    const front = at[2] > s.pelvis[2], x = Math.abs(at[0]);
    const up = form ? clamp(formAt(form, at) / Math.max(0.001, form.deep * 0.8), 0, 1) : 0;
    const gut = front ? Math.min(0.9, fat * 2.4) * bell(x / 0.17, (at[1] - low) / 0.15) : 0;
    const back = front ? 0 : Math.min(0.8, 0.22 * rear + fat * 1.4) * bell((x - 0.08) / 0.11, (at[1] - seat) / 0.11);
    return Math.min(1, up + gut + back);
  };
}

/** How far ordinary cloth stands off the hollow between the two sides: it lies across, where a swimsuit goes in. */
const bridged = (form: Form | undefined) => (at: Vec): number => {
  const x = Math.abs(at[0]);
  return !form || at[2] < form.z || x > form.x ? 0 : Math.max(0, sideAt(form, form.x, at[1]) - sideAt(form, x, at[1]));
};

/** How finely to build a person by how far off they are, finest first: `reach` in metres, `kept` how many to hold built at once, `tris` about what one comes to. */
export const PERSON_LODS = [
  { name: "touching", cell: 0.014, reach: 3, kept: 4, tris: 75000 },
  { name: "close", cell: 0.02, reach: 9, kept: 8, tris: 43000 },
  { name: "medium", cell: 0.03, reach: 28, kept: 48, tris: 13000 },
  { name: "far", cell: 0.05, reach: 80, kept: 96, tris: 7700 },
  { name: "least", cell: 0.09, reach: Infinity, kept: 256, tris: 2000 },
] as const;
/** A grid this coarse has no use for a cage's second cut, and that alone is most of a far person. */
const LEAST_CELL = 0.07;

/** Which of `PERSON_LODS` a person at `distance` wants. `was`, the tier they are on, holds them a little past its reach, so nobody flickers on a line. */
export function lodFor(distance: number, was?: number): number {
  const want = PERSON_LODS.findIndex((lod) => distance < lod.reach);
  return was !== undefined && want === was + 1 && distance < (PERSON_LODS[was]?.reach ?? 0) * 1.15 ? was : want;
}

/** The tier each of a crowd gets, nearest first, for `budget` triangles in all: everybody has the least, then the nearest have what they want while it lasts. */
export function lodsWithin(wants: readonly number[], budget: number): readonly number[] {
  const last = PERSON_LODS.length - 1, least = PERSON_LODS[last]?.tris ?? 0;
  let left = budget - wants.length * least;
  return wants.map((want) => {
    const tier = PERSON_LODS.findIndex((lod, i) => i >= Math.min(want, last) && (i === last || lod.tris - least <= left));
    left -= (PERSON_LODS[tier]?.tris ?? least) - least;
    return tier;
  });
}

/** Frames longer than this (ms) are too long, and shorter than this leave room; one longer still is a pause, not load. */
const FRAME_LONG = 28, FRAME_ROOMY = 20, FRAME_PAUSE = 250;

/** A crowd's triangle budget following the frame: down quickly while frames run long, back slowly when they don't. Nothing but drawing may hang on it. */
export function crowdBudget(most: number, floor: number): (frameMs: number) => number {
  let budget = most;
  return (frameMs) => {
    if (frameMs < FRAME_PAUSE) budget = clamp(budget * (frameMs > FRAME_LONG ? 0.98 : frameMs < FRAME_ROOMY ? 1.002 : 1), floor, most);
    return budget;
  };
}

function dressedBody(net: Net, p: Person, roles: readonly string[], cell: number): void {
  const size = p.build.size;
  const first = cell >= LEAST_CELL ? cageOf(p) : subdivided(cageOf(p));
  const form = formOf(p);
  const body = shaped(cell < 0.03 ? subdivided(first) : first, form);
  const normals = normalsOf(body);
  const { top, bottom, shoe, fit } = p.outfit;
  const cover = coverOf(p), sandal = shoe === "sandal", s = restSkeleton(p);
  const soft = softOf(p, form);
  const lay = layOf(p), long = LONG_TOP[top] !== undefined, joined = cover.bare || long ? s.pelvis[1] : -FAR;
  if (p.outfit.costume === "fursuit") { shellOf(net, body, normals, PELT, roles, size); return; }
  // (What is in a tube is never seen: it is simply not built above the hem, so a belly or a pair of trousers cannot come through it.)
  const clear = clearOf(p);
  const cut = cutOf(p);
  const worn = wornOver(cover, cut, sandal);
  // (Round the shoulders the cloth stretches off the skin as an arm moves, so the skin stays, sunk, and no gap there opens on nothing.)
  const hidden = (t: number): boolean => !inRange(t, TORSO + 7, TORSO + 11) && !inRange(t, ARM, ARM + 2) && worn.some((on) => on(t) && on(t - 1) && on(t + 1));
  // (Skin that stays under a garment goes in under it, so the two can never meet, however either is bent.)
  const seen = new Set(body.quads.flatMap((q, f) => (worn.some((on) => on(body.tags[f] ?? 0)) ? [] : [...q])));
  // (And it takes the colour of what is over it, so if a bent joint ever brings it through, it does not read as a hole.)
  const garmentOver = (t: number): string | undefined => (!cut.top && cover.top(t) ? "top" : !cover.bare && !cut.lower && cover.lower(t) ? "bottom" : undefined);
  const under = new Map<number, string | undefined>(body.quads.flatMap((q, f) => q.map((v): [number, string | undefined] => [v, garmentOver(body.tags[f] ?? 0)])));
  const groundY = s.left.leg.ankle[1] - 0.07;
  shellOf(net, body, normals, { on: (t) => !hidden(t), keep: clear, lift: 0, role: (_, v) => (v === undefined || seen.has(v) ? "skin" : under.get(v) ?? "skin"), fabric: 0, soft, sink: (v) => (seen.has(v) ? 0 : 0.016) }, roles, size);
  if (!cover.bare) shellOf(net, body, normals, { on: cover.lower, keep: clear, cut: cut.lower, lift: lowerLift(bottom, fit), role: beltedBottom(p, s), fabric: lowerCloth(p), lay, soft }, roles, size);
  shellOf(net, body, normals, { on: cover.top, cut: cut.top, ...(SKINTIGHT.includes(top) ? {} : { span: bridged(form) }), lift: topLift(top, fit), role: frontOf(p, stripedTop(p, s), cell), fabric: topCloth(p), lay, soft, edge: (at) => at[1] > joined }, roles, size);
  shellOf(net, body, normals, { on: cover.feet, lift: 0.006, role: (at) => (at[1] < groundY ? "sole" : sandal ? "skin" : "shoe"), fabric: sandal ? FABRICS.skin : FABRICS.leather }, roles, size);
  skirtShell(net, p, roles, long, waistLoop(body, normals, long ? topLift(top, fit) : lowerLift(bottom, fit)), body);
  if (p.outfit.carry === "umbrella") umbrellaShell(net, p, roles);
}

/** Which quads of a body are worth building, given what hangs over them. */
function clearOf(p: Person): (at: Vec, tag: number) => boolean {
  if (LONG_TOP[p.outfit.top] === undefined && p.outfit.bottom !== "skirt") return () => true;
  const hem = hemOf(p);
  return (at, tag) => at[1] < hem + 0.18 || !(inRange(tag, TORSO, TORSO + 2) || inRange(tag, LEG, FOOT - 1));
}

/** The garments that wholly cover what they lie on: a cut one leaves skin between its pieces. */
function wornOver(cover: ReturnType<typeof coverOf>, cut: ReturnType<typeof cutOf>, sandal: boolean): readonly ((t: number) => boolean)[] {
  const worn: ((t: number) => boolean)[] = [];
  if (!cut.top) worn.push(cover.top);
  if (!cover.bare && !cut.lower) worn.push(cover.lower);
  if (!sandal) worn.push(cover.feet);
  return worn;
}

function beltedBottom(p: Person, s: Skeleton): (at: Vec) => string {
  const { bottom } = p.outfit, belted = bottom === "jeans" || bottom === "trousers" || bottom === "cargo";
  return bandsAt(belted ? [lerpV(s.pelvis, s.waist, 0.72)[1]] : [], 0.016, "dark", () => "bottom");
}

/** Bands round the body at these heights, cut in the surface itself, so they lie true on any figure. */
const bandsAt = (ys: readonly number[], half: number, role: string, under: (at: Vec) => string) => (at: Vec): string => (ys.some((y) => Math.abs(at[1] - y) < half) ? role : under(at));

function stripedTop(p: Person, s: Skeleton): (at: Vec) => string {
  const { top, stripes, costume } = p.outfit;
  const at = madd(s.chest, UP, 0.05);
  const plain = (v: Vec): string => (costume === "police" && v[2] > at[2] && Math.hypot(v[0] + p.build.shoulder * 0.5, v[1] - at[1]) < 0.028 ? "badge" : "top");
  if (stripes === 0 || (LONG_TOP[top] !== undefined && costume !== "firefighter")) return plain;
  return bandsAt(Array.from({ length: stripes }, (_, i) => mix(s.waist[1], s.chest[1], (i + 0.5) / stripes)), 0.022, "trim", plain);
}

/** A cut across the rings: how far inside what is left of a garment a point is, in metres, under nought outside it. The renderer draws the line itself, sharper than any quad. */
function cutOf(p: Person): { readonly top?: Cut; readonly lower?: Cut } {
  const s = restSkeleton(p), { shoulder, bust } = p.build;
  const form = formOf(p);
  const cups = { x: form?.x ?? shoulder * 0.42, y: form?.y ?? s.chest[1], h: 0.055 * Math.sqrt(bust), wide: 0.058 * Math.sqrt(bust) };
  const neck = shoulder * 0.26;
  const string: Cut = (at) => {
    const x = Math.abs(at[0]), k = clamp((cups.y + cups.h - at[1]) / (2 * cups.h), 0, 1), low = cups.y - cups.h;
    const tie = 0.011 - Math.abs(at[1] - low);
    if (at[2] < s.chest[2]) return tie;
    const strap = 0.014 - Math.abs(x - mix(cups.x, neck, clamp((at[1] - cups.y - cups.h) / 0.13, 0, 1)));
    if (at[1] > cups.y + cups.h) return strap;
    return Math.max(tie, Math.min(at[1] - low, 0.008 + cups.wide * k - Math.abs(x - cups.x)));
  };
  const crotch = s.left.leg.hip[1] - 0.06, rise = s.pelvis[1] + 0.05;
  const brief: Cut = (at) => {
    const k = clamp((at[1] - crotch) / (rise - crotch), 0, 1);
    return Math.min(rise - at[1], mix(0.035, p.build.hip * 1.25, k * k) * (at[2] < s.pelvis[2] ? 1.5 : 1) - Math.abs(at[0]));
  };
  return { ...(p.outfit.top === "string" ? { top: string } : {}), ...(p.outfit.bottom === "briefs" ? { lower: brief } : {}) };
}

/** The hanging tube of whatever a person has on that has one. */
/** An umbrella, built up and open over its holder, then taken back into the hand's resting place so it rides on that bone. */
function umbrellaCage(p: Person): Cage {
  const hand = heldHand(p), back = hand.toRest, axis = SHAFT;
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const grip = hand.toHeld(gripOf(restSkeleton(p).right.arm, unit(hand.spin(SHAFT))).centre), clear = headFrame(restSkeleton(p), p.build.head, p.face).at(0, 1.3, 0)[1] + 0.05;
  // (The rim comes down a little past the top of the head, wherever the hand is.)
  const tip = madd(grip, axis, Math.max(0.5, (clear - grip[1]) / axis[1]) + 0.24);
  const flat = unit(cross(axis, FRONT)), deep = cross(flat, axis);
  const around = 24, rings = 7, bones: readonly (readonly [string, number])[] = [["hand.R", 1]];
  const add1 = (at: Vec): void => { cage.rows.push(rowOf(back(at), bones)); };
  for (let j = 0; j < rings; j += 1) for (let i = 0; i < around; i += 1) {
    const a = (i / around) * TAU, k = (j + 0.05) / (rings - 1);
    const rib = 1 - 0.07 * k * Math.abs(Math.cos(a * 4));
    add1(madd(madd(madd(tip, axis, -0.24 * k * k), flat, Math.cos(a) * 0.56 * k * rib), deep, Math.sin(a) * 0.56 * k * rib));
  }
  const inner = back(madd(tip, axis, -0.3));
  for (let j = 0; j + 1 < rings; j += 1) for (let i = 0; i < around; i += 1) {
    const at = (x: number, y: number): number => y * around + (x % around);
    quad(cage, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], inner, 1);
  }
  const base = cage.rows.length;
  for (const end of [madd(grip, axis, -0.09), tip]) for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    add1(madd(madd(end, flat, Math.cos(a) * 0.008), deep, Math.sin(a) * 0.008));
  }
  for (let i = 0; i < 6; i += 1) quad(cage, [base + i, base + (i + 1) % 6, base + 6 + (i + 1) % 6, base + 6 + i], back(lerpV(grip, tip, 0.5)), 2);
  return cage;
}

function umbrellaShell(net: Net, p: Person, roles: readonly string[]): void {
  const cage = umbrellaCage(p);
  const canopy = (t: number): boolean => t === 1;
  shellOf(net, cage, normalsOf(cage), { on: canopy, lift: 0, role: () => "brolly", fabric: FABRICS.nylon }, roles, p.build.size);
  shellOf(net, cage, normalsOf(cage), { on: (t) => !canopy(t), lift: 0, role: () => "dark", fabric: FABRICS.latex }, roles, p.build.size);
}

/** How much wider the hips are than the waist. */
const hipsOver = (hip: Station | undefined, waist: Station | undefined): number => (hip?.wide ?? 1) / (waist?.wide ?? 1);

/** How low what hangs from the waist comes. */
function hemOf(p: Person): number {
  const leg = restSkeleton(p).left.leg;
  return lerpV(leg.hip, leg.knee, LONG_TOP[p.outfit.top] ?? 0.78)[1];
}

function skirtShell(net: Net, p: Person, roles: readonly string[], long: boolean, loop: readonly Row[], body: Cage): void {
  const { bottom } = p.outfit;
  if (!long && bottom !== "skirt") return;
  const s = restSkeleton(p), hem = hemOf(p), from = loop[0]?.[1] ?? s.pelvis[1];
  const rings = torsoStations(p, s);
  const clear = Math.min(1.24, hipsOver(rings[1], rings[3]) * 1.03);
  const cage = skirtCage(p, loop, hem, clear, bulkOf(body, from, hem, loop.reduce((n, v) => n + (v[2] ?? 0), 0) / Math.max(1, loop.length)));
  const free: Layer["free"] = [from - 0.1, Math.max(0.1, from - hem)];
  const hang = (at: Vec, row: Row): readonly [number, number, number, number] => {
    if (row.slice(3).some((v) => v > 0)) return [...strongest(row), 0];
    const [a, b, w] = skirtWeights(at, hangOf(s, 1)[0][1], s.left.leg.hip[1] + 0.02);
    return [a, b, w, clamp((free[0] - at[1]) / free[1], 0, 1)];
  };
  shellOf(net, cage, normalsOf(cage), { on: () => true, lift: 0, role: () => (long ? "top" : "bottom"), fabric: long ? topCloth(p) : lowerCloth(p), hang, edge: (at) => at[1] < from - 0.05 }, roles, p.build.size);
}

/** The layers a person is built of, inside out, each its own shell: body, head and neck, what they have on, their hair. */
/** How high hair may go: to a hat's hem. */
const roofOf = (dressed: readonly Capsule[], size: number): number => (dressed.find((c) => c.part === "hat")?.hem ?? FAR) - 0.006 * size;

/** What of a hairstyle's parts stays solid in a mesh: a beard, and an afro's mass. */
const meshHair = (massive: boolean, far: boolean) => (c: Capsule): boolean => far || (!/^(fringe|curl|bob|lock|fall|bun|tail|wave|plait|locs)/.test(c.part) && (massive || c.part !== "hair"));

/** Further off than this a head is what it melts to: a fixed mesh would have nothing to show there. */
const WRAPPED = 0.05;

/** The neck as the body builds it, a little inside it so it closes over the head's edge: where its middle lies from the head's, and its half width and depth, in head radii. */
function neckFor(p: Person, h: HeadFrame): readonly [number, number, number] {
  const s = restSkeleton(p), R = h.r * 0.5 * neckBy(p), z = lerpV(s.neck, s.head, 0.72)[2] - h.r * 0.1 * p.face.bone.m;
  return [(z - h.c[2]) / h.r, (R * 0.86 * 0.94) / h.r, (R * 0.96 * 0.94) / h.r];
}

function wrapOf(p: Person, cell: number): Wrap {
  const f = p.face, b = f.bone, size = p.build.size, h = headFrame(restSkeleton(p), p.build.head, f), low = (y: number): number => (y < 0 ? y * b.L : y);
  return { c: scale(h.c, size), R: p.build.head * size, eyeX: f.apart, eye: f.eye, pupil: low(b.pupil), sn: low(b.sub), sto: low(b.sto), men: low(b.men), mouth: f.mouthWide, neck: neckFor(p, h), level: cell < 0.018 ? 2 : cell < 0.026 ? 1 : 0 };
}

/** The fixed mesh a layer of a head goes on, and the dents that suit it, if it is near enough for one. */
function headLayerOf(p: Person, cell: number): Pick<Layer, "dents" | "wrap"> {
  return p.outfit.costume !== "fursuit" && cell < WRAPPED ? { dents: dentsOf(p, true), wrap: wrapOf(p, cell) } : { dents: dentsOf(p) };
}

function layersOf(p: Person, dressed: readonly Capsule[], bare: readonly Capsule[], cell: number): readonly Layer[] {
  const k = p.build.size;
  const chin = dressed.find((c) => c.part === "chin")?.a[1] ?? 1.4;
  const on = (...roles: readonly string[]): readonly Capsule[] => dressed.filter((c) => roles.includes(c.role) && !/^(hat|peak)/.test(c.part));
  const head = (c: Capsule): boolean => boneOfPart(c.part) === HEAD || c.part === "neck";
  const { fit } = p.outfit;
  const hairAt = dressed.find((c) => c.part === "skull")?.a ?? [0, 1.6, 0];
  const furred = p.outfit.costume === "fursuit";
  const shaggy = { head: hairAt, kind: "curl" as const, size: k };
  const pelt = furred ? { locks: shaggy } : {}, curled = { locks: { ...shaggy, kind: "tuft" as const } }, bareStuff = furred ? FABRICS.fur : FABRICS.skin;
  const roof = roofOf(dressed, k);
  // (Near to, a style is its locks: what they grow from is only the shell under them, and a beard.)
  const massive = COMBS[styleOf(p)]?.shell === true, hair = on("hair").filter(meshHair(massive, cell >= FAR_HAIR));
  // (The scalp stops where hair is thick over it, so it never shows through a parting; hair stops at a hat's hem, so it never shows through the crown.)
  const layers: Layer[] = [
    { parts: bare.filter((c) => head(c) && c.part !== "neck"), fine: 0.5, fabric: bareStuff, lift: 0, under: hair, tuck: -0.008 * k, relax: 2, loft: loftOf(p), rigid: true, ...pelt, ...headLayerOf(p, cell) },
    { parts: bare.filter((c) => /^(palm|fingers|thumb)/.test(c.part)), fine: 0.35, fabric: bareStuff, lift: 0 },
    { parts: dressed.filter((c) => /^(hood|collar|brush)/.test(c.part) && !(c.part === "collar" && p.outfit.top === "polo" && cell < WRAPPED)), fine: 0.7, fabric: furred ? FABRICS.fur : topCloth(p), lift: (furred ? 0.01 : 0.012 + fit * 0.016) * k, ...pelt },
    { parts: on("beard"), fine: 0.5, fabric: FABRICS.skin, lift: 0.002 * k, rigid: true, relax: 3 },
    { parts: hair, fine: 0.55, fabric: FABRICS.hair, lift: 0.004 * k, roof, free: [chin + 0.02 * k, 0.4 * k], ...(massive ? curled : {}) },
    { parts: dressed.filter((c) => /^(hat|peak)/.test(c.part) && !((c.part === "hat" || c.part === "hat.ridge" || (c.part === "peak" && BILLS[p.outfit.hat] !== undefined)) && fitsHat(p, cell))), fine: cell < WRAPPED ? 0.36 : 0.55, fabric: hatCloth(p.outfit.hat), lift: 0.008 * k },
  ];
  return layers.filter((l) => l.parts.length > 0);
}

/** How open each vertex lies: a surface turning in on itself round a vertex shuts it off from the sky, and that spreads a little either side of the fold. */
function creases(net: Net): Float32Array {
  const n = net.position.length / 3, shut = new Float32Array(n), links = new Float32Array(n);
  const towards = (a: number, b: number): void => {
    const d = [0, 1, 2].map((c) => (net.position[b * 3 + c] ?? 0) - (net.position[a * 3 + c] ?? 0));
    const l = Math.hypot(...d) || 1;
    shut[a] = (shut[a] ?? 0) + d.reduce((sum, v, c) => sum + (v / l) * (net.normal[a * 3 + c] ?? 0), 0);
    links[a] = (links[a] ?? 0) + 1;
  };
  const eachEdge = (visit: (a: number, b: number) => void): void => {
    for (let i = 0; i < net.index.length; i += 3) for (let j = 0; j < 3; j += 1) visit(net.index[i + j] ?? 0, net.index[i + (j + 1) % 3] ?? 0);
  };
  eachEdge(towards);
  for (let v = 0; v < n; v += 1) shut[v] = (shut[v] ?? 0) / Math.max(1, links[v] ?? 1);
  for (let pass = 0; pass < 5; pass += 1) {
    const sum = new Float32Array(n);
    eachEdge((a, b) => { sum[a] = (sum[a] ?? 0) + (shut[b] ?? 0); });
    for (let v = 0; v < n; v += 1) shut[v] = mix(shut[v] ?? 0, (sum[v] ?? 0) / Math.max(1, links[v] ?? 1), 0.7);
  }
  return shut.map((c) => 1 - 0.5 * clamp((c - 0.01) / 0.1, 0, 1));
}

/** A shirt hangs over what is under it, and the shadow it throws there is what parts the two, whatever their colours. */
function hemShadow(net: Net, shade: Float32Array, roles: readonly string[], size: number): Float32Array {
  const top = roles.indexOf("top"), lower = [roles.indexOf("bottom"), roles.indexOf("dark")];
  const hem = net.role.reduce((low, role, v) => (role === top ? Math.min(low, net.position[v * 3 + 1] ?? FAR) : low), FAR);
  return shade.map((c, v) => {
    const under = (hem - (net.position[v * 3 + 1] ?? 0)) / size;
    return lower.includes(net.role[v] ?? -1) && under > -0.03 && under < 0.06 ? c * mix(0.52, 1, clamp(under / 0.06, 0, 1)) : c;
  });
}

// ---------------------------------------------------------------- hair

/** Where a style's locks gather, and the line they run on from there: `t` 0 to 1 along it, `strand` of three in a plait. */
interface Tie { readonly at: Vec; readonly tail: (t: number, strand: number) => Vec; readonly spread: number; readonly plait?: boolean }

/** How a head of hair grows, in head radii: as many locks as this, combed from a parting, falling under their own weight and cut where they are cut. */
interface Comb {
  readonly count: number; readonly length: number; readonly width: number; readonly thick: number;
  /** How hard it falls; how much it stands off the scalp at the root. */
  readonly fall: number; readonly stand: number;
  /** A level it is cut to, and a fringe's, if it has them. */
  readonly cut?: number; readonly fringe?: number;
  readonly wave?: number; readonly rate?: number;
  /** How far shorter its shortest lock runs, for layers. */
  readonly layers?: number;
  readonly part?: number;
  readonly keep?: (u: Vec) => boolean;
  readonly ties?: readonly Tie[];
  /** A solid mass under the locks; a scalp clipped to stubble around them. */
  readonly shell?: boolean; readonly shave?: boolean;
  /** A sheet of broad locks under the fine ones, so a fall of hair is a mass and not strings. */
  readonly curtain?: boolean;
}

const SKULL_AT: Vec = [0, 0.24, -0.1], SKULL: Vec = [0.86, 1.1, 1.08];

/** The round mass of an afro, in head radii. */
const AFRO_AT: Vec = [0, 0.72, -0.3], AFRO = 1.14;

const ponyTail = (t: number): Vec => [0, 0.72 - 2.9 * t, -1.28 - 0.5 * Math.sin(t * 2.2)];
const bunCoil = (t: number): Vec => { const a = t * 30, up = t * Math.PI * 0.94 + 0.1, r = 0.36; return [Math.cos(a) * Math.sin(up) * r, 1.32 + Math.cos(up) * r * 0.74, -0.74 + Math.sin(a) * Math.sin(up) * r]; };
const pigtail = (x: number) => (t: number): Vec => [x * (1.04 + 0.42 * Math.sin(t * 2)), 0.38 - 2.5 * t, -0.62 - 0.2 * t];

/** One plait: three strands crossing over one another down a line, as a plait is. */
const plaited = (x: number) => (t: number, strand: number): Vec => {
  const a = t * 21 + strand * (TAU / 3), k = 0.19 * (1 - t * 0.5);
  return [x * (0.98 + 0.14 * t) + Math.sin(a) * k, -0.7 - 2.9 * t, 0.2 + 1.2 * clamp(t * 2.2, 0, 1) + Math.sin(a * 2) * k * 0.5];
};

const COMBS: Readonly<Record<HairStyle, Comb | undefined>> = {
  bald: undefined,
  crop: { fringe: 0.8, count: 240, length: 0.72, cut: 0.1, width: 0.12, thick: 0.045, fall: 0.5, stand: 0.15 },
  side: { curtain: true, count: 210, length: 1.5, width: 0.15, thick: 0.05, fall: 0.8, stand: 0.1, part: 0.42 },
  curly: { fringe: 0.74, count: 190, length: 1.7, cut: -0.7, width: 0.14, thick: 0.1, fall: 1.2, stand: 0.15, wave: 0.12, rate: 8 },
  afro: { count: 0, length: 0.3, width: 0.05, thick: 0.05, fall: 0, stand: 3, shell: true },
  bob: { curtain: true, count: 240, length: 2.8, cut: -0.92, width: 0.2, thick: 0.05, fall: 2, stand: 0.1, part: 0.1 },
  long: { curtain: true, count: 250, length: 4.2, cut: -3.2, width: 0.2, thick: 0.05, fall: 2.2, stand: 0.1, part: 0.06, layers: 0.14 },
  bun: { count: 170, length: 2, width: 0.15, thick: 0.08, fall: 0, stand: 0.1, ties: [{ at: [0, 1.02, -0.72], tail: bunCoil, spread: 0.09 }] },
  pony: { count: 170, length: 2, width: 0.15, thick: 0.08, fall: 0, stand: 0.1, ties: [{ at: [0, 0.72, -1.2], tail: ponyTail, spread: 0.27 }] },
  mohawk: { count: 200, length: 0.78, width: 0.075, thick: 0.065, fall: 0, stand: 3, keep: (u) => Math.abs(u[0]) < 0.2, shave: true },
  shag: { curtain: true, count: 230, length: 2.6, width: 0.18, thick: 0.06, fall: 1.7, stand: 0.2, wave: 0.07, rate: 3, layers: 0.55, fringe: 0.7 },
  bangs: { curtain: true, count: 250, length: 3.4, cut: -2.3, width: 0.19, thick: 0.05, fall: 2.2, stand: 0.1, fringe: 0.66 },
  wavy: { curtain: true, count: 240, length: 3.6, cut: -2.7, width: 0.19, thick: 0.06, fall: 2, stand: 0.15, wave: 0.13, rate: 2.6, part: 0.14, layers: 0.15 },
  braids: { count: 170, length: 2, width: 0.16, thick: 0.05, fall: 0, stand: 0.1, part: 0, ties: [-1, 1].map((x) => ({ at: [x * 0.98, -0.7, 0.2] as Vec, tail: plaited(x), spread: 0, plait: true })) },
  locs: { curtain: true, count: 62, length: 3.3, width: 0.1, thick: 0.1, fall: 2, stand: 0.1, wave: 0.03, rate: 2, layers: 0.2 },
  twintails: { count: 170, length: 2, width: 0.13, thick: 0.09, fall: 0, stand: 0.1, part: 0, ties: [-1, 1].map((x) => ({ at: [x * 0.98, 0.42, -0.56] as Vec, tail: pigtail(x), spread: 0.26 })) },
  undercut: { count: 110, length: 1.6, width: 0.16, thick: 0.06, fall: 0.5, stand: 0.1, part: -0.5, keep: (u) => u[1] > 0.42, shave: true },
};

/** The hairline: well up the brow, down to the ears at the sides, into the nape behind. */
const HAIRLINE: readonly (readonly [number, number])[] = [[1, 0.64], [0.5, 0.6], [0.37, 0.3], [0.26, -0.08], [0.14, -0.08], [0.03, 0.12], [-0.25, 0.02], [-0.55, -0.35], [-0.8, -0.62], [-1, -0.62]];

/** Behind the hairline: across the brow, in at the temple, down a sideburn, up over the ear and round to the nape. */
const scalped = (u: Vec): boolean => {
  const next = HAIRLINE.findIndex(([z]) => z <= u[2]), b = HAIRLINE[Math.max(1, next)] ?? [-1, -0.62], a = HAIRLINE[Math.max(0, Math.max(1, next) - 1)] ?? b;
  return u[1] > mix(a[1], b[1], clamp((a[0] - u[2]) / Math.max(0.001, a[0] - b[0]), 0, 1));
};

/** A point laid on the skull, where hair lies until it falls away from it. */
function onSkull(q: Vec): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], far = Math.hypot(...e) || 1;
  return add(SKULL_AT, [(SKULL[0] * e[0]) / far, (SKULL[1] * e[1]) / far, (SKULL[2] * e[2]) / far]);
}

/** A point kept out of the skull, and off the face unless it is a fringe. */
function offHead(q: Vec, front: boolean): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], far = Math.hypot(...e);
  const out: Vec = far < 1 ? [SKULL_AT[0] + (SKULL[0] * e[0]) / far, SKULL_AT[1] + (SKULL[1] * e[1]) / far, SKULL_AT[2] + (SKULL[2] * e[2]) / far] : q;
  const onFace = !front && out[1] < 0.42 && out[1] > -1.3 && out[2] > 0.3 && Math.abs(out[0]) < 0.92;
  return onFace ? [out[0], out[1], 0.3] : out;
}

/** Past the shoulders hair lies down the back. */
const offShoulders = (q: Vec): Vec => {
  const k = clamp((-1.5 - q[1]) / 0.6, 0, 1);
  return [q[0], q[1], mix(q[2], Math.min(q[2], -1.25), k)];
};

const rootAt = (u: Vec): Vec => add(SKULL_AT, [SKULL[0] * u[0], SKULL[1] * u[1], SKULL[2] * u[2]]);

/** Which way a root's hair leaves it: forward over the brow if it is a fringe, else out from the parting, or from the crown if it has none. */
function leaving(c: Comb, u: Vec, brow: boolean, parted: number, rand: () => number): Vec {
  const loose = (rand() - 0.5) * (brow ? 0.1 : 0.3), side = u[0] - parted, away: Vec = brow ? [side * 0.3 + loose, 0.1, 1] : c.part === undefined ? [u[0] + loose, 0, u[2] + 0.25] : u[2] < 0.3 ? [side * 1.6 + loose, 0, u[2] - 0.2] : [side * 1.1 + loose, 0.7, -1.5];
  return unit(add(unit(away, SIDE), scale(u, c.stand)));
}

/** One step of a lock. Combed hair lies on the head until it has somewhere to fall; only what is stiff stands off it. */
function lockStep(c: Comb, q: Vec, d: Vec, ds: number, brow: boolean): readonly [Vec, Vec] {
  const lies = c.stand < 1, leaning = lies && q[1] < SKULL_AT[1] + 0.25, step = madd(q, leaning ? unit(add(d, [0, -2.4, 0])) : d, ds);
  const next = offShoulders(offHead(lies && step[1] > SKULL_AT[1] ? onSkull(step) : step, brow));
  // (Off the head, nothing holds it up: it turns straight down.)
  // (And what comes over the temple is drawn back round it, clear of the face.)
  const free = lies && next[1] <= SKULL_AT[1], temple = lies && !brow && next[2] > 0.05 && next[1] < 0.85;
  return [next, unit(add(lies ? unit(sub(next, q), d) : d, [0, -c.fall * ds * (free ? 6 : 1), temple ? -2.2 * ds : 0]))];
}

/** A lock's line, from its root, combed and let fall. */
function combed(comb: Comb, u: Vec, rand: () => number, parted: number): readonly Vec[] {
  const c = { wave: 0, rate: 0, layers: 0, cut: -FAR, ...comb }, brow = c.fringe !== undefined && u[2] > 0.34 && u[1] > 0.4;
  const end = c.length * (1 - c.layers * rand()) * (brow ? 0.4 : 1), steps = Math.max(5, Math.ceil(end * 7)), ds = end / steps, stop = (brow ? c.fringe ?? -FAR : c.cut) + (rand() - 0.5) * (brow ? 0.04 : 0.34);
  const root = rootAt(u), lateral = unit(cross(leaving(c, u, brow, parted, rand), UP), SIDE), beat = rand() * TAU;
  let d = leaving(c, u, brow, parted, rand), q = root;
  const line: Vec[] = [root];
  for (let i = 0; i < steps && q[1] >= stop; i += 1) {
    [q, d] = lockStep(c, q, d, ds, brow);
    const arc = (i + 1) * ds, sway = c.wave * Math.min(1, arc * 1.2) * (u[2] > 0.25 ? 0.25 : 1), a = arc * c.rate + beat;
    line.push(add(q, add(scale(lateral, sway * Math.sin(a)), [0, 0, sway * Math.cos(a * 0.7)])));
  }
  // (Fine steps to follow the skull; a straight fall needs few points to hold them.)
  return line.filter((_, i) => i < 8 || i % (c.wave > 0 ? 2 : 3) === 0 || i === line.length - 1);
}

/** A lock drawn back to a tie and on along what runs from it. */
function gathered(tie: Tie, u: Vec, rand: () => number): readonly Vec[] {
  const root = rootAt(u), strand = Math.floor(rand() * 3), points = 14;
  // (A low tie is reached round the back of the head, never across the face.)
  const low = tie.at[1] < 0.6 && u[2] > -0.3, way = onSkull([(tie.at[0] || 1) > 0 ? 0.76 : -0.76, Math.max(tie.at[1], 0.1) + 0.2, -0.56]);
  const up = Array.from({ length: low ? 9 : 6 }, (_, i) => { const t = i / (low ? 9 : 6); return offHead(low ? lerpV(lerpV(root, way, t), lerpV(way, tie.at, t), t) : lerpV(root, tie.at, t), true); });
  const off: Vec = [(rand() - 0.5) * tie.spread * 2, (rand() - 0.5) * tie.spread, (rand() - 0.5) * tie.spread * 2], lag = rand() * 0.12;
  const run = Array.from({ length: points }, (_, i): Vec => { const t = (i / (points - 1)) * (1 - lag); return add(tie.tail(t, strand), scale(off, clamp(t * 5, 0.22, 1) * (1 - t * 0.5))); });
  return tie.plait === true ? up : [...up, ...run];
}

/** How a lock faces at a point round it. A fold of skin is lit as the skin it lies on, or a thin one is all edge and catches the rim light; a rope or a band is round; a clump of hair faces out, for what lights it is the mass, not the ribbon. */
function lockNormal(b: Vec, n: Vec, o: Vec, c: number, r: number, round: boolean, fabric?: number): Vec {
  if (fabric === FABRICS.skin) return unit(add(o, scale(b, c * 0.3)));
  if (fabric !== undefined) return unit(add(scale(b, c * 0.7), scale(n, r)));
  return unit(round ? add(scale(b, c * 0.6), scale(n, 0.55 + r * 0.45)) : add(scale(b, c * 0.45), scale(n, 0.7 + r * 0.3)));
}

/** A lock's width along it: full from near the root, gone to almost nothing at the end. */
const lockTaper = (s: number): number => Math.min(1, 0.8 + s * 3) * Math.min(1, (1 - s) * 3 + 0.12);

/** One lock laid into the net: a flat tapering ribbon, round as a rope if it is as thick as it is wide. */
function layLock(net: Net, roles: readonly string[], to: (q: Vec) => Vec, line: readonly Vec[], [width, thick, sides]: readonly [number, number, number], worn?: { readonly up?: Vec; readonly bone?: number; readonly role: string; readonly fabric: number; readonly taper?: (s: number) => number }): number {
  const base = net.position.length / 3, bone = worn?.bone ?? HEAD, role = Math.max(0, roles.indexOf(worn?.role ?? "hair")), last = line.length - 1, taperOf = worn ? worn.taper ?? (() => 1) : lockTaper;
  line.forEach((q, i) => {
    const s = i / last, t = unit(sub(line[Math.min(last, i + 1)] ?? q, line[Math.max(0, i - 1)] ?? q), UP), o = worn?.up ?? unit(sub(q, SKULL_AT), UP);
    const b = unit(cross(t, o), SIDE), n = cross(b, t), taper = taperOf(s);
    for (let j = 0; j < sides; j += 1) {
      const a = (j / sides) * TAU, c = Math.cos(a), r = Math.sin(a);
      net.position.push(...to(add(madd(q, b, c * width * taper), scale(n, r * thick * taper))));
      net.normal.push(...lockNormal(b, n, o, c, r, thick >= width * 0.7, worn?.fabric));
      net.role.push(role); net.bones.push(bone, bone); net.weight.push(1); net.fabric.push(worn?.fabric ?? FABRICS.hair);
      net.loose.push(clamp(s * 1.6 - 0.2, 0, 1) * 0.8); net.soft.push(0);
      if (worn) net.cloth.push(j / sides, 0, s * last * 0.08, 1); else net.cloth.push(t[0], t[1], t[2], (base % 97) * 0.41 + c * width);
    }
    if (i === last) return;
    for (let j = 0; j < sides; j += 1) { const v = base + i * sides, k = (j + 1) % sides; net.index.push(v + j, v + k, v + sides + j, v + k, v + sides + k, v + sides + j); }
  });
  return line.length * sides;
}

/** Hair that stands or hangs in its own ropes, and is not a mass of clumps. */
const roped = (c: Comb): boolean => c.thick >= 0.1 || c.stand >= 1;

/** The roots of a head of hair, evenly over it, as far as its hairline and its style let them go. */
function rootsOf(c: Comb, far: boolean): readonly Vec[] {
  const all = Math.ceil(c.count * (roped(c) ? 1 : far ? 0.2 : 0.46) * 2.6);
  const every = Array.from({ length: all }, (_, i): Vec => { const y = 1 - (2 * (i + 0.5)) / all, r = Math.sqrt(1 - y * y), a = i * 2.39996 + 0.7; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  return every.filter((u) => scalped(u) && (c.keep?.(u) ?? true));
}

/** What hair grows from is its roots' dark, so nothing between the locks reads as a bald patch: the skin behind the hairline, clipped to stubble or not. */
function paintScalp(net: Net, roles: readonly string[], h: HeadFrame, size: number, shaved: boolean): void {
  const paint = Math.max(0, roles.indexOf(shaved ? "brow" : "hair"));
  net.role.forEach((_, v) => {
    if ((net.bones[v * 2] !== HEAD && net.bones[v * 2 + 1] !== HEAD) || net.fabric[v] !== FABRICS.skin) return;
    const at: Vec = [0, 1, 2].map((c) => ((net.position[v * 3 + c] ?? 0) / size - (h.c[c] ?? 0)) / h.r) as unknown as Vec;
    const e = sub(at, SKULL_AT), u = unit([e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]], UP);
    // (Not an ear, which stands out past the skull; and short of the hairline, which the cap draws.)
    const ear = Math.hypot(e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]) > 1.08;
    if (scalped(unit([u[0], u[1] - 0.09, u[2]], UP)) && e[1] > -0.9 && !ear) net.role[v] = paint;
  });
}

const styleOf = (p: Person): HairStyle => (p.outfit.hat === "none" ? p.hair : HATTED[p.hair] ?? p.hair);

/** A lock's shade along it: deep at the root, and a band of sheen where hair rounds the crown. */
const lockTone = (s: number, tone: number): number => tone * mix(0.72, 1, clamp(s * 5, 0, 1));

/** How close a mesh has to be, by its grid, for a head of locks; further than this, thinner ones; further still, the solid shape alone. */
const MID_HAIR = 0.02, FAR_HAIR = 0.03;

const ELASTIC = { role: "trim", fabric: FABRICS.satin };

/** A loop round a line, where it is tied. */
const looped = (at: Vec, along: Vec, r: number): readonly Vec[] => {
  const a = unit(cross(along, SIDE), FRONT), b = cross(along, a);
  return Array.from({ length: 11 }, (_, i) => { const t = (i / 10) * TAU; return add(madd(at, a, Math.cos(t) * r), scale(b, Math.sin(t) * r)); });
};

/** What holds a style up or just dresses it: every tie has its elastic, and now and then a head has a band or a clip. */
function decorOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb): readonly number[] {
  const lay = (line: readonly Vec[], size: readonly [number, number, number]): number[] => Array.from({ length: layLock(net, roles, to, line, size, ELASTIC) }, () => 1);
  const bands = (c.ties ?? []).flatMap((t) => (t.plait === true ? [t.tail(0.98, 0), t.at] : [t.at]).map((at) => {
    const down = t.plait === true ? unit(sub(t.tail(0.99, 0), t.tail(0.9, 0)), UP) : unit(sub(t.tail(0.06, 0), t.at), UP);
    return lay(looped(at, down, t.plait === true ? 0.16 : t.spread * 0.3 + 0.13), [0.06, 0.06, 4]);
  }));
  return bands.flat();
}

const SKIN_RIDGE = { role: "skin", fabric: FABRICS.skin };

const LOOSE: readonly HairStyle[] = ["side", "curly", "bob", "long", "shag", "bangs", "wavy", "locs"];

/** Which ears are bare, left and right. Hair worn loose goes over them, or is tucked back behind one or both; every other head shows them. */
export function tuckOf(p: Person): readonly [boolean, boolean] {
  if (!LOOSE.includes(styleOf(p))) return [true, true];
  const rand = streamOf(p.seed, 0x7475636b), roll = rand(), side = rand() < 0.5;
  if (roll < 0.6) return [false, false];
  return roll < 0.8 ? [true, true] : [side, !side];
}

/** Hair that would come down over the face stops short of it; what falls beside the face stays beside it. */
function offFace(line: readonly Vec[]): readonly Vec[] {
  const on = (q: Vec): boolean => q[2] > 0.12 && q[1] < 0.62 && Math.abs(q[0]) < 0.8, at = line.findIndex(on);
  return at < 0 ? line : line.slice(0, at);
}

/** Ropes of hair lie on the cap, not in it. */
const onCap = (c: Comb, q: Vec): Vec => (roped(c) ? add(SKULL_AT, scale(sub(q, SKULL_AT), 1.05)) : q);

/** Tucked means tucked: what starts ahead of the ear stops above it, and nothing hangs in front. */
function clearOfEar(line: readonly Vec[], tucked: boolean): readonly Vec[] {
  const at = tucked ? line.findIndex((q) => q[1] < 0.3 && q[2] > -0.3) : -1;
  return at < 0 ? line : line.slice(0, at);
}

/** A lock past the ear on its way down: all of it behind the ear if that side is tucked, all of it clear over the ear if not. */
function pastEar(q: Vec, tucked: boolean): Vec {
  const low = clamp((0.42 - q[1]) / 0.25, 0, 1);
  if (tucked) return offHead([q[0], q[1], q[2] > -0.36 ? mix(q[2], -0.36 - (q[2] + 0.36) * 0.2, low) : q[2]], true);
  const round = low * clamp((q[1] + 0.55) / 0.2, 0, 1) * clamp((0.2 - q[2]) / 0.15, 0, 1) * clamp((q[2] + 0.5) / 0.15, 0, 1);
  return [q[0] < 0 ? Math.min(q[0], mix(q[0], -1.08, round)) : Math.max(q[0], mix(q[0], 1.08, round)), q[1], q[2]];
}

/** A head's boundary: the true surface of what is already on it, round its centre, in head radii. Whatever goes on a person is seated on this, and never on a guess at where a head is. */
interface Bound {
  /** How far out the surface lies along a direction from the centre. */
  readonly far: (dir: Vec) => number;
  /** The point on it along a direction, `lift` clear of it. */
  readonly on: (dir: Vec, lift?: number) => Vec;
}

const SHELL_AROUND = 96, SHELL_UP = 48;

/** A direction from a head's centre: `az` round from the nose, `el` up. */
const bearingOf = (az: number, el: number): Vec => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

/** Fills the cells of a shell no vertex fell in from their neighbours, then eases it. */
function closedShell(cells: Float32Array): void {
  const at = (grid: Float32Array, a: number, e: number): number => grid[clamp(e, 0, SHELL_UP - 1) * SHELL_AROUND + ((a + SHELL_AROUND) % SHELL_AROUND)] ?? 0;
  const pass = (fill: boolean): void => {
    const was = cells.slice();
    for (let e = 0; e < SHELL_UP; e += 1) for (let a = 0; a < SHELL_AROUND; a += 1) {
      const near = [at(was, a - 1, e), at(was, a + 1, e), at(was, a, e - 1), at(was, a, e + 1)].filter((v) => v > 0), mine = at(was, a, e);
      if (near.length === 0 || (fill && mine > 0)) continue;
      const mean = near.reduce((sum, v) => sum + v, 0) / near.length;
      cells[e * SHELL_AROUND + a] = fill ? mean : mine > 0 ? mine * 0.5 + mean * 0.5 : mean;
    }
  };
  for (let i = 0; i < 12; i += 1) pass(true);
  pass(false);
}

/** The boundary of a head, from those of its vertices `keep` takes. */
function boundOf(net: Net, h: Pick<HeadFrame, "c" | "r">, size: number, keep: (v: number) => boolean): Bound {
  const cells = new Float32Array(SHELL_AROUND * SHELL_UP);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r), far = Math.hypot(...q);
    if (far < 0.2 || far > 3.5) continue;
    const a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * SHELL_AROUND), e = clamp(Math.floor((Math.asin(q[1] / far) / Math.PI + 0.5) * SHELL_UP), 0, SHELL_UP - 1), i = e * SHELL_AROUND + a;
    cells[i] = Math.max(cells[i] ?? 0, far);
  }
  closedShell(cells);
  const far = (dir: Vec): number => {
    const a = ((Math.atan2(dir[0], dir[2]) / TAU + 1) % 1) * SHELL_AROUND - 0.5, e = clamp((Math.asin(clamp(dir[1], -1, 1)) / Math.PI + 0.5) * SHELL_UP - 0.5, 0, SHELL_UP - 1.001);
    const a0 = Math.floor(a), e0 = Math.floor(e), cell = (x: number, y: number): number => cells[y * SHELL_AROUND + ((x + SHELL_AROUND) % SHELL_AROUND)] ?? 1;
    return mix(mix(cell(a0, e0), cell(a0 + 1, e0), a - a0), mix(cell(a0, e0 + 1), cell(a0 + 1, e0 + 1), a - a0), e - e0);
  };
  return { far, on: (dir, lift = 0) => scale(dir, far(dir) + lift) };
}

/** Where what is worn holds on to a head: its skin, and each ear's top and lobe once it has them. */
interface Seat { readonly skin: Bound; readonly tops: (Vec | null)[]; readonly lobes: (Vec | null)[] }

/** A line with its corners rounded off. */
function roundedOff(line: readonly (readonly [number, number])[], times: number): readonly (readonly [number, number])[] {
  if (times <= 0) return line;
  const cut = line.slice(1).flatMap((b, i): (readonly [number, number])[] => { const a = line[i] ?? b; return [[mix(a[0], b[0], 0.25), mix(a[1], b[1], 0.25)], [mix(a[0], b[0], 0.75), mix(a[1], b[1], 0.75)]]; });
  return roundedOff([line[0] ?? [0, 0], ...cut, line[line.length - 1] ?? [0, 0]], times - 1);
}

/** The folds of an ear, forward and up from its middle, in head radii: the rim round the top and back, the ridge inside it, and the flap before it. */
const EAR_RIM: readonly (readonly [number, number])[] = [[0.08, 0.1], [0.1, 0.24], [0.02, 0.32], [-0.1, 0.33], [-0.2, 0.24], [-0.24, 0.1], [-0.21, -0.05], [-0.13, -0.17], [-0.05, -0.26]];
const EAR_RIDGE: readonly (readonly [number, number])[] = [[-0.03, 0.22], [-0.1, 0.18], [-0.13, 0.08], [-0.1, -0.03], [-0.04, -0.11]];
const EAR_FLAP: readonly (readonly [number, number])[] = [[0.08, 0.04], [0.09, -0.02], [0.06, -0.08]];

/** The skin of an ear, from its rim in to the hollow, dished: both sides of it, for what shows from behind. */
function pinnaOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, at: (a: number, b: number, sunk: number) => Vec, rim: readonly (readonly [number, number])[]): readonly number[] {
  const rings = 4, base = net.position.length / 3, count = rim.length, role = Math.max(0, roles.indexOf("skin")), mid = rim.reduce<readonly [number, number]>((m, [a, b]) => [m[0] + a / count, m[1] + b / count], [0, 0]);
  const tones: number[] = [];
  // (The last ring runs back from the rim to the head, so an ear is a solid thing and not a sheet held beside it.)
  for (let k = 0; k <= rings + 1; k += 1) rim.forEach(([a, b]) => {
    const s = Math.min(1, k / rings), back = k > rings, q = back ? at(mix(mid[0], a, 0.72), mix(mid[1], b, 0.72), 0.34) : at(mix(mid[0], a, s), mix(mid[1], b, s), 0.09 * (1 - s));
    net.position.push(...to(q)); net.normal.push(...unit([q[0], 0, 0.3], SIDE)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.skin);
    net.loose.push(0); net.cloth.push(0, 0, 0, 1); net.soft.push(0); tones.push(mix(0.56, 0.9, s));
  });
  for (let k = 0; k <= rings; k += 1) for (let i = 0; i < count; i += 1) {
    const v = base + k * count, n = (i + 1) % count, one = v + i, two = v + n, three = v + count + i, four = v + count + n;
    net.index.push(one, two, three, two, four, three, one, three, two, two, three, four);
  }
  return tones;
}

/** A pair of ears, each its own: how big, how far they stand out, and how the lobe hangs. Near to, the dish and every fold; a little further, the dish and its rim; far off, only the shape the head already has. */
function earsOf(net: Net, p: Person, roles: readonly string[], cell: number, seat: Seat): readonly number[] {
  if (cell >= FAR_HAIR || p.outfit.costume === "fursuit" || ["hood", "helmet", "beanie", "pompom", "headwrap"].includes(p.outfit.hat)) return [];
  const rand = streamOf(p.seed, 0x65617273), h = headFrame(restSkeleton(p), p.build.head, p.face), size = p.build.size, k = marksOf(p);
  const big = (p.face.ears / 0.26) * mix(1, 1.18, rand()), stands = mix(0.34, 0.68, rand() ** 1.6), hangs = mix(0, 0.1, rand());
  const near = cell < MID_HAIR, to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), lit = 1 + 0.2 * deepOf(p.palette.skin ?? "#888888");
  const tucks = tuckOf(p), level = Math.atan2((k.pupil + k.sn) / 2 + 0.06, 0.85);
  return [-1, 1].flatMap((x, side) => {
    if (!tucks[side]) return [];
    // (An ear grows from the skin where the skin really is: from the line of the brow to the base of the nose, behind the jaw, leaning back.)
    const out = unit([x, 0.04, -0.24], SIDE);
    const at = (a: number, b: number, sunk = 0): Vec => {
      const lean = b * 0.22, dir = bearingOf(x * (Math.PI / 2 + 0.12 - (a - lean) * big), level + b * big);
      return madd(seat.skin.on(dir), out, 0.03 + Math.max(0, (0.12 - a) * big * stands + Math.min(0, b) * 0.34) - sunk);
    };
    const lobe = [[-0.03, -0.3 - hangs], [0.03, -0.27 - hangs * 0.5]] as const, line = roundedOff([...EAR_RIM, ...lobe], near ? 2 : 1), flap = roundedOff(EAR_FLAP, near ? 1 : 0);
    seat.tops[side] = at(-0.06, 0.33);
    seat.lobes[side] = at(0, -0.3 - hangs);
    const tones = [...pinnaOf(net, roles, to, at, [...line, ...flap.slice().reverse()])];
    const ridges: readonly (readonly [readonly (readonly [number, number])[], number, number, number])[] = near ? [[line, 0.046, 0.032, 0.94], [roundedOff(EAR_RIDGE, 2), 0.026, 0.02, 0.84], [flap, 0.03, 0.024, 0.92]] : [[line, 0.05, 0.032, 0.92]];
    for (const [fold, wide, deep, tone] of ridges) {
      const verts = layLock(net, roles, to, fold.map(([a, b]) => at(a, b)), [wide * big, deep * big, near ? 5 : 3], SKIN_RIDGE);
      tones.push(...Array.from({ length: verts }, () => tone));
    }
    // (On deep skin an ear's folds would close up into a hole.)
    return tones.map((t) => t * lit);
  });
}

/** How low hair comes round the head, at a bearing from the brow. */
function edgeAt(a: number, c: Comb): number {
  const held = (y: number): boolean => { const u = unit([Math.sin(a), y, Math.cos(a)], UP); return scalped(u) && (c.keep?.(u) ?? true); };
  let y = 2.4;
  while (y > -2.4 && held(y - 0.04)) y -= 0.04;
  return y;
}

/** The way hair runs over the cap: to its tie, or back and down. */
function flowOf(c: Comb, u: Vec): Vec {
  const tie = tieOf(c, u);
  return tie ? unit(sub(tie.at, add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]])), UP) : unit([u[0] * 0.3, -0.5, -1], UP);
}

/** What hair grows out of: a skin of it over the skull, ending along the hairline itself, a curve and not a mesh's steps, a little ragged. */
function capOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roof: number, far: boolean, rand: () => number): readonly number[] {
  const around = far ? 40 : 96, rows = far ? 6 : 10, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [];
  const rag = Array.from({ length: around }, () => (rand() - 0.5) * 0.05), puff = roped(c) ? 1.08 : 1.03;
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i < around; i += 1) {
    const a = (i / around) * TAU, s = k / rows, low = edgeAt(a, c) + (rag[i] ?? 0) * s, y = mix(2.4, low, s), u = unit([Math.sin(a), y, Math.cos(a)], UP);
    const q = to(add(SKULL_AT, [u[0] * SKULL[0] * puff, u[1] * SKULL[1] * puff, u[2] * SKULL[2] * puff]));
    net.position.push(q[0], Math.min(q[1], roof), q[2]); net.normal.push(...u); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(0); net.soft.push(0); net.cloth.push(...flowOf(c, u), a * 2.2); tones.push(mix(0.94, 0.84, s));
  }
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < around; i += 1) {
    const v = base + k * around, n = (i + 1) % around;
    net.index.push(v + i, v + n, v + around + i, v + n, v + around + n, v + around + i, v + i, v + around + i, v + n, v + n, v + around + i, v + around + n);
  }
  return tones;
}

/** The hair down over an ear: one sheet from the temple to where the hair ends, round the ear and not through it. */
function sideOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, x: number, rand: () => number, far: boolean): readonly number[] {
  const across = far ? 8 : 20, rows = far ? 8 : 16, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [];
  const bottom = Math.max(-1.5, c.cut ?? -FAR, 0.7 - c.length * 0.75), scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.09);
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i <= across; i += 1) {
    const s = k / rows, z = mix(mix(0.14, -0.1, s) + 0.035 * Math.sin(s * 9 + x), -0.72, i / across), y = mix(0.62, bottom + (scallops[i] ?? 0) + (1 - i / across) ** 3 * 0.7, s);
    const round = Math.sqrt(Math.max(0, 1 - ((y - SKULL_AT[1]) / SKULL[1]) ** 2 - ((z - SKULL_AT[2]) / SKULL[2]) ** 2)) * SKULL[0] * 1.045;
    const ear = clamp((y + 0.5) / 0.2, 0, 1) * clamp((0.62 - y) / 0.2, 0, 1) * clamp((0.24 - z) / 0.14, 0, 1) * clamp((z + 0.5) / 0.12, 0, 1), wide = Math.max(round, 0.74, mix(0, 1.02, ear));
    net.position.push(...to([x * wide, y, z])); net.normal.push(...unit([x, 0.1, z * 0.6], UP)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(clamp(s * 1.4 - 0.4, 0, 1) * 0.5); net.soft.push(0); net.cloth.push(0, -1, -0.1, z * 1.6); tones.push(0.86);
  }
  const row = across + 1;
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < across; i += 1) {
    const v = base + k * row + i;
    net.index.push(v, v + row, v + 1, v + 1, v + row, v + row + 1, v, v + 1, v + row, v + 1, v + row + 1, v + row);
  }
  return tones;
}

/** A fringe: one sheet of hair from under the cap down over the brow, cut in an even line that rises to the temples, a little scalloped. */
function fringeOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, rand: () => number, far: boolean): readonly number[] {
  if (c.fringe === undefined) return [];
  const across = far ? 16 : 40, rows = 6, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [], wide = 0.76;
  const scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.035), beat = rand() * TAU;
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i <= across; i += 1) {
    const x = ((i / across) * 2 - 1) * wide, s = k / rows, edge = (c.fringe ?? 0) + 0.3 * (x / wide) ** 4 + 0.03 * Math.sin(x * 16 + beat) + (scallops[i] ?? 0) * 1.8;
    const y = mix(1.04, edge, s), ex = x / SKULL[0], ey = (y - SKULL_AT[1]) / SKULL[1], z = Math.sqrt(Math.max(0.02, 1 - ex * ex - ey * ey));
    const out = unit([ex, ey, z], UP), q = add(SKULL_AT, [out[0] * SKULL[0] * 1.045, out[1] * SKULL[1] * 1.045, out[2] * SKULL[2] * 1.045]);
    net.position.push(...to(q)); net.normal.push(...out); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(0); net.soft.push(0); net.cloth.push(x * 0.12 + 0.3 * Math.sin(x * 23 + beat) + (scallops[i] ?? 0) * 26, -1, 0.15 + 0.3 * Math.sin(x * 31 + beat * 2), x * 1.6); tones.push(mix(0.8, 0.66, s) * (0.92 + 0.5 * (scallops[i] ?? 0) / 0.035 * 0.3));
  }
  const row = across + 1;
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < across; i += 1) {
    const v = base + k * row + i;
    net.index.push(v, v + row, v + 1, v + 1, v + row, v + row + 1, v, v + 1, v + row, v + 1, v + row + 1, v + row);
  }
  return tones;
}

/** Short fine hairs along the hairline, lying back on the skull: where a head of hair really starts is never a line. */
function featherOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, rand: () => number, far: boolean): readonly number[] {
  const tones: number[] = [];
  for (let i = 0; i < (far || c.shell === true ? 0 : 150); i += 1) {
    const a = (i / 150) * TAU + rand() * 0.04, ground: Vec = [Math.sin(a), 0, Math.cos(a)];
    const y = edgeAt(a, c), u = unit([ground[0], y - rand() * 0.08, ground[2]], UP), root = add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]]);
    const back = unit([-ground[0] * 0.25, 0.75, -ground[2] * 0.7 + (rand() - 0.5) * 0.3], UP), long = mix(0.1, 0.24, rand());
    const line = [0, 0.33, 0.66, 1].map((s) => { const q = onSkull(madd(root, back, s * long)); return add(SKULL_AT, scale(sub(q, SKULL_AT), 1.012)); });
    const from = net.loose.length, verts = layLock(net, roles, to, line, [c.width * 0.42, c.thick * 0.6, 3]), tone = 0.76 + rand() * 0.24;
    net.loose.fill(0, from);  // (Too short to blow about.)
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone(v / verts * 0.3, tone)));
  }
  return tones;
}

/** Each plait's three strands, round as rope, over and under one another. */
function plaitsOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb): readonly number[] {
  const ties = (c.ties ?? []).filter((t) => t.plait === true);
  return ties.flatMap((tie) => [0, 1, 2].flatMap((strand) => {
    const verts = layLock(net, roles, to, Array.from({ length: 44 }, (_, i) => tie.tail(i / 43, strand)), [0.125, 0.125, 6]);
    return Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.86 + strand * 0.06));
  }));
}

/** The broad locks under a fall of hair, sunk a little in from the fine ones. */
function curtainOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roots: readonly Vec[], past: (line: readonly Vec[], u: Vec) => readonly Vec[], rand: () => number, parted: number): readonly number[] {
  const tones: number[] = [];
  for (const u of roots.filter((_, i) => c.curtain === true && i % 3 === 0)) {
    const line = past(combed(c, u, rand, parted), u).slice(0, -2).map((q) => add(SKULL_AT, scale(sub(q, SKULL_AT), 0.95)));
    if (line.length < 3) continue;
    const verts = layLock(net, roles, to, line, [c.width * 2.8, c.thick, 3]);
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.82)));
  }
  return tones;
}

/** Which tie a root's hair goes to: the side it is on, if there are two. */
const tieOf = (c: Comb, u: Vec): Tie | undefined => c.ties?.[(c.ties.length > 1 && u[0] > 0 ? 1 : 0)];

/** A head of hair as locks, on their head's bone. Each vertex's shade comes back, in order: deep at the root, lock from lock a little apart. */
function hairLocks(net: Net, p: Person, roles: readonly string[], cell: number, roof: number): readonly number[] {
  const comb = COMBS[styleOf(p)];
  if (!comb || p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const rand = streamOf(p.seed, 0x68616972), h = headFrame(restSkeleton(p), p.build.head, p.face), size = p.build.size;
  const to = (q: Vec): Vec => scale(h.at(q[0], q[1], q[2]), size), far = cell >= MID_HAIR;
  const c = { ...comb, length: comb.length * mix(0.88, 1.14, rand()) }, parted = (c.part ?? 0) * (rand() < 0.5 ? -1 : 1);
  paintScalp(net, roles, h, size, c.shave === true || c.length < 1);
  const roots = rootsOf(c, far), tucks = tuckOf(p), loose = LOOSE.includes(styleOf(p));
  const past = (line: readonly Vec[], u: Vec): readonly Vec[] => (loose ? offFace(clearOfEar(line, tucks[u[0] > 0 ? 1 : 0]).map((q) => onCap(c, pastEar(q, tucks[u[0] > 0 ? 1 : 0])))) : line);
  const sides = [-1, 1].flatMap((x, side) => (loose && !roped(c) && !tucks[side] ? sideOf(net, roles, to, c, x, rand, far) : []));
  return [...sides, ...capOf(net, roles, to, c, roof, far, rand), ...fringeOf(net, roles, to, c, rand, far), ...curtainOf(net, roles, to, c, roots, past, rand, parted), ...fineLocks(net, roles, to, c, roots, past, rand, parted, roof, far), ...featherOf(net, roles, to, c, rand, far), ...plaitsOf(net, roles, to, c), ...decorOf(net, roles, to, c)];
}

/** The fine locks of a head, each its own width and shade. */
function fineLocks(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roots: readonly Vec[], past: (line: readonly Vec[], u: Vec) => readonly Vec[], rand: () => number, parted: number, roof: number, far: boolean): readonly number[] {
  const tones: number[] = [];
  // (Ropes start back from the brow: hanging from its very edge, they would only be teeth.)
  for (const u of roots.filter((r) => !(roped(c) && c.stand < 1 && r[2] > 0.16))) {
    const tie = tieOf(c, u), line = past(tie ? gathered(tie, u, rand) : combed(c, u, rand, parted), u).filter((q) => to(q)[1] < roof);
    if (line.length < 3) continue;
    const verts = layLock(net, roles, to, line, [c.width * (roped(c) ? 1 : tie ? 1.3 : far ? 3.4 : 2.3) * (0.85 + rand() * 0.3), c.thick * (roped(c) ? 1 : 1.5), far ? 3 : 5]), tone = 0.9 + rand() * 0.1;
    for (let v = 0; v < verts; v += 1) tones.push(lockTone(v / verts, tone));
  }
  return tones;
}

/** A net without the vertices no face uses. */
function compacted(net: Net): Net {
  const next = new Map<number, number>();
  for (const v of net.index) if (!next.has(v)) next.set(v, next.size);
  const keep = (list: readonly number[], width: number): number[] => [...next.keys()].flatMap((v) => list.slice(v * width, v * width + width));
  return { position: keep(net.position, 3), normal: keep(net.normal, 3), role: keep(net.role, 1), bones: keep(net.bones, 2), weight: keep(net.weight, 1), fabric: keep(net.fabric, 1), loose: keep(net.loose, 1), cloth: keep(net.cloth, 4), soft: keep(net.soft, 1), index: net.index.map((v) => next.get(v) ?? 0) };
}

// ---------------------------------------------------------------- the face's paint

const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A face's landmarks as built, in head radii from the head's centre: all that places a feature, a shadow or a line. */
interface Marks { readonly eyeX: number; readonly pupil: number; readonly sn: number; readonly sto: number; readonly pog: number; readonly men: number; readonly jaw: number; readonly gon: number }

function marksOf(p: Person): Marks {
  const b = p.face.bone, down = (y: number): number => y * b.L;
  return { eyeX: p.face.apart, pupil: b.pupil, sn: down(b.sub), sto: down(b.sto), pog: down(b.men + 0.16), men: down(b.men), jaw: down(b.gonY + 0.1), gon: b.gon * b.W };
}

/** How low the jaw's edge comes at `x`: at the corner out at the side, at the chin in the middle. */
const jawAt = (k: Marks, x: number): number => mix(k.men, k.jaw, clamp(x * x / (k.gon * k.gon), 0, 1));

/** One round of paint on a face, on both sides of it: where, how wide and tall, and what it does on fair skin and on deep. */
type Spot = readonly [x: number, y: number, rx: number, ry: number, fair: number, deep: number];

/** Where a face is lifted or shut down. No spot is finer than the mesh's own cell, which could only land as flecks. */
function spotsOf(p: Person, k: Marks, cr: number): readonly Spot[] {
  const b = p.face.bone, w = p.face.mouthWide, nose = mix(0.5, 1, b.m), ex = k.eyeX, wide = (v: number): number => Math.max(v, cr), lower = k.sto - 0.17 + (p.face.lips - 1) * 0.07;
  // (A small face has its shadows closer together, and over deep skin they would run into a beard.)
  const soft = mix(0.6, 1, b.m);
  return [
    [ex, k.pupil + 0.03, 0.34, 0.22, 0.05, 0.12],
    [ex * 1.15, k.pupil - 0.3, 0.26, 0.2, 0.08, 0.2],
    [ex, k.pupil + 0.17, 0.26, 0.1, 0.02, 0.1],
    [0, 0.62, 0.34, 0.2, 0.05, 0.24],
    [0, k.sn + 0.2, 0.08, 0.28, 0.05 * nose, 0.14 * nose],
    [0, k.sn + 0.12, 0.08, 0.07, 0.1 * nose, 0.3 * nose],
    [0, k.sn - 0.03, 0.2, wide(0.06), -0.26 * soft, -0.3 * soft],
    [0.075 * nose + 0.03, k.sn + 0.015, wide(0.04), wide(0.03), -0.3 * soft, -0.36 * soft],
    [0, k.sto, 0.86 * w, wide(0.028), -0.26, -0.34],
    [0, k.sto - 0.1, 0.8 * w, 0.1, 0.04 * b.m, 0.2 * b.m],
    [0, lower, 0.5 * w, wide(0.04), -0.1 * soft, -0.14 * soft],
    [w * 1.02, k.sto + 0.02, wide(0.045), wide(0.04), -0.14 * soft, -0.18 * soft],
    [w + 0.16, k.sto + 0.2, 0.24, 0.2, 0.02, 0.08],
    [0, k.pog, 0.2, 0.12, 0.05, 0.3],
    [0.56, k.sto + 0.08, 0.26, 0.3, -0.07 * b.lean, -0.12 * b.lean],
    ...(b.old ? agedSpots(k, w, cr, b.old) : []),
  ];
}

/** What years leave: under the eyes, across the brow, beside the mouth and along the jaw. */
const agedSpots = (k: Marks, w: number, cr: number, by: number): readonly Spot[] => [
  [k.eyeX, k.pupil - 0.17, 0.16, Math.max(0.04, cr), -0.1 * by, -0.16 * by],
  [0, 0.56, 0.36, Math.max(0.03, cr), -0.08 * by, -0.12 * by],
  [w + 0.1, k.sto + 0.1, Math.max(0.04, cr), 0.14, -0.14 * by, -0.2 * by],
  [w + 0.2, k.sto - 0.16, 0.08, 0.1, -0.1 * by, -0.14 * by],
];

/** What one vertex of a face has from every spot: lifts held to what skin can take, shadows not. */
function spotted(spots: readonly Spot[], x: number, y: number, deep: number): number {
  let lift = 1, dark = 1;
  for (const [cx, cy, rx, ry, fair, rich] of spots) {
    const a = (x - cx) / rx, b = (y - cy) / ry, d = a * a + b * b;
    if (d > 6) continue;
    const by = mix(fair, rich, deep) * Math.exp(-d);
    if (by > 0) lift *= 1 + by; else dark *= 1 + by;
  }
  return Math.min(lift, 1.7) * dark;
}

/** The planes of a face, from which way it looks: its front lifted, its sides and undersides let go. */
function planed(deep: number, [nx, ny, nz]: Vec, y: number, grown: number): number {
  const front = mix(1, mix(1.02, 1.42, deep), smooth(0.1, 1, nz));
  const side = 1 - mix(0.18, 0.2, deep) * smooth(0.4, 0.85, Math.abs(nx));
  const under = 1 - mix(0.16, 0.12, deep) * mix(0.6, 1, grown) * smooth(0.2, 0.75, -ny) * smooth(-0.1, -0.4, y);
  return front * side * under;
}

/** How low hair on a face comes up: over the lip, along the cheek and up to the ear. */
const beardLine = (k: Marks, ax: number): number => mix(k.sn - 0.04, -0.1, smooth(0.3, 0.66, ax));

/** How clear of a mouth a point is, 0 on it: `wide` how far round the lips the clearing goes. */
function clearOfMouth(k: Marks, w: number, ax: number, y: number, wide: number): number {
  return 1 - (1 - smooth(w * (0.72 + wide), w * (0.92 + wide), ax)) * smooth(k.sto - 0.12 - wide, k.sto - 0.08 - wide, y) * (1 - smooth(k.sto + 0.03 + wide * 0.5, k.sto + 0.06 + wide * 0.5, y));
}

/** A day's growth is a shadow on the skin and no colour of its own: a colour stops dead at a vertex, and on pale skin that shows as facets. */
function stubbleAt(p: Person, k: Marks, x: number, y: number, deep: number): number {
  if (p.face.hair !== "stubble") return 1;
  const ax = Math.abs(x), grain = (Math.sin(x * 211 + y * 97) + 1) * 0.15;
  return 1 - mix(0.12, 0.2, deep) * smooth(0, 0.09, beardLine(k, ax) - y) * clearOfMouth(k, p.face.mouthWide, ax, y, 0) * (0.7 + grain);
}

/** The neck under the jaw, and what lies behind the face: the head's own shadow, which a head and a neck cannot give each other being separate shells. */
function underJaw(p: Person, k: Marks, x: number, y: number, deep: number): number {
  const shut = mix(0.56, 0.5, deep), fade = 0.42 * mix(0.55, 1, p.face.bone.m);
  return mix(shut, 1, smooth(0, fade, jawAt(k, x) - y)) * mix(1, 1.3, deep);
}

/** Hair throws a little shadow on the skin below its line, and that is what seats it on the head. */
function underHair(q: Vec, b: Bone): number {
  const e: Vec = [q[0] / (b.W * 0.84) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], u = unit(e, UP);
  const near = (by: number): number => (scalped(unit([u[0], u[1] + by, u[2]], UP)) ? 1 : 0);
  return 1 - 0.1 * (near(0.02) + near(0.07) + near(0.12));
}

/** All one person's bake needs, worked out once. `rise` lifts the very deepest skins, which `deep` has stopped telling apart, or a face goes to black. */
interface Bake { readonly p: Person; readonly k: Marks; readonly spots: readonly Spot[]; readonly deep: number; readonly haired: boolean; readonly rise: number; readonly toHead: (at: Vec) => Vec }

const vecAt = (list: readonly number[], v: number): Vec => [list[v * 3] ?? 0, list[v * 3 + 1] ?? 0, list[v * 3 + 2] ?? 0];

/** One vertex of the face proper. */
function bakeFace(net: Net, bake: Bake, v: number, q: Vec, was: number): number {
  const { p, k, deep } = bake, [x, y] = q;
  // (A fold of the melted skull is no crease of a face: most of what `creases` found there goes, or a cheek bruises.)
  const open = mix(1, was, 0.15);
  const marked = (bake.haired ? underHair(q, p.face.bone) : 1) * bake.rise;
  return open * marked * stubbleAt(p, k, x, y, deep) * spotted(bake.spots, Math.abs(x), y, deep) * planed(deep, vecAt(net.normal, v), y, p.face.bone.m);
}

/** A vertex of the skin of the head or the neck. */
function bakeVertex(net: Net, bake: Bake, v: number, bone: number, was: number): number {
  const q = bake.toHead(vecAt(net.position, v)), [x, y, z] = q;
  if (y > 1.4 || y < -2.4 || Math.abs(x) > 1.4) return was;
  if (bone !== HEAD) return was * underJaw(bake.p, bake.k, x, y, bake.deep);
  const back = was * mix(1, 1.2, bake.deep);
  return z < -0.4 ? back : mix(back, bakeFace(net, bake, v, q, was), smooth(-0.4, 0.1, z));
}

const FACE_BONES: ReadonlySet<number> = new Set([HEAD, boneIndex("neck"), boneIndex("chest")]);

/** A face's light, baked into `shade`, where the renderer multiplies it: planes, a shadow under each thing that overhangs, a lift on each that stands proud. Over a deep skin a multiply barely shows, so there it works hardest; and hair on the face goes on here too. `skip` is the vertices at the end that have their shade already. */
function faceBake(net: Net, shade: Float32Array, p: Person, roles: readonly string[], cell: number, skip: number): void {
  if (p.outfit.costume === "fursuit") return;
  const size = p.build.size, h = headFrame(restSkeleton(p), p.build.head, p.face), r = h.r * size, skin = roles.indexOf("skin"), k = marksOf(p);
  const toHead = (at: Vec): Vec => [(at[0] / size - h.c[0]) / h.r, (at[1] / size - h.c[1]) / h.r, (at[2] / size - h.c[2]) / h.r];
  const bake: Bake = { p, k, spots: spotsOf(p, k, (cell * 0.5) / r), deep: deepOf(p.palette.skin ?? "#888888"), haired: styleOf(p) !== "bald", rise: 1 + 0.45 * clamp((0.075 - glowOf(p.palette.skin ?? "#888888")) / 0.04, 0, 1), toHead };
  for (let v = 0; v < shade.length - skip; v += 1) {
    const bone = net.bones[v * 2] ?? 0;
    if (net.fabric[v] === FABRICS.skin && net.role[v] === skin && FACE_BONES.has(bone)) shade[v] = bakeVertex(net, bake, v, bone, bone === HEAD && cell < WRAPPED ? 1 : shade[v] ?? 1);
  }
}

/** An iris as it is painted: well under its own colour, for a small face has room for one thing in an eye and that is its dark. */
const inkedIris = (iris: string): string => blend(iris, "#0c0806", 0.42);

/** What the renderer paints a face with, over the bake: the shader dims a white under its lid, so it is given as white as it can be; and a line along the lashes that holds on any skin. */
function faceInks(p: Person): { readonly brow: string; readonly lash: string; readonly white: string; readonly iris: string } {
  const skin = p.palette.skin ?? "#888888", brow = p.palette.brow ?? "#3a2a22", deep = deepOf(skin);
  return { brow: blend(brow, "#140c08", 0.5), lash: deep > 0.3 ? "#070403" : "#160c09", white: blend("#fffdf8", "#c6b8aa", deep), iris: inkedIris(p.face.iris) };
}

/** How far forward the skin of a face lies at any `x`, `y`, from its own vertices, a cell or so at a time. */
function surfaceOf(net: Net, h: HeadFrame, size: number, step: number): (x: number, y: number) => number {
  const bins = new Map<number, number>(), key = (x: number, y: number): number => Math.round(x / step) * 4096 + Math.round(y / step);
  const toHead = (v: number): Vec => { const [x, y, z] = vecAt(net.position, v); return [(x / size - h.c[0]) / h.r, (y / size - h.c[1]) / h.r, (z / size - h.c[2]) / h.r]; };
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (net.fabric[v] !== FABRICS.skin || net.bones[v * 2] !== HEAD) continue;
    const [x, y, z] = toHead(v);
    if (z > 0.2) bins.set(key(x, y), Math.max(z, bins.get(key(x, y)) ?? -FAR));
  }
  const reach = [0, -step, step, -2 * step, 2 * step];
  const near = (x: number, y: number): number => Math.max(...reach.flatMap((dx) => reach.map((dy) => bins.get(key(x + dx, y + dy)) ?? -FAR)));
  return (x, y) => bins.get(key(x, y)) ?? near(x, y);
}

/** How wide a brow's hairs lie at its thickest. */
function browHalf(p: Person): number {
  const b = p.face.bone, male = p.build.sex === "male" ? 1 : 0;
  return mix(0.032, mix(0.034, 0.048, male) * (0.75 + p.face.brow * 0.3), b.m) * b.browK * (1 - b.old * 0.2);
}

/** A brow's line for the renderer, in eyes: its height over the pupil, its arch, its tilt and how wide it lies. */
function browLineOf(p: Person): readonly [number, number, number, number] {
  const { eye: e, bone: b, browTilt } = p.face;
  return [1.3 + (0.13 + b.browUp) / e, b.arch / e, (browTilt * 0.9) / e, browHalf(p) / e];
}

/** A line of depths with its gaps filled and its steps eased, never let down into what it lies on. */
function evened(zs: readonly number[]): readonly number[] {
  const seen = zs.filter((z) => z > -FAR / 2), low = Math.min(...seen, 0.3), held = zs.map((z) => (z > -FAR / 2 ? z : low));
  const eased = (list: readonly number[]): readonly number[] => list.map((z, i) => Math.max(z, ((list[i - 1] ?? z) + 2 * z + (list[i + 1] ?? z)) / 4));
  return eased(eased(held));
}

/** Whatever lays one piece of what a person wears, in head radii. */
type LayGear = (line: readonly Vec[], size: readonly [number, number, number], worn: { readonly up?: Vec; readonly role: string; readonly fabric: number; readonly bone?: number; readonly taper?: (s: number) => number }) => void;
/** Whatever fills a flat shape, seen from both sides. */
type LayPane = (outline: readonly Vec[], normal: Vec, worn: { readonly role: string; readonly fabric: number }) => void;

const METAL = { role: "metal", fabric: FABRICS.latex }, FRAME = { role: "dark", fabric: FABRICS.latex }, LENS = { role: "lens", fabric: FABRICS.latex }, CLIP = { role: "clip", fabric: FABRICS.satin };
const bead = (s: number): number => Math.sqrt(Math.max(0.02, 1 - (2 * s - 1) ** 2));

/** A closed line round a middle, however it is bent. */
const ringOf = (count: number, at: (c: number, s: number) => Vec): readonly Vec[] => Array.from({ length: count + 1 }, (_, i) => at(Math.cos((i / count) * TAU), Math.sin((i / count) * TAU)));

/** What each kind of frame is: how wide its lens is against the eye, how tall against its width, how square, how thick its rim, and whether it is wire. */
const FRAMES: Readonly<Record<Exclude<Gear["glasses"], "none">, { readonly wide: number; readonly tall: number; readonly square: number; readonly rim: readonly [number, number]; readonly wire: boolean; readonly flick: number }>> = {
  clear: { wide: 1.75, tall: 0.74, square: 0.62, rim: [0.024, 0.018], wire: false, flick: 0 },
  round: { wide: 1.6, tall: 1, square: 1, rim: [0.014, 0.012], wire: true, flick: 0 },
  cat: { wide: 1.8, tall: 0.68, square: 0.7, rim: [0.028, 0.02], wire: false, flick: 0.09 },
  sun: { wide: 1.95, tall: 0.82, square: 0.72, rim: [0.028, 0.022], wire: false, flick: 0 },
};

/** How far each lens is turned back from the face's plane, a slope. */
const FRAME_WRAP = 0.1;

/** A pair of glasses, as one rigid thing. A lens is a flat shape; `x` says which side. */
interface Frame { readonly rx: number; readonly ry: number; readonly front: number; readonly centre: (x: number) => Vec; readonly rim: (x: number, c: number, s: number) => Vec; readonly facing: (x: number) => Vec }

/** Where a pair of glasses sits: lenses square on each eye, as close as the brow, the cheek and the lashes allow, and the bridge down on the nose. */
function frameOn(kind: Exclude<Gear["glasses"], "none">, p: Person, k: Marks, surface: (x: number, y: number) => number): Frame {
  const f = FRAMES[kind], rx = Math.min(p.face.eye * f.wide, k.eyeX - 0.06), ry = rx * f.tall, y = k.pupil - 0.01;
  const clear = [-1, 1].flatMap((x) => [-0.8, 0, 0.8].flatMap((c) => [-0.8, 0, 0.8].map((v) => surface(x * k.eyeX + rx * c, y + ry * v) + (x * k.eyeX * c > 0 ? FRAME_WRAP * rx * Math.abs(c) : 0))));
  const front = Math.max(...clear, surface(0, y) + 0.01) + 0.015, shape = (v: number): number => Math.sign(v) * Math.abs(v) ** f.square;
  const rim = (x: number, c: number, s: number): Vec => {
    const u = rx * shape(c), v = ry * shape(s) + f.flick * Math.max(0, c * x * s) ** 2;
    return [x * k.eyeX + u, y + v, front - FRAME_WRAP * Math.abs(u) * Math.sign(u * x)];
  };
  return { rx, ry, front, centre: (x) => [x * k.eyeX, y, front], rim, facing: (x) => unit([x * FRAME_WRAP, 0, 1], FRONT) };
}

/** An arm of a pair of glasses: straight back from its hinge, clear of the skin, over the top of the ear and hooked down behind it. */
function templeArm(seat: Seat, hinge: Vec, side: number): readonly Vec[] {
  const top = seat.tops[side], end: Vec = top ? add(top, [0, 0.03, 0]) : [hinge[0], hinge[1], -0.2];
  const wide = (q: Vec): Vec => { const d = unit(q, SIDE), need = seat.skin.far(d) + 0.02, far = Math.hypot(...q); return far < need ? scale(d, need) : q; };
  const along = [0.25, 0.5, 0.75, 1].map((t) => wide(lerpV(hinge, end, t)));
  const hook = top ? [[0.1, -0.05], [0.18, -0.13], [0.22, -0.23]].map(([back = 0, down = 0]) => wide(add(end, [0, down, -back]))) : [];
  return [hinge, ...along, ...hook];
}

/** Glasses: a flat lens in a rim on each eye, a bridge between them, a hinge at each outer corner and an arm back to each ear. */
function layGlasses(lay: LayGear, pane: LayPane, p: Person, k: Marks, seat: Seat, surface: (x: number, y: number) => number): void {
  const kind = p.gear.glasses;
  if (kind === "none") return;
  const f = FRAMES[kind], frame = frameOn(kind, p, k, surface), stuff = f.wire ? METAL : FRAME;
  [-1, 1].forEach((x, side) => {
    const round = ringOf(32, (c, s) => frame.rim(x, c, s));
    lay(round, [f.rim[0], f.rim[1], 6], { ...stuff, up: frame.facing(x) });
    if (kind === "sun") pane(round, frame.facing(x), LENS);
    const edge = frame.rim(x, x, 0.45), hinge: Vec = [edge[0] + x * 0.03, edge[1], edge[2] - 0.05];
    lay([edge, lerpV(edge, hinge, 0.5), hinge], [f.rim[0] * 0.9, f.rim[1], 4], { ...stuff, up: UP });
    lay(templeArm(seat, hinge, side), [f.wire ? 0.012 : 0.02, f.wire ? 0.01 : 0.01, 4], { ...stuff, up: [x, 0, 0] });
  });
  const inner = (x: number): Vec => frame.rim(x, -x, 0.42), a = inner(-1), b = inner(1), lift = frame.ry * 0.16;
  lay([a, add(lerpV(a, b, 0.3), [0, lift, 0]), add(lerpV(a, b, 0.7), [0, lift, 0]), b], [f.rim[0], f.rim[1], 4], { ...stuff, up: FRONT });
}

/** Earrings, hanging from lobes that are really there. */
function layEars(lay: LayGear, p: Person, seat: Seat): void {
  const kind = p.gear.ears;
  if (kind === "none") return;
  [-1, 1].forEach((x, side) => {
    const lobe = seat.lobes[side];
    if (!lobe) return;
    if (kind === "stud") lay([lobe, add(lobe, [x * 0.02, 0, 0.01]), add(lobe, [x * 0.04, 0, 0.02])], [0.026, 0.026, 6], { ...METAL, taper: bead });
    if (kind === "hoop") lay(ringOf(14, (c, s) => [lobe[0] + x * 0.01, lobe[1] - 0.11 + 0.11 * s, lobe[2] + 0.11 * c]), [0.011, 0.011, 4], METAL);
    if (kind === "drop") { lay([lobe, add(lobe, [0, -0.14, 0])], [0.007, 0.007, 4], METAL); lay([add(lobe, [0, -0.14, 0]), add(lobe, [0, -0.2, 0]), add(lobe, [0, -0.26, 0])], [0.036, 0.036, 6], { ...METAL, taper: bead }); }
  });
}

/** A stud in the wing of the nose, or a ring through its middle. */
function layNose(lay: LayGear, p: Person, k: Marks, surface: (x: number, y: number) => number): void {
  const side = p.seed % 2 === 0 ? -1 : 1, z = surface(side * 0.16, k.sn + 0.08);
  if (p.gear.nose === "stud") lay([[side * 0.16, k.sn + 0.08, z], [side * 0.17, k.sn + 0.08, z + 0.02], [side * 0.18, k.sn + 0.08, z + 0.04]], [0.02, 0.02, 6], { ...METAL, taper: bead });
  if (p.gear.nose === "ring") lay(ringOf(10, (c, s) => [0.05 * c, k.sn - 0.03 + 0.05 * s, surface(0, k.sn) - 0.02]), [0.008, 0.008, 4], METAL);
}

/** A chain round the neck, lying on what they wear, and what hangs from it. */
function layNeck(lay: LayGear, p: Person, h: HeadFrame): void {
  if (p.gear.neck === "none" || !["tee", "tank", "dress", "swimsuit", "bikini", "bare"].includes(p.outfit.top)) return;
  const s = restSkeleton(p), head = (at: Vec): Vec => scale(sub(at, h.c), 1 / h.r), base = head(lerpV(s.neck, s.chest, 0.3)), chest = { ...METAL, bone: boneIndex("chest") };
  lay(ringOf(26, (c, si) => [base[0] + 0.86 * si, base[1] - 0.42 * ((c + 1) / 2) ** 2, base[2] + 0.1 + 0.62 * c]), [0.012, 0.01, 4], chest);
  const low = add(base, [0, -0.42, 0.74]);
  if (p.gear.neck === "pendant") lay([low, add(low, [0, -0.07, 0.01]), add(low, [0, -0.14, 0])], [0.05, 0.03, 6], { ...chest, taper: bead });
}

/** A direction `along` from one ear over the top to the other, leaning `fore` forward. */
const overHead = (along: number, fore: number): Vec => unit([Math.sin(along), Math.cos(along), fore], UP);

/** An arc over a head from ear to ear, lying on its boundary. */
const arcOver = (outer: Bound, fore: number, half: number, lift: number): readonly Vec[] => Array.from({ length: 21 }, (_, i) => outer.on(overHead(half * (i / 10 - 1), fore), lift));

/** Clips along the side of the hair, each lying on it. */
function layClips(lay: LayGear, outer: Bound, side: number, places: readonly number[]): void {
  for (const at of places) lay([0.42, 0.36, 0.3].map((fore, i) => outer.on(overHead(side * (at + i * 0.03), fore), 0.012)), [0.045, 0.016, 4], CLIP);
}

/** What is in the hair, a clip or a row of them, a bow, a band, and headphones over all of it: all of it lying on what is there. */
function layHair(lay: LayGear, p: Person, outer: Bound): void {
  const kind = p.gear.hair, side = p.seed % 2 === 0 ? -1 : 1;
  if (p.hair !== "bald") {
    if (kind === "band") lay(arcOver(outer, 0.2, 1.45, 0.008), [0.07, 0.022, 4], CLIP);
    if (kind === "clip" || kind === "clips") layClips(lay, outer, side, kind === "clip" ? [0.8] : [0.62, 0.8, 0.98]);
    if (kind === "bow") {
      const at = outer.on(overHead(side * 0.8, 0.4), 0.02);
      lay([add(at, [-0.2, 0.05, 0]), at, add(at, [0.2, 0.05, 0])], [0.1, 0.02, 4], { ...CLIP, taper: (s) => 0.35 + 1.3 * Math.abs(s - 0.5) });
    }
  }
  if (!p.gear.phones) return;
  lay(arcOver(outer, 0, 1.38, 0.016), [0.06, 0.026, 4], FRAME);
  for (const x of [-1, 1]) { const at = outer.on(unit([x, 0, -0.12], SIDE)), d = unit(at, SIDE); lay([at, madd(at, d, 0.06), madd(at, d, 0.13)], [0.27, 0.27, 12], { ...FRAME, taper: bead }); }
}

/** A flat shape filled in, a sheet each way so it shows from either side. */
function paneOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, outline: readonly Vec[], normal: Vec, worn: { readonly role: string; readonly fabric: number }): number {
  const role = Math.max(0, roles.indexOf(worn.role)), count = outline.length, middle = scale(outline.reduce(add, [0, 0, 0]), 1 / count), base = net.position.length / 3;
  for (const facing of [1, -1]) for (const q of [middle, ...outline]) {
    net.position.push(...to(q)); net.normal.push(...scale(normal, facing)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(worn.fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(0, 0, 0, 1);
  }
  const back = base + count + 1;
  for (let i = 0; i < count; i += 1) { const a = i + 1, b = (i + 1) % count + 1; net.index.push(base, base + a, base + b, back, back + b, back + a); }
  return (count + 1) * 2;
}

/** The front of what a body has on: how far forward it lies at any `x`, `y`, and the vertex there, from which a thing laid on it takes its bones. */
interface Front { readonly z: (x: number, y: number) => number; readonly near: (x: number, y: number) => number }

/** The boundary of a person's front, over the vertices `keep` takes, as a head has its own. */
function frontBound(net: Net, keep: (v: number) => boolean, step: number): Front {
  const depth = new Map<number, number>(), owner = new Map<number, number>(), key = (i: number, j: number): number => i * 8192 + j, cellOf = (v: number): number => Math.round(v / step);
  const fill = (a: number, b: number, c: number): void => {
    const [ax, ay, az] = vecAt(net.position, a), [bx, by, bz] = vecAt(net.position, b), [cx, cy, cz] = vecAt(net.position, c), area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return;
    for (let i = cellOf(Math.min(ax, bx, cx)); i <= cellOf(Math.max(ax, bx, cx)); i += 1) for (let j = cellOf(Math.min(ay, by, cy)); j <= cellOf(Math.max(ay, by, cy)); j += 1) {
      const x = i * step, y = j * step, w = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area, u = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area, v = 1 - w - u;
      if (w < -0.05 || u < -0.05 || v < -0.05) continue;
      const z = w * az + u * bz + v * cz, k = key(i, j);
      if (z > (depth.get(k) ?? -FAR)) { depth.set(k, z); owner.set(k, a); }
    }
  };
  for (let i = 0; i < net.index.length; i += 3) { const a = net.index[i] ?? 0, b = net.index[i + 1] ?? 0, c = net.index[i + 2] ?? 0; if (keep(a) && keep(b) && keep(c)) fill(a, b, c); }
  const at = <T>(map: ReadonlyMap<number, T>, x: number, y: number, or: T): T => map.get(key(cellOf(x), cellOf(y))) ?? map.get(key(cellOf(x) + 1, cellOf(y))) ?? map.get(key(cellOf(x) - 1, cellOf(y))) ?? map.get(key(cellOf(x), cellOf(y) - 1)) ?? or;
  return { near: (x, y) => at(owner, x, y, -1), z: (x, y) => at(depth, x, y, 0) };
}

/** A sheet laid on a person's front: `at` says where each corner of a grid goes, and each vertex rides the bones of what is under it. */
function drape(net: Net, front: Front, rows: number, cols: number, at: (t: number, u: number) => readonly [number, number], lift: number, role: number, fabric: number): number {
  const from = net.position.length / 3, point = (r: number, c: number): Vec => { const [x, y] = at(r / rows, c / cols); return [x, y, front.z(x, y) + lift]; };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c <= cols; c += 1) {
    const q = point(r, c), n = unit(cross(sub(point(r, Math.min(cols, c + 1)), point(r, Math.max(0, c - 1))), sub(point(Math.max(0, r - 1), c), point(Math.min(rows, r + 1), c))), FRONT), under = Math.max(0, front.near(q[0], q[1]));
    net.position.push(...q); net.normal.push(...n); net.role.push(role); net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0); net.weight.push(net.weight[under] ?? 1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(q[0], q[2], q[1], NO_EDGE);
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; net.index.push(a, d, e, a, e, b); }
  return (rows + 1) * (cols + 1);
}

/** A jacket's open front, near to: a shirt in the V of it, lapels turned back along each edge, a formal one's tie, and the buttons below. */
function jacketFront(net: Net, p: Person, roles: readonly string[], cell: number): readonly number[] {
  const { top, costume } = p.outfit;
  if ((top !== "jacket" && top !== "blazer") || costume === "firefighter" || cell >= WRAPPED) return [];
  const size = p.build.size, s = restSkeleton(p), topRole = roles.indexOf("top"), high = (s.neck[1] - 0.03) * size, low = (s.waist[1] + 0.05) * size, mid = s.chest[2] * size;
  const cloth = topCloth(p), front = frontBound(net, (v) => net.fabric[v] === cloth && (net.position[v * 3 + 2] ?? 0) > mid, 0.01 * size);
  const crest = Array.from({ length: 12 }, (_, i) => high + (i - 4) * 0.008 * size).reduce((best, at) => (front.near(0, at) >= 0 ? at : best), low);
  const open = (t: number): number => (0.006 + t * 0.05) * size, y = (t: number): number => mix(low, crest, t);
  let count = drape(net, front, 12, 6, (t, u) => [mix(-open(t), open(t), u), y(t)], 0.006 * size, roles.indexOf("shirt"), FABRICS.cotton);
  for (const x of [-1, 1]) count += drape(net, front, 12, 3, (t, u) => { const wide = (0.012 + 0.04 * Math.sin(t * Math.PI * 0.92)) * size; return [x * (open(t) + u * wide - 0.003 * size), y(t)]; }, 0.009 * size, topRole, cloth);
  if (top === "blazer") count += drape(net, front, 10, 3, (t, u) => { const wide = mix(0.016, 0.008, t) * size; return [mix(-wide, wide, u), y(mix(0.08, 0.98, t))]; }, 0.01 * size, roles.indexOf("dark"), FABRICS.satin);
  count += drape(net, front, 5, 1, (t, u) => [(u - 0.5) * 0.004 * size, mix(y(0) - 0.16 * size, y(0), t)], 0.008 * size, roles.indexOf("dark"), FABRICS.cotton);
  return Array.from({ length: count }, () => 0.88);
}

/** How high a top reaches at each bearing round a point: its neckline, as an elevation, smoothed. */
function necklineOf(net: Net, c: Vec, size: number, keep: (v: number) => boolean): Float64Array {
  const around = 36, rim = new Float64Array(around).fill(-Math.PI / 2);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = sub(scale(vecAt(net.position, v), 1 / size), c), a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * around) % around;
    rim[a] = Math.max(rim[a] ?? 0, Math.asin(clamp(q[1] / (Math.hypot(...q) || 1), -1, 1)));
  }
  for (let pass = 0; pass < 3; pass += 1) { const was = rim.slice(); for (let a = 0; a < around; a += 1) rim[a] = ((was[(a + around - 1) % around] ?? 0) + (was[a] ?? 0) * 2 + (was[(a + 1) % around] ?? 0)) / 4; }
  return rim;
}

/** A polo's collar, near to: one strip from the neckline round the back of the neck and down to two points at the front, and the short placket under them. */
function poloFront(net: Net, p: Person, roles: readonly string[], cell: number): readonly number[] {
  if (p.outfit.top !== "polo" || cell >= WRAPPED) return [];
  const size = p.build.size, s = restSkeleton(p), cloth = topCloth(p), mid = s.chest[2] * size, topRole = roles.indexOf("top"), hi = s.chest[1] * size;
  const worn = (v: number): boolean => net.fabric[v] === cloth && net.bones[v * 2] !== HEAD && (net.position[v * 3 + 1] ?? 0) > hi;
  const c: Vec = [0, s.neck[1] - 0.05, s.neck[2]], r = 0.07, bound = boundOf(net, { c, r }, size, worn), rim = necklineOf(net, c, size, worn), rows = 5, cols = 56, from = net.position.length / 3, front = frontBound(net, (v) => worn(v) && (net.position[v * 3 + 2] ?? 0) > mid, 0.008 * size);
  const rimAt = (az: number): number => { const a = (az / TAU) * rim.length - 0.5, a0 = Math.floor(a), at = (i: number): number => rim[(i + rim.length) % rim.length] ?? 0; return mix(at(a0), at(a0 + 1), a - a0); };
  const pointAt = (t: number, u: number): Vec => {
    const open = mix(0.2, 0.62, t), az = mix(open, TAU - open, u), fore = (1 + Math.cos(az)) / 2, el = rimAt(az) + 0.12 - t * mix(0.2, 0.6, fore * fore), d = bearingOf(az, el);
    return add(c, scale(d, r * (bound.far(d) + mix(0.18, 0.11, t))));
  };
  for (let t = 0; t <= rows; t += 1) for (let u = 0; u <= cols; u += 1) {
    const q = pointAt(t / rows, u / cols), at = scale(q, size), n = unit(sub(q, c), FRONT), under = Math.max(0, front.near(at[0], at[1]));
    net.position.push(...at); net.normal.push(...n); net.role.push(topRole); net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0); net.weight.push(net.weight[under] ?? 1); net.fabric.push(cloth); net.loose.push(0); net.soft.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE);
  }
  for (let t = 0; t < rows; t += 1) for (let u = 0; u < cols; u += 1) { const a = from + t * (cols + 1) + u, b = a + 1, d = a + cols + 1, e = d + 1; net.index.push(a, d, e, a, e, b); }
  const placket = drape(net, front, 3, 1, (t, u) => [(u - 0.5) * 0.022 * size, mix(s.chest[1] + 0.03, s.neck[1] - 0.04, t) * size], 0.003 * size, topRole, cloth);
  return [...Array.from({ length: (rows + 1) * (cols + 1) }, () => 0.8), ...Array.from({ length: placket }, () => 0.85)];
}

/** How far from a head's centre a crown goes to clear its hair, in head radii. */
const CROWN_REACH = 1.6;

/** The hats whose crown is built over what is under it. The rest are their own shape. */
const FITTED_HATS: ReadonlySet<Hat> = new Set<Hat>(["cap", "beanie", "pompom", "bucket", "flatcap", "bandana", "hardhat", "helmet", "fedora", "stetson", "bowler", "peaked", "sunhat", "headwrap", "visor", "beret"]);

/** Whether a person's hat is near enough to be built over their head. */
const fitsHat = (p: Person, cell: number): boolean => cell < WRAPPED && FITTED_HATS.has(p.outfit.hat) && p.outfit.costume !== "fursuit";

/** How far out a boundary reaches anywhere near a direction: what a crown has to clear, for it cannot follow every lock. */
function highestNear(bound: Bound, dir: Vec): number {
  const reach = [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14], [0.24, 0], [-0.24, 0], [0, 0.24]] as const;
  return Math.max(...reach.map(([a, b]) => bound.far(unit(add(dir, [a, b, a - b]), UP))));
}

/** Where a crown's hem lies at each bearing: level round the head and only a little lower behind, as a hat sits. A helmet and a tied scarf come down the neck. */
const crownHem = (hat: Hat, az: number): number => mix(0.5, hat === "helmet" || hat === "bandana" ? 0.24 : 0.42, (1 - Math.cos(az)) / 2);

const BERET_SLUMP = unit([0.72, 0.66, -0.2], UP);

/** How far a hat's bill reaches past its hem, in head radii. */
const BILLS: Partial<Record<Hat, number>> = { cap: 0.74, peaked: 0.56, flatcap: 0.44, hardhat: 0.46, visor: 0.7 };

/** A bill: one thin curved sheet out of the crown's hem across the brow, its sides falling away and its edge rounded. Returns how many vertices it took. */
function billOn(net: Net, role: number, fabric: number, to: (q: Vec) => Vec, hat: Hat, hemAt: (az: number) => Vec): number {
  const reach = BILLS[hat] ?? 0, rows = 7, side = 16, cols = (side + 1) * 2, wide = 1.1, from = net.position.length / 3;
  if (reach <= 0) return 0;
  const at = (s: number, u: number, under: boolean): Vec => {
    const [x, y, z] = hemAt(u * wide), long = s * Math.sqrt(1 - u * u), fall = (0.14 + 0.2 * u * u) * long;
    return [x, y - fall - (under ? 0.04 * (1 - s ** 4) : 0), z + reach * long];
  };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const under = c > side, u = under ? -1 + (2 * (c - side - 1)) / side : 1 - (2 * c) / side, q = to(at(r / rows, u, under));
    net.position.push(...q); net.normal.push(0, under ? -1 : 1, 0); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(q[0], q[2], q[1], NO_EDGE);
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * cols + c, b = from + r * cols + (c + 1) % cols, d = a + cols, e = b + cols; net.index.push(a, b, e, a, e, d); }
  headNormals(net, from, rows + 1, cols);
  return (rows + 1) * cols;
}

/** Hair that a crown cannot clear goes under it: `over` says how far out the crown lies along a direction. */
function tuckedHair(net: Net, roles: readonly string[], h: HeadFrame, size: number, over: (d: Vec) => number): void {
  const hair = roles.indexOf("hair");
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (net.role[v] !== hair || net.bones[v * 2] !== HEAD) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r), far = Math.hypot(...q), d = unit(q, UP), most = over(d) - 0.03;
    if (far <= most) continue;
    const at = scale(add(h.c, scale(d, most * h.r)), size);
    net.position[v * 3] = at[0]; net.position[v * 3 + 1] = at[1]; net.position[v * 3 + 2] = at[2];
  }
}

/** How far out a crown lies along `d`, from what it must clear: under hair the skull has no skin to read, so its reach is held to a head's. */
function crownFar(skin: number, hair: number, d: Vec, hat: Hat): number {
  const ridge = hat === "hardhat" ? 0.035 * smooth(0.3, 0.12, Math.abs(d[0])) * smooth(0.4, 0.7, d[1]) : 0;
  // (A beret slumps to one side.)
  const slump = hat === "beret" ? 0.2 * smooth(0.3, 1, dot(d, BERET_SLUMP)) : 0;
  return Math.max(skin + 0.05 * smooth(0.5, 1, d[1]), Math.min(hair + 0.05, CROWN_REACH)) + (CROWN_RISE[hat] ?? 0) * smooth(0.3, 1, d[1]) + ridge + slump;
}

/** A crown, built over the head and the hair really under it: the hem level round the brow and lower behind, the top only as much taller as the hat is. */
function crownOver(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame, seat: Seat): readonly number[] {
  if (!fitsHat(p, cell)) return [];
  const size = p.build.size, hat = p.outfit.hat, trim = roles.indexOf("trim"), under = boundOf(net, h, size, (v) => net.role[v] !== trim);
  const rows = 14, cols = 64, clear = hat === "helmet" || hat === "hardhat" ? 0.09 : 0.035, far = new Float64Array((rows + 1) * cols);
  const dirOf = (r: number, c: number): Vec => { const az = (c / cols) * TAU; const hem = crownHem(hat, az); return bearingOf(az, mix(hem, hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02, (r / rows) ** 0.8)); };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const d = dirOf(r, c), skin = seat.skin.far(d) + clear;
    far[r * cols + c] = crownFar(skin, highestNear(under, d), d, hat);
  }
  smoothedFar(far, rows + 1, cols, 7);
  far.forEach((was, i) => { far[i] = Math.max(was, Math.min(under.far(dirOf(Math.floor(i / cols), i % cols)) + 0.02, CROWN_REACH + 0.1)); });
  smoothedFar(far, rows + 1, cols, 1);
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), from = net.position.length / 3, role = Math.max(0, roles.indexOf("trim")), fabric = hatCloth(hat);
  for (let r = -1; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const d = dirOf(Math.max(0, r), c), at = to(scale(d, (far[Math.max(0, r) * cols + c] ?? 1) - (r < 0 ? 0.05 : 0)));
    net.position.push(...at); net.normal.push(...d); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE);
  }
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * cols + c, b = from + r * cols + (c + 1) % cols, d = a + cols, e = b + cols; net.index.push(a, b, e, a, e, d); }
  headNormals(net, from, rows + 2, cols);
  tuckedHair(net, roles, h, size, (d) => { const az = (Math.atan2(d[0], d[2]) + TAU) % TAU, el = Math.asin(clamp(d[1], -1, 1)), hem = crownHem(hat, az), top = hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02, t = (el - hem) / (top - hem); return t < 0 || t > 1 ? FAR : (far[Math.round(t ** 1.25 * rows) * cols + Math.round((az / TAU) * cols) % cols] ?? FAR); });
  const hemAt = (az: number): Vec => { const turn = ((az / TAU + 1) % 1) * cols, c = Math.floor(turn), d = bearingOf(az, crownHem(hat, az)); return scale(d, mix(far[c % cols] ?? 1, far[(c + 1) % cols] ?? 1, turn - c) - 0.04); };
  const bill = billOn(net, role, fabric, to, hat, hemAt);
  return Array.from({ length: (rows + 2) * cols + bill }, () => 1);
}

/** Everything small a person wears, near enough to see it. */
function gearOn(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame, seat: Seat): readonly number[] {
  if (cell >= WRAPPED || p.outfit.costume === "fursuit") return [];
  const size = p.build.size, to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), k = marksOf(p), surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const outer = boundOf(net, h, size, (v) => net.role[v] !== roles.indexOf("eye"));
  let count = 0;
  const lay: LayGear = (line, wide, worn) => { count += layLock(net, roles, to, line, wide, worn); };
  const pane: LayPane = (outline, normal, worn) => { count += paneOf(net, roles, to, outline, normal, worn); };
  layGlasses(lay, pane, p, k, seat, surface);
  layEars(lay, p, seat);
  layNose(lay, p, k, surface);
  layNeck(lay, p, h);
  layHair(lay, p, outer);
  return Array.from({ length: count }, () => 1);
}

/** Where a mouth's corners go at rest: a short line up from each end of the shader's, each person's own, a little higher on one side. */
function cornersOf(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame): readonly number[] {
  if (p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const size = p.build.size, { mouthWide: w, bone: b } = p.face, surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), taper = (s: number): number => mix(1, 0.3, s);
  return [-1, 1].flatMap((x) => {
    const lift = 0.02 + b.rest * 0.05 + x * b.askew * 0.6, line = [0, 1, 2, 3].map((i): readonly [number, number] => [w * mix(0.8, 0.98, i / 3), b.sto * b.L + lift * (i / 3) ** 2]);
    const depth = evened(line.map(([ax, y]) => surface(x * ax, y)));
    return Array.from({ length: layLock(net, roles, to, line.map(([ax, y], i) => [x * ax, y, (depth[i] ?? 0) + 0.012]), [0.015, 0.008, 4], { role: "crease", fabric: FABRICS.hair, taper }) }, () => 1);
  });
}

/** A moustache lies on the skin as a brow does, so one clean shape follows the lip whatever the lip does. */
function moustacheOf(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame): readonly number[] {
  if (p.face.hair !== "moustache" || p.outfit.costume === "fursuit") return [];
  const size = p.build.size, { mouthWide: w, bone: b } = p.face, surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const line = [-3, -2, -1, 0, 1, 2, 3].map((i): readonly [number, number] => [(i / 3) * Math.max(w * 1.08, 0.36), b.sub * b.L - 0.09 - 0.06 * (i / 3) ** 2]);
  const depth = evened(line.map(([x, y]) => surface(x, y))), to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size);
  const taper = (s: number): number => mix(0.45, 1, Math.sin(s * Math.PI));
  return Array.from({ length: layLock(net, roles, to, line.map(([x, y], i) => [x, y, (depth[i] ?? 0) + 0.035]), [0.05, 0.03, 6], { role: "beard", fabric: FABRICS.hair, taper }) }, () => 1);
}

/** The mesh of a person, built once, each layer its own closed shell on the same bones: `cell` the body's grid in metres, so a far person can have a coarser one; the head's is finer, for the face. */
export function meshOf(p: Person, cell = 0.016): PersonMesh {
  const body = bodyOf(p, "rest", 0, [0, 0, 0], 0, true);
  const decals = body.capsules.filter((c) => c.decal === true && !FACE_PAINT.test(c.part));
  const dressed = body.capsules.filter((c) => c.decal !== true && c.carve !== true && c.role !== "eye" && c.role !== "lip").flatMap(unrolled);
  const bare = bareParts(p);
  const roles = Object.keys(p.palette);
  const net: Net = { position: [], normal: [], role: [], bones: [], weight: [], fabric: [], loose: [], cloth: [], soft: [], index: [] };
  const headOnly = bare.filter((c) => boneOfPart(c.part) === HEAD);
  dressedBody(net, p, roles, cell);
  for (const layer of layersOf(p, dressed, bare, cell)) netOf(net, layer, decals, layer.rigid === true || layer.parts.some((c) => c.role === "hair" || /^(hat|peak)/.test(c.part)) ? headOnly : bare, roles, cell);
  const s = restSkeleton(p), h = headFrame(s, p.build.head, p.face), size = p.build.size;
  const eyeAt = (x: number): Vec => scale(h.mark(x * p.face.apart, p.face.bone.pupil, 0.8), size);
  const roof = roofOf(dressed, size);
  const locks = hairLocks(net, p, roles, cell, roof), skinRole = roles.indexOf("skin");
  const seat: Seat = { skin: boundOf(net, h, size, (v) => net.bones[v * 2] === HEAD && net.fabric[v] === FABRICS.skin && net.role[v] === skinRole), tops: [null, null], lobes: [null, null] };
  const tones = [...locks, ...earsOf(net, p, roles, cell, seat), ...(cell < WRAPPED ? [] : cornersOf(net, p, roles, cell, h)), ...moustacheOf(net, p, roles, cell, h), ...crownOver(net, p, roles, cell, h, seat), ...jacketFront(net, p, roles, cell), ...poloFront(net, p, roles, cell), ...gearOn(net, p, roles, cell, h, seat)];
  const kept = compacted(net);
  const shade = hemShadow(kept, creases(kept), roles, size);
  // (The locks went in last, so theirs are the last vertices.)
  shade.set(tones, shade.length - tones.length);
  faceBake(kept, shade, p, roles, cell, tones.length);
  return {
    position: Float32Array.from(kept.position), normal: Float32Array.from(kept.normal), role: Uint8Array.from(kept.role), roles, palette: p.palette,
    bones: Uint8Array.from(kept.bones), weight: Float32Array.from(kept.weight), fabric: Uint8Array.from(kept.fabric), loose: Float32Array.from(kept.loose), cloth: Float32Array.from(kept.cloth), shade, soft: Float32Array.from(kept.soft), index: Uint32Array.from(kept.index),
    legs: legsOf(p),
    face: { eyes: [eyeAt(-1), eyeAt(1)], eye: p.build.head * p.face.eye * size, mouth: scale(h.mark(0, p.face.bone.sto, 0.9), size), mouthWide: p.build.head * p.face.mouthWide * size, head: p.build.head * size, lip: p.face.look.lip ?? p.palette.lip ?? "#a85a52", browLine: browLineOf(p), look: p.outfit.costume === "fursuit" ? {} : { ...p.face.look, seed: p.seed }, ...faceInks(p) },
  };
}

/** How a person's loose cloth follows them: a damped spring in the body's frame, thrown by every change of speed, dragged back by the air as they go. */
export function createHang(stiff = 34, damp = 5): { step(dt: number, velocity: Vec): Vec } {
  let at: Vec = [0, 0, 0], speed: Vec = [0, 0, 0], last: Vec = [0, 0, 0];
  return {
    step(dt, velocity) {
      const kick = sub(velocity, last);
      last = velocity;
      const pull = add(scale(sub(scale(velocity, -0.06), at), stiff), scale(speed, -damp));
      speed = add(add(speed, scale(pull, dt)), scale(kick, -0.5));
      at = add(at, scale(speed, dt));
      return at;
    },
  };
}

/** How fast each action carries a body forward, in its own heights a second. */
const paceOf = (p: Person, action: Action): number => (MOTIONS[action].pace ?? 0) * p.build.height;

/** How fast a person's hips are going at `t`: what `createHang` is to be stepped with. */
export function velocityAt(p: Person, action: Action, t: number): Vec {
  const dt = 1 / 60;
  const beat = (v: number): number => phaseOf(p, action, v);
  const moved = sub(skeletonOf(p, action, beat(t + dt)).pelvis, skeletonOf(p, action, beat(t)).pelvis);
  return add(scale(moved, p.build.size / dt), [0, 0, paceOf(p, action) * (MOTIONS[action].own === true ? p.gait.cadence * p.gait.stride : 1)]);
}

/** How far soft flesh has been left behind at `t`: on a stiffer spring than cloth, it is thrown up and down by each step and settles after it. In the body's frame, metres. */
export function jiggleAt(p: Person, action: Action, t: number): Vec {
  const spring = createHang(150, 7);
  let at: Vec = [0, 0, 0];
  for (let i = 24; i >= 0; i -= 2) {
    const speed = velocityAt(p, action, t - i / 60);
    at = spring.step(1 / 30, [speed[0], speed[1], speed[2] - paceOf(p, action)]);
  }
  const far = Math.hypot(...at), most = 0.007 * p.build.size;
  return scale(at, far * 0.18 > most ? most / far : 0.18);
}

/** Where a person's cloth has got to by `t`, for one still: the spring run up to it. */
export function trailAt(p: Person, action: Action, t: number): Vec {
  const hang = createHang();
  let at: Vec = [0, 0, 0];
  for (let i = 90; i >= 0; i -= 1) at = hang.step(1 / 60, velocityAt(p, action, t - i / 60));
  return at;
}

/** What a face is doing at `t`: blinking, glancing, and, when `talking`, a mouth that moves. */
export function faceAt(p: Person, t: number, talking = false, action: Action = "stand"): { readonly lid: number; readonly look: readonly [number, number]; readonly mouth: number; readonly smile: number } {
  if (action === "laugh") return { lid: Math.max(lidAt(p, t), 0.55), look: lookAt(p, t), mouth: 0.6 + 0.3 * Math.sin(t * 14), smile: 1 };
  const speech = talking || action === "talk" ? Math.max(0, Math.sin(t * 11 + Math.sin(t * 3.1) * 2)) * 0.7 : 0;
  return { lid: lidAt(p, t), look: lookAt(p, t), mouth: speech, smile: action === "cheer" || action === "dance" || action === "clap" ? 0.8 : p.face.bone.rest + Math.sin(t * 0.17 + p.seed) * 0.12 };
}

/** The frame of a bone running from `a` to `b`, as columns: across, along, forward. */
function boneFrame(a: Vec, b: Vec, turn = 0): readonly [Vec, Vec, Vec] {
  const along = unit(sub(b, a), UP);
  const forward = unit(cross([Math.cos(turn), 0, -Math.sin(turn)], along), FRONT);
  return [cross(along, forward), along, forward];
}

/** Each bone's matrix in a pose, three rows of four: rest space to posed space, in order of `BONES`. */
/** How much of the shoulders' turn each of the first bones takes: the hips going the other way. */
const TURNS: readonly number[] = [-0.6, 0.5, 1];

/** How far round a forearm takes the roll of its hand: half, the rest in the wrist, so neither is wrung. */
function halfRolled(swing: readonly [Vec, Vec, Vec], hand: readonly [Vec, Vec, Vec]): readonly [Vec, Vec, Vec] {
  const [x, along, z] = swing, a = Math.atan2(dot(cross(x, hand[0]), along), dot(x, hand[0])) / 2;
  const c = Math.cos(a), s = Math.sin(a);
  return [add(scale(x, c), scale(z, -s)), along, add(scale(x, s), scale(z, c))];
}

/** A pose's bone matrices; given `from`, that many parts of the way from another action, for a fade. */
export function poseMesh(p: Person, action: Action, t: number, from?: { readonly action: Action; readonly t: number; readonly k: number }): Float32Array {
  const target = skeletonOf(p, action, phaseOf(p, action, t));
  return bonesOf(p, from ? blended(skeletonOf(p, from.action, phaseOf(p, from.action, from.t)), target, 1 - from.k) : target);
}

/** Where a body's joints have been thrown, by physics or anything else, in metres from the point the mesh stands on. */
export interface Limp {
  /** How far the head has turned, radians. */
  readonly turn?: number;
  readonly pelvis: Vec;
  readonly neck: Vec;
  readonly head: Vec;
  readonly left: { readonly elbow: Vec; readonly wrist: Vec; readonly knee: Vec; readonly ankle: Vec };
  readonly right: { readonly elbow: Vec; readonly wrist: Vec; readonly knee: Vec; readonly ankle: Vec };
}

/** Bone matrices for joints something else has placed: a ragdoll, a mocap frame, a hand-set pose. */
export function limpBones(p: Person, limp: Limp): Float32Array {
  const stand = skeletonOf(p, "stand", 0), k = p.build.size;
  const down = (v: Vec): Vec => [v[0] / k, v[1] / k, v[2] / k];
  const pelvis = down(limp.pelvis), neck = down(limp.neck), head = down(limp.head);
  const limb = (side: "left" | "right"): { leg: Leg; arm: Arm } => {
    const j = limp[side], { arm, leg } = stand[side], wrist = down(j.wrist), ankle = down(j.ankle);
    const atWrist = (v: Vec): Vec => add(v, sub(wrist, arm.wrist)), atAnkle = (v: Vec): Vec => add(v, sub(ankle, leg.ankle));
    return {
      arm: { ...arm, shoulder: add(neck, sub(arm.shoulder, stand.neck)), elbow: down(j.elbow), wrist, hand: atWrist(arm.hand), tip: atWrist(arm.tip), nail: atWrist(arm.nail), thumb: atWrist(arm.thumb) },
      leg: { hip: add(pelvis, sub(leg.hip, stand.pelvis)), knee: down(j.knee), ankle, toe: atAnkle(leg.toe), end: atAnkle(leg.end) },
    };
  };
  const waist = madd(pelvis, sub(neck, pelvis), 0.25), chest = madd(pelvis, sub(neck, pelvis), 0.6);
  return bonesOf(p, { spin: 0, turn: limp.turn ?? 0, pelvis, waist, chest, neck, head, left: limb("left"), right: limb("right") });
}

function bonesOf(p: Person, now: Skeleton): Float32Array {
  const rest = restSkeleton(p);
  const k = p.build.size;
  const out = new Float32Array(BONES.length * 12);
  BONES.forEach(([, joints], i) => {
    const [ra, rb] = joints(rest), [na, nb] = joints(now);
    const hand = HAND_BONES.get(i), arm = FOREARMS.get(i);
    const r = hand ? handFrame(ra, rb, rest[hand].arm.knuckles) : arm ? handFrame(ra, rb, rest[arm].arm.knuckles) : boneFrame(ra, rb);
    const m = arm ? halfRolled(swungFrame(r, ra, rb, na, nb), handFrame(na, nb, now[arm].arm.knuckles)) : hand ? handFrame(na, nb, now[hand].arm.knuckles) : ARM_BONES.has(i) ? swungFrame(r, ra, rb, na, nb) : boneFrame(na, nb, i === HEAD ? now.turn : now.spin * (TURNS[i] ?? 0));
    for (let row = 0; row < 3; row += 1) {
      const line: Vec = [0, 1, 2].map((c) => r.reduce((sum, axis, j) => sum + (m[j]?.[row] ?? 0) * (axis[c] ?? 0), 0)) as unknown as Vec;
      out.set(line, i * 12 + row * 4);
      out[i * 12 + row * 4 + 3] = (na[row] ?? 0) * k - (line[0] * ra[0] + line[1] * ra[1] + line[2] * ra[2]) * k;
    }
  });
  return out;
}
