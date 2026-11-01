// An umbrella: built up and open over its holder, then taken back into the hand's resting place to ride on its bone.

import { FRONT, TAU, cross, lerpV, madd, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import { restSkeleton } from "../motion/skeleton.js";
import { SHAFT, gripOf, heldHand } from "../mesh/parts.js";
import { headFrame } from "../head/head.js";
import type { Net } from "../body/field.js";
import { normalsOf, quad, rowOf, shellOf } from "../body/cage.js";
import type { Cage } from "../body/cage.js";
import { FABRICS } from "./fabric.js";

/** An umbrella as it is built: its cage, its shaft's line and the two directions across it, and its ends. */
interface Brolly {
  readonly cage: Cage;
  readonly axis: Vec;
  readonly flat: Vec;
  readonly deep: Vec;
  readonly grip: Vec;
  readonly tip: Vec;
  /** A point in the hand's held frame, taken back to its resting one. */
  readonly back: (at: Vec) => Vec;
  /** Adds one row to the cage, on the hand's bone. */
  readonly add: (at: Vec) => void;
}

/** The canopy: rings down from the tip, each a little ribbed, quilted together. */
function canopyOf({ cage, axis, flat, deep, tip, back, add }: Brolly): void {
  const around = 24;
  const rings = 7;
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < around; i += 1) {
      const a = (i / around) * TAU;
      const k = (j + 0.05) / (rings - 1);
      const rib = 1 - 0.07 * k * Math.abs(Math.cos(a * 4));
      const spoke = madd(madd(tip, axis, -0.24 * k * k), flat, Math.cos(a) * 0.56 * k * rib);
      add(madd(spoke, deep, Math.sin(a) * 0.56 * k * rib));
    }
  }
  const inner = back(madd(tip, axis, -0.3));
  for (let j = 0; j + 1 < rings; j += 1) {
    for (let i = 0; i < around; i += 1) {
      const at = (x: number, y: number): number => y * around + (x % around);
      quad(cage, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], inner, 1);
    }
  }
}

/** The shaft: a thin tube from below the grip to the tip. */
function shaftOf({ cage, axis, flat, deep, grip, tip, back, add }: Brolly): void {
  const base = cage.rows.length;
  for (const end of [madd(grip, axis, -0.09), tip]) {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      add(madd(madd(end, flat, Math.cos(a) * 0.008), deep, Math.sin(a) * 0.008));
    }
  }
  const middle = back(lerpV(grip, tip, 0.5));
  for (let i = 0; i < 6; i += 1) {
    quad(cage, [base + i, base + ((i + 1) % 6), base + 6 + ((i + 1) % 6), base + 6 + i], middle, 2);
  }
}

function umbrellaCage(p: Person): Cage {
  const hand = heldHand(p);
  const back = hand.toRest;
  const axis = SHAFT;
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const grip = hand.toHeld(gripOf(restSkeleton(p).right.arm, unit(hand.spin(SHAFT))).centre);
  const clear = headFrame(restSkeleton(p), p.build.head, p.face).at(0, 1.3, 0)[1] + 0.05;
  // (The rim comes down a little past the top of the head, wherever the hand is.)
  const tip = madd(grip, axis, Math.max(0.5, (clear - grip[1]) / axis[1]) + 0.24);
  const flat = unit(cross(axis, FRONT));
  const deep = cross(flat, axis);
  const bones: readonly (readonly [string, number])[] = [["hand.R", 1]];
  const add = (at: Vec): void => {
    cage.rows.push(rowOf(back(at), bones));
  };
  const brolly: Brolly = { cage, axis, flat, deep, grip, tip, back, add };
  canopyOf(brolly);
  shaftOf(brolly);
  return cage;
}

/** The umbrella a person carries: its canopy one shell, its shaft and frame another. */
export function umbrellaShell(net: Net, p: Person, roles: readonly string[]): void {
  const cage = umbrellaCage(p);
  const canopy = (t: number): boolean => t === 1;
  const size = p.build.size;
  const wear = { roles, size };
  shellOf(net, { body: cage, normals: normalsOf(cage) }, { on: canopy, lift: 0, role: () => "brolly", fabric: FABRICS.nylon }, wear);
  shellOf(net, { body: cage, normals: normalsOf(cage) }, { on: (t) => !canopy(t), lift: 0, role: () => "dark", fabric: FABRICS.latex }, wear);
}
