// Baking a forest tree: its wood, leaves and crown masses cut to one level of detail, in a material that keeps
// the season on the GPU.

import type {
  GeometryLike, LitLike, MaterialLike, TreeColors, TreeFrameLike, TreeModelLike, Vector3Like, YearLike,
} from "../inputs.js";
import { TAU, at, clamp } from "../math.js";
import { norm3, writeBlade, writeSegment } from "../instances.js";
import type { V3 } from "../instances.js";
import { NEEDLE_KINDS, lightSprig, speciesBlade } from "../tree/shapes.js";
import { leafyNode, tipLimitOf } from "../tree/tree.js";
import { crownShade, sprigPlace } from "../tree/leaves.js";
import { trunkTone } from "../tree/wood.js";
import type { ForestVariant } from "./forest.js";

// ---------------------------------------------------------------- the season on the GPU

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

export interface Vector4Like {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * What a tree is cut down to at one level: real wood down to `wood`, up to `leaves` real leaves (`fill` blades each
 * when they are few), and, for `clumps`, the crown's own masses as lumps under them.
 */
export interface RungSpec {
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

/** Card size: half width, height, and the base's drop below the origin. */
export interface Box {
  readonly half: number;
  readonly height: number;
  readonly base: number;
}

// ---------------------------------------------------------------- the bake

interface Bake {
  readonly positions: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly leaf: number[];
  readonly stalk: number[];
  readonly wind: number[];
}

interface Template {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly color: Float32Array | null;
}

const templateOf = (geometry: GeometryLike): Template => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  return {
    position: flat.attributes.position?.array ?? new Float32Array(),
    normal: flat.attributes.normal?.array ?? new Float32Array(),
    color: flat.attributes.color?.array ?? null,
  };
};

type Cols = readonly [V3, V3, V3];
const columnsOf = (m: Float32Array): Cols => [
  [at(m, 0), at(m, 1), at(m, 2)],
  [at(m, 4), at(m, 5), at(m, 6)],
  [at(m, 8), at(m, 9), at(m, 10)],
];
const length2 = (v: V3): number => Math.max(v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 1e-12);

/** What one appended piece carries besides its shape: its colour, its leaf rank and tone, its stalk and its sway. */
interface Piece {
  readonly rgb: V3;
  readonly leaf: readonly [number, number];
  readonly stalk: V3;
  readonly wind: number;
  readonly taper?: number;
}

/**
 * Appends a template shape moved by a column-major matrix whose columns are square to each other (so normals scale by
 * 1/|column|²).
 */
function appendShape(bake: Bake, template: Template, m: Float32Array, piece: Piece): void {
  const [a, b, c] = columnsOf(m);
  const ia = 1 / length2(a);
  const ib = 1 / length2(b);
  const ic = 1 / length2(c);
  const ox = at(m, 12);
  const oy = at(m, 13);
  const oz = at(m, 14);
  const { position, normal, color } = template;
  const { positions, normals, colors, leaf, stalk, wind } = bake;
  const { rgb } = piece;
  for (let v = 0; v < position.length; v += 3) {
    const py = at(position, v + 1);
    // The far end of a piece of wood narrows to whatever grows from it.
    const narrow = py > 0 ? (piece.taper ?? 1) : 1;
    const px = at(position, v) * narrow;
    const pz = at(position, v + 2) * narrow;
    const nx = at(normal, v) * ia;
    const ny = at(normal, v + 1) * ib;
    const nz = at(normal, v + 2) * ic;
    positions.push(
      ox + a[0] * px + b[0] * py + c[0] * pz,
      oy + a[1] * px + b[1] * py + c[1] * pz,
      oz + a[2] * px + b[2] * py + c[2] * pz,
    );
    normals.push(
      a[0] * nx + b[0] * ny + c[0] * nz,
      a[1] * nx + b[1] * ny + c[1] * nz,
      a[2] * nx + b[2] * ny + c[2] * nz,
    );
    const tone = color ? at(color, v) : 1;
    colors.push(rgb[0] * tone, rgb[1] * tone, rgb[2] * tone);
    leaf.push(piece.leaf[0], piece.leaf[1]);
    stalk.push(piece.stalk[0], piece.stalk[1], piece.stalk[2]);
    wind.push(piece.wind);
  }
}

/** Thickest wood growing from each piece, for the taper. */
function onwardRadius(model: TreeModelLike, frame: TreeFrameLike): Float32Array {
  const onward = new Float32Array(model.count);
  if (!model.parent) return onward;
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (parent >= 0 && at(frame.grow, node) >= 0.5) {
      onward[parent] = Math.max(at(onward, parent), at(frame.radius, node));
    }
  }
  return onward;
}

/** Is this piece of wood baked: grown, standing, not rotted away and thick enough? */
function bakedWood(frame: TreeFrameLike, node: number, minRadius: number): boolean {
  const left =
    at(frame.grow, node) < 0.5 ||
    at(frame.fall, node) > 0 ||
    at(frame.rot, node) > 0.5 ||
    at(frame.radius, node) < minRadius;
  return !left;
}

function bakeWood(lit: LitLike, bake: Bake, variant: ForestVariant, spec: Pick<RungSpec, "wood" | "sides">): void {
  const { model, frame, colors } = variant;
  const template = templateOf(lit.cylinder(0.5, 0.5, 1, spec.sides, 1));
  const m = new Float32Array(16);
  const color = new lit.Color();
  const height = Math.max(frame.height, 1);
  const onward = onwardRadius(model, frame);
  for (let node = 0; node < model.count; node += 1) {
    const radius = at(frame.radius, node);
    if (!bakedWood(frame, node, spec.wood)) continue;
    writeSegment(m, 0, {
      a: [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)],
      b: [at(frame.x, node), at(frame.y, node), at(frame.z, node)],
      radius,
    });
    color.set(trunkTone(colors.trunk, radius) ?? "#6b4a33");
    if (at(frame.dead, node) > 0.3) color.lerp(new lit.Color("#8e897f"), 0.6);
    appendShape(bake, template, m, {
      rgb: [color.r, color.g, color.b],
      leaf: [-1, 0],
      stalk: [0, 0, 0],
      wind: (at(frame.y, node) / height) ** 2,
      taper: model.parent ? Math.min(1, Math.max(at(onward, node), 0.0225) / Math.max(radius, 0.0225)) : 1,
    });
  }
}

/** What every leaf of one bake shares: the variant, the blade template, the shade and the sizes. */
interface LeafBake {
  readonly bake: Bake;
  readonly template: Template;
  readonly variant: ForestVariant;
  readonly shade: Float32Array;
  readonly m: Float32Array;
  readonly height: number;
  readonly size: number;
  readonly needles: boolean;
  readonly fill: number;
  readonly stride: number;
}

/** One baked leaf: where its stalk sits and the way it points, its rank and its shade. */
interface BakedLeaf {
  readonly stalk: V3;
  readonly d: V3;
  readonly rank: number;
  readonly s: number;
}

/** Where a leaf's stalk sits and which way it points: a sprig along its twig, or a blade a little out from it. */
function leafStalk(
  frame: TreeFrameLike,
  slots: TreeModelLike["leaves"],
  index: number,
  needles: boolean,
): { stalk: V3; d: V3 } {
  if (needles) {
    const { p, n } = sprigPlace(frame, slots, index);
    return { stalk: p, d: n };
  }
  const node = at(slots.node, index);
  const d = norm3(at(slots.dx, index), at(slots.dy, index), at(slots.dz, index));
  const reach = Math.min(Math.hypot(at(slots.dx, index), at(slots.dy, index), at(slots.dz, index)) * 0.3, 0.22);
  const stalk: V3 = [
    at(frame.x, node) + d[0] * reach,
    at(frame.y, node) + d[1] * reach,
    at(frame.z, node) + d[2] * reach,
  ];
  return { stalk, d };
}

/** Up close the same leaf keeps a few neighbours, in the same spot on the same twig. */
function bakeNeighbour(leaf: LeafBake, index: number, own: BakedLeaf, extra: number): void {
  const slots = leaf.variant.model.leaves;
  const { stalk, d, rank, s } = own;
  const spin = rank * TAU + extra * 2.4;
  const off = 0.1 + 0.05 * extra;
  const near: V3 = [
    stalk[0] + Math.cos(spin) * off,
    stalk[1] + Math.sin(spin * 1.7) * off * 0.6,
    stalk[2] + Math.sin(spin) * off,
  ];
  writeBlade(
    leaf.m,
    0,
    {
      p: near,
      n: norm3(d[0] + Math.cos(spin) * 0.5, d[1], d[2] + Math.sin(spin) * 0.5),
      size: leaf.size * at(slots.size, index) * 0.82,
    },
    leaf.needles ? { droop: 0.04, twist: spin, nod: 0 } : { droop: 0.3 + 0.3 * rank, twist: spin * 0.25, nod: 0 },
  );
  appendShape(leaf.bake, leaf.template, leaf.m, {
    rgb: [s, s, s],
    leaf: [Math.min(1, rank + extra * 0.04), at(slots.tone, index) % 3],
    stalk: near,
    wind: (near[1] / leaf.height) ** 2,
  });
}

function bakeLeaf(leaf: LeafBake, index: number): void {
  const { frame, model } = leaf.variant;
  const slots = model.leaves;
  const { needles } = leaf;
  const rank = at(slots.rank, index);
  const { stalk, d } = leafStalk(frame, slots, index, needles);
  const flutter = needles
    ? { droop: 0.04, twist: rank * TAU, nod: 0 }
    : { droop: 0.35 + 0.25 * rank, twist: rank * TAU * 0.25, nod: 0 };
  writeBlade(leaf.m, 0, { p: stalk, n: d, size: leaf.size * at(slots.size, index) }, flutter);
  const s = at(leaf.shade, index);
  appendShape(leaf.bake, leaf.template, leaf.m, {
    rgb: [s, s, s],
    leaf: [rank, at(slots.tone, index) % 3],
    stalk,
    wind: (stalk[1] / leaf.height) ** 2,
  });
  for (let extra = 1; leaf.stride === 1 && !needles && extra < leaf.fill; extra += 1) {
    bakeNeighbour(leaf, index, { stalk, d, rank, s }, extra);
  }
}

function bakeLeaves(lit: LitLike, bake: Bake, variant: ForestVariant, spec: RungSpec): void {
  const { model, frame, colors } = variant;
  const slots = model.leaves;
  const stride = Math.max(1, Math.ceil(slots.count / spec.leaves));
  const needles = NEEDLE_KINDS[model.species.id] !== undefined;
  const blade = needles ? lightSprig(lit, model.species.id, spec.needles) : speciesBlade(lit, model.species.id);
  const leaf: LeafBake = {
    bake,
    template: templateOf(blade),
    variant,
    shade: crownShade(frame, slots),
    m: new Float32Array(16),
    height: Math.max(frame.height, 1),
    size: colors.leafScale * 1.9 * Math.sqrt(stride) * (spec.leafSize ?? 1),
    needles,
    fill: spec.fill,
    stride,
  };
  const tipLimit = tipLimitOf(needles, model.species.evergreen);
  for (let index = 0; index < slots.count; index += stride) {
    if (!leafyNode(frame, at(slots.node, index), tipLimit)) continue;
    bakeLeaf(leaf, index);
  }
}

/** One mass of leaves: the sum of their places, ranks and shades, and the tone of the first. */
interface Mass {
  x: number;
  y: number;
  z: number;
  n: number;
  rank: number;
  shade: number;
  tone: number;
  reach: number;
}

/** The crown's leaves gathered by the cell they grow in. */
function crownMasses(variant: ForestVariant, cell: number): Map<string, Mass> {
  const { model, frame } = variant;
  const slots = model.leaves;
  const needles = NEEDLE_KINDS[model.species.id] !== undefined;
  const shade = crownShade(frame, slots);
  const tipLimit = tipLimitOf(needles, model.species.evergreen);
  const masses = new Map<string, Mass>();
  for (let index = 0; index < slots.count; index += 1) {
    const node = at(slots.node, index);
    if (!leafyNode(frame, node, tipLimit)) continue;
    const x = at(frame.x, node);
    const y = at(frame.y, node);
    const z = at(frame.z, node);
    const key = `${String(Math.floor(x / cell))},${String(Math.floor(y / cell))},${String(Math.floor(z / cell))}`;
    const mass = masses.get(key) ?? {
      x: 0,
      y: 0,
      z: 0,
      n: 0,
      rank: 0,
      shade: 0,
      tone: at(slots.tone, index) % 3,
      reach: 0,
    };
    mass.x += x;
    mass.y += y;
    mass.z += z;
    mass.n += 1;
    mass.rank += at(slots.rank, index);
    mass.shade += at(shade, index);
    masses.set(key, mass);
  }
  return masses;
}

/** What every lump of one bake shares: the round template and the cell and tree height the lumps are sized by. */
interface LumpBake {
  readonly bake: Bake;
  readonly template: Template;
  readonly m: Float32Array;
  readonly cell: number;
  readonly height: number;
}

function bakeLump(lump: LumpBake, mass: Mass): void {
  const { m, cell } = lump;
  const x = mass.x / mass.n;
  const y = mass.y / mass.n;
  const z = mass.z / mass.n;
  // The lump sits well inside the leaves, never past them: it only fills the gaps.
  const r = cell * Math.min(0.5, 0.2 + 0.05 * Math.sqrt(mass.n));
  m.fill(0);
  m[0] = r;
  m[5] = r * 0.8;
  m[10] = r;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  // Under the leaves, so it reads as the shadowed heart of the mass.
  const s = (mass.shade / mass.n) * 0.7;
  appendShape(lump.bake, lump.template, m, {
    rgb: [s, s, s],
    leaf: [mass.rank / mass.n, mass.tone],
    stalk: [x, y, z],
    wind: (y / lump.height) ** 2,
  });
}

/**
 * The crown's real masses: its leaves gathered by where they grow, each gathering a lump in its own place, size, tone
 * and shade.
 */
function bakeClumps(lit: LitLike, bake: Bake, variant: ForestVariant, cells: number): void {
  const height = Math.max(variant.frame.height, 1);
  const cell = Math.max(height / cells, 0.5);
  const masses = crownMasses(variant, cell);
  // Round normals: a mass of leaves has no facets.
  const ball = templateOf(lit.icosahedron(1, 1));
  const lump: LumpBake = { bake, template: { ...ball, normal: ball.position }, m: new Float32Array(16), cell, height };
  for (const mass of masses.values()) bakeLump(lump, mass);
}

export function bakedGeometry(lit: LitLike, variant: ForestVariant, spec: RungSpec): GeometryLike {
  const bake: Bake = { positions: [], normals: [], colors: [], leaf: [], stalk: [], wind: [] };
  bakeWood(lit, bake, variant, spec);
  // A conifer's boughs are its branches and needles: a lump there would only float.
  if (spec.clumps > 0 && NEEDLE_KINDS[variant.model.species.id] === undefined) {
    bakeClumps(lit, bake, variant, spec.clumps);
  }
  bakeLeaves(lit, bake, variant, spec);
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(bake.positions), 3));
  geometry.setAttribute("normal", new lit.Attribute(new Float32Array(bake.normals), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(bake.colors), 3));
  geometry.setAttribute("aLeaf", new lit.Attribute(new Float32Array(bake.leaf), 2));
  geometry.setAttribute("aStalk", new lit.Attribute(new Float32Array(bake.stalk), 3));
  geometry.setAttribute("aWind", new lit.Attribute(new Float32Array(bake.wind), 1));
  return geometry;
}

export function boxOf(geometry: GeometryLike): Box {
  const p = geometry.attributes.position?.array ?? new Float32Array();
  let half = 0.5;
  let top = 1;
  let bottom = 0;
  for (let i = 0; i < p.length; i += 3) {
    half = Math.max(half, Math.abs(at(p, i)), Math.abs(at(p, i + 2)));
    top = Math.max(top, at(p, i + 1));
    bottom = Math.min(bottom, at(p, i + 1));
  }
  return { half: half * 1.05, height: (top - bottom) * 1.04, base: bottom };
}

// ---------------------------------------------------------------- the season's material

const linear = (lit: LitLike, hex: string | undefined): Vector3Like => {
  const c = new lit.Color(hex ?? "#ffffff");
  return new lit.Vector3(c.r, c.g, c.b);
};

export function seasonUniforms(lit: LitLike, colors: TreeColors): Record<string, { value: unknown }> {
  const three3 = (list: readonly string[]): Vector3Like[] => [0, 1, 2].map((i) => linear(lit, list[i % list.length]));
  return {
    uTime: { value: 0 },
    uWind: { value: 0 },
    uYear: { value: { x: 1, y: 0, z: 0, w: 0 } },
    uYear2: { value: { x: 0, y: 0, z: 2, w: 0 } },
    uLeafCol: { value: three3(colors.leaves) },
    uSpring: { value: three3(colors.spring) },
    uAutumn: { value: three3(colors.autumn) },
    uBloom: { value: linear(lit, colors.spring[1]) },
    uLod: { value: { x: 0, y: 0, z: 0, w: 0 } },
    uLodIn: { value: { x: 0, y: 0 } },
  };
}

/** A standard material that keeps the season on the GPU, sways, and dithers out by distance and near the lens. */
export function forestMaterial(
  lit: LitLike,
  uniforms: Record<string, { value: unknown }>,
  card: boolean,
): MaterialLike {
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

export function setYear(
  uniforms: Record<string, { value: unknown }>,
  year: YearLike,
  model: TreeModelLike,
  colors: TreeColors,
): void {
  const y = uniforms.uYear?.value as Vector4Like;
  const y2 = uniforms.uYear2?.value as Vector4Like;
  y.x = year.leaf;
  y.y = year.color;
  y.z = colors.blossom === true ? 0 : year.flush;
  y.w = year.drop;
  const bloom = colors.blossom === true && model.species.flower ? clamp(year.bloom - year.petals, 0, 1) * 0.75 : 0;
  y2.x = year.withered ? 1 : 0;
  y2.y = bloom;
  y2.z = model.species.evergreen ? model.species.phenology.dropMax * 1.4 : 2;
}
