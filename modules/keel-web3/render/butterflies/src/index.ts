/**
 * butterflies: a small flock of glowing butterflies for keel/lit (see the README). keel/lit is passed in, so this
 * module imports nothing. The time comes from the host's clock, never a wall clock.
 */

import { BUTTERFLY_FRAGMENT, BUTTERFLY_VERTEX } from "./butterflies.glsl.js";
import { butterflySettings, flyAt, planFlights } from "./flight.js";
import { wingMesh, wingOutline } from "./wing.js";
import type { ButterflyColors, ButterflySettings, Flight, Pose } from "./flight.js";
import type { ShapeLike } from "./wing.js";

export { BUTTERFLY_FRAGMENT, BUTTERFLY_VERTEX } from "./butterflies.glsl.js";
export { DEFAULT_BUTTERFLIES, butterflySettings, flightHash, flyAt, planFlights } from "./flight.js";
export type { ButterflyColors, ButterflySettings, Flight, KeepOut, Pose, Vec3 } from "./flight.js";
export { wingMesh, wingOutline, windingOf } from "./wing.js";
export type { ShapeLike, WingMesh, WingPoint } from "./wing.js";

interface Uniform {
  value: unknown;
}
interface AttributeLike {
  readonly array: ArrayLike<number>;
  needsUpdate: boolean;
}
interface NodeLike {
  frustumCulled: boolean;
  visible: boolean;
}
interface InstancesLike extends NodeLike {
  count: number;
  readonly instanceMatrix: { readonly array: Float32Array; needsUpdate: boolean };
}
interface GeometryLike {
  setAttribute(name: string, attribute: unknown): unknown;
  setIndex(index: readonly number[]): unknown;
  dispose(): void;
}
interface MaterialLike {
  dispose(): void;
}
interface ColorLike {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
interface Vector3Like {
  set(x: number, y: number, z: number): unknown;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancesLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly InstanceAttribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Color: new (value?: string) => ColorLike;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Shape: new () => ShapeLike;
}

/** One frame: the host's clock. */
export interface ButterflyFrame {
  /** Seconds on the host's clock. Ignored when `still`. */
  readonly time: number;
  /** Reduced motion: the flock holds where it is at time 0, wings open, still glowing. */
  readonly still?: boolean;
}

/** A flock in the scene. */
export interface Butterflies {
  /** The instanced mesh: add it to the stage. */
  readonly mesh: NodeLike;
  /** Places the flock and beats its wings for the next draw. */
  update(frame: ButterflyFrame): void;
  /** Recolours the flock (a section's hue). */
  setColors(colors: Partial<ButterflyColors>): void;
  dispose(): void;
}

interface FlockUniforms {
  readonly uTime: { value: number };
  readonly uStill: { value: number };
  readonly uUpper: { value: Vector3Like };
  readonly uUnder: { value: Vector3Like };
  readonly uBody: { value: Vector3Like };
  readonly [name: string]: Uniform;
}

function geometryOf(lit: LitLike, flights: readonly Flight[]): GeometryLike {
  const mesh = wingMesh(wingOutline(new lit.Shape()));
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(mesh.position, 3));
  geometry.setAttribute("aWing", new lit.Attribute(mesh.wing, 2));
  geometry.setAttribute("aFlap", new lit.InstanceAttribute(new Float32Array(flights.map((f) => f.flap)), 1));
  geometry.setIndex(mesh.index);
  return geometry;
}

function uniformsOf(lit: LitLike, s: ButterflySettings): FlockUniforms {
  return {
    uTime: { value: 0 },
    uStill: { value: 0 },
    uFlapHz: { value: s.flapHz },
    uGlow: { value: s.glow },
    uLight: { value: s.light },
    uUpper: { value: new lit.Vector3(1, 1, 1) },
    uUnder: { value: new lit.Vector3(1, 1, 1) },
    uBody: { value: new lit.Vector3(1, 1, 1) },
  };
}

/** Writes one butterfly's matrix: facing its flight, wings level, scaled to its wingspan (the mesh spans 2). */
function place(matrices: Float32Array, slot: number, pose: Pose, scale: number): void {
  const [fx, fy, fz] = pose.front;
  const level = Math.hypot(fx, fz);
  // (x is level and square to the front; y = front x right completes the frame.)
  const [rx, rz] = level > 1e-6 ? [fz / level, -fx / level] : [1, 0];
  const [ux, uy, uz] = [fy * rz, fz * rx - fx * rz, -fy * rx];
  const s = scale / 2;
  matrices.set([rx * s, 0, rz * s, 0, ux * s, uy * s, uz * s, 0, fx * s, fy * s, fz * s, 0], slot * 16);
  matrices.set([pose.at[0], pose.at[1], pose.at[2], 1], slot * 16 + 12);
}

const SLOTS = { upper: "uUpper", under: "uUnder", body: "uBody" } as const;

/**
 * Makes a flock of butterflies: one instanced mesh, two wings from a Shape and a body, the wings beating in the vertex
 * shader on the host's clock; the flock wanders as sums of sines, worked out on the CPU each update.
 *
 * @param lit The keel/lit namespace.
 * @param settings The flock's settings; anything missing takes `DEFAULT_BUTTERFLIES`.
 * @returns The flock: add `mesh` to the stage.
 */
export function createButterflies(lit: LitLike, settings: Partial<ButterflySettings> = {}): Butterflies {
  const s = butterflySettings(settings);
  const flights = planFlights(s);
  const geometry = geometryOf(lit, flights);
  const uniforms = uniformsOf(lit, s);
  const material = new lit.CustomMaterial({
    uniforms,
    vertexShader: BUTTERFLY_VERTEX,
    fragmentShader: BUTTERFLY_FRAGMENT,
    side: "both",
  });
  const mesh = new lit.Instances(geometry, material, Math.max(1, flights.length));
  mesh.count = flights.length;
  mesh.frustumCulled = false;
  const colors = { ...s.colors };
  const flock: Butterflies = {
    mesh,
    update(frame) {
      const still = frame.still === true;
      const time = still ? 0 : frame.time;
      uniforms.uTime.value = time;
      uniforms.uStill.value = still ? 1 : 0;
      flights.forEach((flight, slot) => {
        place(mesh.instanceMatrix.array, slot, flyAt(flight, time, s), s.scale);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    setColors(next) {
      Object.assign(colors, next);
      for (const key of ["upper", "under", "body"] as const) {
        const c = new lit.Color(colors[key]);
        uniforms[SLOTS[key]].value.set(c.r, c.g, c.b);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  flock.setColors(colors);
  flock.update({ time: 0 });
  return flock;
}
