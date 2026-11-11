/**
 * puppet: painted layers as relief meshes in a keel/lit stage, moved by a rig (see the README). keel/lit is passed in,
 * so this module imports nothing. The figure is data: layers, bones, shape keys and parameters. The plan is exact; the
 * frame comes from the host's clock and sampled tracks, never a wall clock.
 */

import { anchorOf, deformSheet, dissolveOf } from "./deform.js";
import type { Anchor } from "./deform.js";
import { clamp } from "./exact.js";
import { planFigure } from "./figure.js";
import type { Figure, FigurePlan, LayerPlan } from "./figure.js";
import { evaluateParams } from "./params.js";
import type { ParamInput } from "./params.js";
import { PUPPET_FRAGMENT, PUPPET_VERTEX } from "./puppet.glsl.js";

export { anchorOf, deformSheet, dissolveOf } from "./deform.js";
export type { Anchor } from "./deform.js";
export { cosine, digestOf, puppetHash, sine } from "./exact.js";
export { GAP_LIMIT, RELIEF_LIMIT, liftAt, planFigure, reachWeight, sampleGrid } from "./figure.js";
export type {
  Bind, BindPlan, Bone, Figure, FigurePlan, Grid, LayerPlan, LayerSpec, LayerState, Move, Reach, ShapeKey, Sheet, Vec2,
} from "./figure.js";
export { blinkAt, evaluateParams, wiggle } from "./params.js";
export type { BlinkSettings, Param, ParamInput, Term, Values } from "./params.js";
export { PUPPET_FRAGMENT, PUPPET_VERTEX } from "./puppet.glsl.js";

interface Uniform {
  value: unknown;
}
interface AttributeLike {
  needsUpdate: boolean;
}
interface NodeLike {
  frustumCulled: boolean;
  renderOrder: number;
  visible: boolean;
}
interface GroupLike extends NodeLike {
  add(...nodes: unknown[]): unknown;
}
interface GeometryLike {
  setAttribute(name: string, attribute: unknown): unknown;
  setIndex(index: unknown): unknown;
  dispose(): void;
}
interface MaterialLike {
  readonly uniforms: Record<string, Uniform>;
  dispose(): void;
}
interface Vector2Like {
  set(x: number, y: number): unknown;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface PuppetLit {
  readonly Group: new () => GroupLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array | Uint16Array, size: number) => AttributeLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Vector2: new (x?: number, y?: number) => Vector2Like;
}

/** Each layer's painted textures, one a state, premultiplied alpha, by layer name. */
export type PuppetMaps = Readonly<Record<string, readonly unknown[]>>;

export interface PuppetOptions {
  /** The first layer's render order; the layers take the orders after it, then their depth mattes. Default 0. */
  readonly order?: number;
  /** Write each layer's depth after the figure is drawn, so later see-through things sort against it. Default true. */
  readonly matte?: boolean;
  /** Grain cells across a layer for the state dissolve. Default 96. */
  readonly cells?: number;
}

/** One frame: the host's clock and the tracks it sampled. Under `still` everything on the clock holds at rest. */
export type PuppetFrame = ParamInput;

/** A rigged figure in the scene. */
export interface Puppet {
  /** Every layer, in the figure's frame: place, turn and scale it. Layers face +z. */
  readonly group: GroupLike;
  readonly plan: FigurePlan;
  /** The parameters' values at the last update. */
  readonly values: Readonly<Record<string, number>>;
  /** Works out the parameters and moves the layers for the next draw. */
  update(frame: PuppetFrame): void;
  /** A named point this frame (the card's grip), in the figure's frame. */
  anchor(name: string): Anchor | undefined;
  dispose(): void;
}

interface Drawn {
  readonly plan: LayerPlan;
  readonly position: Float32Array[];
  readonly clipUv: (Float32Array | undefined)[];
  readonly attributes: AttributeLike[][];
  readonly meshes: NodeLike[];
  readonly materials: MaterialLike[];
  readonly geometries: GeometryLike[];
  readonly mattes: boolean;
  last: string;
}

function definesOf(plan: LayerPlan, matte: boolean): Record<string, string> {
  const d: Record<string, string> = {};
  if (plan.spec.slide) d.SLIDE = "";
  if (plan.spec.clip !== undefined) d.CLIP = "";
  if (plan.sheets.length > 1) d.DISSOLVE = "";
  if (matte) d.MATTE = "";
  return d;
}

interface Build {
  readonly lit: PuppetLit;
  readonly maps: PuppetMaps;
  readonly options: PuppetOptions;
  readonly clips: ReadonlyMap<string, LayerPlan>;
}

function materialOf(build: Build, plan: LayerPlan, state: number, matte: boolean): MaterialLike {
  const { lit, maps, options } = build;
  const map = maps[plan.spec.name]?.[state];
  if (map === undefined) throw new RangeError(`No texture for layer ${plan.spec.name}, state ${state}.`);
  const clip = plan.spec.clip === undefined ? undefined : maps[plan.spec.clip]?.[0];
  return new lit.CustomMaterial({
    uniforms: {
      uMap: { value: map }, uClip: { value: clip ?? null }, uOpacity: { value: 1 },
      uSlide: { value: new lit.Vector2() }, uDissolve: { value: 0 }, uSide: { value: state },
      uCells: { value: options.cells ?? 96 },
    },
    vertexShader: PUPPET_VERTEX,
    fragmentShader: PUPPET_FRAGMENT,
    defines: definesOf(plan, matte),
    transparent: true,
    depthWrite: matte,
    colorWrite: !matte,
    premultipliedAlpha: true,
    toneMapped: false,
  });
}

function drawLayer(build: Build, plan: LayerPlan): Drawn {
  const { lit } = build;
  const clip = plan.spec.clip === undefined ? undefined : build.clips.get(plan.spec.clip);
  const drawn: Drawn = {
    plan, position: [], clipUv: [], attributes: [], meshes: [], materials: [], geometries: [],
    mattes: build.options.matte !== false, last: "",
  };
  plan.sheets.forEach((sheet, state) => {
    const position = sheet.rest.slice();
    const clipUv = clip ? new Float32Array(sheet.uv.length) : undefined;
    if (clipUv && clip) deformSheet(plan, state, {}, { position: new Float32Array(position.length), clipUv, clip });
    const geometry = new lit.Geometry();
    const attributes = [new lit.Attribute(position, 3), ...(clipUv ? [new lit.Attribute(clipUv, 2)] : [])];
    geometry.setAttribute("position", attributes[0]);
    geometry.setAttribute("uv", new lit.Attribute(sheet.uv, 2));
    if (attributes[1]) geometry.setAttribute("aClip", attributes[1]);
    geometry.setIndex(new lit.Attribute(sheet.index, 1));
    const materials = [false, true].map((matte) => materialOf(build, plan, state, matte));
    drawn.position.push(position);
    drawn.clipUv.push(clipUv);
    drawn.attributes.push(attributes);
    drawn.geometries.push(geometry);
    drawn.materials.push(...materials);
    drawn.meshes.push(...materials.map((m) => new lit.Mesh(geometry, m)));
  });
  return drawn;
}

/** The values a layer's deformation reads, as one string, so an unchanged frame is skipped. */
function stamp(plan: LayerPlan, values: Readonly<Record<string, number>>): string {
  const names = [...(plan.spec.keys ?? []).map((k) => k.param), ...plan.binds.map((b) => b.bone.param)];
  return names.map((n) => values[n] ?? 0).join(",");
}

/** A slide's two values, each held within its most. */
function slideOf(plan: LayerPlan, values: Readonly<Record<string, number>>): [number, number] {
  const slide = plan.spec.slide;
  if (slide === undefined) return [0, 0];
  const [mx, my] = slide.max;
  return [clamp(values[slide.param[0]] ?? 0, -mx, mx), clamp(values[slide.param[1]] ?? 0, -my, my)];
}

/** Opacity, slide and dissolve into the layer's materials, and which state's meshes are drawn. */
function setUniforms(drawn: Drawn, values: Readonly<Record<string, number>>): void {
  const { plan } = drawn;
  const opacity = plan.spec.opacity === undefined ? 1 : clamp(values[plan.spec.opacity] ?? 0, 0, 1);
  const dissolve = dissolveOf(plan, values);
  const [sx, sy] = slideOf(plan, values);
  for (const m of drawn.materials) {
    const u = m.uniforms;
    if (u.uOpacity) u.uOpacity.value = opacity;
    if (u.uDissolve) u.uDissolve.value = dissolve;
    (u.uSlide?.value as Vector2Like | undefined)?.set(sx, sy);
  }
  drawn.meshes.forEach((mesh, i) => {
    const shown = plan.sheets.length < 2 || (i < 2 ? dissolve < 1 : dissolve > 0);
    mesh.visible = shown && (i % 2 === 0 || drawn.mattes);
  });
}

type Clips = ReadonlyMap<string, LayerPlan>;

function updateLayer(drawn: Drawn, values: Readonly<Record<string, number>>, clips: Clips): void {
  const { plan } = drawn;
  const { spec } = plan;
  setUniforms(drawn, values);
  const now = stamp(plan, values);
  if (now === drawn.last || (plan.keys.length === 0 && plan.binds.length === 0)) return;
  drawn.last = now;
  const clip = spec.clip === undefined ? undefined : clips.get(spec.clip);
  plan.sheets.forEach((_, state) => {
    const position = drawn.position[state];
    const clipUv = drawn.clipUv[state];
    if (position === undefined) return;
    deformSheet(plan, state, values, { position, ...(clipUv && clip ? { clipUv, clip } : {}) });
    for (const a of drawn.attributes[state] ?? []) a.needsUpdate = true;
  });
}

/**
 * Builds a figure's layers into one group: a relief mesh a state, unlit, premultiplied, depth-tested against the rest
 * of the stage and drawn back to front, then (with `matte`) a depth matte each, so the 3D card sorts against the hand
 * and motes behind the figure stay behind it.
 *
 * @param lit The keel/lit namespace.
 * @param figure The figure: parameters, bones and layers back to front.
 * @param maps Each layer's painted textures, one a state.
 * @param options Render order, mattes and the dissolve's grain.
 * @returns The puppet: add `group` to the stage and call `update` each frame.
 * @throws RangeError when the figure breaks a limit or a layer has no texture.
 */
export function createPuppet(lit: PuppetLit, figure: Figure, maps: PuppetMaps, options: PuppetOptions = {}): Puppet {
  const plan = planFigure(figure);
  const clips = new Map(plan.layers.map((l) => [l.spec.name, l] as const));
  const build: Build = { lit, maps, options, clips };
  const group = new lit.Group();
  const order = options.order ?? 0;
  const drawn = plan.layers.map((layer) => drawLayer(build, layer));
  drawn.forEach((d, i) => {
    d.meshes.forEach((mesh, k) => {
      const matte = k % 2 === 1;
      mesh.renderOrder = matte ? order + plan.layers.length * 2 + i : order + i * 2 + Math.floor(k / 2);
      mesh.frustumCulled = false;
      group.add(mesh);
    });
  });
  let values: Record<string, number> = {};
  const puppet: Puppet = {
    group, plan,
    get values() {
      return values;
    },
    update(frame) {
      values = evaluateParams(figure.params, frame);
      for (const d of drawn) updateLayer(d, values, clips);
    },
    anchor(name) {
      for (const layer of plan.layers) {
        const found = anchorOf(layer, name, values);
        if (found) return found;
      }
      return undefined;
    },
    dispose() {
      for (const x of drawn.flatMap((d) => [...d.geometries, ...d.materials])) x.dispose();
    },
  };
  puppet.update({ time: 0, still: true });
  return puppet;
}
