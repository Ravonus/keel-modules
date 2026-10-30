/**
 * Trees as objects. The tree-growth module grows a branch graph; this module
 * draws it with KEEL's lit renderer (keel/lit): wood with surface roots, leaf blades that grow from
 * their twigs and flutter, flowers and fruit that open, ripen and fall, litter
 * under the crown, snow along the limbs, and the leaves and petals falling in
 * between. One wind field bends wood, leaves and fruit together, so nothing
 * comes apart at a joint. MIT.
 *
 * Every part has a switch (`roots`, `leaves`, `flowers`, `fruit`, `deadwood`,
 * `litter`, `snow`, `fallers`, `sway`, `shadows`, `crownShade`, `bark`), set in
 * code or from a plugin string such as "-roots,-litter". Three more switch the
 * pixel-scale looks: `sprays` (blossoms open as a few big two-tone sprays per
 * twig, not a speckle of tiny flowers), `clumps` (a twig's leaves share one
 * tone, so the crown reads as lit and shaded masses) and `rootSink` (roots
 * dive under the soil where they thin out or leave the inner planter). A host decides the
 * ground: open soil, or a planter whose lip and wall the roots climb over.
 * `rootBreak` lets an old tree's big roots heave the soil, crack the rim and
 * now and then burst out through the planter's side.
 *
 * The same pieces draw a whole forest in the background (createForest): each
 * tree variant is cut into levels of detail that keep their season on the GPU,
 * each instanced many times and built only when a tree reaches its distance,
 * ending in impostor cards baked from it (a sprite ladder), with a dither
 * dissolve near the lens.
 *
 *   const tree = createTreeRender(lit, model, { colors, ground: { y: 0, radius: 4.4 } });
 *   scene.add(tree.group);
 *   // every frame:
 *   tree.update(treeFrame(model, cycle), yearState(...), { elapsed, delta, wind });
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

// ---------------------------------------------------------------- the tree-growth data it reads

/** Leaf, flower or fruit places on a grown tree. */
export interface SlotsLike {
  readonly count: number;
  readonly node: ArrayLike<number>;
  readonly dx: ArrayLike<number>;
  readonly dy: ArrayLike<number>;
  readonly dz: ArrayLike<number>;
  readonly rank: ArrayLike<number>;
  readonly size: ArrayLike<number>;
  readonly tone: ArrayLike<number>;
}

export interface OrnamentSpecLike {
  readonly kind: string;
  readonly on: "spur" | "tip";
  readonly from: number;
}

export interface TreeModelLike {
  readonly count: number;
  readonly birth: ArrayLike<number>;
  readonly phase: ArrayLike<number>;
  readonly leaves: SlotsLike;
  readonly blossoms: SlotsLike;
  readonly fruit: SlotsLike;
  readonly roots: readonly { readonly angle: number; readonly reach: number }[];
  /** Each internode's parent (-1 for the root) and branch order (0 for the trunk): palms need them to lay out their fronds. */
  readonly parent?: ArrayLike<number>;
  readonly order?: ArrayLike<number>;
  readonly species: {
    readonly id: string;
    /** Set for palms, whose leaves are the leaflets of their fronds. */
    readonly palm?: unknown;
    readonly evergreen: boolean;
    readonly flower: OrnamentSpecLike | null;
    readonly fruit: OrnamentSpecLike | null;
    readonly phenology: { readonly dropMax: number };
  };
}

export interface TreeFrameLike {
  readonly cycle: number;
  readonly grow: ArrayLike<number>;
  readonly radius: ArrayLike<number>;
  readonly dead: ArrayLike<number>;
  readonly fall: ArrayLike<number>;
  readonly rot: ArrayLike<number>;
  readonly tips: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  readonly baseX: ArrayLike<number>;
  readonly baseY: ArrayLike<number>;
  readonly baseZ: ArrayLike<number>;
  readonly visible: number;
  readonly height: number;
  /** How much bigger than life a grand tree has grown (tree-growth's `grand` frames); leaf clumps grow with it. */
  readonly scale?: number;
}

export interface YearLike {
  readonly bloom: number;
  readonly petals: number;
  readonly fruit: number;
  readonly fruitDrop: number;
  readonly withered: boolean;
  readonly leaf: number;
  readonly color: number;
  readonly drop: number;
  readonly litter: number;
  readonly flush: number;
}

/** The species' colours: three of each, darkest first. */
export interface TreeColors {
  readonly trunk: readonly string[];
  readonly leaves: readonly string[];
  readonly spring: readonly string[];
  readonly autumn: readonly string[];
  /** Leaf size in world units. */
  readonly leafScale: number;
  /** Spring is blossom (cherry): new leaves flush pale, not pink. */
  readonly blossom?: boolean;
}

/**
 * Where the tree stands. `radius` bounds litter and fallers. A planter passes
 * `lip` (its top's reach at each angle) and `wall` so roots roll over the edge
 * and creep down; `surface` lets them follow a carved wall.
 */
export interface TreeGround {
  readonly y: number;
  readonly radius: number;
  /** Longest a surface root may run (defaults to `radius`). */
  readonly rootReach?: number;
  readonly lip?: (angle: number) => number;
  readonly wall?: { readonly depth: number; readonly flare: number };
  readonly surface?: (angle: number, y: number) => number;
  /**
   * The planter itself, for the chunks an old tree's roots break out of it
   * (`rootBreak`). `colors` are its stone, darkest first (left out, a
   * weathered grey); `hard` keeps roots from bursting its side (metal, gems:
   * they only crack the rim; left out, a wall roots do not creep down, depth
   * under half a unit, counts as hard); `hang` is how far below the wall's
   * foot a burst root may dangle free (left out, a little more than the wall's depth).
   */
  readonly planter?: { readonly colors?: readonly string[]; readonly hard?: boolean; readonly hang?: number };
}

/** A material skin: the crown takes these colours instead of the species' own. */
export interface TreeSkin {
  readonly leaves: readonly string[];
  readonly leafSize?: number;
}

/**
 * Another strain in a hybrid or chimera tree: the limbs `strainOf` gives it
 * take these colours and this skin instead of the tree's own. `colors` left
 * out keeps the tree's; `skin` left out keeps the tree's skin, `null` drops it
 * (a natural limb on a crystal tree).
 */
export interface TreeStrain {
  readonly colors?: TreeColors;
  readonly skin?: TreeSkin | null;
  /** False when the strain's own kind would not flower or fruit like the tree (an oak limb on a cherry stays green in blossom time). */
  readonly bears?: boolean;
  /** Bark colours for the strain's wood, darkest first (a skin's own bark); left out, the strain's `colors.trunk`. */
  readonly bark?: readonly string[];
  /** The strain's own kind: a broadleaf limb on a conifer keeps broad leaves, not needles. */
  readonly species?: string;
  /** Its leaves hang in strands this long below the twig, world units (a willow's limbs weep on any tree). */
  readonly hang?: number;
}

/** A hybrid's minor kind's own flowers and fruit, hanging on its limbs (tree-growth `kindOrnaments`). */
export interface TreeKindOrnaments {
  /** The kind's species id, for the look of its flowers and fruit. */
  readonly species: string;
  /** The strain whose year (`TreeMotion.strainYears`) opens and drops them. */
  readonly strain: number;
  readonly flower?: { readonly spec: OrnamentSpecLike; readonly slots: SlotsLike } | null;
  readonly fruit?: { readonly spec: OrnamentSpecLike; readonly slots: SlotsLike } | null;
}

/** One blossom colour in a mixed bloom: this share of the flowers opens in these colours. */
export interface TreeBloom {
  readonly colors: readonly string[];
  readonly share: number;
}

// ---------------------------------------------------------------- the parts of keel/lit used

interface ColorLike {
  r: number; g: number; b: number;
  set(value: string | number): ColorLike;
  setRGB(r: number, g: number, b: number): ColorLike;
  copy(color: ColorLike): ColorLike;
  lerp(color: ColorLike, t: number): ColorLike;
  multiplyScalar(s: number): ColorLike;
  offsetHSL(h: number, s: number, l: number): ColorLike;
  getHexString(): string;
}
interface AttributeLike { readonly count: number; readonly array: Float32Array; needsUpdate: boolean; readonly itemSize: number }
export interface GeometryLike {
  readonly index?: unknown;
  readonly attributes: Readonly<Record<string, AttributeLike | undefined>>;
  setAttribute(name: string, attribute: unknown): GeometryLike;
  computeVertexNormals(): void;
  toNonIndexed(): GeometryLike;
  translate(x: number, y: number, z: number): GeometryLike;
  scale(x: number, y: number, z: number): GeometryLike;
  dispose(): void;
}
interface ShaderLike { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }
export interface MaterialLike {
  dispose(): void;
  onCompile: (shader: ShaderLike) => void;
  customProgramCacheKey: () => string;
  userData: Record<string, unknown>;
  color: ColorLike;
  needsUpdate: boolean;
}
interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector3Like }
interface NodeLike {
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  renderOrder: number;
  position: Vector3Like;
  userData: Record<string, unknown>;
  add(...objects: unknown[]): void;
  remove(...objects: unknown[]): void;
}
export interface InstancedLike extends NodeLike {
  count: number;
  geometry: GeometryLike;
  material: MaterialLike;
  readonly instanceMatrix: { readonly array: Float32Array; needsUpdate: boolean; setUsage(usage: unknown): void };
  instanceColor: { needsUpdate: boolean } | null;
  setColorAt(index: number, color: ColorLike): void;
  dispose(): void;
}
interface MeshLike extends NodeLike { geometry: GeometryLike; material: MaterialLike }

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => MeshLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancedLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array, itemSize: number) => AttributeLike;
  readonly InstanceAttribute: new (array: Float32Array, itemSize: number) => AttributeLike;
  box(x: number, y: number, z: number): GeometryLike;
  cylinder(top: number, bottom: number, height: number, radial: number, rows: number): GeometryLike;
  icosahedron(radius: number, detail: number): GeometryLike;
  plane(width: number, height: number): GeometryLike;
  readonly LitMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Color: new (value?: string) => ColorLike;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
}

// ---------------------------------------------------------------- switches

export const TREE_FEATURES = ["roots", "leaves", "flowers", "fruit", "deadwood", "litter", "snow", "fallers", "sway", "shadows", "crownShade", "bark", "sprays", "clumps", "rootSink", "rootBreak"] as const;
export type TreeFeature = (typeof TREE_FEATURES)[number];
export type TreeFeatures = Readonly<Record<TreeFeature, boolean>>;

const isFeature = (name: string): name is TreeFeature => (TREE_FEATURES as readonly string[]).includes(name);

/**
 * Feature switches, all on by default. Pass an object ({ roots: false }) or a
 * plugin string: "-roots,-fruit" turns those off, "roots=off" too, and a bare
 * name or "name=on" turns one back on. Unknown names are ignored.
 */
export function treeFeatures(input: Partial<Record<TreeFeature, boolean>> | string = {}): TreeFeatures {
  const out = Object.fromEntries(TREE_FEATURES.map((name) => [name, true])) as Record<TreeFeature, boolean>;
  if (typeof input !== "string") {
    for (const name of TREE_FEATURES) out[name] = input[name] ?? true;
    return out;
  }
  for (const raw of input.split(/[,\s]+/)) {
    const [word = "", value] = raw.trim().split("=");
    const off = word.startsWith("-") || value === "off" || value === "0" || value === "false";
    const name = word.replace(/^[-+]/, "");
    if (isFeature(name)) out[name] = !off;
  }
  return out;
}

// ---------------------------------------------------------------- small math

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A stable 32-bit hash. */
export function hash32(value: number): number {
  let result = value >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x21f0aaad);
  result = Math.imul(result ^ (result >>> 15), 0x735a2d97);
  return (result ^ (result >>> 15)) >>> 0;
}

/** A small seeded stream (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- wind

export interface Offset { x: number; z: number }

/** The breeze at a moment: how hard it blows (0 is dead calm), and the way it blows toward, in radians from +x toward +z. */
export interface Breeze { readonly wind: number; readonly dir: number }

/**
 * A breeze that lives: it freshens and slackens over a minute or two, its
 * direction wanders slowly about the way it prevails, and now and then
 * (rarely) it dies away to nothing for a while. `base` is the weather's
 * usual strength; the same seed and time always give the same breeze.
 */
export function breezeAt(elapsed: number, base: number, seed = 0): Breeze {
  const s = (seed % 9973) * 0.731;
  const t = elapsed;
  // Freshening and slackening: mostly between half and all of the weather's strength.
  const mood = 0.5 + 0.5 * (0.6 * Math.sin(t * 0.047 + s) + 0.4 * Math.sin(t * 0.113 + s * 1.7));
  // A dead calm comes only when two slow swells line up, a few minutes in an hour.
  const still = Math.sin(t * 0.0093 + s * 2.3) * Math.sin(t * 0.0151 + s * 3.1);
  const calm = 1 - smoothstep(0.72, 0.86, still);
  const wind = Math.max(0, base * (0.35 + 0.75 * mood) * calm);
  const dir = (s % TAU) + 0.45 * Math.sin(t * 0.013 + s) + 0.2 * Math.sin(t * 0.041 + s * 0.6);
  return { wind, dir };
}

/** How strongly a gust is passing over a point `along` the wind, at a time. */
const gustAt = (elapsed: number, along: number): number => {
  const front = elapsed * 0.5 - along * 0.22;
  return Math.max(0, Math.sin(front) * Math.sin(front * 0.43 + 1.7)) ** 2;
};

/**
 * Wind bends the tree as one smooth field over space, so a joint moves exactly
 * as both internodes that meet there: the branches flex and never come apart.
 * The crown leans downwind, more as each gust rolls through from upwind and
 * eases back after it; limbs far from the trunk give a little more. In still
 * air it only breathes.
 */
export function sway(out: Offset, x: number, y: number, z: number, elapsed: number, wind: number, height: number, dir = 0): Offset {
  const reach = clamp(y / Math.max(height, 1), 0, 1.4);
  const spread = Math.min(Math.hypot(x, z) / Math.max(height * 0.5, 0.5), 1.5);
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const along = x * dx + z * dz;
  const gust = gustAt(elapsed, along);
  // The lean: always downwind, steady with the breeze and swelling with the gust.
  const lean = wind * (0.5 + 1.0 * gust) * reach * reach * 0.3 * (1 + 0.15 * Math.sin(elapsed * 0.9 + along * 0.4));
  // Small give in the outer twigs, quick and short, mostly along the wind.
  const flick = (wind * 0.022 + 0.003) * reach * (0.3 + spread) * (Math.sin(elapsed * 2.2 + x * 2.1 + y * 1.3) * (0.4 + gust) + 0.5 * gust);
  const across = flick * 0.35 * Math.cos(elapsed * 1.7 + z * 1.9 + y);
  const idle = 0.014 * reach * (Math.sin(elapsed * 0.6 + y * 0.3) + 0.6 * Math.sin(elapsed * 0.97 + 2.1)) * (1 - Math.min(1, wind * 3) * 0.5);
  const downwind = lean + flick;
  out.x = dx * downwind - dz * across + idle;
  out.z = dz * downwind + dx * across + idle * 0.7 * Math.cos(elapsed * 0.83 + x * 0.4);
  return out;
}

export interface Flutter { readonly droop: number; readonly twist: number; readonly nod: number }

/**
 * How a leaf moves on its own, in radians. In still air it barely stirs; a
 * breeze sets it trembling a little, and a passing gust lifts and flips it to
 * show the paler underside before it settles back.
 */
export function leafFlutter(elapsed: number, wind: number, rank: number, phase: number, along = phase * 2.1): Flutter {
  const idle = 0.035 * Math.sin(elapsed * 0.8 + rank * 31) + 0.02 * Math.sin(elapsed * 1.9 + rank * 57);
  const gust = gustAt(elapsed, along);
  const tremble = wind * (0.12 + 0.45 * gust) * Math.sin(elapsed * (6 + rank * 4) + rank * 40);
  const flip = wind * gust * 1.6 * (0.6 + 0.4 * Math.sin(elapsed * 1.6 + rank * 19));
  return { droop: 0.35 + 0.25 * rank + idle - flip * 0.3, twist: rank * TAU * 0.25 + tremble * 0.8 + flip, nod: idle * 1.5 + tremble * 0.35 };
}

// ---------------------------------------------------------------- instance matrices (column-major, written in place)

function writeColumns(array: Float32Array, index: number, columns: readonly number[]): void {
  const offset = index * 16;
  for (let i = 0; i < 12; i += 1) array[offset + i] = columns[i] ?? 0;
  array[offset + 15] = 1;
}

function writeOrigin(array: Float32Array, index: number, x: number, y: number, z: number): void {
  const offset = index * 16;
  array[offset + 12] = x; array[offset + 13] = y; array[offset + 14] = z; array[offset + 15] = 1;
}

/** Hides one instance far below the scene, scaled to nothing. */
export function clearSlot(array: Float32Array, index: number): void {
  array.fill(0, index * 16, index * 16 + 16);
  array[index * 16 + 13] = -50;
  array[index * 16 + 15] = 1;
}

/** A box turned `yaw` about up, scaled (sx, sy, sz). */
export function writeBox(array: Float32Array, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  writeColumns(array, index, [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0]);
  writeOrigin(array, index, x, y, z);
}

/** A cube `size` wide, flattened by `flat`, turned `yaw`. */
export function writeVoxel(array: Float32Array, index: number, x: number, y: number, z: number, size: number, yaw: number, flat = 1): void {
  writeBox(array, index, x, y, z, size, size * flat, size, yaw);
}

/** One wood piece from a to b, `radius` thick, overlapping its joints. Rotation is the shortest arc from up, so bark never swims. */
export function writeSegment(array: Float32Array, index: number, a: readonly [number, number, number], b: readonly [number, number, number], radius: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-5 || radius <= 0) { clearSlot(array, index); return; }
  const ax = dx / length, ay = dy / length, az = dz / length;
  const thick = Math.max(radius * 2, 0.045);
  const long = length + thick * 0.5;
  if (ay < -0.9999) {
    writeColumns(array, index, [thick, 0, 0, 0, 0, -long, 0, 0, 0, 0, -thick, 0]);
  } else {
    const f = 1 / (1 + ay);
    writeColumns(array, index, [
      (1 - ax * ax * f) * thick, -ax * thick, -ax * az * f * thick, 0,
      ax * long, ay * long, az * long, 0,
      -ax * az * f * thick, -az * thick, (1 - az * az * f) * thick, 0,
    ]);
  }
  writeOrigin(array, index, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

const UP: readonly [number, number, number] = [0, 1, 0];
const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return l > 1e-6 ? [x / l, y / l, z / l] : [0, 0, 0];
};
type V3 = readonly [number, number, number];
const cross3 = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isZero = (v: V3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

/** One leaf blade at its stalk, pointing along (nx, ny, nz), drooped, twisted and nodded by `motion`; `long` draws it that much longer than wide. */
export function writeBlade(array: Float32Array, index: number, p: V3, n: V3, size: number, motion: Flutter, long = 1): void {
  // Leaves droop from their heading toward the ground, more so the heavier the rank. Scalar
  // locals throughout: this runs for every leaf every frame, so it allocates nothing.
  let yx = n[0], yy = n[1] - motion.droop, yz = n[2];
  let l2 = Math.hypot(yx, yy, yz);
  if (l2 > 1e-6) { yx /= l2; yy /= l2; yz /= l2; } else { yx = 0; yy = 1; yz = 0; }
  // x = up × y, normalised.
  let xx = yz, xz = -yx;
  l2 = Math.hypot(xx, xz);
  if (l2 > 1e-6) { xx /= l2; xz /= l2; } else { xx = 1; xz = 0; }
  // z = x × y (x has no y part), normalised.
  let zx = -xz * yy, zy = xz * yx - xx * yz, zz = xx * yy;
  l2 = Math.hypot(zx, zy, zz);
  if (l2 > 1e-6) { zx /= l2; zy /= l2; zz /= l2; } else { zx = 0; zy = 0; zz = 0; }
  const c = Math.cos(motion.twist);
  const s = Math.sin(motion.twist);
  const w = size * 1.05;
  const l = size * long * (1 + motion.nod * 0.15);
  const o = index * 16;
  array[o] = (xx * c + zx * s) * w; array[o + 1] = zy * s * w; array[o + 2] = (xz * c + zz * s) * w; array[o + 3] = 0;
  array[o + 4] = yx * l; array[o + 5] = yy * l; array[o + 6] = yz * l; array[o + 7] = 0;
  array[o + 8] = (zx * c - xx * s) * w; array[o + 9] = zy * c * w; array[o + 10] = (zz * c - xz * s) * w; array[o + 11] = 0;
  array[o + 12] = p[0]; array[o + 13] = p[1]; array[o + 14] = p[2]; array[o + 15] = 1;
}

// ---------------------------------------------------------------- shapes

/** A slim pointed leaf, stalk at the origin and tip up +Y, as [half-width, height] pairs. */
export const LEAF_OUTLINE: readonly (readonly [number, number])[] = [[0, 0], [0.09, 0.07], [0.18, 0.26], [0.21, 0.48], [0.17, 0.7], [0.09, 0.9], [0.02, 1.06], [0, 1.16]];

/**
 * A leaf blade folded along a pale midrib with darker margins, so even a few
 * pixels read as a leaf and not a dot. Colours are baked as vertex colours.
 */
export function bladeGeometry(lit: LitLike, outline: readonly (readonly [number, number])[] = LEAF_OUTLINE, fold = 0.1, bend = 0): GeometryLike {
  return bladeFrom(lit, outline, fold, bend, CRISP_BLADE);
}

/** A blade's tone: its midrib's brightness, how much darker its margin and its foot go. */
type BladeTone = readonly [mid: number, margin: number, foot: number];
const CRISP_BLADE: BladeTone = [1.22, 0.5, 0.18];
/**
 * Soft blades (the `clumps` look) keep the midrib but drop most of the margin's
 * darkening: at a pixel or two per leaf that contrast only reads as speckle.
 */
const SOFT_BLADE: BladeTone = [1.08, 0.2, 0.08];

/** The broad leaf blade with a soft margin (the `clumps` look). */
export function softBladeGeometry(lit: LitLike): GeometryLike {
  return bladeFrom(lit, LEAF_OUTLINE, 0.1, 0, SOFT_BLADE);
}

function bladeFrom(lit: LitLike, outline: readonly (readonly [number, number])[], fold: number, bend: number, [mid, margin, foot]: BladeTone): GeometryLike {
  const widest = Math.max(...outline.map(([x]) => x));
  const positions: number[] = [];
  const colors: number[] = [];
  const tone = (x: number, y: number): number[] => {
    const edge = Math.abs(x) / widest;
    const shade = mid - margin * edge - foot * smoothstep(0.25, 0, y);
    return [shade, shade * (1 + 0.04 * (1 - edge)), shade];
  };
  for (let index = 0; index < outline.length - 1; index += 1) {
    const [x0, y0] = outline[index] ?? [0, 0];
    const [x1, y1] = outline[index + 1] ?? [0, 0];
    for (const side of [-1, 1]) {
      // `bend` arches the blade along its length, its tip dropping away from its face.
      const a = [0, y0, bend * y0 * y0], d = [0, y1, bend * y1 * y1];
      const b = [side * x0, y0, (fold * x0) / widest + bend * y0 * y0];
      const c = [side * x1, y1, (fold * x1) / widest + bend * y1 * y1];
      const quad = side > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
      for (const point of quad) {
        positions.push(...point);
        colors.push(...tone(point[0] ?? 0, point[1] ?? 0));
      }
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface TreeShapes {
  readonly wood: GeometryLike;
  readonly leaf: GeometryLike;
  readonly blade: GeometryLike;
  readonly bud: GeometryLike;
  readonly box: GeometryLike;
  /** The broad blade with a soft margin (the `clumps` look). */
  readonly softBlade: GeometryLike;
  /** A blossom spray: a few round flower heads in a puff, lit on top and rose in its own shade (the `sprays` look). */
  readonly spray: GeometryLike;
}

/** Each head of a spray: centre (x, y, z) and radius, in a unit about one flower head across. */
const SPRAY_HEADS = [[0, 0.2, 0, 0.56], [0.5, -0.08, 0.12, 0.46], [-0.34, -0.04, 0.4, 0.44], [-0.16, -0.12, -0.46, 0.45], [0.12, -0.42, 0.04, 0.36]];

/**
 * A spray of blossom as one shape: a few flower heads bunched round the twig.
 * Vertex colours carry two tones so the spray reads at a few pixels: the tops
 * of the heads catch the light near white, the undersides sink to a deeper,
 * rosier shade of the petal colour (red holds, green and blue drop).
 */
export function sprayGeometry(lit: LitLike): GeometryLike {
  const positions: number[] = [];
  const colors: number[] = [];
  // keel/lit's icosahedron is non-indexed: three corners per face.
  // (Never drawn, so it holds no GPU buffer to dispose.)
  const corners = lit.icosahedron(1, 0).attributes.position?.array ?? new Float32Array(0);
  const h = (index: number): number => corners[index] ?? 0;
  for (const [cx = 0, cy = 0, cz = 0, r = 0.5] of SPRAY_HEADS) {
    for (let face = 0; face + 8 < corners.length; face += 9) {
      // A face's tone follows how far up it faces and how high the head sits in the spray.
      const light = clamp(0.5 + ((h(face + 1) + h(face + 4) + h(face + 7)) / 3) * 0.55 + cy * 0.6, 0, 1);
      const k = 0.74 + 0.34 * light;
      for (let corner = face; corner < face + 9; corner += 3) {
        positions.push(cx + h(corner) * r, cy + h(corner + 1) * r, cz + h(corner + 2) * r);
        colors.push(k, k * (0.8 + 0.2 * light), k * (0.88 + 0.12 * light));
      }
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function needleStrip(positions: number[], colors: number[], from: V3, to: V3, across: V3, width: number, tone: (t: number) => V3, bend = 0): void {
  // A needle keeps its width to near the end, then closes to a sharp point.
  const stops = bend > 0 ? [0, 0.45, 0.8, 1] : [0, 0.8, 1];
  const point = (t: number): [number, number, number] => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - bend * t * t, from[2] + (to[2] - from[2]) * t];
  const span = (t: number): number => width * (t <= 0.8 ? 1 : 0.06);
  for (let index = 0; index < stops.length - 1; index += 1) {
    const t0 = stops[index] ?? 0, t1 = stops[index + 1] ?? 1;
    const p0 = point(t0), p1 = point(t1);
    const w0 = span(t0), w1 = span(t1);
    const a: V3 = [p0[0] - across[0] * w0, p0[1] - across[1] * w0, p0[2] - across[2] * w0];
    const b: V3 = [p0[0] + across[0] * w0, p0[1] + across[1] * w0, p0[2] + across[2] * w0];
    const c: V3 = [p1[0] + across[0] * w1, p1[1] + across[1] * w1, p1[2] + across[2] * w1];
    const d: V3 = [p1[0] - across[0] * w1, p1[1] - across[1] * w1, p1[2] - across[2] * w1];
    for (const [q, t] of [[a, t0], [b, t0], [c, t1], [a, t0], [c, t1], [d, t1]] as const) {
      positions.push(...q);
      colors.push(...tone(t));
    }
  }
}

/** One needle, round from every side: two thin strips crossed along its length. */
function needle(positions: number[], colors: number[], from: V3, to: V3, width: number, tone: (t: number) => V3, bend = 0): void {
  const along = norm3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  let across: V3 = norm3(...cross3(along, UP));
  if (isZero(across)) across = [1, 0, 0];
  const other = norm3(...cross3(along, across));
  needleStrip(positions, colors, from, to, across, width, tone, bend);
  needleStrip(positions, colors, from, to, other, width, tone, bend);
}

/** A conifer's needle sprig. */
export type NeedleKind = "pine" | "spruce" | "redwood";

/**
 * A conifer sprig for the forest: the same shoot and the same sweep of needles,
 * each one flat and wider, so `count` of them hold the sprig's mass for a tenth
 * of its triangles.
 */
export function lightSprig(lit: LitLike, kind: string, count: number): GeometryLike {
  const positions: number[] = [];
  const colors: number[] = [];
  const shade = (t: number): V3 => { const v = 0.8 + 0.34 * t; return [v, v, v]; };
  const twig = (): V3 => [0.62, 0.6, 0.58];
  const pine = kind === "pine", out = pine ? 0.32 : 0.24, rise = pine ? 0.62 : 0.3;
  const width = (pine ? 0.075 : 0.1) * Math.sqrt(10 / count);
  needleStrip(positions, colors, [0, 0, 0], [0, 1, 0], [1, 0, 0], 0.025, twig);
  for (let index = 0; index < count; index += 1) {
    const t = 0.06 + (index / count) * 0.84, angle = index * 2.39996;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    needleStrip(positions, colors, [0, t, 0], [dx * out, t + rise, dz * out], [-dz, 0.1, dx], width, shade);
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The needles of one conifer sprig. */
export function needleGeometry(lit: LitLike, kind: NeedleKind): GeometryLike {
  const positions: number[] = [];
  const colors: number[] = [];
  const grey = (low: number, high: number) => (t: number): V3 => { const v = low + (high - low) * t; return [v, v, v]; };
  // The shoot itself, a thin brown-dark line the needles grow from.
  const twig = (length: number, tone: V3 = [0.62, 0.6, 0.58]): void => {
    needleStrip(positions, colors, [0, 0, 0], [0, length, 0], [1, 0, 0], 0.02, () => tone);
    needleStrip(positions, colors, [0, 0, 0], [0, length, 0], [0, 0, 1], 0.02, () => tone);
  };
  if (kind === "pine") {
    // A shoot lined with bundles of long needles swept forward, a tuft at its tip.
    twig(1.0);
    for (let bundle = 0; bundle < 5; bundle += 1) {
      const t = 0.12 + bundle * 0.2;
      for (let index = 0; index < 3; index += 1) {
        const angle = bundle * 2.39996 + (index / 3) * TAU;
        const out = 0.3 + 0.05 * index;
        const tip: V3 = [Math.cos(angle) * out, t + 0.62, Math.sin(angle) * out];
        needle(positions, colors, [0, t, 0], tip, 0.014, grey(0.78, 1.16), 0.06);
      }
    }
  } else if (kind === "spruce") {
    // A brown shoot bristling with short stiff needles all round, ending in a
    // star of needles round a tan bud, as on a blue spruce's branch tips.
    twig(1.0, [0.78, 0.52, 0.36]);
    const wax = (s: number): V3 => [0.78 + 0.24 * s, 0.82 + 0.24 * s, 0.84 + 0.26 * s];
    const count = 30;
    for (let index = 0; index < count; index += 1) {
      const t = 0.04 + (index / count) * 0.86;
      const angle = index * 2.39996;
      const out = 0.24;
      const tip: V3 = [Math.cos(angle) * out, t + 0.2, Math.sin(angle) * out];
      needle(positions, colors, [0, t, 0], tip, 0.016, wax);
    }
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * TAU + 0.2;
      const lift = index % 2 === 0 ? 0.24 : 0.08;
      const tip: V3 = [Math.cos(angle) * 0.24, 1.0 + lift, Math.sin(angle) * 0.24];
      needle(positions, colors, [0, 0.96, 0], tip, 0.016, wax);
    }
    needleStrip(positions, colors, [0, 0.94, 0], [0, 1.08, 0], [1, 0, 0], 0.05, () => [1.25, 0.95, 0.62]);
    needleStrip(positions, colors, [0, 0.94, 0], [0, 1.08, 0], [0, 0, 1], 0.05, () => [1.25, 0.95, 0.62]);
  } else {
    twig(1.1);
    const pairs = 9;
    for (let index = 0; index < pairs; index += 1) {
      const t = 0.08 + (index / pairs) * 0.92;
      const out = 0.24 * Math.sin(Math.PI * (0.2 + 0.8 * (1 - t))) + 0.06;
      for (const side of [-1, 1])
        needleStrip(positions, colors, [0, t, 0], [side * out, t + out * 0.35, 0], [0, 0.4, 1], 0.035, grey(0.8, 1.12));
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

const NEEDLE_KINDS: Readonly<Record<string, NeedleKind>> = { pine: "pine", spruce: "spruce", redwood: "redwood" };
const needleCache = new WeakMap<LitLike, Map<NeedleKind, GeometryLike>>();

/** A palm leaflet: a long narrow strap, slim at its base, tapering to a point. */
export const PALM_LEAFLET: readonly (readonly [number, number])[] = [[0, 0], [0.012, 0.04], [0.026, 0.18], [0.03, 0.4], [0.027, 0.62], [0.018, 0.82], [0.008, 0.94], [0, 1]];
const palmCache = new WeakMap<LitLike, GeometryLike>();

/** The blade a species grows: needles for the conifers, arched straps for a palm, the broad leaf for everything else. */
export function speciesBlade(lit: LitLike, speciesId: string): GeometryLike {
  if (speciesId === "palm") {
    let strap = palmCache.get(lit);
    if (!strap) palmCache.set(lit, (strap = bladeGeometry(lit, PALM_LEAFLET, 0.014, 0.24)));
    return strap;
  }
  const kind = NEEDLE_KINDS[speciesId];
  if (!kind) return treeShapes(lit).blade;
  let cache = needleCache.get(lit);
  if (!cache) needleCache.set(lit, (cache = new Map<NeedleKind, GeometryLike>()));
  let geometry = cache.get(kind);
  if (!geometry) cache.set(kind, (geometry = needleGeometry(lit, kind)));
  return geometry;
}

const shapeCache = new WeakMap<LitLike, TreeShapes>();

/** The shared shapes, made once per keel/lit namespace: round wood, low-poly leaf lumps, blades, buds and a unit box. */
export function treeShapes(lit: LitLike): TreeShapes {
  let shapes = shapeCache.get(lit);
  if (!shapes) {
    shapes = {
      wood: lit.cylinder(0.5, 0.5, 1, 7, 1),
      leaf: lit.icosahedron(0.56, 0),
      blade: bladeGeometry(lit),
      bud: lit.icosahedron(0.55, 1),
      box: lit.box(1, 1, 1),
      softBlade: softBladeGeometry(lit),
      spray: sprayGeometry(lit),
    };
    shapeCache.set(lit, shapes);
  }
  return shapes;
}

// ---------------------------------------------------------------- bark

// Living bark, drawn round each branch rather than painted flat: vertical
// fissures between raised plates, lichen flecks, the odd knot, and moss low on
// the trunk's upper faces. Each branch keeps its own colour; the bark only
// works light and dark into it. Coordinates run round the branch in world
// units, so texture density holds on twig and trunk.
const BARK_VERTEX = /* glsl */ `
varying vec3 vBark;
varying vec3 vBarkWorld;
varying float vBarkUp;
`;
const BARK_FRAGMENT = /* glsl */ `
varying vec3 vBark;
varying vec3 vBarkWorld;
varying float vBarkUp;
float barkHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float barkNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(barkHash(i), barkHash(i + vec3(1, 0, 0)), f.x), mix(barkHash(i + vec3(0, 1, 0)), barkHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(barkHash(i + vec3(0, 0, 1)), barkHash(i + vec3(1, 0, 1)), f.x), mix(barkHash(i + vec3(0, 1, 1)), barkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 barkSurface(vec3 base) {
  vec3 p = vec3(vBark.xy * 3.2, vBark.z * 0.7);
  float ridge = barkNoise(p) * 0.65 + barkNoise(p * 2.1 + 7.0) * 0.35;
  float fissure = 1.0 - smoothstep(0.03, 0.11, abs(ridge - 0.5));
  float plate = barkNoise(vec3(vBark.xy * 1.6, vBark.z * 0.35) + 3.0);
  vec3 c = base * (1.0 + 0.5 * plate) * 1.15;
  c += base * 0.45 * smoothstep(0.62, 0.82, ridge);
  c *= 1.0 - 0.65 * fissure;
  float fleck = step(0.94, barkHash(floor(vec3(vBark.xy * 9.0, vBark.z * 7.0))));
  c = mix(c, mix(base, vec3(0.72, 0.76, 0.62), 0.65), fleck * 0.55);
  float knot = smoothstep(0.88, 0.95, barkNoise(vec3(vBark.xy * 0.9, vBark.z * 0.5) + 11.0));
  c *= 1.0 - 0.45 * knot;
  float moss = smoothstep(1.6, 0.4, vBarkWorld.y - uBarkGround) * smoothstep(0.45, 0.65, barkNoise(vBarkWorld * 2.2));
#ifdef BARK_UPRIGHT_MOSS
  // Moss climbs the upright trunk foot, not the roots lying along the soil (green hairlines on a planter).
  moss *= smoothstep(0.35, 0.75, vBarkUp);
#endif
#ifdef BARK_BARE_WALL
  // Below the soil line the wood is a root on the planter's wall: bare bark, not a green vine.
  moss *= smoothstep(uBarkGround - 0.3, uBarkGround + 0.05, vBarkWorld.y);
#endif
  return mix(c, vec3(0.33, 0.46, 0.2) * (0.8 + 0.4 * plate), moss * 0.85);
}
`;
const BARK_BEGIN = /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  float barkRadius = length(instanceMatrix[0].xyz);
  vec4 barkWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 barkAxis = normalize(instanceMatrix[1].xyz);
#else
  float barkRadius = 1.0;
  vec4 barkWorld = modelMatrix * vec4(position, 1.0);
  vec3 barkAxis = vec3(0.0, 1.0, 0.0);
#endif
  float barkAngle = atan(position.z, position.x);
  vBark = vec3(cos(barkAngle) * barkRadius, sin(barkAngle) * barkRadius, dot(barkWorld.xyz, barkAxis));
  vBarkWorld = barkWorld.xyz;
  vBarkUp = abs(barkAxis.y);`;

/** A standard material whose instances carry living bark. `ground` is the world y where moss gathers; `bareWall` keeps moss off roots below it (on a planter wall). */
export function barkMaterial(lit: LitLike, ground = 0, uprightMoss = false, bareWall = false): MaterialLike {
  const material = new lit.LitMaterial({ color: "#ffffff", roughness: 0.92, metalness: 0 });
  material.userData.voxelDitherKeep = true;
  material.onCompile = (shader) => {
    shader.vertexShader = BARK_VERTEX + shader.vertexShader.replace("#include <begin_vertex>", BARK_BEGIN);
    shader.fragmentShader = `${uprightMoss ? "#define BARK_UPRIGHT_MOSS\n" : ""}${bareWall ? "#define BARK_BARE_WALL\n" : ""}uniform float uBarkGround;\n${BARK_FRAGMENT}${shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = barkSurface(diffuseColor.rgb);")}`;
    shader.uniforms.uBarkGround = { value: ground };
  };
  material.customProgramCacheKey = () => `living-bark${uprightMoss ? "-upright" : ""}${bareWall ? "-bare" : ""}`;
  return material;
}

// ---------------------------------------------------------------- flowers and fruit

/**
 * Flowers and fruit, per kind. Sizes are in leaf units (width, length, depth);
 * `lift` moves them up from the twig (negative hangs below it). Fruit ripens
 * from `green` to its colours; `fall` is how fast a dropped one falls.
 */
export interface OrnamentLook {
  readonly size: readonly [number, number, number];
  readonly lift: number;
  readonly colors?: readonly string[];
  readonly green?: string;
  readonly fall: number;
}

export const ORNAMENTS: Readonly<Record<string, OrnamentLook>> = {
  blossom: { size: [0.7, 0.7, 0.7], lift: 0, fall: 0.55 },
  catkin: { size: [0.35, 1.5, 0.35], lift: -0.75, colors: ["#c9c27a", "#b8ae64", "#d9d394"], fall: 0.9 },
  candle: { size: [0.4, 1.2, 0.4], lift: 0.65, colors: ["#e2e8b0", "#d0daa0", "#eef0c8"], fall: 0 },
  puff: { size: [0.5, 0.5, 0.5], lift: 0.1, colors: ["#f2d33c", "#f7e26e", "#e6bf27"], fall: 0.6 },
  spadix: { size: [0.4, 1.2, 0.4], lift: -0.55, colors: ["#efe2a6", "#e6d48a", "#f4ecc4"], fall: 0.7 },
  cherry: { size: [0.85, 0.85, 0.85], lift: -0.7, colors: ["#c8102e", "#a8102a", "#e0303e"], green: "#86a24c", fall: 2.4 },
  acorn: { size: [0.5, 0.65, 0.5], lift: -0.45, colors: ["#7a5a2a", "#8c6a32", "#6b4f22"], green: "#7f9a4a", fall: 2.6 },
  cone: { size: [0.5, 0.85, 0.5], lift: -0.6, colors: ["#7b5733", "#6a4a2a", "#8a6640"], green: "#6d8a4c", fall: 2.4 },
  coconut: { size: [1.0, 1.1, 1.0], lift: -0.7, colors: ["#7c9a36", "#6b8a2e", "#6a5230"], green: "#86ab3e", fall: 3.2 },
  pod: { size: [0.35, 1.8, 0.6], lift: -0.9, colors: ["#8a6a3a", "#9a7a46", "#7a5c30"], green: "#8aa058", fall: 1.4 },
  // Maple keys: paired wings that drift down slowly.
  samara: { size: [0.8, 0.95, 0.16], lift: -0.55, colors: ["#b99a5c", "#a8844a", "#c9ab6e"], green: "#a4bf62", fall: 0.45 },
  // Baobab flowers: big white bells hanging on long stalks.
  bell: { size: [0.85, 0.95, 0.85], lift: -1.1, colors: ["#f6f1e2", "#efe6cc", "#fbf8ee"], fall: 0.8 },
  // Baobab fruit: a velvety grey-green gourd on a cord.
  gourd: { size: [0.8, 1.4, 0.8], lift: -1.6, colors: ["#9c9474", "#8c8466", "#aaa282"], green: "#83905c", fall: 3 },
  // Orchard fruit: each sets green and ripens to its own colour, big enough to read from across the plot.
  apple: { size: [1.4, 1.35, 1.4], lift: -0.6, colors: ["#c8202a", "#e0402c", "#a81c26"], green: "#9ab84c", fall: 2.6 },
  // Each fruit keeps its own hue so a grove reads at a glance: green-gold pear, deep orange, pale lemon.
  pear: { size: [1.1, 1.6, 1.1], lift: -0.75, colors: ["#c8d84a", "#d8e060", "#a8b838"], green: "#8fb04a", fall: 2.6 },
  peach: { size: [1.35, 1.35, 1.35], lift: -0.5, colors: ["#f29a5c", "#f8b878", "#e8604a"], green: "#a8b860", fall: 2.4 },
  plum: { size: [1.2, 1.35, 1.2], lift: -0.65, colors: ["#7b3fa0", "#b77ad1", "#5e2c80"], green: "#8aa04a", fall: 2.4 },
  // Oranges hang green all summer: a pale green, so they still read against the leaves.
  orange: { size: [1.4, 1.4, 1.4], lift: -0.5, colors: ["#ff8a00", "#ff9e1a", "#f07000"], green: "#b8d468", fall: 2.6 },
  lemon: { size: [1.15, 1.5, 1.15], lift: -0.55, colors: ["#fff23a", "#fff680", "#f0dc20"], green: "#7aa03e", fall: 2.6 },
  fig: { size: [1.3, 1.5, 1.3], lift: -0.4, colors: ["#5a2a4a", "#7a3c64", "#46203a"], green: "#a8b86a", fall: 2.2 },
  // Mangoes swing on long stalks, blushing from green through gold to red.
  mango: { size: [1.25, 1.8, 1.25], lift: -0.95, colors: ["#f0a020", "#e8602a", "#c8c03a"], green: "#6a9a3a", fall: 3 },
};
// Pussy-willow catkins stand up silver along the twig instead of hanging.
const WILLOW_CATKIN: OrnamentLook = { size: [0.28, 0.85, 0.28], lift: 0.45, colors: ["#e9e6cf", "#f2edb0", "#d8d4b8"], fall: 0.9 };
const NO_LOOK: OrnamentLook = { size: [1, 1, 1], lift: 0, fall: 0 };
/** Blue spruce cones: slim, papery and tan, flushed purple while young, never apple green. */
const SPRUCE_CONE: OrnamentLook = { ...(ORNAMENTS.cone ?? NO_LOOK), size: [0.4, 1.0, 0.4], colors: ["#a58256", "#8f6c46", "#b8966a"], green: "#7a5f55" };

export function ornamentLook(spec: OrnamentSpecLike, speciesId = ""): OrnamentLook {
  if (spec.kind === "catkin" && speciesId === "willow") return WILLOW_CATKIN;
  if (spec.kind === "cone" && speciesId === "spruce") return SPRUCE_CONE;
  return ORNAMENTS[spec.kind] ?? NO_LOOK;
}

// ---------------------------------------------------------------- roots

export const ROOT_SEGMENTS = 18;

export interface RootPoint { readonly x: number; readonly y: number; readonly z: number; readonly radius: number; readonly gone: boolean }

interface RootStep { readonly s: number; readonly reach: number; readonly angle: number; readonly radius: number; readonly phase: number; readonly trunk: number; readonly heave: number }

/**
 * How one root of an old tree breaks its planter (`rootBreak`). `heave` (0 to 1)
 * grows with the trunk: the root arches higher out of the soil and levers the
 * rim up where it rolls over. `burst` is how far down the wall, as a share of
 * its depth, the root punches out through the side instead (0: over the lip);
 * `hang` is how far below the wall's foot it may then dangle.
 */
export interface RootBreak { readonly heave: number; readonly burst: number; readonly hang: number }

export const NO_ROOT_BREAK: RootBreak = { heave: 0, burst: 0, hang: 0 };

/** The trunk radius where roots begin to heave, and where they break at full strength. */
const BREAK_FROM = 0.45;
const BREAK_FULL = 0.85;
/** How far inside the lip a bursting root dives, and how long it takes to punch out of the wall. */
const BURST_DIVE = 0.7;
const BURST_OUT = 0.42;
/** The deepest a bursting root runs down a wall before it dangles (a tall sculpt is not followed to its foot). */
const BURST_WALL = 2.4;

const unit = (value: number): number => (value % 1000) / 1000;

/**
 * Plans every root's break for a tree of this trunk on this ground, seeded:
 * an old tree's roots all heave; on a planter whose side they can break (not
 * metal or gems, see `TreeGround.planter.hard`) most old trees, not all, send
 * a root or two out through the wall, the longest first.
 */
export function rootBreaks(roots: readonly { readonly angle: number; readonly reach: number }[], trunk: number, ground: TreeGround, seed = 1): RootBreak[] {
  const heave = smoothstep(BREAK_FROM, BREAK_FULL, trunk);
  if (heave <= 0 || !ground.lip) return roots.map(() => NO_ROOT_BREAK);
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const hard = ground.planter?.hard ?? wall.depth < 0.5;
  const hang = Math.max(0, ground.planter?.hang ?? wall.depth * 1.2);
  const reach = ground.rootReach ?? ground.radius;
  const tree = hash32((seed ^ 0x7f4a7c15) >>> 0);
  // Five trees in six break a side; the rest only heave and crack the rim.
  const breaker = !hard && heave > 0.15 && unit(tree) < 0.83;
  const long = (root: { readonly reach: number }): boolean => (0.3 + trunk * 16) * root.reach >= reach * 0.92;
  const picks = roots.map((root, index) => {
    const h = hash32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    return { burst: breaker && long(root) && unit(h) < 0.12 + 0.2 * heave, depth: 0.28 + unit(h >>> 10) * 0.32 };
  });
  // A breaking tree always shows one: its longest root goes through the wall.
  if (breaker && !picks.some((pick) => pick.burst)) {
    let best = -1;
    for (const [index, root] of roots.entries()) if (long(root) && (best < 0 || root.reach > (roots[best]?.reach ?? 0))) best = index;
    const pick = picks[best];
    if (pick) pick.burst = true;
  }
  return picks.map((pick) => ({ heave, burst: pick.burst ? pick.depth : 0, hang }));
}

/** On the turf: weave, rising and sinking. Near the trunk and the lip a root stays proud of the soil, so it meets both. An old root heaves higher arches. */
function rootOnTop(ground: TreeGround, step: RootStep, lip: number, first: boolean): number {
  if (first) return ground.y + step.trunk * 0.9;
  const { s, reach, radius, phase, heave } = step;
  const weave = Math.sin(s * 2.1 + phase) * 0.7 + Math.sin(s * 4.7 + phase * 2.3) * 0.3;
  const proud = Math.max(smoothstep(0.8, 0.1, s), smoothstep(lip - 0.7, lip - 0.1, reach));
  const arch = 1.1 + 0.9 * heave;
  return ground.y + radius * (0.15 + arch * Math.max(weave, proud * 0.6)) - radius * (1.3 + 0.4 * heave) * (1 - proud) * Math.max(0, -weave);
}

/** Past the lip: roll over the bevel, then creep down the wall (or a carved surface) until it tucks under. An old root levers up over the rim it cracks. */
function rootOverLip(ground: TreeGround, step: RootStep, lip: number): { r: number; y: number; gone: boolean } {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const over = step.reach - lip;
  const lift = step.heave * step.radius * 0.7;
  if (over < 0.32) {
    const turn = (over / 0.32) * Math.PI * 0.5;
    return { r: lip + Math.sin(turn) * 0.3 + step.radius * 0.6, y: ground.y + step.radius * 0.5 + lift * Math.cos(turn) - (1 - Math.cos(turn)) * 0.3, gone: false };
  }
  const down = over - 0.32;
  const y = ground.y - 0.3 - down;
  if (ground.surface) {
    const surface = ground.surface(step.angle, y);
    return { r: surface + step.radius * 0.6, y, gone: down > wall.depth * 0.92 || surface < lip * 0.45 };
  }
  const sink = clamp(down / Math.max(wall.depth, 0.1), 0, 1);
  return { r: (lip + 0.3) * (1 + wall.flare * sink) + step.radius * 0.7, y, gone: down > wall.depth * 0.92 };
}

/** The planter's outer face at this angle and height: a carved surface, or the lip pushed out by the wall's flare. */
function wallFace(ground: TreeGround, angle: number, lip: number, y: number): number {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  if (ground.surface) return ground.surface(angle, y);
  // `lip` is the rim less 0.12; the bevelled wall stands a little proud of the rim line.
  return (lip + 0.28) * (1 + wall.flare * clamp((ground.y - y) / Math.max(wall.depth, 0.1), 0, 1));
}

/**
 * A root that bursts out of the side: it dives under the soil short of the lip,
 * runs hidden inside the planter, punches out of the wall with a swelling
 * where it broke through, creeps down the outside and dangles below the foot.
 */
function rootThroughWall(ground: TreeGround, step: RootStep, lip: number, plan: RootBreak): { r: number; y: number; gone: boolean; swell: number } {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const depth = Math.min(wall.depth, BURST_WALL);
  const out = ground.y - Math.max(0.3, depth * plan.burst);
  const over = step.reach - (lip - BURST_DIVE);
  if (over < BURST_DIVE) {
    // Under the soil and inside the wall, so the planter hides it.
    const t = smoothstep(0, 0.6, over / BURST_DIVE);
    const under = ground.y - step.radius * 1.4 - 0.08;
    const y = under + (Math.min(out, under) - under) * t;
    return { r: Math.min(step.reach, wallFace(ground, step.angle, lip, y) - step.radius - 0.08), y, gone: false, swell: 0 };
  }
  if (over < BURST_DIVE + BURST_OUT) {
    const u = (over - BURST_DIVE) / BURST_OUT;
    const swell = Math.sin(u * Math.PI);
    return { r: wallFace(ground, step.angle, lip, out) + step.radius * (0.35 + 0.45 * u) + 0.16 * swell, y: out + 0.08 * swell, gone: false, swell };
  }
  const down = over - BURST_DIVE - BURST_OUT;
  const foot = ground.y - depth;
  const y = out - down;
  if (y > foot) {
    const face = wallFace(ground, step.angle, lip, y);
    // A carved surface that tucks in under the planter: hang free from where it turned.
    if (!ground.surface || face > lip * 0.7) return { r: face + step.radius * 0.6, y, gone: false, swell: 0 };
  }
  const top = Math.max(y, foot);
  const hangFrom = wallFace(ground, step.angle, lip, top) + step.radius * 0.6;
  const below = Math.max(0, Math.min(foot, out) - y);
  // Free of the wall it bows out a little, then hangs straight.
  return { r: Math.max(hangFrom, lip * 0.7) + 0.18 * Math.sin(Math.min(below, 1.2) * 1.3), y, gone: below > plan.hang, swell: 0 };
}

/**
 * A surface root as ROOT_SEGMENTS + 1 points. It wanders out from the trunk
 * foot, diving under the turf and surfacing again, and on a planter an old
 * tree's longest roots roll over the lip and creep down the wall. Length grows
 * with the trunk, so saplings keep theirs short. A `rootBreaks` plan heaves an
 * old root higher, or sends it out through the planter's side.
 */
export function rootPath(root: { readonly angle: number; readonly reach: number }, trunk: number, ground: TreeGround, plan: RootBreak = NO_ROOT_BREAK): RootPoint[] {
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const burst = plan.burst > 0 && ground.lip !== undefined;
  const reach = ground.rootReach ?? ground.radius;
  const length = burst
    ? Math.max(0.5, (ground.lip?.(root.angle) ?? reach) - 0.12 - trunk * 0.5) + BURST_OUT + Math.min(wall.depth, BURST_WALL) * (1 - plan.burst) + plan.hang
    : Math.min((0.3 + trunk * 16) * root.reach, reach + wall.depth * 1.4);
  const phase = root.angle * 7.3;
  const points: RootPoint[] = [];
  for (let index = 0; index <= ROOT_SEGMENTS; index += 1) {
    const s = (length * index) / ROOT_SEGMENTS;
    const share = s / length;
    // Thick most of the way, tapering hard only toward the tip, like a real root. One that breaks a wall stays thick to its end.
    const radius = burst
      ? trunk * 0.42 * (1 - 0.5 * share) * (1 - share ** 5) + 0.035
      : trunk * 0.5 * (1 - 0.55 * share) * (1 - share ** 3) + 0.03 * share ** 3;
    const angle = root.angle + 0.3 * Math.sin(s * 0.7 + phase) + 0.06 * Math.sin(s * 2.1 + phase * 1.7);
    const step: RootStep = { s, reach: trunk * 0.5 + s, angle, radius, phase, trunk, heave: plan.heave };
    const lip = (ground.lip?.(angle) ?? Infinity) - 0.12;
    let swell = 0;
    let place: { r: number; y: number; gone: boolean };
    if (burst && step.reach >= lip - BURST_DIVE) ({ swell, ...place } = rootThroughWall(ground, step, lip, plan));
    else if (step.reach < lip) place = { r: step.reach, y: rootOnTop(ground, step, burst ? lip + 9 : lip, index === 0), gone: false };
    else place = rootOverLip(ground, step, lip);
    points.push({ x: Math.cos(angle) * place.r, y: place.y, z: Math.sin(angle) * place.r, radius: Math.max(radius * (1 + 0.6 * swell), 0.022), gone: place.gone });
  }
  return points;
}

/** A chunk of planter an old root broke loose. */
export interface RootShard { readonly x: number; readonly y: number; readonly z: number; readonly size: readonly [number, number, number]; readonly angle: number; readonly tilt: number; readonly roll: number; readonly tone: number }

/** The most chunks one root breaks off; the shard mesh is this times the root count, fixed. */
export const ROOT_SHARDS = 8;
/** A shard tone past the planter's colours: the dark of a hole or crack in its wall. */
const HOLE_TONE = 3;

/**
 * The chunks one root breaks out of its planter, seeded: where it rolls over
 * the lip, two rim pieces levered up either side of it (a hard planter just
 * cracks: smaller pieces); where it bursts through the side, a ring of broken
 * wall round the hole, one fallen lower, and the rim above split.
 */
export function rootShards(root: { readonly angle: number; readonly reach: number }, index: number, trunk: number, ground: TreeGround, plan: RootBreak, seed = 1): RootShard[] {
  if (plan.heave < 0.2 || !ground.lip) return [];
  const random = seededRandom((hash32((seed ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0) ^ 0x2545f491) >>> 0);
  const wall = ground.wall ?? { depth: 1, flare: 0 };
  const hard = ground.planter?.hard ?? wall.depth < 0.5;
  const phase = root.angle * 7.3;
  const angleAt = (s: number): number => root.angle + 0.3 * Math.sin(s * 0.7 + phase) + 0.06 * Math.sin(s * 2.1 + phase * 1.7);
  const size = (0.2 + 0.2 * plan.heave) * (hard ? 0.7 : 1);
  const thick = Math.max(trunk * 0.25, 0.1);
  const shards: RootShard[] = [];
  const add = (angle: number, r: number, y: number, side: number, scale: number, tilt: number): void => {
    const s = size * scale * (0.75 + random() * 0.5);
    const t = -Math.sin(angle), c = Math.cos(angle), n = Math.sin(angle);
    shards.push({
      x: c * r + t * side, y, z: n * r + c * side,
      size: [s * (0.9 + random() * 0.45), s * (0.6 + random() * 0.35), s * (0.7 + random() * 0.35)],
      angle, tilt: tilt + (random() - 0.5) * 0.3, roll: (random() - 0.5) * 0.9 + Math.sign(side) * 0.25, tone: 1 + Math.floor(random() * 2),
    });
  };
  // Where it reaches the rim: the lip at the root's own angle there.
  const rimS = Math.max(0.1, (ground.lip(root.angle) - 0.12) - trunk * 0.5);
  const rimAngle = angleAt(rimS);
  const lip = ground.lip(rimAngle) - 0.12;
  if (plan.burst <= 0) {
    if ((0.3 + trunk * 16) * root.reach < lip + 0.1) return [];
    for (const side of [-1, 1]) add(rimAngle, lip + 0.08, ground.y + 0.06 + size * 0.2, side * (thick + 0.14 + random() * 0.08), 1, 0.35 + 0.35 * plan.heave);
    if (!hard && plan.heave > 0.45) add(rimAngle, lip + 0.32, ground.y - 0.35 - random() * 0.4, (random() - 0.5) * 0.3, 0.7, 1.2);
    return shards;
  }
  // The hole in the side, at the depth the root comes out: a dark break in the wall,
  // a ring of chunks pried out round it, one knocked loose lower down, and a crack
  // running up from the hole to the rim, which the root has split.
  const depth = Math.min(wall.depth, BURST_WALL);
  const out = ground.y - Math.max(0.3, depth * plan.burst);
  const holeAngle = angleAt(rimS + BURST_OUT * 0.5);
  const holeLip = ground.lip(holeAngle) - 0.12;
  const face = wallFace(ground, holeAngle, holeLip, out);
  const ring = Math.min(thick, 0.22) + 0.12;
  const flat = (y: number, side: number, width: number, height: number, roll: number, tone: number, push = 0.02): void => {
    const t = -Math.sin(holeAngle), c = Math.cos(holeAngle), n = Math.sin(holeAngle);
    const r = wallFace(ground, holeAngle, holeLip, y) + push;
    shards.push({ x: c * r + t * side, y, z: n * r + c * side, size: [width, height, 0.05], angle: holeAngle, tilt: 0, roll, tone });
  };
  flat(out, 0, ring * 1.9, ring * 1.7, (random() - 0.5) * 0.6, HOLE_TONE);
  add(holeAngle, face + 0.1, out + ring * 0.95, (random() - 0.5) * 0.25, 1.4, 1.0);
  add(holeAngle, face + 0.1, out - ring * 0.15, -ring * 1.1, 1.2, 0.85);
  add(holeAngle, face + 0.1, out - ring * 0.05, ring * 1.1, 1.2, 0.85);
  add(holeAngle, wallFace(ground, holeAngle, holeLip, out - 0.6) + 0.14, out - ring - 0.45, (random() - 0.5) * 0.6, 0.9, 1.35);
  // The crack: two dark strokes zigzagging from the top of the hole up to the rim.
  const top = out + ring;
  const rise = Math.max(0, ground.y - 0.04 - top);
  if (rise > 0.12) {
    const jog = (random() < 0.5 ? -1 : 1) * (0.08 + random() * 0.1);
    flat(top + rise * 0.25, jog * 0.5, 0.13, rise * 0.55, -Math.sign(jog) * 0.35, HOLE_TONE, 0.03);
    flat(top + rise * 0.72, jog * 0.6, 0.11, rise * 0.5, Math.sign(jog) * 0.3, HOLE_TONE, 0.03);
  }
  // The rim above split by the root diving under it.
  add(rimAngle, lip + 0.06, ground.y + 0.06 + size * 0.2, (random() - 0.5) * 0.3, 1.1, 0.5);
  return shards;
}

// ---------------------------------------------------------------- the tree object

export interface TreeLimits {
  readonly litter?: number;
  readonly flowerLitter?: number;
  readonly fruitLitter?: number;
  readonly falling?: number;
}

export interface TreeRenderOptions {
  readonly colors: TreeColors;
  readonly ground?: TreeGround;
  readonly features?: Partial<Record<TreeFeature, boolean>> | string;
  /** "smooth" draws round wood and leaf blades; "voxel" draws everything as blocks. */
  readonly form?: "smooth" | "voxel";
  /** Swap a shape (a skin's crystal leaves, coin leaves). Blades are any shape with vertex colours. */
  readonly shapes?: Partial<Pick<TreeShapes, "wood" | "leaf" | "blade" | "bud">>;
  readonly skin?: TreeSkin | null;
  readonly limits?: TreeLimits;
  readonly seed?: number;
  /** Strains of a hybrid or chimera, by number; strain 0 is the tree's own colours and skin, so `strains[0]` is not read. */
  readonly strains?: readonly TreeStrain[];
  /** Each internode's strain (tree-growth's `sectors`); its leaves, flowers, fruit and bark take that strain's look. */
  readonly strainOf?: ArrayLike<number>;
  /** A mixed bloom: each blossom opens in one of these colours, by share (codominant flower colour). Left out, blossoms take the strain's spring colours. */
  readonly blooms?: readonly TreeBloom[];
  /** Minor kinds' own flowers and fruit: cherry limbs on an oak blossom though the oak only hangs catkins. */
  readonly kinds?: readonly TreeKindOrnaments[];
}

/** What moves the tree this frame. `snow` 0..1 lies along the limbs; `snowed` hides litter under fresh snow. */
export interface TreeMotion {
  readonly elapsed: number;
  readonly delta?: number;
  readonly wind: number;
  /** The way the wind blows toward, in radians from +x toward +z (see `breezeAt`). */
  readonly windDir?: number;
  readonly dead?: boolean;
  readonly snow?: number;
  readonly snowed?: boolean;
  /**
   * How much the built-in sway field moves the wood, leaves and fruit (1, the
   * default). A host that moves the tree itself (keel/tree-mechanics) passes 0:
   * leaves still flutter and hanging fruit still swings on its stalk.
   */
  readonly field?: number;
  /**
   * Each strain's own year (tree-growth `yearState` for its species), so its
   * limbs leaf out, blossom and turn on their own calendar: an oak limb on a
   * cherry is still in bud while the cherry blooms. Strain 0, and any left
   * out, follow the tree's year.
   */
  readonly strainYears?: readonly (YearLike | undefined)[];
}

export interface TreeMeshes {
  readonly wood: InstancedLike;
  readonly leaves: InstancedLike | null;
  readonly flowers: InstancedLike | null;
  readonly fruit: InstancedLike | null;
  readonly leafLitter: InstancedLike | null;
  readonly litter: InstancedLike | null;
  readonly snow: InstancedLike | null;
  readonly falling: InstancedLike | null;
  readonly fallingLeaves: InstancedLike | null;
  /** Chunks of planter an old tree's roots broke loose (`rootBreak`, smooth form, on a planter). */
  readonly shards: InstancedLike | null;
}

export interface TreeRender {
  /** Add this to the scene once. */
  readonly group: unknown;
  readonly features: TreeFeatures;
  /** The instanced meshes, for a host that swaps materials (skins) or adds effects (night glow). Off parts are null. */
  readonly meshes: TreeMeshes;
  /** Minor kinds' own flowers and fruit, one mesh per set (see `TreeRenderOptions.kinds`). */
  readonly kinds: readonly InstancedLike[];
  /** Pose and, when the season or frame changed, repaint. Call every frame. */
  update(frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void;
  /** Leaves, petals and fruit falling or lying where they landed, for a host's own drawing (a canvas fallback). */
  readonly fallers: readonly Readonly<Pick<Faller, "x" | "y" | "z" | "size" | "color" | "landed" | "kind">>[];
  /** The ripe fruit as of the last update, hanging on the tree or lying under it, for animals to eat. */
  fruit(): TreeFruit[];
  /** Take a fruit (by its `TreeFruit.key`) off the tree or the ground until next year's crop. False when there was none. */
  eat(key: string): boolean;
  /** Repaint on the next update (after a material swap, say). */
  repaint(): void;
  dispose(): void;
}

/** A ripe fruit, where it hangs or lies. Its `key` holds while it ripens, falls and lies. */
export interface TreeFruit {
  readonly key: string;
  /** The ornament kind: "apple", "acorn", "cherry" and so on. */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its size across, in scene units. */
  readonly size: number;
  /** On the tree (true) or on the ground under it. */
  readonly hanging: boolean;
}

interface OrnamentSet {
  readonly name: "flowers" | "fruit";
  /** A minor kind's set opens on this strain's year and ignores the tree's own bearing rules; -1 is the tree's own. */
  readonly strain: number;
  readonly spec: OrnamentSpecLike;
  readonly look: OrnamentLook;
  readonly slots: SlotsLike;
  readonly mesh: InstancedLike;
  readonly litterStart: number;
  readonly litterLimit: number;
  readonly stride: number;
  /** Drawn as sprays (the `sprays` look): every `thin`th slot draws, `grow` times its size, one tone per twig. */
  readonly spray: boolean;
  readonly thin: number;
  readonly grow: number;
}

/** How a blossom set draws as sprays: a big crown keeps every other slot at twice the size (fewer, readable sprays); a small one keeps all. */
function sprayPlan(tree: Pick<Tree, "features" | "smooth">, spec: OrnamentSpecLike, slots: SlotsLike, own: boolean): { spray: boolean; thin: number; grow: number } {
  const spray = tree.features.sprays && tree.smooth && own && spec.kind === "blossom";
  if (!spray) return { spray, thin: 1, grow: 1 };
  return slots.count > 900 ? { spray, thin: 2, grow: 2 } : { spray, thin: 1, grow: 1.5 };
}

interface Faller {
  readonly key: string;
  readonly kind: "leaf" | "flowers" | "fruit";
  x: number; y: number; z: number;
  vx: number; vz: number;
  readonly phase: number;
  readonly size: readonly [number, number, number];
  readonly color: string;
  readonly speed: number;
  landed: boolean;
}

interface Tree {
  readonly lit: LitLike;
  readonly model: TreeModelLike;
  readonly colors: TreeColors;
  readonly ground: TreeGround;
  readonly features: TreeFeatures;
  readonly smooth: boolean;
  readonly blades: boolean;
  /** Conifer needles: each sprig lies along its twig, stiff, instead of hanging off it like a leaf. */
  readonly needles: boolean;
  /** A palm's leaflets, laid out in two rows down each frond. */
  readonly fronds: FrondLayout | null;
  readonly skin: TreeSkin | null;
  readonly strains: readonly TreeStrain[];
  readonly strainOf: ArrayLike<number> | null;
  readonly blooms: readonly TreeBloom[];
  strainYears: readonly (YearLike | undefined)[];
  readonly group: NodeLike;
  readonly meshes: TreeMeshes;
  readonly flowers: OrnamentSet | null;
  readonly fruits: OrnamentSet | null;
  readonly kinds: readonly OrnamentSet[];
  readonly limits: Required<TreeLimits>;
  readonly leafStride: number;
  readonly hidden: Map<string, { readonly rank: number; readonly kind: Faller["kind"]; readonly index: number }>;
  /** The same slots by kind, for the per-slot test in every pose pass (a number lookup, not a string built per slot per frame). */
  readonly hiddenSlots: Readonly<Record<Faller["kind"], Set<number>>>;
  /** Fruit animals have eaten this year, by set ("fruit", or "kind<n>" for a minor kind's) and slot. */
  readonly eaten: Map<string, Set<number>>;
  lastYear: YearLike | null;
  lastMotion: TreeMotion | null;
  readonly fallers: Faller[];
  readonly random: () => number;
  readonly a: ColorLike;
  readonly b: ColorLike;
  readonly c: ColorLike;
  readonly offset: Offset;
  spawnClock: number;
  paintKey: string;
  lastFrame: TreeFrameLike | null;
  /** The host moves the tree itself this frame (`field: 0`): no sway field at all. */
  still: boolean;
  readonly seed: number;
  /** The roots' break plans (`rootBreak`) and the trunk radius they were made for. */
  readonly breaks: { trunk: number; plans: readonly RootBreak[] };
}

const DEFAULT_LIMITS: Required<TreeLimits> = { litter: 1800, flowerLitter: 600, fruitLitter: 320, falling: 64 };

function makeMesh(tree: Pick<Tree, "lit" | "group">, count: number, roughness: number, shadows: boolean, geometry: GeometryLike, sheet = false): InstancedLike {
  const lit = tree.lit;
  const vertexColors = Boolean(geometry.attributes.color);
  // Blades are single sheets, seen from both sides.
  const side = sheet ? "both" : "front";
  const mesh = new lit.Instances(geometry, new lit.LitMaterial({ color: "#ffffff", roughness, side, vertexColors }), Math.max(1, count));
  mesh.instanceMatrix.setUsage("dynamic");
  mesh.setColorAt(0, new lit.Color("#ffffff"));
  mesh.count = count;
  // Every slot starts hidden: a part only shows once something poses it.
  for (let index = 0; index < Math.max(1, count); index += 1) clearSlot(mesh.instanceMatrix.array, index);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  tree.group.add(mesh);
  return mesh;
}

const ornamentState = (set: OrnamentSet, year: YearLike): { open: number; fallen: number } =>
  set.name === "fruit" ? { open: year.fruit, fallen: year.fruitDrop } : { open: year.bloom, fallen: year.petals };

// Needles clothe a conifer's limbs most of the way in; other evergreens keep leaves near the tips.
const leafTipLimit = (tree: Tree): number => (tree.needles ? 40 : tree.model.species.evergreen ? 7 : 2.6);

/** Is node a living, leafy twig right now? Outer twigs carry the foliage. */
function leafyNode(frame: TreeFrameLike, node: number, tipLimit: number): boolean {
  return at(frame.grow, node) > 0.25 && at(frame.dead, node) < 0.25 && at(frame.fall, node) === 0 && at(frame.tips, node) <= tipLimit;
}

function bearingNode(tree: Tree, frame: TreeFrameLike, spec: OrnamentSpecLike, node: number, own = false): boolean {
  if (frame.cycle < spec.from || at(frame.fall, node) > 0 || at(frame.dead, node) >= 0.2) return false;
  if (tree.strainOf && tree.strains[at(tree.strainOf, node)]?.bears === false && !own) return false;
  if (spec.on === "tip") return leafyNode(frame, node, tree.model.species.evergreen ? 7 : 2.6);
  // Spurs form on wood a couple of years old (half a growth cycle), so a tree in full bloom reads as a cloud.
  return at(frame.grow, node) >= 1 && at(frame.tips, node) <= 9 && frame.cycle - at(tree.model.birth, node) > 0.5;
}

// ---------------------------------------------------------------- wood

function poseWood(tree: Tree, frame: TreeFrameLike, motion: TreeMotion): void {
  const { model, meshes, offset } = tree;
  const array = meshes.wood.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind * (motion.field ?? 1) : 0;
  const swayB: Offset = { x: 0, z: 0 };
  for (let node = 0; node < model.count; node += 1) {
    const fallen = at(frame.fall, node) > 0;
    if (at(frame.grow, node) <= 0 || at(frame.rot, node) >= 1 || (fallen && !tree.features.deadwood)) { clearSlot(array, node); continue; }
    const radius = at(frame.radius, node) * (1 - at(frame.rot, node) * 0.7);
    const a: [number, number, number] = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
    const b: [number, number, number] = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
    if (!fallen && !tree.still) {
      sway(offset, a[0], a[1], a[2], motion.elapsed, wind, height, motion.windDir);
      sway(swayB, b[0], b[1], b[2], motion.elapsed, wind, height, motion.windDir);
      a[0] += offset.x; a[2] += offset.z; b[0] += swayB.x; b[2] += swayB.z;
    }
    writeSegment(array, node, a, b, radius);
  }
  poseRoots(tree, frame, array);
  meshes.wood.instanceMatrix.needsUpdate = true;
}

/** Surface roots flare out from the trunk foot and thicken with it. */
function poseRoots(tree: Tree, frame: TreeFrameLike, array: Float32Array): void {
  const { model, ground } = tree;
  const trunk = at(frame.radius, 0);
  const breaks = treeBreaks(tree, trunk);
  for (const [index, root] of model.roots.entries()) {
    const first = model.count + index * ROOT_SEGMENTS;
    for (let part = 0; part < ROOT_SEGMENTS; part += 1) clearSlot(array, first + part);
    if (!tree.features.roots || trunk < 0.06) continue;
    if (!tree.smooth) {
      const reach = (0.25 + trunk * 2.4) * root.reach;
      const c = Math.cos(root.angle), s = Math.sin(root.angle);
      writeSegment(array, first, [c * trunk * 0.5, ground.y + trunk * 0.9, s * trunk * 0.5], [c * reach, ground.y + 0.02, s * reach], trunk * 0.42);
      continue;
    }
    // A palm's roots are a short fibrous flare at its foot, never long runners.
    const parts = tree.features.rootSink && model.species.palm ? 4 : ROOT_SEGMENTS;
    // Till a tree is old its roots stay within the inner part of the planter; an old one's run to the lip and over it.
    const reach = tree.features.rootSink && trunk < ROOT_OLD ? (ground.rootReach ?? ground.radius) * 0.42 : Infinity;
    const plan = breaks[index] ?? NO_ROOT_BREAK;
    poseRootPath(array, first, rootPath(root, trunk, ground, plan), tree.features.rootSink ? ROOT_SINK : 0, parts, plan.heave > 0 ? Infinity : reach);
  }
}

/** The roots' break plans for this trunk (`rootBreak`), kept while the trunk holds its girth. */
function treeBreaks(tree: Tree, trunk: number): readonly RootBreak[] {
  const { model } = tree;
  const on = tree.features.rootBreak && tree.features.roots && tree.smooth && !model.species.palm;
  if (!on) return [];
  if (tree.breaks.trunk !== trunk) {
    tree.breaks.trunk = trunk;
    tree.breaks.plans = rootBreaks(model.roots, trunk, tree.ground, tree.seed);
    poseShards(tree, trunk);
  }
  return tree.breaks.plans;
}

/** Weathered stone, darkest first: the chunks' colour when the host does not pass its planter's. */
const SHARD_COLORS = ["#5e4a3a", "#7a634f", "#958068"] as const;

/** The planter chunks the roots broke loose, posed only when the trunk grows. */
function poseShards(tree: Tree, trunk: number): void {
  const mesh = tree.meshes.shards;
  if (!mesh) return;
  const array = mesh.instanceMatrix.array;
  const own = tree.ground.planter?.colors;
  const colors = own && own.length > 0 ? own : SHARD_COLORS;
  for (const [index, root] of tree.model.roots.entries()) {
    const shards = rootShards(root, index, trunk, tree.ground, tree.breaks.plans[index] ?? NO_ROOT_BREAK, tree.seed);
    for (let slot = 0; slot < ROOT_SHARDS; slot += 1) {
      const shard = shards[slot];
      const place = index * ROOT_SHARDS + slot;
      if (!shard) { clearSlot(array, place); continue; }
      writeShard(array, place, shard);
      tree.a.set(shard.tone === HOLE_TONE ? (colors[0] ?? SHARD_COLORS[0]) : (colors[Math.min(shard.tone, colors.length - 1)] ?? SHARD_COLORS[0]));
      mesh.setColorAt(place, shard.tone === HOLE_TONE ? tree.a.multiplyScalar(0.28) : tree.a);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** A chunk turned to face out from the planter at its angle, tipped out by `tilt` and rolled about its outward axis. */
export function writeShard(array: Float32Array, index: number, shard: RootShard): void {
  const c = Math.cos(shard.angle), n = Math.sin(shard.angle);
  const ct = Math.cos(shard.tilt), st = Math.sin(shard.tilt), cr = Math.cos(shard.roll), sr = Math.sin(shard.roll);
  // Tangent, up and out; up tips toward out by tilt, then up and tangent turn about out by roll.
  const tangent = [-n, 0, c];
  const up = [c * st, ct, n * st];
  const out = [c * ct, -st, n * ct];
  const x = tangent.map((v, i) => v * cr + (up[i] ?? 0) * sr);
  const y = up.map((v, i) => v * cr - (tangent[i] ?? 0) * sr);
  const [sx, sy, sz] = shard.size;
  writeColumns(array, index, [
    (x[0] ?? 0) * sx, (x[1] ?? 0) * sx, (x[2] ?? 0) * sx, 0,
    (y[0] ?? 0) * sy, (y[1] ?? 0) * sy, (y[2] ?? 0) * sy, 0,
    (out[0] ?? 0) * sz, (out[1] ?? 0) * sz, (out[2] ?? 0) * sz, 0,
  ]);
  writeOrigin(array, index, shard.x, shard.y, shard.z);
}

/**
 * `rootSink`: only roots a pixel and a half thick or more draw. Once a root thins
 * below that, or runs past the inner part of the planter, it dives under the soil
 * for good, so no hairline or spoke runs on across the planter top like a crack;
 * a young tree shows a short flare, an old one's thick roots still run to the lip
 * and roll over it.
 */
const ROOT_SINK = 0.06;
/** The trunk radius past which a tree is old enough for its roots to reach the planter's lip. */
const ROOT_OLD = 0.45;

function poseRootPath(array: Float32Array, first: number, path: readonly RootPoint[], sink: number, parts: number, reach: number): void {
  for (let part = 0; part < parts; part += 1) {
    const p = path[part];
    const q = path[part + 1];
    if (p === undefined || q === undefined || p.gone) continue;
    if (part > 1 && (p.radius < sink || Math.hypot(p.x, p.z) > reach)) break;
    writeSegment(array, first + part, [p.x, p.y, p.z], [q.x, q.y, q.z], (p.radius + q.radius) / 2);
  }
}

/** The colours an internode's strain wears (the tree's own for strain 0, or when there are no strains). */
function strainColors(tree: Tree, node: number): TreeColors {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  return (strain > 0 ? tree.strains[strain]?.colors : undefined) ?? tree.colors;
}

/** The strain an internode belongs to, if the tree has strains. */
const strainAt = (tree: Tree, node: number): TreeStrain | undefined => (tree.strainOf && node < tree.model.count ? tree.strains[at(tree.strainOf, node)] : undefined);

/** How far a leaf hangs below its twig on a weeping strain: strands of uneven length. */
function strainDrop(tree: Tree, node: number, index: number): number {
  const hang = strainAt(tree, node)?.hang ?? 0;
  return hang > 0 ? hang * (0.25 + ((index * 7) % 8) / 8) : 0;
}

/** Does this leaf grow as a needle sprig? The tree's own habit, unless its strain is a broadleaf kind. */
function needleLeaf(tree: Tree, node: number): boolean {
  if (!tree.needles) return false;
  const kind = strainAt(tree, node)?.species;
  return kind === undefined || NEEDLE_KINDS[kind] !== undefined;
}

/** The skin an internode's strain wears: the tree's own unless its strain sets one or drops it. */
function strainSkin(tree: Tree, node: number): TreeSkin | null {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  const own = strain > 0 ? tree.strains[strain] : undefined;
  return own && own.skin !== undefined ? own.skin : tree.skin;
}

/**
 * A stable number for the clump a twig belongs to: its parent shoot, so the
 * leaves and flowers of neighbouring twigs share a tone and the crown reads
 * as masses (the `clumps` and `sprays` looks), not a per-leaf speckle.
 */
function clumpOf(tree: Pick<Tree, "model">, node: number): number {
  const parent = tree.model.parent;
  const shoot = parent && node < tree.model.count ? Math.max(0, at(parent, node)) : node;
  return hash32(Math.imul(shoot + 1, 2654435761) ^ 0x9e3779b9);
}

/** The year an internode's limbs live by: its strain's own, or the tree's. */
function strainYear(tree: Tree, node: number, year: YearLike): YearLike {
  if (!tree.strainOf || tree.strainYears.length === 0 || node >= tree.model.count) return year;
  return tree.strainYears[at(tree.strainOf, node)] ?? year;
}

function barkTone(tree: Tree, frame: TreeFrameLike, node: number): string {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  const trunk = (strain > 0 ? tree.strains[strain]?.bark : undefined) ?? strainColors(tree, node).trunk;
  const isRoot = node >= tree.model.count;
  const radius = isRoot ? 1 : at(frame.radius, node);
  const hash = hash32(node * 2654435761) % 100;
  if (tree.model.species.id === "birch") return (hash < 18 && radius > 0.05 ? trunk[2] : radius > 0.05 ? trunk[0] : trunk[1]) ?? "#6b4a33";
  return (radius > 0.2 ? trunk[0] : radius > 0.07 ? trunk[1] : trunk[2]) ?? "#6b4a33";
}

function paintWood(tree: Tree, frame: TreeFrameLike, dead: boolean): void {
  const { model, meshes, a, b, colors } = tree;
  const total = model.count + model.roots.length * ROOT_SEGMENTS;
  for (let node = 0; node < total; node += 1) {
    a.set(barkTone(tree, frame, node));
    if (node < model.count) {
      const fresh = at(frame.grow, node) < 1 || frame.cycle - at(model.birth, node) < 1;
      if (fresh && !dead) a.lerp(b.set(strainColors(tree, node).leaves[0] ?? colors.leaves[0] ?? "#6c9a54"), 0.45);
      a.lerp(b.set("#8e897f"), at(frame.dead, node) * 0.85);
      if (at(frame.fall, node) > 0) a.lerp(b.set("#4a3b2f"), 0.55 + at(frame.rot, node) * 0.35);
    }
    if (dead) a.lerp(b.set("#8e897f"), 0.7);
    meshes.wood.setColorAt(node, a);
  }
  if (meshes.wood.instanceColor) meshes.wood.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- leaves

interface LeafPass {
  readonly array: Float32Array;
  readonly height: number;
  readonly size: number;
  readonly spread: number;
  readonly bare: boolean;
  readonly wind: number;
  /** The wind the sway field moves leaves by (`wind` × the motion's `field`). */
  readonly field: number;
  readonly dir: number;
  readonly elapsed: number;
}

/**
 * The sway field's offset for a leaf at (x, y, z), into `tree.offset`. A host
 * that moves the tree itself (`field: 0`) gets none at all: the wood is already
 * where keel/tree-mechanics put it, and the field's idle breathing would only
 * float the leaves off their twigs (and cost a sway per leaf per frame).
 */
function drift(tree: Tree, pass: LeafPass, x: number, y: number, z: number): void {
  if (tree.still) { tree.offset.x = 0; tree.offset.z = 0; return; }
  sway(tree.offset, x, y, z, pass.elapsed, pass.field, pass.height, pass.dir);
}

/** How far downwind a point is, so a gust reaches it in turn. */
const downwind = (pass: LeafPass, x: number, z: number): number => x * Math.cos(pass.dir) + z * Math.sin(pass.dir);

/** A blade grows from its twig: the stalk sits on the twig and the blade points out along its slot, so no leaf hangs in the air. */
function poseBlade(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  if (tree.fronds) {
    poseLeaflet(tree, tree.fronds, frame, index, pass, leafSize, swing);
    return;
  }
  if (needleLeaf(tree, at(tree.model.leaves.node, index))) {
    poseSprig(tree, frame, index, pass, leafSize, swing);
    return;
  }
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const dx = at(slots.dx, index), dy = at(slots.dy, index), dz = at(slots.dz, index);
  const reach = Math.hypot(dx, dy, dz) * pass.spread;
  const out = Math.min(reach * 0.3, 0.22);
  const scale = reach / pass.spread || 1;
  // A weeping strain's leaves hang straight down in long strands, so its limbs read as a curtain on any tree.
  const weeps = (strainAt(tree, node)?.hang ?? 0) > 0;
  const n: [number, number, number] = weeps ? [dx / scale * 0.25, -1, dz / scale * 0.25] : [dx / scale, dy / scale, dz / scale];
  // Strands start out past the host's foliage, so a willow limb in a pine hangs clear of the needles.
  const clear = weeps ? 0.55 : 0;
  const x = at(frame.x, node) + n[0] * out + (dx / scale) * clear;
  const y = at(frame.y, node) + n[1] * out - strainDrop(tree, node, index);
  const z = at(frame.z, node) + n[2] * out + (dz / scale) * clear;
  drift(tree, pass, x, y, z);
  // A blade is thinner than a leaf lump, so it is drawn longer to fill the crown as fully.
  const motion = leafFlutter(pass.elapsed, pass.wind, at(slots.rank, index), at(tree.model.phase, node), downwind(pass, x, z));
  writeBlade(pass.array, index, [x + tree.offset.x + swing, y, z + tree.offset.z + swing * 0.4], n, leafSize * (weeps ? 1.5 : 1.9), motion, weeps ? 2.4 : 1);
}

/**
 * A palm frond as its leaflets: two even rows down the rachis, one each side,
 * short at the frond's base, longest a third of the way out and short again at
 * its tip. Per leaflet: how far along its internode it grows, which side, and
 * how far out along the whole frond that is.
 */
interface FrondLayout { readonly along: Float32Array; readonly side: Float32Array; readonly out: Float32Array; readonly pieces: Float32Array }

/** Each frond internode's place along its frond (counted from the crown), its frond's first internode, and each frond's length in internodes. */
function frondDepths(model: TreeModelLike, parent: ArrayLike<number>, order: ArrayLike<number>): { depth: Float32Array; base: Int32Array; pieces: Float32Array } {
  const depth = new Float32Array(model.count);
  const base = new Int32Array(model.count).fill(-1);
  const pieces = new Float32Array(model.count);
  for (let node = 0; node < model.count; node += 1) {
    const up = at(parent, node);
    if (at(order, node) === 0) continue;
    const fromTrunk = up < 0 || at(order, up) === 0;
    depth[node] = fromTrunk ? 0 : at(depth, up) + 1;
    base[node] = fromTrunk ? node : at(base, up);
    const root = at(base, node);
    pieces[root] = Math.max(at(pieces, root), at(depth, node) + 1);
  }
  return { depth, base, pieces };
}

function frondLayout(model: TreeModelLike): FrondLayout | null {
  const { parent, order } = model;
  if (!model.species.palm || !parent || !order) return null;
  const { depth, base, pieces } = frondDepths(model, parent, order);
  const slots = model.leaves;
  const layout: FrondLayout = { along: new Float32Array(slots.count), side: new Float32Array(slots.count), out: new Float32Array(slots.count), pieces: new Float32Array(slots.count) };
  let first = 0;
  for (let index = 1; index <= slots.count; index += 1) {
    if (index < slots.count && at(slots.node, index) === at(slots.node, first)) continue;
    const node = at(slots.node, first);
    const length = Math.max(1, at(pieces, Math.max(0, at(base, node))));
    const pairs = Math.ceil((index - first) / 2);
    for (let k = 0; k < index - first; k += 1) {
      const along = (Math.floor(k / 2) + 0.5 + (k % 2) * 0.2) / pairs;
      layout.along[first + k] = along;
      layout.side[first + k] = k % 2 === 0 ? 1 : -1;
      layout.out[first + k] = (at(depth, node) + along) / length;
      layout.pieces[first + k] = length;
    }
    first = index;
  }
  return layout;
}

/** One leaflet off its rachis: angled toward the frond's tip, dropping into a V, the outer ones drooping most, all of them shivering in the wind. */
function poseLeaflet(tree: Tree, fronds: FrondLayout, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const tip: V3 = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
  const base: V3 = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
  const t = at(fronds.along, index);
  const p: V3 = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
  let fw: V3 = norm3(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  if (isZero(fw)) fw = UP;
  let side: V3 = norm3(...cross3(fw, UP));
  if (isZero(side)) side = [1, 0, 0];
  const down: V3 = norm3(...cross3(fw, side));
  const s = at(fronds.out, index);
  const sign = at(fronds.side, index);
  const rank = at(slots.rank, index);
  const shiver = pass.wind * 0.35 * Math.sin(pass.elapsed * (6 + rank * 3) + rank * 40 + downwind(pass, p[0], p[2]) * 0.8);
  const forward = 0.5 + 0.15 * s;
  const vee = 0.3 + 0.45 * s + shiver * 0.5;
  const n: V3 = [
    sign * side[0] * Math.cos(forward) + fw[0] * Math.sin(forward) + down[0] * vee,
    sign * side[1] * Math.cos(forward) + fw[1] * Math.sin(forward) + down[1] * vee,
    sign * side[2] * Math.cos(forward) + fw[2] * Math.sin(forward) + down[2] * vee,
  ];
  // Leaflets reach a third of the frond's length at most, less toward its ends.
  const piece = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  const frond = piece * at(fronds.pieces, index);
  const profile = Math.sin(Math.PI * (0.08 + 0.88 * s)) ** 0.7;
  const grown = clamp(leafSize / Math.max(pass.size, 1e-6), 0, 1.4);
  const length = frond * 0.3 * (0.25 + 0.75 * profile) * grown * (0.85 + 0.3 * at(slots.size, index));
  drift(tree, pass, p[0], p[1], p[2]);
  writeBlade(pass.array, index, [p[0] + tree.offset.x + swing, p[1], p[2] + tree.offset.z + swing * 0.4], norm3(...n), length, { droop: 0.04, twist: sign * 0.35 + shiver * 0.6, nod: 0 });
}

/** Where a conifer sprig sits: somewhere along its twig, pointing the way the twig grows, a little off it. */
function sprigPlace(frame: TreeFrameLike, slots: TreeModelLike["leaves"], index: number): { p: V3; n: V3 } {
  const node = at(slots.node, index);
  const tip: V3 = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
  const base: V3 = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
  const rank = at(slots.rank, index);
  const along = 0.15 + 0.7 * ((rank * 7.31) % 1);
  const jitter = 0.35;
  let n: V3 = norm3(tip[0] - base[0] + at(slots.dx, index) * jitter, tip[1] - base[1] + at(slots.dy, index) * jitter, tip[2] - base[2] + at(slots.dz, index) * jitter);
  if (isZero(n)) n = UP;
  return { p: [base[0] + (tip[0] - base[0]) * along, base[1] + (tip[1] - base[1]) * along, base[2] + (tip[2] - base[2]) * along], n };
}

/** A sprig is stiff: it only rocks a little in the wind and turns on its twig, it does not droop like a leaf. */
function poseSprig(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const { p, n } = sprigPlace(frame, slots, index);
  drift(tree, pass, p[0], p[1], p[2]);
  const motion = leafFlutter(pass.elapsed, pass.wind, at(slots.rank, index), at(tree.model.phase, node), downwind(pass, p[0], p[2]));
  const stiff = { droop: motion.droop * 0.12, twist: at(slots.rank, index) * TAU + motion.twist * 0.2, nod: motion.nod * 0.3 };
  writeBlade(pass.array, index, [p[0] + tree.offset.x + swing * 0.3, p[1], p[2] + tree.offset.z + swing * 0.12], n, leafSize * 1.9, stiff);
}

function poseLump(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const rank = at(slots.rank, index);
  const x = at(frame.x, node) + at(slots.dx, index) * pass.spread;
  const y = at(frame.y, node) + at(slots.dy, index) * pass.spread - strainDrop(tree, node, index);
  const z = at(frame.z, node) + at(slots.dz, index) * pass.spread;
  drift(tree, pass, x, y, z);
  const flutter = pass.wind * 0.012 * Math.sin(pass.elapsed * 6.3 + rank * 40);
  const fx = flutter * Math.cos(pass.dir);
  const fz = flutter * Math.sin(pass.dir);
  writeVoxel(pass.array, index, x + tree.offset.x + fx + swing * Math.cos(pass.dir), y + flutter * 0.4, z + tree.offset.z + fz + swing * Math.sin(pass.dir), leafSize, rank * TAU + flutter * 6);
}

function leafShows(tree: Tree, frame: TreeFrameLike, year: YearLike, index: number, leafy: boolean): boolean {
  const slots = tree.model.leaves;
  return leafy && at(frame.grow, at(slots.node, index)) > 0 && at(slots.rank, index) >= year.drop && !tree.hiddenSlots.leaf.has(index);
}

/**
 * How much bigger a young tree's leaves draw. With `clumps` a seedling's first
 * leaves come nearly twice the size, easing back to life size as the crown
 * fills in, so a tree a year or two old reads as a sprout and not a speck.
 */
function youngLeaf(tree: Tree, frame: TreeFrameLike): number {
  if (!tree.features.clumps) return frame.visible <= 4 ? 0.8 : 1;
  return 1 + 0.9 * clamp(1 - (frame.visible - 4) / 90, 0, 1);
}

function leafPass(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): LeafPass {
  const bare = year.leaf <= 0;
  // A grand tree is bigger than life but has the same twigs, so each clump fills more of its crown.
  const grand = Math.max(1, frame.scale ?? 1) ** 0.75;
  return {
    array: mesh.instanceMatrix.array, height: Math.max(frame.height, 0.5), bare,
    size: tree.colors.leafScale * youngLeaf(tree, frame) * (tree.skin?.leafSize ?? 1) * grand,
    spread: (bare ? 0.15 : 0.35 + 0.65 * year.leaf) * grand, wind: tree.features.sway ? motion.wind : 0, dir: motion.windDir ?? 0, elapsed: motion.elapsed,
    field: tree.features.sway ? motion.wind * (motion.field ?? 1) : 0,
  };
}

/**
 * How far into full blossom the tree is (the `sprays` look), 0..1: in full bloom a
 * blossom tree's new leaves stay small, so the crown reads as a pink cloud with
 * green only as an accent, then grow as the petals fall.
 */
const floweringOf = (tree: Tree, year: YearLike): number =>
  tree.features.sprays && tree.flowers?.spray === true ? clamp(year.bloom * 1.6, 0, 1) * (1 - clamp(year.petals * 1.2, 0, 1)) : 0;
const leafHush = (tree: Tree, node: number, flowering: number): number => (flowering > 0 && strainColors(tree, node).blossom === true ? 1 - 0.55 * flowering : 1);

function poseLeaves(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const { model } = tree;
  const slots = model.leaves;
  const seedling = frame.visible <= 4;
  const tipLimit = leafTipLimit(tree);
  const bare = year.leaf <= 0;
  if (motion.dead === true) { for (let index = 0; index < slots.count; index += 1) clearSlot(mesh.instanceMatrix.array, index); mesh.instanceMatrix.needsUpdate = true; return; }
  const pass = leafPass(tree, mesh, frame, year, motion);
  const flowering = floweringOf(tree, year);
  for (let index = 0; index < slots.count; index += 1) {
    const node = at(slots.node, index);
    // In winter only a few closed buds show; the rest of the twig is bare.
    const own = strainYear(tree, node, year);
    const resting = own.leaf <= 0;
    if (!leafShows(tree, frame, own, index, seedling || leafyNode(frame, node, tipLimit)) || (resting && index % 4 !== 0)) { clearSlot(pass.array, index); continue; }
    const leafSize = resting ? pass.size * 0.24 : pass.size * leafHush(tree, node, flowering) * at(slots.size, index) * (0.2 + 0.8 * own.leaf) * (0.45 + 0.55 * at(frame.grow, node));
    // Hanging strands swing from their twig: the lower the leaf, the wider the swing.
    const swing = Math.max(0, -at(slots.dy, index)) * pass.wind * 0.35 * Math.sin(pass.elapsed * 1.4 + at(model.phase, node));
    if (tree.blades) poseBlade(tree, frame, index, pass, leafSize, swing);
    else poseLump(tree, frame, index, pass, leafSize, swing);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * How lit each leaf is by its place in the crown: leaves deep inside and low
 * down sit in the crown's own shade, the outer and upper ones catch the light,
 * and each varies a little on its own. Without it a crown is one flat colour.
 */
export function crownShade(frame: TreeFrameLike, slots: SlotsLike, jitter?: (index: number) => number): Float32Array {
  const shade = new Float32Array(slots.count).fill(1);
  const live: number[] = [];
  for (let index = 0; index < slots.count; index += 1) if (at(frame.grow, at(slots.node, index)) > 0) live.push(index);
  if (live.length === 0) return shade;
  const place = (index: number): [number, number, number] => {
    const node = at(slots.node, index);
    return [at(frame.x, node) + at(slots.dx, index), at(frame.y, node) + at(slots.dy, index), at(frame.z, node) + at(slots.dz, index)];
  };
  const centre = live.reduce<[number, number, number]>((sum, index) => {
    const node = at(slots.node, index);
    return [sum[0] + at(frame.x, node) / live.length, sum[1] + at(frame.y, node) / live.length, sum[2] + at(frame.z, node) / live.length];
  }, [0, 0, 0]);
  const outward = (index: number): number => { const p = place(index); return Math.hypot(p[0] - centre[0], p[2] - centre[2], (p[1] - centre[1]) * 1.3); };
  const heights = live.map((index) => at(frame.y, at(slots.node, index)));
  const low = Math.min(...heights), high = Math.max(...heights);
  const reach = Math.max(0.001, ...live.map(outward));
  for (let index = 0; index < slots.count; index += 1) {
    const up = clamp((at(frame.y, at(slots.node, index)) - low) / Math.max(high - low, 0.5), 0, 1);
    shade[index] = (0.55 + 0.5 * clamp(outward(index) / reach, 0, 1) ** 0.8) * (0.85 + 0.25 * up) * (0.9 + 0.2 * (jitter ? jitter(index) : at(slots.rank, index)));
  }
  return shade;
}

/** A skinned crown: the material's colours, with a little drift per leaf so it still has depth. */
function skinLeafColor(tree: Tree, skin: TreeSkin, frame: TreeFrameLike, index: number): ColorLike {
  const slots = tree.model.leaves;
  const rank = at(slots.rank, index);
  const dead = at(frame.dead, at(slots.node, index));
  tree.a.set(skin.leaves[at(slots.tone, index) % 3] ?? "#ffffff").offsetHSL(((rank * 7.3) % 1 - 0.5) * 0.04, 0, ((rank * 3.1) % 1 - 0.5) * 0.1);
  if (dead > 0.05) tree.a.lerp(tree.b.set("#6e6a66"), clamp(dead * 3, 0, 0.8));
  return tree.a;
}

/** Spring flush and the autumn turn: old needles of an evergreen never turn. */
function seasonLeafColor(tree: Tree, year: YearLike, tone: number, rank: number, colors: TreeColors, turnRank: number): ColorLike {
  const { model, a, b } = tree;
  a.set(colors.leaves[tone] ?? "#6c9a54");
  if (year.flush > 0) a.lerp(b.set((colors.blossom === true ? colors.leaves[2] : colors.spring[tone]) ?? "#a6ce6f"), year.flush * 0.7);
  const oldNeedles = model.species.evergreen ? model.species.phenology.dropMax * 1.4 : 2;
  // `turnRank` is the leaf's own rank, or its clump's: a clump turns together, so autumn comes in patches.
  const turn = rank < oldNeedles ? clamp(year.color * 1.5 - turnRank * 0.5, 0, 1) : 0;
  if (turn > 0) a.lerp(b.set(colors.autumn[(tone + Math.floor(turnRank * 3)) % colors.autumn.length] ?? "#cf6b4e"), turn);
  if (year.withered) a.set(colors.autumn[tone] ?? "#cf6b4e").lerp(b.set("#7d5c3a"), 0.6);
  return a;
}

/** A hybrid's minor kind under the tree's skin keeps a share of its own leaf colour (`clumps`), so an oak limb on an ember cherry still reads as its own section. */
function skinnedLeafColor(tree: Tree, skin: TreeSkin, frame: TreeFrameLike, year: YearLike, index: number, colors: TreeColors): ColorLike {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const kind = tree.features.clumps && year.leaf > 0 ? strainAt(tree, node) : undefined;
  if (kind?.species === undefined || kind.colors === undefined) return skinLeafColor(tree, skin, frame, index);
  const rank = at(slots.rank, index);
  tree.c.copy(seasonLeafColor(tree, year, clumpOf(tree, node) % 3, rank, colors, rank));
  return skinLeafColor(tree, skin, frame, index).lerp(tree.c, 0.45);
}

/** A leaf's season colour: by its own tone and rank, or (`clumps`) its clump's, with the odd leaf catching the light in the palest tone; a clump turns in autumn together. */
function leafSeasonColor(tree: Tree, year: YearLike, index: number, colors: TreeColors): ColorLike {
  const slots = tree.model.leaves;
  const rank = at(slots.rank, index);
  if (!tree.features.clumps) return seasonLeafColor(tree, year, at(slots.tone, index), rank, colors, rank);
  const clump = clumpOf(tree, at(slots.node, index));
  return seasonLeafColor(tree, year, index % 11 === 0 ? 2 : clump % 3, rank, colors, (((clump >>> 8) % 1000) / 1000) * 0.7 + rank * 0.3);
}

/** One leaf's colour for the year: bud, flush, turn, withered, dying, snow on needles. */
function leafColor(tree: Tree, frame: TreeFrameLike, year: YearLike, index: number, snow: number): ColorLike {
  const { model, a, b } = tree;
  const slots = model.leaves;
  const node = at(slots.node, index);
  const skin = strainSkin(tree, node);
  const colors = strainColors(tree, node);
  year = strainYear(tree, node, year);
  if (skin) return skinnedLeafColor(tree, skin, frame, year, index, colors);
  if (year.leaf <= 0) return a.set(colors.trunk[2] ?? "#9a6946").lerp(b.set(colors.leaves[0] ?? "#6c9a54"), 0.25);
  leafSeasonColor(tree, year, index, colors);
  const dead = at(frame.dead, node);
  if (dead > 0.05) a.lerp(b.set("#8a6b45"), clamp(dead * 4, 0, 1));
  // Evergreen needles hold snow on their upper side.
  if (snow > 0 && model.species.evergreen && at(slots.dy, index) > -0.02) a.lerp(b.set("#f2f6fb"), 0.75 * snow);
  return a;
}

function paintLeaves(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, snow: number): void {
  const slots = tree.model.leaves;
  const jitter = tree.features.clumps ? (index: number): number => (clumpOf(tree, at(slots.node, index)) % 1000) / 1000 : undefined;
  const shade = tree.smooth && tree.features.crownShade && (!tree.skin || tree.strains.length > 1) ? crownShade(frame, slots, jitter) : null;
  for (let index = 0; index < slots.count; index += 1) {
    const color = leafColor(tree, frame, year, index, snow);
    if (shade && year.leaf > 0 && !strainSkin(tree, at(slots.node, index))) color.multiplyScalar(at(shade, index));
    mesh.setColorAt(index, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- flowers and fruit

function ornamentSet(tree: Pick<Tree, "lit" | "group" | "model" | "features" | "smooth">, name: OrnamentSet["name"], shape: GeometryLike, litterStart: number, litterLimit: number, spray: GeometryLike | null = null): OrnamentSet | null {
  const spec = name === "fruit" ? tree.model.species.fruit : tree.model.species.flower;
  const slots = name === "fruit" ? tree.model.fruit : tree.model.blossoms;
  if (spec === null || slots.count === 0 || !tree.features[name]) return null;
  const plan = sprayPlan(tree, spec, slots, spray !== null);
  return {
    name, spec, slots, litterStart, litterLimit, strain: -1, ...plan,
    look: ornamentLook(spec, tree.model.species.id),
    mesh: makeMesh(tree, slots.count, name === "fruit" ? 0.62 : 0.7, tree.features.shadows, plan.spray && spray ? spray : shape),
    stride: Math.max(1, Math.ceil(slots.count / Math.max(litterLimit, 1))),
  };
}

/** A minor kind's flowers or fruit as a set of their own (no litter: they fall with the tree's own). */
function kindSet(tree: Pick<Tree, "lit" | "group" | "model" | "features" | "smooth">, kind: TreeKindOrnaments, name: OrnamentSet["name"], shape: GeometryLike, spray: GeometryLike | null = null): OrnamentSet | null {
  const grown = name === "fruit" ? kind.fruit : kind.flower;
  if (!grown || grown.slots.count === 0 || !tree.features[name]) return null;
  const plan = sprayPlan(tree, grown.spec, grown.slots, spray !== null);
  return {
    name, spec: grown.spec, slots: grown.slots, litterStart: 0, litterLimit: 0, strain: kind.strain, stride: 1, ...plan,
    look: ornamentLook(grown.spec, kind.species),
    mesh: makeMesh(tree, grown.slots.count, name === "fruit" ? 0.62 : 0.7, tree.features.shadows, plan.spray && spray ? spray : shape),
  };
}

/** The year a set keeps: a minor kind's own calendar, else the tree's. */
const kindYear = (tree: Tree, set: OrnamentSet, year: YearLike): YearLike => (set.strain >= 0 ? tree.strainYears[set.strain] ?? year : year);

// Flowers and fruit hang from the nodes that bear them, open or ripen each in
// its own turn, and fall in rank order like the leaves.
/** Hanging fruit swings on its stalk, mostly with the wind; fruit that sits up does not. */
function hangSwing(lift: number, wind: number, motion: TreeMotion, rank: number): Offset {
  const swing = lift < 0 ? wind * 0.04 * (0.6 + Math.sin(motion.elapsed * 2.1 + rank * 30)) : 0;
  const dir = motion.windDir ?? 0;
  return { x: swing * Math.cos(dir), z: swing * Math.sin(dir) };
}

// ---------------------------------------------------------------- fruit to eat

/** The name a fruit set goes by in keys: the tree's own "fruit", or "kind<n>" for a minor kind's. */
const setName = (tree: Tree, set: OrnamentSet): string => (set === tree.fruits ? "fruit" : set === tree.flowers ? "flowers" : `kind${String(tree.kinds.indexOf(set))}`);
const eatenSlot = (tree: Tree, set: OrnamentSet, index: number): boolean => set.name === "fruit" && tree.eaten.get(setName(tree, set))?.has(index) === true;
const fruitSets = (tree: Tree): OrnamentSet[] => [tree.fruits, ...tree.kinds].filter((set): set is OrnamentSet => set !== null && set.name === "fruit");

/** A new crop starts clean: once a set has no fruit open, last year's eaten slots are forgotten. */
function forgetEaten(tree: Tree, year: YearLike): void {
  for (const set of fruitSets(tree)) if (ornamentState(set, kindYear(tree, set, year)).open <= 0) tree.eaten.delete(setName(tree, set));
}

/** Where a fruit hangs, still (the wind's sway left out): under its twig, by its own lift. */
function hangingSpot(tree: Tree, set: OrnamentSet, frame: TreeFrameLike, year: YearLike, index: number): { x: number; y: number; z: number; unit: number } {
  const node = at(set.slots.node, index);
  const unit = tree.colors.leafScale * at(set.slots.size, index) * (0.35 + 0.65 * clamp((ornamentState(set, year).open - at(set.slots.rank, index)) * 8, 0, 1));
  return { x: at(frame.x, node) + at(set.slots.dx, index), y: at(frame.y, node) + at(set.slots.dy, index) * 0.5 + set.look.lift * unit, z: at(frame.z, node) + at(set.slots.dz, index), unit };
}

function ripeFruit(tree: Tree): TreeFruit[] {
  const frame = tree.lastFrame;
  const year0 = tree.lastYear;
  const motion = tree.lastMotion;
  if (!frame || !year0 || !motion || motion.dead === true) return [];
  const out: TreeFruit[] = [];
  for (const set of fruitSets(tree)) {
    const year = kindYear(tree, set, year0);
    const { open, fallen } = ornamentState(set, year);
    if (open <= 0 || frame.cycle < set.spec.from) continue;
    const name = setName(tree, set);
    const kind = set.spec.kind;
    for (let index = 0; index < set.slots.count; index += 1) {
      const rank = at(set.slots.rank, index);
      if (rank >= open || rank < fallen || tree.hiddenSlots[set.name].has(index) || eatenSlot(tree, set, index) || ripeness(set, index, year) < 0.7) continue;
      if (!bearingNode(tree, frame, set.spec, at(set.slots.node, index), set.strain >= 0)) continue;
      const spot = hangingSpot(tree, set, frame, year, index);
      out.push({ key: `${name}:${String(index)}`, kind, x: spot.x, y: spot.y, z: spot.z, size: spot.unit * set.look.size[0], hanging: true });
    }
    // Only the tree's own fruit lies under it (a minor kind's drops with it, unseen).
    if (set !== tree.fruits || !tree.meshes.litter || !ornamentsLying(set, year, motion)) continue;
    for (let slot = 0; slot < set.litterLimit; slot += 1) {
      const index = slot * set.stride;
      if (!soundBearer(set, frame, index) || at(set.slots.rank, index) >= fallen || eatenSlot(tree, set, index)) continue;
      const spot = litterSpot(tree, frame, set.slots, index, 0.45);
      const unit = tree.colors.leafScale * at(set.slots.size, index);
      out.push({ key: `${name}:${String(index)}`, kind, x: spot.x, y: tree.ground.y + 0.02 + unit * set.look.size[2] * 0.5, z: spot.z, size: unit * set.look.size[0], hanging: false });
    }
  }
  return out;
}

function eatFruit(tree: Tree, key: string): boolean {
  const cut = key.lastIndexOf(":");
  const name = key.slice(0, cut);
  const index = Number(key.slice(cut + 1));
  const set = fruitSets(tree).find((each) => setName(tree, each) === name);
  if (!set || !Number.isInteger(index) || index < 0 || index >= set.slots.count) return false;
  const eaten = tree.eaten.get(name) ?? new Set<number>();
  if (eaten.has(index)) return false;
  eaten.add(index);
  tree.eaten.set(name, eaten);
  return true;
}

/** A set's slots that are falling or eaten right now (looked up by number, once per slot per frame). */
function goneSlots(tree: Tree, set: OrnamentSet): (index: number) => boolean {
  const hidden = tree.hiddenSlots[set.name];
  const eaten = set.name === "fruit" ? tree.eaten.get(setName(tree, set)) : undefined;
  return eaten ? (index) => hidden.has(index) || eaten.has(index) : (index) => hidden.has(index);
}

/** The sway field's offset into `tree.offset`, or none when the host moves the tree itself. */
function stillOrSway(tree: Tree, x: number, y: number, z: number, motion: TreeMotion, wind: number, height: number): void {
  if (tree.still) { tree.offset.x = 0; tree.offset.z = 0; return; }
  sway(tree.offset, x, y, z, motion.elapsed, wind * (motion.field ?? 1), height, motion.windDir);
}

function poseOrnaments(tree: Tree, set: OrnamentSet, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const { spec, slots, mesh, look } = set;
  const { open, fallen } = ornamentState(set, year);
  mesh.visible = motion.dead !== true && open > 0 && fallen < 1 && frame.cycle >= spec.from;
  if (!mesh.visible) return;
  const array = mesh.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind : 0;
  const gone = goneSlots(tree, set);
  // A young crown's sprays stay near life size, so its twigs read through them.
  const grow = 1 + (set.grow - 1) * clamp(frame.visible / 1500, 0.2, 1);
  // Thinned slots were cleared when the mesh was made and stay cleared.
  for (let index = 0; index < slots.count; index += set.thin) {
    const node = at(slots.node, index);
    const rank = at(slots.rank, index);
    if (rank >= open || rank < fallen || gone(index) || !bearingNode(tree, frame, spec, node, set.strain >= 0)) { clearSlot(array, index); continue; }
    const unit = tree.colors.leafScale * at(slots.size, index) * grow * (0.35 + 0.65 * clamp((open - rank) * 8, 0, 1));
    const x = at(frame.x, node) + at(slots.dx, index);
    const z = at(frame.z, node) + at(slots.dz, index);
    const y = at(frame.y, node) + at(slots.dy, index) * 0.5 + look.lift * unit;
    stillOrSway(tree, x, y, z, motion, wind, height);
    const swing = hangSwing(look.lift, wind, motion, rank);
    writeBox(array, index, x + tree.offset.x + swing.x, y, z + tree.offset.z + swing.z, look.size[0] * unit, look.size[1] * unit, look.size[2] * unit, rank * TAU);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Which colours a blossom opens in: one of the mixed blooms by share, else
 * its strain's spring colours. Colours go by twig cluster, so each spray opens
 * in one colour and a mixed tree reads as sprays of each, not speckle.
 */
function bloomColors(tree: Tree, index: number, colors: TreeColors, node: number): readonly string[] {
  if (tree.blooms.length === 0) return colors.spring;
  const total = tree.blooms.reduce((sum, bloom) => sum + bloom.share, 0);
  // A colour holds for a whole main limb (up to where it leaves the trunk), so each limb opens in one colour.
  let spray = node;
  const { parent, order } = tree.model;
  if (parent && order) {
    for (let up = at(parent, spray); up >= 0 && at(order, up) > 0; up = at(parent, spray)) spray = up;
  }
  let roll = ((hash32(spray * 2246822519 + 7) % 10000) / 10000) * total;
  for (const bloom of tree.blooms) if ((roll -= bloom.share) < 0) return bloom.colors;
  return tree.blooms[tree.blooms.length - 1]?.colors ?? colors.spring;
}

/** How ripe a fruit is, 0 (green) to 1: each sets green and colours at its own pace. A fruit with no green look is ripe as it opens. */
const ripeness = (set: OrnamentSet, index: number, year: YearLike): number =>
  set.look.green === undefined ? 1 : clamp(year.fruit * 1.8 - 0.7 - at(set.slots.rank, index) * 0.3, 0, 1);

function ornamentColor(tree: Tree, set: OrnamentSet, index: number, year: YearLike): ColorLike {
  const { a, b } = tree;
  const node = at(set.slots.node, index);
  const colors = strainColors(tree, node);
  const skin = strainSkin(tree, node);
  const tone = at(set.slots.tone, index);
  const rank = at(set.slots.rank, index);
  if (set.spec.kind === "blossom") {
    const fade = clamp((year.petals - rank + 0.25) * 3, 0, 1);
    const petals = bloomColors(tree, index, colors, node);
    // A spray takes one tone for its whole twig, a touch richer: its own shape carries the light and shade.
    const own = set.spray ? clumpOf(tree, node) % petals.length : tone % petals.length;
    a.set(petals[own] ?? "#f6bacb");
    if (set.spray) a.offsetHSL(0, 0.16, -0.06);
    a.lerp(b.set("#fff4f6"), fade * 0.6);
  } else {
    const palette = set.look.colors ?? ["#ffffff"];
    a.set(palette[tone % palette.length] ?? "#ffffff");
    // Fruit sets green and ripens to colour, each one at its own pace.
    if (set.look.green !== undefined) a.lerp(b.set(set.look.green), 1 - ripeness(set, index, year));
  }
  // A skinned tree's flowers and fruit take its material: a golden tree bears golden cherries.
  // With `clumps` fruit keeps most of its own colour, so a red apple still reads on a golden crown.
  const worn = set.name === "fruit" && tree.features.clumps ? 0.2 : 0.82;
  if (skin) a.lerp(b.set(skin.leaves[(index + 1) % skin.leaves.length] ?? "#ffffff"), worn);
  return a;
}

function paintOrnaments(tree: Tree, set: OrnamentSet, year: YearLike): void {
  for (let index = 0; index < set.slots.count; index += set.thin) set.mesh.setColorAt(index, ornamentColor(tree, set, index, year));
  if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- litter

/** Where a fallen leaf from `index` lies: under its twig, scattered by the drop, kept on the ground. */
function litterSpot(tree: Tree, frame: TreeFrameLike, slots: SlotsLike, index: number, scatterScale: number): { x: number; z: number } {
  const node = at(slots.node, index);
  const scatter = (1.4 + at(slots.size, index) * 1.6) * scatterScale;
  let x = at(frame.x, node) + at(slots.dx, index) * scatter + (at(slots.rank, index) - 0.5) * 0.9 * scatterScale;
  let z = at(frame.z, node) + at(slots.dz, index) * scatter + (at(slots.size, index) - 1) * 1.6 * scatterScale;
  const reach = Math.hypot(x, z);
  const lip = tree.ground.lip?.(Math.atan2(z, x));
  const limit = lip === undefined ? tree.ground.radius : Math.min(tree.ground.radius, lip - 0.3);
  if (reach > limit) { x *= limit / reach; z *= limit / reach; }
  return { x, z };
}

function poseLeafLitter(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const { model, leafStride, ground } = tree;
  const array = mesh.instanceMatrix.array;
  // Only twigs that carry leaves this year drop them: a sapling has few, and an
  // old tree's dead or shed limbs have none.
  const tipLimit = leafTipLimit(tree);
  const seedling = frame.visible <= 4;
  for (let slot = 0; slot < tree.limits.litter; slot += 1) {
    const index = slot * leafStride;
    const node = at(model.leaves.node, index);
    const bore = index < model.leaves.count && motion.dead !== true && at(frame.grow, node) > 0 && (seedling || leafyNode(frame, node, tipLimit));
    if (!bore || motion.snowed === true || at(model.leaves.rank, index) >= year.litter) { clearSlot(array, slot); continue; }
    const spot = litterSpot(tree, frame, model.leaves, index, 1);
    const lie = at(model.leaves.rank, index) * 31;
    const y = ground.y + 0.015 + (slot % 3) * 0.006;
    const size = tree.colors.leafScale * at(model.leaves.size, index);
    // A fallen blade lies flat along a random heading, a little curled.
    if (tree.blades) writeBlade(array, slot, [spot.x, y, spot.z], [Math.cos(lie), 0, Math.sin(lie)], size * 1.9, { droop: 0, twist: 0.25 * Math.sin(lie * 3), nod: 0 });
    else writeVoxel(array, slot, spot.x, y, spot.z, size, lie, 0.22);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function ornamentsLying(set: OrnamentSet, year: YearLike, motion: TreeMotion): boolean {
  const { open, fallen } = ornamentState(set, year);
  if (set.look.fall <= 0 || fallen <= 0 || open <= 0 || motion.snowed === true) return false;
  return set.name === "fruit" || fallen < 1 || year.leaf < 0.9;
}

function soundBearer(set: OrnamentSet, frame: TreeFrameLike, index: number): boolean {
  const node = at(set.slots.node, index);
  return index < set.slots.count && at(frame.grow, node) > 0.25 && at(frame.dead, node) < 0.25 && at(frame.fall, node) === 0;
}

/** Dropped flowers and fruit under the tree: petals until the leaves are out, fruit until spring. */
function poseOrnamentLitter(tree: Tree, set: OrnamentSet, frame: TreeFrameLike, year: YearLike, motion: TreeMotion, array: Float32Array): void {
  const { fallen } = ornamentState(set, year);
  const look = set.look;
  const lying = ornamentsLying(set, year, motion);
  for (let slot = 0; slot < set.litterLimit; slot += 1) {
    const index = slot * set.stride;
    const target = set.litterStart + slot;
    if (!lying || !soundBearer(set, frame, index) || at(set.slots.rank, index) >= fallen || eatenSlot(tree, set, index)) { clearSlot(array, target); continue; }
    const spot = litterSpot(tree, frame, set.slots, index, set.name === "fruit" ? 0.45 : 1);
    const unit = tree.colors.leafScale * at(set.slots.size, index);
    const flat = set.name === "fruit" ? 1 : 0.2;
    writeBox(array, target, spot.x, tree.ground.y + 0.02 + unit * look.size[2] * 0.5 * flat, spot.z, look.size[0] * unit, look.size[2] * unit * flat, look.size[1] * unit, at(set.slots.rank, index) * 17);
  }
}

function poseLitter(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const { leafLitter, litter } = tree.meshes;
  if (leafLitter) poseLeafLitter(tree, leafLitter, frame, year, motion);
  if (!litter) return;
  const array = litter.instanceMatrix.array;
  for (const set of [tree.flowers, tree.fruits]) if (set) poseOrnamentLitter(tree, set, frame, year, motion, array);
  litter.instanceMatrix.needsUpdate = true;
}

function paintLitter(tree: Tree, year: YearLike): void {
  const { model, meshes, a, b, colors, leafStride } = tree;
  const leafLitter = meshes.leafLitter;
  if (leafLitter) {
    for (let slot = 0; slot < tree.limits.litter; slot += 1) {
      const index = Math.min(slot * leafStride, Math.max(model.leaves.count - 1, 0));
      const tone = at(model.leaves.tone, index);
      // Old litter browns as it rots into the turf.
      const age = year.drop <= 0 ? 1 : clamp((year.drop - at(model.leaves.rank, index)) * 2, 0, 1);
      if (tree.skin) a.set(tree.skin.leaves[tone % 3] ?? "#ffffff").multiplyScalar(0.85);
      else a.set(colors.autumn[tone] ?? "#cf6b4e").lerp(b.set("#7a5a3c"), 0.25 + age * 0.5);
      leafLitter.setColorAt(slot, a);
    }
    if (leafLitter.instanceColor) leafLitter.instanceColor.needsUpdate = true;
  }
  if (meshes.litter) paintOrnamentLitter(tree, meshes.litter);
}

function paintOrnamentLitter(tree: Tree, mesh: InstancedLike): void {
  const { a, b, colors } = tree;
  for (const set of [tree.flowers, tree.fruits]) {
    if (!set) continue;
    const palette = set.look.colors ?? colors.spring;
    for (let slot = 0; slot < set.litterLimit; slot += 1) {
      if (set.spec.kind === "blossom") a.set(colors.spring[slot % colors.spring.length] ?? "#f6bacb");
      else a.set(palette[slot % palette.length] ?? "#ffffff").lerp(b.set("#6b5038"), set.name === "fruit" ? 0.15 : 0.35);
      if (tree.skin) a.lerp(b.set(tree.skin.leaves[(slot + 1) % tree.skin.leaves.length] ?? "#ffffff"), 0.82).multiplyScalar(0.85);
      mesh.setColorAt(set.litterStart + slot, a);
    }
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- snow on the limbs

/** Snow settles in a thin slab along the top of every limb that is not too steep. */
function poseSnow(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, motion: TreeMotion): void {
  const cover = motion.snow ?? 0;
  mesh.visible = cover > 0;
  if (!mesh.visible) return;
  const array = mesh.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind : 0;
  for (let node = 0; node < tree.model.count; node += 1) {
    const radius = at(frame.radius, node);
    const dx = at(frame.x, node) - at(frame.baseX, node);
    const dy = at(frame.y, node) - at(frame.baseY, node);
    const dz = at(frame.z, node) - at(frame.baseZ, node);
    const level = Math.hypot(dx, dz);
    if (at(frame.grow, node) < 1 || radius < 0.035 || at(frame.rot, node) > 0.5 || level < Math.abs(dy) * 0.7) { clearSlot(array, node); continue; }
    const depth = (0.03 + radius * 0.35) * cover;
    const mx = (at(frame.x, node) + at(frame.baseX, node)) / 2;
    const my = (at(frame.y, node) + at(frame.baseY, node)) / 2;
    const mz = (at(frame.z, node) + at(frame.baseZ, node)) / 2;
    stillOrSway(tree, mx, my, mz, motion, at(frame.fall, node) > 0 ? 0 : wind, height);
    writeBox(array, node, mx + tree.offset.x, my + radius + depth / 2, mz + tree.offset.z, radius * 2.1, depth, level + radius, Math.atan2(dx, dz));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- falling leaves, petals and fruit

interface FallSource {
  readonly slots: SlotsLike;
  readonly front: number;
  readonly ok: (index: number) => boolean;
  readonly key: (index: number) => string;
  readonly shape: (index: number) => readonly [number, number, number];
  readonly color: (index: number) => string;
  readonly fall: number;
}

// Leaves, petals and fruit that fall are the tree's own: the next ones due to
// drop leave their twig, tumble (or plummet) down, and lie where they land.
function fallSource(tree: Tree, frame: TreeFrameLike, year: YearLike, kind: Faller["kind"]): FallSource | null {
  const { model } = tree;
  if (kind === "leaf") {
    const tipLimit = leafTipLimit(tree);
    const leaves = model.leaves;
    return {
      slots: leaves, front: year.drop, fall: 0.8,
      ok: (index) => leafyNode(frame, at(leaves.node, index), tipLimit),
      key: (index) => `leaf:${String(index)}`,
      shape: (index) => [at(leaves.size, index), at(leaves.size, index), at(leaves.size, index)],
      color: (index) => (tree.skin ? tree.skin.leaves[at(leaves.tone, index) % 3] : tree.colors.autumn[at(leaves.tone, index)]) ?? "#cf6b4e",
    };
  }
  const set = kind === "fruit" ? tree.fruits : tree.flowers;
  if (!set) return null;
  const { open, fallen } = ornamentState(set, year);
  return {
    slots: set.slots, front: fallen, fall: set.look.fall,
    ok: (index) => at(set.slots.rank, index) < open && bearingNode(tree, frame, set.spec, at(set.slots.node, index)),
    key: (index) => `${set.name}:${String(index)}`,
    shape: (index) => [set.look.size[0] * at(set.slots.size, index), set.look.size[1] * at(set.slots.size, index), set.look.size[2] * at(set.slots.size, index)],
    color: (index) => `#${ornamentColor(tree, set, index, year).getHexString()}`,
  };
}

function spawnFaller(tree: Tree, frame: TreeFrameLike, year: YearLike, kind: Faller["kind"]): Faller | null {
  const source = fallSource(tree, frame, year, kind);
  if (!source) return null;
  const { slots } = source;
  const random = tree.random;
  for (let attempt = 0; attempt < 16 && slots.count > 0; attempt += 1) {
    const index = Math.floor(random() * slots.count);
    const rank = at(slots.rank, index);
    const key = source.key(index);
    if (rank < source.front || rank > source.front + 0.08 || tree.hidden.has(key) || !source.ok(index)) continue;
    const node = at(slots.node, index);
    tree.hidden.set(key, { rank, kind, index });
    tree.hiddenSlots[kind].add(index);
    const [sx, sy, sz] = source.shape(index);
    const unit = tree.colors.leafScale;
    return {
      key, kind, speed: source.fall, landed: false, color: source.color(index),
      x: at(frame.x, node) + at(slots.dx, index), y: at(frame.y, node) + at(slots.dy, index) * 0.5, z: at(frame.z, node) + at(slots.dz, index),
      vx: (random() - 0.5) * 0.3, vz: (random() - 0.5) * 0.3, phase: random() * TAU,
      size: [sx * unit, sy * unit, sz * unit],
    };
  }
  return null;
}

/** How fast each kind is falling right now (spawns per second). */
function fallRates(tree: Tree, year: YearLike, dead: boolean): Record<Faller["kind"], number> {
  if (dead) return { leaf: 0, flowers: 0, fruit: 0 };
  const dropMax = tree.model.species.phenology.dropMax;
  const rate = (set: OrnamentSet | null, per: number): number => {
    if (!set || set.look.fall <= 0) return 0;
    const { open, fallen } = ornamentState(set, year);
    return fallen > 0.005 && fallen < 0.995 && open > 0.5 ? per : 0;
  };
  return { leaf: year.drop > 0.005 && year.drop < dropMax - 0.005 && tree.features.leaves ? 3.2 : 0, flowers: rate(tree.flowers, 4), fruit: rate(tree.fruits, 1.2) };
}

function fallFront(tree: Tree, year: YearLike, kind: Faller["kind"]): number {
  if (kind === "leaf") return year.drop;
  const set = kind === "fruit" ? tree.fruits : tree.flowers;
  return set ? ornamentState(set, year).fallen : 1;
}

function moveFaller(tree: Tree, faller: Faller, elapsed: number, delta: number, wind: number, dir = 0): void {
  if (faller.landed) return;
  // Heavy fruit drops nearly straight; leaves and petals flutter and drift downwind.
  const drift = faller.speed > 1.5 ? 0.15 : 1;
  const flutter = Math.sin(elapsed * 2.4 + faller.phase);
  const side = Math.cos(elapsed * 1.7 + faller.phase) * 0.3;
  const push = wind * 1.4 + flutter * 0.2;
  faller.vx += ((push * Math.cos(dir) - side * Math.sin(dir)) * drift - faller.vx) * delta;
  faller.vz += ((push * Math.sin(dir) + side * Math.cos(dir)) * drift - faller.vz) * delta;
  faller.x += faller.vx * delta;
  faller.z += faller.vz * delta;
  faller.y -= delta * faller.speed * (drift < 1 ? 1 : 0.7 + 0.3 * Math.abs(flutter));
  const limit = tree.ground.radius + 1;
  const reach = Math.hypot(faller.x, faller.z);
  if (reach > limit) { faller.x *= limit / reach; faller.z *= limit / reach; }
  if (faller.y <= tree.ground.y + 0.02) { faller.y = tree.ground.y + 0.02; faller.landed = true; }
}

function spawnFallers(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const rates = fallRates(tree, year, motion.dead === true);
  const total = rates.leaf + rates.flowers + rates.fruit;
  tree.spawnClock += (motion.delta ?? 0) * total * (1 + motion.wind * 2);
  while (tree.spawnClock >= 1 && total > 0) {
    tree.spawnClock -= 1;
    let pick = tree.random() * total;
    const kind: Faller["kind"] = (pick -= rates.leaf) < 0 ? "leaf" : (pick -= rates.flowers) < 0 ? "flowers" : "fruit";
    const faller = spawnFaller(tree, frame, year, kind);
    if (faller === null) continue;
    if (tree.fallers.length >= tree.limits.falling) tree.fallers.shift();
    tree.fallers.push(faller);
  }
  for (const [key, held] of tree.hidden) {
    if (held.rank >= fallFront(tree, year, held.kind)) continue;
    tree.hidden.delete(key);
    tree.hiddenSlots[held.kind].delete(held.index);
  }
}

function drawFaller(tree: Tree, faller: Faller, slot: number, mesh: InstancedLike, elapsed: number): void {
  const spin = faller.landed ? faller.phase : elapsed * (faller.speed > 1.5 ? 0.6 : 2.2) + faller.phase;
  const [sx, sy, sz] = faller.size;
  const array = mesh.instanceMatrix.array;
  if (tree.blades && faller.kind === "leaf") {
    // A falling blade tumbles end over end and side to side, then lies flat.
    const tumble = faller.landed ? 0 : Math.sin(spin * 0.8) * 0.9;
    writeBlade(array, slot, [faller.x, faller.y, faller.z], [Math.cos(spin), tumble, Math.sin(spin)], sx * 1.9, { droop: 0, twist: faller.landed ? 0.2 : spin * 1.3, nod: 0 });
  } else {
    const flat = faller.landed && faller.speed <= 1.5 ? 0.22 : 1;
    writeBox(array, slot, faller.x, faller.y, faller.z, sx, sy * flat, sz, spin);
  }
  mesh.setColorAt(slot, tree.a.set(faller.color));
}

function drawFallers(tree: Tree, falling: InstancedLike, fallingLeaves: InstancedLike, motion: TreeMotion): void {
  const array = falling.instanceMatrix.array;
  const leafArray = fallingLeaves.instanceMatrix.array;
  for (let slot = 0; slot < tree.limits.falling; slot += 1) {
    const faller = tree.fallers[slot];
    clearSlot(array, slot);
    clearSlot(leafArray, slot);
    if (faller === undefined) continue;
    moveFaller(tree, faller, motion.elapsed, motion.delta ?? 0, motion.wind, motion.windDir);
    drawFaller(tree, faller, slot, tree.blades && faller.kind === "leaf" ? fallingLeaves : falling, motion.elapsed);
  }
  for (const mesh of [falling, fallingLeaves]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- assembly

function paintAll(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const dead = motion.dead === true;
  paintWood(tree, frame, dead);
  if (tree.meshes.leaves) paintLeaves(tree, tree.meshes.leaves, frame, year, motion.snow ?? 0);
  for (const set of [tree.flowers, tree.fruits]) if (set) paintOrnaments(tree, set, year);
  for (const set of tree.kinds) paintOrnaments(tree, set, kindYear(tree, set, year));
  paintLitter(tree, year);
}

function paintKeyOf(year: YearLike, motion: TreeMotion): string {
  const values = [year.leaf, year.color, year.flush, year.drop, year.petals, year.fruit, motion.snow ?? 0];
  return values.map((value) => Math.round(value * 60)).join(":") + (year.withered ? ":withered" : "") + (motion.dead === true ? ":dead" : "");
}

function update(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  tree.strainYears = motion.strainYears ?? [];
  tree.lastYear = year;
  tree.lastMotion = motion;
  tree.still = motion.field === 0;
  forgetEaten(tree, year);
  const key = [year, ...tree.strainYears.filter((own): own is YearLike => own !== undefined)].map((own) => paintKeyOf(own, motion)).join("|");
  if (frame !== tree.lastFrame || key !== tree.paintKey) {
    paintAll(tree, frame, year, motion);
    tree.paintKey = key;
    tree.lastFrame = frame;
  }
  const { meshes } = tree;
  poseWood(tree, frame, motion);
  if (meshes.leaves) poseLeaves(tree, meshes.leaves, frame, year, motion);
  for (const set of [tree.flowers, tree.fruits]) if (set) poseOrnaments(tree, set, frame, year, motion);
  for (const set of tree.kinds) poseOrnaments(tree, set, frame, kindYear(tree, set, year), motion);
  poseLitter(tree, frame, year, motion);
  if (meshes.snow) poseSnow(tree, meshes.snow, frame, motion);
  if (meshes.falling && meshes.fallingLeaves) {
    spawnFallers(tree, frame, year, motion);
    drawFallers(tree, meshes.falling, meshes.fallingLeaves, motion);
  }
}

interface Build {
  readonly lit: LitLike;
  readonly group: NodeLike;
  readonly model: TreeModelLike;
  readonly features: TreeFeatures;
  readonly limits: Required<TreeLimits>;
  readonly smooth: boolean;
}

function shapesFor(build: Build, options: TreeRenderOptions): { wood: GeometryLike; leaf: GeometryLike; blade: GeometryLike; bud: GeometryLike } {
  const base = treeShapes(build.lit);
  const own = options.shapes ?? {};
  if (!build.smooth) {
    const leaf = own.leaf ?? base.box;
    return { wood: base.box, leaf, blade: leaf, bud: base.box };
  }
  const blade = speciesBlade(build.lit, build.model.species.id);
  return { wood: base.wood, leaf: base.leaf, blade: build.features.clumps && blade === base.blade ? base.softBlade : blade, bud: base.bud, ...own };
}

const hasOrnaments = (features: TreeFeatures): boolean => features.flowers || features.fruit;

function woodMesh(build: Build, shape: GeometryLike, groundY: number): InstancedLike {
  const wood = makeMesh(build, build.model.count + build.model.roots.length * ROOT_SEGMENTS, 0.86, build.features.shadows, shape);
  if (build.smooth && build.features.bark) {
    wood.material.dispose();
    wood.material = barkMaterial(build.lit, groundY, build.features.rootSink, build.features.rootBreak);
  }
  return wood;
}

/**
 * Sprays let a little light through their petals: a faint glow in the petal colour,
 * lost in daylight, keeps a blossom crown pink at dusk instead of sinking to the
 * night's blue-black with the leaves.
 */
function glowPetals(mesh: InstancedLike, colors: TreeColors): void {
  const material = mesh.material as MaterialLike & { emissive?: ColorLike; emissiveIntensity?: number };
  if (!material.emissive) return;
  material.emissive.set(colors.spring[0] ?? "#f6bacb");
  material.emissiveIntensity = 0.16;
}

/** A skin's own leaf shape (crystal, coin) stays its flowers' shape too; a natural crown opens in sprays. */
const sprayShape = (build: Build, options: TreeRenderOptions): GeometryLike | null => (build.smooth && !options.shapes?.leaf ? treeShapes(build.lit).spray : null);

function buildMeshes(build: Build, options: TreeRenderOptions): { meshes: TreeMeshes; flowers: OrnamentSet | null; fruits: OrnamentSet | null; kinds: OrnamentSet[] } {
  const { model, features, limits } = build;
  const shapes = shapesFor(build, options);
  const leafShape = shapes.blade;
  const shadows = features.shadows;
  const on = <T>(flag: boolean, make: () => T): T | null => (flag ? make() : null);
  const wood = woodMesh(build, shapes.wood, options.ground?.y ?? 0);
  const meshes: TreeMeshes = {
    wood,
    leaves: on(features.leaves, () => makeMesh(build, model.leaves.count, 0.78, shadows, leafShape, build.smooth)),
    flowers: null,
    fruit: null,
    leafLitter: on(features.litter && features.leaves, () => makeMesh(build, limits.litter, 0.92, false, leafShape, build.smooth)),
    litter: on(features.litter && hasOrnaments(features), () => makeMesh(build, limits.litter + limits.flowerLitter + limits.fruitLitter, 0.92, false, shapes.leaf)),
    snow: on(features.snow, () => makeMesh(build, model.count, 0.55, false, shapes.leaf)),
    falling: on(features.fallers, () => makeMesh(build, limits.falling, 0.78, shadows, shapes.leaf)),
    fallingLeaves: on(features.fallers, () => makeMesh(build, limits.falling, 0.78, shadows, leafShape, build.smooth)),
    shards: on(features.rootBreak && features.roots && build.smooth && options.ground?.lip !== undefined && !model.species.palm, () => makeMesh(build, model.roots.length * ROOT_SHARDS, 0.95, shadows, treeShapes(build.lit).box)),
  };
  meshes.snow?.material.color.set("#f4f8ff");
  const spray = sprayShape(build, options);
  const flowers = ornamentSet(build, "flowers", build.smooth ? shapes.leaf : shapes.wood, limits.litter, limits.flowerLitter, spray);
  if (flowers?.spray === true) glowPetals(flowers.mesh, options.colors);
  const fruits = ornamentSet(build, "fruit", build.smooth ? shapes.bud : shapes.wood, limits.litter + limits.flowerLitter, limits.fruitLitter);
  const kinds = (options.kinds ?? []).flatMap((kind) => [kindSet(build, kind, "flowers", build.smooth ? shapes.leaf : shapes.wood, spray), kindSet(build, kind, "fruit", build.smooth ? shapes.bud : shapes.wood)]).filter((set): set is OrnamentSet => set !== null);
  return { meshes: { ...meshes, flowers: flowers?.mesh ?? null, fruit: fruits?.mesh ?? null }, flowers, fruits, kinds };
}

/** One grown tree as live instanced meshes. Build once per model; call `update` every frame. */
export function createTreeRender(lit: LitLike, model: TreeModelLike, options: TreeRenderOptions): TreeRender {
  const features = treeFeatures(options.features ?? {});
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const smooth = options.form !== "voxel";
  const group = new lit.Group();
  const build: Build = { lit, group, model, features, limits, smooth };
  const { meshes, flowers, fruits, kinds } = buildMeshes(build, options);
  const tree: Tree = {
    lit, model, colors: options.colors, features, smooth, group, meshes, flowers, fruits, kinds, limits,
    ground: options.ground ?? { y: 0, radius: 4.4 },
    blades: smooth,
    needles: smooth && !options.shapes?.blade && NEEDLE_KINDS[model.species.id] !== undefined,
    fronds: smooth && !options.shapes?.blade ? frondLayout(model) : null,
    skin: options.skin ?? null,
    strains: options.strains ?? [], strainOf: options.strainOf ?? null, strainYears: [], blooms: (options.blooms ?? []).filter((bloom) => bloom.share > 0 && bloom.colors.length > 0),
    leafStride: Math.max(1, Math.ceil(model.leaves.count / limits.litter)),
    hidden: new Map(), hiddenSlots: { leaf: new Set(), flowers: new Set(), fruit: new Set() }, eaten: new Map(), lastYear: null, lastMotion: null, fallers: [], random: seededRandom((options.seed ?? 1) ^ 0x51f7),
    a: new lit.Color(), b: new lit.Color(), c: new lit.Color(), offset: { x: 0, z: 0 },
    spawnClock: 0, paintKey: "", lastFrame: null, still: false,
    seed: options.seed ?? 1, breaks: { trunk: -1, plans: [] },
  };
  return {
    group, features, meshes, fallers: tree.fallers, kinds: kinds.map((set) => set.mesh),
    update: (frame, year, motion) => { update(tree, frame, year, motion); },
    fruit: () => ripeFruit(tree),
    eat: (key) => eatFruit(tree, key),
    repaint: () => { tree.paintKey = ""; },
    dispose: () => {
      for (const mesh of [...(Object.values(meshes) as (InstancedLike | null)[]), ...kinds.map((set) => set.mesh)]) {
        if (!mesh) continue;
        mesh.material.dispose();
        mesh.dispose();
      }
    },
  };
}

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

/** What a tree is cut down to at one level: real wood down to `wood`, up to `leaves` real leaves (`fill` blades each when they are few), and, for `clumps`, the crown's own masses as lumps under them. */
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

interface CardRow {
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

/** Appends a template shape moved by a column-major matrix whose columns are square to each other (so normals scale by 1/|column|²). */
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

/** The crown's real masses: its leaves gathered by where they grow, each gathering a lump in its own place, size, tone and shade. */
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

interface Vector4Like { x: number; y: number; z: number; w: number }

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

// ---------------------------------------------------------------- impostor cards (the sprite ladder)

const MAX_VARIANTS = 8;

const CARD_VERTEX = /* glsl */ `
#define MAXV ${String(MAX_VARIANTS)}
attribute vec2 aCard;
uniform vec3 uBox[MAXV];
uniform float uFrames, uRows;
varying vec2 vCardUv;
varying float vTint, vLodDistance, vViewDepth, vFogDepth;
void main() {
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  vec3 box = uBox[int(aCard.x + 0.5)];
  vec3 toCamera = cameraPosition - origin;
  vec3 dir = normalize(vec3(toCamera.x, 0.0, toCamera.z) + vec3(1e-5, 0.0, 0.0));
  vec3 right = vec3(dir.z, 0.0, -dir.x);
  // Pick the baked view nearest the camera's angle round this tree.
  float view = atan(dir.x, dir.z) - yaw;
  float frame = mod(floor(view / 6.2831853 * uFrames + 0.5), uFrames);
  vec3 world = origin + right * position.x * box.x * 2.0 * scale + vec3(0.0, ((position.y + 0.5) * box.y + box.z) * scale, 0.0);
  vCardUv = vec2((frame + position.x + 0.5) / uFrames, (aCard.x + position.y + 0.5) / uRows);
  vTint = aCard.y;
  vLodDistance = length(toCamera);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vViewDepth = -mv.z;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const CARD_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uLight;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform vec4 uLod;
varying vec2 vCardUv;
varying float vTint, vLodDistance, vViewDepth, vFogDepth;
float forestBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
void main() {
  float t = forestBayer(gl_FragCoord.xy);
  // The card takes over exactly where the geometry dithers away.
  if (smoothstep(uLod.x + uLod.y, uLod.x - uLod.y, vLodDistance) > t) discard;
  if (smoothstep(uLod.z, uLod.w, vViewDepth) < t) discard;
  vec4 texel = texture2D(uAtlas, vCardUv);
  if (texel.a < 0.5) discard;
  vec3 color = texel.rgb * uLight * vTint;
  float fog = uFog.y > uFog.x ? smoothstep(uFog.x, uFog.y, vFogDepth) : 0.0;
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}`;

interface Cards {
  readonly mesh: InstancedLike;
  readonly material: MaterialLike;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly card: Float32Array;
  readonly target: InstanceType<ForestLitLike["RenderTarget"]>;
  readonly frames: number;
  readonly cell: number;
  /** The tree shapes the atlas is rendered from, kept while cards are drawn: the seasons re-render it. */
  readonly rows: readonly CardRow[];
  readonly capacity: number;
  key: string;
  idle: number;
}

function createCards(lit: ForestLitLike, baked: readonly CardRow[], count: number, options: ForestOptions, lod: Vector4Like): Cards {
  const frames = options.frames ?? 8;
  const cell = options.cell ?? 160;
  const target = new lit.RenderTarget(frames * cell, baked.length * cell, { depthBuffer: true });
  const boxes = Array.from({ length: MAX_VARIANTS }, (_, i) => {
    const box = baked[i]?.box;
    return new lit.Vector3(box?.half ?? 1, box?.height ?? 1, box?.base ?? 0);
  });
  const uniforms: Record<string, { value: unknown }> = {
    uAtlas: { value: target.texture }, uFrames: { value: frames }, uRows: { value: baked.length }, uBox: { value: boxes },
    uLight: { value: new lit.Vector3(1, 1, 1) }, uFogColor: { value: new lit.Vector3(1, 1, 1) }, uFog: { value: { x: 0, y: 0 } }, uLod: { value: lod },
  };
  const material = new lit.CustomMaterial({ uniforms, vertexShader: CARD_VERTEX, fragmentShader: CARD_FRAGMENT, side: "both" });
  const card = new Float32Array(Math.max(1, count) * 2);
  const geometry = lit.plane(1, 1);
  geometry.setAttribute("aCard", new lit.InstanceAttribute(card, 2));
  const mesh = new lit.Instances(geometry, material, Math.max(1, count));
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, material, uniforms, card, target, frames, cell, rows: baked, capacity: Math.max(1, count), key: "", idle: 0 };
}

/** Renders every variant from `frames` angles round it into one atlas row each. */
function bakeCards(lit: ForestLitLike, renderer: RendererLike, cards: Cards, baked: readonly CardRow[]): void {
  const scene = new lit.Stage();
  const hemi = new lit.SkyLight("#ffffff", "#5a5a50", 1.9);
  const key = new lit.SunLight("#ffffff", 2.4);
  scene.add(hemi, key);
  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new lit.Color());
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(cards.target);
  renderer.setClearColor(new lit.Color("#000000"), 0);
  cards.target.scissorTest = false;
  cards.target.viewport.set(0, 0, cards.frames * cards.cell, baked.length * cards.cell);
  renderer.setRenderTarget(cards.target);
  renderer.clear(true, true, false);
  baked.forEach((variant, row) => { bakeRow(lit, renderer, cards, scene, key, variant, row); });
  cards.target.scissorTest = false;
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
  renderer.autoClear = autoClear;
}

function bakeRow(lit: ForestLitLike, renderer: RendererLike, cards: Cards, scene: NodeLike, light: NodeLike, variant: CardRow, row: number): void {
  const { half, height, base } = variant.box;
  const mesh = new lit.Mesh(variant.geometry, variant.material);
  scene.add(mesh);
  const camera = new lit.OrthoCamera(-half, half, height / 2, -height / 2, 0.01, half * 8);
  const centre = base + height / 2;
  for (let frame = 0; frame < cards.frames; frame += 1) {
    const angle = (frame / cards.frames) * TAU;
    camera.position.set(Math.sin(angle) * half * 4, centre, Math.cos(angle) * half * 4);
    camera.lookAt(0, centre, 0);
    camera.updateProjectionMatrix();
    light.position.set(Math.sin(angle + 0.6) * 4, 6, Math.cos(angle + 0.6) * 4);
    cards.target.viewport.set(frame * cards.cell, row * cards.cell, cards.cell, cards.cell);
    cards.target.scissor.set(frame * cards.cell, row * cards.cell, cards.cell, cards.cell);
    cards.target.scissorTest = true;
    renderer.setRenderTarget(cards.target);
    renderer.clear(false, true, false);
    renderer.render(scene, camera);
  }
  scene.remove(mesh);
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
