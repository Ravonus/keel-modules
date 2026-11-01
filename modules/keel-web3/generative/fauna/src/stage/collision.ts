// Collision: animals shoved apart on the ground, swung round each other and round the limbs on the wood.

import { add, clamp, dot, length, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Action } from "../roster.js";
import { groundY, perchOf, trunkAxis } from "./stage.js";
import type { Place, Stage, Wood } from "./stage.js";
import { woodKey, woodMapOf, woodNear } from "./paths.js";
import type { WoodMap } from "./paths.js";
import { offWood } from "./perches.js";
import type { Actor, Scene, Segment } from "./director.js";
import type { Capsule, Moment } from "./moments.js";
import { bodyOf } from "../animals/bodies.js";
import type { Body } from "../animals/bodies.js";

// ---------------------------------------------------------------- collision

/** A circle on the ground, in world x and z. */
export interface Ring { readonly x: number; readonly z: number; readonly r: number }
/** What an animal takes up on the ground: rings along its trunk, and how hard it is to move. */
export interface Footprint {
  readonly rings: readonly Ring[];
  readonly weight: number;
  readonly team: number;
  readonly self: number;
  readonly faces: number;
}

const SHOVE_PASSES = 4;
const MOST_RINGS = 6;
const ROOTED = 1e9;

/**
 * Animals that have turned to each other (a sniff, a groom, a nose to a nose) may come this much closer, their trunks
 * still apart.
 */
const SNUG = 0.5;
const TOUCH_ACTS: readonly Action[] = ["groom", "nuzzle", "play", "sniff"];
const greeting = (a: Footprint, b: Footprint): boolean =>
  a.team === b.team && (a.faces === b.self || b.faces === a.self);

/** How far ring `a` lies inside ring `b`, each carried by its animal's shove so far, and the way out of it. */
/** A ring and how far its animal's shove has carried it so far. */
type Shoved = readonly [ring: Ring, by: readonly [number, number]];

function overlapOf([a, at]: Shoved, [b, bt]: Shoved, tie: number, room: number): { gap: number; x: number; z: number } {
  const dx = a.x + at[0] - b.x - bt[0];
  const dz = a.z + at[1] - b.z - bt[1];
  const d = Math.hypot(dx, dz);
  // (Dead on top of each other, they part by their places in the cast, never by chance.)
  return d > 1e-6
    ? { gap: (a.r + b.r) * room - d, x: dx / d, z: dz / d }
    : { gap: (a.r + b.r) * room, x: Math.cos(tie), z: Math.sin(tie) };
}

/**
 * How far each animal is pushed so that none stands in another: the lighter
 * gives way more. A function of where they stand now and nothing else, so it
 * eases in as they close, and is the same at any frame rate.
 */
export function shoveApart(prints: readonly (Footprint | null)[]): (readonly [number, number])[] {
  const shove = prints.map((): [number, number] => [0, 0]);
  const pushPair = (i: number, j: number): void => {
    const [a, b] = [prints[i], prints[j]];
    const [at, bt] = [shove[i], shove[j]];
    if (!a || !b || !at || !bt) return;
    const room = greeting(a, b) ? SNUG : 1;
    for (const ra of a.rings) for (const rb of b.rings) {
      const { gap, x, z } = overlapOf([ra, at], [rb, bt], i + j * 2.4, room);
      if (gap <= 0) continue;
      const share = b.weight / (a.weight + b.weight);
      at[0] += x * gap * share;
      at[1] += z * gap * share;
      bt[0] -= x * gap * (1 - share);
      bt[1] -= z * gap * (1 - share);
    }
  };
  for (let pass = 0; pass < SHOVE_PASSES; pass += 1) {
    for (let i = 0; i < prints.length; i += 1) for (let j = i + 1; j < prints.length; j += 1) pushPair(i, j);
  }
  return shove;
}

/**
 * Where a body is thickest, as points along its trunk a ring apart: close enough that another body can't lie across the
 * gap, and through the middle too, for two bodies head to tail would have their ends push equally both ways.
 */
function trunkOfBody(m: Moment, capsules: readonly Capsule[]): { centres: Vec[]; r: number } | null {
  const thick = capsules.filter((c) => c.decal !== true && c.carve !== true);
  const most = thick.reduce((high, c) => Math.max(high, c.r), 0);
  if (most <= 0) return null;
  const { o, x, y, z } = m.frame;
  const big = thick.filter((c) => c.r >= most * 0.6).flatMap((c) => [c.a, c.b]);
  const along = big.map((p) => dot(sub(p, o), z));
  const mean = (axis: Vec): number => big.reduce((sum, p) => sum + dot(sub(p, o), axis), 0) / big.length;
  // (Beside its own heading too: a body curled up lies off to one side of it.)
  const from = add(add(o, scale(x, mean(x))), scale(y, mean(y)));
  const r = most * 1.25;
  const [low, high] = [Math.min(...along), Math.max(...along)];
  const span = Math.max(0, high - low - r);
  const gaps = Math.min(MOST_RINGS - 1, Math.ceil(span / r));
  return {
    centres: Array.from({ length: gaps + 1 }, (_, i) =>
      madd(from, z, (low + high) / 2 + (gaps === 0 ? 0 : span * (i / gaps - 0.5))),
    ),
    r,
  };
}

/** An animal's footprint, from the thick parts of its body as posed; none while it is off the ground. */
export function footprintOf(actor: Actor, m: Moment, capsules: readonly Capsule[], team: number): Footprint | null {
  if (m.mode === "fly" || m.mode === "climb" || m.segment.from.on !== "ground" || m.segment.to.on !== "ground") return null;
  const body = trunkOfBody(m, capsules);
  if (!body) return null;
  return {
    rings: body.centres.map((p) => ({ x: p[0], z: p[2], r: body.r })),
    weight: actor.member.size * actor.member.size,
    team,
    self: actor.index,
    faces: TOUCH_ACTS.includes(m.segment.act) ? m.segment.face : -1,
  };
}


/** A body in the tree: its trunk in the air, how hard it is to move, and which way it steps aside. */
export interface WoodPrint {
  readonly balls: readonly Vec[];
  readonly r: number;
  readonly weight: number;
  readonly side: Vec;
  readonly own?: readonly Wood[];
}

const onWood = (place: Place): boolean => place.on === "perch" || place.on === "trunk";

/** The wood a trip goes by, which is no obstacle to it: the limbs at either end, and those of its route. */
export function ownWood({ from, to, via = [] }: Segment, stage: Stage): Wood[] {
  const limb = (place: Place): readonly Wood[] => (place.on === "perch" ? perchOf(stage, place.i)?.path ?? [] : []);
  return [...limb(from), ...limb(to), ...via.flatMap((i) => limb({ on: "perch", i }))];
}

/** An animal's place in the tree; none on the ground, in the air, or on another's back. */
function woodPrintOf(actor: Actor, m: Moment, capsules: readonly Capsule[], stage: Stage): WoodPrint | null {
  const { from, to } = m.segment;
  if (!(onWood(from) || onWood(to)) || from.on === "back" || to.on === "back") return null;
  const body = trunkOfBody(m, capsules);
  if (!body) return null;
  // (One sat still is harder to shift: it's the climber going by that swings round it.)
  const weight = actor.member.size * actor.member.size * (m.moving > 0.2 ? 1 : 4);
  // (A snake lies along its way, not its heading.)
  const balls = m.trail ? capsules.filter((c) => c.part.startsWith("body.")).filter((_, i) => i % 2 === 0).map((c) => c.a) : body.centres;
  return { balls, r: body.r * 0.8, weight, side: m.frame.x, own: ownWood(m.segment, stage) };
}

/**
 * How far a body leans to go round the deepest limb in its way that isn't one it is on. A function of where it is now,
 * so it swings round the wood and back.
 */
export function clearOfLimbs(print: WoodPrint, map: WoodMap): Vec {
  const own = new Set((print.own ?? []).map(woodKey));
  const keep = print.r * 0.85;
  let lean: Vec = [0, 0, 0];
  let deepest = 0;
  for (const ball of print.balls) for (const { a, b, keys } of woodNear(map, ball, keep + map.thickest)) {
    // (A branch forking off its own is one it touches: it goes round the rest, and on that one only stays out of it.)
    const gap = (own.has(keys[0]) || own.has(keys[1]) ? 0 : keep) - offWood(ball, a, b);
    if (gap <= deepest) continue;
    const ab = sub(b.p, a.p);
    const k = clamp(dot(sub(ball, a.p), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
    deepest = gap;
    lean = scale(unit(sub(ball, madd(a.p, ab, k)), print.side), gap);
  }
  return lean;
}

/** What `Herd.clipping` found: bodies through wood not their own, and pairs of bodies through each other. */
export interface Clipping { readonly wood: readonly string[]; readonly bodies: readonly (readonly [string, string])[] }

/** Points down the thick of a body, each with its radius. */
function bodyCores(body: Body): { p: Vec; r: number }[] {
  const thick = body.capsules.filter((c) => c.decal !== true && c.carve !== true);
  const most = thick.reduce((high, c) => Math.max(high, c.r), 0);
  return thick
    .filter((c) => c.r >= most * 0.6)
    .flatMap((c) => [0, 0.25, 0.5, 0.75, 1].map((k) => ({ p: lerpV(c.a, c.b, k), r: c.r })));
}

function inWood(cores: readonly { p: Vec; r: number }[], own: ReadonlySet<string>, map: WoodMap): boolean {
  return cores.some(({ p, r }) =>
    woodNear(map, p, r * 0.55 + map.thickest).some(
      ({ a, b, keys }) =>
        !own.has(keys[0]) && !own.has(keys[1]) && offWood(p, a, b) + mix(a.r, b.r, 0.5) * 0.7 < r * 0.55,
    ),
  );
}

const inOther = (a: readonly { p: Vec; r: number }[], b: readonly { p: Vec; r: number }[]): boolean =>
  a.some((x) => b.some((y) => length(sub(x.p, y.p)) < 0.6 * (x.r + y.r)));

/** Reads a frame for what really passes through what, knowing each animal's own way over the wood. */
export function clippingOf(frame: readonly { body: Body; own: readonly Wood[] }[], map: WoodMap): Clipping {
  const cores = frame.map(({ body }) => bodyCores(body));
  const wood = frame
    .filter(({ own }, i) => inWood(cores[i] ?? [], new Set(own.map(woodKey)), map))
    .map(({ body }) => body.id);
  const bodies: (readonly [string, string])[] = [];
  frame.forEach(({ body }, i) => {
    for (let j = i + 1; j < frame.length; j += 1) {
      const other = frame[j];
      if (other && inOther(cores[i] ?? [], cores[j] ?? [])) bodies.push([body.id, other.body.id]);
    }
  });
  return { wood, bodies };
}

/**
 * How far each body in the tree leans clear of the others. Two meeting on a
 * limb each keep to their own right, so they swing round each other as they
 * pass and never pop through; a function of where they are now, like `shoveApart`.
 */
export function passOnWood(prints: readonly (WoodPrint | null)[]): Vec[] {
  const lean = prints.map((): Vec => [0, 0, 0]);
  const pair = (i: number, j: number): void => {
    const [a, b] = [prints[i], prints[j]];
    if (!a || !b) return;
    for (const pa of a.balls) for (const pb of b.balls) {
      const d = add(sub(pa, pb), sub(lean[i] ?? [0, 0, 0], lean[j] ?? [0, 0, 0]));
      const gap = a.r + b.r - length(d);
      if (gap <= 0) continue;
      const out = unit(add(unit(d, a.side), scale(sub(a.side, b.side), 0.5)), a.side);
      const share = b.weight / (a.weight + b.weight);
      lean[i] = madd(lean[i] ?? [0, 0, 0], out, gap * share);
      lean[j] = madd(lean[j] ?? [0, 0, 0], out, -gap * (1 - share));
    }
  };
  for (let pass = 0; pass < SHOVE_PASSES; pass += 1) {
    for (let i = 0; i < prints.length; i += 1) for (let j = i + 1; j < prints.length; j += 1) pair(i, j);
  }
  return lean;
}

/** The trunk at the ground, as a footprint nothing can move. */
function treePrint(stage: Stage): Footprint | null {
  const trunk = stage.trunk;
  if (!trunk) return null;
  const { p, r } = trunkAxis(trunk, 0);
  return { rings: [{ x: p[0], z: p[2], r }], weight: ROOTED, team: -1, self: -1, faces: -1 };
}

/** A whole posed body moved along the ground. */
function shoved(m: Moment, capsules: Capsule[], by: Vec): { m: Moment; capsules: Capsule[] } {
  if (by[0] === 0 && by[1] === 0 && by[2] === 0) return { m, capsules };
  return {
    m: { ...m, frame: { ...m.frame, o: add(m.frame.o, by) } },
    capsules: capsules.map((c) => ({ ...c, a: add(c.a, by), b: add(c.b, by) })),
  };
}

/** A shove along the ground, over its rises and dips. */
function overGround(stage: Stage, { frame: { o } }: Moment, [x, z]: readonly [number, number]): Vec {
  return x === 0 && z === 0 ? [0, 0, 0] : [x, groundY(stage, o[0] + x, o[2] + z) - groundY(stage, o[0], o[2]), z];
}

export interface Posed {
  readonly id: string;
  readonly actor: Actor;
  readonly m: Moment;
  readonly capsules: Capsule[];
  readonly scene: Scene;
}

/** Everyone as posed, pushed clear of each other and made into bodies. */
export function settledBodies(posed: readonly Posed[], prints: readonly (Footprint | null)[]): Body[] {
  const shoves = shoveApart([...prints, ...posed.slice(0, 1).map(({ scene }) => treePrint(scene.stage))]);
  const stage = posed[0]?.scene.stage;
  const limbs = stage ? woodMapOf(stage) : { edges: [], cells: new Map<number, number[]>(), thickest: 0 };
  const woodPrints = posed.map(({ actor, m, capsules, scene }) => woodPrintOf(actor, m, capsules, scene.stage));
  const leans = passOnWood(woodPrints);
  return posed.map(({ id, actor, m, capsules, scene }, i) => {
    const print = woodPrints[i];
    const lean = add(leans[i] ?? [0, 0, 0], print ? clearOfLimbs(print, limbs) : [0, 0, 0]);
    const moved = shoved(m, capsules, add(overGround(scene.stage, m, shoves[i] ?? [0, 0]), lean));
    actor.pos = moved.m.frame.o;
    return bodyOf(id, actor, moved.m, { capsules: moved.capsules, scene });
  });
}
