// Where the guided parts sit: their bounds, the depth range the `depth` pass spends its 16 bits on, the key light's
// direction in view space and the frame its shadow map covers. Matrices are column-major, as keel/lit keeps them.

export type Vec3 = readonly [number, number, number];
type Elements = ArrayLike<number>;

/** A ball round a part, in the world. */
export interface Sphere {
  readonly centre: Vec3;
  readonly radius: number;
}

const e = (m: Elements, i: number): number => m[i] ?? 0;

/** A point (`w` 1) or a direction (`w` 0) through a 4×4 matrix. */
export function transform(m: Elements, p: Vec3, w: number): Vec3 {
  return [
    e(m, 0) * p[0] + e(m, 4) * p[1] + e(m, 8) * p[2] + e(m, 12) * w,
    e(m, 1) * p[0] + e(m, 5) * p[1] + e(m, 9) * p[2] + e(m, 13) * w,
    e(m, 2) * p[0] + e(m, 6) * p[1] + e(m, 10) * p[2] + e(m, 14) * w,
  ];
}

/** `a × b` for 4×4 matrices. */
export function multiply(a: Elements, b: Elements): number[] {
  const out: number[] = [];
  for (let c = 0; c < 4; c += 1)
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += e(a, k * 4 + r) * e(b, c * 4 + k);
      out.push(sum);
    }
  return out;
}

const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

export function normalize(v: Vec3): Vec3 {
  const l = length(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** A local ball taken into the world by a model matrix: its radius by the largest scale. */
export function worldSphere(model: Elements, local: Sphere): Sphere {
  const scale = Math.max(
    length(transform(model, [1, 0, 0], 0)),
    length(transform(model, [0, 1, 0], 0)),
    length(transform(model, [0, 0, 1], 0)),
  );
  return { centre: transform(model, local.centre, 1), radius: local.radius * scale };
}

/** One ball round all of them: centred on their box, wide enough for the farthest. */
export function enclose(spheres: readonly Sphere[]): Sphere {
  if (!spheres.length) return { centre: [0, 0, 0], radius: 1 };
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const { centre, radius } of spheres)
    for (let k = 0; k < 3; k += 1) {
      low[k] = Math.min(low[k] ?? 0, (centre[k] ?? 0) - radius);
      high[k] = Math.max(high[k] ?? 0, (centre[k] ?? 0) + radius);
    }
  const mid = (k: number): number => ((low[k] ?? 0) + (high[k] ?? 0)) / 2;
  const centre: Vec3 = [mid(0), mid(1), mid(2)];
  let radius = 0;
  for (const s of spheres) {
    const d = [s.centre[0] - centre[0], s.centre[1] - centre[1], s.centre[2] - centre[2]] as const;
    radius = Math.max(radius, length(d) + s.radius);
  }
  return { centre, radius };
}

/** The view distances the parts lie between (`view` is the camera's world-to-view), kept past the camera's near. */
export function depthRange(
  spheres: readonly Sphere[],
  view: Elements,
  near: number,
): { readonly near: number; readonly far: number } {
  let low = Infinity;
  let high = -Infinity;
  for (const s of spheres) {
    const z = -transform(view, s.centre, 1)[2];
    low = Math.min(low, z - s.radius);
    high = Math.max(high, z + s.radius);
  }
  if (!Number.isFinite(low)) return { near, far: near + 1 };
  const from = Math.max(near, low);
  return { near: from, far: Math.max(high, from + 1e-6) };
}

/** Where the shadow camera stands and how much it sees: down the key, round the parts' ball. */
export function shadowFrame(
  ball: Sphere,
  key: Vec3,
): { readonly eye: Vec3; readonly half: number; readonly far: number } {
  const k = normalize(key);
  const back = ball.radius * 2;
  return {
    eye: [ball.centre[0] + k[0] * back, ball.centre[1] + k[1] * back, ball.centre[2] + k[2] * back],
    half: ball.radius,
    far: ball.radius * 3.5,
  };
}
