// The head, sculpted in its own frame: x to her left, y up, z out of the face, in metres, the origin midway between
// the eyes' centres. Masses first (skull, brow, cheekbones, jaw, chin), then the nose, then sockets cut and lids,
// lips and ears laid in, then the fine cuts (the mouth's line, the nostrils, the philtrum).

import { deg, turn } from "./exact.js";
import { blend, carve, cone, cut, ellipsoid, frame, half, sphere } from "./sdf.js";
import type { Node, Prim, V3 } from "./sdf.js";

/** What a seed decides of a face, each a share around 1. */
export interface Features {
  /** Half the distance between the eyes' centres, in metres. */
  readonly eyes: number;
  readonly nose: number;
  readonly lips: number;
  readonly jaw: number;
  readonly chin: number;
  readonly cheeks: number;
}

/** The eyeball's radius, and how far its centre sits in front of the head frame's origin. */
export const EYE = 0.0118;
export const EYE_Z = 0.005;
/** How far the open upper lid's edge plane sits below the eye's centre (the shader shares it). */
export const LID_DROP = 0.0018;

const mirror = (f: (s: number) => Node): Node[] => [f(1), f(-1)];

/** How square the face's oval runs below the eyes, 0 an ellipse to 1 a fourth-power curve. */
const JAW_SQUARE = 0.6;

/**
 * The face's oval: an ellipsoid whose width and depth change with height, as quadratics through the chin, the
 * cheekbones and the temples, so the face is one smooth form with nothing melted on to crease it.
 */
function egg(p: Features): Prim {
  const [cy, up, down, cz] = [-0.005, 0.108, 0.101, -0.045];
  const [x0, top, chin] = [0.067 * p.cheeks, 0.058, 0.033 * p.jaw];
  const [z0, z1, z2] = [0.07, 0.0025, -0.0125];
  const f = (x: number, y: number, z: number): number => {
    const ry = y > cy ? up : down;
    const t = Math.max(-1, Math.min(1, (y - cy) / ry));
    // Full through the cheeks and the jaw, drawing in to the chin only low down.
    const rx = t > 0 ? x0 + (top - x0) * t * t : x0 + (x0 - chin) * t * t * t;
    const rz = z0 + z1 * t + z2 * t * t;
    const u = x / rx;
    const v = (y - cy) / ry;
    const w = (z - cz) / rz;
    // Below the eyes the oval squares toward its fourth power, so the jaw keeps its width low down.
    const a = v < 0 ? JAW_SQUARE : 0;
    const vv = v * v * (1 - a + a * v * v);
    const dv = v * (1 - a + 2 * a * v * v);
    const k0 = Math.sqrt(u * u + vv + w * w);
    const k1 = Math.sqrt(u * u / (rx * rx) + dv * dv / (ry * ry) + w * w / (rz * rz));
    return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -0.03;
  };
  return { kind: "prim", bound: [0, cy, cz, 0.125], f };
}

function masses(p: Features): Node {
  return blend(0.02,
    egg(p),
    ellipsoid([0, 0.026, -0.068], [0.071, 0.094, 0.092]),
    ellipsoid([0, -0.064 * p.chin, -0.004], [0.028, 0.024, 0.026]),
    ellipsoid([0, -0.092 * p.chin, -0.001], [0.02, 0.014, 0.016]),
    ...mirror((s) => ellipsoid([s * 0.03 * p.cheeks, -0.036, 0.004], [0.022, 0.024, 0.017])),
    ...mirror((s) => ellipsoid([s * 0.04, -0.016, -0.004], [0.02, 0.013, 0.02])),
  );
}

function brows(): Node[] {
  return mirror((s) => ellipsoid([s * 0.026, 0.017, 0.01], [0.022, 0.0075, 0.012], turn(0, s * deg(20), 0)));
}

function nose(p: Features): Node {
  const l = p.nose;
  const tip: V3 = [0, -0.038 * l, 0.036];
  return blend(0.007,
    cone([0, 0.006, 0.019], [0, tip[1] + 0.006, tip[2] - 0.001], 0.0062, 0.0056),
    sphere(tip, 0.0078),
    ...mirror((s) => ellipsoid([s * 0.0105, tip[1] - 0.005, 0.025], [0.0056, 0.005, 0.0075], turn(0, s * deg(20), 0))),
    ellipsoid([0, tip[1] - 0.007, 0.03], [0.0036, 0.0035, 0.0065]),
    ellipsoid([0, tip[1] - 0.002, 0.02], [0.014, 0.009, 0.011]),
  );
}

/** An eye's lids: the shell of a ball over the eye, upper above and lower below a tilted cut. */
function lids(s: number, p: Features): Node[] {
  const at: V3 = [s * p.eyes, 0, EYE_Z];
  const tilt = turn(0, 0, -s * deg(4));
  const upper = cut(0.0012, sphere([0, 0, 0], EYE + 0.0011), half([0, -0.9, 0.436], LID_DROP));
  const lower = cut(0.0012, sphere([0, 0, 0], EYE + 0.0007), half([0, 0.93, 0.37], 0));
  return [frame(tilt, at, upper), frame(tilt, at, lower)];
}

function lips(p: Features): Node[] {
  const f = p.lips;
  return [
    ...mirror((s) =>
      ellipsoid([s * 0.009, -0.0645, 0.0195], [0.0132, 0.003 * f, 0.0048], turn(0, s * deg(14), -s * deg(7)))),
    ellipsoid([0, -0.066, 0.0225], [0.0045, 0.003 * f, 0.0035]),
    ellipsoid([0, -0.0722, 0.018], [0.0165, 0.0042 * f, 0.0052]),
  ];
}

function ears(): Node[] {
  return mirror((s) =>
    carve(0.003,
      ellipsoid([s * 0.071, -0.012, -0.072], [0.0095, 0.029, 0.018], turn(deg(-12), s * deg(-18), 0)),
      ellipsoid([s * 0.078, -0.016, -0.069], [0.006, 0.012, 0.008]),
    ),
  );
}

/** The head as one shape, in its own frame. */
export function headShape(p: Features): Node {
  const sockets = mirror((s) => ellipsoid([s * p.eyes, 0.002, 0.011], [0.017, 0.0125, 0.0105]));
  let face: Node = blend(0.006, masses(p), ...brows());
  face = blend(0.006, face, nose(p));
  face = carve(0.006, face, ...sockets);
  face = blend(0.0022, face, ...lids(1, p), ...lids(-1, p));
  face = blend(0.006, face, ...lips(p));
  face = carve(0.0012, face,
    ellipsoid([0, -0.068, 0.025], [0.0225 * p.lips, 0.0007, 0.006]),
    ...mirror((s) => ellipsoid([s * 0.006, -0.047 * p.nose, 0.025], [0.0028, 0.0017, 0.0042], turn(0, s * deg(20), 0))),
  );
  face = carve(0.004, face,
    ellipsoid([0, -0.056, 0.0262], [0.003, 0.006, 0.0014]),
    ellipsoid([0, -0.081, 0.021], [0.013, 0.0035, 0.005]),
  );
  return blend(0.004, face, ...ears());
}
