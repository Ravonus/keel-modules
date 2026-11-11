// The body under the head, in the bust's frame (metres, the origin at the pit of the throat): neck, shoulders,
// chest and arms, and the cloth over them as the same shapes grown outward: a chemise, a dress with a square
// neckline, an over-gown open at the front with wide sleeves. Folds are a small field added to the cloth's distance.

import { cosine, sine } from "./exact.js";
import { blend, box, bump, capsule, carve, cone, cut, ellipsoid, half } from "./sdf.js";
import type { Field, Node, V3 } from "./sdf.js";

/** Where the raised arm goes: the shoulder, the elbow and the wrist, and the hanging arm's elbow. */
export interface Arms {
  readonly shoulder: V3;
  readonly elbow: V3;
  readonly wrist: V3;
  readonly hanging: V3;
}

export const ARMS: Arms = {
  shoulder: [-0.165, -0.045, -0.055], elbow: [-0.235, -0.31, 0.03], wrist: [-0.25, -0.12, 0.2],
  hanging: [0.215, -0.33, -0.05],
};

/** The neck and the shoulders' slope, which the skin and cloth share. */
export function neckShape(): Node {
  return blend(0.026,
    cone([0, -0.02, -0.054], [0, 0.1, -0.052], 0.038, 0.032),
    ...[1, -1].map((s) => capsule([s * 0.044, 0.14, -0.072], [s * 0.011, 0.0, -0.016], 0.0085)),
    ...[1, -1].map((s) => capsule([s * 0.018, -0.006, -0.016], [s * 0.13, 0.004, -0.05], 0.0065)),
    ...[1, -1].map((s) => slope(s, 0)),
  );
}

/** The slope from the neck down to a shoulder, grown by `grow`: the cloth rests on it too. */
function slope(side: number, grow: number): Node {
  return cone([side * 0.03, 0.045, -0.09], [side * 0.12, -0.008, -0.08], 0.018 + grow, 0.02 + grow);
}

/** The torso and arms, grown by `grow`. */
export function torso(arms: Arms, grow: number): Node {
  const g = grow;
  return blend(0.025,
    ellipsoid([0, -0.13, -0.065], [0.14 + g, 0.15 + g, 0.085 + g]),
    ellipsoid([0, -0.38, -0.06], [0.125 + g, 0.17 + g, 0.085 + g]),
    ...[1, -1].map((s) => ellipsoid([s * 0.068, -0.14, -0.005], [0.058 + g, 0.055 + g, 0.05 + g])),
    ...[1, -1].map((s) => ellipsoid([s * 0.165, -0.05, -0.058], [0.05 + g, 0.06 + g, 0.055 + g])),
    ...[1, -1].map((s) => ellipsoid([s * 0.09, -0.032, -0.042], [0.065 + g, 0.036 + g, 0.04 + g])),
    cone(arms.shoulder, arms.elbow, 0.044 + g, 0.036 + g),
    cone([-arms.shoulder[0], arms.shoulder[1], arms.shoulder[2]], arms.hanging, 0.044 + g, 0.036 + g),
  );
}

/** The forearm of the raised arm, grown by `grow`. */
export function forearm(arms: Arms, grow: number): Node {
  return cone(arms.elbow, arms.wrist, 0.036 + grow, 0.026 + grow);
}

/** A wave a turn long, -1 to 1: round on its ridges, creased in its valleys, from arithmetic alone. */
export function wave(turns: number): number {
  const u = turns - Math.floor(turns);
  return 8 * u * (1 - u) - 1;
}

/** Soft folds: ridges running down the cloth, deeper lower down. */
function folds(depth: number, count: number): Field {
  return (x, y, z) => {
    const a = x * count + z * count * 0.4 + y * 2.0;
    const ridge = wave(a) * 0.6 + wave(a * 2.3 + 0.27) * 0.25;
    const low = Math.min(1, Math.max(0, (-y - 0.12) * 6));
    return ridge * depth * (0.35 + 0.65 * low);
  };
}

/** The chemise: a white layer just over the skin, gathered at its top edge. */
export function chemiseShape(arms: Arms): Node {
  const gathered = bump(torso(arms, 0.003), (x, y) => {
    const near = Math.max(0, 1 - Math.abs(y + 0.085) * 40);
    return wave(x * 41) * 0.0012 * near;
  }, 0.0013);
  return cut(0.003, gathered, half([0, 1, 0.25], -0.072));
}

/** The dress: a layer over the chemise with a square neckline, and its sleeve on the raised forearm. */
export function dressShape(arms: Arms): Node {
  const body = bump(torso(arms, 0.008), folds(0.0022, 7), 0.0025);
  const neckline = box([0, 0.06, 0.06], [0.105, 0.155, 0.12], 0.012);
  const [e, w] = [arms.elbow, arms.wrist];
  const dir: V3 = [w[0] - e[0], w[1] - e[1], w[2] - e[2]];
  const l = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  const u: V3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const end: V3 = [w[0] - u[0] * 0.028, w[1] - u[1] * 0.028, w[2] - u[2] * 0.028];
  const sleeve = bump(cone(e, w, 0.05, 0.036), folds(0.0025, 9), 0.0027);
  const open = half(u, u[0] * end[0] + u[1] * end[1] + u[2] * end[2]);
  return blend(0.006, carve(0.004, body, neckline), cut(0.003, sleeve, open));
}

/** The over-gown: velvet over the shoulders and arms, open down the front, with wide sleeves. */
export function gownShape(arms: Arms): Node {
  const body = bump(blend(0.03, torso(arms, 0.02), slope(1, 0.012), slope(-1, 0.012)), folds(0.004, 4.5), 0.0045);
  const opening: Node = blend(0.02,
    box([0, -0.25, 0.1], [0.128, 0.24, 0.18], 0.01),
    ellipsoid([0, 0.08, 0.02], [0.13, 0.13, 0.14]),
  );
  const sleeves = [arms.elbow, arms.hanging].map((elbow, i) => {
    const s = i === 0 ? arms.shoulder : ([-arms.shoulder[0], arms.shoulder[1], arms.shoulder[2]] as V3);
    const end: V3 = [elbow[0] + (elbow[0] - s[0]) * 0.25, elbow[1] - 0.06, elbow[2]];
    const outer = cone(s, end, 0.06, 0.1);
    return bump(outer, folds(0.005, 3.5), 0.0055);
  });
  return blend(0.02, carve(0.012, body, opening), ...sleeves);
}

/** The chain's path: a closed loop from the nape, round over the collarbones, low on the chest in front. */
export function chainPath(n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const a = ((i / n) * 2 - 1) * Math.PI;
    const c = cosine(a);
    const back = Math.min(0, c);
    out.push([0.075 * sine(a), -0.036 * c * c - 0.012 * c + 0.014 + 0.03 * back * back, 0.09 * c - 0.05 + 0.04 * back]);
  }
  return out;
}
