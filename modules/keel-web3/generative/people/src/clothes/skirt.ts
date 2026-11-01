// Skirts: what hangs from the waist, a skirt or the fall of a long top, grown out of the finished surface itself.

import { TAU, UP, clamp, lerpV, madd, mix } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import { LONG_TOP } from "./outfit.js";
import { restSkeleton, torsoStations } from "../motion/skeleton.js";
import { REST } from "../motion/motions.js";
import type { Station } from "../motion/skeleton.js";
import { BONE_COUNT, hangOf } from "../body/bones.js";
import { skirtWeights } from "../body/field.js";
import type { Layer, Net } from "../body/field.js";
import { FOOT, LEG, TORSO, normalsOf, pointOf, quad, shellOf, strongest } from "../body/cage.js";
import type { Cage, Row } from "../body/cage.js";
import { lowerCloth, topCloth } from "./fabric.js";

/** The ring of the finished surface where a skirt starts, stood off it by `lift`, in order round the body. */
export function waistLoop(body: Cage, normals: readonly Vec[], lift: number): readonly Row[] {
  const on = (tag: number): Set<number> => new Set(body.quads.flatMap((q, f) => (body.tags[f] === tag ? [...q] : [])));
  const above = on(TORSO + 3);
  const shared = [...on(TORSO + 2)].filter((i) => above.has(i));
  const middle = shared.reduce((n, i) => n + (body.rows[i]?.[2] ?? 0), 0) / Math.max(1, shared.length);
  const angle = (i: number): number => Math.atan2(body.rows[i]?.[0] ?? 0, (body.rows[i]?.[2] ?? 0) - middle);
  return shared
    .sort((a, b) => angle(a) - angle(b))
    .map((i) => [...madd(pointOf(body.rows[i]), normals[i] ?? UP, lift), ...(body.rows[i] ?? []).slice(3)]);
}

/** How far out from the body's middle it reaches, at an angle round it and a height. */
type Bulk = (angle: number, y: number) => number;
const BULK_ROUND = 40;
const BULK_HIGH = 14;

/** Whether a part of a body is one a hanging garment falls over. */
const hungOver = (tag: number): boolean => (tag >= TORSO && tag <= TORSO + 4) || (tag >= LEG && tag <= FOOT - 1);

/**
 * The widest a body gets, all round it, between two heights: what anything hung from the waist has to clear, however
 * fat it is.
 */
function bulkOf(body: Cage, top: number, hem: number, middle: number): Bulk {
  const reach = new Float32Array(BULK_ROUND * BULK_HIGH);
  const binOf = (a: number, y: number): number =>
    (Math.floor(((((a / TAU) % 1) + 1) % 1) * BULK_ROUND) % BULK_ROUND) +
    clamp(Math.floor(((top - y) / Math.max(0.01, top - hem)) * BULK_HIGH), 0, BULK_HIGH - 1) * BULK_ROUND;
  body.quads.forEach((q, f) => {
    if (!hungOver(body.tags[f] ?? 0)) return;
    for (const v of q) {
      const at = pointOf(body.rows[v]);
      const bin = binOf(Math.atan2(at[0], at[2] - middle), at[1]);
      if (at[1] <= top + 0.02 && at[1] >= hem) {
        reach[bin] = Math.max(reach[bin] ?? 0, Math.hypot(at[0], at[2] - middle));
      }
    }
  });
  return (a, y) => {
    const step = TAU / BULK_ROUND;
    return Math.max(...[-2, -1, 0, 1, 2].map((d) => reach[binOf(a + d * step, y)] ?? 0));
  };
}

/**
 * A skirt, or what falls below a long top: grown out of the finished surface itself, so it is one piece, folding deeper
 * toward the hem.
 */
/** How what hangs from the waist falls: to what height, how far it clears the hips, and the bulk it has to go round. */
interface Fall {
  readonly hem: number;
  readonly clear: number;
  readonly bulk: Bulk;
}

function skirtCage(p: Person, loop: readonly Row[], { hem, clear, bulk }: Fall): Cage {
  const flare = (LONG_TOP[p.outfit.top] === undefined ? 1.1 : 1.04) + p.outfit.fit * 0.16;
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const around = loop.length;
  const down = 14;
  const top = loop.reduce((n, v) => n + (v[1] ?? 0), 0) / Math.max(1, around);
  const middle = loop.reduce((n, v) => n + (v[2] ?? 0), 0) / Math.max(1, around);
  for (let j = 0; j <= down; j += 1) loop.forEach((row, i) => {
    const ring = pointOf(row);
    const k = j / down;
    const a = (i / around) * TAU;
    const pleat = 1 + 0.045 * k * Math.sin(a * 9 + Math.sin(a * 4) * 1.4);
    const wide = mix(mix(1, clear, clamp(k * 3.4, 0, 1)), flare * clear, k) * pleat;
    const y = mix(ring[1], hem, k);
    const x = ring[0] * wide;
    const splayed = 0.9 * clamp(Math.abs(x) / 0.06, 0, 1) * (top - y) * Math.sin(REST.splay ?? 0);
    const out = [x + Math.sign(x) * splayed, middle + (ring[2] - middle) * wide - middle] as const;
    const round = Math.hypot(out[0], out[1]);
    const wrap = mix(
      1,
      Math.max(1, (bulk(Math.atan2(out[0], out[1]), y) + 0.02) / Math.max(0.01, round)),
      Math.min(1, j / 2),
    );
    cage.rows.push([
      out[0] * wrap,
      y,
      middle + out[1] * wrap,
      ...(j < 2 ? row.slice(3) : new Array<number>(BONE_COUNT).fill(0)),
    ]);
  });
  for (let j = 0; j < down; j += 1) for (let i = 0; i < around; i += 1) {
    const at = (x: number, y: number): number => y * around + (x % around);
    quad(cage, [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], [0, mix(top, hem, j / down), middle], 0);
  }
  return cage;
}

/** How much wider the hips are than the waist. */
const hipsOver = (hip: Station | undefined, waist: Station | undefined): number =>
  (hip?.wide ?? 1) / (waist?.wide ?? 1);

/** How low what hangs from the waist comes. */
export function hemOf(p: Person): number {
  const leg = restSkeleton(p).left.leg;
  return lerpV(leg.hip, leg.knee, LONG_TOP[p.outfit.top] ?? 0.78)[1];
}

/** What hangs from a waist: whether it is a long top's fall, the ring it starts from, and the body it hangs over. */
interface Hung {
  readonly long: boolean;
  readonly loop: readonly Row[];
  readonly body: Cage;
}

/** The hanging tube of whatever a person has on that has one. */
export function skirtShell(net: Net, p: Person, roles: readonly string[], { long, loop, body }: Hung): void {
  const { bottom } = p.outfit;
  if (!long && bottom !== "skirt") return;
  const s = restSkeleton(p);
  const hem = hemOf(p);
  const from = loop[0]?.[1] ?? s.pelvis[1];
  const rings = torsoStations(p, s);
  const clear = Math.min(1.24, hipsOver(rings[1], rings[3]) * 1.03);
  const middle = loop.reduce((n, v) => n + (v[2] ?? 0), 0) / Math.max(1, loop.length);
  const cage = skirtCage(p, loop, { hem, clear, bulk: bulkOf(body, from, hem, middle) });
  const free: Layer["free"] = [from - 0.1, Math.max(0.1, from - hem)];
  const hang = (at: Vec, row: Row): readonly [number, number, number, number] => {
    if (row.slice(3).some((v) => v > 0)) return [...strongest(row), 0];
    const [a, b, w] = skirtWeights(at, hangOf(s, 1)[0][1], s.left.leg.hip[1] + 0.02);
    return [a, b, w, clamp((free[0] - at[1]) / free[1], 0, 1)];
  };
  const fabric = long ? topCloth(p) : lowerCloth(p);
  const role = (): string => (long ? "top" : "bottom");
  const edge = (at: Vec): boolean => at[1] < from - 0.05;
  const surface = { body: cage, normals: normalsOf(cage) };
  shellOf(net, surface, { on: () => true, lift: 0, role, fabric, hang, edge }, { roles, size: p.build.size });
}
