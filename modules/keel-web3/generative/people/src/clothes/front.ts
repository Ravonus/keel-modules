// Fronts: what lies on the front of a body near to, a jacket's open V and a polo's collar, draped on the surface there.

import { FAR, FRONT, TAU, add, clamp, cross, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { restSkeleton } from "../motion/skeleton.js";
import { HEAD } from "../body/bones.js";
import type { Net, Wearer } from "../body/field.js";
import { NO_EDGE } from "../body/cage.js";
import { FABRICS, topCloth } from "./fabric.js";
import { WRAPPED } from "./cloth.js";
import { bearingOf, boundOf } from "../head/ears.js";
import type { Bound } from "../head/ears.js";
import { vecAt } from "../head/paint.js";

/**
 * The front of what a body has on: how far forward it lies at any `x`, `y`, and the vertex there, from which a thing
 * laid on it takes its bones.
 */
interface Front {
  readonly z: (x: number, y: number) => number;
  readonly near: (x: number, y: number) => number;
}

/** The boundary of a person's front, over the vertices `keep` takes, as a head has its own. */
function frontBound(net: Net, keep: (v: number) => boolean, step: number): Front {
  const depth = new Map<number, number>();
  const owner = new Map<number, number>();
  const key = (i: number, j: number): number => i * 8192 + j;
  const cellOf = (v: number): number => Math.round(v / step);
  const fill = (a: number, b: number, c: number): void => {
    const [ax, ay, az] = vecAt(net.position, a);
    const [bx, by, bz] = vecAt(net.position, b);
    const [cx, cy, cz] = vecAt(net.position, c);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return;
    for (let i = cellOf(Math.min(ax, bx, cx)); i <= cellOf(Math.max(ax, bx, cx)); i += 1) {
      for (let j = cellOf(Math.min(ay, by, cy)); j <= cellOf(Math.max(ay, by, cy)); j += 1) {
        const x = i * step;
        const y = j * step;
        const w = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
        const u = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
        const v = 1 - w - u;
        if (w < -0.05 || u < -0.05 || v < -0.05) continue;
        const z = w * az + u * bz + v * cz;
        const k = key(i, j);
        if (z > (depth.get(k) ?? -FAR)) {
          depth.set(k, z);
          owner.set(k, a);
        }
      }
    }
  };
  for (let i = 0; i < net.index.length; i += 3) {
    const a = net.index[i] ?? 0;
    const b = net.index[i + 1] ?? 0;
    const c = net.index[i + 2] ?? 0;
    if (keep(a) && keep(b) && keep(c)) fill(a, b, c);
  }
  const at = <T>(map: ReadonlyMap<number, T>, x: number, y: number, or: T): T =>
    map.get(key(cellOf(x), cellOf(y))) ??
    map.get(key(cellOf(x) + 1, cellOf(y))) ??
    map.get(key(cellOf(x) - 1, cellOf(y))) ??
    map.get(key(cellOf(x), cellOf(y) - 1)) ??
    or;
  return { near: (x, y) => at(owner, x, y, -1), z: (x, y) => at(depth, x, y, 0) };
}

/** The faces of a sheet of `rows` by `cols` quads from `from`, seen from the front. */
function gridQuads(index: number[], from: number, rows: number, cols: number): void {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = from + r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index.push(a, d, e, a, e, b);
    }
  }
}

/** A sheet to lay on a front: its grid, where each corner of it goes, how far it stands off, and what it is. */
interface Sheet {
  readonly rows: number;
  readonly cols: number;
  readonly at: (t: number, u: number) => readonly [number, number];
  readonly lift: number;
  readonly role: number;
  readonly fabric: number;
}

/**
 * A sheet laid on a person's front: `at` says where each corner of a grid goes, and each vertex rides the bones of what
 * is under it.
 */
function drape(net: Net, front: Front, sheet: Sheet): number {
  const { rows, cols, at, lift, role, fabric } = sheet;
  const from = net.position.length / 3;
  const point = (r: number, c: number): Vec => {
    const [x, y] = at(r / rows, c / cols);
    return [x, y, front.z(x, y) + lift];
  };
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const q = point(r, c);
      const across = sub(point(r, Math.min(cols, c + 1)), point(r, Math.max(0, c - 1)));
      const down = sub(point(Math.max(0, r - 1), c), point(Math.min(rows, r + 1), c));
      const n = unit(cross(across, down), FRONT);
      const under = Math.max(0, front.near(q[0], q[1]));
      net.position.push(...q);
      net.normal.push(...n);
      net.role.push(role);
      net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0);
      net.weight.push(net.weight[under] ?? 1);
      net.fabric.push(fabric);
      net.loose.push(0);
      net.soft.push(0);
      net.cloth.push(q[0], q[2], q[1], NO_EDGE);
    }
  }
  gridQuads(net.index, from, rows, cols);
  return (rows + 1) * (cols + 1);
}

/**
 * A jacket's open front, near to: a shirt in the V of it, lapels turned back along each edge, a formal one's tie, and
 * the buttons below.
 */
export function jacketFront(w: Wearer): readonly number[] {
  const { net, p, roles, cell } = w;
  const { top, costume } = p.outfit;
  if ((top !== "jacket" && top !== "blazer") || costume === "firefighter" || cell >= WRAPPED) return [];
  const size = p.build.size;
  const s = restSkeleton(p);
  const topRole = roles.indexOf("top");
  const high = (s.neck[1] - 0.03) * size;
  const low = (s.waist[1] + 0.05) * size;
  const mid = s.chest[2] * size;
  const cloth = topCloth(p);
  const front = frontBound(net, (v) => net.fabric[v] === cloth && (net.position[v * 3 + 2] ?? 0) > mid, 0.01 * size);
  const crest = Array.from({ length: 12 }, (_, i) => high + (i - 4) * 0.008 * size).reduce(
    (best, at) => (front.near(0, at) >= 0 ? at : best),
    low,
  );
  const open = (t: number): number => (0.006 + t * 0.05) * size;
  const y = (t: number): number => mix(low, crest, t);
  const shirt: Sheet["at"] = (t, u) => [mix(-open(t), open(t), u), y(t)];
  let count = drape(net, front, { rows: 12, cols: 6, at: shirt, lift: 0.006 * size, role: roles.indexOf("shirt"), fabric: FABRICS.cotton });
  for (const x of [-1, 1]) {
    const lapel: Sheet["at"] = (t, u) => {
      const wide = (0.012 + 0.04 * Math.sin(t * Math.PI * 0.92)) * size;
      return [x * (open(t) + u * wide - 0.003 * size), y(t)];
    };
    count += drape(net, front, { rows: 12, cols: 3, at: lapel, lift: 0.009 * size, role: topRole, fabric: cloth });
  }
  if (top === "blazer") {
    const tie: Sheet["at"] = (t, u) => {
      const wide = mix(0.016, 0.008, t) * size;
      return [mix(-wide, wide, u), y(mix(0.08, 0.98, t))];
    };
    count += drape(net, front, { rows: 10, cols: 3, at: tie, lift: 0.01 * size, role: roles.indexOf("dark"), fabric: FABRICS.satin });
  }
  const buttons: Sheet["at"] = (t, u) => [(u - 0.5) * 0.004 * size, mix(y(0) - 0.16 * size, y(0), t)];
  count += drape(net, front, { rows: 5, cols: 1, at: buttons, lift: 0.008 * size, role: roles.indexOf("dark"), fabric: FABRICS.cotton });
  return Array.from({ length: count }, () => 0.88);
}

/** How high a top reaches at each bearing round a point: its neckline, as an elevation, smoothed. */
function necklineOf(net: Net, c: Vec, size: number, keep: (v: number) => boolean): Float64Array {
  const around = 36;
  const rim = new Float64Array(around).fill(-Math.PI / 2);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = sub(scale(vecAt(net.position, v), 1 / size), c);
    const a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * around) % around;
    rim[a] = Math.max(rim[a] ?? 0, Math.asin(clamp(q[1] / (Math.hypot(...q) || 1), -1, 1)));
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const was = rim.slice();
    for (let a = 0; a < around; a += 1) {
      rim[a] = ((was[(a + around - 1) % around] ?? 0) + (was[a] ?? 0) * 2 + (was[(a + 1) % around] ?? 0)) / 4;
    }
  }
  return rim;
}

/** Where a collar lies round a point `c`: `t` down from the neckline, `u` round from one front point to the other. */
function collarOf(c: Vec, r: number, bound: Bound, rim: Float64Array): (t: number, u: number) => Vec {
  const rimAt = (az: number): number => {
    const a = (az / TAU) * rim.length - 0.5;
    const a0 = Math.floor(a);
    const at = (i: number): number => rim[(i + rim.length) % rim.length] ?? 0;
    return mix(at(a0), at(a0 + 1), a - a0);
  };
  return (t, u) => {
    const open = mix(0.2, 0.62, t);
    const az = mix(open, TAU - open, u);
    const fore = (1 + Math.cos(az)) / 2;
    const el = rimAt(az) + 0.12 - t * mix(0.2, 0.6, fore * fore);
    const d = bearingOf(az, el);
    return add(c, scale(d, r * (bound.far(d) + mix(0.18, 0.11, t))));
  };
}

/** A collar as it is laid: round what point, in head radii to metres, of what, on what front, and where it lies. */
interface Collar {
  readonly c: Vec;
  readonly size: number;
  readonly role: number;
  readonly fabric: number;
  readonly front: Front;
  readonly at: (t: number, u: number) => Vec;
}

/** The strip of a collar, `rows` down by `cols` round, each vertex riding the bones of what is under it. */
function collarSheet(net: Net, collar: Collar, rows: number, cols: number): void {
  const { c, size, role, fabric, front, at } = collar;
  const from = net.position.length / 3;
  for (let t = 0; t <= rows; t += 1) {
    for (let u = 0; u <= cols; u += 1) {
      const q = at(t / rows, u / cols);
      const here = scale(q, size);
      const n = unit(sub(q, c), FRONT);
      const under = Math.max(0, front.near(here[0], here[1]));
      net.position.push(...here);
      net.normal.push(...n);
      net.role.push(role);
      net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0);
      net.weight.push(net.weight[under] ?? 1);
      net.fabric.push(fabric);
      net.loose.push(0);
      net.soft.push(0);
      net.cloth.push(here[0], here[2], here[1], NO_EDGE);
    }
  }
  gridQuads(net.index, from, rows, cols);
}

/**
 * A polo's collar, near to: one strip from the neckline round the back of the neck and down to two points at the front,
 * and the short placket under them.
 */
export function poloFront(w: Wearer): readonly number[] {
  const { net, p, roles, cell } = w;
  if (p.outfit.top !== "polo" || cell >= WRAPPED) return [];
  const size = p.build.size;
  const s = restSkeleton(p);
  const cloth = topCloth(p);
  const mid = s.chest[2] * size;
  const topRole = roles.indexOf("top");
  const hi = s.chest[1] * size;
  const worn = (v: number): boolean =>
    net.fabric[v] === cloth && net.bones[v * 2] !== HEAD && (net.position[v * 3 + 1] ?? 0) > hi;
  const c: Vec = [0, s.neck[1] - 0.05, s.neck[2]];
  const r = 0.07;
  const bound = boundOf(net, { c, r }, size, worn);
  const rim = necklineOf(net, c, size, worn);
  const rows = 5;
  const cols = 56;
  const front = frontBound(net, (v) => worn(v) && (net.position[v * 3 + 2] ?? 0) > mid, 0.008 * size);
  collarSheet(net, { c, size, role: topRole, fabric: cloth, front, at: collarOf(c, r, bound, rim) }, rows, cols);
  const placketAt: Sheet["at"] = (t, u) => [
    (u - 0.5) * 0.022 * size,
    mix(s.chest[1] + 0.03, s.neck[1] - 0.04, t) * size,
  ];
  const strip: Sheet = { rows: 3, cols: 1, at: placketAt, lift: 0.003 * size, role: topRole, fabric: cloth };
  const placket = drape(net, front, strip);
  const collar = Array.from({ length: (rows + 1) * (cols + 1) }, () => 0.8);
  return [...collar, ...Array.from({ length: placket }, () => 0.85)];
}
