// A right hand in its own frame: the origin at the wrist, y toward the fingers, z out of the palm, x to the thumb's
// side. Four fingers of three bones each and a thumb of three, posed by flexing their joints; the thumb reaches its
// target by two-bone reach, so a pinch always closes. Each finger melts into the palm but never into its neighbour.

import { cosine, deg, sine } from "./exact.js";
import { blend, box, cone, ellipsoid, fan, sphere } from "./sdf.js";
import type { Node, V3 } from "./sdf.js";

/** How each finger's three joints bend (degrees, index to little), and where the thumb's tip goes. */
export interface HandPose {
  readonly bend: readonly (readonly [number, number, number])[];
  readonly spread: readonly number[];
  /** The thumb's tip: a finger (0 index, 1 middle) and a share along its last bone, or null for the thumb's rest. */
  readonly thumbTo: readonly [number, number] | null;
}

/** Index raised, the thumb ringed with the middle finger, the others curled. */
export const POINT: HandPose = {
  bend: [[4, 6, 4], [62, 88, 55], [74, 92, 55], [82, 92, 50]], spread: [4, 0, -4, -9], thumbTo: [1, 0.85],
};

/** Index and thumb pads together, as holding a card's edge; the others curled behind. */
export const PINCH: HandPose = {
  bend: [[38, 46, 18], [52, 70, 40], [64, 80, 45], [74, 86, 45]], spread: [2, 0, -5, -10], thumbTo: [0, 0.7],
};

const KNUCKLES: readonly V3[] = [
  [0.027, 0.093, 0.001], [0.008, 0.097, 0.0], [-0.011, 0.093, -0.001], [-0.027, 0.084, -0.002],
];
const BONES: readonly (readonly [number, number, number])[] = [
  [0.045, 0.027, 0.022], [0.049, 0.03, 0.023], [0.046, 0.029, 0.022], [0.036, 0.021, 0.02],
];
const RADII: readonly number[] = [0.0077, 0.0079, 0.0074, 0.0065];

export interface Finger {
  /** Joints from the knuckle to the tip. */
  readonly joints: readonly V3[];
  readonly radius: number;
  /** The back of the last bone, a unit direction (where its nail is). */
  readonly back: V3;
}

const add = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** A finger's joints: each bone turned toward the palm by the bend so far, and out by its spread. */
export function finger(i: number, pose: HandPose): Finger {
  const lengths = BONES[i] ?? [0.04, 0.025, 0.02];
  const bends = pose.bend[i] ?? [0, 0, 0];
  const spread = deg(pose.spread[i] ?? 0);
  const [ss, cs] = [sine(spread), cosine(spread)];
  let at: V3 = KNUCKLES[i] ?? [0, 0.09, 0];
  const joints: V3[] = [at];
  let angle = 0;
  let dir: V3 = [0, 1, 0];
  for (let b = 0; b < 3; b += 1) {
    angle += deg(bends[b] ?? 0);
    const [s, c] = [sine(angle), cosine(angle)];
    dir = [ss * c, cs * c, s];
    at = add(at, dir, lengths[b] ?? 0.02);
    joints.push(at);
  }
  const [s, c] = [sine(angle), cosine(angle)];
  return { joints, radius: RADII[i] ?? 0.008, back: [ss * s, cs * s, -c] };
}

/** The thumb's joints: its base fixed, its two outer bones bent to reach the target. */
export function thumb(pose: HandPose, fingers: readonly Finger[]): Finger {
  const base: V3 = [0.022, 0.024, 0.006];
  const knuckle = add(base, [0.62, 0.6, 0.5], 0.042 / Math.sqrt(0.62 * 0.62 + 0.6 * 0.6 + 0.5 * 0.5));
  const [la, lb] = [0.031, 0.027];
  let target: V3 = add(knuckle, [0.2, 0.75, 0.62], 0.05);
  if (pose.thumbTo) {
    const f = fingers[pose.thumbTo[0]];
    const a = f?.joints[2] ?? knuckle;
    const b = f?.joints[3] ?? knuckle;
    const t = pose.thumbTo[1];
    const pad: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const back = f?.back ?? [0, 0, -1];
    target = add(pad, back, -((f?.radius ?? 0.008) + 0.0088));
  }
  const d: V3 = [target[0] - knuckle[0], target[1] - knuckle[1], target[2] - knuckle[2]];
  const dist = Math.min(la + lb - 1e-4, Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]));
  const u: V3 = [d[0] / dist, d[1] / dist, d[2] / dist];
  // The bend lies away from the palm's centre line: the middle joint pushed out along +x and back.
  const side: V3 = [0.8, -0.2, -0.55];
  const k = side[0] * u[0] + side[1] * u[1] + side[2] * u[2];
  const perp: V3 = [side[0] - u[0] * k, side[1] - u[1] * k, side[2] - u[2] * k];
  const pl = Math.sqrt(perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]) || 1;
  const along = (la * la - lb * lb + dist * dist) / (2 * dist);
  const up = Math.sqrt(Math.max(0, la * la - along * along));
  const mid = add(add(knuckle, u, along), perp, up / pl);
  const tip = add(knuckle, u, dist);
  const back: V3 = [perp[0] / pl, perp[1] / pl, perp[2] / pl];
  return { joints: [base, knuckle, mid, tip], radius: 0.0102, back };
}

function fingerShape(f: Finger, thumbish: boolean): Node {
  const [a, b, c, d] = f.joints as [V3, V3, V3, V3];
  const r = f.radius;
  const taper = thumbish ? [1.15, 1.0, 0.9, 0.78] : [1.0, 0.92, 0.86, 0.78];
  const [ra, rb, rc, rd] = taper.map((t) => t * r) as [number, number, number, number];
  // The pad: a little more flesh on the palm's side of the last bone.
  const pad = add([(c[0] + d[0]) / 2, (c[1] + d[1]) / 2, (c[2] + d[2]) / 2], f.back, -rd * 0.35);
  return blend(0.003,
    cone(a, b, ra, rb), cone(b, c, rb * 0.97, rc), cone(c, d, rc * 0.97, rd),
    sphere(pad, rd * 0.9), sphere(b, rb * 1.02), sphere(c, rc * 1.0),
  );
}

/** The palm and the heel of the hand, and the wrist going back into the sleeve. */
function palm(): Node {
  return blend(0.008,
    box([0, 0.052, -0.001], [0.03, 0.04, 0.0075], 0.0085),
    ellipsoid([0.019, 0.034, 0.01], [0.017, 0.027, 0.012]),
    ellipsoid([-0.021, 0.042, 0.007], [0.011, 0.03, 0.01]),
    ellipsoid([0, -0.012, -0.002], [0.026, 0.035, 0.018]),
  );
}

export interface HandShape {
  readonly node: Node;
  readonly fingers: readonly Finger[];
  readonly thumb: Finger;
}

/** The hand posed. Each finger melts into the palm on its own, then the hand is their union. */
export function handShape(pose: HandPose): HandShape {
  const fingers = [0, 1, 2, 3].map((i) => finger(i, pose));
  const t = thumb(pose, fingers);
  const base = palm();
  const parts = [...fingers.map((f) => fingerShape(f, false)), fingerShape(t, true)];
  return { node: fan(base, parts, [0.005, 0.005, 0.005, 0.005, 0.011]), fingers, thumb: t };
}

