// createOcean: the passes in order each frame, scene, water over it, surface over that, resolved and presented.

import { GROUND_CELLS, bakeGround, seabedOf } from "./ground.js";
import { colorTarget, jitter, passOf, resolverOf, sceneTarget } from "./passes.js";
import { COPY, MEDIUM, PRESENT } from "./shaders.glsl.js";
import { sprayOf, surfaceOf } from "./surface.js";
import { MAX_CASTERS, lightUniforms, waveUniform, wetLineOf, writeLight, writeSettings } from "./uniforms.js";
import type {
  CameraLike, DisposableLike, GeometryLike, LitLike, Matrix4Like, NodeLike, Ocean, OceanOptions, OceanPlace,
  OceanSettings, RendererLike, SeaLike, TargetLike, Uniforms, Vector2Like, Vector3Like,
} from "./inputs.js";
import type { Pass, Resolver } from "./passes.js";

const STEADY: OceanSettings = {
  renderScale: 0.8,
  upscale: true,
  reflectSteps: 28,
  shadowSteps: 20,
  traceFar: 140,
  traceNear: 140,
  casters: 16,
  shafts: 16,
  snow: 6,
  spray: 0.8,
};

/** Whatever passes share. */
interface Rig {
  readonly scene: TargetLike;
  readonly water: TargetLike;
  readonly final: TargetLike;
  readonly mediumUniforms: Uniforms;
  readonly medium: Pass;
  readonly copy: Pass;
  readonly surface: NodeLike;
  readonly surfaceUniforms: Uniforms;
  readonly spray: NodeLike;
  readonly quadCamera: unknown;
}

/** The camera a frame is drawn through, and the render size. */
interface View {
  readonly camera: CameraLike;
  readonly width: number;
  readonly height: number;
}

/** The world's passes, at one render size: scene, water over it, surface over that. */
function drawWorld(rig: Rig, renderer: RendererLike, stage: unknown, view: View): void {
  const { camera, width, height } = view;
  const eye = camera.position;
  for (const target of [rig.scene, rig.water, rig.final]) target.setSize(width, height);
  (rig.surfaceUniforms.uRes?.value as Vector2Like).set(width, height);
  renderer.autoClear = true;
  renderer.setRenderTarget(rig.scene);
  renderer.render(stage, camera);
  (rig.mediumUniforms.uProjInv?.value as Matrix4Like).copy(camera.projectionMatrixInverse);
  (rig.mediumUniforms.uCamWorld?.value as Matrix4Like).copy(camera.matrixWorld);
  (rig.mediumUniforms.uEye?.value as Vector3Like).set(eye.x, eye.y, eye.z);
  renderer.setRenderTarget(rig.water);
  renderer.render(rig.medium.stage, rig.quadCamera);
  renderer.setRenderTarget(rig.final);
  renderer.render(rig.copy.stage, rig.quadCamera);
  renderer.autoClear = false;
  renderer.clear(false, true, false);
  rig.spray.visible = (rig.surfaceUniforms.uSprayShare?.value as number) > 0;
  renderer.render(rig.surface, camera);
}

function placeOf(sea: SeaLike, eye: CameraLike["position"], level: number, t: number): OceanPlace {
  const top = sea.surfaceAt(eye.x, eye.z, t, level).height;
  return {
    under: eye.y < top,
    depth: Math.max(0, top - eye.y),
    height: Math.max(0, eye.y - top),
    clearance: eye.y - sea.seabedAt(eye.x, eye.z),
  };
}

/** The passes and what they own, built once from the shared uniforms. */
interface Passes {
  readonly rig: Rig;
  readonly present: Pass;
  readonly presentUniforms: Uniforms;
  readonly resolver: Resolver;
  /** Everything to dispose of with the ocean. */
  readonly owned: readonly DisposableLike[];
}

function passesOf(lit: LitLike, shared: Uniforms, sea: SeaLike, exposure: number): Passes {
  const defines = { WAVES: sea.packed.length / 8, GROUND_CELLS: `${GROUND_CELLS}.0`, MAX_CASTERS };
  const quad: GeometryLike = lit.plane(2, 2);
  const quadCamera = new lit.OrthoCamera(-1, 1, 1, -1, 0, 1);
  const [scene, water, final] = [sceneTarget(lit), colorTarget(lit), sceneTarget(lit)];
  const mediumUniforms: Uniforms = {
    ...shared,
    uColor: { value: scene.texture },
    uDepth: { value: scene.depthTexture },
    uProjInv: { value: new lit.Matrix4() },
    uCamWorld: { value: new lit.Matrix4() },
    uEye: { value: new lit.Vector3() },
  };
  const medium = passOf(lit, quad, { uniforms: mediumUniforms, fragmentShader: MEDIUM, defines });
  const copy = passOf(lit, quad, { uniforms: { uColor: { value: water.texture } }, fragmentShader: COPY });
  const presentUniforms: Uniforms = { uColor: { value: final.texture }, uExposure: { value: exposure } };
  const present = passOf(lit, quad, { uniforms: presentUniforms, fragmentShader: PRESENT });
  const surfaceUniforms: Uniforms = {
    ...shared,
    uWave: { value: waveUniform(lit, sea.packed) },
    uDepth: { value: scene.depthTexture },
    uBelow: { value: water.texture },
    uRes: { value: new lit.Vector2(1, 1) },
  };
  const surface = surfaceOf(lit, surfaceUniforms, defines);
  const spray = sprayOf(lit, surface.stage, surfaceUniforms, defines);
  const resolver = resolverOf(lit, quad);
  const rig: Rig = {
    scene,
    water,
    final,
    mediumUniforms,
    medium,
    copy,
    surface: surface.stage,
    surfaceUniforms,
    spray: spray.mesh,
    quadCamera,
  };
  const owned = [
    scene, water, final, ...resolver.targets, quad, medium.material, copy.material, present.material,
    resolver.pass.material, surface.material, surface.disc, spray.quad, spray.material,
  ];
  return { rig, present, presentUniforms, resolver, owned };
}

/**
 * Makes an ocean to draw.
 *
 * @param lit The keel/lit namespace.
 * @param options The sea, the water's colour, the tide, and the quality.
 * @returns The seabed for the scene, and a `draw` to use in place of `renderer.render`.
 */
export function createOcean(lit: LitLike, options: OceanOptions): Ocean {
  const { sea } = options;
  const baseLevel = options.level ?? 0;
  const seabedSize = options.size ?? 320;
  const baked = bakeGround(lit, sea, seabedSize, options.colorAt);
  const shared: Uniforms = {
    ...lightUniforms(lit, options.absorption ?? [0.38, 0.085, 0.05], options.scatter ?? [0.012, 0.13, 0.2]),
    uWind: { value: sea.wind },
    uGround: { value: baked.height },
    uGroundColor: { value: baked.color },
    uGroundSize: { value: seabedSize },
    uGroundTop: { value: baked.top },
  };
  const { rig, present, presentUniforms, resolver, owned } = passesOf(lit, shared, sea, options.exposure ?? 1.5);
  const { final, quadCamera } = rig;
  const size = new lit.Vector2();
  const group = new lit.Group();
  const bed = seabedOf(lit, sea, { size: seabedSize, cells: Math.round(seabedSize / 1.8), colorAt: options.colorAt });
  group.add(bed.mesh);
  const wetLine = wetLineOf(shared, sea.wind, options.dryTime ?? 3600);
  return {
    group,
    isUnder: (x, y, z, t) => y < sea.surfaceAt(x, z, t, baseLevel).height,
    draw(renderer, stage, camera, frame) {
      const { t } = frame;
      const level = frame.level ?? baseLevel;
      if (frame.frameMs !== undefined) options.quality?.frame(frame.frameMs);
      const place = placeOf(sea, camera.position, level, t);
      const settings = options.quality?.at(place) ?? STEADY;
      writeLight(shared, frame, { level, under: place.under, t });
      wetLine(level, t);
      writeSettings(shared, settings, frame.casters ?? []);
      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.floor(size.x * settings.renderScale));
      const height = Math.max(1, Math.floor(size.y * settings.renderScale));
      const [previous, clears] = [renderer.getRenderTarget(), renderer.autoClear];
      const undo = settings.upscale ? jitter(camera, resolver.frame, width, height) : null;
      drawWorld(rig, renderer, stage, { camera, width, height });
      undo?.();
      renderer.autoClear = true;
      let shown = final;
      if (settings.upscale) {
        (resolver.uniforms.uTexel?.value as Vector2Like).set(1 / width, 1 / height);
        shown = resolver.resolve(renderer, quadCamera, camera, {
          now: final,
          depth: final,
          width: size.x,
          height: size.y,
        });
        resolver.past.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      }
      if (presentUniforms.uColor) presentUniforms.uColor.value = shown.texture;
      renderer.autoClear = clears;
      renderer.setRenderTarget(previous);
      renderer.render(present.stage, quadCamera);
    },
    dispose() {
      for (const item of [baked.height, baked.color, ...owned, bed.geometry, bed.far, bed.material]) item.dispose();
    },
  };
}
