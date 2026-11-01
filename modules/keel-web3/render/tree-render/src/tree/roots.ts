// Roots: their paths over the ground, over a planter's lip and out through its broken wall, and the shards of
// the break.

import type { TreeGround } from "../inputs.js";
import { clamp, hash32, seededRandom, smoothstep } from "../math.js";

// ---------------------------------------------------------------- roots

export const ROOT_SEGMENTS = 18;

export interface RootPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly gone: boolean;
}

interface RootStep {
  readonly s: number;
  readonly reach: number;
  readonly angle: number;
  readonly radius: number;
  readonly phase: number;
  readonly trunk: number;
  readonly heave: number;
  /** The first point, at the trunk foot. */
  readonly first: boolean;
}

/**
 * How one root of an old tree breaks its planter (`rootBreak`). `heave` (0 to 1)
 * grows with the trunk: the root arches higher out of the soil and levers the
 * rim up where it rolls over. `burst` is how far down the wall, as a share of
 * its depth, the root punches out through the side instead (0: over the lip);
 * `hang` is how far below the wall's foot it may then dangle.
 */
export interface RootBreak { readonly heave: number; readonly burst: number; readonly hang: number }

export const NO_ROOT_BREAK: RootBreak = { heave: 0, burst: 0, hang: 0 };

/** The trunk radius where roots begin to heave, and where they break at full strength. */
const BREAK_FROM = 0.45;
const BREAK_FULL = 0.85;
/** How far inside the lip a bursting root dives, and how long it takes to punch out of the wall. */
const BURST_DIVE = 0.7;
const BURST_OUT = 0.42;
/** The deepest a bursting root runs down a wall before it dangles (a tall sculpt is not followed to its foot). */
const BURST_WALL = 2.4;

const unit = (value: number): number => (value % 1000) / 1000;

/** The planter's wall as the roots meet it: whether its side can break, and how far below it a root may hang. */
function planterWall(ground: TreeGround): { hard: boolean; hang: number } {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const hard = ground.planter?.hard ?? wall.depth < 0.5;
  const hang = Math.max(0, ground.planter?.hang ?? wall.depth * 1.2);
  return { hard, hang };
}

/** The longest of the roots that count as long, by index; -1 when none does. */
function longestRoot(
  roots: readonly { readonly angle: number; readonly reach: number }[],
  long: (root: { readonly reach: number }) => boolean,
): number {
  let best = -1;
  for (const [index, root] of roots.entries()) {
    if (long(root) && (best < 0 || root.reach > (roots[best]?.reach ?? 0))) best = index;
  }
  return best;
}

/**
 * Plans every root's break for a tree of this trunk on this ground, seeded:
 * an old tree's roots all heave; on a planter whose side they can break (not
 * metal or gems, see `TreeGround.planter.hard`) most old trees, not all, send
 * a root or two out through the wall, the longest first.
 */
export function rootBreaks(
  roots: readonly { readonly angle: number; readonly reach: number }[],
  trunk: number,
  ground: TreeGround,
  seed = 1,
): RootBreak[] {
  const heave = smoothstep(BREAK_FROM, BREAK_FULL, trunk);
  if (heave <= 0 || !ground.lip) return roots.map(() => NO_ROOT_BREAK);
  const { hard, hang } = planterWall(ground);
  const reach = ground.rootReach ?? ground.radius;
  const tree = hash32((seed ^ 0x7f4a7c15) >>> 0);
  // Five trees in six break a side; the rest only heave and crack the rim.
  const breaker = !hard && heave > 0.15 && unit(tree) < 0.83;
  const long = (root: { readonly reach: number }): boolean => (0.3 + trunk * 16) * root.reach >= reach * 0.92;
  const picks = roots.map((root, index) => {
    const h = hash32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    return { burst: breaker && long(root) && unit(h) < 0.12 + 0.2 * heave, depth: 0.28 + unit(h >>> 10) * 0.32 };
  });
  // A breaking tree always shows one: its longest root goes through the wall.
  if (breaker && !picks.some((pick) => pick.burst)) {
    const pick = picks[longestRoot(roots, long)];
    if (pick) pick.burst = true;
  }
  return picks.map((pick) => ({ heave, burst: pick.burst ? pick.depth : 0, hang }));
}

/**
 * On the turf: weave, rising and sinking. Near the trunk and the lip a root stays proud of the soil, so it meets both.
 * An old root heaves higher arches.
 */
function rootOnTop(ground: TreeGround, step: RootStep, lip: number): number {
  if (step.first) return ground.y + step.trunk * 0.9;
  const { s, reach, radius, phase, heave } = step;
  const weave = Math.sin(s * 2.1 + phase) * 0.7 + Math.sin(s * 4.7 + phase * 2.3) * 0.3;
  const proud = Math.max(smoothstep(0.8, 0.1, s), smoothstep(lip - 0.7, lip - 0.1, reach));
  const arch = 1.1 + 0.9 * heave;
  return (
    ground.y +
    radius * (0.15 + arch * Math.max(weave, proud * 0.6)) -
    radius * (1.3 + 0.4 * heave) * (1 - proud) * Math.max(0, -weave)
  );
}

/**
 * Past the lip: roll over the bevel, then creep down the wall (or a carved surface) until it tucks under. An old root
 * levers up over the rim it cracks.
 */
function rootOverLip(ground: TreeGround, step: RootStep, lip: number): { r: number; y: number; gone: boolean } {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const over = step.reach - lip;
  const lift = step.heave * step.radius * 0.7;
  if (over < 0.32) {
    const turn = (over / 0.32) * Math.PI * 0.5;
    return {
      r: lip + Math.sin(turn) * 0.3 + step.radius * 0.6,
      y: ground.y + step.radius * 0.5 + lift * Math.cos(turn) - (1 - Math.cos(turn)) * 0.3,
      gone: false,
    };
  }
  const down = over - 0.32;
  const y = ground.y - 0.3 - down;
  if (ground.surface) {
    const surface = ground.surface(step.angle, y);
    return { r: surface + step.radius * 0.6, y, gone: down > wall.depth * 0.92 || surface < lip * 0.45 };
  }
  const sink = clamp(down / Math.max(wall.depth, 0.1), 0, 1);
  return { r: (lip + 0.3) * (1 + wall.flare * sink) + step.radius * 0.7, y, gone: down > wall.depth * 0.92 };
}

/** The planter's outer face at this angle and height: a carved surface, or the lip pushed out by the wall's flare. */
function wallFace(ground: TreeGround, angle: number, lip: number, y: number): number {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  if (ground.surface) return ground.surface(angle, y);
  // `lip` is the rim less 0.12; the bevelled wall stands a little proud of the rim line.
  return (lip + 0.28) * (1 + wall.flare * clamp((ground.y - y) / Math.max(wall.depth, 0.1), 0, 1));
}

/**
 * A root that bursts out of the side: it dives under the soil short of the lip,
 * runs hidden inside the planter, punches out of the wall with a swelling
 * where it broke through, creeps down the outside and dangles below the foot.
 */
function rootThroughWall(
  ground: TreeGround,
  step: RootStep,
  lip: number,
  plan: RootBreak,
): { r: number; y: number; gone: boolean; swell: number } {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const depth = Math.min(wall.depth, BURST_WALL);
  const out = ground.y - Math.max(0.3, depth * plan.burst);
  const over = step.reach - (lip - BURST_DIVE);
  if (over < BURST_DIVE) {
    // Under the soil and inside the wall, so the planter hides it.
    const t = smoothstep(0, 0.6, over / BURST_DIVE);
    const under = ground.y - step.radius * 1.4 - 0.08;
    const y = under + (Math.min(out, under) - under) * t;
    return {
      r: Math.min(step.reach, wallFace(ground, step.angle, lip, y) - step.radius - 0.08),
      y,
      gone: false,
      swell: 0,
    };
  }
  if (over < BURST_DIVE + BURST_OUT) {
    const u = (over - BURST_DIVE) / BURST_OUT;
    const swell = Math.sin(u * Math.PI);
    return {
      r: wallFace(ground, step.angle, lip, out) + step.radius * (0.35 + 0.45 * u) + 0.16 * swell,
      y: out + 0.08 * swell,
      gone: false,
      swell,
    };
  }
  const down = over - BURST_DIVE - BURST_OUT;
  const foot = ground.y - depth;
  const y = out - down;
  if (y > foot) {
    const face = wallFace(ground, step.angle, lip, y);
    // A carved surface that tucks in under the planter: hang free from where it turned.
    if (!ground.surface || face > lip * 0.7) return { r: face + step.radius * 0.6, y, gone: false, swell: 0 };
  }
  const top = Math.max(y, foot);
  const hangFrom = wallFace(ground, step.angle, lip, top) + step.radius * 0.6;
  const below = Math.max(0, Math.min(foot, out) - y);
  // Free of the wall it bows out a little, then hangs straight.
  return {
    r: Math.max(hangFrom, lip * 0.7) + 0.18 * Math.sin(Math.min(below, 1.2) * 1.3),
    y,
    gone: below > plan.hang,
    swell: 0,
  };
}

/** Does this root burst out through the planter's side (a `rootBreaks` plan says so, and there is a lip to pass)? */
const bursts = (ground: TreeGround, plan: RootBreak): boolean => plan.burst > 0 && ground.lip !== undefined;

/** How long a root runs: to the lip, out through the wall and down to its hang, or out over the turf by the trunk. */
function rootLength(
  root: { readonly angle: number; readonly reach: number },
  trunk: number,
  ground: TreeGround,
  plan: RootBreak,
): number {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const reach = ground.rootReach ?? ground.radius;
  if (plan.burst > 0 && ground.lip !== undefined) {
    return (
      Math.max(0.5, ground.lip(root.angle) - 0.12 - trunk * 0.5) +
      BURST_OUT +
      Math.min(wall.depth, BURST_WALL) * (1 - plan.burst) +
      plan.hang
    );
  }
  return Math.min((0.3 + trunk * 16) * root.reach, reach + wall.depth * 1.4);
}

/**
 * Thick most of the way, tapering hard only toward the tip, like a real root. One that breaks a wall stays thick to
 * its end.
 */
function rootRadius(trunk: number, share: number, burst: boolean): number {
  if (burst) return trunk * 0.42 * (1 - 0.5 * share) * (1 - share ** 5) + 0.035;
  return trunk * 0.5 * (1 - 0.55 * share) * (1 - share ** 3) + 0.03 * share ** 3;
}

/** Where one step of a root lies: through the wall, on the turf short of the lip, or over the lip. */
function rootPlace(
  ground: TreeGround,
  step: RootStep,
  lip: number,
  plan: RootBreak,
): { r: number; y: number; gone: boolean; swell: number } {
  const burst = bursts(ground, plan);
  if (burst && step.reach >= lip - BURST_DIVE) return rootThroughWall(ground, step, lip, plan);
  if (step.reach < lip) {
    return { r: step.reach, y: rootOnTop(ground, step, burst ? lip + 9 : lip), gone: false, swell: 0 };
  }
  return { ...rootOverLip(ground, step, lip), swell: 0 };
}

/**
 * A surface root as ROOT_SEGMENTS + 1 points. It wanders out from the trunk
 * foot, diving under the turf and surfacing again, and on a planter an old
 * tree's longest roots roll over the lip and creep down the wall. Length grows
 * with the trunk, so saplings keep theirs short. A `rootBreaks` plan heaves an
 * old root higher, or sends it out through the planter's side.
 */
export function rootPath(
  root: { readonly angle: number; readonly reach: number },
  trunk: number,
  ground: TreeGround,
  plan: RootBreak = NO_ROOT_BREAK,
): RootPoint[] {
  const burst = bursts(ground, plan);
  const length = rootLength(root, trunk, ground, plan);
  const phase = root.angle * 7.3;
  const points: RootPoint[] = [];
  for (let index = 0; index <= ROOT_SEGMENTS; index += 1) {
    const s = (length * index) / ROOT_SEGMENTS;
    const share = s / length;
    const radius = rootRadius(trunk, share, burst);
    const angle = root.angle + 0.3 * Math.sin(s * 0.7 + phase) + 0.06 * Math.sin(s * 2.1 + phase * 1.7);
    const step: RootStep = {
      s,
      reach: trunk * 0.5 + s,
      angle,
      radius,
      phase,
      trunk,
      heave: plan.heave,
      first: index === 0,
    };
    const lip = (ground.lip?.(angle) ?? Infinity) - 0.12;
    const place = rootPlace(ground, step, lip, plan);
    points.push({
      x: Math.cos(angle) * place.r,
      y: place.y,
      z: Math.sin(angle) * place.r,
      radius: Math.max(radius * (1 + 0.6 * place.swell), 0.022),
      gone: place.gone,
    });
  }
  return points;
}

/** A chunk of planter an old root broke loose. */
export interface RootShard {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: readonly [number, number, number];
  readonly angle: number;
  readonly tilt: number;
  readonly roll: number;
  readonly tone: number;
}

/** The most chunks one root breaks off; the shard mesh is this times the root count, fixed. */
export const ROOT_SHARDS = 8;
/** A shard tone past the planter's colours: the dark of a hole or crack in its wall. */
export const HOLE_TONE = 3;

/** What every chunk of one root's break shares: the seeded stream, the ground, the plan and the sizes. */
interface ShardSite {
  readonly random: () => number;
  readonly ground: TreeGround;
  readonly plan: RootBreak;
  readonly hard: boolean;
  readonly size: number;
  readonly thick: number;
  readonly shards: RootShard[];
  /** The root's angle where it reaches the rim, and the lip there. */
  readonly rimAngle: number;
  readonly lip: number;
}

/** One chunk levered loose: at `angle`, `r` out and `y` up, shifted `side` along the rim, `scale` times the size. */
interface Chunk {
  readonly angle: number;
  readonly r: number;
  readonly y: number;
  readonly side: number;
  readonly scale: number;
  readonly tilt: number;
}

function addChunk(site: ShardSite, chunk: Chunk): void {
  const { random, size } = site;
  const { angle, r, y, side, scale, tilt } = chunk;
  const s = size * scale * (0.75 + random() * 0.5);
  const t = -Math.sin(angle);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  site.shards.push({
    x: c * r + t * side,
    y,
    z: n * r + c * side,
    size: [s * (0.9 + random() * 0.45), s * (0.6 + random() * 0.35), s * (0.7 + random() * 0.35)],
    angle,
    tilt: tilt + (random() - 0.5) * 0.3,
    roll: (random() - 0.5) * 0.9 + Math.sign(side) * 0.25,
    tone: 1 + Math.floor(random() * 2),
  });
}

/** A flat dark piece on the wall's face: the hole, or a stroke of the crack above it. */
interface Slab {
  readonly y: number;
  readonly side: number;
  readonly width: number;
  readonly height: number;
  readonly roll: number;
  readonly tone: number;
  readonly push?: number;
}

/** The hole's place on the wall: the root's angle there and the lip at it. */
interface Hole {
  readonly angle: number;
  readonly lip: number;
}

function addSlab(site: ShardSite, hole: Hole, slab: Slab): void {
  const { y, side, width, height, roll, tone } = slab;
  const push = slab.push ?? 0.02;
  const t = -Math.sin(hole.angle);
  const c = Math.cos(hole.angle);
  const n = Math.sin(hole.angle);
  const r = wallFace(site.ground, hole.angle, hole.lip, y) + push;
  site.shards.push({
    x: c * r + t * side,
    y,
    z: n * r + c * side,
    size: [width, height, 0.05],
    angle: hole.angle,
    tilt: 0,
    roll,
    tone,
  });
}

/** Where a root rolls over the lip: two rim pieces levered up either side of it (a hard planter just cracks). */
function rimShards(site: ShardSite): RootShard[] {
  const { random, ground, plan, hard, size, thick, rimAngle, lip } = site;
  for (const side of [-1, 1]) {
    addChunk(site, {
      angle: rimAngle,
      r: lip + 0.08,
      y: ground.y + 0.06 + size * 0.2,
      side: side * (thick + 0.14 + random() * 0.08),
      scale: 1,
      tilt: 0.35 + 0.35 * plan.heave,
    });
  }
  if (!hard && plan.heave > 0.45) {
    addChunk(site, {
      angle: rimAngle,
      r: lip + 0.32,
      y: ground.y - 0.35 - random() * 0.4,
      side: (random() - 0.5) * 0.3,
      scale: 0.7,
      tilt: 1.2,
    });
  }
  return site.shards;
}

/**
 * The hole in the side, at the depth the root comes out: a dark break in the wall,
 * a ring of chunks pried out round it, one knocked loose lower down, and a crack
 * running up from the hole to the rim, which the root has split.
 */
function holeShards(site: ShardSite, hole: Hole): RootShard[] {
  const { random, ground, plan, size, thick, rimAngle, lip } = site;
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const depth = Math.min(wall.depth, BURST_WALL);
  const out = ground.y - Math.max(0.3, depth * plan.burst);
  const face = wallFace(ground, hole.angle, hole.lip, out);
  const ring = Math.min(thick, 0.22) + 0.12;
  const mouth = { y: out, side: 0, width: ring * 1.9, height: ring * 1.7 };
  addSlab(site, hole, { ...mouth, roll: (random() - 0.5) * 0.6, tone: HOLE_TONE });
  const over = { angle: hole.angle, r: face + 0.1, y: out + ring * 0.95 };
  addChunk(site, { ...over, side: (random() - 0.5) * 0.25, scale: 1.4, tilt: 1.0 });
  addChunk(site, { angle: hole.angle, r: face + 0.1, y: out - ring * 0.15, side: -ring * 1.1, scale: 1.2, tilt: 0.85 });
  addChunk(site, { angle: hole.angle, r: face + 0.1, y: out - ring * 0.05, side: ring * 1.1, scale: 1.2, tilt: 0.85 });
  addChunk(site, {
    angle: hole.angle,
    r: wallFace(ground, hole.angle, hole.lip, out - 0.6) + 0.14,
    y: out - ring - 0.45,
    side: (random() - 0.5) * 0.6,
    scale: 0.9,
    tilt: 1.35,
  });
  // The crack: two dark strokes zigzagging from the top of the hole up to the rim.
  const top = out + ring;
  const rise = Math.max(0, ground.y - 0.04 - top);
  if (rise > 0.12) {
    const jog = (random() < 0.5 ? -1 : 1) * (0.08 + random() * 0.1);
    const stroke = { tone: HOLE_TONE, push: 0.03 };
    const lower = { y: top + rise * 0.25, side: jog * 0.5, width: 0.13, height: rise * 0.55 };
    addSlab(site, hole, { ...stroke, ...lower, roll: -Math.sign(jog) * 0.35 });
    const upper = { y: top + rise * 0.72, side: jog * 0.6, width: 0.11, height: rise * 0.5 };
    addSlab(site, hole, { ...stroke, ...upper, roll: Math.sign(jog) * 0.3 });
  }
  // The rim above split by the root diving under it.
  const split = { angle: rimAngle, r: lip + 0.06, y: ground.y + 0.06 + size * 0.2 };
  addChunk(site, { ...split, side: (random() - 0.5) * 0.3, scale: 1.1, tilt: 0.5 });
  return site.shards;
}

/**
 * The chunks one root breaks out of its planter, seeded: where it rolls over
 * the lip, two rim pieces levered up either side of it (a hard planter just
 * cracks: smaller pieces); where it bursts through the side, a ring of broken
 * wall round the hole, one fallen lower, and the rim above split.
 */
export function rootShards(
  root: { readonly angle: number; readonly reach: number },
  index: number,
  trunk: number,
  ground: TreeGround,
  plan: RootBreak,
  seed = 1,
): RootShard[] {
  if (plan.heave < 0.2 || !ground.lip) return [];
  const random = seededRandom((hash32((seed ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0) ^ 0x2545f491) >>> 0);
  const { hard } = planterWall(ground);
  const phase = root.angle * 7.3;
  const angleAt = (s: number): number =>
    root.angle + 0.3 * Math.sin(s * 0.7 + phase) + 0.06 * Math.sin(s * 2.1 + phase * 1.7);
  const size = (0.2 + 0.2 * plan.heave) * (hard ? 0.7 : 1);
  const thick = Math.max(trunk * 0.25, 0.1);
  // Where it reaches the rim: the lip at the root's own angle there.
  const rimS = Math.max(0.1, ground.lip(root.angle) - 0.12 - trunk * 0.5);
  const rimAngle = angleAt(rimS);
  const lip = ground.lip(rimAngle) - 0.12;
  const site: ShardSite = { random, ground, plan, hard, size, thick, shards: [], rimAngle, lip };
  if (plan.burst <= 0) {
    if ((0.3 + trunk * 16) * root.reach < lip + 0.1) return [];
    return rimShards(site);
  }
  const holeAngle = angleAt(rimS + BURST_OUT * 0.5);
  return holeShards(site, { angle: holeAngle, lip: ground.lip(holeAngle) - 0.12 });
}
