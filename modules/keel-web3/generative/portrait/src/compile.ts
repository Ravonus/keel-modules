// A shape tree turned into one distance function for one block of space: whatever lies too far from the block to
// change the surface in it is left out, so a point near a cheek is never asked about the ear.

import { smax, smin } from "./sdf.js";
import type { Field, Frame, Node, Op } from "./sdf.js";

/** A ball of space: a centre and a radius. */
export type Ball = readonly [number, number, number, number];

const far = (node: Node, ball: Ball, slack: number): boolean => {
  const [x, y, z, r] = node.bound;
  if (r === Infinity) return false;
  const dx = x - ball[0];
  const dy = y - ball[1];
  const dz = z - ball[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r - ball[3] > slack;
};

function framed(node: Frame, ball: Ball, slack: number): Field | null {
  const { rot: m, at } = node;
  const [ax, ay, az] = at;
  const bx = ball[0] - ax;
  const by = ball[1] - ay;
  const bz = ball[2] - az;
  const inner: Ball = [
    m[0] * bx + m[1] * by + m[2] * bz, m[3] * bx + m[4] * by + m[5] * bz, m[6] * bx + m[7] * by + m[8] * bz, ball[3],
  ];
  const f = compile(node.kid, inner, slack);
  if (!f) return null;
  return (x, y, z) => {
    const u = x - ax;
    const v = y - ay;
    const w = z - az;
    return f(m[0] * u + m[1] * v + m[2] * w, m[3] * u + m[4] * v + m[5] * w, m[6] * u + m[7] * v + m[8] * w);
  };
}

function melted(fields: Field[], k: number): Field | null {
  const [a, b, c] = fields;
  if (!a) return null;
  if (!b) return a;
  if (!c) return (x, y, z) => smin(a(x, y, z), b(x, y, z), k);
  return (x, y, z) => {
    let d = a(x, y, z);
    for (const f of fields.slice(1)) d = smin(d, f(x, y, z), k);
    return d;
  };
}

function carved(base: Field, cuts: Field[], k: number): Field {
  const [a, b] = cuts;
  if (!a) return base;
  if (!b) return (x, y, z) => smax(base(x, y, z), -a(x, y, z), k);
  return (x, y, z) => {
    let d = base(x, y, z);
    for (const c of cuts) d = smax(d, -c(x, y, z), k);
    return d;
  };
}

function trimmed(fields: Field[], k: number): Field {
  return (x, y, z) => {
    let d = -Infinity;
    for (const f of fields) d = smax(d, f(x, y, z), k);
    return d;
  };
}

/** A fan (see `fan`): the base asked once, each kid near enough melted into it by its own k. */
function fanned(node: Op, ball: Ball, slack: number): Field | null {
  const wide = Math.max(slack, 2 * node.k);
  const [first, ...rest] = node.kids;
  const base = first ? compile(first, ball, wide) : null;
  const kids: Field[] = [];
  const ks: number[] = [];
  rest.forEach((n, i) => {
    const f = compile(n, ball, wide);
    if (f) kids.push(f);
    if (f) ks.push(node.ks?.[i] ?? 0);
  });
  if (!base) return melted(kids, 0);
  return (x, y, z) => {
    const p = base(x, y, z);
    let d = p;
    kids.forEach((f, i) => {
      d = Math.min(d, smin(p, f(x, y, z), ks[i] ?? 0));
    });
    return d;
  };
}

function op(node: Op, ball: Ball, slack: number): Field | null {
  const wide = Math.max(slack, 2 * node.k);
  if (node.kind === "fan") return fanned(node, ball, slack);
  if (node.kind === "blend") {
    return melted(node.kids.map((n) => compile(n, ball, wide)).filter((f): f is Field => f !== null), node.k);
  }
  const [first, ...rest] = node.kids;
  const base = first ? compile(first, ball, slack) : null;
  if (!base) return null;
  if (node.kind === "carve") {
    return carved(base, rest.map((n) => compile(n, ball, wide)).filter((f): f is Field => f !== null), node.k);
  }
  const others = rest.map((n) => compile(n, ball, slack));
  if (others.some((f) => f === null)) return null;
  return trimmed([base, ...(others as Field[])], node.k);
}

/**
 * The distance function of `node` for points within `ball`, correct wherever the surface is within `slack`, or null
 * if nothing of it comes within `slack` of the ball.
 */
export function compile(node: Node, ball: Ball, slack: number): Field | null {
  if (far(node, ball, slack)) return null;
  switch (node.kind) {
    case "prim":
      return node.f;
    case "frame":
      return framed(node, ball, slack);
    case "bump": {
      const f = compile(node.kid, ball, slack + node.bound[3] - node.kid.bound[3]);
      const g = node.f;
      return f ? (x, y, z) => f(x, y, z) + g(x, y, z) : null;
    }
    default:
      return op(node, ball, slack);
  }
}
