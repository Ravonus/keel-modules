/**
 * camera-rail: a camera on keyed tracks, scrubbed by position. MIT.
 *
 * `at(position, frame)` samples the camera's eye, target, fov and roll from
 * its tracks through the `tracks` module's sampler (passed in), turns the
 * view by the pointer's pan and tilt, and returns the view. A baked flight
 * rides a Catmull-Rom path by a keyed `along`. `applyView` puts a view on a
 * keel/lit camera, which is injected: the maths never touches a renderer.
 */

/** An [x, y, z] in world units. */
export type Vec3 = readonly [number, number, number];
/** What a sampled property holds: the `tracks` module's Value. */
export type Value = number | readonly number[] | string;
/** The `tracks` module's `sampleTracks`, or anything of its shape: values by target, then property. */
export type Sampler<T> = (
  tracks: T,
  position: number,
  time?: number,
) => Readonly<Record<string, Readonly<Record<string, Value>>>>;

/** A Catmull-Rom path the eye, and the target when given, ride by the keyed `along` (0..1). */
export interface RailPath {
  readonly eye: readonly Vec3[];
  readonly target?: readonly Vec3[];
}

/** How a rail is set up. */
export interface RailOptions<T> {
  /** The tracks, in the `tracks` module's format. */
  readonly tracks: T;
  /** The target name the camera's tracks use. Defaults to "camera". */
  readonly name?: string;
  /** The pointer's pan scale: the pointer at a side edge turns the view by 0.1 rad times this. Defaults to 0. */
  readonly pan?: number;
  /** The pointer's tilt scale, the same for the top and bottom edges. Defaults to 0. */
  readonly tilt?: number;
  /** The fov in degrees when no track keys one. Defaults to 30. */
  readonly fov?: number;
  /** A path for a baked flight, ridden by the keyed `along`. */
  readonly path?: RailPath;
}

/** What the page knows this frame. */
export interface Frame {
  /** The pointer, each axis in -1..1 with y up; null or left out when it is away. */
  readonly pointer?: { readonly x: number; readonly y: number } | null;
  /** Scroll velocity, 0 at rest. See {@link pointerStrength}. */
  readonly velocity?: number;
  /** The clock, for tracks driven by time. */
  readonly time?: number;
}

/** The camera this frame: eye and target in world units, fov in degrees, roll in radians round the view axis. */
export interface View {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  readonly roll: number;
}

/** A rail: {@link createCameraRail}. */
export interface CameraRail {
  /** The view at `position`. Call once a frame: the pointer's smoothing steps on each call. */
  at(position: number, frame?: Frame): View;
}

/** The parts of a keel/lit camera {@link applyView} touches. Pass the stage's PerspectiveCamera. */
export interface RailCamera {
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): unknown;
  rotateZ(angle: number): unknown;
  fov: number;
  updateProjectionMatrix(): unknown;
}

/**
 * The pointer's hold on the view: 1 at rest, `0.05 + max(0, 0.2 - |v| * 10)` while scrolling, so it
 * floors at 0.05 from |v| = 0.02 up.
 *
 * @param velocity The scroll velocity, 0 at rest.
 * @returns The strength, 0.05..1.
 */
export function pointerStrength(velocity: number): number {
  return velocity === 0 ? 1 : 0.05 + Math.max(0, 0.2 - Math.abs(velocity) * 10);
}

/**
 * A point along a Catmull-Rom spline through `points`, the ends held.
 *
 * @param points The points the spline passes through, in order.
 * @param u How far along, 0 at the first point and 1 at the last; clamped.
 * @returns The point there.
 */
export function catmullRom(points: readonly Vec3[], u: number): Vec3 {
  const last = points.length - 1;
  const s = Math.min(Math.max(u, 0), 1) * last;
  const i = Math.min(Math.floor(s), last - 1);
  const t = s - i;
  const p = (j: number): Vec3 => points[Math.min(Math.max(j, 0), last)] ?? [0, 0, 0];
  const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
  const axis = (k: 0 | 1 | 2): number =>
    0.5 *
    (2 * p1[k] +
      (p2[k] - p0[k]) * t +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t +
      (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t);
  return [axis(0), axis(1), axis(2)];
}

/**
 * Turns the view from `eye` to `target`: `pan` radians round the up axis, positive to the right,
 * then `tilt` round the view's right axis, positive upward. The distance to the target is kept.
 *
 * @param eye Where the camera stands.
 * @param target What it looks at before the turn.
 * @param pan The turn round the up axis, radians.
 * @param tilt The turn up or down, radians.
 * @returns What it looks at after the turn.
 */
export function turnView(eye: Vec3, target: Vec3, pan: number, tilt: number): Vec3 {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const x = dx * Math.cos(pan) - dz * Math.sin(pan);
  const z = dx * Math.sin(pan) + dz * Math.cos(pan);
  const flat = Math.sqrt(x * x + z * z);
  if (flat === 0) return [eye[0] + x, eye[1] + dy, eye[2] + z];
  const length = Math.sqrt(flat * flat + dy * dy);
  const up = Math.atan2(dy, flat) + tilt;
  const scale = (Math.cos(up) * length) / flat;
  return [eye[0] + x * scale, eye[1] + Math.sin(up) * length, eye[2] + z * scale];
}

/**
 * Puts a view on a keel/lit camera: stands it at the eye, aims it at the target, rolls it, and sets
 * the fov when it changed.
 *
 * @param camera The camera, injected.
 * @param view The view to apply.
 */
export function applyView(camera: RailCamera, view: View): void {
  camera.position.set(view.eye[0], view.eye[1], view.eye[2]);
  camera.lookAt(view.target[0], view.target[1], view.target[2]);
  if (view.roll !== 0) camera.rotateZ(view.roll);
  if (camera.fov !== view.fov) {
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
  }
}

const num = (value: Value | undefined, or: number): number => (typeof value === "number" ? value : or);
const vec = (value: Value | undefined): Vec3 | undefined =>
  typeof value === "object" && value.length === 3 ? [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0] : undefined;

/**
 * Builds a rail on keyed tracks. The camera's tracks key `eye`, `target` (vectors), `fov` (degrees),
 * `roll` (radians) and `along` (0..1 on the path); each is optional.
 *
 * @param sample The `tracks` module's `sampleTracks`.
 * @param options The tracks, the pointer scales, the default fov and the path.
 * @returns The rail.
 */
export function createCameraRail<T>(sample: Sampler<T>, options: RailOptions<T>): CameraRail {
  const { tracks, name = "camera", pan = 0, tilt = 0, fov = 30, path } = options;
  // The pointer's smoothing, a step a frame: strength by 0.1, pan and tilt by 0.5 times the strength.
  const held = { strength: 1, pan: 0, tilt: 0 };
  const steer = (frame: Frame): void => {
    const pointer = frame.pointer ?? { x: 0, y: 0 };
    held.strength += (pointerStrength(frame.velocity ?? 0) - held.strength) * 0.1;
    const rate = 0.5 * held.strength;
    held.pan += (pointer.x * 0.1 * pan - held.pan) * rate;
    held.tilt += (pointer.y * 0.1 * tilt - held.tilt) * rate;
  };
  const place = (cam: Readonly<Record<string, Value>>): [Vec3, Vec3] => {
    const along = num(cam.along, 0);
    const eye = vec(cam.eye) ?? (path ? catmullRom(path.eye, along) : [0, 0, 5]);
    const target = vec(cam.target) ?? (path?.target ? catmullRom(path.target, along) : [0, 0, 0]);
    return [eye, target];
  };
  return {
    at(position, frame = {}) {
      const cam = sample(tracks, position, frame.time)[name] ?? {};
      const [eye, target] = place(cam);
      steer(frame);
      const aimed = held.pan === 0 && held.tilt === 0 ? target : turnView(eye, target, held.pan, held.tilt);
      return { eye, target: aimed, fov: num(cam.fov, fov), roll: num(cam.roll, 0) };
    },
  };
}
