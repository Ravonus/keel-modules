// The director: each actor's next segment, routed over ground and wood, to food, a perch, a bug or a rest.

import { TAU, clamp, length, sub } from "../vec.js";
import type { Vec } from "../vec.js";
import { between, createRandom } from "../roll.js";
import { HOPPERS, MOVES, speciesOf } from "../roster.js";
import type { Action, SpeciesId, SpeciesSpec } from "../roster.js";
import { GROUNDED, SPAN, matrixOf, nextAction } from "./idle.js";
import type { IdleMatrix, Mood } from "./idle.js";
import { APPETITE, FRUIT_EATERS, anchorOf, groundSpot, perchOf, trunkClear } from "./stage.js";
import type { Anchor, Food, Perch, Place, Spot, Stage } from "./stage.js";
import { alongPath, branchWay, climbPath, crownOf, flutterPath, flyPath, pathLength, sameLimb, sortiePath, walkPath, woodKey } from "./paths.js";
import type { Loop, PathPoint } from "./paths.js";
import { liesAlong } from "./moments.js";
import type { Capsule } from "./moments.js";
import { memberOf } from "../casting.js";
import type { CastGroup, CastMember } from "../casting.js";
import { poseSpecies } from "../animals/bodies.js";
import type { Who } from "../animals/bodies.js";
import { perchCount, perchFits, perchFree, perchRoom, randomPerch } from "./perches.js";

// ---------------------------------------------------------------- the director

export type MoveMode = "walk" | "fly" | "climb";

export interface Segment {
  readonly act: Action;
  readonly t0: number;
  readonly t1: number;
  readonly from: Place;
  readonly to: Place;
  /** Heading while it stays put. */
  readonly yaw: number;
  /** The troupe member it turns to face (-1: none). */
  readonly face: number;
  readonly mode: MoveMode | null;
  /** Gait speed, in sizes a second (0 when it stays put). */
  readonly pace: number;
  /** The perches it goes by on a route over the wood (see `searchRoute`). */
  readonly via?: readonly number[];
  /** The heading it turns from as it settles, when that is not `yaw`. */
  readonly turn?: number;
  /** The food it eats while it stays (a `Food.key`). */
  readonly meal?: string;
  /** A flight's shape beyond its ends: out round the tree, or a flutter. */
  readonly loop?: Loop;
}

export interface Actor {
  readonly index: number;
  readonly member: CastMember;
  readonly spec: SpeciesSpec;
  readonly rand: () => number;
  readonly day: IdleMatrix;
  readonly night: IdleMatrix;
  /** Its matrices for the other moods of the sky and the hour (rain, snow, dawn and dusk), made as they come up. */
  readonly moods: Map<string, IdleMatrix>;
  readonly segments: Segment[];
  until: number;
  place: Place;
  yaw: number;
  last: Action;
  /** Where it was last frame (for others turning to face it). */
  pos: Vec;
  /** The top of its back last frame: where a rider sits. */
  back: Anchor | null;
  /** Its troupe, itself included, to keep out of each other's way. */
  mates: readonly Actor[];
  /**
   * Which share of the tree's limbs is its troupe's, of how many, so troupes keep to their own without watching each
   * other.
   */
  limbs: readonly [number, number];
  /** The whole herd's meals, so no fruit is eaten twice. */
  readonly pantry: Pantry;
}

/** Fruit claimed for eating, by key: when the meal ends and who eats it. */
export type Pantry = Map<string, { readonly t: number; readonly by: Actor }>;

/** Where the rest of its troupe stands or is headed on the ground. */
export const takenBy = (actor: Actor, scene: Scene): Spot[] =>
  actor.mates.filter((mate) => mate !== actor && mate.place.on === "ground").map((mate) => ({ p: placeTop(mate.place, scene), size: mate.member.size }));

export interface Troupe {
  readonly kind: CastGroup["kind"];
  readonly actors: Actor[];
  readonly rand: () => number;
  readonly cohesion: number;
}

export interface Scene { readonly stage: Stage; readonly backs: readonly (Anchor | null)[] }

const tempo = (actor: Actor): number => (actor.spec.speed < 0.5 ? 1.8 : 1);
export const placeTop = (place: Place, scene: Scene): Vec => anchorOf(place, scene.stage, scene.backs).p;

/** Which way an actor faces as it stays: a troupe member to turn to, a heading, and the heading it turns from. */
export interface Facing { readonly face?: number; readonly yaw?: number; readonly turn?: number | undefined }

export function stay(actor: Actor, act: Action, duration: number, facing?: Facing): void {
  const { face = -1, yaw = actor.yaw, turn } = facing ?? {};
  const t0 = actor.until;
  actor.segments.push({
    act,
    t0,
    t1: t0 + duration,
    from: actor.place,
    to: actor.place,
    yaw,
    face,
    mode: null,
    pace: 0,
    ...(turn === undefined ? {} : { turn }),
  });
  actor.until = t0 + duration;
  actor.last = act;
}

function modeFor(actor: Actor, act: Action, from: Place, to: Place): MoveMode {
  if (actor.spec.flies && (act === "fly" || actor.spec.plan === "bug")) return "fly";
  if (actor.spec.flies && (from.on !== "ground" || to.on !== "ground")) return "fly";
  if (from.on !== "ground" || to.on !== "ground") return "climb";
  return "walk";
}

const HOP_REACH = 1.4;
const HOP_COST = 1.6;
/** Going over wood it wouldn't sit on: thinner will do, for a step. */
const PASS_OVER = 0.05;
const CROWD_COST = 6;
/** Past this many perches a route isn't worth searching for: the way by the trunk is good enough. */
const MOST_ROUTED = 240;

/** A step between two perches: along their limb when they share one, else a hop across the air. */
function routeStep(from: Place, to: Place, stage: Stage): PathPoint[] {
  const [a, b] = [anchorOf(from, stage, []), anchorOf(to, stage, [])];
  const fork = sameLimb(branchWay(from, stage), branchWay(to, stage));
  return [{ p: a.p, up: a.up }, ...(fork ?? []), { p: b.p, up: b.up }];
}

/** A climber's way by the perches of its route. */
function routePath(from: Place, to: Place, via: readonly number[], stage: Stage): PathPoint[] {
  const stops: Place[] = [from, ...via.map((i): Place => ({ on: "perch", i })), to];
  return stops.slice(1).flatMap((stop, k) => routeStep(stops[k] ?? stop, stop, stage));
}

/** What a step between two perches costs a climber: none it can't take. */
function stepCost(a: Perch, b: Perch, size: number): number {
  const d = length(sub(a.p, b.p));
  const key = (perch: Perch): string | null => {
    const root = perch.path?.[1];
    return root ? woodKey(root) : null;
  };
  if (key(a) !== null && key(a) === key(b)) return d;
  return d <= size * HOP_REACH ? d * HOP_COST : Infinity;
}

/** The cheapest perch not yet settled. */
function nearestOpen(costs: readonly number[], settled: ReadonlySet<number>): number {
  let best = -1;
  costs.forEach((cost, i) => {
    if (!settled.has(i) && cost < Infinity && (best < 0 || cost < (costs[best] ?? Infinity))) best = i;
  });
  return best;
}

/**
 * The cheapest way over the perches from one to another (Dijkstra, the wood
 * being a graph), mates' places dear, or null when none joins them. Searched
 * once, when the trip is planned, and kept with it: the trip is the same at any
 * frame rate, and only its own troupe's places bear on it.
 */
export function searchRoute(
  stage: Stage,
  start: number,
  goal: number,
  size: number,
  crowd: (i: number) => number,
): { via: number[]; cost: number } | null {
  const list = stage.perches ?? [];
  const costs = list.map((): number => Infinity);
  const before = list.map((): number => -1);
  const settled = new Set<number>();
  costs[start] = 0;
  for (let at = start; at >= 0 && at !== goal; at = nearestOpen(costs, settled)) {
    settled.add(at);
    const from = list[at];
    const reached = costs[at] ?? 0;
    list.forEach((next, i) => {
      if (!from || settled.has(i) || (i !== goal && next.r < size * PASS_OVER)) return;
      const cost = reached + stepCost(from, next, size) + crowd(i);
      if (cost < (costs[i] ?? Infinity)) {
        costs[i] = cost;
        before[i] = at;
      }
    });
  }
  if ((costs[goal] ?? Infinity) === Infinity) return null;
  const via: number[] = [];
  for (let i = before[goal] ?? -1; i >= 0 && i !== start; i = before[i] ?? -1) via.unshift(i);
  return { via, cost: costs[goal] ?? Infinity };
}

/** Where a climber goes by on its way between two branches, when that beats going round by the trunk. */
function routeVia(actor: Actor, from: Place, to: Place, scene: Scene): readonly number[] | undefined {
  const { stage } = scene;
  const count = stage.perches?.length ?? 0;
  if (from.on !== "perch" || to.on !== "perch" || count === 0 || count > MOST_ROUTED) return undefined;
  const wrap = (i: number): number => ((i % count) + count) % count;
  const size = actor.member.size;
  const crowd = (i: number): number => (perchFree(actor, scene, i) ? 0 : size * CROWD_COST);
  const found = searchRoute(stage, wrap(from.i), wrap(to.i), size, crowd);
  if (!found || found.via.length === 0) return undefined;
  const byTrunk = pathLength(
    climbPath({ from, to, a: anchorOf(from, stage, []), b: anchorOf(to, stage, []) }, stage, size),
  );
  return found.cost < byTrunk ? found.via : undefined;
}

/** A trip: how it is made, from where to where, a flight's loop and a climb's route (as a segment carries them). */
export interface Trip {
  readonly mode: MoveMode;
  readonly from: Place;
  readonly to: Place;
  readonly loop?: Loop | undefined;
  readonly via?: readonly number[] | undefined;
}

export function pathFor(trip: Trip, scene: Scene, size: number, spring = 0): PathPoint[] {
  const { mode, from, to, loop, via } = trip;
  const a = anchorOf(from, scene.stage, scene.backs);
  const b = anchorOf(to, scene.stage, scene.backs);
  const onWood = to.on === "perch" || to.on === "trunk";
  if (mode === "fly" && loop?.kind === "sortie") return sortiePath(a, b, scene.stage, { size, loop, fromWood: from.on !== "ground", onWood });
  if (mode === "fly" && loop?.kind === "flutter") return flutterPath(a, b, scene.stage, { size, loop });
  if (mode === "fly") return flyPath(a, b, scene.stage, { size, onWood });
  if (mode === "climb") return via ? routePath(from, to, via, scene.stage) : climbPath({ from, to, a, b }, scene.stage, size);
  return walkPath(a, b, scene.stage, { size, spring });
}

/** How readily an animal hops what is in its way: birds and hoppers spring, small things skip, big ones step. */
export function springOf(who: Who): number {
  if (who.spec.plan === "bird") return 1;
  if (HOPPERS.has(who.member.species)) return 0.8;
  if (who.spec.plan === "bug" || who.spec.plan === "serpent") return 0;
  return who.member.size < 0.35 ? 0.5 : 0;
}

export const PACE: Partial<Record<Action, number>> = { run: 3.2, hop: 1.4, fly: 4, climb: 0.8, stalk: 0.35 };

/**
 * How a trip is made: the action it is, how hurried (1 is its own pace), a flight's loop, and a set speed (scene units
 * a second) when it has one.
 */
export interface Going {
  readonly act: Action;
  readonly hurry?: number;
  readonly loop?: Loop | undefined;
  readonly speed?: number;
}

/** Go somewhere: a move segment whose length (and so its time) comes from the path. */
export function travel(actor: Actor, wanted: Place, scene: Scene, going: Going): void {
  const { act, hurry = 1 } = going;
  const to = seatFor(actor, wanted, scene);
  const foot = act === "climb" ? trunkSide(actor, to, scene) : null;
  if (foot && actor.place.on === "ground") {
    leg(actor, foot, scene, { act: "wander", hurry });
    leg(actor, to, scene, { act, hurry });
  } else if (foot) {
    leg(actor, foot, scene, { act, hurry });
    leg(actor, to, scene, { act: "wander", hurry });
  } else {
    leg(actor, to, scene, { act, hurry });
  }
}

/**
 * Where a climber steps onto or off the trunk, when it climbs between the
 * tree and a spot on the ground away from it: it walks that part on its feet.
 */
/** Whichever of two places is on the ground, the first before the second, or null when neither is. */
function groundOf(a: Place, b: Place): Extract<Place, { on: "ground" }> | null {
  if (a.on === "ground") return a;
  return b.on === "ground" ? b : null;
}

function trunkSide(actor: Actor, to: Place, scene: Scene): Place | null {
  const ground = groundOf(actor.place, to);
  if (!ground || !scene.stage.trunk || (actor.place.on === "ground") === (to.on === "ground")) return null;
  const base = scene.stage.trunk.base;
  const dx = ground.x - base[0];
  const dz = ground.z - base[2];
  const d = Math.hypot(dx, dz);
  const near = trunkClear(scene.stage, actor.member.size);
  if (d < near + actor.member.size * 0.8) return null;
  return { on: "ground", x: base[0] + (dx / d) * near, z: base[2] + (dz / d) * near };
}

/** `loop` shapes a flight (a sortie round the tree); `speed` (scene units a second) then sets its pace. */
/**
 * Where a trip really ends: every way an animal is sent to a perch comes through
 * here, so birds and snakes never settle on one taken or too tight for them. They
 * take the next that fits, or the ground. (Those that groom sit close on purpose.)
 */
function seatFor(actor: Actor, to: Place, scene: Scene): Place {
  if (to.on !== "perch" || !(liesAlong(actor) || actor.spec.plan === "bird")) return to;
  const count = perchCount(scene);
  for (let k = 0; k < count; k += 1) if (perchFits(actor, scene.stage, to.i + k) && perchFree(actor, scene, to.i + k)) return { on: "perch", i: to.i + k };
  return groundSpot(actor.rand, scene.stage, actor.member.size, { taken: takenBy(actor, scene) });
}

function paceOf(actor: Actor, mode: MoveMode, going: Going): number {
  const { act, hurry = 1, speed } = going;
  return speed !== undefined && mode === "fly" ? speed / actor.member.size : actor.spec.speed * (PACE[act] ?? 1) * hurry * (mode === "fly" ? 2.5 : 1);
}

export function leg(actor: Actor, there: Place, scene: Scene, going: Going): void {
  const { act, loop } = going;
  const to: Place = there.on === "ground" ? onGround(scene.stage, actor.member.size, there.x, there.z) : there;
  const mode = modeFor(actor, act, actor.place, to);
  // A bug never flies straight: it flutters, on its own seeded jinks and loops.
  const way = loop ?? (mode === "fly" && actor.spec.plan === "bug" ? flutterOf(actor, scene) : undefined);
  const via = mode === "climb" ? routeVia(actor, actor.place, to, scene) : undefined;
  const path = pathFor({ mode, from: actor.place, to, loop: way, via }, scene, actor.member.size, springOf(actor));
  const pace = paceOf(actor, mode, going);
  const duration = Math.max(0.5, pathLength(path) / Math.max(0.02, pace * actor.member.size));
  const end = alongPath(path, 1);
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to, yaw: actor.yaw, face: -1, mode, pace, ...(way && mode === "fly" ? { loop: way } : {}), ...(via ? { via } : {}) });
  actor.until = t0 + duration;
  actor.place = to;
  if (Math.hypot(end.fw[0], end.fw[2]) > 0.2) actor.yaw = Math.atan2(end.fw[0], end.fw[2]);
  actor.last = act;
}

/** Fliers that never sit in a tree: a crane stands on the ground, and comes and goes from the sky. */
export const GROUND_BIRDS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["crane"]);

/**
 * Where a bug goes next: a firefly keeps low over the grass, a butterfly
 * visits the crown's lower blossoms or drops to the flowers on the ground,
 * never the treetop.
 */
function bugSpot(actor: Actor, scene: Scene): Place {
  const stage = scene.stage;
  const firefly = actor.spec.build.extras.includes("glowtail");
  const crown = crownOf(stage);
  const near = placeTop(actor.place, scene);
  if (perchCount(scene) > 0 && actor.rand() < (firefly ? 0.15 : 0.5)) {
    const ceiling = firefly ? stage.top + 2.6 : crown.low + 1.5;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const i = Math.floor(actor.rand() * 9973);
      const perch = perchOf(stage, i);
      if (perch && perch.p[1] <= ceiling) return { on: "perch", i };
    }
  }
  return groundSpot(actor.rand, stage, actor.member.size, {
    near,
    reach: firefly ? 2.8 : 2.2,
    taken: takenBy(actor, scene),
  });
}

/** A bug's flutter, seeded: where its loop comes, and how high and far out it may go. */
function flutterOf(actor: Actor, scene: Scene): Loop {
  const crown = crownOf(scene.stage);
  const firefly = actor.spec.build.extras.includes("glowtail");
  return { kind: "flutter", seed: actor.rand(), loops: actor.rand() < (firefly ? 0.3 : 0.6) ? 1 + Math.floor(actor.rand() * 2) : 0, ceiling: firefly ? scene.stage.top + 2.4 : Math.min(crown.top, crown.low + 1.6), reach: crown.reach + 1 };
}

/**
 * How each bird goes out round the tree (see `sortie`): the share of its
 * flights that are sorties, how far past the crown it circles (scene
 * units), how many times round, at what height (a share of the way from the
 * ground to the crown's top), how much it climbs on the way, its speed
 * (units a second) and how much its circle wanders. An owl, now and then,
 * drops onto something on the ground instead and goes straight back up
 * (`pounce`). A crow wheels lazily and wide, a gull soars high, rising on its
 * loops; a songbird darts out a little way and back, a parrot fast; an owl
 * glides low and silent; a crane goes slowly round, well out.
 */
interface SortieStyle {
  readonly odds: number;
  readonly out: readonly [number, number];
  readonly laps: readonly [number, number];
  readonly height: readonly [number, number];
  readonly climb: number;
  readonly speed: number;
  readonly wobble: number;
  readonly pounce?: number;
}
const SORTIES: Partial<Record<SpeciesId, SortieStyle>> = {
  songbird: { odds: 0.6, out: [0.9, 1.8], laps: [0.3, 0.8], height: [0.35, 0.8], climb: 0.3, speed: 4.4, wobble: 0.12 },
  woodpecker: { odds: 0.4, out: [0.8, 1.6], laps: [0.25, 0.6], height: [0.3, 0.6], climb: 0, speed: 3.4, wobble: 0.1 },
  parrot: { odds: 0.65, out: [1, 2.2], laps: [0.6, 1.3], height: [0.5, 1], climb: 0.5, speed: 5, wobble: 0.15 },
  crow: { odds: 0.45, out: [1.2, 2.4], laps: [0.5, 1], height: [0.65, 1.05], climb: 0.6, speed: 3.3, wobble: 0.18 },
  gull: { odds: 0.65, out: [1.5, 2.4], laps: [0.7, 1.4], height: [0.8, 1.1], climb: 1.2, speed: 3.6, wobble: 0.1 },
  owl: {
    odds: 0.45,
    out: [0.6, 1.4],
    laps: [0.3, 0.7],
    height: [0.12, 0.3],
    climb: 0,
    speed: 2.5,
    wobble: 0.2,
    pounce: 0.45,
  },
  crane: { odds: 0.8, out: [1.3, 2.4], laps: [0.6, 1.1], height: [0.45, 0.8], climb: 0.8, speed: 2.5, wobble: 0.08 },
  // (A kookaburra, like a kingfisher, mostly watches from its branch and drops on what moves below.)
  kookaburra: {
    odds: 0.6,
    out: [0.8, 1.6],
    laps: [0.3, 0.7],
    height: [0.4, 0.7],
    climb: 0,
    speed: 3.8,
    wobble: 0.12,
    pounce: 0.6,
  },
};

/**
 * A flight out round the tree instead of to the next branch: off its perch
 * (or up off the ground), out past the crown, round on its own loops at its
 * own height, banking into the turn, and back in to a branch or the ground.
 * An owl may drop onto the ground and go straight back to its branch
 * instead. False when this flight is to be a plain one.
 */
export function sortie(actor: Actor, scene: Scene): boolean {
  const style = SORTIES[actor.member.species];
  const stage = scene.stage;
  if (!style || !stage.trunk || actor.rand() >= style.odds) return false;
  const rand = actor.rand;
  const size = actor.member.size;
  const home = actor.place;
  const ground = (): Place => groundSpot(rand, stage, size, { taken: takenBy(actor, scene) });
  if (style.pounce !== undefined && home.on === "perch" && rand() < style.pounce) {
    travel(actor, ground(), scene, { act: "fly" });
    stay(actor, "peck", between(rand, [0.8, 1.6]));
    travel(actor, home, scene, { act: "fly" });
    return true;
  }
  const crown = crownOf(stage);
  const to =
    GROUND_BIRDS.has(actor.member.species) || perchCount(scene) === 0 || rand() < 0.2
      ? ground()
      : randomPerch(actor, scene);
  // (Never so high it leaves the picture: a little over the treetop at most.)
  const h = clamp(
    stage.top + between(rand, style.height) * Math.max(1, crown.top - stage.top),
    stage.top + 0.8,
    crown.top + 1.2,
  );
  const loop: Loop = {
    kind: "sortie",
    R: Math.min(crown.reach + between(rand, style.out), crown.reach + 2.4),
    cap: crown.reach + 2.6,
    h,
    climb: Math.min(style.climb * between(rand, [0.5, 1]), Math.max(0, crown.top + 1.6 - h)),
    laps: between(rand, style.laps),
    dir: rand() < 0.5 ? -1 : 1,
    wobble: style.wobble,
    seed: rand(),
  };
  leg(actor, to, scene, { act: "fly", hurry: 1, loop, speed: style.speed * between(rand, [0.88, 1.12]) });
  return true;
}

/** Where a move action takes this animal from where it is. */
function destination(actor: Actor, act: Action, scene: Scene): Place | null {
  const size = actor.member.size;
  const up = actor.place.on !== "ground";
  const perches = perchCount(scene) > 0;
  const perchOr = (odds: number): Place =>
    perches && actor.rand() < odds
      ? randomPerch(actor, scene)
      : groundSpot(actor.rand, scene.stage, size, { taken: takenBy(actor, scene) });
  if (act === "climb") return perches ? perchOr(up ? 0.55 : 1) : null;
  if (actor.spec.plan === "bug") return bugSpot(actor, scene);
  if (act === "fly") return GROUND_BIRDS.has(actor.member.species) ? groundSpot(actor.rand, scene.stage, size, { taken: takenBy(actor, scene) }) : perchOr(0.55);
  if (up) return perchOr(actor.spec.climbs ? 0.5 : 0);
  return walkTo(actor, act, scene);
}

/**
 * Where a walk or a run on the ground goes. In rain or snow it keeps in under
 * the tree, near the trunk; a hunter or a grazer roams the lawn (a bold one
 * farther); the rest potter about where they are; a run crosses the ground.
 */
function walkTo(actor: Actor, act: Action, scene: Scene): Place {
  const { stage } = scene;
  const size = actor.member.size;
  if (moodOf(stage).weather !== undefined && stage.trunk && actor.rand() < 0.7) {
    return groundSpot(actor.rand, stage, size, {
      near: stage.trunk.base,
      reach: trunkClear(stage, size) + size * 2 + 0.4,
      taken: takenBy(actor, scene),
    });
  }
  const roam = (ROAMERS.has(actor.member.species) ? 2.2 : 1) * clamp(actor.member.traits.bold, 0.7, 1.4);
  const reach = act === "run" ? stage.radius : Math.max(size * 4, 0.8) * roam;
  return groundSpot(actor.rand, stage, size, {
    near: placeTop(actor.place, scene),
    reach,
    taken: takenBy(actor, scene),
  });
}

/** Ground animals that cover ground: they patrol the lawn's edge rather than shuffle about one spot. */
const ROAMERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["fox", "wolf", "deer", "cat", "bear", "raccoon", "tanuki", "badger", "skunk", "hedgehog", "dikdik", "mongoose", "kangaroo", "crab"]);

/** Get to where an action can be done: down from the tree, up to a branch, onto the trunk. */
function prepare(actor: Actor, act: Action, scene: Scene): Action {
  const size = actor.member.size;
  if (GROUNDED.has(act) && actor.place.on !== "ground") {
    travel(actor, groundSpot(actor.rand, scene.stage, size, { taken: takenBy(actor, scene) }), scene, { act: actor.spec.flies ? "fly" : "climb" });
    return act;
  }
  if (act === "hang") {
    if (perchCount(scene) === 0) return "sit";
    if (actor.place.on !== "perch") travel(actor, randomPerch(actor, scene), scene, { act: "climb" });
    return act;
  }
  if (act === "drum" && actor.place.on !== "trunk") {
    if (!scene.stage.trunk) return "look";
    travel(actor, { on: "trunk", h: 0.25 + actor.rand() * 0.5, a: actor.rand() * TAU }, scene, { act: "fly" });
  }
  return act;
}

/**
 * Whether an eater can get at a fruit: off a branch that takes its weight and has room for it, or off the ground, and
 * not already someone's.
 */
function canReach(actor: Actor, item: Food, scene: Scene, up: boolean): boolean {
  const reach = FRUIT_EATERS[actor.member.species];
  const size = actor.member.size;
  const perch = item.perch;
  if (perch === undefined ? reach === "tree" : !up || (perchOf(scene.stage, perch)?.r ?? 0) < size * 0.12 || !perchRoom(scene.stage, perch, size)) return false;
  return (actor.pantry.get(item.key)?.t ?? -Infinity) <= actor.until;
}

/** The fruit an eater goes for: the nearest it can reach that no one else has claimed, give or take. */
function pickFood(actor: Actor, scene: Scene): Food | null {
  const reach = FRUIT_EATERS[actor.member.species];
  const food = scene.stage.food ?? [];
  if (!reach || food.length === 0) return null;
  const up = reach !== "ground" && (actor.spec.climbs || actor.spec.flies) && perchCount(scene) > 0;
  const here = placeTop(actor.place, scene);
  let best: Food | null = null;
  let nearest = Infinity;
  for (const item of food) {
    if (!canReach(actor, item, scene, up)) continue;
    const d = length(sub(item.p, here)) * (0.75 + actor.rand() * 0.5);
    if (d < nearest) {
      nearest = d;
      best = item;
    }
  }
  return best;
}

/** How far ahead its mouth is, and how low, at its lowest in an eating pose, in units of its size. */
function lowestMouth(id: SpeciesId, act: Action): number {
  let low = Infinity;
  let reach = 0;
  const mouthy = (c: Capsule): boolean => /head|muzzle|snout|beak|jaw|mouth/.test(c.part);
  for (const t of [0.5, 1.5, 2.5, 3.5]) {
    for (const p of poseSpecies(id, act, t)
      .capsules.filter(mouthy)
      .flatMap((c) => [c.a, c.b]))
      if (p[1] < low) {
        low = p[1];
        reach = p[2];
      }
  }
  return reach / memberOf(createRandom(1), {}, { id, coat: speciesOf(id).coats[0]?.[0] ?? "", young: false }).size;
}

const MOUTHS = new Map<string, number>();
/** How far ahead of where it stands an animal's mouth comes down when it eats this way, read off its own pose. */
function mouthReach(actor: Actor, act: Action): number {
  const key = `${actor.member.species}.${act}`;
  let reach = MOUTHS.get(key);
  if (reach === undefined) {
    reach = lowestMouth(actor.member.species, act);
    MOUTHS.set(key, reach);
  }
  return reach * actor.member.size;
}

/**
 * Up to the branch a fruit hangs from, or over to where it lies, coming up from its own side to stop with its mouth
 * over it.
 */
function goToFood(actor: Actor, item: Food, act: Action, scene: Scene): void {
  if (item.perch !== undefined) {
    if (actor.place.on !== "perch" || actor.place.i !== item.perch) {
      // (Fruit is where it is: a bird goes to that very perch, taken or not.)
      if (actor.spec.flies) leg(actor, { on: "perch", i: item.perch }, scene, { act: "fly", hurry: 1 });
      else travel(actor, { on: "perch", i: item.perch }, scene, { act: "climb" });
    }
    return;
  }
  const size = actor.member.size;
  const from = placeTop(actor.place, scene);
  const side = Math.atan2(from[0] - item.p[0], from[2] - item.p[2]);
  const gap = Math.max(size * 0.15, mouthReach(actor, act));
  const spot = onGround(scene.stage, size, item.p[0] + Math.sin(side) * gap, item.p[2] + Math.cos(side) * gap);
  travel(actor, spot, scene, { act: groundMove(actor, spot, scene) });
}

/**
 * Go and eat a fruit, now and then, when there is one in reach and it is the
 * animal's waking hours: up to the branch it hangs from, or over to where it
 * lies, then a while eating it facing it. The meal goes in the pantry.
 */
/** Whether it is in a mood to eat: an eater, fruit about, its waking hours, and hungry just now. */
const hungry = (actor: Actor, scene: Scene): boolean =>
  FRUIT_EATERS[actor.member.species] !== undefined && (scene.stage.food?.length ?? 0) > 0
  && actor.spec.active !== (scene.stage.night === true ? "day" : "night") && actor.rand() < APPETITE;
/** How it eats: a bird pecks, a primate (or anything with hands) eats sitting up, the rest graze it off the ground. */
function mealAct(actor: Actor): Action {
  if (actor.spec.plan === "bird") return "peck";
  return actor.spec.plan === "primate" || can(actor, "eat") ? "eat" : "graze";
}

function forage(actor: Actor, scene: Scene): boolean {
  if (!hungry(actor, scene)) return false;
  const item = pickFood(actor, scene);
  if (!item) return false;
  const act = mealAct(actor);
  goToFood(actor, item, act, scene);
  stay(actor, act, between(actor.rand, [3, 7]) * tempo(actor), {
    face: -1,
    yaw: yawFrom(placeTop(actor.place, scene), item.p),
  });
  const last = actor.segments.length - 1;
  const segment = actor.segments[last];
  if (segment) actor.segments[last] = { ...segment, meal: item.key };
  actor.pantry.set(item.key, { t: actor.until, by: actor });
  return true;
}

/** One link of an animal's own chain of idle actions. */
export function soloStep(actor: Actor, scene: Scene): void {
  if (forage(actor, scene)) return;
  const act = nextAction(moodMatrix(actor, scene), actor.last, actor.rand);
  if (MOVES.has(act)) {
    if (act === "fly" && actor.spec.plan === "bird" && sortie(actor, scene)) return;
    const to = destination(actor, act, scene);
    if (to) {
      travel(actor, to, scene, {
        act:
          to.on === "ground" && actor.place.on === "ground" && actor.spec.plan === "bird"
            ? groundMove(actor, to, scene)
            : act,
      });
      return;
    }
    stay(actor, "look", between(actor.rand, SPAN.look));
    return;
  }
  if (trunkVisit(actor, act, scene)) return;
  const ready = prepare(actor, act, scene);
  stay(actor, ready, between(actor.rand, SPAN[ready]) * tempo(actor));
}

/** The sky's and the hour's mood on a stage: night, the weather, and whether the sun is near the horizon. */
export const moodOf = (stage: Stage): Mood => ({ night: stage.night === true, weather: stage.weather === "rain" || stage.weather === "snow" ? stage.weather : undefined, twilight: stage.sun !== undefined && Math.abs(stage.sun) < 7 });

/** The animal's own idle matrix for this moment's mood. */
function moodMatrix(actor: Actor, scene: Scene): IdleMatrix {
  const mood = moodOf(scene.stage);
  if (mood.weather === undefined && mood.twilight !== true) return mood.night === true ? actor.night : actor.day;
  const key = `${mood.night === true ? "n" : "d"}${mood.weather ?? ""}${mood.twilight === true ? "t" : ""}`;
  let matrix = actor.moods.get(key);
  if (!matrix) {
    matrix = matrixOf(actor.spec, mood);
    actor.moods.set(key, matrix);
  }
  return matrix;
}

/**
 * A ground animal goes over to the tree now and then: to sniff round its
 * foot, or (a bear) to turn its back on the bark and scratch. It is seen
 * crossing the lawn, and it comes out of the roots to do it.
 */
function trunkVisit(actor: Actor, act: Action, scene: Scene): boolean {
  const trunk = scene.stage.trunk;
  if (!trunk || actor.spec.plan !== "quad" || actor.place.on !== "ground" || (act !== "sniff" && act !== "scratch") || actor.rand() > 0.35) return false;
  const size = actor.member.size;
  const here = placeTop(actor.place, scene);
  const side = Math.atan2(here[2] - trunk.base[2], here[0] - trunk.base[0]) + (actor.rand() - 0.5) * 1.2;
  const near = trunkClear(scene.stage, size) + size * 0.05;
  const spot: Place = { on: "ground", x: trunk.base[0] + Math.cos(side) * near, z: trunk.base[2] + Math.sin(side) * near };
  travel(actor, spot, scene, { act: groundMove(actor, spot, scene) });
  const toward = yawFrom(placeTop(actor.place, scene), trunk.base);
  stay(actor, act, between(actor.rand, SPAN[act]) * tempo(actor), { face: -1, yaw: act === "scratch" && actor.member.species === "bear" ? toward + Math.PI : toward });
  return true;
}

/** Hold the troupe members still (looking about, or resting) until `time`. */
export function waitUntil(actors: readonly Actor[], time: number): void {
  for (const actor of actors) {
    if (actor.until < time - 0.05) stay(actor, actor.last === "lie" || actor.last === "sleep" ? "lie" : "look", time - actor.until);
  }
}

/** Bring members down out of the tree for a scene on the ground. */
export function toGround(actors: readonly Actor[], scene: Scene): void {
  for (const actor of actors) {
    if (actor.place.on !== "ground") travel(actor, groundSpot(actor.rand, scene.stage, actor.member.size, { taken: takenBy(actor, scene) }), scene, { act: actor.spec.flies ? "fly" : "climb" });
  }
}

export const placeBeside = (target: Vec, yaw: number, side: number, gap: number): Place => ({ on: "ground", x: target[0] + Math.cos(yaw) * side * gap, z: target[2] - Math.sin(yaw) * side * gap });
export const yawFrom = (a: Vec, b: Vec): number => Math.atan2(b[0] - a[0], b[2] - a[2]);


export const can = (actor: Actor, act: Action): boolean => actor.day.actions.includes(act);

/** A ground spot kept on the walkable ring, clear of the trunk. */
export function onGround(stage: Stage, size: number, x: number, z: number): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.05, stage.radius - size * 0.8);
  const d = Math.hypot(x, z);
  const k = d < 1e-6 ? 0 : clamp(d, inner, outer) / d;
  return d < 1e-6 ? { on: "ground", x: inner, z: 0 } : { on: "ground", x: x * k, z: z * k };
}

/** How an animal crosses to a spot on the ground: down out of the tree, a hop or a flight, a walk or a run. */
export function groundMove(actor: Actor, place: Place, scene: Scene): Action {
  const { spec } = actor;
  if (actor.place.on !== "ground") return spec.flies ? "fly" : "climb";
  const span = length(sub(placeTop(place, scene), placeTop(actor.place, scene)));
  if (spec.plan === "bug") return "fly";
  if (spec.plan === "bird") return birdGait(actor, span, scene.stage.radius);
  return span > scene.stage.radius * 0.6 && can(actor, "run") ? "run" : "wander";
}

/**
 * How a bird crosses the ground: a step or two it walks, a little way it
 * mostly hops (a big bird walks it), and anything farther it flies.
 */
function birdGait(actor: Actor, span: number, radius: number): Action {
  // (By its true size: a toy-scaled crow still flies across the grove.)
  const size = actor.member.heft;
  if (actor.spec.flies && span > Math.max(size * 9, radius * 0.45)) return "fly";
  if (span < size * 2.5 || size > 0.45) return "wander";
  return actor.rand() < 0.7 ? "hop" : "wander";
}
