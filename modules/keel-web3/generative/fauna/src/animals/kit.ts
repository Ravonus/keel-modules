// The kit: capsules in the animal's own frame, and the build a seed gives one animal.

import { UP, add, clamp, cross, dirToWorld, madd, rollV, solveTwoBone, sub, toWorld, unit } from "../vec.js";
import type { Frame, Vec } from "../vec.js";
import type { Build, Role } from "../roster.js";
import type { Capsule, Finish } from "../stage/moments.js";
import type { CastMember } from "../casting.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- the kit: capsules in the animal's own frame

export interface Kit {
  readonly f: Frame;
  readonly out: Capsule[];
  /** A turn of the whole body about its long axis (a roll onto the back, a shake), about `pivot`. */
  readonly roll: number;
  readonly pivot: Vec;
}

const rolled = (kit: Kit, v: Vec): Vec => (kit.roll === 0 ? v : add(rollV(sub(v, kit.pivot), kit.roll), kit.pivot));

/** Where a capsule lies: its ends and radius, and as it needs them its flatness, its up and its finish. */
export interface Span {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly finish?: Finish;
}

export function cap(kit: Kit, part: string, role: Role, span: Span): void {
  const { a, b, r, flat: flatness = 1, up = UP, finish } = span;
  if (!(r > 0.0002)) return;
  const upRolled = kit.roll === 0 ? up : rollV(up, kit.roll);
  const capsule: Capsule = {
    a: toWorld(kit.f, rolled(kit, a)),
    b: toWorld(kit.f, rolled(kit, b)),
    r,
    role,
    part,
    flat: flatness,
    up: unit(dirToWorld(kit.f, upRolled), kit.f.y),
    fw: kit.f.z,
  };
  kit.out.push(finish ? { ...capsule, ...finished(kit, finish) } : capsule);
}
/** A row's beads, and how far each reaches. */
function rowOf(kit: Kit, finish: Finish): Partial<Capsule> {
  return {
    ...(finish.row === undefined ? {} : { row: finish.row }),
    ...(finish.reach === undefined
      ? {}
      : { reach: dirToWorld(kit.f, kit.roll === 0 ? finish.reach : rollV(finish.reach, kit.roll)) }),
    ...(finish.sharp ? { sharp: true } : {}),
    ...(finish.detail === undefined ? {} : { detail: finish.detail }),
  };
}
/** What a finish adds to a capsule. */
function finished(kit: Kit, finish: Finish): Partial<Capsule> {
  return {
    ...(finish.r1 === undefined ? {} : { r1: Math.max(0, finish.r1) }),
    ...(finish.melt === undefined ? {} : { melt: finish.melt }),
    ...(finish.decal === true ? { decal: true } : {}),
    ...(finish.under === true ? { under: true } : {}),
    ...(finish.carve === true ? { carve: true } : {}),
    ...(finish.shadow === false ? { shadow: false } : {}),
    ...(finish.bare === true ? { bare: true } : {}),
    ...rowOf(kit, finish),
    ...(finish.bow === undefined
      ? {}
      : { bow: dirToWorld(kit.f, kit.roll === 0 ? finish.bow : rollV(finish.bow, kit.roll)) }),
  };
}
/** A tapered part: r at a, r1 at b, melting `melt` as far as the rest. */
export function cone(kit: Kit, part: string, role: Role, span: Omit<Span, "flat" | "up" | "finish"> & { readonly r1: number; readonly melt?: number }): void {
  const { a, b, r, r1, melt = 1 } = span;
  cap(kit, part, role, { a, b, r, flat: 1, up: UP, finish: { r1, melt } });
}
/** A patch of colour on the body (no surface of its own): a bib, a rump, a mask. */
export function decal(kit: Kit, part: string, role: Role, span: Pick<Span, "a" | "b" | "r">): void {
  const { a, b, r } = span;
  cap(kit, part, role, { a, b, r, flat: 1, up: UP, finish: { decal: true } });
}
/** A round part at `p`. */
export function ball(
  kit: Kit,
  part: string,
  role: Role,
  dot: { readonly p: Vec; readonly r: number; readonly flat?: number; readonly up?: Vec },
): void {
  const { p, r, flat: flatness = 1, up = UP } = dot;
  cap(kit, part, role, { a: p, b: p, r, flat: flatness, up });
}

/** A limb's reach: from `root` to `target`, bending toward `pole`, each bone's length, and how it ends. */
export interface Reach {
  readonly root: Vec;
  readonly target: Vec;
  readonly lengths: readonly [number, number];
  readonly radius: number;
  readonly pole: Vec;
  readonly end?: Role;
  readonly melt?: number;
}

/** A two-bone limb from `root` to `target`, bending toward `pole`, with a paw (or hand, or foot) at the end. */
export function limb(kit: Kit, part: string, role: Role, reach: Reach): Vec {
  const { root, target, lengths, radius, pole, end = "dark", melt } = reach;
  // A target on the ground (or the bark) is where the sole meets it: the paw's
  // centre sits its own height above, fading out as the foot lifts.
  const sole = radius * 0.8;
  const lifted: Vec = [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]];
  const { mid, end: tip } = solveTwoBone(root, lifted, lengths[0], lengths[1], pole);
  if (melt === undefined) {
    cap(kit, `${part}.upper`, role, { a: root, b: mid, r: radius });
    cap(kit, `${part}.lower`, role, { a: mid, b: tip, r: radius * 0.78 });
    ball(kit, `${part}.paw`, end, { p: tip, r: radius * 0.95, flat: 0.75 });
    return tip;
  }
  // (Tapered, and melting only `melt` as far, so a limb stays a limb against the body.)
  cone(kit, `${part}.upper`, role, { a: root, b: mid, r: radius, r1: radius * 0.8, melt: Math.max(melt, 0.6) });
  cone(kit, `${part}.lower`, role, { a: mid, b: tip, r: radius * 0.78, r1: radius * 0.6, melt });
  cap(kit, `${part}.paw`, end, { a: tip, b: tip, r: radius * 0.85, flat: 0.75, up: UP, finish: { melt } });
  return tip;
}

/** A footfall cycle: the foot slides back on the ground for `duty` of the stride, then lifts and swings forward. */
export function footCycle(q: number, duty: number, stride: number, lift: number): { z: number; y: number } {
  const u = q - Math.floor(q);
  if (u < duty) return { z: stride * (0.5 - u / duty), y: 0 };
  const s = (u - duty) / (1 - duty);
  return { z: stride * (s - 0.5), y: lift * Math.sin(Math.PI * s) };
}

// ---------------------------------------------------------------- one animal's own build

const BUILDS = new WeakMap<object, Build>();
/**
 * This animal's proportions: its kind's build times its own traits (a fox
 * with longer legs, a rabbit with a bigger head), worked out once for it.
 */
export function buildOf(who: Who): Build {
  const t = (who.member as Partial<Pick<CastMember, "traits">>).traits;
  const b = who.spec.build;
  if (!t) return b;
  const known = BUILDS.get(who.member);
  if (known) return known;
  const own: Build = {
    ...b,
    len: b.len * t.len,
    leg: b.leg * t.leg,
    body: b.body * t.body,
    head: b.head * t.head,
    snout: b.snout * t.snout,
    neck: b.neck * t.neck,
    tailLen: b.tailLen * t.tail,
    earLen: b.earLen * t.ears,
  };
  BUILDS.set(who.member, own);
  return own;
}


export function headAxes(hd: Vec, roll: number): { s: Vec; u: Vec } {
  const hs = unit(cross(UP, hd), [1, 0, 0]);
  const hu = cross(hd, hs);
  return roll === 0 ? { s: hs, u: hu } : { s: unit(madd(hs, hu, -roll)), u: unit(madd(hu, hs, roll)) };
}

/** A number in [0, 1) that is this bird's own (its size was seeded), so no two keep the same wingbeat. */
export function ownPhase(who: Who): number {
  const v = Math.sin(who.member.heft * 12.9898 + who.member.size * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
