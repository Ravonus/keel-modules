// The minimal keel/lit surface this module uses.

// ---------------------------------------------------------------- the minimal keel/lit surface it uses

interface ColorLike {
  copy(color: ColorLike): ColorLike;
}
export interface TextureLike {
  minFilter: unknown;
  magFilter: unknown;
  generateMipmaps: boolean;
  needsUpdate: boolean;
  dispose(): void;
}
export interface RenderTargetLike {
  readonly texture: TextureLike;
  readonly depthTexture: TextureLike | null;
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
export interface MaterialLike {
  readonly isLitMaterial?: boolean;
  onCompile?: (shader: { fragmentShader: string }, renderer: unknown) => void;
  customProgramCacheKey?: () => string;
  readonly color?: ColorLike;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  readonly userData: Record<string, unknown>;
  gradientMap?: TextureLike | null;
  readonly colorWrite?: boolean;
  needsUpdate: boolean;
  dispose(): void;
}
interface LayersLike {
  mask: number;
}
export interface NodeLike {
  readonly isMesh?: boolean;
  readonly layers?: LayersLike;
  material?: MaterialLike | MaterialLike[];
  traverse(visit: (node: NodeLike) => void): void;
}
interface MatrixLike {
  readonly elements: ArrayLike<number>;
}
export interface CameraLike {
  readonly near: number;
  readonly far: number;
  readonly isOrthographicCamera?: boolean;
  readonly matrixWorldInverse?: MatrixLike;
  readonly projectionMatrix?: MatrixLike;
  readonly layers?: LayersLike;
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
  readonly RenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) => RenderTargetLike;
  readonly DepthTexture: new (width: number, height: number) => TextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => ShaderMaterialLike;
  readonly ToonMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number, format: string) => TextureLike;
  plane(width: number, height: number): DisposableLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => MeshLike;
  readonly Stage: new () => SceneLike;
  readonly OrthoCamera: new (left: number, right: number, top: number, bottom: number, near: number, far: number) => unknown;
}
