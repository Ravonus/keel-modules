// The minimal keel/lit surface this module uses, and the finish it may draw each scene through.

export interface TextureLike {
  dispose(): void;
}
export interface DataTextureLike extends TextureLike {
  wrapS: string;
  wrapT: string;
  minFilter: string;
  magFilter: string;
  needsUpdate: boolean;
}
export interface RenderTargetLike {
  readonly texture: TextureLike;
  setSize(width: number, height: number): void;
  dispose(): void;
}
export interface Uniform {
  value: unknown;
}
export interface ShaderMaterialLike {
  readonly uniforms: Record<string, Uniform>;
  dispose(): void;
}
export interface RendererLike {
  getRenderTarget(): RenderTargetLike | null;
  setRenderTarget(target: RenderTargetLike | null): void;
  render(scene: unknown, camera: unknown): void;
}
export interface DisposableLike {
  dispose(): void;
}
interface MeshLike {
  frustumCulled: boolean;
}
export interface SceneLike {
  add(object: unknown): void;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly RenderTarget: new (
    width: number,
    height: number,
    options: Readonly<Record<string, unknown>>,
  ) => RenderTargetLike;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number, format: string) => DataTextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => ShaderMaterialLike;
  plane(width: number, height: number): DisposableLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => MeshLike;
  readonly Stage: new () => SceneLike;
  readonly OrthoCamera: new (
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ) => unknown;
}

/**
 * A finish that draws a scene onto the renderer's current target: lit-finish's `createLitFinish` result, or anything
 * of its shape. `settings`, `setSettings` and `dress` are optional; with them the blend pauses TAA for the overlap
 * and dresses both scenes.
 */
export interface FinishLike {
  render(scene: unknown, camera: unknown): void;
  setSize?(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  readonly settings?: { readonly taa?: boolean };
  setSettings?(input: unknown): unknown;
  dress?(root: unknown): void;
}
