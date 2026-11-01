// The herd: the cast alive on the stage frame by frame, taking orders, and a tap that picks one animal out.

import { TAU, clamp, dot, length, madd, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { between, streamOf } from "../roll.js";
import { speciesOf } from "../roster.js";
import type { SpeciesId } from "../roster.js";
import { matrixOf } from "./idle.js";
import { anchorOf, groundSpot } from "./stage.js";
import type { Place, Spot, Stage } from "./stage.js";
import { pathLength, woodMapOf } from "./paths.js";
import type { Loop } from "./paths.js";
import {
  GROUND_BIRDS, groundMove, onGround, pathFor, perchCount, perchFits, perchFree, randomPerch, roomyPerch, stay,
  travel,
} from "./director.js";
import type { Actor, Pantry, Scene, Troupe } from "./director.js";
import { extend } from "./scenes.js";
import { frameYaw, momentOf, movingFrame } from "./moments.js";
import { memberOf, specOf } from "../casting.js";
import type { Cast, CastGroup, CastMember, SkyNow } from "../casting.js";
import { backOf, poseWho } from "../animals/bodies.js";
import type { Body, Who } from "../animals/bodies.js";
import {
  FLY_SEGMENT, SKY_AT_ONCE, fading, flockBodies, nextTraffic, passOf, passesUntil, planeBody, swarmBodies,
} from "./sky.js";
import type { Pass } from "./sky.js";
import { clippingOf, footprintOf, ownWood, settledBodies } from "./collision.js";
import type { Clipping, Footprint, Posed } from "./collision.js";

// ---------------------------------------------------------------- the herd

export interface Herd {
  readonly cast: Cast;
  /** Every resident animal posed at `t` seconds, on this frame's stage. */
  at(t: number, stage: Stage): Body[];
  /** What the last `at` left passing through what, for testing a scene: it reads each animal's own route, so a branch it walks never counts. */
  clipping(): Clipping;
  /** What is passing over at `t`: birds, bats, craft, lights; `now` says what the sky is like, so what comes fits it. */
  sky(t: number, now?: SkyNow): Body[];
  /**
   * Send animals somewhere from `t`: one by its body `id`, or everyone. They
   * drop what they are doing, go there their own way (walk, run, climb, fly)
   * and look about before carrying on. Returns the ids that went.
   */
  command(t: number, order: Order, stage: Stage): string[];
  /** The food eaten by `t`, each key reported once: take it out of the scene (tree-render's `eat`). */
  eaten(t: number): string[];
}

/** Where to send animals: a spot on the ground or a branch, for one animal (`id`) or all of them. */
export interface Order {
  readonly id?: string | undefined;
  readonly to: { readonly on: "ground"; readonly x: number; readonly z: number } | { readonly on: "perch"; readonly i: number };
}

/** Whether an animal starts the scene up in the tree: the hangers, koalas and owls mostly do, other climbers and fliers now and then. */
function startsUp(member: CastMember, stage: Stage, rand: () => number): boolean {
  const kind = speciesOf(member.species);
  if (!(kind.climbs || kind.flies) || kind.plan === "bug" || GROUND_BIRDS.has(member.species) || (stage.perches?.length ?? 0) === 0) return false;
  return rand() < (kind.temper.hang !== undefined || member.species === "koala" || member.species === "owl" || member.species === "loris" ? 0.85 : 0.3);
}

function actorOf(member: CastMember, index: number, seed: number, centre: Place, stage: Stage, taken: readonly Spot[], pantry: Pantry): Actor {
  const rand = streamOf(seed, `fauna.actor.${index}.${member.species}`);
  const spec = specOf(member);
  const near = anchorOf(centre, stage, []).p;
  const place: Place = startsUp(member, stage, rand) ? { on: "perch", i: Math.floor(rand() * 9973) } : groundSpot(rand, stage, member.size, near, member.size * 3 + 0.3, taken);
  const actor: Actor = { index, member, spec, rand, day: matrixOf(spec, {}), night: matrixOf(spec, { night: true }), moods: new Map(), segments: [], until: 0, place, limbs: [0, 1], yaw: rand() * TAU, last: "stand", pos: anchorOf(place, stage, []).p, back: null, mates: [], pantry };
  stay(actor, spec.plan === "bug" ? "hover" : "stand", 0.3 + rand() * 1.5);
  return actor;
}

const COHESION: Readonly<Record<CastGroup["kind"], number>> = { solo: 0, pair: 0.22, family: 0.26, pack: 0.24, mixed: 0.3 };

function troupesOf(cast: Cast, stage: Stage, pantry: Pantry): Troupe[] {
  return cast.groups.map((group, g) => {
    const rand = streamOf(cast.seed, `fauna.troupe.${g}`);
    const first = group.members[0];
    const centre = groundSpot(rand, stage, first?.size ?? 0.3);
    const actors: Actor[] = [];
    group.members.forEach((member, i) => {
      const taken = actors.filter((actor) => actor.place.on === "ground").map((actor) => ({ p: anchorOf(actor.place, stage, []).p, size: actor.member.size }));
      actors.push(actorOf(member, i, cast.seed + g * 101, centre, stage, taken, pantry));
    });
    const scene: Scene = { stage, backs: [] };
    for (const actor of actors) {
      actor.mates = actors;
      actor.limbs = [g, cast.groups.length];
    }
    // (Dropped in at random to begin with: any that landed on another moves along.)
    for (const actor of actors) if (actor.place.on === "perch" && !(perchFree(actor, scene, actor.place.i) && perchFits(actor, stage, actor.place.i))) actor.place = randomPerch(actor, scene);
    return { kind: group.kind, actors, rand, cohesion: COHESION[group.kind] };
  });
}

function prune(actor: Actor, t: number): void {
  let drop = 0;
  while (drop < actor.segments.length - 2 && (actor.segments[drop]?.t1 ?? t) < t - 3) drop += 1;
  if (drop > 0) actor.segments.splice(0, drop);
}

/**
 * Stop an animal at `t` so it can be sent somewhere new: a rest ends now, a
 * walk ends where it has got to, and a climb or flight (it cannot let go of a
 * trunk or stop in the air) runs out first. Everything planned after is dropped.
 */
function interrupt(actor: Actor, t: number, scene: Scene): void {
  // A meal it has not finished is left for someone else.
  for (const [key, meal] of actor.pantry) if (meal.by === actor && meal.t > t) actor.pantry.delete(key);
  const list = actor.segments;
  let index = list.length - 1;
  while (index > 0 && (list[index]?.t0 ?? 0) > t) index -= 1;
  const segment = list[index];
  if (!segment) return;
  list.length = index + 1;
  // A climb or a flight runs out first (though a bird on a sortie cuts it short).
  if (!stopHere(actor, index, t, scene)) recall(actor, index, t, scene);
  actor.last = segment.act;
}

/** End a rest or a walk at `t`, where the animal is; false when it cannot stop there. */
function stopHere(actor: Actor, index: number, t: number, scene: Scene): boolean {
  const list = actor.segments;
  const segment = list[index];
  if (!segment) return true;
  if (segment.mode === null) {
    const end = Math.max(segment.t0 + 0.05, Math.min(segment.t1, t));
    list[index] = { ...segment, t1: end };
    actor.until = end;
    actor.place = segment.to;
    return true;
  }
  if (segment.mode !== "walk" || t >= segment.t1) return false;
  const here = movingFrame(actor, segment, t, scene).frame.o;
  const to: Place = { on: "ground", x: here[0], z: here[2] };
  const end = Math.max(segment.t0 + 0.05, t);
  list[index] = { ...segment, t1: end, to };
  actor.until = end;
  actor.place = to;
  return true;
}

/**
 * Where a climb or flight under way leaves an animal called away: at its
 * end, once it has run out. A bird out on a sortie is quicker: just off its
 * perch, it never goes; farther out, it cuts its loops short and comes the
 * short way round, from just where it is, to where it was going.
 */
function recall(actor: Actor, index: number, t: number, scene: Scene): void {
  const list = actor.segments;
  const segment = list[index];
  if (!segment) return;
  if (segment.loop?.kind !== "sortie" || t >= segment.t1 - 1.5) {
    actor.until = segment.t1;
    actor.place = segment.to;
    return;
  }
  if (t < segment.t0 + 0.4) {
    list[index] = { act: "look", t0: segment.t0, t1: segment.t0 + 0.05, from: segment.from, to: segment.from, yaw: segment.yaw, face: -1, mode: null, pace: 0 };
    actor.until = segment.t0 + 0.05;
    actor.place = segment.from;
    return;
  }
  const here = movingFrame(actor, segment, t, scene).frame;
  const loop: Loop = { ...segment.loop, laps: 0, start: here.o };
  const speed = pathLength(pathFor("fly", segment.from, segment.to, scene, actor.member.size, 1, segment.loop)) / Math.max(0.01, segment.t1 - segment.t0);
  const duration = Math.max(1.5, pathLength(pathFor("fly", segment.from, segment.to, scene, actor.member.size, 1, loop)) / Math.max(0.5, speed));
  list[index] = { ...segment, t1: t };
  list.push({ ...segment, t0: t, t1: t + duration, yaw: frameYaw(here), loop });
  actor.until = t + duration;
  actor.place = segment.to;
}


/** Go where told, the animal's own way, then look about. */
function obey(actor: Actor, to: Order["to"], scene: Scene, spot: number): void {
  const size = actor.member.size;
  const { spec } = actor;
  if (to.on === "perch" && perchCount(scene) > 0 && (spec.flies || spec.climbs) && !GROUND_BIRDS.has(actor.member.species)) {
    travel(actor, { on: "perch", i: roomyPerch(scene.stage, to.i + spot, size) }, spec.flies ? "fly" : "climb", scene);
  } else {
    // A branch it cannot climb: it comes to stand under it and looks up.
    const target = to.on === "perch" ? anchorOf({ on: "perch", i: to.i }, scene.stage, scene.backs).p : [to.x, 0, to.z] as Vec;
    const angle = spot * 2.4;
    const gap = spot === 0 ? 0 : size * 1.6 + 0.1;
    const place = onGround(scene.stage, size, target[0] + Math.cos(angle) * gap, target[2] + Math.sin(angle) * gap);
    travel(actor, place, groundMove(actor, place, scene), scene);
  }
  stay(actor, "look", 2 + actor.rand() * 1.5);
}

function commandTroupes(troupes: readonly Troupe[], t: number, order: Order, stage: Stage): string[] {
  const sent: string[] = [];
  troupes.forEach((troupe, g) => {
    const scene: Scene = { stage, backs: troupe.actors.map((actor) => actor.back) };
    for (const actor of troupe.actors) {
      const id = `${g}.${actor.index}`;
      if (order.id !== undefined && order.id !== id) continue;
      if (actor.spec.active === "night" && actor.spec.plan === "bug" && stage.night !== true) continue;
      interrupt(actor, t, scene);
      obey(actor, order.to, scene, sent.length);
      sent.push(id);
    }
  });
  return sent;
}



/** The scene's living cast: call `at` every frame with the stage, and `sky` for what flies over. */
export function createHerd(cast: Cast): Herd {
  let troupes: Troupe[] | null = null;
  let read = (): Clipping => ({ wood: [], bodies: [] });
  const pantry: Pantry = new Map();
  const passes: Pass[] = [];
  const clock = { last: 0 };
  const skyRand = streamOf(cast.seed, "fauna.sky.passes");
  clock.last = -between(skyRand, [0.2, 0.8]) * cast.sky.every[0];
  const flyer = (species: SpeciesId | null, coat: string, name: string): Who | null => (species ? { member: memberOf(streamOf(cast.seed, `fauna.sky.${name}`), species, coat || (speciesOf(species).coats[0]?.[0] ?? ""), false, { morph: "normal", region: cast.sky.region ?? undefined }), spec: speciesOf(species) } : null);
  const flyers = { flock: flyer(cast.sky.birds, cast.sky.coats.birds, "bird"), vee: flyer(cast.sky.vee, cast.sky.coats.vee, "vee"), swarm: flyer(cast.sky.swarm, cast.sky.coats.swarm, "swarm") };
  const drawPass = (pass: Pass, t: number): Body[] => {
    if (pass.kind === "flock") return flyers.flock ? flockBodies(pass, flyers.flock, t) : [];
    if (pass.kind === "vee") return flyers.vee ? flockBodies(pass, flyers.vee, t) : [];
    if (pass.kind === "murmuration" || pass.kind === "bats") return swarmBodies(pass, pass.kind === "bats" ? null : flyers.swarm, t);
    return [planeBody(pass.kind, pass, t)];
  };
  return {
    cast,
    at(t: number, stage: Stage): Body[] {
      troupes ??= troupesOf(cast, stage, pantry);
      const posed: Posed[] = [];
      const prints: (Footprint | null)[] = [];
      troupes.forEach((troupe, g) => {
        extend(troupe, t + 1, { stage, backs: troupe.actors.map((actor) => actor.back) });
        for (const actor of troupe.actors) {
          prune(actor, t);
          const m = momentOf(actor, t, { stage, backs: troupe.actors.map((a) => a.back) }, troupe.actors);
          const capsules = poseWho(actor, m);
          actor.pos = m.frame.o;
          actor.back = backOf(capsules);
          // (Fireflies are only seen when they light up, after dark.)
          if (actor.spec.active === "night" && actor.spec.plan === "bug" && stage.night !== true) continue;
          posed.push({ id: `${g}.${actor.index}`, actor, m, capsules, scene: { stage, backs: troupe.actors.map((a) => a.back) } });
          prints.push(footprintOf(actor, m, capsules, g));
        }
      });
      const bodies = settledBodies(posed, prints);
      read = () => clippingOf(bodies.map((body, i) => ({ body, own: ownWood(posed[i]?.m.segment ?? FLY_SEGMENT, stage) })), woodMapOf(stage));
      return bodies;
    },
    clipping: () => read(),
    sky(t: number, now: SkyNow = {}): Body[] {
      const reach = now.radius ?? 1;
      passesUntil(passes, clock, skyRand, cast.sky.every, t, (start) => {
        const kind = nextTraffic(skyRand, cast.sky, now);
        // A busy sky still clears between passes: never more than a few at once.
        const crowded = passes.filter((pass) => pass.end > start).length >= SKY_AT_ONCE;
        return kind && !crowded ? passOf(kind, start, skyRand, reach, cast.sky) : null;
      });
      return passes.filter((pass) => t >= pass.start && t < pass.end).flatMap((pass) => fading(drawPass(pass, t), pass, t));
    },
    command(t: number, order: Order, stage: Stage): string[] {
      troupes ??= troupesOf(cast, stage, pantry);
      return commandTroupes(troupes, t, order, stage);
    },
    eaten(t: number): string[] {
      const done: string[] = [];
      for (const [key, meal] of pantry) if (meal.t <= t) { done.push(key); pantry.delete(key); }
      return done;
    },
  };
}

/** How near a ray from `o` along unit `d` passes a segment ab, and how far along the ray that is. */
function rayToSegment(o: Vec, d: Vec, a: Vec, b: Vec): { gap: number; along: number } {
  const ab = sub(b, a);
  const ee = dot(ab, ab);
  // Project back and forth between the ray and the segment; both are convex, so it settles fast.
  let s = 0.5;
  let along = 0;
  for (let k = 0; k < 6; k += 1) {
    along = Math.max(0, dot(d, sub(madd(a, ab, s), o)));
    s = ee < 1e-12 ? 0 : clamp(dot(sub(madd(o, d, along), a), ab) / ee, 0, 1);
  }
  along = Math.max(0, dot(d, sub(madd(a, ab, s), o)));
  return { gap: length(sub(madd(o, d, along), madd(a, ab, s))), along };
}

/**
 * The body a ray from `origin` along `direction` hits first (a click picked
 * into the scene), or null. A little slack makes small animals easy to tap.
 */
export function pickBody(bodies: readonly Body[], origin: Vec, direction: Vec, slack = 1.25): { id: string; distance: number } | null {
  const d = unit(direction);
  let best: { id: string; distance: number } | null = null;
  for (const body of bodies) {
    for (const c of body.capsules) {
      const hit = rayToSegment(origin, d, c.a, c.b);
      if (hit.gap <= c.r * slack + 0.02 && (!best || hit.along < best.distance)) best = { id: body.id, distance: hit.along };
    }
  }
  return best;
}
