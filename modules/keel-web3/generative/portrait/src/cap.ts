// A knit cap in the head's frame: pulled to the brow over a full head of hair, its crown slouching back and to her
// left, the cuff folded once. The knit itself (ribs, rows) is painted on by the shader from where the cap's own
// axis and its cuff's edge are; those are exported for it.

import { blend, cut, ellipsoid, half } from "./sdf.js";
import type { Node, V3 } from "./sdf.js";

/** The cap's measures: the plane of the cuff's lower edge (`normal`·p = `edge`), the cuff's height, its axis. */
export interface CapFrame {
  readonly normal: V3;
  readonly edge: number;
  readonly cuff: number;
  readonly centre: V3;
}

/** Where the cap sits: version B pulls it 1 cm lower, so its shadow falls over the eyes. */
export function capFrame(face: "A" | "B"): CapFrame {
  const l = Math.sqrt(1 + 0.36 * 0.36);
  const normal: V3 = [0, 1 / l, -0.36 / l];
  const low = face === "B" ? 0.01 : 0;
  return { normal, edge: (0.044 - low - 0.36 * 0.03) / l, cuff: 0.046, centre: [0, 0.062, -0.06] };
}

/** The volume the cap is pulled over: the skull with a thick head of hair. */
function crown(grow: number): Node {
  return blend(0.03,
    ellipsoid([0, 0.026, -0.064], [0.083 + grow, 0.104 + grow, 0.1 + grow]),
    ellipsoid([0, 0.03, -0.02], [0.064 + grow, 0.052 + grow, 0.05 + grow]),
    ellipsoid([0.025, 0.105, -0.115], [0.072 + grow, 0.058 + grow, 0.07 + grow]),
    ellipsoid([0.0, 0.03, -0.07], [0.097 + grow, 0.085 + grow, 0.095 + grow]),
  );
}

/** The cap: its body above the cuff's edge, the folded cuff a little proud of it. */
export function capShape(frame: CapFrame): Node {
  const [nx, ny, nz] = frame.normal;
  const below: Node = half([-nx, -ny, -nz], -frame.edge);
  const top = frame.edge + frame.cuff;
  const body = cut(0.004, crown(0), below);
  const cuff = cut(0.004, crown(0.0055), below, half([nx, ny, nz], top));
  return blend(0.0015, body, cuff);
}
