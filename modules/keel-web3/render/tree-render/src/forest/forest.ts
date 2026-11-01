// The forest: places seeded in a ring, trees baked into a sprite ladder and the whole stand updated by distance.

import type {
  ColorLike, GeometryLike, InstancedLike, LitLike, MaterialLike, NodeLike, TreeColors, TreeFrameLike, TreeModelLike,
  Vector3Like, YearLike,
} from "../inputs.js";
import { TAU, at, clamp, seededRandom } from "../math.js";
import { norm3, writeBlade, writeBox, writeSegment } from "../instances.js";
import type { V3 } from "../instances.js";
import { NEEDLE_KINDS, lightSprig, speciesBlade } from "../tree/shapes.js";
import { leafyNode } from "../tree/tree.js";
import { crownShade, sprigPlace } from "../tree/leaves.js";
import { MAX_VARIANTS, bakeCards, createCards } from "./cards.js";
import type { Cards } from "./cards.js";

// ---------------------------------------------------------------- the forest

/** One kind of background tree: a grown model posed once, in its species' colours. */
export interface ForestVariant {
  readonly model: TreeModelLike;
  readonly frame: TreeFrameLike;
  readonly colors: TreeColors;
}

/** Where one background tree stands, which variant it is, and a brightness tint (1 as is). */
export interface ForestPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly variant: number;
  readonly tint: number;
}

export interface ForestPlacesInput {
  readonly seed: number;
  readonly count: number;
  readonly inner: number;
  readonly outer: number;
  readonly variants: number;
  /** Ground height at (x, z), or null where no tree may stand (water, a road). */
  readonly height: (x: number, z: number) => number | null;
  /** Least room between two trees. */
  readonly gap?: number;
  readonly scale?: readonly [number, number];
  /** 0 spreads trees evenly; 1 gathers them into groves with clearings between. */
  readonly clump?: number;
}

/**
 * Scatters trees over a ring by dart throwing: no two closer than `gap`,
 * thinned into groves and clearings by a low-frequency field, each with its
 * own variant, turn, size and shade.
 */
export function forestPlaces(input: ForestPlacesInput): ForestPlace[] {
  const random = seededRandom(input.seed ^ 0xf0e57);
  const gap = input.gap ?? 2.2;
  const [low, high] = input.scale ?? [0.9, 1.5];
  const clump = input.clump ?? 0.6;
  const phase = random() * TAU;
  const places: ForestPlace[] = [];
  for (let attempt = 0; attempt < input.count * 30 && places.length < input.count; attempt += 1) {
    const angle = random() * TAU;
    const radius = Math.sqrt(input.inner ** 2 + random() * (input.outer ** 2 - input.inner ** 2));
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const grove = 0.5 + 0.5 * Math.sin(angle * 3 + phase) * Math.cos(radius * 0.21 + phase * 0.7);
    if (random() < clump * (1 - grove)) continue;
    const y = input.height(x, z);
    if (y === null || places.some((p) => Math.hypot(p.x - x, p.z - z) < gap)) continue;
    places.push({ x, y, z, yaw: random() * TAU, scale: low + random() * (high - low), variant: Math.floor(random() * input.variants), tint: 0.82 + random() * 0.3 });
  }
  return places;
}

export interface ForestOptions {
  readonly variants: readonly ForestVariant[];
  readonly places: readonly ForestPlace[];
  /** Beyond this distance from the camera a tree is an impostor card. */
  readonly near?: number;
  /** Dither band where geometry and card cross-fade. */
  readonly band?: number;
  /** Most leaves baked into one variant; the rest are skipped and the kept ones drawn larger. */
  readonly maxLeaves?: number;
  /** Twigs thinner than this are left out of the baked wood. */
  readonly minRadius?: number;
  /** Views round each variant on its impostor card (the sprite ladder). */
  readonly frames?: number;
  /** Pixel size of one impostor view. */
  readonly cell?: number;
  /** Near-lens dissolve: gone at [0], solid from [1] (view depth, world units). */
  readonly fade?: readonly [number, number];
  /** Updates a level may sit unused before it is freed. */
  readonly keep?: number;
}

/** The light and air the forest sits in, from the host's scene. */
export interface ForestUpdate {
  readonly camera: { readonly position: { readonly x: number; readonly y: number; readonly z: number } };
  /** Needed to bake impostors; without it every tree stays geometry. */
  readonly renderer?: RendererLike | null;
  readonly year: YearLike | ((variant: number) => YearLike);
  readonly elapsed: number;
  readonly wind: number;
  /** Brightness of the baked cards (the scene's light colour, roughly ambient + sun). */
  readonly light?: readonly [number, number, number];
  readonly fog?: { readonly color: readonly [number, number, number]; readonly near: number; readonly far: number } | null;
}

export interface Forest {
  readonly group: unknown;
  /** Trees drawn at each level from the current view, the levels held, and the triangles drawn. */
  readonly levels: { readonly close: number; readonly full: number; readonly layered: number; readonly cards: number; readonly built: number; readonly triangles: number };
  update(input: ForestUpdate): void;
  /** Moves, adds or removes trees without rebuilding anything already built. */
  setPlaces(places: readonly ForestPlace[]): void;
  dispose(): void;
}

/** The renderer calls the impostor bake makes. Pass the WebGLRenderer itself. */
export interface RendererLike {
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  getClearColor(target: ColorLike): ColorLike;
  getClearAlpha(): number;
  setClearColor(color: ColorLike, alpha: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: unknown, camera: unknown): void;
  autoClear: boolean;
}

/** keel/lit parts the forest needs beyond the tree's. */
export interface ForestLitLike extends LitLike {
  readonly Stage: new () => NodeLike;
  readonly OrthoCamera: new (left: number, right: number, top: number, bottom: number, near: number, far: number) => NodeLike & { lookAt(x: number, y: number, z: number): void; updateProjectionMatrix(): void };
  readonly RenderTarget: new (width: number, height: number, options?: Readonly<Record<string, unknown>>) => { readonly texture: unknown; viewport: { set(x: number, y: number, w: number, h: number): void }; scissor: { set(x: number, y: number, w: number, h: number): void }; scissorTest: boolean; dispose(): void };
  readonly SkyLight: new (sky: string, ground: string, intensity: number) => NodeLike;
  readonly SunLight: new (color: string, intensity: number) => NodeLike;
  readonly Matrix4: new () => { readonly elements: number[]; makeRotationY(angle: number): unknown; compose(position: unknown, quaternion: unknown, scale: unknown): unknown };
  readonly Quaternion: new () => { setFromAxisAngle(axis: Vector3Like, angle: number): unknown };
}

// The season runs on the GPU: each baked leaf carries its rank and tone, and
// the year (leaf size, autumn turn, flush, drop) arrives as uniforms, so a
// whole forest turns and drops its leaves without touching a vertex.
const FOREST_VERTEX_HEAD = /* glsl */ `
attribute vec2 aLeaf;
attribute vec3 aStalk;
attribute float aWind;
uniform float uTime, uWind;
uniform vec4 uYear;
uniform vec4 uYear2;
uniform vec3 uLeafCol[3];
uniform vec3 uSpring[3];
uniform vec3 uAutumn[3];
uniform vec3 uBloom;
varying vec3 vSeason;
varying float vViewDepth;
varying float vLodDistance;
vec3 pick3(vec3 a[3], float i) { return i < 0.5 ? a[0] : i < 1.5 ? a[1] : a[2]; }
`;
const FOREST_VERTEX_BEGIN = /* glsl */ `#include <begin_vertex>
  vSeason = vec3(1.0);
  if (aLeaf.x >= 0.0) {
    float keep = aLeaf.x >= uYear.w ? 1.0 : 0.0;
    // A blossom tree in bloom shows its crown before the leaves are out.
    float grow = max(uYear.x <= 0.0 ? 0.0 : 0.2 + 0.8 * uYear.x, uYear2.y > 0.01 ? 0.75 : 0.0);
    transformed = aStalk + (transformed - aStalk) * keep * grow;
    vec3 base = pick3(uLeafCol, aLeaf.y);
    base = mix(base, pick3(uSpring, aLeaf.y), uYear.z * 0.7);
    float turn = clamp(uYear.y * 1.5 - aLeaf.x * 0.5, 0.0, 1.0) * step(aLeaf.x, uYear2.z);
    base = mix(base, pick3(uAutumn, aLeaf.y), turn);
    if (uYear2.x > 0.5) base = mix(pick3(uAutumn, aLeaf.y), vec3(0.49, 0.36, 0.23), 0.6);
    vSeason = mix(base, uBloom, uYear2.y);
  }
#ifdef USE_INSTANCING
  vec3 forestOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 forestOrigin = vec3(0.0);
#endif
  float forestSway = aWind * (uWind * 0.5 + 0.06) * sin(uTime * 1.2 + forestOrigin.x * 0.37 + forestOrigin.z * 0.21);
  transformed.x += forestSway;
  transformed.z += forestSway * 0.5;
  vLodDistance = distance(cameraPosition, (modelMatrix * vec4(forestOrigin, 1.0)).xyz);`;
const FOREST_DITHER = /* glsl */ `
uniform vec4 uLod;
varying vec3 vSeason;
varying float vViewDepth;
varying float vLodDistance;
uniform vec2 uLodIn;
float forestBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
`;
// Each level gives way to the next past uLod.x (over a band uLod.y), and takes
// over from the one before at uLodIn, on the same dither; everything
// dissolves by dither close to the lens (gone at uLod.z, solid from uLod.w).
const FOREST_DISCARD = /* glsl */ `
  float forestT = forestBayer(gl_FragCoord.xy);
  if (smoothstep(uLod.x + uLod.y, uLod.x - uLod.y, vLodDistance) <= forestT) discard;
  if (uLodIn.x > 0.0 && smoothstep(uLodIn.x + uLodIn.y, uLodIn.x - uLodIn.y, vLodDistance) > forestT) discard;
  if (smoothstep(uLod.z, uLod.w, vViewDepth) < forestT) discard;`;

/** One tree's shape at one level of detail, shared by everything that draws that tree at that level. */
interface Shape {
  readonly geometry: GeometryLike;
  /** Card size: half width, height, and the base's drop below the origin. */
  readonly box: { readonly half: number; readonly height: number; readonly base: number };
  readonly triangles: number;
  users: number;
}

/**
 * What a tree is cut down to at one level: real wood down to `wood`, up to `leaves` real leaves (`fill` blades each
 * when they are few), and, for `clumps`, the crown's own masses as lumps under them.
 */
interface RungSpec {
  readonly wood: number;
  readonly sides: number;
  readonly leaves: number;
  readonly fill: number;
  /** Blades smaller than the bake's, which draws fewer and larger. */
  readonly leafSize?: number;
  /** Flat needles on each conifer sprig. */
  readonly needles: number;
  readonly clumps: number;
}

interface Built {
  readonly shape: Shape;
  readonly material: MaterialLike;
  readonly mesh: InstancedLike;
}

interface Rung {
  readonly spec: RungSpec;
  /** Distance this level takes over from the one nearer in (0 for the first), and hands on to the next. */
  readonly from: number;
  readonly to: number;
  readonly band: number;
  readonly lod: Vector4Like;
  readonly lodIn: { x: number; y: number };
  built: Built | null;
  count: number;
  idle: number;
}

interface LadderTree {
  readonly variant: ForestVariant;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly bakeMaterial: MaterialLike;
  readonly rungs: readonly Rung[];
  capacity: number;
}

export interface CardRow {
  readonly geometry: GeometryLike;
  readonly material: MaterialLike;
  readonly box: Shape["box"];
}

interface Bake {
  readonly positions: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly leaf: number[];
  readonly stalk: number[];
  readonly wind: number[];
}

// The shapes alive right now, by the frame they were cut from: two forests of the same tree share them,
// and the last one to stop using a shape frees it, so only what is on screen is ever held.
const SHAPES = new WeakMap<object, Map<string, Shape>>();

const templateOf = (geometry: GeometryLike): { position: Float32Array; normal: Float32Array; color: Float32Array | null } => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  return { position: flat.attributes.position?.array ?? new Float32Array(), normal: flat.attributes.normal?.array ?? new Float32Array(), color: flat.attributes.color?.array ?? null };
};

type Cols = readonly [V3, V3, V3];
const columnsOf = (m: Float32Array): Cols => [[at(m, 0), at(m, 1), at(m, 2)], [at(m, 4), at(m, 5), at(m, 6)], [at(m, 8), at(m, 9), at(m, 10)]];
const combine = (cols: Cols, w: V3): V3 => [
  cols[0][0] * w[0] + cols[1][0] * w[1] + cols[2][0] * w[2],
  cols[0][1] * w[0] + cols[1][1] * w[1] + cols[2][1] * w[2],
  cols[0][2] * w[0] + cols[1][2] * w[1] + cols[2][2] * w[2],
];
const read3 = (array: Float32Array, index: number): V3 => [at(array, index), at(array, index + 1), at(array, index + 2)];
const length2 = (v: V3): number => Math.max(v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 1e-12);

/**
 * Appends a template shape moved by a column-major matrix whose columns are square to each other (so normals scale by
 * 1/|column|²).
 */
function appendShape(bake: Bake, template: ReturnType<typeof templateOf>, m: Float32Array, rgb: V3, extra: { leaf: [number, number]; stalk: V3; wind: number; taper?: number }): void {
  const [a, b, c] = columnsOf(m);
  const ia = 1 / length2(a), ib = 1 / length2(b), ic = 1 / length2(c);
  const ox = at(m, 12), oy = at(m, 13), oz = at(m, 14);
  const { position, normal, color } = template;
  const { positions, normals, colors, leaf, stalk, wind } = bake;
  for (let v = 0; v < position.length; v += 3) {
    const py = at(position, v + 1);
    // The far end of a piece of wood narrows to whatever grows from it.
    const narrow = py > 0 ? (extra.taper ?? 1) : 1;
    const px = at(position, v) * narrow, pz = at(position, v + 2) * narrow;
    const nx = at(normal, v) * ia, ny = at(normal, v + 1) * ib, nz = at(normal, v + 2) * ic;
    positions.push(ox + a[0] * px + b[0] * py + c[0] * pz, oy + a[1] * px + b[1] * py + c[1] * pz, oz + a[2] * px + b[2] * py + c[2] * pz);
    normals.push(a[0] * nx + b[0] * ny + c[0] * nz, a[1] * nx + b[1] * ny + c[1] * nz, a[2] * nx + b[2] * ny + c[2] * nz);
    const tone = color ? at(color, v) : 1;
    colors.push(rgb[0] * tone, rgb[1] * tone, rgb[2] * tone);
    leaf.push(extra.leaf[0], extra.leaf[1]);
    stalk.push(extra.stalk[0], extra.stalk[1], extra.stalk[2]);
    wind.push(extra.wind);
  }
}

function bakeWood(lit: LitLike, bake: Bake, variant: ForestVariant, minRadius: number, sides = 6): void {
  const { model, frame, colors } = variant;
  const template = templateOf(lit.cylinder(0.5, 0.5, 1, sides, 1));
  const m = new Float32Array(16);
  const color = new lit.Color();
  const height = Math.max(frame.height, 1);
  // Thickest wood growing from each piece, for the taper.
  const onward = new Float32Array(model.count);
  if (model.parent) for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (parent >= 0 && at(frame.grow, node) >= 0.5) onward[parent] = Math.max(at(onward, parent), at(frame.radius, node));
  }
  for (let node = 0; node < model.count; node += 1) {
    const radius = at(frame.radius, node);
    if (at(frame.grow, node) < 0.5 || at(frame.fall, node) > 0 || at(frame.rot, node) > 0.5 || radius < minRadius) continue;
    writeSegment(m, 0, [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)], [at(frame.x, node), at(frame.y, node), at(frame.z, node)], radius);
    color.set((radius > 0.2 ? colors.trunk[0] : radius > 0.07 ? colors.trunk[1] : colors.trunk[2]) ?? "#6b4a33");
    if (at(frame.dead, node) > 0.3) color.lerp(new lit.Color("#8e897f"), 0.6);
    appendShape(bake, template, m, [color.r, color.g, color.b], { leaf: [-1, 0], stalk: [0, 0, 0], wind: (at(frame.y, node) / height) ** 2, taper: model.parent ? Math.min(1, Math.max(at(onward, node), 0.0225) / Math.max(radius, 0.0225)) : 1 });
  }
}

function bakeLeaves(lit: LitLike, bake: Bake, variant: ForestVariant, maxLeaves: number, fill = 1, leafSize = 1, sprig = 10): void {
  const { model, frame, colors } = variant;
  const slots = model.leaves;
  const stride = Math.max(1, Math.ceil(slots.count / maxLeaves));
  const needles = NEEDLE_KINDS[model.species.id] !== undefined;
  const template = templateOf(needles ? lightSprig(lit, model.species.id, sprig) : speciesBlade(lit, model.species.id));
  const shade = crownShade(frame, slots);
  const m = new Float32Array(16);
  const height = Math.max(frame.height, 1);
  const size = colors.leafScale * 1.9 * Math.sqrt(stride) * leafSize;
  for (let index = 0; index < slots.count; index += stride) {
    const node = at(slots.node, index);
    if (!leafyNode(frame, node, needles ? 40 : model.species.evergreen ? 7 : 2.6)) continue;
    const rank = at(slots.rank, index);
    let stalk: V3, d: V3;
    if (needles) ({ p: stalk, n: d } = sprigPlace(frame, slots, index));
    else {
      d = norm3(at(slots.dx, index), at(slots.dy, index), at(slots.dz, index));
      const reach = Math.min(Math.hypot(at(slots.dx, index), at(slots.dy, index), at(slots.dz, index)) * 0.3, 0.22);
      stalk = [at(frame.x, node) + d[0] * reach, at(frame.y, node) + d[1] * reach, at(frame.z, node) + d[2] * reach];
    }
    writeBlade(m, 0, stalk, d, size * at(slots.size, index), needles ? { droop: 0.04, twist: rank * TAU, nod: 0 } : { droop: 0.35 + 0.25 * rank, twist: rank * TAU * 0.25, nod: 0 });
    const s = at(shade, index);
    appendShape(bake, template, m, [s, s, s], { leaf: [rank, at(slots.tone, index) % 3], stalk, wind: (stalk[1] / height) ** 2 });
    // Up close the same leaf keeps a few neighbours, in the same spot on the same twig.
    for (let extra = 1; stride === 1 && !needles && extra < fill; extra += 1) {
      const spin = rank * TAU + extra * 2.4, off = 0.1 + 0.05 * extra;
      const near: V3 = [stalk[0] + Math.cos(spin) * off, stalk[1] + Math.sin(spin * 1.7) * off * 0.6, stalk[2] + Math.sin(spin) * off];
      writeBlade(m, 0, near, norm3(d[0] + Math.cos(spin) * 0.5, d[1], d[2] + Math.sin(spin) * 0.5), size * at(slots.size, index) * 0.82, needles ? { droop: 0.04, twist: spin, nod: 0 } : { droop: 0.3 + 0.3 * rank, twist: spin * 0.25, nod: 0 });
      appendShape(bake, template, m, [s, s, s], { leaf: [Math.min(1, rank + extra * 0.04), at(slots.tone, index) % 3], stalk: near, wind: (near[1] / height) ** 2 });
    }
  }
}

/**
 * The crown's real masses: its leaves gathered by where they grow, each gathering a lump in its own place, size, tone
 * and shade.
 */
function bakeClumps(lit: LitLike, bake: Bake, variant: ForestVariant, cells: number): void {
  const { model, frame } = variant;
  const slots = model.leaves;
  const needles = NEEDLE_KINDS[model.species.id] !== undefined;
  const shade = crownShade(frame, slots);
  const height = Math.max(frame.height, 1);
  const cell = Math.max(height / cells, 0.5);
  const masses = new Map<string, { x: number; y: number; z: number; n: number; rank: number; shade: number; tone: number; reach: number }>();
  for (let index = 0; index < slots.count; index += 1) {
    const node = at(slots.node, index);
    if (!leafyNode(frame, node, needles ? 40 : model.species.evergreen ? 7 : 2.6)) continue;
    const x = at(frame.x, node), y = at(frame.y, node), z = at(frame.z, node);
    const key = `${String(Math.floor(x / cell))},${String(Math.floor(y / cell))},${String(Math.floor(z / cell))}`;
    const mass = masses.get(key) ?? { x: 0, y: 0, z: 0, n: 0, rank: 0, shade: 0, tone: at(slots.tone, index) % 3, reach: 0 };
    mass.x += x; mass.y += y; mass.z += z; mass.n += 1; mass.rank += at(slots.rank, index); mass.shade += at(shade, index);
    masses.set(key, mass);
  }
  // Round normals: a mass of leaves has no facets.
  const ball = templateOf(lit.icosahedron(1, 1));
  const template = { ...ball, normal: ball.position };
  const m = new Float32Array(16);
  for (const mass of masses.values()) {
    const x = mass.x / mass.n, y = mass.y / mass.n, z = mass.z / mass.n;
    // The lump sits well inside the leaves, never past them: it only fills the gaps.
    const r = cell * Math.min(0.5, 0.2 + 0.05 * Math.sqrt(mass.n));
    m.fill(0); m[0] = r; m[5] = r * 0.8; m[10] = r; m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    // Under the leaves, so it reads as the shadowed heart of the mass.
    const s = (mass.shade / mass.n) * 0.7;
    appendShape(bake, template, m, [s, s, s], { leaf: [mass.rank / mass.n, mass.tone], stalk: [x, y, z], wind: (y / height) ** 2 });
  }
}

function bakedGeometry(lit: LitLike, variant: ForestVariant, spec: RungSpec): GeometryLike {
  const bake: Bake = { positions: [], normals: [], colors: [], leaf: [], stalk: [], wind: [] };
  bakeWood(lit, bake, variant, spec.wood, spec.sides);
  // A conifer's boughs are its branches and needles: a lump there would only float.
  if (spec.clumps > 0 && NEEDLE_KINDS[variant.model.species.id] === undefined) bakeClumps(lit, bake, variant, spec.clumps);
  bakeLeaves(lit, bake, variant, spec.leaves, spec.fill, spec.leafSize, spec.needles);
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(bake.positions), 3));
  geometry.setAttribute("normal", new lit.Attribute(new Float32Array(bake.normals), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(bake.colors), 3));
  geometry.setAttribute("aLeaf", new lit.Attribute(new Float32Array(bake.leaf), 2));
  geometry.setAttribute("aStalk", new lit.Attribute(new Float32Array(bake.stalk), 3));
  geometry.setAttribute("aWind", new lit.Attribute(new Float32Array(bake.wind), 1));
  return geometry;
}

const linear = (lit: LitLike, hex: string | undefined): Vector3Like => {
  const c = new lit.Color(hex ?? "#ffffff");
  return new lit.Vector3(c.r, c.g, c.b);
};

function seasonUniforms(lit: LitLike, colors: TreeColors): Record<string, { value: unknown }> {
  const three3 = (list: readonly string[]): Vector3Like[] => [0, 1, 2].map((i) => linear(lit, list[i % list.length]));
  return {
    uTime: { value: 0 }, uWind: { value: 0 },
    uYear: { value: { x: 1, y: 0, z: 0, w: 0 } }, uYear2: { value: { x: 0, y: 0, z: 2, w: 0 } },
    uLeafCol: { value: three3(colors.leaves) }, uSpring: { value: three3(colors.spring) }, uAutumn: { value: three3(colors.autumn) },
    uBloom: { value: linear(lit, colors.spring[1]) },
    uLod: { value: { x: 0, y: 0, z: 0, w: 0 } }, uLodIn: { value: { x: 0, y: 0 } },
  };
}

export interface Vector4Like { x: number; y: number; z: number; w: number }

/** A standard material that keeps the season on the GPU, sways, and dithers out by distance and near the lens. */
function forestMaterial(lit: LitLike, uniforms: Record<string, { value: unknown }>, card: boolean): MaterialLike {
  const material = new lit.LitMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.85, metalness: 0, side: "both" });
  material.onCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = FOREST_VERTEX_HEAD + shader.vertexShader
      .replace("#include <begin_vertex>", FOREST_VERTEX_BEGIN)
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vViewDepth = -mvPosition.z;");
    shader.fragmentShader = FOREST_DITHER + shader.fragmentShader
      .replace("void main() {", `void main() {${card ? "" : FOREST_DISCARD}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vSeason;");
  };
  material.customProgramCacheKey = () => `keel-forest${card ? "-bake" : ""}`;
  // A look that swaps materials (cel shading) must leave this one: the season lives in its shader.
  material.userData.voxelDitherKeep = true;
  return material;
}

function boxOf(geometry: GeometryLike): Shape["box"] {
  const p = geometry.attributes.position?.array ?? new Float32Array();
  let half = 0.5, top = 1, bottom = 0;
  for (let i = 0; i < p.length; i += 3) {
    half = Math.max(half, Math.abs(at(p, i)), Math.abs(at(p, i + 2)));
    top = Math.max(top, at(p, i + 1));
    bottom = Math.min(bottom, at(p, i + 1));
  }
  return { half: half * 1.05, height: (top - bottom) * 1.04, base: bottom };
}

function setYear(uniforms: Record<string, { value: unknown }>, year: YearLike, model: TreeModelLike, colors: TreeColors): void {
  const y = uniforms.uYear?.value as Vector4Like;
  const y2 = uniforms.uYear2?.value as Vector4Like;
  y.x = year.leaf; y.y = year.color; y.z = colors.blossom === true ? 0 : year.flush; y.w = year.drop;
  const bloom = colors.blossom === true && model.species.flower ? clamp(year.bloom - year.petals, 0, 1) * 0.75 : 0;
  y2.x = year.withered ? 1 : 0; y2.y = bloom; y2.z = model.species.evergreen ? model.species.phenology.dropMax * 1.4 : 2;
}


// ---------------------------------------------------------------- forest assembly

/** How a tree comes apart with distance, as shares of `near`, where the plain bake ends. */
const LADDER_CLOSE = 0.45;
const LADDER_LAYERED = 2.2;
/** Updates a level may sit unused before it is freed (about fifteen seconds). */
const LEVEL_KEEP = 900;

function takeShape(lit: ForestLitLike, variant: ForestVariant, spec: RungSpec): Shape {
  const shapes = SHAPES.get(variant.frame) ?? new Map<string, Shape>();
  SHAPES.set(variant.frame, shapes);
  const key = `${JSON.stringify(spec)}|${variant.colors.trunk.join()}|${String(variant.colors.leafScale)}`;
  let shape = shapes.get(key);
  if (!shape) {
    const geometry = bakedGeometry(lit, variant, spec);
    shape = { geometry, box: boxOf(geometry), triangles: (geometry.attributes.position?.array.length ?? 0) / 9, users: 0 };
    shapes.set(key, shape);
  }
  shape.users += 1;
  return shape;
}

function dropShape(variant: ForestVariant, shape: Shape): void {
  shape.users -= 1;
  if (shape.users > 0) return;
  shape.geometry.dispose();
  const shapes = SHAPES.get(variant.frame);
  if (!shapes) return;
  for (const [key, held] of shapes) if (held === shape) shapes.delete(key);
}

/** How wide a crossing between levels is: short, or the dither shows on whatever stands in it. */
const crossing = (band: number, at: number): number => Math.min(band, 1.2, at * 0.05);

function ladderTree(lit: ForestLitLike, variant: ForestVariant, options: ForestOptions, capacity: number, lod: Vector4Like): LadderTree {
  const uniforms = seasonUniforms(lit, variant.colors);
  const specs: readonly (readonly [RungSpec, number])[] = [
    [{ wood: 0.012, sides: 9, leaves: 6000, fill: 4, leafSize: 0.7, needles: 24, clumps: 0 }, lod.x * LADDER_CLOSE],
    [{ wood: options.minRadius ?? 0.025, sides: 6, leaves: options.maxLeaves ?? 1600, fill: 1, needles: 9, clumps: 0 }, lod.x],
    [{ wood: 0.03, sides: 3, leaves: 280, fill: 1, leafSize: 1.3, needles: 4, clumps: 6 }, lod.x * LADDER_LAYERED],
  ];
  let from = 0;
  const rungs = specs.map(([spec, to], index): Rung => {
    const band = crossing(lod.y, to);
    const inner = crossing(lod.y, specs[index - 1]?.[1] ?? 0);
    const rung: Rung = { spec, from, to, band, lod: { x: to, y: band, z: lod.z, w: lod.w }, lodIn: { x: from, y: inner }, built: null, count: 0, idle: 0 };
    from = to;
    return rung;
  });
  return { variant, uniforms, bakeMaterial: forestMaterial(lit, uniforms, true), rungs, capacity };
}

/** Builds a level the first time a tree reaches it. */
function buildRung(state: ForestState, tree: LadderTree, rung: Rung): void {
  const { lit } = state;
  const shape = takeShape(lit, tree.variant, rung.spec);
  const material = forestMaterial(lit, { ...tree.uniforms, uLod: { value: rung.lod }, uLodIn: { value: rung.lodIn } }, false);
  rung.built = { shape, material, mesh: rungMesh(state, tree, shape, material) };
  rung.idle = 0;
}

function rungMesh(state: ForestState, tree: LadderTree, shape: Shape, material: MaterialLike): InstancedLike {
  const { lit } = state;
  const mesh = new lit.Instances(shape.geometry, material, Math.max(1, tree.capacity));
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.setColorAt(0, new lit.Color("#ffffff"));
  state.group.add(mesh);
  return mesh;
}

/** Moves the forest to new places, keeping every level built: only a tree outgrowing its room gets a bigger mesh. */
function movePlaces(state: ForestState, places: readonly ForestPlace[]): void {
  state.options = { ...state.options, places };
  state.trees.forEach((tree, v) => {
    const count = places.filter((place) => place.variant === v).length;
    if (count <= tree.capacity) return;
    tree.capacity = Math.ceil(count * 1.5);
    for (const rung of tree.rungs) {
      const { built } = rung;
      if (!built) continue;
      state.group.remove(built.mesh);
      built.mesh.dispose();
      rung.built = { ...built, mesh: rungMesh(state, tree, built.shape, built.material) };
    }
  });
  if (state.cards && places.length > state.cards.capacity) closeCards(state);
}

function freeRung(state: ForestState, tree: LadderTree, rung: Rung): void {
  const { built } = rung;
  if (!built) return;
  state.group.remove(built.mesh);
  built.mesh.dispose();
  built.material.dispose();
  dropShape(tree.variant, built.shape);
  rung.built = null;
}

function openCards(state: ForestState): Cards {
  const rows = state.trees.map((tree): CardRow => {
    const { geometry, box } = takeShape(state.lit, tree.variant, (tree.rungs[1] as Rung).spec);
    return { geometry, box, material: tree.bakeMaterial };
  });
  const cards = createCards(state.lit, rows, state.options.places.length * 2, state.options, state.cardLod);
  state.group.add(cards.mesh);
  state.cards = cards;
  return cards;
}

function closeCards(state: ForestState): void {
  const { cards } = state;
  if (!cards) return;
  state.group.remove(cards.mesh);
  cards.material.dispose();
  cards.mesh.geometry.dispose();
  cards.mesh.dispose();
  cards.target.dispose();
  state.trees.forEach((tree, row) => {
    const held = SHAPES.get(tree.variant.frame);
    const geometry = cards.rows[row]?.geometry;
    for (const shape of held?.values() ?? []) if (shape.geometry === geometry) { dropShape(tree.variant, shape); break; }
  });
  state.cards = null;
}

interface ForestState {
  readonly lit: ForestLitLike;
  readonly group: NodeLike;
  options: ForestOptions;
  readonly trees: readonly LadderTree[];
  readonly cardLod: Vector4Like;
  readonly keep: number;
  readonly tint: ColorLike;
  cards: Cards | null;
  far: number;
}

const yearOf = (input: ForestUpdate, variant: number): YearLike => (typeof input.year === "function" ? input.year(variant) : input.year);

function seasonKey(state: ForestState, input: ForestUpdate): string {
  return state.trees.map((_, v) => {
    const y = yearOf(input, v);
    return [y.leaf, y.color, y.flush, y.drop, y.bloom - y.petals].map((n) => Math.round(n * 24)).join(",") + (y.withered ? "w" : "");
  }).join("|");
}

/** The built level nearest the one wanted, coarser first: a level not yet built never leaves a gap. */
function nearestBuilt(tree: LadderTree, wanted: number): number {
  for (let step = 0; step < tree.rungs.length; step += 1) {
    if (tree.rungs[wanted + step]?.built) return wanted + step;
    if (tree.rungs[wanted - step]?.built) return wanted - step;
  }
  return -1;
}

/** A level crosses to a neighbour only if that neighbour exists; otherwise it holds on past its edge. */
function openEdges(tree: LadderTree, cardsOn: boolean): void {
  tree.rungs.forEach((rung, r) => {
    const finer = tree.rungs[r - 1], coarser = tree.rungs[r + 1];
    rung.lodIn.x = finer?.built ? rung.from : 0;
    rung.lod.x = (coarser ? coarser.built !== null : cardsOn) ? rung.to : 1e6;
  });
}

function placeTrees(state: ForestState, input: ForestUpdate, cardsOn: boolean): void {
  const { trees, cards, options, cardLod } = state;
  for (const tree of trees) {
    openEdges(tree, cardsOn);
    for (const rung of tree.rungs) rung.count = 0;
  }
  let far = 0;
  let missing: readonly [LadderTree, Rung] | null = null;
  const c = input.camera.position;
  for (const place of options.places) {
    const tree = trees[place.variant];
    if (!tree) continue;
    const distance = Math.hypot(place.x - c.x, place.y - c.y, place.z - c.z);
    let drawn = 0;
    tree.rungs.forEach((rung, r) => {
      const last = r === tree.rungs.length - 1;
      if (distance < rung.from - rung.lodIn.y || (distance > rung.to + rung.band && (cardsOn || !last))) return;
      if (!rung.built) {
        missing ??= [tree, rung];
        if (nearestBuilt(tree, r) < 0) buildRung(state, tree, rung);
      }
      const at = nearestBuilt(tree, r), target = tree.rungs[at];
      if (!target?.built || (drawn & (1 << at)) !== 0) return;
      drawn |= 1 << at;
      const { mesh } = target.built;
      writeBox(mesh.instanceMatrix.array, target.count, place.x, place.y, place.z, place.scale, place.scale, place.scale, place.yaw);
      mesh.setColorAt(target.count, state.tint.setRGB(place.tint, place.tint, place.tint));
      target.count += 1;
    });
    if (cards && cardsOn && distance > cardLod.x - cardLod.y) {
      writeBox(cards.mesh.instanceMatrix.array, far, place.x, place.y, place.z, place.scale, place.scale, place.scale, place.yaw);
      cards.card[far * 2] = place.variant;
      cards.card[far * 2 + 1] = place.tint;
      far += 1;
    }
  }
  // One new level a frame, so a whole forest arriving costs no single long frame.
  if (missing) { const [tree, rung] = missing as readonly [LadderTree, Rung]; if (!rung.built) buildRung(state, tree, rung); }
  for (const tree of trees) for (const rung of tree.rungs) {
    rung.idle = rung.count > 0 ? 0 : rung.idle + 1;
    if (rung.built && rung.idle > state.keep) freeRung(state, tree, rung);
    if (!rung.built) continue;
    rung.built.mesh.count = rung.count;
    rung.built.mesh.instanceMatrix.needsUpdate = true;
    if (rung.built.mesh.instanceColor) rung.built.mesh.instanceColor.needsUpdate = true;
  }
  state.far = far;
  if (cards) {
    finishCards(cards, cardsOn ? far : 0);
    cards.idle = far > 0 ? 0 : cards.idle + 1;
    if (cards.idle > state.keep) closeCards(state);
  }
}

function finishCards(cards: Cards, count: number): void {
  cards.mesh.count = count;
  cards.mesh.instanceMatrix.needsUpdate = true;
  const attribute = cards.mesh.geometry.attributes.aCard;
  if (attribute) attribute.needsUpdate = true;
}

function cardLight(cards: Cards, input: ForestUpdate): void {
  const light = cards.uniforms.uLight?.value as Vector3Like;
  const l = input.light ?? [1, 1, 1];
  light.set(l[0], l[1], l[2]);
  const fogColor = cards.uniforms.uFogColor?.value as Vector3Like;
  const fog = cards.uniforms.uFog?.value as { x: number; y: number };
  if (input.fog) { fogColor.set(...input.fog.color); fog.x = input.fog.near; fog.y = input.fog.far; } else { fog.x = 0; fog.y = 0; }
}

function updateForest(state: ForestState, input: ForestUpdate): void {
  state.trees.forEach((tree, v) => {
    setYear(tree.uniforms, yearOf(input, v), tree.variant.model, tree.variant.colors);
    (tree.uniforms.uTime as { value: number }).value = input.elapsed;
    (tree.uniforms.uWind as { value: number }).value = input.wind;
  });
  const renderer = input.renderer ?? null;
  const c = input.camera.position;
  const edge = state.cardLod.x - state.cardLod.y;
  // Cards exist only while some tree is far enough to be one.
  const wanted = renderer !== null && state.options.places.some((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) > edge);
  const cards = wanted ? (state.cards ?? openCards(state)) : state.cards;
  if (cards && renderer) {
    const key = seasonKey(state, input);
    if (key !== cards.key) { bakeCards(state.lit, renderer, cards, cards.rows); cards.key = key; }
    cardLight(cards, input);
  }
  placeTrees(state, input, cards !== null && cards.key !== "");
}

/**
 * Many trees, cheaply, at any distance. Every level is cut from the real tree
 * and nobody asks for one: the richest (all its wood, its leaves filled out)
 * near the eye, the plain bake to `near`, then its big wood and real crown
 * masses under a few big leaves, then an impostor card from an atlas of baked
 * views. Each level is one instanced mesh shared by every tree that needs it,
 * built the first time a tree comes within its distance, crossed to and from on a
 * dither, and freed again once nothing has used it for a while; two forests of the
 * same tree share one shape. A forest seen only from afar never builds its
 * near levels, and one seen only close never builds cards. Nothing is drawn right at the lens.
 */
export function createForest(lit: ForestLitLike, options: ForestOptions): Forest {
  const group = new lit.Group();
  const fade = options.fade ?? [1.5, 5];
  const lod: Vector4Like = { x: options.near ?? 26, y: options.band ?? 3, z: fade[0], w: fade[1] };
  const variants = options.variants.slice(0, MAX_VARIANTS);
  const counts = variants.map((_, v) => options.places.filter((place) => place.variant === v).length);
  const trees = variants.map((variant, v) => ladderTree(lit, variant, options, counts[v] ?? 0, lod));
  const cardLod: Vector4Like = { ...lod, x: lod.x * LADDER_LAYERED, y: crossing(lod.y, lod.x * LADDER_LAYERED) };
  const state: ForestState = { lit, group, options: { ...options, variants }, trees, cardLod, keep: options.keep ?? LEVEL_KEEP, tint: new lit.Color(), cards: null, far: 0 };
  return {
    group,
    get levels() {
      const drawn = (r: number): number => trees.reduce((sum, tree) => sum + (tree.rungs[r]?.count ?? 0), 0);
      const shapes = trees.flatMap((tree) => tree.rungs.flatMap((rung) => (rung.built ? [rung.built.shape] : [])));
      return { close: drawn(0), full: drawn(1), layered: drawn(2), cards: state.far, built: shapes.length + (state.cards ? 1 : 0), triangles: trees.reduce((sum, tree) => sum + tree.rungs.reduce((n, rung) => n + rung.count * (rung.built?.shape.triangles ?? 0), 0), 0) };
    },
    update: (input) => { updateForest(state, input); },
    setPlaces: (places) => { movePlaces(state, places); },
    dispose: () => {
      closeCards(state);
      for (const tree of trees) {
        for (const rung of tree.rungs) freeRung(state, tree, rung);
        tree.bakeMaterial.dispose();
      }
    },
  };
}
