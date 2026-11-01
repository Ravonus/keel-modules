// A posed person: capsules placed in the world, and how they move, jiggle, trail and blink over time.

import { FRONT, SIDE, TAU, UP, add, mix, scale, sub } from "../vec.js";
import type { Vec } from "../vec.js";
import { hashed } from "../roll.js";
import type { Person } from "../body/person.js";
import { skeletonOf } from "./skeleton.js";
import { MOTIONS } from "./motions.js";
import type { Action, Skeleton } from "./skeleton.js";
import { drawArm, drawClothes, drawLeg, drawTorso } from "../mesh/parts.js";
import type { Capsule, Kit } from "../mesh/parts.js";
import { drawHead, headFrame } from "../head/head.js";

// ---------------------------------------------------------------- a posed person

/** What a renderer needs of one person, posed: sdf-body takes it as it is. */
export interface PersonBody {
  readonly id: string;
  readonly capsules: readonly Capsule[];
  readonly palette: Readonly<Record<string, string>>;
  readonly at: Vec;
  readonly front: Vec;
  readonly skeleton: Skeleton;
  readonly eye: {
    readonly role: string;
    readonly lid: number;
    readonly slant: number;
    readonly color: string;
    readonly pupil: "round";
    readonly ring: boolean;
    readonly spark: number;
    readonly white: string;
    readonly look: readonly [number, number];
  };
  readonly skin: { readonly role: string; readonly chroma: number; readonly flush: number; readonly depth: number };
  readonly material: { readonly sheen: number; readonly fuzz: number };
  readonly grain: {
    readonly kind: "fur";
    readonly size: number;
    readonly on: string;
    readonly lie: Vec;
    readonly pelt: {
      readonly flow: readonly {
        readonly a: Vec;
        readonly b: Vec;
        readonly long: readonly [number, number];
        readonly up: Vec;
        readonly girth: number;
        readonly fall: number;
      }[];
      readonly under: number;
      readonly thin: number;
      readonly crease: number;
      readonly root: string;
      readonly tint: number;
    };
  };
}

/** How long a style's hair runs, in grains: hanging styles the longest, a full head of curls next, the rest short. */
function hairLength(hair: Person["hair"]): number {
  if (hair === "long" || hair === "bob" || hair === "pony") return 1.5;
  return hair === "afro" || hair === "curly" ? 1.1 : 0.7;
}

/**
 * Where hair grows and how long, in grains: over the crown from the brow, down the back of the skull and past each ear.
 */
function hairFlow(p: Person, s: Skeleton): PersonBody["grain"]["pelt"]["flow"] {
  const h = headFrame(s, p.build.head, p.face);
  const { r } = h;
  const long = hairLength(p.hair);
  const bone = (a: Vec, b: Vec, ends: readonly [number, number], up: Vec): PersonBody["grain"]["pelt"]["flow"][number] => ({
    a,
    b,
    long: ends,
    up,
    girth: r * 0.84,
    fall: 0.15,
  });
  return [
    bone(h.at(0, 0.8, 0.8), h.at(0, 0.7, -1), [0.5, long], UP),
    bone(h.at(0, 0.7, -1), h.at(0, -2.6, -1), [long, long], scale(FRONT, -1)),
    bone(h.at(-0.9, 0.6, 0), h.at(-0.9, -1.6, -0.2), [long * 0.8, long], scale(SIDE, -1)),
    bone(h.at(0.9, 0.6, 0), h.at(0.9, -1.6, -0.2), [long * 0.8, long], SIDE),
  ];
}

/** How far shut a lid is, `since` seconds into a blink: down in a blink, up a little slower, then open. */
function shutBy(since: number): number {
  if (since < 0.07) return since / 0.07;
  return since < 0.2 ? 1 - (since - 0.07) / 0.13 : 0;
}

/** A blink every few seconds, each person on their own beat: the lid down fast and up a little slower. */
function lidAt(p: Person, t: number): number {
  // (Each gap its own length, two to six seconds: nobody blinks like a clock.)
  let since = t + p.seed * 1.37;
  let n = 0;
  for (let gap = 2 + 4 * hashed(p.seed, n); since > gap && n < 400; gap = 2 + 4 * hashed(p.seed, n)) {
    since -= gap;
    n += 1;
  }
  return mix(p.face.lid, 1, shutBy(since));
}

/** Where they are looking: mostly ahead, glancing off now and then, a slow wander and never a stare. */
function lookAt(p: Person, t: number): readonly [number, number] {
  const swing = Math.sin(t * 0.7 + p.seed);
  const glance = Math.abs(swing) > 0.92 ? Math.sign(swing) : 0;
  return [glance * 0.22 + Math.sin(t * 0.31 + p.seed * 2.1) * 0.06, Math.sin(t * 0.23 + p.seed) * 0.06];
}

/** How far through a beat a person is at `t`: no two in step. */
export const phaseOf = (p: Person, action: Action, t: number): number =>
  t * strideOf(p, action) * TAU + (MOTIONS[action].own === true ? p.gait.offset : 0);

/** Strides a second, as this person takes them. */
export const strideOf = (p: Person, action: Action): number =>
  MOTIONS[action].beat * (MOTIONS[action].own === true ? p.gait.cadence : 1);

/** Turned about the vertical by `yaw`, and stood at `at`. */
const placed = (v: Vec, at: Vec, yaw: number): Vec => [
  at[0] + v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw),
  at[1] + v[1],
  at[2] - v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw),
];

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
export const posePerson = (p: Person, action: Action, t: number, at: Vec = [0, 0, 0], yaw = 0): PersonBody =>
  bodyOf(p, action, t, { at, yaw, rich: false });

/** Where a posed body stands and faces, and whether its head is the rich one a mesh is built from. */
export interface Stance {
  readonly at: Vec;
  readonly yaw: number;
  /** The head a mesh is built from if `rich`, or the one that costs a raymarcher few parts. */
  readonly rich: boolean;
}

/** A posed person, stood and turned as its `Stance` says. */
export function bodyOf(p: Person, action: Action, t: number, { at, yaw, rich }: Stance): PersonBody {
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
    eye: {
      role: "eye",
      lid: lidAt(p, t),
      slant: p.face.slant,
      color: p.palette.skin ?? "#c89878",
      pupil: "round",
      ring: false,
      spark: 0.13,
      white: "#ece6dc",
      look: lookAt(p, t),
    },
    skin: { role: "skin", chroma: 0.8, flush: 0.15, depth: 1 },
    material: { sheen: 0.12, fuzz: 0.2 },
    grain: {
      kind: "fur",
      size: 0.018 * p.build.size,
      on: "hair",
      lie: [0, -1, -0.5],
      pelt: {
        flow: hairFlow(p, s).map((b) => ({
          ...b,
          a: placed(scale(b.a, p.build.size), at, yaw),
          b: placed(scale(b.b, p.build.size), at, yaw),
          up: placed(b.up, [0, 0, 0], yaw),
          girth: b.girth * p.build.size,
        })),
        under: 0.45,
        thin: 0.2,
        crease: 0.3,
        root: "#3a2a22",
        tint: 0.06,
      },
    },
  };
}


/**
 * How a person's loose cloth follows them: a damped spring in the body's frame, thrown by every change of speed,
 * dragged back by the air as they go.
 */
export function createHang(stiff = 34, damp = 5): { step(dt: number, velocity: Vec): Vec } {
  let at: Vec = [0, 0, 0];
  let speed: Vec = [0, 0, 0];
  let last: Vec = [0, 0, 0];
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
  return add(scale(moved, p.build.size / dt), [
    0,
    0,
    paceOf(p, action) * (MOTIONS[action].own === true ? p.gait.cadence * p.gait.stride : 1),
  ]);
}

/**
 * How far soft flesh has been left behind at `t`: on a stiffer spring than cloth, it is thrown up and down by each step
 * and settles after it. In the body's frame, metres.
 */
export function jiggleAt(p: Person, action: Action, t: number): Vec {
  const spring = createHang(150, 7);
  let at: Vec = [0, 0, 0];
  for (let i = 24; i >= 0; i -= 2) {
    const speed = velocityAt(p, action, t - i / 60);
    at = spring.step(1 / 30, [speed[0], speed[1], speed[2] - paceOf(p, action)]);
  }
  const far = Math.hypot(...at);
  const most = 0.007 * p.build.size;
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
