// What this module is handed and hands back: the sea, the parts of keel/lit, the renderer and camera it reads, and the
// ocean's options, settings, light and result.

export type Vec = readonly [number, number, number];

/** The part of `generative/ocean`'s Sea this module reads. */
export interface SeaLike {
  readonly packed: Float32Array;
  readonly wind: number;
  surfaceAt(x: number, z: number, t: number, level?: number): { readonly height: number };
  seabedAt(x: number, z: number): number;
}

export interface Uniform { value: unknown }
export type Uniforms = Record<string, Uniform>;
export interface DisposableLike { dispose(): void }
export interface NodeLike {
  add(...nodes: unknown[]): void;
  frustumCulled: boolean;
  renderOrder: number;
  visible: boolean;
  receiveShadow: boolean;
}
export interface AttributeLike {
  readonly array: Float32Array;
  needsUpdate: boolean;
}
export interface GeometryLike extends DisposableLike {
  setAttribute(name: string, attribute: unknown): unknown;
  getAttribute(name: string): AttributeLike | undefined;
  setIndex(index: readonly number[]): unknown;
  computeVertexNormals(): void;
}
export interface InstancesLike extends NodeLike {
  count: number;
  readonly instanceMatrix: AttributeLike;
}
export interface TextureLike { readonly isTexture?: boolean }
export interface TargetLike extends DisposableLike {
  readonly texture: TextureLike;
  readonly depthTexture: TextureLike;
  setSize(width: number, height: number): void;
}
export interface Size { x: number; y: number }
export interface Matrix4Like {
  elements: number[];
  copy(matrix: unknown): Matrix4Like;
  invert(): Matrix4Like;
  multiplyMatrices(a: unknown, b: unknown): Matrix4Like;
}
export interface Vector4Like { set(x: number, y: number, z: number, w: number): Vector4Like }
export interface Vector3Like { set(x: number, y: number, z: number): Vector3Like }
export interface Vector2Like extends Size { set(x: number, y: number): Vector2Like }
export interface ColorLike { readonly r: number; readonly g: number; readonly b: number }
export interface DataTextureLike extends TextureLike, DisposableLike { needsUpdate: boolean }

/** The renderer calls this module makes. */
export interface RendererLike {
  autoClear: boolean;
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  getDrawingBufferSize(target: Vector2Like): Vector2Like;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: unknown, camera: unknown): void;
}

/** The camera fields this module reads. */
export interface CameraLike {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly matrixWorld: unknown;
  readonly matrixWorldInverse: unknown;
  readonly projectionMatrix: Matrix4Like;
  readonly projectionMatrixInverse: Matrix4Like;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Stage: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancesLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly InstanceAttribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly RenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) => TargetLike;
  readonly DepthTexture: new (width: number, height: number) => TextureLike;
  readonly DataTexture: new (
    data: Float32Array,
    width: number,
    height: number,
    format: string,
    type: string,
  ) => DataTextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => DisposableLike;
  readonly LitMaterial: new (parameters: Readonly<Record<string, unknown>>) => DisposableLike;
  readonly OrthoCamera: new (
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ) => unknown;
  readonly Vector2: new (x?: number, y?: number) => Vector2Like;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => Vector4Like;
  readonly Matrix4: new () => Matrix4Like;
  readonly Color: new (value?: string) => ColorLike;
  plane(width: number, height: number, segmentsX?: number, segmentsY?: number): GeometryLike;
}

export interface OceanOptions {
  readonly sea: SeaLike;
  /**
   * Per-metre absorption of red, green and blue: a little murkier than `generative/ocean`'s `CLEAR_WATER` by default,
   * so a scene ends in blue.
   */
  readonly absorption?: Vec;
  /** The colour the water scatters back, as shares of the sun. */
  readonly scatter?: Vec;
  /** The tide: the still water's height. */
  readonly level?: number;
  /** Across the seabed, metres. */
  readonly size?: number;
  /** The ground's colour, linear RGB, at a place on it: `generative/beach`'s `colorAt` fits. */
  readonly colorAt?: (x: number, y: number, z: number) => Vec;
  readonly exposure?: number;
  /** Seconds wet sand takes to dry a metre down from the highest line the water reached. */
  readonly dryTime?: number;
  /** `render/quality`'s createQuality, or anything answering the same. The default is steady high settings. */
  readonly quality?: QualityLike;
}

/** What one frame may spend: `render/quality`'s Settings. */
export interface OceanSettings {
  readonly renderScale: number;
  readonly upscale: boolean;
  readonly reflectSteps: number;
  readonly shadowSteps: number;
  readonly traceFar: number;
  readonly traceNear: number;
  readonly casters: number;
  readonly shafts: number;
  readonly snow: number;
  /** The share of the surf's spray drawn, from 0 to 1. */
  readonly spray?: number;
}

/** Where the camera is, for a quality to judge. */
export interface OceanPlace {
  readonly under: boolean;
  readonly depth: number;
  readonly height: number;
  readonly clearance: number;
}

export interface QualityLike {
  at(place: OceanPlace): OceanSettings;
  frame(milliseconds: number): void;
}

/** A sphere standing in for part of an animal in the rays. */
export interface Caster {
  readonly at: Vec;
  readonly r: number;
  /** Linear RGB. */
  readonly tint: Vec;
}

export interface OceanLight {
  /** Toward the sun. */
  readonly sun: Vec;
  /** Linear RGB times intensity. */
  readonly sunColor: Vec;
  readonly zenith?: Vec;
  readonly horizon?: Vec;
  /** The tide, if it has moved since `createOcean`. */
  readonly level?: number;
  /** The animals, for the rays: `swarm.casters`. */
  readonly casters?: readonly Caster[];
  /** How long the last frame took, milliseconds, for the quality to hold the frame rate. */
  readonly frameMs?: number;
}

/** One frame of the ocean: the time, and the light at it. */
export interface OceanFrame extends OceanLight {
  /** Seconds, the sea's clock. */
  readonly t: number;
}

export interface Ocean {
  /** The seabed: add it to the scene. */
  readonly group: NodeLike;
  /** Whether a point is below the water at t. */
  isUnder(x: number, y: number, z: number, t: number): boolean;
  /** Draws the scene with the water over it at this frame, to the screen. */
  draw(renderer: RendererLike, scene: unknown, camera: CameraLike, frame: OceanFrame): void;
  dispose(): void;
}
