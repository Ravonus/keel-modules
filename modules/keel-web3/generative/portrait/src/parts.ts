// Parts built directly rather than meshed from a field: the eyeballs, the card and the chain; and a part moved
// into place.

import { compile } from "./compile.js";
import { cosine, sine } from "./exact.js";
import { gradient } from "./mesh.js";
import { rotOut } from "./sdf.js";
import type { M3, Node, V3 } from "./sdf.js";

export interface Part {
  readonly name: string;
  /** Its material, one of `PARTS`. */
  readonly kind: number;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** How open each vertex lies, 0 to 1. */
  readonly open: Float32Array;
  /** Where each vertex lies in the part's own frame, for what is painted on it. */
  readonly rest: Float32Array;
  /** A direction along the surface and a fourth number, for what has a grain (hair). */
  readonly flow?: Float32Array | undefined;
  readonly index: Uint32Array;
}

interface Placing {
  readonly turn: M3;
  readonly at: V3;
}

/** A part built in its own frame, moved into the bust's by a pose. Its rest coordinates stay its own. */
export function placed(part: Part, pose: Placing): Part {
  const position = new Float32Array(part.position.length);
  const normal = new Float32Array(part.normal.length);
  for (let i = 0; i < position.length; i += 3) {
    const p = rotOut(pose.turn, part.position[i] ?? 0, part.position[i + 1] ?? 0, part.position[i + 2] ?? 0);
    position.set([p[0] + pose.at[0], p[1] + pose.at[1], p[2] + pose.at[2]], i);
    normal.set(rotOut(pose.turn, part.normal[i] ?? 0, part.normal[i + 1] ?? 0, part.normal[i + 2] ?? 0), i);
  }
  return { ...part, position, normal };
}

const TAU = 6.283185307179586;

/** A ball of rings and segments, as an eye; its rest coordinates are in the head's frame. */
export function eyeball(kind: number, ball: { centre: V3; radius: number }, rings: number, pose: Placing): Part {
  const { centre, radius } = ball;
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (let n = 0; n < (rings + 1) * (rings + 1); n += 1) {
    const [i, j] = [Math.floor(n / (rings + 1)), n % (rings + 1)];
    const u = (i / rings) * 2 - 1;
    const r = Math.sqrt(1 - u * u);
    const a = (j / rings) * TAU;
    position.push(centre[0] + r * cosine(a) * radius, centre[1] + r * sine(a) * radius, centre[2] + u * radius);
    normal.push(r * cosine(a), r * sine(a), u);
    if (i < rings && j < rings) index.push(n, n + 1, n + rings + 1, n + 1, n + rings + 2, n + rings + 1);
  }
  const local: Part = {
    name: "eye", kind, position: Float32Array.from(position), normal: Float32Array.from(normal),
    open: new Float32Array(position.length / 3).fill(1), rest: Float32Array.from(position),
    index: Uint32Array.from(index),
  };
  return placed(local, pose);
}

/** The card's size: its width (1.586 : 1) and thickness, metres. */
export const CARD: readonly [number, number, number] = [0.12, 0.12 / 1.586, 0.0009];

/** The card's outline: its rounded corners, each point with its outward direction. */
function outline(): [number, number, number, number][] {
  const [w, h] = CARD;
  const round = 0.037 * w;
  const ring: [number, number, number, number][] = [];
  for (let n = 0; n < 28; n += 1) {
    const [c, i] = [Math.floor(n / 7), n % 7];
    const cx = (c === 0 || c === 3 ? 1 : -1) * (w / 2 - round);
    const cy = (c < 2 ? 1 : -1) * (h / 2 - round);
    const a = (c + i / 6) * (TAU / 4);
    ring.push([cx + cosine(a) * round, cy + sine(a) * round, cosine(a), sine(a)]);
  }
  return ring;
}

interface Lists {
  readonly position: number[];
  readonly normal: number[];
  readonly index: number[];
}

/** A face of the card at depth `z`: a fan from its centre, wound to face out. */
function cardFace(out: Lists, ring: readonly (readonly number[])[], z: number): void {
  const base = out.position.length / 3;
  const facing = z > 0 ? 1 : -1;
  out.position.push(0, 0, z);
  out.normal.push(0, 0, facing);
  for (const [x = 0, y = 0] of ring) {
    out.position.push(x, y, z);
    out.normal.push(0, 0, facing);
  }
  ring.forEach((_, i) => {
    const a = base + 1 + i;
    const b = base + 1 + ((i + 1) % ring.length);
    out.index.push(...(z > 0 ? [base, a, b] : [base, b, a]));
  });
}

/** A card: a rounded rectangle with thickness, its rest coordinates its own (x across, y up, z through). */
export function cardPart(kind: number, pose: Placing): Part {
  const t = CARD[2];
  const ring = outline();
  const out: Lists = { position: [], normal: [], index: [] };
  cardFace(out, ring, t / 2);
  cardFace(out, ring, -t / 2);
  const side = out.position.length / 3;
  for (const [x, y, nx, ny] of ring) {
    out.position.push(x, y, t / 2, x, y, -t / 2);
    out.normal.push(nx, ny, 0, nx, ny, 0);
  }
  ring.forEach((_, i) => {
    const a = side + i * 2;
    const b = side + ((i + 1) % ring.length) * 2;
    out.index.push(a, a + 1, b, b, a + 1, b + 1);
  });
  const p = Float32Array.from(out.position);
  const local: Part = {
    name: "card", kind, position: p, normal: Float32Array.from(out.normal), open: new Float32Array(p.length / 3).fill(1),
    rest: p.slice(), index: Uint32Array.from(out.index),
  };
  return placed(local, pose);
}

/** A fine chain laid on the body: a thin tube along `path`, pressed onto the surface of `body`. */
export function chainPart(kind: number, path: readonly V3[], body: Node): Part {
  const f = compile(body, [0, 0, 0, 1], 1) ?? (() => 1);
  const lie = path.map((q) => {
    let p: [number, number, number] = [q[0], q[1], q[2]];
    for (let k = 0; k < 6; k += 1) {
      const d = f(p[0], p[1], p[2]) - 0.0016;
      const g = gradient(f, p, 0.001);
      p = [p[0] - g[0] * d, p[1] - g[1] * d, p[2] - g[2] * d];
    }
    return p;
  });
  const sides = 6;
  const position: number[] = [];
  const normal: number[] = [];
  const rest: number[] = [];
  const index: number[] = [];
  lie.forEach((p, i) => {
    const a = lie[Math.max(0, i - 1)] ?? p;
    const b = lie[Math.min(lie.length - 1, i + 1)] ?? p;
    const t: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) || 1;
    const g = gradient(f, p, 0.001);
    const s = [g[1] * t[2] - g[2] * t[1], g[2] * t[0] - g[0] * t[2], g[0] * t[1] - g[1] * t[0]].map((v) => v / tl);
    for (let k = 0; k < sides; k += 1) {
      const ang = (k / sides) * TAU;
      const n = [0, 1, 2].map((j) => (g[j] ?? 0) * cosine(ang) + (s[j] ?? 0) * sine(ang));
      position.push(...[0, 1, 2].map((j) => (p[j] ?? 0) + (n[j] ?? 0) * 0.0011));
      normal.push(...n);
      rest.push(i / lie.length, k / sides, 0);
      if (i < lie.length - 1) {
        const v = i * sides + k;
        const w = i * sides + ((k + 1) % sides);
        index.push(v, w, v + sides, w, w + sides, v + sides);
      }
    }
  });
  return {
    name: "chain", kind, position: Float32Array.from(position), normal: Float32Array.from(normal),
    open: new Float32Array(position.length / 3).fill(0.8), rest: Float32Array.from(rest),
    index: Uint32Array.from(index),
  };
}
