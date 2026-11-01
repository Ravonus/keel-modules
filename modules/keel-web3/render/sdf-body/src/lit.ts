// The parts of keel/lit this module calls.

// ---------------------------------------------------------------- the parts of keel/lit used

export interface ColorLike { r: number; g: number; b: number; set(value: string): ColorLike }
export interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector3Like }
export interface UniformLike<T> { value: T }
export interface MaterialLike { dispose(): void; uniforms?: Record<string, UniformLike<unknown>> }
export interface NodeLike {
  visible: boolean;
  frustumCulled: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  position: Vector3Like;
  scale: Vector3Like;
  add(...objects: unknown[]): void;
}
export interface InstancedLike extends NodeLike {
  count: number;
  readonly instanceMatrix: { needsUpdate: boolean };
  setMatrixAt(index: number, matrix: unknown): void;
}
export interface Matrix4Like { makeScale(x: number, y: number, z: number): Matrix4Like; setPosition(x: number, y: number, z: number): Matrix4Like }
export interface DisposableLike { dispose(): void }

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancedLike;
  box(x: number, y: number, z: number): DisposableLike;
  sphere(r: number, w: number, h: number): DisposableLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly FlatMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => unknown;
  readonly Color: new (value?: string) => ColorLike;
  readonly Matrix4: new () => Matrix4Like;
}
