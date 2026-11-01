// What the renderer reads: tree-growth's model, frame, year and looks, and the parts of keel/lit it is handed.

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

export interface ColorLike {
  r: number; g: number; b: number;
  set(value: string | number): ColorLike;
  setRGB(r: number, g: number, b: number): ColorLike;
  copy(color: ColorLike): ColorLike;
  lerp(color: ColorLike, t: number): ColorLike;
  multiplyScalar(s: number): ColorLike;
  offsetHSL(h: number, s: number, l: number): ColorLike;
  getHexString(): string;
}
interface AttributeLike {
  readonly count: number;
  readonly array: Float32Array;
  needsUpdate: boolean;
  readonly itemSize: number;
}
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
export interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector3Like }
export interface NodeLike {
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
