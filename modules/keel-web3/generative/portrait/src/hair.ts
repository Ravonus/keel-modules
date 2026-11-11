// Hair as clumps: each lock a flattened tube along a guide that starts under the cap's cuff, falls with gravity,
// spreads out from the head and is pushed out of the head, neck and shoulders, its strands curling in a wave that
// grows toward the tip. Locks lie in layers so the mass has volume. Everything a seed decides is in exact
// arithmetic.

import { cosine, sine, unit } from "./exact.js";
import { gradient } from "./mesh.js";
import { rotOut } from "./sdf.js";
import type { Field, M3, V3 } from "./sdf.js";
import type { CapFrame } from "./cap.js";

export interface HairRecipe {
  readonly seed: number;
  /** How many locks, and the rings and segments of each. */
  readonly locks: number;
  readonly segments: number;
  readonly sides: number;
  /** How long the hair falls, in metres. */
  readonly length: number;
}

/** A lock's guide: points from root to tip, in the head's frame. */
type Guide = [number, number, number][];

/** Where the head sits in the bust: hair is built in the bust's frame, its roots placed by the head. */
export interface HairPlace {
  readonly turn: M3;
  readonly at: V3;
}

interface Lock {
  readonly guide: Guide;
  readonly length: number;
  readonly centre: V3;
  readonly width: number;
  readonly thick: number;
  readonly curl: number;
  readonly wave: number;
  readonly phase: number;
  readonly tone: number;
}

const TAU = 6.283185307179586;

/** Where a lock starts: on the cuff's lower edge, `around` turns from the front, tucked a little under it. */
function root(cap: CapFrame, around: number, place: HairPlace): [number, number, number] {
  const x = 0.076 * sine(around);
  const z = -0.062 + 0.086 * cosine(around);
  const l = Math.sqrt(1 + 0.36 * 0.36);
  const p = rotOut(place.turn, x, cap.edge * l + 0.36 * z + 0.008, z);
  return [p[0] + place.at[0], p[1] + place.at[1], p[2] + place.at[2]];
}

function norm(v: readonly number[]): [number, number, number] {
  const l = Math.sqrt((v[0] ?? 0) ** 2 + (v[1] ?? 0) ** 2 + (v[2] ?? 0) ** 2) || 1;
  return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l];
}

/** How a guide falls: the field it keeps `gap` clear of, and the head's centre it spreads from. */
interface Fall {
  readonly body: Field;
  readonly gap: number;
  readonly centre: V3;
}

/** A guide that falls from its root, spreads from the head and keeps clear of the body. */
function fall(how: Fall, start: V3, length: number): Guide {
  const { body, gap, centre } = how;
  const steps = 24;
  const step = length / steps;
  const guide: Guide = [[...start]];
  let p: [number, number, number] = [...start];
  let dir = norm([(start[0] - centre[0]) * 0.3, -1, (start[2] - centre[2]) * 0.5]);
  for (let i = 1; i <= steps; i += 1) {
    const out = norm([p[0] - centre[0], 0, p[2] - centre[2]]);
    dir = norm([dir[0] * 0.8 + out[0] * 0.07, dir[1] * 0.8 - 0.2, dir[2] * 0.8 + out[2] * 0.07]);
    p = [p[0] + dir[0] * step, p[1] + dir[1] * step, p[2] + dir[2] * step];
    for (let k = 0; k < 3; k += 1) {
      const d = body(p[0], p[1], p[2]) - gap;
      if (d >= 0) break;
      const g = gradient(body, p, 0.002);
      p = [p[0] - g[0] * d, p[1] - g[1] * d, p[2] - g[2] * d];
    }
    guide.push(p);
  }
  return guide;
}

function locks(recipe: HairRecipe, cap: CapFrame, body: Field, place: HairPlace): Lock[] {
  const centre = rotOut(place.turn, 0, 0, -0.06).map((v, k) => v + (place.at[k] ?? 0)) as [number, number, number];
  const out: Lock[] = [];
  const { seed, locks: n } = recipe;
  for (let i = 0; i < n; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const layer = unit(seed, i, 1);
    const around = side * (0.95 + 2.2 * unit(seed, i, 2));
    const length = recipe.length * (0.75 + 0.35 * unit(seed, i, 3)) * (1 - 0.25 * layer);
    const guide = fall({ body, gap: 0.003 + 0.016 * layer, centre }, root(cap, around, place), length);
    out.push({
      guide, length, centre, width: 0.011 + 0.01 * unit(seed, i, 4), thick: 0.004 + 0.002 * unit(seed, i, 5),
      curl: 0.004 + 0.005 * unit(seed, i, 6), wave: 0.045 + 0.03 * unit(seed, i, 7), phase: TAU * unit(seed, i, 8),
      tone: unit(seed, i, 9) * 0.6 + layer * 0.4,
    });
  }
  return out;
}

/** The lock's centre at a share `t` along its guide, curled. */
function along(lock: Lock, t: number): { at: V3; tangent: V3; side: V3; out: V3 } {
  const g = lock.guide;
  const f = t * (g.length - 1);
  const i = Math.min(g.length - 2, Math.floor(f));
  const s = f - i;
  const a = g[i] ?? [0, 0, 0];
  const b = g[i + 1] ?? a;
  const c: V3 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  const tangent = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const radial = norm([c[0] - lock.centre[0], 0, c[2] - lock.centre[2]]);
  const side = norm([
    tangent[1] * radial[2] - tangent[2] * radial[1], tangent[2] * radial[0] - tangent[0] * radial[2],
    tangent[0] * radial[1] - tangent[1] * radial[0],
  ]);
  const out = norm([
    side[1] * tangent[2] - side[2] * tangent[1], side[2] * tangent[0] - side[0] * tangent[2],
    side[0] * tangent[1] - side[1] * tangent[0],
  ]);
  const angle = (TAU * t * lock.length) / lock.wave + lock.phase;
  const grow = Math.min(1, t * 3) * lock.curl;
  const [cs, sn] = [cosine(angle) * grow, sine(angle) * grow];
  const at: V3 = [
    c[0] + side[0] * cs + out[0] * sn, c[1] + side[1] * cs + out[1] * sn, c[2] + side[2] * cs + out[2] * sn,
  ];
  return { at, tangent, side, out };
}

/** The locks as tubes: position, normal, rest (round the tube, along it, the lock's tone) and flow (the tangent). */
export interface HairMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly rest: Float32Array;
  readonly flow: Float32Array;
  readonly open: Float32Array;
  readonly index: Uint32Array;
}

export function hairMesh(recipe: HairRecipe, cap: CapFrame, body: Field, place: HairPlace): HairMesh {
  const all = locks(recipe, cap, body, place);
  const { segments, sides } = recipe;
  const per = (segments + 1) * sides;
  const count = all.length * per;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const rest = new Float32Array(count * 3);
  const flow = new Float32Array(count * 4);
  const open = new Float32Array(count);
  const index: number[] = [];
  all.forEach((lock, l) => {
    for (let j = 0; j <= segments; j += 1) {
      const t = j / segments;
      const { at, tangent, side, out } = along(lock, t);
      const taper = (1 - t * t * t * 0.85) * Math.min(1, 0.4 + t * 8);
      for (let k = 0; k < sides; k += 1) {
        const a = (TAU * k) / sides;
        const [c, s] = [cosine(a), sine(a)];
        const v = l * per + j * sides + k;
        const n = norm([side[0] * c + out[0] * s, side[1] * c + out[1] * s, side[2] * c + out[2] * s]);
        const w = lock.width * taper * c;
        const h = lock.thick * taper * s;
        const p = [0, 1, 2].map((a) => (at[a] ?? 0) + (side[a] ?? 0) * w + (out[a] ?? 0) * h);
        position.set(p, v * 3);
        normal.set(n, v * 3);
        rest.set([k / sides, t, lock.tone], v * 3);
        flow.set([...tangent, lock.tone], v * 4);
        open[v] = 0.35 + 0.65 * (0.5 + 0.5 * s) * (0.55 + 0.45 * lock.tone);
        if (j < segments) {
          const k1 = (k + 1) % sides;
          const b = l * per + j * sides;
          index.push(b + k, b + k1, b + sides + k, b + k1, b + sides + k1, b + sides + k);
        }
      }
    }
  });
  return { position, normal, rest, flow, open, index: Uint32Array.from(index) };
}
