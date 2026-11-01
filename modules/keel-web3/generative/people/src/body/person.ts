// What a person is: their build, face, hair, clothes and gait, and the one seed that rolls them all.

import { skinTone, streamOf } from "../roll.js";
import { buildOf, gaitOf } from "./build.js";
import { faceFor, faceOf } from "../head/face.js";
import { deepOf, hairOn, paletteOf, parted } from "../clothes/palette.js";
import { colourFor, dressedFor, gearColours, gearOf, hatted, inCostume, outfitOf, shirtUnder } from "../clothes/outfit.js";

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
  /**
   * How much meat is on the limbs, the size of the bust (a man's chest), the seat, and the feet's length, each 1
   * average.
   */
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

/**
 * What a face is built on, in head radii: `y` up from the head's centre, `z` forward of it, `x` out from the middle.
 */
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

/**
 * How a person moves, theirs as their face is. Two strangers never run alike, and few people run alike on both sides.
 */
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
  /**
   * How far the forearms come in across the body, how far apart the feet go, and where in a stride they happen to be.
   */
  readonly across: number;
  readonly wide: number;
  readonly offset: number;
  /** Which of the ways of dancing and of standing about are theirs. */
  readonly dance: number;
  readonly idle: number;
}


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
  const palette = paletteOf(rand, skin, { age: build.age, iris: face.iris, genre: base.genre });
  const day = streamOf(seed, 0x77656174);
  const dressed = dressedFor(day, build, base, weather);
  const outfit = hatted(seed, build, inCostume(day, build, dressed, { weather, asked: costume }));
  const big = outfit.costume === "fursuit" ? { ...build, head: build.head * 1.16 } : build;
  const worn = { ...palette, ...colourFor(day, outfit), ...gearColours(seed) };
  return { seed, build: big, face, hair: outfit.costume === "fursuit" ? "bald" : hair, outfit, gear: gearOf(seed, build, outfit), palette: { ...worn, shirt: shirtUnder(worn.top ?? "#777777"), bottom: parted(worn.bottom ?? "#333333", worn.top ?? "#777777") }, gait: gaitOf(streamOf(seed, 0x67616974), build) };
}
