// Joint scenes: what company does together, grooming, chasing, chorusing, huddling, feeding, fleeing and more.

import { TAU, lerpV, sub, unit } from "./vec.js";
import { between, pick } from "./roll.js";
import type { Action } from "./roster.js";
import { SPAN } from "./idle.js";
import { groundSpot } from "./stage.js";
import type { Place, Stage } from "./stage.js";
import {
  GROUND_BIRDS, can, leg, moodOf, onGround, perchCount, placeBeside, placeTop, randomPerch, roomyPerch, soloStep,
  sortie, stay, takenBy, toGround, travel, waitUntil, yawFrom,
} from "./director.js";
import type { Actor, Scene, Troupe } from "./director.js";

// ---------------------------------------------------------------- joint scenes

/** Hold an actor in one action until `time`. */
function holdAs(actor: Actor, act: Action, time: number, partner?: Actor, scene?: Scene): void {
  if (actor.until >= time - 0.02) return;
  if (partner && scene) stayFacing(actor, act, time - actor.until, partner, scene);
  else stay(actor, act, time - actor.until);
}

/** Stay turned to a partner, and keep facing that way after, so the next action starts from there. */
function stayFacing(actor: Actor, act: Action, duration: number, partner: Actor, scene: Scene): void {
  stay(actor, act, duration, partner.index);
  const here = placeTop(actor.place, scene);
  const there = placeTop(partner.place, scene);
  if (actor.place.on === "ground" && Math.hypot(there[0] - here[0], there[2] - here[2]) > 1e-3) actor.yaw = yawFrom(here, there);
}

/** Bring the actors together in time (and down to the ground when the scene needs it). */
function begin(actors: readonly Actor[], scene: Scene, ground = true): number {
  if (ground) toGround(actors, scene);
  const start = Math.max(...actors.map((actor) => actor.until));
  waitUntil(actors, start);
  return start;
}


const walkers = (troupe: Troupe): Actor[] => troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "primate");
function twoOf(list: readonly Actor[], rand: () => number): [Actor, Actor] | null {
  if (list.length < 2) return null;
  const i = Math.floor(rand() * list.length);
  const j = (i + 1 + Math.floor(rand() * (list.length - 1))) % list.length;
  const a = list[i];
  const b = list[j];
  return a && b ? [a, b] : null;
}

/** How far ahead of its middle an animal's nose is. */
const headReach = (actor: Actor): number => actor.member.size * (actor.spec.build.len * 0.5 + actor.spec.build.neck + actor.spec.build.head * 1.5);

/** One animal grooms another, who lies (or sits) still for it. */
function groomScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(walkers(troupe).filter((actor) => can(actor, "groom")), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const bp = placeTop(b.place, scene);
  travel(a, placeBeside(bp, b.yaw, troupe.rand() < 0.5 ? -1 : 1, (a.member.size + b.member.size) * 0.5), "wander", scene);
  holdAs(b, "sit", a.until);
  const length = between(troupe.rand, [5, 9]);
  stay(b, b.spec.plan === "primate" ? "sit" : "lie", length);
  stayFacing(a, "groom", length, b, scene);
  return true;
}

/** Two meet face to face and touch noses (or beaks). */
function nuzzleScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "bird"), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const pa = placeTop(a.place, scene);
  const pb = placeTop(b.place, scene);
  const mid = lerpV(pa, pb, 0.5);
  const dir = unit(sub(pb, pa), [1, 0, 0]);
  const gap = (headReach(a) + headReach(b)) * 0.5 + 0.02;
  travel(a, { on: "ground", x: mid[0] - dir[0] * gap, z: mid[2] - dir[2] * gap }, "wander", scene);
  travel(b, { on: "ground", x: mid[0] + dir[0] * gap, z: mid[2] + dir[2] * gap }, "wander", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  holdAs(b, "look", start, a, scene);
  const length = between(troupe.rand, SPAN.nuzzle);
  stayFacing(a, "nuzzle", length, b, scene);
  stayFacing(b, "nuzzle", length, a, scene);
  return true;
}

/**
 * Plan a move for `actor` that gets in no sooner than `leader` does: it waits,
 * watching, before setting off, so it never pulls up where the leader is still to run.
 */
function arriveAfter(actor: Actor, leader: Actor, move: () => void): void {
  const at = actor.place;
  const start = actor.until;
  const first = actor.segments.length;
  move();
  const late = leader.until + 0.15 - actor.until;
  if (late <= 0) return;
  const moved = actor.segments.splice(first).map((segment) => ({ ...segment, t0: segment.t0 + late, t1: segment.t1 + late }));
  actor.segments.push({ act: "look", t0: start, t1: start + late, from: at, to: at, yaw: moved[0]?.yaw ?? actor.yaw, face: leader.index, mode: null, pace: 0 }, ...moved);
  actor.until += late;
}

/** A chase: one runs a loop, the other runs after it; then a play bow. */
function chaseScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(walkers(troupe).filter((actor) => actor.spec.speed >= 0.8), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const stops = [0, 1, 2].map(() => groundSpot(troupe.rand, scene.stage, a.member.size));
  stayFacing(b, "play", 0.7, a, scene);
  for (const stop of stops) {
    const from = placeTop(a.place, scene);
    travel(a, stop, "run", scene);
    const to = placeTop(stop, scene);
    const back = unit(sub(from, to), [0, 0, -1]);
    const gap = a.member.size * a.spec.build.len + b.member.size * b.spec.build.len;
    arriveAfter(b, a, () => { travel(b, { on: "ground", x: to[0] + back[0] * gap, z: to[2] + back[2] * gap }, "run", scene, 1.05); });
  }
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  holdAs(b, "look", start, a, scene);
  stayFacing(a, "play", 1.8, b, scene);
  stayFacing(b, "play", 1.8, a, scene);
  return true;
}

/** The pack follows its leader across the ground, single file. */
function followScene(troupe: Troupe, scene: Scene): boolean {
  const pack = troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "primate" || actor.spec.plan === "crab");
  const leader = pack[0];
  if (!leader || pack.length < 2) return false;
  begin(pack, scene);
  for (let leg = 0; leg < 2; leg += 1) {
    const stop = groundSpot(troupe.rand, scene.stage, leader.member.size);
    const from = placeTop(leader.place, scene);
    travel(leader, stop, "wander", scene);
    const to = placeTop(stop, scene);
    const back = unit(sub(from, to), [0, 0, -1]);
    pack.slice(1).forEach((actor, i) => {
      const gap = (i + 1) * (leader.member.size * leader.spec.build.len + 0.08);
      holdAs(actor, "look", actor.until + 0.5 + i * 0.4);
      travel(actor, { on: "ground", x: to[0] + back[0] * gap, z: to[2] + back[2] * gap }, "wander", scene);
    });
  }
  return true;
}

/** Everyone sings (or howls, or stands up to keep watch), one after another. */
function chorusScene(troupe: Troupe, scene: Scene): boolean {
  const voice = (actor: Actor): Action | null => (can(actor, "howl") ? "howl" : can(actor, "sing") ? "sing" : actor.spec.temper.rear !== undefined && actor.spec.temper.rear >= 2 ? "rear" : null);
  const singers = troupe.actors.filter((actor) => voice(actor) !== null);
  if (singers.length < 2) return false;
  const start = begin(singers, scene, false);
  singers.forEach((actor, i) => {
    holdAs(actor, actor.spec.plan === "quad" ? "sit" : "look", start + i * 0.7);
    stay(actor, voice(actor) ?? "look", between(troupe.rand, [3.5, 5.5]));
  });
  return true;
}

/** All curl up together around one spot. */
function huddleScene(troupe: Troupe, scene: Scene): boolean {
  const sleepers = troupe.actors.filter((actor) => can(actor, "sleep") && actor.spec.plan !== "bird");
  if (sleepers.length < 2) return false;
  begin(sleepers, scene);
  const first = sleepers[0];
  if (!first) return false;
  const centre = placeTop(groundSpot(troupe.rand, scene.stage, first.member.size * 2), scene);
  // Neighbours lie a body's width apart round the ring, each curled along it.
  const widest = Math.max(...sleepers.map((actor) => actor.spec.build.body * actor.member.size));
  const longest = Math.max(...sleepers.map((actor) => actor.spec.build.len * actor.member.size));
  const ring = Math.max(widest * 2.4, longest * 1.05) / (2 * Math.sin(Math.PI / sleepers.length));
  const turn = troupe.rand() * TAU;
  const arrived = sleepers.map((actor, i) => {
    const a = (i / sleepers.length) * TAU + turn;
    travel(actor, { on: "ground", x: centre[0] + Math.cos(a) * ring, z: centre[2] + Math.sin(a) * ring }, "wander", scene);
    const yaw = actor.yaw;
    actor.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    return yaw;
  });
  const start = Math.max(...sleepers.map((actor) => actor.until));
  const length = between(troupe.rand, [16, 34]);
  sleepers.forEach((actor, i) => {
    const wait = start - actor.until;
    if (wait > 0.02) stay(actor, "lie", wait, -1, actor.yaw, arrived[i]);
    stay(actor, scene.stage.night === true ? "sleep" : "lie", length, -1, actor.yaw, wait > 0.02 ? undefined : arrived[i]);
  });
  return true;
}

/** Two birds face each other and dance (a crane's leaping, a peacock's fan). */
function danceScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => can(actor, "display")), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const pa = placeTop(a.place, scene);
  const gap = headReach(a) + headReach(b);
  const yaw = troupe.rand() * TAU;
  travel(b, { on: "ground", x: pa[0] + Math.sin(yaw) * gap, z: pa[2] + Math.cos(yaw) * gap }, "wander", scene);
  holdAs(a, "look", b.until, b, scene);
  const length = between(troupe.rand, SPAN.display);
  stayFacing(a, "display", length, b, scene);
  stayFacing(b, a.member.species === "peacock" ? "peck" : "display", length, a, scene);
  return true;
}

/** A young one comes to its parent: to nurse, or to be fed. */
function feedScene(troupe: Troupe, scene: Scene): boolean {
  const parent = troupe.actors.find((actor) => !actor.member.young);
  const young = troupe.actors.find((actor) => actor.member.young);
  if (!parent || !young || parent.spec.plan === "bug") return false;
  begin([parent, young], scene);
  const pp = placeTop(parent.place, scene);
  const gap = parent.spec.plan === "bird" ? parent.member.size * 0.6 : parent.member.size * 0.35;
  travel(young, placeBeside(pp, parent.yaw, troupe.rand() < 0.5 ? -1 : 1, gap), "wander", scene);
  holdAs(parent, "look", young.until, young, scene);
  const length = between(troupe.rand, [5, 10]);
  const bird = parent.spec.plan === "bird";
  stay(parent, bird ? "peck" : can(parent, "graze") ? "graze" : "groom", length, bird ? young.index : -1);
  stayFacing(young, bird ? "flap" : "nuzzle", length, parent, scene);
  return true;
}

/** A bird flies down onto a bigger animal's back and rides along a while. */
function rideScene(troupe: Troupe, scene: Scene): boolean {
  const rider = troupe.actors.find((actor) => actor.spec.plan === "bird" && actor.spec.flies);
  const mount = troupe.actors.find((actor) => actor.spec.plan === "quad" && actor.member.size >= 0.4 && actor.index < (rider?.index ?? -1));
  if (!rider || !mount || rider.place.on === "back") return false;
  begin([rider], scene, false);
  travel(rider, { on: "back", m: mount.index }, "fly", scene);
  for (let i = 0; i < 4; i += 1) stay(rider, pick(troupe.rand, [["look", 3], ["preen", 2], ["sing", 1.5], ["stand", 1]]), between(troupe.rand, [3, 6]));
  return true;
}

/** Climbers go up the tree together and sit near each other. */
function climbScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.climbs && !actor.spec.flies), troupe.rand);
  if (!pair || perchCount(scene) === 0) return false;
  const [a, b] = pair;
  begin(pair, scene, false);
  const i = Math.floor(troupe.rand() * 9973);
  travel(a, { on: "perch", i }, "climb", scene);
  stayFacing(b, "look", 0.8, a, scene);
  travel(b, { on: "perch", i: i + 1 }, "climb", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "sit", start);
  const length = between(troupe.rand, [6, 12]);
  stay(a, can(a, "eat") ? "eat" : "sit", length);
  stayFacing(b, can(b, "groom") ? "groom" : "sit", length, a, scene);
  return true;
}

/**
 * One of a group stands up to keep watch (a meerkat's, a marmot's or a
 * mongoose's sentry) while the rest dig and feed round it, never far; then
 * it drops down and another may take over.
 */
function sentryScene(troupe: Troupe, scene: Scene): boolean {
  const band = troupe.actors.filter((actor) => actor.spec.plan === "quad" && (actor.spec.temper.rear ?? 0) >= 2);
  if (band.length < 2) return false;
  begin(band, scene);
  const guard = band[Math.floor(troupe.rand() * band.length)];
  if (!guard) return false;
  const start = guard.until;
  const length = between(troupe.rand, [8, 14]);
  stay(guard, "rear", length);
  const post = placeTop(guard.place, scene);
  for (const actor of band) {
    if (actor === guard) continue;
    const jobs = (["dig", "sniff", "graze", "eat"] as const).filter((act) => can(actor, act));
    for (let guardrail = 0; guardrail < 6 && actor.until < start + length - 1.5; guardrail += 1) {
      if (troupe.rand() < 0.45) travel(actor, groundSpot(actor.rand, scene.stage, actor.member.size, post, actor.member.size * 5 + 0.3, takenBy(actor, scene)), "wander", scene, 0.8);
      stay(actor, jobs[Math.floor(troupe.rand() * jobs.length)] ?? "sniff", between(troupe.rand, [1.8, 3.5]));
    }
    holdAs(actor, "look", start + length, guard, scene);
  }
  return true;
}

/**
 * Something startles the group: one freezes and looks (or stands up to see),
 * the rest look to it, and then they all scatter away from the same side:
 * the runners across the lawn, the climbers up the tree, the birds into the
 * branches. They stop, and look back.
 */
function alarmScene(troupe: Troupe, scene: Scene): boolean {
  const runners = troupe.actors.filter((actor) => actor.spec.plan === "quad" && (can(actor, "run") || can(actor, "hop")));
  if (runners.length < 2 || troupe.actors.some((actor) => actor.place.on === "back")) return false;
  begin(troupe.actors, scene, false);
  const scout = runners[Math.floor(troupe.rand() * runners.length)];
  if (!scout) return false;
  stay(scout, can(scout, "rear") ? "rear" : "look", between(troupe.rand, [1.2, 2.2]));
  const threat = troupe.rand() * TAU;
  const stage = scene.stage;
  const away = threat + Math.PI;
  for (const actor of troupe.actors) {
    if (actor !== scout) holdAs(actor, "look", scout.until - 0.15 + troupe.rand() * 0.4, scout, scene);
    flee(actor, away, scene);
    const here = placeTop(actor.place, scene);
    const back = Math.atan2(Math.cos(threat) * stage.radius - here[0], Math.sin(threat) * stage.radius - here[2]);
    stay(actor, can(actor, "rear") && actor.rand() < 0.5 ? "rear" : "look", between(actor.rand, [2, 3.5]), -1, actor.place.on === "ground" ? back : actor.yaw);
  }
  return true;
}

/** Get away from a fright: a bird into the branches, a climber up the tree (most often), anyone else off across the ground away from it. */
function flee(actor: Actor, away: number, scene: Scene): void {
  const stage = scene.stage;
  const perches = perchCount(scene) > 0;
  if (actor.spec.flies && perches && !GROUND_BIRDS.has(actor.member.species)) { travel(actor, randomPerch(actor, scene), "fly", scene); return; }
  if (actor.spec.climbs && perches && actor.rand() < 0.7) { travel(actor, randomPerch(actor, scene), "climb", scene, 1.4); return; }
  const a = away + (actor.rand() - 0.5) * 1.4;
  const r = stage.radius * between(actor.rand, [0.55, 0.9]);
  travel(actor, onGround(stage, actor.member.size, Math.cos(a) * r, Math.sin(a) * r), can(actor, "run") ? "run" : "hop", scene, 1.15);
}

/**
 * A hunter after something smaller in its company: a cat after a bird, a
 * fox after a mouse. It creeps up low, freezes, pounces, and misses: the
 * bird is away into the tree, the mouse off across the grass. It sits and
 * washes, as if it meant to.
 */
function stalkScene(troupe: Troupe, scene: Scene): boolean {
  const hunter = troupe.actors.find((actor) => can(actor, "stalk"));
  const prey = troupe.actors.find((actor) => hunter && actor !== hunter && actor.member.heft < hunter.member.heft * 0.7 && (actor.spec.plan === "bird" || actor.spec.plan === "quad") && !GROUND_BIRDS.has(actor.member.species));
  if (!hunter || !prey) return false;
  begin([hunter, prey], scene);
  const target = placeTop(prey.place, scene);
  const from = placeTop(hunter.place, scene);
  const dir = unit(sub(target, from), [0, 0, 1]);
  const gap = headReach(hunter) * 2 + prey.member.size + 0.25;
  travel(hunter, { on: "ground", x: target[0] - dir[0] * gap, z: target[2] - dir[2] * gap }, "stalk", scene);
  stay(hunter, "stalk", between(troupe.rand, [0.8, 1.8]), prey.index);
  const leap = hunter.until;
  holdAs(prey, prey.spec.plan === "bird" ? "peck" : "graze", leap + 0.25);
  travel(hunter, { on: "ground", x: target[0] - dir[0] * headReach(hunter), z: target[2] - dir[2] * headReach(hunter) }, can(hunter, "hop") ? "hop" : "run", scene, 1.3);
  if (prey.spec.flies && perchCount(scene) > 0) travel(prey, randomPerch(prey, scene), "fly", scene);
  else {
    const a = Math.atan2(dir[2], dir[0]) + (troupe.rand() - 0.5);
    const r = scene.stage.radius * 0.8;
    travel(prey, onGround(scene.stage, prey.member.size, Math.cos(a) * r, Math.sin(a) * r), can(prey, "run") ? "run" : "hop", scene, 1.3);
  }
  stay(prey, "look", between(troupe.rand, [2, 3]));
  stay(hunter, "look", between(troupe.rand, [1, 2]));
  stay(hunter, can(hunter, "groom") ? "groom" : "sit", between(troupe.rand, [3, 5]));
  return true;
}

/** Crows find an owl at its roost by day and mob it: they come in round it, flapping and calling, until it flies. */
function mobScene(troupe: Troupe, scene: Scene): boolean {
  const owl = troupe.actors.find((actor) => actor.member.species === "owl");
  const mob = troupe.actors.filter((actor) => actor.member.species === "crow");
  if (!owl || mob.length === 0 || perchCount(scene) === 0 || scene.stage.night === true) return false;
  begin([owl, ...mob], scene, false);
  if (owl.place.on !== "perch") travel(owl, randomPerch(owl, scene), "fly", scene);
  const roost = owl.place.on === "perch" ? owl.place.i : 0;
  mob.forEach((crow, k) => { travel(crow, { on: "perch", i: roomyPerch(scene.stage, roost + 1 + k * 2, crow.member.size) }, "fly", scene); });
  const start = Math.max(owl.until, ...mob.map((crow) => crow.until));
  const length = between(troupe.rand, [6, 10]);
  holdAs(owl, "look", start);
  stay(owl, "look", length);
  for (const crow of mob) {
    holdAs(crow, "look", start, owl, scene);
    while (crow.until < start + length - 0.5) stayFacing(crow, troupe.rand() < 0.5 ? "flap" : "sing", between(troupe.rand, [0.9, 1.6]), owl, scene);
  }
  travel(owl, randomPerch(owl, scene), "fly", scene);
  return true;
}

/** A pair of birds in the tree side by side: they fly to neighbouring twigs and preen each other, or sing a duet. */
function perchScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.plan === "bird" && actor.spec.flies && !GROUND_BIRDS.has(actor.member.species)), troupe.rand);
  if (!pair || perchCount(scene) === 0) return false;
  const [a, b] = pair;
  begin(pair, scene, false);
  const i = roomyPerch(scene.stage, Math.floor(troupe.rand() * 9973), a.member.size);
  if (a.place.on !== "perch" || a.place.i !== i) travel(a, { on: "perch", i }, "fly", scene);
  travel(b, { on: "perch", i: roomyPerch(scene.stage, i + 1, b.member.size, i, (a.member.size + b.member.size) * 0.75) }, "fly", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  const length = between(troupe.rand, [4, 8]);
  const duet = can(a, "sing") && can(b, "sing") && troupe.rand() < 0.5;
  stayFacing(a, duet ? "sing" : "preen", length, b, scene);
  stayFacing(b, duet ? "sing" : "preen", length, a, scene);
  return true;
}

/**
 * A flock goes out round the tree together: the leader sets off on its
 * sortie and the others lift after it a beat apart, on the same loops a
 * little wider or higher, at its pace, and come in to branches near where it lands.
 */
function flockScene(troupe: Troupe, scene: Scene): boolean {
  const flock = troupe.actors.filter((actor) => actor.spec.plan === "bird" && actor.spec.flies);
  const leader = flock[0];
  if (!leader || flock.length < 2 || !scene.stage.trunk) return false;
  begin(flock, scene, false);
  const first = leader.segments.length;
  if (!sortie(leader, scene)) return false;
  const flight = leader.segments.slice(first).find((segment) => segment.loop?.kind === "sortie");
  const loop = flight?.loop;
  if (!flight || loop?.kind !== "sortie") return true;
  const speed = flight.pace * leader.member.size;
  flock.slice(1).forEach((bird, k) => {
    holdAs(bird, "look", flight.t0 + 0.2 + k * 0.25 + troupe.rand() * 0.2, leader, scene);
    const to: Place = flight.to.on === "perch" ? { on: "perch", i: roomyPerch(scene.stage, flight.to.i + 1 + k, bird.member.size) } : groundSpot(bird.rand, scene.stage, bird.member.size, placeTop(flight.to, scene), bird.member.size * 4 + 0.3, takenBy(bird, scene));
    const own = { ...loop, R: loop.R + (troupe.rand() - 0.3) * 0.5, h: loop.h + (troupe.rand() - 0.5) * 0.6 };
    leg(bird, to, "fly", scene, 1, own, speed * between(troupe.rand, [0.96, 1.04]));
    stay(bird, "look", between(troupe.rand, [1, 2.5]));
  });
  return true;
}

type SceneFn = (troupe: Troupe, scene: Scene) => boolean;
const SCENES: readonly (readonly [SceneFn, number])[] = [
  [groomScene, 3], [nuzzleScene, 1.2], [chaseScene, 2], [followScene, 2], [chorusScene, 1.5],
  [huddleScene, 1], [danceScene, 3], [feedScene, 3], [rideScene, 4], [climbScene, 2],
  [sentryScene, 3], [alarmScene, 0.8], [stalkScene, 2.5], [mobScene, 4], [perchScene, 2], [flockScene, 2.5],
];

/** How the sky and the hour weigh the scenes: they huddle in snow and rain and at night, sing at dawn and dusk, and keep play for fair days. */
function sceneWeight(fn: SceneFn, weight: number, stage: Stage): number {
  const mood = moodOf(stage);
  const wet = mood.weather !== undefined;
  if (fn === huddleScene) return weight * (wet ? 4 : 1) * (mood.night === true ? 2 : 1);
  if (fn === chorusScene) return weight * (mood.twilight === true ? 3 : 1);
  if (fn === chaseScene || fn === danceScene || fn === flockScene || fn === stalkScene) return weight * (wet ? 0.25 : 1);
  return weight;
}

/** Try the joint scenes in a seeded order until one fits the troupe. */
function tryScene(troupe: Troupe, scene: Scene): boolean {
  const left = SCENES.map(([fn, weight]) => [fn, sceneWeight(fn, weight, scene.stage)] as const);
  while (left.length > 0) {
    const fn = pick(troupe.rand, left);
    if (fn(troupe, scene)) return true;
    left.splice(left.findIndex(([candidate]) => candidate === fn), 1);
  }
  return false;
}

/** Write each troupe's timelines on until every member is busy past `horizon`. */
export function extend(troupe: Troupe, horizon: number, scene: Scene): void {
  for (let guard = 0; guard < 96; guard += 1) {
    let next: Actor | undefined;
    for (const actor of troupe.actors) if (!next || actor.until < next.until) next = actor;
    if (!next || next.until >= horizon) return;
    if (troupe.actors.length > 1 && troupe.rand() < troupe.cohesion && tryScene(troupe, scene)) continue;
    soloStep(next, scene);
  }
}
