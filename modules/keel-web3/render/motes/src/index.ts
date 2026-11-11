/**
 * motes: dust, light motes and sparkles for keel/lit, as one instanced quad (see the README). keel/lit is passed in,
 * so this module imports nothing. The time comes from the host's clock, never a wall clock: a paused clock is a still
 * field, and any frame can be drawn on its own.
 */

import { MOTE_FRAGMENT, MOTE_VERTEX } from "./motes.glsl.js";
import { moteSettings, placeMotes } from "./place.js";
import type { MoteDensity, MoteSettings } from "./place.js";

export { MOTE_FRAGMENT, MOTE_PATH_GLSL, MOTE_VERTEX } from "./motes.glsl.js";
export { DEFAULT_MOTES, moteHash, moteSettings, placeMotes } from "./place.js";
export type { MoteDensity, MoteField, MoteSettings, Vec3 } from "./place.js";

interface Uniform {
  value: unknown;
}
interface AttributeLike {
  readonly array: ArrayLike<number>;
}
interface NodeLike {
  frustumCulled: boolean;
  renderOrder: number;
  visible: boolean;
}
interface InstancesLike extends NodeLike {
  count: number;
}
interface GeometryLike {
  setAttribute(name: string, attribute: unknown): unknown;
  dispose(): void;
}
interface MaterialLike {
  readonly uniforms: Record<string, Uniform>;
  dispose(): void;
}
interface ColorLike {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
interface Vector2Like {
  set(x: number, y: number): unknown;
}
interface Vector3Like {
  set(x: number, y: number, z: number): unknown;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancesLike;
  readonly InstanceAttribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Color: new (value?: string) => ColorLike;
  readonly Vector2: new (x?: number, y?: number) => Vector2Like;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  plane(width: number, height: number): GeometryLike;
}

/** One frame: the host's clock, and the keyed field values. */
export interface MoteFrame {
  /** Seconds on the host's clock. Ignored when `still`. */
  readonly time: number;
  /** Multiplies every mote's opacity, 0 to 1 (a keyed fade). Default 1. */
  readonly opacity?: number;
  /** Reduced motion: the field holds at time 0, with no blink. */
  readonly still?: boolean;
}

/** A field of motes in the scene. */
export interface Motes {
  /** The instanced quad: add it to the stage; move or rotate it to move the whole field. */
  readonly mesh: NodeLike;
  /** How many motes are drawn, up to the settings' count (a quality lever). */
  shown: number;
  /** The drawing buffer's size in pixels, for pixel sizes and the smallest size. Call on resize. */
  resize(width: number, height: number): void;
  /** Sets the clock and the keyed values for the next draw. */
  update(frame: MoteFrame): void;
  dispose(): void;
}

/** The field's instance attributes, colours taken through keel/lit so they land in its working colour space. */
function attributesOf(lit: LitLike, s: MoteSettings, density: MoteDensity | undefined): Record<string, unknown> {
  const field = placeMotes(s, density);
  const palette = s.colors.map((hex) => new lit.Color(hex));
  const color = new Float32Array(field.count * 3);
  for (let i = 0; i < field.count; i += 1) {
    const c = palette[field.color[i] ?? 0] ?? { r: 1, g: 1, b: 1 };
    color.set([c.r, c.g, c.b], i * 3);
  }
  return {
    aMote: new lit.InstanceAttribute(field.mote, 4),
    aLife: new lit.InstanceAttribute(field.life, 4),
    aColor: new lit.InstanceAttribute(color, 3),
  };
}

interface MoteUniforms {
  readonly uTime: { value: number };
  readonly uBlink: { value: number };
  readonly uOpacity: { value: number };
  readonly uPixel: { value: Vector2Like };
  readonly [name: string]: Uniform;
}

function uniformsOf(lit: LitLike, s: MoteSettings): MoteUniforms {
  const min = s.centre.map((c, axis) => c - (s.box[axis] ?? 1) / 2);
  return {
    uTime: { value: 0 },
    uBlink: { value: s.blink },
    uOpacity: { value: s.opacity },
    uIntensity: { value: s.intensity },
    uMinPixels: { value: s.minPixels },
    uPixel: { value: new lit.Vector2(2 / 1024, 2 / 1024) },
    uDrift: { value: new lit.Vector3(s.drift[0], s.drift[1], s.drift[2]) },
    uBoxMin: { value: new lit.Vector3(min[0], min[1], min[2]) },
    uBox: { value: new lit.Vector3(s.box[0], s.box[1], s.box[2]) },
    uTurbulence: { value: s.turbulence },
  };
}

/**
 * Makes a field of motes: one instanced quad, every mote's drift, turbulence and blink worked out in the vertex shader
 * from the time `update` hands in. Additive, unlit, and drawn after the opaque scene without writing depth.
 *
 * @param lit The keel/lit namespace.
 * @param settings The field's settings; anything missing takes `DEFAULT_MOTES`.
 * @param density Optional: where motes are welcome, 0 to 1, to thin the field in places.
 * @returns The field: add `mesh` to the stage.
 */
export function createMotes(lit: LitLike, settings: Partial<MoteSettings> = {}, density?: MoteDensity): Motes {
  const s = moteSettings(settings);
  const geometry = lit.plane(1, 1);
  for (const [name, attribute] of Object.entries(attributesOf(lit, s, density))) geometry.setAttribute(name, attribute);
  const uniforms = uniformsOf(lit, s);
  const material = new lit.CustomMaterial({
    uniforms,
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
    defines: s.attenuate ? { ATTENUATE: "" } : {},
    transparent: true,
    depthWrite: false,
    blending: "add",
  });
  const mesh = new lit.Instances(geometry, material, s.count);
  mesh.frustumCulled = false;
  return {
    mesh,
    get shown() {
      return mesh.count;
    },
    set shown(n: number) {
      mesh.count = Math.max(0, Math.min(s.count, Math.floor(n)));
    },
    resize(width, height) {
      uniforms.uPixel.value.set(2 / Math.max(1, width), 2 / Math.max(1, height));
    },
    update(frame) {
      const still = frame.still === true;
      uniforms.uTime.value = still ? 0 : frame.time;
      uniforms.uBlink.value = still ? 0 : s.blink;
      uniforms.uOpacity.value = s.opacity * Math.max(0, Math.min(1, frame.opacity ?? 1));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
