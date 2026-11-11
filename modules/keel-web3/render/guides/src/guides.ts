// The guide renderer bound to a keel/lit renderer. Each render: find the parts the tagger names and hide everything
// else; draw the key's shadow map; draw the parts once into the form and data targets; pack each pass into eight bits
// a channel and read it back; then put the stage and the renderer back as they were.

import { depthRange, enclose, multiply, normalize, shadowFrame, transform, worldSphere } from "./frame.js";
import type { Sphere, Vec3 } from "./frame.js";
import {
  PACK_FRAGMENT_GLSL, PACK_VERTEX_GLSL, PART_FRAGMENT_GLSL, PART_VERTEX_GLSL, SHADOW_FRAGMENT_GLSL,
} from "./guides.glsl.js";
import type {
  CameraLike, ColorLike, GuidesLit, MaterialLike, NodeLike, OrthoCameraLike, RendererLike, RenderTargetLike,
  StageLike, TextureLike, Uniform,
} from "./lit.js";
import { PASSES, byName, idTable } from "./table.js";
import type { GuideId, GuideImage, GuidePass, Rgb, Tagger } from "./table.js";

export interface GuideOptions {
  /** Which passes to read back; all six by default. */
  readonly passes?: readonly GuidePass[];
  /** Names each mesh's parts; `byName` by default. */
  readonly tag?: Tagger;
  /** Toward the key light, in the world. By default the stage's brightest sun, else from the camera. */
  readonly key?: Vec3;
  /** The key's shadow map size in pixels; 0 lights the parts with no cast shadow. 2048 by default. */
  readonly shadow?: number;
  /** The `block` pass's colours by name or pattern, `#rrggbb`; otherwise each part's own material colour. */
  readonly blocks?: Readonly<Record<string, string>>;
  /** Line width in pixels (1), the angle in degrees that makes a crease (40), and a step in depth (2 %). */
  readonly line?: { readonly width?: number; readonly crease?: number; readonly step?: number };
}

/** One render's guides: each pass read back, the ID table, and what the depth and light passes are measured by. */
export interface GuideSet {
  readonly width: number;
  readonly height: number;
  readonly passes: Readonly<Partial<Record<GuidePass, GuideImage>>>;
  readonly table: readonly GuideId[];
  /** The view distances the `depth` pass runs between: 65535 at `near`, 0 at `far`. */
  readonly range: { readonly near: number; readonly far: number };
  /** Toward the key light, in the world, as the `light` pass took it. */
  readonly key: Vec3;
}

export interface Guides {
  /** Renders the stage's tagged parts through the camera at this size (the camera's aspect should match it). */
  render(stage: StageLike, camera: CameraLike, size: { readonly width: number; readonly height: number }): GuideSet;
  dispose(): void;
}

interface Part {
  readonly mesh: NodeLike;
  readonly names: readonly (string | undefined)[];
  readonly materials: readonly MaterialLike[];
  /** The mesh's own material or materials, put back after. */
  readonly original: MaterialLike | MaterialLike[];
}

const linearByte = (c: number): number => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};

/** A material's base colour as sRGB bytes: a built-in's `color`, or a custom one's `uColor` uniform. */
function colourOf(material: MaterialLike): Rgb | undefined {
  const value = material.color ?? material.uniforms?.uColor?.value;
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as { r?: number; g?: number; b?: number; x?: number; y?: number; z?: number };
  const r = v.r ?? v.x;
  const g = v.g ?? v.y;
  const b = v.b ?? v.z;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return [linearByte(r), linearByte(g), linearByte(b)];
}

/** Each name's colour from the first material drawn under it. */
function materialColours(parts: readonly Part[]): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const part of parts)
    part.names.forEach((name, slot) => {
      const material = part.materials[slot];
      const colour = material && colourOf(material);
      if (name !== undefined && colour) out[name] ??= colour;
    });
  return out;
}

/** The parts the tagger names, and every other drawable thing, which is hidden while the guides draw. */
function partsOf(stage: StageLike, tag: Tagger): { readonly parts: Part[]; readonly hidden: NodeLike[] } {
  const parts: Part[] = [];
  const hidden: NodeLike[] = [];
  stage.traverseVisible((node) => {
    if (node.material === undefined) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const names = node.isMesh ? materials.map((m, slot) => tag(node, m, slot)) : [];
    if (names.some((n) => n !== undefined)) parts.push({ mesh: node, names, materials, original: node.material });
    else hidden.push(node);
  });
  return { parts, hidden };
}

function sphereOf(mesh: NodeLike): Sphere | undefined {
  const geometry = mesh.geometry;
  if (!geometry) return undefined;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const s = geometry.boundingSphere;
  return s ? worldSphere(mesh.matrixWorld.elements, { centre: [s.center.x, s.center.y, s.center.z], radius: s.radius })
    : undefined;
}

const at = (m: ArrayLike<number>): Vec3 => [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0];

/** Toward the stage's brightest sun, from its target. */
function sunKey(stage: StageLike): Vec3 | undefined {
  let best: Vec3 | undefined;
  let strongest = -Infinity;
  stage.traverseVisible((node) => {
    if (!node.isSunLight || !node.target || (node.intensity ?? 0) <= strongest) return;
    node.target.updateMatrixWorld(true);
    const from = at(node.matrixWorld.elements);
    const to = at(node.target.matrixWorld.elements);
    best = [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
    strongest = node.intensity ?? 0;
  });
  return best;
}

interface Bound {
  readonly lit: GuidesLit;
  readonly renderer: RendererLike;
  readonly options: GuideOptions;
  readonly shared: Record<string, Uniform>;
  readonly pack: { readonly stage: StageLike; readonly material: MaterialLike };
  readonly lens: OrthoCameraLike;
  readonly form: RenderTargetLike;
  readonly packed: RenderTargetLike;
  readonly table: TextureLike;
  readonly tableBytes: Uint8Array;
  readonly shadowMaterial: MaterialLike;
  readonly materials: WeakMap<NodeLike, MaterialLike[]>;
  readonly owned: MaterialLike[];
  shadowTarget?: RenderTargetLike;
}

const nearest = { minFilter: "nearest", magFilter: "nearest", generateMipmaps: false };

function bind(lit: GuidesLit, renderer: RendererLike, options: GuideOptions): Bound {
  const shared: Record<string, Uniform> = {
    uKey: { value: [0, 0, 1] }, uRange: { value: [0, 1] }, tShadow: { value: null },
    uShadowMatrix: { value: new Array<number>(16).fill(0) }, uShadow: { value: [0, 0, 0, 0] },
  };
  const tableBytes = new Uint8Array(256 * 2 * 4);
  const table = new lit.DataTexture(tableBytes, 256, 2, "rgba", "u8");
  Object.assign(table, nearest);
  const form = new lit.RenderTarget(1, 1, { ...nearest, count: 2, type: "half", depthBuffer: true });
  const packed = new lit.RenderTarget(1, 1, { ...nearest, type: "u8", depthBuffer: false });
  const material = new lit.CustomMaterial({
    uniforms: {
      tForm: { value: form.textures[0] }, tData: { value: form.textures[1] }, tTable: { value: table },
      uPass: { value: 0 }, uRange: shared.uRange, uLine: { value: [1, 0.77, 0.02] },
    },
    vertexShader: PACK_VERTEX_GLSL, fragmentShader: PACK_FRAGMENT_GLSL, depthTest: false, depthWrite: false,
  });
  const quad = new lit.Mesh(lit.plane(2, 2), material);
  quad.frustumCulled = false;
  const stage = new lit.Stage();
  stage.add(quad);
  const shadowMaterial = new lit.CustomMaterial({
    vertexShader: PART_VERTEX_GLSL, fragmentShader: SHADOW_FRAGMENT_GLSL, side: "both",
  });
  return {
    lit, renderer, options, shared, pack: { stage, material }, lens: new lit.OrthoCamera(-1, 1, 1, -1, 0.01, 10),
    form, packed, table, tableBytes, shadowMaterial, materials: new WeakMap(), owned: [material, shadowMaterial],
  };
}

/** Each slot's guide material for this mesh, made once and kept; its ID set for this render. */
function guideMaterials(b: Bound, part: Part, ids: ReadonlyMap<string, number>): MaterialLike[] {
  let made = b.materials.get(part.mesh);
  if (made?.length !== part.materials.length) {
    made = part.materials.map((m) => new b.lit.CustomMaterial({
      uniforms: { ...b.shared, uId: { value: 0 } }, vertexShader: PART_VERTEX_GLSL,
      fragmentShader: PART_FRAGMENT_GLSL, glslVersion: "300 es", side: m.side ?? "front",
    }));
    b.materials.set(part.mesh, made);
    b.owned.push(...made);
  }
  made.forEach((m, slot) => {
    const name = part.names[slot];
    const id = m.uniforms?.uId;
    if (id) id.value = name === undefined ? 0 : ids.get(name) ?? 0;
  });
  return made;
}

/** Swaps the guide materials in and hides the rest; returns how to put everything back. */
function swapIn(b: Bound, stage: StageLike, found: ReturnType<typeof partsOf>, table: readonly GuideId[]): () => void {
  const ids = new Map(table.map((e) => [e.name, e.id]));
  const saved = { background: stage.background, fog: stage.fog, overrideMaterial: stage.overrideMaterial };
  Object.assign(stage, { background: null, fog: null, overrideMaterial: null });
  found.parts.forEach((p) => {
    const made = guideMaterials(b, p, ids);
    p.mesh.material = Array.isArray(p.original) ? made : made[0] ?? p.original;
  });
  for (const node of found.hidden) node.visible = false;
  return () => {
    for (const p of found.parts) p.mesh.material = p.original;
    for (const node of found.hidden) node.visible = true;
    Object.assign(stage, saved);
  };
}

/** The table's colours into its texture: row 0 the ID colours, row 1 the block colours. */
function writeTable(b: Bound, table: readonly GuideId[]): void {
  b.tableBytes.fill(0);
  for (const e of table) {
    b.tableBytes.set([...e.colour, 255], e.id * 4);
    b.tableBytes.set([...e.block, 255], (256 + e.id) * 4);
  }
  b.table.needsUpdate = true;
}

/** The key's shadow map, round the parts' ball; hands the part shader its matrix from view space. */
function drawShadow(b: Bound, stage: StageLike, frame: { ball: Sphere; key: Vec3; camera: CameraLike }): void {
  const size = b.options.shadow ?? 2048;
  setValue(b.shared, "uShadow", [0, 0, 0, 0]);
  if (size <= 0) return;
  b.shadowTarget ??= new b.lit.RenderTarget(size, size, { ...nearest, type: "float", format: "red" });
  const { eye, half, far } = shadowFrame(frame.ball, frame.key);
  const lens = b.lens;
  Object.assign(lens, { left: -half, right: half, top: half, bottom: -half, near: half * 0.25, far });
  lens.updateProjectionMatrix();
  lens.position.set(eye[0], eye[1], eye[2]);
  lens.lookAt(frame.ball.centre[0], frame.ball.centre[1], frame.ball.centre[2]);
  lens.updateMatrixWorld(true);
  const toKey = multiply(lens.projectionMatrix.elements, lens.matrixWorldInverse.elements);
  setValue(b.shared, "uShadowMatrix", multiply(toKey, frame.camera.matrixWorld.elements));
  setValue(b.shared, "tShadow", b.shadowTarget.textures[0]);
  setValue(b.shared, "uShadow", [1 / size, 1.5, 0.0015, 1]);
  stage.overrideMaterial = b.shadowMaterial;
  b.renderer.setRenderTarget(b.shadowTarget);
  b.renderer.setClearColor(0xffffff, 1);
  b.renderer.clear(true, true, false);
  b.renderer.render(stage, lens);
  stage.overrideMaterial = null;
}

function setValue(uniforms: Readonly<Record<string, Uniform>>, name: string, value: unknown): void {
  const u = uniforms[name];
  if (u) u.value = value;
}

/** Each pass packed into eight bits a channel and read back. */
function readPasses(b: Bound, width: number, height: number): Partial<Record<GuidePass, GuideImage>> {
  const { renderer, packed, pack } = b;
  const line = b.options.line ?? {};
  const u = pack.material.uniforms ?? {};
  setValue(u, "uLine", [line.width ?? 1, Math.cos(((line.crease ?? 40) * Math.PI) / 180), line.step ?? 0.02]);
  if (packed.width !== width || packed.height !== height) packed.setSize(width, height);
  const out: Partial<Record<GuidePass, GuideImage>> = {};
  for (const pass of b.options.passes ?? PASSES) {
    setValue(u, "uPass", PASSES.indexOf(pass));
    renderer.setRenderTarget(packed);
    renderer.render(pack.stage, b.lens);
    const data = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(packed, 0, 0, width, height, data);
    out[pass] = { width, height, data };
  }
  return out;
}

/** What this render draws: the parts, their table, where they lie and where the key comes from. */
function survey(stage: StageLike, camera: CameraLike, options: GuideOptions): {
  readonly found: ReturnType<typeof partsOf>;
  readonly table: readonly GuideId[];
  readonly spheres: readonly Sphere[];
  readonly range: GuideSet["range"];
  readonly key: Vec3;
} {
  stage.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const found = partsOf(stage, options.tag ?? byName);
  const names = found.parts.flatMap((p) => p.names.filter((n): n is string => n !== undefined));
  const table = idTable(names, options.blocks, materialColours(found.parts));
  const spheres = found.parts.map((p) => sphereOf(p.mesh)).filter((s): s is Sphere => s !== undefined);
  const range = depthRange(spheres, camera.matrixWorldInverse.elements, camera.near);
  const key = normalize(options.key ?? sunKey(stage) ?? transform(camera.matrixWorld.elements, [0, 0, 1], 0));
  return { found, table, spheres, range, key };
}

/** Binds the guides to a renderer. keel/lit is passed in; the module imports nothing. */
export function createGuides(lit: GuidesLit, renderer: RendererLike, options: GuideOptions = {}): Guides {
  const b = bind(lit, renderer, options);
  return {
    render(stage, camera, { width, height }) {
      const { found, table, spheres, range, key } = survey(stage, camera, options);
      const view = camera.matrixWorldInverse.elements;
      const previous = renderer.getRenderTarget();
      const clear: ColorLike = renderer.getClearColor(new lit.Color());
      const alpha = renderer.getClearAlpha();
      const restore = swapIn(b, stage, found, table);
      try {
        writeTable(b, table);
        setValue(b.shared, "uKey", [...normalize(transform(view, key, 0))]);
        setValue(b.shared, "uRange", [range.near, range.far]);
        drawShadow(b, stage, { ball: enclose(spheres), key, camera });
        if (b.form.width !== width || b.form.height !== height) b.form.setSize(width, height);
        renderer.setRenderTarget(b.form);
        renderer.setClearColor(0, 0);
        renderer.clear(true, true, false);
        renderer.render(stage, camera);
        return { width, height, passes: readPasses(b, width, height), table, range, key };
      } finally {
        restore();
        renderer.setRenderTarget(previous);
        renderer.setClearColor(clear, alpha);
      }
    },
    dispose() {
      for (const m of b.owned) m.dispose();
      b.form.dispose();
      b.packed.dispose();
      b.table.dispose();
      b.shadowTarget?.dispose();
    },
  };
}
