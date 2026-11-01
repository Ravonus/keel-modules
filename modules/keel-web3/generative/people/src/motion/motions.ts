// Motions: each action as a pose, the swing of each limb through its beat and what the trunk does over them.

import { FRONT, TAU, clamp } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Age, Gait, Person } from "../body/person.js";
import { feetDown, standHips } from "./skeleton.js";
import type { Action } from "./skeleton.js";

/** How a mesh is built: arms and legs held clear of the body, so no surface joins what must part. */
export const REST: Swing = { thigh: 0, knee: 0.02, upper: 0, fore: 0, out: 30, splay: 0.17 };

/** A leg's and an arm's angles at one moment, radians forward of hanging straight down. */
export interface Swing {
  /** How far a leg stands out from the body. */
  readonly splay?: number;
  readonly thigh: number;
  readonly knee: number;
  readonly upper: number;
  readonly fore: number;
  readonly out: number;
  /** How far the fingers are closed, radians at the knuckles. */ readonly curl?: number;
  /** Which way the palm faces, where it is not in toward the body. */ readonly palm?: Vec | undefined;
  /** How far the toes are raised past what the leg gives them. */ readonly pitch?: number;
  /** How far the toes turn out. */ readonly turned?: number;
  /** How far the forearm comes in across the body. */ readonly across?: number;
  /** Where the wrist is to go, from the chest: out to its own side, up, forward. The arm finds its own way there. */
  readonly reach?: Vec | undefined;
  /** How far the wrist bends toward the palm. */ readonly flex?: number;
}

/** What the trunk and head are doing, all but the height of the hips optional. */
export interface Body {
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
export interface Pose { readonly left: Swing; readonly right: Swing; readonly body: Body }

/**
 * A way of moving: how many beats a second, how many heights a second it carries a body, and the pose at any point of a
 * beat. Adding one is adding a line to `MOTIONS`.
 */
interface Motion {
  readonly beat: number;
  readonly pace?: number;
  /** Personal: taken at a person's own cadence, out of step with everyone else. */ readonly own?: boolean;
  readonly at: (p: Person, phase: number) => Pose;
}

export const STILL: Swing = { thigh: 0.02, knee: 0.04, upper: 0.03, fore: 0.16, out: 0.05, curl: 0.32, flex: 0.1 };

const ease = (v: number): number => {
  const k = clamp(v, 0, 1);
  return k * k * (3 - 2 * k);
};

/** How deep a jump's crouch is: down before the spring, a little in the air, and down again on landing. */
function crouchAt(u: number, air: number): number {
  if (u < 0.3) return ease(u / 0.2) * (1 - ease((u - 0.22) / 0.08));
  if (air > 0 && air < 1) return 0.28 * Math.sin(air * Math.PI);
  return (1 - ease((u - 0.82) / 0.18)) * 0.8 * ease((u - 0.76) / 0.06);
}

/**
 * A jump's body, at `u` of the way through it: how deep the crouch, how high off the ground, how far the arms have
 * swung up.
 */
function jumpAt(u: number): { readonly crouch: number; readonly high: number; readonly arms: number } {
  const air = (u - 0.3) / 0.46;
  const flying = air > 0 && air < 1;
  const crouch = crouchAt(u, air);
  return { crouch, high: flying ? 0.44 * 4 * air * (1 - air) : 0, arms: flying ? Math.sin(air * Math.PI) : -crouch };
}

export const sideIndex = (side: number): 0 | 1 => (side < 0 ? 0 : 1);

const swungJump = (phase: number, offset: number): Swing => {
  const { crouch, arms } = jumpAt(((phase / TAU) % 1 + 1) % 1);
  return {
    thigh: 0.02 + 1.05 * crouch + offset,
    knee: 0.04 + 2 * crouch + 0.7 * Math.max(0, arms),
    upper: 0.03 + (arms > 0 ? 2.2 * arms : 0.8 * arms),
    fore: 0.3 + 0.2 * Math.abs(arms),
    out: 0.08 + 0.2 * Math.max(0, arms),
    curl: 0.6,
    flex: 0.1,
  };
};

const bump = (phase: number, at: number, wide: number): number => {
  const d = Math.atan2(Math.sin(phase - at), Math.cos(phase - at)) / wide;
  return Math.exp(-d * d);
};

/** How far an arm swings: most people favour one. */
const armSwing = (g: Gait, side: number): number => g.swing * (side === g.lazy ? g.lazyBy : 1);

/**
 * Walking, one side at `phase`: the leg forward at the heel's strike, a knee that gives as it takes the weight, and
 * that bends most just after the thigh has passed under the hip. The arms hang and swing a little further back than
 * forward.
 */
function walkSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase);
  const arm = armSwing(g, side);
  return {
    thigh: 0.05 + 0.38 * g.stride * s,
    knee: 0.05 + 0.76 * g.kick * bump(phase, 0.5, 0.75) + 0.2 * bump(phase, 2.1, 0.35),
    upper: -0.06 + g.carry * 0.3 - 0.4 * arm * s,
    fore: 0.26 + 0.16 * arm * (1 - s),
    out: 0.03 + g.flare * 0.4,
    pitch: 0.34 * bump(phase, 1.6, 0.4) - 0.5 * bump(phase, -1.35, 0.45),
    turned: g.turned,
    curl: g.walking[sideIndex(side)],
    flex: 0.14,
  };
}

/** Power walking: a walk's legs, long and quick and one foot always down, with a runner's arms. */
function powerSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase);
  return {
    ...walkSwing({ ...g, stride: g.stride * 1.28, kick: g.kick * 0.8 }, phase, side),
    upper: -0.12 + g.carry * 0.5 - 0.5 * armSwing(g, side) * s,
    fore: g.pump[sideIndex(side)],
    out: 0.08 + g.flare,
    across: g.across * 0.7,
    curl: g.running[sideIndex(side)],
    flex: 0.04,
  };
}

/** How far a knee shuts: past this the calf is through the thigh. */
const FOLD = 2.2;

/**
 * Running at `effort`, one side at `phase`: pushed off behind at -π/2, the heel folds up under the hip, the knee drives
 * through high, and the foot comes down bent-kneed under the body.
 */
function runSwing(g: Gait, phase: number, side: number, effort: number): Swing {
  const s = Math.sin(phase);
  return {
    thigh: 0.26 + (0.4 + 0.32 * effort) * g.stride * s,
    knee: Math.min(
      FOLD,
      0.22 +
        (0.9 + 1.1 * effort) * g.kick * bump(phase, -0.32, 0.85) +
        0.42 * bump(phase, 1.5, 0.55) +
        0.4 * bump(phase, 2.7, 0.55),
    ),
    upper: -0.16 + g.carry - (0.3 + 0.34 * effort) * armSwing(g, side) * s,
    fore: g.pump[sideIndex(side)],
    out: 0.06 + g.flare,
    across: g.across,
    turned: g.turned * 0.6,
    curl: g.running[sideIndex(side)],
    flex: 0.03,
  };
}

/** The ages that walk as grown people do, their hips and shoulders in it. */
const GROWN_GAIT: readonly Age[] = ["teen", "adult", "elder"];

/**
 * The weight going from foot to foot, and with it the pelvis, the spine and the shoulders: women's hips travel further
 * than men's, whose shoulders turn more.
 */
/** How a gait carries the trunk: how far the hips sway, and how far it leans into the going. */
interface Stride {
  readonly sway: number;
  readonly lean: number;
}

function strideBody(p: Person, phase: number, hips: number, { sway, lean }: Stride): Body {
  const grown = GROWN_GAIT.includes(p.build.age);
  const female = p.build.sex === "female" && grown;
  const g = p.gait;
  const c = Math.cos(phase);
  return {
    hips,
    lean,
    twist: 0.05 * (p.build.sex === "male" && grown ? 1.3 : 0.8) * g.twist * Math.sin(phase),
    shift: c * sway * (female ? 0.024 : 0.014) * g.sway,
    drop: c * Math.min(1, sway) * (female ? 0.016 : 0.01) * g.sway,
    wide: (female ? 0.46 : 0.6) * g.wide,
  };
}

const opposed = (
  p: Person,
  phase: number,
  swing: (g: Gait, phase: number, side: number) => Swing,
): readonly [Swing, Swing] => [swing(p.gait, phase, -1), swing(p.gait, phase + Math.PI, 1)];

/** One side's swing: `phase` runs a full stride, the other side half a stride behind. */
type SwingOf = (g: Gait, phase: number, side: number) => Swing;

function walked(p: Person, phase: number, swing: SwingOf, stride: Stride): Pose {
  const [left, right] = opposed(p, phase, swing);
  return { left, right, body: strideBody(p, phase, feetDown(p, left, right), stride) };
}

/** Both feet leave the ground between steps: the hips lowest over the foot and highest in the air. */
function ran(p: Person, phase: number, effort: number): Pose {
  const [left, right] = opposed(p, phase, (g, at, side) => runSwing(g, at, side, effort));
  return {
    left,
    right,
    body: strideBody(p, phase, standHips(p) - 0.13 + 0.05 * effort * p.gait.bounce * (1 - Math.cos(2 * phase)), {
      sway: 0.6,
      lean: 0.07 + 0.15 * effort + p.gait.lean,
    }),
  };
}

/** A pose on the ground, the hips as high as the feet let them be. */
const grounded = (p: Person, left: Swing, right: Swing, body: Omit<Body, "hips"> = {}): Pose => ({
  left,
  right,
  body: { hips: feetDown(p, left, right), ...body },
});

/** The same on both sides. */
const held = (p: Person, swing: (side: number) => Swing, body: Omit<Body, "hips"> = {}): Pose => grounded(p, swing(-1), swing(1), body);

/** Knees giving in time, as anything to a beat. */
const bouncing = (phase: number, deep: number, side = 0): Swing => ({
  ...STILL,
  thigh: 0.1 + deep * (1 + Math.cos(phase * 2 + side)),
  knee: 0.2 + deep * 2 * (1 + Math.cos(phase * 2 + side)),
});

function danced(p: Person, phase: number): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const flip = (side: number): number => (side < 0 ? 1 : -1);
  const body = { shift: 0.085 * s, side: -0.085 * s, turn: 0.2 * s, wide: 0.9, tilt: 0.06 * c };
  const moves: readonly ((side: number) => Swing)[] = [
    (side) => ({ ...bouncing(phase, 0.1), upper: 0.25 + 0.3 * s * flip(side), fore: 1.5, out: 0.2, curl: 1 }),
    (side) => ({
      ...bouncing(phase, 0.08),
      reach: [0.26, 0.6 + 0.14 * s * flip(side), 0.12],
      palm: [-side, 0, 0.3],
      curl: 0.5,
    }),
    (side) => ({
      ...bouncing(phase, 0.1, side),
      reach: [0.3 + 0.05 * s, -0.08 + 0.1 * c, 0.26],
      palm: [0, -1, 0],
      curl: 0.4,
      flex: 0.3,
    }),
    (side) => ({
      ...bouncing(phase, 0.12),
      reach: s * flip(side) > 0 ? [0.34, 0.5, 0.2] : [0.12, -0.14, 0.26],
      curl: 0.9,
    }),
  ];
  return held(p, moves[p.gait.dance % (p.build.age === "adult" || p.build.age === "elder" ? 4 : 2)] ?? (() => STILL), { ...body, curve: 0.08 * c });
}

function laughed(p: Person, phase: number): Pose {
  const shake = Math.sin(phase * 3);
  const k = Math.sin(phase);
  const left: Swing = { ...STILL, reach: [0.05, -0.22, 0.2], palm: [0, 0, -1], curl: 0.3 };
  const right: Swing = { ...STILL, reach: [0.1 + 0.02 * shake, -0.14, 0.2], palm: [0, 0, -1], curl: 0.3 };
  return grounded(p, left, right, {
    lean: -0.1 + 0.08 * k,
    curve: 0.1 + 0.2 * k,
    nod: -0.34 + 0.3 * k,
    shrug: [0.012 * shake, 0.012 * shake],
    tilt: 0.08,
    breath: 0.012 * shake,
  });
}

const idled = (p: Person, phase: number): Pose => {
  const s = Math.sin(phase * 0.5);
  const turn = Math.sin(phase * 0.21 + p.seed) * 0.42;
  const hand = p.gait.idle === 1 ? { reach: [0.21, -0.2, 0.03] as Vec, palm: [-0.7, 0, -1] as Vec, curl: 0.3 } : {};
  return {
    left: { ...STILL, upper: 0.03 + 0.02 * Math.sin(phase - 1), fore: 0.16 + 0.03 * Math.sin(phase * 0.7), curl: 0.36 },
    right: {
      ...STILL,
      upper: 0.03 + 0.02 * Math.sin(phase + 1),
      fore: 0.16 + 0.03 * Math.sin(phase * 0.7),
      curl: 0.36,
      ...hand,
    },
    body: {
      hips: feetDown(p, STILL, STILL),
      lean: s * 0.02,
      shift: s * 0.035,
      turn,
      breath: Math.sin(phase) * 0.014,
      side: -s * 0.02,
    },
  };
};

const bowed = (p: Person, phase: number): Pose => {
  const k = (1 - Math.cos(phase)) / 2;
  return held(p, () => ({ ...STILL, upper: 0.2 * k, curl: 0.3 }), { lean: 0.86 * k, curve: 0.2 * k, nod: 0.3 * k });
};

export const MOTIONS: Readonly<Record<Action, Motion>> = {
  rest: { beat: 0, at: (p) => ({ left: REST, right: REST, body: { hips: feetDown(p, STILL, STILL) } }) },
  // (Sitting with the arms held out, so that nothing lies over what the cloth is doing: for looking at clothes.)
  seated: {
    beat: 0,
    at: (p) => {
      const sat = MOTIONS.sit.at(p, 0);
      const arms = { upper: 0, fore: 0, out: REST.out, curl: 0, flex: 0 };
      return { ...sat, left: { ...sat.left, ...arms }, right: { ...sat.right, ...arms } };
    },
  },
  stand: { beat: 0.28, at: (p, phase) => held(p, () => STILL, { breath: Math.sin(phase) * 0.014 }) },
  idle: { beat: 0.28, at: idled },
  walk: {
    beat: 0.92,
    pace: 0.8,
    own: true,
    at: (p, phase) => walked(p, phase, walkSwing, { sway: 1, lean: 0.03 + p.gait.lean * 0.4 }),
  },
  power: {
    beat: 1.2,
    pace: 1.3,
    own: true,
    at: (p, phase) => walked(p, phase, powerSwing, { sway: 1.5, lean: 0.08 + p.gait.lean * 0.6 }),
  },
  jog: { beat: 1.3, pace: 1.5, own: true, at: (p, phase) => ran(p, phase, 0.55) },
  run: { beat: 1.55, pace: 2.6, own: true, at: (p, phase) => ran(p, phase, 1) },
  sprint: { beat: 1.9, pace: 3.8, own: true, at: (p, phase) => ran(p, phase, 1.35) },
  jump: {
    beat: 0.8,
    at: (p, phase) => {
      const { high } = jumpAt((((phase / TAU) % 1) + 1) % 1);
      const left = swungJump(phase, -0.04);
      const right = swungJump(phase, 0.04);
      return { left, right, body: { hips: high > 0 ? standHips(p) + high : feetDown(p, left, right) } };
    },
  },
  sit: {
    beat: 0.28,
    at: (p, phase) => {
      const leg: Swing = { thigh: 1.5, knee: 1.5, upper: 0.35, fore: 0.95, out: 0.12, curl: 0.4, flex: 0.2 };
      return { left: leg, right: leg, body: { hips: standHips(p) * 0.56, breath: Math.sin(phase) * 0.014 } };
    },
  },
  crouch: {
    beat: 0.28,
    at: (p, phase) =>
      held(p, () => ({ ...STILL, thigh: 1.5, knee: 2.3, pitch: 0.5, upper: 0.5, fore: 1.2, out: 0.2, curl: 0.4 }), {
        lean: 0.5,
        wide: 1,
        breath: Math.sin(phase) * 0.014,
      }),
  },
  wave: {
    beat: 1.6,
    at: (p, phase) =>
      grounded(
        p,
        STILL,
        {
          ...STILL,
          reach: [0.3 + 0.08 * Math.sin(phase), 0.48, 0.12],
          palm: FRONT,
          curl: 0.08,
          flex: -0.15 + 0.3 * Math.sin(phase),
        },
        { tilt: 0.05, side: -0.03 },
      ),
  },
  clap: {
    beat: 2.1,
    at: (p, phase) =>
      held(p, (side) => ({
        ...STILL,
        reach: [0.036 + 0.075 * (0.5 + 0.5 * Math.cos(phase)), -0.03, 0.27],
        palm: [-side, 0, 0],
        curl: 0.1,
        flex: 0,
      })),
  },
  laugh: { beat: 0.9, at: laughed },
  cheer: {
    beat: 1.4,
    at: (p, phase) =>
      held(
        p,
        (side) => ({
          ...bouncing(phase, 0.1),
          reach: [0.34, 0.72 + 0.08 * Math.sin(phase * 2), 0.12],
          palm: [-side, 0, 0.4],
          curl: 1.2,
        }),
        { nod: -0.25 },
      ),
  },
  dance: { beat: 1, at: danced },
  shrug: {
    beat: 0.6,
    at: (p, phase) => {
      const k = Math.max(0, Math.sin(phase));
      return held(
        p,
        (side) => ({ ...STILL, reach: [0.3 + 0.1 * k, -0.2 + 0.1 * k, 0.2], palm: [-side * 0.3, 1, 0], curl: 0.12 }),
        { shrug: [0.09 * k, 0.09 * k], tilt: 0.14 * k },
      );
    },
  },
  bow: { beat: 0.4, at: bowed },
  nod: { beat: 1.2, at: (p, phase) => held(p, () => STILL, { nod: 0.1 + 0.2 * Math.sin(phase) }) },
  fold: {
    beat: 0.28,
    at: (p, phase) =>
      grounded(
        p,
        { ...STILL, reach: [-0.1, -0.09, 0.19], palm: [0, 1, 0.3], curl: 0.6 },
        { ...STILL, reach: [-0.1, -0.13, 0.2], palm: [0, -1, 0.3], curl: 0.6 },
        { breath: Math.sin(phase) * 0.014, lean: -0.02 },
      ),
  },
  hips: {
    beat: 0.28,
    at: (p, phase) =>
      held(p, () => ({ ...STILL, reach: [0.24, -0.2, 0], palm: [-0.7, 0, -1], curl: 0.3, flex: -0.2 }), {
        breath: Math.sin(phase) * 0.014,
      }),
  },
  think: {
    beat: 0.28,
    at: (p, phase) =>
      grounded(
        p,
        { ...STILL, reach: [-0.08, -0.12, 0.17], palm: [0, 1, 0], curl: 0.5 },
        { ...STILL, reach: [0.02, 0.28, 0.2], palm: [-1, 0.3, 0], curl: 0.9 },
        { nod: 0.1, tilt: 0.1, breath: Math.sin(phase) * 0.014 },
      ),
  },
  talk: {
    beat: 0.8,
    at: (p, phase) =>
      held(
        p,
        (side) => ({
          ...STILL,
          reach: [0.2 + 0.06 * Math.sin(phase + side), -0.14 + 0.05 * Math.sin(phase * 2 + side), 0.24],
          palm: [-side * 0.5, 0.8, 0],
          curl: 0.4,
        }),
        { nod: 0.06 * Math.sin(phase * 2), turn: 0.14 * Math.sin(phase * 0.5) },
      ),
  },
  stretch: {
    beat: 0.3,
    at: (p, phase) => {
      const k = (1 - Math.cos(phase)) / 2;
      return held(
        p,
        (side) => ({
          ...STILL,
          reach: [0.3 - 0.14 * k, -0.2 + 0.86 * k, 0.1 - 0.02 * k],
          palm: [-side, k, 0],
          curl: 0.3,
        }),
        { nod: -0.3 * k, curve: -0.12 * k, breath: 0.02 * k },
      );
    },
  },
};
