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
export const EYE = 0.0126;
export const EYE_Z = 0.0056;
/**
 * The eye's opening, an almond seen down the eye's axis: inside two circles, the upper lid's arc peaking `up` above
 * the eye's centre a little toward the nose, the lower's dipping `down` below it a little outward, each of radius
 * `upR` and `downR`; `shift` is how far the peaks sit off the centre. The shader paints the same opening.
 */
export const ALMOND = { up: 0.0048, upR: 0.021, down: -0.0053, downR: 0.02, shift: 0.0016 } as const;
/** How far the eye's corners turn up, outward. */
export const CANTHUS = deg(4);

const mirror = (f: (s: number) => Node): Node[] => [f(1), f(-1)];

/** How square the face's oval runs below the eyes, 0 an ellipse to 1 a fourth-power curve. */
const JAW_SQUARE = 0.35;
/** The height of the mouth's line, the lips' meeting (the shader paints the lips from it). */
export const MOUTH = -0.0632;

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
  return cut(0.014, blend(0.02,
    egg(p),
    ellipsoid([0, 0.026, -0.068], [0.071, 0.094, 0.092]),
    ellipsoid([0, MOUTH + 0.003, -0.007], [0.027, 0.024, 0.026]),
    ellipsoid([0, -0.091 * p.chin, 0.0085], [0.02, 0.012, 0.011]),
    ...mirror((s) => ellipsoid([s * 0.03 * p.cheeks, -0.03, 0.003], [0.021, 0.02, 0.016])),
    ...mirror((s) => ellipsoid([s * 0.04, -0.016, -0.004], [0.02, 0.013, 0.02])),
  ), half(UNDER_JAW, UNDER_JAW_AT * p.chin));
}

/** Under the jaw: a plane from below the chin back to the jaw's angle under the ear; the face is cut along it. */
const UNDER_JAW: V3 = [0, -0.884, -0.468];
const UNDER_JAW_AT = 0.094;

function brows(): Node[] {
  return mirror((s) => ellipsoid([s * 0.026, 0.0135, 0.01], [0.024, 0.008, 0.011], turn(0, s * deg(20), 0)));
}

/** The nose's tip, its height for a nose of share 1. */
const NOSE_TIP = -0.032;

function nose(p: Features): Node {
  const l = p.nose;
  const tip: V3 = [0, NOSE_TIP * l, 0.033];
  return blend(0.006,
    cone([0, 0.008, 0.0185], [0, tip[1] + 0.006, tip[2] - 0.0005], 0.0042, 0.0049),
    sphere(tip, 0.006),
    ...mirror((s) => sphere([s * 0.0025, tip[1] + 0.0003, tip[2] + 0.0004], 0.0043)),
    ...mirror((s) =>
      ellipsoid([s * 0.0092, tip[1] - 0.0055, 0.0225], [0.005, 0.0048, 0.0062], turn(0, s * deg(22), 0))),
    ellipsoid([0, tip[1] - 0.0068, 0.0295], [0.0033, 0.0033, 0.0062]),
    ellipsoid([0, tip[1] - 0.0025, 0.0195], [0.011, 0.008, 0.01]),
  );
}

/** The almond opening as a shape: a prism along the eye's axis, `s` the side (her left 1, her right -1). */
function opening(s: number): Prim {
  const { up, upR, down, downR, shift } = ALMOND;
  const [ux, uy, lx, ly] = [-s * shift, up - upR, s * shift, down + downR];
  const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);
  const f = (x: number, y: number): number => Math.max(length(x - ux, y - uy) - upR, length(x - lx, y - ly) - downR);
  return { kind: "prim", bound: [0, 0, 0, EYE * 1.5], f };
}

/** An eye's lids: the shell of a ball over the eye with the almond cut through it, its corners tilted up outward. */
function lids(s: number, p: Features): Node {
  const at: V3 = [s * p.eyes, 0, EYE_Z];
  return frame(turn(0, 0, s * CANTHUS), at, carve(0.0008, sphere([0, 0, 0], EYE + 0.0011), opening(s)));
}

function lips(p: Features): Node[] {
  const f = p.lips;
  return [
    ...mirror((s) =>
      ellipsoid([s * 0.009, MOUTH + 0.0037, 0.016], [0.0128, 0.003 * f, 0.0045], turn(0, s * deg(16), -s * deg(7)))),
    ellipsoid([0, MOUTH + 0.0022, 0.0188], [0.0045, 0.003 * f, 0.0032]),
    ellipsoid([0, MOUTH - 0.0036, 0.0146], [0.0155, 0.0042 * f, 0.005]),
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

/** How deep the philtrum's groove and the fold over the chin are set (their centres' depth). */
const PHILTRUM_Z = 0.0222;
const MENTOLABIAL_Z = 0.0118;

/** The head as one shape, in its own frame. */
export function headShape(p: Features): Node {
  const sockets = mirror((s) => ellipsoid([s * p.eyes, 0.0015, 0.012], [0.015, 0.0105, 0.0085]));
  let face: Node = blend(0.006, masses(p), ...brows());
  face = blend(0.006, face, nose(p));
  face = carve(0.006, face, ...sockets);
  face = blend(0.005, face, lids(1, p), lids(-1, p));
  face = blend(0.006, face, ...lips(p));
  // The mouth's line is a thin disc round the teeth's curve, so it dies out softly at the corners.
  const tip = NOSE_TIP * p.nose;
  face = carve(0.001, face,
    ellipsoid([0, MOUTH, 0.004], [0.0195 * p.lips, 0.0006, 0.019]),
    ...mirror((s) => ellipsoid([s * 0.0058, tip - 0.0095, 0.0225], [0.0024, 0.0013, 0.0036], turn(0, s * deg(20), 0))),
  );
  face = carve(0.003, face,
    ellipsoid([0, (tip - 0.012 + MOUTH + 0.006) / 2, PHILTRUM_Z], [0.0026, 0.0055, 0.0012]),
    ellipsoid([0, MOUTH - 0.0135, MENTOLABIAL_Z], [0.012, 0.004, 0.0045]),
  );
  return blend(0.004, face, ...ears());
}
