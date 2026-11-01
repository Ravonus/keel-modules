// Perches: which branch spots have room for an animal, clear of the wood and of each other, and the picking of one.

import { add, clamp, dot, length, madd, mix, sub } from "../vec.js";
import type { Vec } from "../vec.js";
import { anchorOf, groundSpot, perchOf, trunkAxis, trunkShare } from "./stage.js";
import type { Place, Stage, Wood } from "./stage.js";
import { inTrunk, woodKey, woodMapOf, woodNear } from "./paths.js";
import { liesAlong } from "./moments.js";
import { placeTop, takenBy } from "./director.js";
import type { Actor, Scene } from "./director.js";

export const perchCount = (scene: Scene): number => scene.stage.perches?.length ?? 0;
/** Whether a spot on a branch is far enough out from the trunk that the animal's body and tail keep out of the bark. */
export function perchRoom(stage: Stage, i: number, size: number): boolean {
  const perch = perchOf(stage, i);
  const trunk = stage.trunk;
  if (!perch || !trunk) return true;
  const axis = trunkAxis(trunk, trunkShare(trunk, perch.p[1]));
  return Math.hypot(perch.p[0] - axis.p[0], perch.p[2] - axis.p[2]) >= axis.r + size * 0.7;
}

/** How near a point lies to a stretch of wood, its surface taken off. */
export function offWood(p: Vec, a: Wood, b: Wood): number {
  const ab = sub(b.p, a.p);
  const ee = dot(ab, ab);
  const k = ee < 1e-9 ? 0 : clamp(dot(sub(p, a.p), ab) / ee, 0, 1);
  return length(sub(p, madd(a.p, ab, k))) - mix(a.r, b.r, k);
}

/** Whether a body sat on perch `i` keeps out of every limb but its own. */
function woodClear(stage: Stage, i: number, r: number): boolean {
  const perch = perchOf(stage, i);
  if (!perch) return true;
  const own = new Set((perch.path ?? []).map(woodKey));
  const map = woodMapOf(stage);
  const body = add(perch.p, [0, perch.r + r, 0]);
  const around = [body, madd(body, perch.d, r), madd(body, perch.d, -r)];
  const keep = r * 0.6;
  return around.every((p) =>
    woodNear(map, p, keep + map.thickest).every(
      (edge) => own.has(edge.keys[0]) || own.has(edge.keys[1]) || offWood(p, edge.a, edge.b) >= keep,
    ),
  );
}

/** Whether no one in the troupe sits there, or is on the way, within a body's length. */
export function perchFree(actor: Actor, scene: Scene, i: number): boolean {
  const at = placeTop({ on: "perch", i }, scene);
  const wooded = (place: Place): boolean => place.on === "perch" || place.on === "trunk";
  const limb = limbOf(scene.stage, i);
  // (A snake takes up its whole limb, lying along it.)
  const shares = (mate: Actor): boolean => (liesAlong(actor) || liesAlong(mate)) && mate.place.on === "perch" && limbOf(scene.stage, mate.place.i) === limb;
  return actor.mates.every(
    (mate) =>
      mate === actor ||
      !wooded(mate.place) ||
      (!shares(mate) && length(sub(placeTop(mate.place, scene), at)) >= (mate.member.size + actor.member.size) * 0.75),
  );
}

/** Which limb a perch is on, as a number that doesn't depend on the order perches are listed. */
function limbOf(stage: Stage, i: number): number {
  const root = perchOf(stage, i)?.path?.[1]?.p ?? perchOf(stage, i)?.p ?? [0, 0, 0];
  return Math.abs(Math.round(Math.atan2(root[2], root[0]) * 3 + root[1] * 7));
}

const bodyRadius = (actor: Actor): number => actor.spec.build.body * actor.member.size;

/** How much limb a perch has behind it. */
function limbLength(stage: Stage, i: number): number {
  const path = perchOf(stage, i)?.path ?? [];
  return path.slice(1).reduce((sum, wood, k) => sum + length(sub(wood.p, path[k]?.p ?? wood.p)), 0);
}

/**
 * Whether a body fits on a perch: wood that will bear it, out from the trunk, clear of other limbs, and long enough for
 * a snake to lie on.
 */
export function perchFits(actor: Actor, stage: Stage, i: number): boolean {
  const size = actor.member.size;
  const r = bodyRadius(actor);
  const seat = anchorOf({ on: "perch", i }, stage, []).p;
  if ((perchOf(stage, i)?.r ?? 1) < r * 0.2 || inTrunk(seat, stage.trunk) || !woodClear(stage, i, r)) return false;
  return liesAlong(actor) ? limbLength(stage, i) >= size : perchRoom(stage, i, size);
}

/**
 * A branch to sit on that fits the animal and is free of the others, or a spot
 * on the ground when the tree has no room left: a small tree holds only so many.
 */
export function randomPerch(actor: Actor, scene: Scene): Place {
  const { stage } = scene;
  const ours = (i: number): boolean => limbOf(stage, i) % actor.limbs[1] === actor.limbs[0];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const i = Math.floor(actor.rand() * 9973);
    if ((attempt >= 8 || ours(i)) && perchFits(actor, stage, i) && perchFree(actor, scene, i)) return { on: "perch", i };
  }
  return groundSpot(actor.rand, stage, actor.member.size, { taken: takenBy(actor, scene) });
}

/**
 * The branch spot nearest `i` in the list that has room for the animal, and keeps `apart.gap` from `apart.beside`
 * when given, or `i` when none does.
 */
export function roomyPerch(
  stage: Stage,
  i: number,
  size: number,
  apart?: { readonly beside: number; readonly gap: number },
): number {
  const count = stage.perches?.length ?? 0;
  const near = apart === undefined ? null : (perchOf(stage, apart.beside)?.p ?? null);
  const roomy = (j: number): boolean => {
    const at = perchOf(stage, j)?.p;
    return (
      perchRoom(stage, j, size) &&
      woodClear(stage, j, size * 0.25) &&
      (!near || !at || length(sub(at, near)) >= (apart?.gap ?? 0))
    );
  };
  for (let k = 0; k < count; k += 1) {
    for (const j of [i + k, i - k]) if (roomy(j)) return j;
  }
  return i;
}
