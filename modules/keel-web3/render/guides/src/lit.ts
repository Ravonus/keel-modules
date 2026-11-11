// The minimal keel/lit surface this module uses. Pass the keel/lit namespace itself.

export interface Uniform {
  value: unknown;
}
interface Elements {
  readonly elements: ArrayLike<number>;
}
export interface Disposable {
  dispose(): void;
}
export interface TextureLike extends Disposable {
  minFilter: string;
  magFilter: string;
  generateMipmaps: boolean;
  needsUpdate: boolean;
}
export interface RenderTargetLike extends Disposable {
  readonly width: number;
  readonly height: number;
  readonly textures: readonly TextureLike[];
  setSize(width: number, height: number): void;
}
export interface MaterialLike extends Disposable {
  readonly name?: string;
  readonly userData?: Readonly<Record<string, unknown>>;
  readonly defines?: Readonly<Record<string, unknown>>;
  readonly side?: string;
  /** A built-in material's base colour, linear. */
  readonly color?: { readonly r: number; readonly g: number; readonly b: number };
  readonly uniforms?: Readonly<Record<string, Uniform>>;
}
interface GeometryLike {
  readonly groups?: readonly { readonly materialIndex?: number }[];
  boundingSphere: { readonly center: { x: number; y: number; z: number }; readonly radius: number } | null;
  computeBoundingSphere(): void;
}
/** Anything in the stage; meshes, lights and the rest are told apart by their flags. */
export interface NodeLike {
  readonly name?: string;
  readonly userData?: Readonly<Record<string, unknown>>;
  visible: boolean;
  readonly matrixWorld: Elements;
  readonly isMesh?: boolean;
  readonly isSunLight?: boolean;
  readonly intensity?: number;
  readonly target?: { readonly matrixWorld: Elements; updateMatrixWorld(force?: boolean): void };
  geometry?: GeometryLike;
  material?: MaterialLike | MaterialLike[];
}
export interface StageLike {
  background: unknown;
  fog: unknown;
  overrideMaterial: unknown;
  traverseVisible(callback: (node: NodeLike) => void): void;
  updateMatrixWorld(force?: boolean): void;
  add(node: unknown): void;
}
export interface CameraLike {
  readonly near: number;
  readonly matrixWorld: Elements;
  readonly matrixWorldInverse: Elements;
  readonly projectionMatrix: Elements;
  updateMatrixWorld(force?: boolean): void;
}
export interface OrthoCameraLike extends CameraLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  far: number;
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): void;
  updateProjectionMatrix(): void;
}
export interface ColorLike {
  r: number;
  g: number;
  b: number;
}
export interface RendererLike {
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  render(stage: unknown, camera: unknown): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  setClearColor(color: number | ColorLike, alpha: number): void;
  getClearColor(target: ColorLike): ColorLike;
  getClearAlpha(): number;
  readRenderTargetPixels(
    target: unknown, x: number, y: number, width: number, height: number, buffer: ArrayBufferView,
    face?: number, index?: number,
  ): void;
}

export interface GuidesLit {
  readonly RenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) =>
    RenderTargetLike;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number, format: string, type: string) =>
    TextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => { frustumCulled: boolean };
  readonly Stage: new () => StageLike;
  readonly OrthoCamera: new (l: number, r: number, t: number, b: number, n: number, f: number) => OrthoCameraLike;
  readonly Color: new () => ColorLike;
  plane(width: number, height: number): Disposable;
}
