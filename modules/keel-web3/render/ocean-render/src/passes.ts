// Full-screen passes, render targets, and the temporal resolve that rebuilds the image from jittered frames.

import { FULLSCREEN, RESOLVE } from "./shaders.glsl.js";
import type {
  CameraLike, DisposableLike, GeometryLike, LitLike, Matrix4Like, NodeLike, RendererLike, TargetLike, Uniforms,
} from "./inputs.js";

export interface Pass { readonly stage: NodeLike; readonly material: DisposableLike }

/** What a full-screen pass runs: its fragment shader over these uniforms. */
export interface PassSpec {
  readonly uniforms: Uniforms;
  readonly fragmentShader: string;
  readonly defines?: Readonly<Record<string, unknown>>;
}

export function passOf(lit: LitLike, quad: GeometryLike, spec: PassSpec): Pass {
  const material = new lit.CustomMaterial({
    defines: spec.defines ?? {},
    uniforms: spec.uniforms,
    vertexShader: FULLSCREEN,
    fragmentShader: spec.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new lit.Mesh(quad, material);
  mesh.frustumCulled = false;
  const stage = new lit.Stage();
  stage.add(mesh);
  return { stage, material };
}

export function sceneTarget(lit: LitLike): TargetLike {
  return new lit.RenderTarget(1, 1, {
    minFilter: "nearest",
    magFilter: "nearest",
    generateMipmaps: false,
    type: "half",
    depthBuffer: true,
    depthTexture: new lit.DepthTexture(1, 1),
  });
}

export function colorTarget(lit: LitLike): TargetLike {
  return new lit.RenderTarget(1, 1, {
    minFilter: "linear",
    magFilter: "linear",
    generateMipmaps: false,
    type: "half",
    depthBuffer: false,
  });
}

/** Halton points: an even spread of offsets, so eight frames sample eight spots in a pixel. */
const halton = (index: number, base: number): number => {
  let result = 0;
  let share = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += share * (i % base);
    share /= base;
  }
  return result;
};
const JITTERS = 8;

/** The frame just drawn and its depth, and the size to resolve them at. */
interface ResolveSource {
  readonly now: TargetLike;
  readonly depth: TargetLike;
  readonly width: number;
  readonly height: number;
}

export interface Resolver {
  readonly pass: Pass;
  readonly uniforms: Uniforms;
  readonly targets: readonly [TargetLike, TargetLike];
  readonly past: Matrix4Like;
  frame: number;
  /** Draws fresh pixels over the history at the source's size, and returns what now holds the image. */
  resolve(renderer: RendererLike, quadCamera: unknown, camera: CameraLike, source: ResolveSource): TargetLike;
}

export function resolverOf(lit: LitLike, quad: GeometryLike): Resolver {
  const uniforms: Uniforms = {
    uNow: { value: null },
    uPast: { value: null },
    uDepth: { value: null },
    uProjInv: { value: new lit.Matrix4() },
    uCamWorld: { value: new lit.Matrix4() },
    uPastViewProj: { value: new lit.Matrix4() },
    uTexel: { value: new lit.Vector2() },
    uFresh: { value: 0.12 },
  };
  const targets: readonly [TargetLike, TargetLike] = [colorTarget(lit), colorTarget(lit)];
  const pass = passOf(lit, quad, { uniforms, fragmentShader: RESOLVE });
  const past = new lit.Matrix4();
  let filled = false;
  const resolver: Resolver = {
    pass, uniforms, targets, past, frame: 0,
    resolve(renderer, quadCamera, camera, source) {
      const { now, depth, width, height } = source;
      const into = targets[resolver.frame % 2 === 0 ? 0 : 1];
      const from = targets[resolver.frame % 2 === 0 ? 1 : 0];
      into.setSize(width, height);
      from.setSize(width, height);
      const set = (name: string, value: unknown): void => {
        const uniform = uniforms[name];
        if (uniform) uniform.value = value;
      };
      set("uNow", now.texture);
      set("uPast", from.texture);
      set("uDepth", depth.depthTexture);
      set("uFresh", filled ? 0.12 : 1);
      (uniforms.uProjInv?.value as Matrix4Like).copy(camera.projectionMatrixInverse);
      (uniforms.uCamWorld?.value as Matrix4Like).copy(camera.matrixWorld);
      (uniforms.uPastViewProj?.value as Matrix4Like).copy(past);
      renderer.setRenderTarget(into);
      renderer.render(pass.stage, quadCamera);
      filled = true;
      resolver.frame += 1;
      return into;
    },
  };
  return resolver;
}

/** Moves the camera's projection by part of a pixel, and hands back how to undo it. */
export function jitter(camera: CameraLike, frame: number, width: number, height: number): () => void {
  const index = frame % JITTERS + 1;
  const projection = camera.projectionMatrix;
  const x = ((halton(index, 2) - 0.5) * 2) / width;
  const y = ((halton(index, 3) - 0.5) * 2) / height;
  const inverse = camera.projectionMatrixInverse;
  const [ex, ey] = [projection.elements[8] ?? 0, projection.elements[9] ?? 0];
  projection.elements[8] = ex + x;
  projection.elements[9] = ey + y;
  inverse.copy(projection).invert();
  return () => {
    projection.elements[8] = ex;
    projection.elements[9] = ey;
    inverse.copy(projection).invert();
  };
}
