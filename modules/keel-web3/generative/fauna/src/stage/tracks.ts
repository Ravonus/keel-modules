// Tracks: the prints feet leave, shaped like their own, that dirt lets go of long before snow.

import { SPECIES } from "../roster.js";
import type { Foot, Plan, SpeciesId } from "../roster.js";
import type { Body } from "../animals/bodies.js";
import type { Capsule } from "./moments.js";

/** What a foot comes down on. */
export type Tread = "snow" | "sand" | "dirt";

/** One foot's mark on the ground, where and as the critter actually set it down. */
export interface Print {
  readonly id: string;
  readonly kind: string;
  readonly shape: PrintShape;
  readonly hind: boolean;
  readonly x: number;
  readonly z: number;
  /** The way it was walking. */
  readonly front: readonly [number, number];
  readonly size: number;
  readonly tread: Tread;
  readonly born: number;
}

export type PrintShape = Foot | "bird" | "hand" | "pincer" | "drag";

/** How long a print lasts on each ground, in seconds, and how dark it starts: dirt barely takes one. */
export const TREADS: Readonly<Record<Tread, { readonly life: number; readonly depth: number }>> = {
  snow: { life: 48, depth: 0.85 },
  sand: { life: 20, depth: 0.6 },
  dirt: { life: 7, depth: 0.32 },
};

/** A print's blobs, foot-sized, across and along the way it walks: [across, along, half width, half length]. */
const PRINT_BLOBS: Readonly<Record<PrintShape, readonly (readonly [number, number, number, number])[]>> = {
  paw: [
    [0, -0.18, 0.34, 0.3],
    [-0.42, 0.22, 0.15, 0.19],
    [-0.15, 0.48, 0.15, 0.2],
    [0.15, 0.48, 0.15, 0.2],
    [0.42, 0.22, 0.15, 0.19],
  ],
  hoof: [
    [-0.2, 0.05, 0.16, 0.5],
    [0.2, 0.05, 0.16, 0.5],
  ],
  plant: [
    [0, -0.2, 0.36, 0.56],
    [-0.42, 0.5, 0.13, 0.15],
    [-0.21, 0.62, 0.13, 0.16],
    [0, 0.66, 0.13, 0.16],
    [0.21, 0.62, 0.13, 0.16],
    [0.42, 0.5, 0.13, 0.15],
  ],
  bird: [
    [0, 0.3, 0.07, 0.62],
    [-0.3, 0.42, 0.07, 0.42],
    [0.3, 0.42, 0.07, 0.42],
    [0, -0.35, 0.07, 0.28],
  ],
  hand: [
    [0, -0.2, 0.3, 0.42],
    [-0.48, 0.02, 0.1, 0.26],
    [-0.2, 0.46, 0.1, 0.24],
    [0, 0.5, 0.1, 0.26],
    [0.2, 0.46, 0.1, 0.24],
  ],
  pincer: [[0, 0, 0.14, 0.34]],
  drag: [[0, 0, 0.42, 0.62]],
};

/** Which capsules of a body leave a mark, by its plan: a foot's last bone, or a snake's belly at one point along it. */
const TREADERS: Readonly<Partial<Record<Plan, RegExp>>> = {
  quad: /^leg\.[FH][LR]\.paw$/,
  primate: /^(?:leg|arm)\.[LR]\.paw$/,
  bird: /^leg\.[LR]\.toe\.1$/,
  crab: /^leg\.-?1\.\d\.lower$/,
  serpent: /^body\.5$/,
};

const printShapeOf = (species: (typeof SPECIES)[SpeciesId], part: string): PrintShape => {
  if (species.plan === "bird") return "bird";
  if (species.plan === "crab") return "pincer";
  if (species.plan === "serpent") return "drag";
  if (species.plan === "primate") return part.startsWith("arm") ? "hand" : "plant";
  return species.build.foot;
};

export interface Tracks {
  /** Everything down on the ground now, oldest first. */
  readonly prints: readonly Print[];
  /** Reads where the bodies' feet are this frame and stamps those that have just come down. */
  step(bodies: readonly Body[], t: number): void;
  /** Lifts prints off one ground at once (the snow they were in has melted). */
  clear(tread: Tread): void;
  /**
   * Paints the prints into a square rgba map of `extent` either side of the origin, its rows running from +z, as a
   * plane's uvs do.
   */
  paint(
    pixels: Uint8Array,
    side: number,
    extent: number,
    t: number,
    tint: (tread: Tread) => readonly [number, number, number],
  ): void;
}

/** What the tracks lie on: how high the ground is, what is underfoot at a point, and how many prints it keeps. */
export interface Ground {
  readonly floor: number;
  readonly tread: (x: number, z: number) => Tread | null;
  readonly limit?: number;
}

/** One foot as the tracks last saw it: whether it is down, where, and when. */
interface Footing { down: boolean; x: number; z: number; seen: number }

/** The species of a body that can leave prints, or null for one that is not in the roster or is fading in or out. */
function treading(body: Body): (typeof SPECIES)[SpeciesId] | null {
  const species = SPECIES[body.kind as SpeciesId] as (typeof SPECIES)[SpeciesId] | undefined;
  return !species || (body.fade ?? 1) < 0.5 ? null : species;
}

/** Whether a part of a plan's body treads the ground, remembered once asked. */
function treadsPart(cache: Map<string, boolean>, plan: Plan, part: string): boolean {
  const key = `${plan}:${part}`;
  let is = cache.get(key);
  if (is === undefined) {
    is = TREADERS[plan]?.test(part) ?? false;
    cache.set(key, is);
  }
  return is;
}

/** The ground and the feet on it as a frame is read. */
interface Footfall { readonly ground: Ground; readonly feet: Map<string, Footing>; readonly t: number }

/** The print a body's part leaves this frame, if it has just come down on ground that takes one. */
function footfall(on: Footfall, body: Body, species: (typeof SPECIES)[SpeciesId], c: Capsule): Print | null {
  const { ground, feet, t } = on;
  const low = c.a[1] < c.b[1] ? c.a : c.b;
  const key = `${body.id}:${c.part}`;
  const reach = Math.min(0.05, Math.max(0.026, c.r * 0.5));
  const height = low[1] - c.r - ground.floor;
  const foot = feet.get(key) ?? { down: false, x: low[0], z: low[2], seen: t };
  const moved = Math.hypot(low[0] - foot.x, low[2] - foot.z);
  const size = Math.max(c.r * 2.8, 0.1);
  const drag = species.plan === "serpent";
  foot.seen = t;
  feet.set(key, foot);
  // Up again once it has clearly left the ground; down, the print is made the once.
  if (height > reach * 1.6) foot.down = false;
  if (height > reach || (foot.down && !(drag && moved > size * 0.8))) return null;
  foot.down = true;
  foot.x = low[0];
  foot.z = low[2];
  const tread = ground.tread(low[0], low[2]);
  if (tread === null) return null;
  const f = Math.hypot(body.front[0], body.front[2]) || 1;
  return { id: body.id, kind: body.kind, shape: printShapeOf(species, c.part), hind: c.part.includes(".H"), x: low[0], z: low[2], front: [body.front[0] / f, body.front[2] / f], size, tread, born: t };
}

/**
 * The map prints are painted into: its pixels, its side in them, its reach either side of the origin, and the scale.
 */
interface Canvas { readonly pixels: Uint8Array; readonly side: number; readonly extent: number; readonly scale: number }

/** A print's colour and how dark it is now. */
interface Ink { readonly red: number; readonly green: number; readonly blue: number; readonly alpha: number }

/** One blob of a print stamped into the map, over whatever fainter mark is there. */
function stampBlob(map: Canvas, p: Print, blob: readonly [number, number, number, number], ink: Ink): void {
  const { pixels, side, extent, scale } = map;
  const [fx, fz] = p.front;
  const [across, along, w, l] = blob;
  const stretch = p.hind ? 1.2 : 1;
  const cx = p.x + (fz * across + fx * along * stretch) * p.size;
  const cz = p.z + (-fx * across + fz * along * stretch) * p.size;
  const reach = Math.max(w, l * stretch) * p.size;
  const c0 = Math.max(0, Math.floor((cx - reach + extent) * scale));
  const c1 = Math.min(side - 1, Math.ceil((cx + reach + extent) * scale));
  const r0 = Math.max(0, Math.floor((extent - cz - reach) * scale));
  const r1 = Math.min(side - 1, Math.ceil((extent - cz + reach) * scale));
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const dx = (c + 0.5) / scale - extent - cx;
      const dz = extent - (r + 0.5) / scale - cz;
      const u = (fz * dx - fx * dz) / (w * p.size);
      const v = (fx * dx + fz * dz) / (l * stretch * p.size);
      if (u * u + v * v > 1) continue;
      const at = (r * side + c) * 4;
      const have = pixels[at + 3];
      if (have !== undefined && have >= ink.alpha) continue;
      pixels[at] = ink.red;
      pixels[at + 1] = ink.green;
      pixels[at + 2] = ink.blue;
      pixels[at + 3] = ink.alpha;
    }
  }
}

/** A print painted into the map as it is at `t`: fading as it ages, and gone once its ground has let it go. */
function paintPrint(map: Canvas, p: Print, t: number, tint: (tread: Tread) => readonly [number, number, number]): void {
  const { life, depth } = TREADS[p.tread];
  const age = (t - p.born) / life;
  if (age < 0 || age >= 1) return;
  const alpha = depth * (1 - age * age) * 255;
  const [red, green, blue] = tint(p.tread);
  for (const blob of PRINT_BLOBS[p.shape]) stampBlob(map, p, blob, { red, green, blue, alpha });
}

/**
 * The ground's memory of who walked it. A foot leaves a print each time it comes down, so a critter's track
 * is its own: its foot's shape and size, spaced by its own gait, a rabbit's bound or a deer's walk. `tread`
 * says what is underfoot at a point (null where nothing takes a print) and `floor` how high that ground is.
 */
export function createTracks(options: Ground): Tracks {
  const limit = options.limit ?? 360;
  let prints: Print[] = [];
  const feet = new Map<string, Footing>();
  const treader = new Map<string, boolean>();
  return {
    get prints() { return prints; },
    clear(tread) { prints = prints.filter((p) => p.tread !== tread); },
    step(bodies, t) {
      prints = prints.filter((p) => t - p.born < TREADS[p.tread].life && p.born <= t);
      for (const body of bodies) {
        const species = treading(body);
        if (!species) continue;
        for (const c of body.capsules) {
          if (!treadsPart(treader, species.plan, c.part)) continue;
          const print = footfall({ ground: options, feet, t }, body, species, c);
          if (print) prints.push(print);
        }
      }
      if (prints.length > limit) prints = prints.slice(prints.length - limit);
      for (const [key, foot] of feet) if (t - foot.seen > 4 || t < foot.seen) feet.delete(key);
    },
    paint(pixels, side, extent, t, tint) {
      pixels.fill(0);
      const map: Canvas = { pixels, side, extent, scale: side / (2 * extent) };
      for (const p of prints) paintPrint(map, p, t, tint);
    },
  };
}
