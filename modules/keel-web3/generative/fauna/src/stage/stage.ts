// Where animals are: the stage, its trunk, perches, roots and food, and the spots on it an animal may take.

import { TAU, UP, add, clamp, lerpV, madd, mix } from "../vec.js";
import type { Vec } from "../vec.js";
import type { SpeciesId } from "../roster.js";

// ---------------------------------------------------------------- where animals are

/** A place an animal can be: a spot on the ground, a branch perch, a point on the trunk, another animal's back. */
export type Place =
  | { readonly on: "ground"; readonly x: number; readonly z: number }
  | { readonly on: "perch"; readonly i: number }
  | { readonly on: "trunk"; readonly h: number; readonly a: number }
  | { readonly on: "back"; readonly m: number };

/** A point on a branch or the trunk's centreline, and the wood's radius there. */
export interface Wood { readonly p: Vec; readonly r: number }

export interface Perch {
  /** Where on the branch. */
  readonly p: Vec;
  /** Along the branch, outward. */
  readonly d: Vec;
  readonly r: number;
  /** The branch from where it leaves the trunk out to this perch, so climbers walk the wood instead of the air. */
  readonly path?: readonly Wood[] | undefined;
}

/** A surface root, as a capsule lying on the ground: animals step or hop over it, and can stand on it. */
export interface Root { readonly a: Vec; readonly b: Vec; readonly r: number }

/**
 * What the scene gives the animals each frame: the ground they walk, the trunk they climb, the branches they sit in.
 */
export interface Stage {
  /** Walkable radius of the ground around the origin. */
  readonly radius: number;
  /** Height of the ground. */
  readonly top: number;
  /** The ground's height at a point, when it isn't flat. */
  readonly ground?: ((x: number, z: number) => number) | undefined;
  /** The trunk: a straight run from base to top, or its real spine in `path` when it leans or bends. */
  readonly trunk?:
    | { readonly base: Vec; readonly top: Vec; readonly r: number; readonly path?: readonly Wood[] | undefined }
    | null
    | undefined;
  readonly perches?: readonly Perch[] | undefined;
  /** Roots on the ground, which raise it where they lie. */
  readonly roots?: readonly Root[] | undefined;
  /** Fruit to eat, on the branches and on the ground. */
  readonly food?: readonly Food[] | undefined;
  readonly night?: boolean | undefined;
  /** The weather ("rain" and "snow" send animals to shelter and rest; anything else is fair). */
  readonly weather?: string | undefined;
  /** The sun's height above the horizon, in degrees: dawn and dusk bring the birds' chorus and the wolves' howl. */
  readonly sun?: number | undefined;
  /**
   * Toward the viewer, along the ground. Given, an animal choosing a spot
   * leans toward the open side of the tree, where it can be seen, rather
   * than behind the trunk.
   */
  readonly view?: Vec | undefined;
}

/** Something to eat: a fruit up in the tree (reached from a perch) or lying on the ground. */
export interface Food {
  /** Holds while it hangs, falls and lies, so two animals never go for the same one. */
  readonly key: string;
  readonly p: Vec;
  /** The perch (an index into `Stage.perches`) it is eaten from; left out, it lies on the ground. */
  readonly perch?: number | undefined;
}

/**
 * Who eats fruit, and where it gets it: "tree" off the branch (it must climb
 * or fly), "ground" only what has fallen, "both" either.
 */
export const FRUIT_EATERS: Readonly<Partial<Record<SpeciesId, "tree" | "ground" | "both">>> = {
  rabbit: "ground", fox: "ground", deer: "ground", bear: "ground", raccoon: "both", hedgehog: "ground", mouse: "ground",
  capybara: "ground", tortoise: "ground", squirrel: "both", redpanda: "both", macaque: "both", monkey: "both", sloth: "tree",
  songbird: "both", crow: "both", parrot: "both", peacock: "ground",
  tanuki: "ground", marmot: "ground", badger: "ground", skunk: "ground", possum: "both", mongoose: "ground", dikdik: "ground",
  guineafowl: "ground", loris: "tree",
};
/** How often an eater with fruit in reach goes to eat instead of idling. */
export const APPETITE = 0.3;

export interface Anchor { readonly p: Vec; readonly up: Vec; readonly along: Vec | null }

export const bareY = (stage: Stage, x: number, z: number): number => stage.ground?.(x, z) ?? stage.top;

/** The top of whatever root lies under a point, or -Infinity where none does. */
function rootTop(stage: Stage, x: number, z: number): number {
  let top = -Infinity;
  for (const root of stage.roots ?? []) {
    const dx = root.b[0] - root.a[0];
    const dz = root.b[2] - root.a[2];
    const span = dx * dx + dz * dz;
    const t = span > 1e-9 ? clamp(((x - root.a[0]) * dx + (z - root.a[2]) * dz) / span, 0, 1) : 0;
    const gap = Math.hypot(x - (root.a[0] + dx * t), z - (root.a[2] + dz * t));
    if (gap < root.r) top = Math.max(top, mix(root.a[1], root.b[1], t) + Math.sqrt(root.r * root.r - gap * gap));
  }
  return top;
}

/** The ground's height at a point, roots included. */
export const groundY = (stage: Stage, x: number, z: number): number =>
  Math.max(bareY(stage, x, z), rootTop(stage, x, z));
export const perchOf = (stage: Stage, i: number): Perch | undefined => {
  const list = stage.perches ?? [];
  return list.length > 0 ? list[((i % list.length) + list.length) % list.length] : undefined;
};
export const trunkR = (stage: Stage): number => stage.trunk?.r ?? 0;

/**
 * The trunk's centre and radius at height share `h` (0 at its base, 1 at its top), following its spine when it has one.
 */
export function trunkAxis(trunk: NonNullable<Stage["trunk"]>, h: number): Wood {
  const k = clamp(h, 0, 1);
  const spine = trunk.path ?? [];
  if (spine.length < 2) return { p: lerpV(trunk.base, trunk.top, k), r: trunk.r * (1 - 0.35 * k) };
  const y = mix(trunk.base[1], trunk.top[1], k);
  let a = spine[0] ?? { p: trunk.base, r: trunk.r };
  for (const b of spine.slice(1)) {
    if (y <= b.p[1]) {
      const u = clamp((y - a.p[1]) / Math.max(1e-6, b.p[1] - a.p[1]), 0, 1);
      return { p: lerpV(a.p, b.p, u), r: mix(a.r, b.r, u) };
    }
    a = b;
  }
  return a;
}

export function trunkPoint(stage: Stage, h: number, a: number): Anchor {
  const trunk = stage.trunk;
  if (!trunk) return { p: [Math.cos(a) * 0.2, stage.top, Math.sin(a) * 0.2], up: UP, along: null };
  const out: Vec = [Math.cos(a), 0, Math.sin(a)];
  const axis = trunkAxis(trunk, h);
  return { p: madd(axis.p, out, axis.r), up: out, along: null };
}

/** Height share of a world height on the trunk. */
export const trunkShare = (trunk: NonNullable<Stage["trunk"]>, y: number): number => clamp((y - trunk.base[1]) / Math.max(0.01, trunk.top[1] - trunk.base[1]), 0, 1);

/** Where a place is in the world this frame. */
export function anchorOf(place: Place, stage: Stage, backs: readonly (Anchor | null)[]): Anchor {
  if (place.on === "ground") return { p: [place.x, groundY(stage, place.x, place.z), place.z], up: UP, along: null };
  if (place.on === "trunk") return trunkPoint(stage, place.h, place.a);
  if (place.on === "back") return backs[place.m] ?? { p: [0, stage.top, 0], up: UP, along: null };
  const perch = perchOf(stage, place.i);
  if (!perch) return { p: [trunkR(stage) + 0.3, stage.top, 0], up: UP, along: null };
  return { p: add(perch.p, [0, perch.r, 0]), up: UP, along: perch.d };
}

/** Where another animal is, or is headed, and how much room it takes. */
export interface Spot { readonly p: Vec; readonly size: number }

/** How far from the trunk's middle an animal stands so its head and legs keep out of the bark. */
export const trunkClear = (stage: Stage, size: number): number => trunkR(stage) + size * 1.2 + 0.1;

const turnTo = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/**
 * A heading to look for a spot along: toward the viewer, when there is one, of four picks the nearest to it, so the far
 * side (behind the trunk, from the camera) is rare, not barred.
 */
function headingFor(rand: () => number, stage: Stage): number {
  if (!stage.view) return rand() * TAU;
  const view = Math.atan2(stage.view[2], stage.view[0]);
  let best = rand() * TAU;
  for (let i = 0; i < 3; i += 1) {
    const a = rand() * TAU;
    if (turnTo(a, view) < turnTo(best, view)) best = a;
  }
  return best;
}

/**
 * Whether a spot on the ground is round the back of the tree from the viewer (more than a little past the trunk's
 * side).
 */
function farSide(stage: Stage, x: number, z: number): boolean {
  if (!stage.view) return false;
  const v = Math.hypot(stage.view[0], stage.view[2]);
  const d = Math.hypot(x, z);
  return v > 0 && d > 0 && (x * stage.view[0] + z * stage.view[2]) / (v * d) < -0.2;
}

/** Whether a spot lies between the trunk's clearance and the rim, with room from the others. */
function spotFree(x: number, z: number, inner: number, outer: number, size: number, taken: readonly Spot[]): boolean {
  const d = Math.hypot(x, z);
  return (
    d >= inner &&
    d <= outer &&
    taken.every((other) => Math.hypot(other.p[0] - x, other.p[2] - z) >= (other.size + size) * 0.8)
  );
}

/**
 * A free spot on the ground, clear of the trunk, the rim and the others.
 * Spots lean out toward the rim, past the root tangle and the canopy's shade,
 * where an animal stands against open ground and not among the roots.
 */
export function groundSpot(
  rand: () => number,
  stage: Stage,
  size: number,
  near?: Vec,
  reach = 0,
  taken: readonly Spot[] = [],
): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.2, stage.radius - size * 0.8);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const a = headingFor(rand, stage);
    const r = near ? reach * Math.sqrt(rand()) : mix(inner, outer, rand() ** 0.35);
    const x = (near?.[0] ?? 0) + Math.cos(a) * r;
    const z = (near?.[2] ?? 0) + Math.sin(a) * r;
    // (The first tries keep off the far side, behind the trunk and its roots from the camera; the last take what there
    // is.)
    if (spotFree(x, z, inner, outer, size, taken) && (attempt >= 8 || !farSide(stage, x, z)))
      return { on: "ground", x, z };
  }
  const a = headingFor(rand, stage);
  const r = mix(inner, outer, 0.5);
  return { on: "ground", x: Math.cos(a) * r, z: Math.sin(a) * r };
}
