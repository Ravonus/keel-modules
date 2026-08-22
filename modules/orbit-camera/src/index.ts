/** Framework-free orbit-camera matrices for lightweight 3D artwork. MIT. */

/** An [x, y, z] position in world space. */
export type Vec3 = readonly [number, number, number];

/** Options for {@link orbitPosition}. */
export interface OrbitOptions {
  /** Point the camera orbits. Defaults to [0, 0, 0]. */
  readonly target?: Vec3;
  /** Rotation around the vertical axis in radians. Defaults to 0. */
  readonly yaw?: number;
  /** Elevation angle in radians, clamped just inside plus or minus pi/2. Defaults to 0. */
  readonly pitch?: number;
  /** Distance from the target, clamped to at least 0.001. Defaults to 5. */
  readonly distance?: number;
}

/**
 * Computes the camera eye position for an orbit around a target point.
 *
 * @param options Target, yaw, pitch, and distance.
 * @returns The [x, y, z] eye position.
 */
export function orbitPosition({ target = [0, 0, 0], yaw = 0, pitch = 0, distance = 5 }: OrbitOptions): [number, number, number] {
  const safePitch = Math.min(Math.max(pitch, -Math.PI / 2 + 0.001), Math.PI / 2 - 0.001);
  const radius = Math.max(Number(distance), 0.001);
  const horizontal = Math.cos(safePitch) * radius;
  return [
    target[0] + Math.sin(yaw) * horizontal,
    target[1] + Math.sin(safePitch) * radius,
    target[2] + Math.cos(yaw) * horizontal,
  ];
}

/**
 * Builds a column-major 4x4 perspective projection matrix.
 *
 * @param fieldOfView Vertical field of view in radians, strictly between 0 and pi.
 * @param aspect Viewport width divided by height; must be positive.
 * @param near Near clip distance; must be positive. Defaults to 0.1.
 * @param far Far clip distance; must exceed near. Defaults to 1000.
 * @returns A 16-element Float32Array in WebGL column-major order.
 * @throws RangeError when any parameter is out of range.
 */
export function perspectiveMatrix(fieldOfView: number, aspect: number, near = 0.1, far = 1_000): Float32Array {
  if (!(fieldOfView > 0 && fieldOfView < Math.PI) || !(aspect > 0) || !(near > 0) || !(far > near)) throw new RangeError("Invalid perspective parameters.");
  const f = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * range, -1, 0, 0, 2 * near * far * range, 0]);
}
