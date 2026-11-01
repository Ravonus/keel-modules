// The build: age, sex, height and shape, and the gait that build carries itself with.

import { TAU, clamp, mix } from "../vec.js";
import { bell, weighted } from "../roll.js";
import type { Weighted } from "../roll.js";
import type { Age, Build, Gait, Sex, Shape } from "./person.js";

/** The height everybody is drawn at, before `size`. */
export const TALL = 1.72;

const AGES: readonly (readonly [Age, number])[] = [["toddler", 0.7], ["child", 2.2], ["teen", 1.6], ["adult", 8], ["elder", 2]];

interface Stage {
  readonly tall: readonly [number, number];
  readonly heads: readonly [number, number];
  readonly legs: readonly [number, number];
  readonly narrow: number;
}

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

export function buildOf(rand: () => number): Build {
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


/** A hand on the move, how closed: a fist, loose, cupped, or flat as a blade. */
const HANDS: Weighted<number> = [[1.5, 3], [0.98, 3], [0.56, 2.4], [0.18, 2]];

/** What an age does to anyone's stride. */
const AGE_GAIT: Readonly<
  Record<
    Age,
    {
      readonly cadence: number;
      readonly stride: number;
      readonly swing: number;
      readonly bounce: number;
      readonly flare: number;
      readonly lean: number;
    }
  >
> = {
  toddler: { cadence: 1.26, stride: 0.8, swing: 0.8, bounce: 1.2, flare: 0.14, lean: 0.03 },
  child: { cadence: 1.12, stride: 0.95, swing: 1.1, bounce: 1.25, flare: 0.03, lean: 0 },
  teen: { cadence: 1.03, stride: 1.02, swing: 1, bounce: 1.1, flare: 0, lean: 0 },
  adult: { cadence: 1, stride: 1, swing: 1, bounce: 1, flare: 0, lean: 0 },
  elder: { cadence: 0.84, stride: 0.72, swing: 0.68, bounce: 0.45, flare: 0.03, lean: 0.05 },
};

/** A person's own way of moving, from a stream of its own so it changes nothing of how they look. */
export function gaitOf(rand: () => number, build: Build): Gait {
  const age = AGE_GAIT[build.age];
  const heavy = clamp(build.girth - 1, 0, 1);
  const hand = weighted(rand, HANDS);
  const other = rand() < 0.3 ? weighted(rand, HANDS) : hand;
  const off = mix(-0.08, 0.08, rand());
  const easy = mix(0.2, 0.62, rand());
  const elbow = mix(0.95, 1.95, rand());
  const odd = mix(-0.2, 0.2, rand());
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


/** How much thicker than average a body's limbs are: less than its trunk, where most of anybody's weight goes. */
export const limbWide = (b: Build): number => mix(1, Math.sqrt(b.girth * b.limb), 0.85);
