// The forest: places seeded in a ring, trees baked into a sprite ladder and the whole stand updated by distance.

import type {
  ColorLike, GeometryLike, InstancedLike, LitLike, MaterialLike, NodeLike, TreeColors, TreeFrameLike, TreeModelLike,
  Vector3Like, YearLike,
} from "../inputs.js";
import { TAU, seededRandom } from "../math.js";
import { writeBox } from "../instances.js";
import type { BoxPlace } from "../instances.js";
import { bakedGeometry, boxOf, forestMaterial, seasonUniforms, setYear } from "./bake.js";
import type { Box, RungSpec, Vector4Like } from "./bake.js";
import { MAX_VARIANTS, bakeCards, createCards } from "./cards.js";
import type { Cards } from "./cards.js";

export type { Vector4Like } from "./bake.js";

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
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const grove = 0.5 + 0.5 * Math.sin(angle * 3 + phase) * Math.cos(radius * 0.21 + phase * 0.7);
    if (random() < clump * (1 - grove)) continue;
    const y = input.height(x, z);
    if (y === null || places.some((p) => Math.hypot(p.x - x, p.z - z) < gap)) continue;
    places.push({
      x,
      y,
      z,
      yaw: random() * TAU,
      scale: low + random() * (high - low),
      variant: Math.floor(random() * input.variants),
      tint: 0.82 + random() * 0.3,
    });
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
  readonly fog?: {
    readonly color: readonly [number, number, number];
    readonly near: number;
    readonly far: number;
  } | null;
  /** Whole pixels to move the fades' dither by this frame (lit-finish's `ditherOffset()`); default still. */
  readonly dither?: readonly [number, number];
}

export interface Forest {
  readonly group: unknown;
  /** Trees drawn at each level from the current view, the levels held, and the triangles drawn. */
  readonly levels: {
    readonly close: number;
    readonly full: number;
    readonly layered: number;
    readonly cards: number;
    readonly built: number;
    readonly triangles: number;
  };
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
  readonly OrthoCamera: new (
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ) => NodeLike & { lookAt(x: number, y: number, z: number): void; updateProjectionMatrix(): void };
  readonly RenderTarget: new (
    width: number,
    height: number,
    options?: Readonly<Record<string, unknown>>,
  ) => {
    readonly texture: unknown;
    viewport: { set(x: number, y: number, w: number, h: number): void };
    scissor: { set(x: number, y: number, w: number, h: number): void };
    scissorTest: boolean;
    dispose(): void;
  };
  readonly SkyLight: new (sky: string, ground: string, intensity: number) => NodeLike;
  readonly SunLight: new (color: string, intensity: number) => NodeLike;
  readonly Matrix4: new () => {
    readonly elements: number[];
    makeRotationY(angle: number): unknown;
    compose(position: unknown, quaternion: unknown, scale: unknown): unknown;
  };
  readonly Quaternion: new () => { setFromAxisAngle(axis: Vector3Like, angle: number): unknown };
}

// ---------------------------------------------------------------- the sprite ladder

/** One tree's shape at one level of detail, shared by everything that draws that tree at that level. */
interface Shape {
  readonly geometry: GeometryLike;
  readonly box: Box;
  readonly triangles: number;
  users: number;
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
  readonly box: Box;
}

// The shapes alive right now, by the frame they were cut from: two forests of the same tree share them,
// and the last one to stop using a shape frees it, so only what is on screen is ever held.
const SHAPES = new WeakMap<object, Map<string, Shape>>();

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
    shape = {
      geometry,
      box: boxOf(geometry),
      triangles: (geometry.attributes.position?.array.length ?? 0) / 9,
      users: 0,
    };
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

/** What every tree's ladder is cut by: the forest's options and the distances its levels change at. */
interface Ladder {
  readonly options: ForestOptions;
  readonly lod: Vector4Like;
}

function ladderTree(lit: ForestLitLike, variant: ForestVariant, capacity: number, ladder: Ladder): LadderTree {
  const { options, lod } = ladder;
  const uniforms = seasonUniforms(lit, variant.colors);
  const specs: readonly (readonly [RungSpec, number])[] = [
    [{ wood: 0.012, sides: 9, leaves: 6000, fill: 4, leafSize: 0.7, needles: 24, clumps: 0 }, lod.x * LADDER_CLOSE],
    [
      { wood: options.minRadius ?? 0.025, sides: 6, leaves: options.maxLeaves ?? 1600, fill: 1, needles: 9, clumps: 0 },
      lod.x,
    ],
    [{ wood: 0.03, sides: 3, leaves: 280, fill: 1, leafSize: 1.3, needles: 4, clumps: 6 }, lod.x * LADDER_LAYERED],
  ];
  let from = 0;
  const rungs = specs.map(([spec, to], index): Rung => {
    const band = crossing(lod.y, to);
    const inner = crossing(lod.y, specs[index - 1]?.[1] ?? 0);
    const rung: Rung = {
      spec,
      from,
      to,
      band,
      lod: { x: to, y: band, z: lod.z, w: lod.w },
      lodIn: { x: from, y: inner },
      built: null,
      count: 0,
      idle: 0,
    };
    from = to;
    return rung;
  });
  return { variant, uniforms, bakeMaterial: forestMaterial(lit, uniforms, true), rungs, capacity };
}

/** The plain bake, the level the impostor cards are rendered from. */
function fullRung(tree: LadderTree): Rung {
  const rung = tree.rungs[1];
  if (!rung) throw new Error("tree-render: a ladder tree has no plain bake");
  return rung;
}

/** Builds a level the first time a tree reaches it. */
function buildRung(state: ForestState, tree: LadderTree, rung: Rung): void {
  const { lit } = state;
  const shape = takeShape(lit, tree.variant, rung.spec);
  const material = forestMaterial(
    lit,
    { ...tree.uniforms, uLod: { value: rung.lod }, uLodIn: { value: rung.lodIn } },
    false,
  );
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
    const { geometry, box } = takeShape(state.lit, tree.variant, fullRung(tree).spec);
    return { geometry, box, material: tree.bakeMaterial };
  });
  const { options } = state;
  const sheet = { frames: options.frames, cell: options.cell, lod: state.cardLod };
  const cards = createCards(state.lit, rows, options.places.length * 2, sheet);
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
    for (const shape of held?.values() ?? []) {
      if (shape.geometry === geometry) {
        dropShape(tree.variant, shape);
        break;
      }
    }
  });
  state.cards = null;
}

// ---------------------------------------------------------------- forest assembly

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

const yearOf = (input: ForestUpdate, variant: number): YearLike =>
  typeof input.year === "function" ? input.year(variant) : input.year;

function seasonKey(state: ForestState, input: ForestUpdate): string {
  return state.trees
    .map((_, v) => {
      const y = yearOf(input, v);
      const steps = [y.leaf, y.color, y.flush, y.drop, y.bloom - y.petals].map((n) => Math.round(n * 24));
      return steps.join(",") + (y.withered ? "w" : "");
    })
    .join("|");
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
    const finer = tree.rungs[r - 1];
    const coarser = tree.rungs[r + 1];
    rung.lodIn.x = finer?.built ? rung.from : 0;
    rung.lod.x = (coarser ? coarser.built !== null : cardsOn) ? rung.to : 1e6;
  });
}

/** One pass over the places: whether cards draw, where the camera is, the first level found missing, cards so far. */
interface Placing {
  readonly cardsOn: boolean;
  readonly c: { readonly x: number; readonly y: number; readonly z: number };
  missing: readonly [LadderTree, Rung] | null;
  far: number;
}

// One place's box, reused for every tree every frame: nothing is allocated while the forest is placed.
const BOX = { at: [0, 0, 0] as [number, number, number], size: [0, 0, 0] as [number, number, number], yaw: 0 };
/** Where a place's tree stands, as the box its instance is written from. */
function boxAt(place: ForestPlace): BoxPlace {
  BOX.at[0] = place.x;
  BOX.at[1] = place.y;
  BOX.at[2] = place.z;
  BOX.size[0] = place.scale;
  BOX.size[1] = place.scale;
  BOX.size[2] = place.scale;
  BOX.yaw = place.yaw;
  return BOX;
}

/** Does a tree at `distance` stand on this level (or past its far edge, when nothing coarser would draw it)? */
function onRung(rung: Rung, last: boolean, distance: number, cardsOn: boolean): boolean {
  if (distance < rung.from - rung.lodIn.y) return false;
  return !(distance > rung.to + rung.band && (cardsOn || !last));
}

/** Draws one tree on every level it stands on, by the nearest built one, and returns its distance from the camera. */
function placeOnLadder(state: ForestState, placing: Placing, tree: LadderTree, place: ForestPlace): number {
  const { c, cardsOn } = placing;
  const distance = Math.hypot(place.x - c.x, place.y - c.y, place.z - c.z);
  let drawn = 0;
  for (const [r, rung] of tree.rungs.entries()) {
    const last = r === tree.rungs.length - 1;
    if (!onRung(rung, last, distance, cardsOn)) continue;
    if (!rung.built) {
      placing.missing ??= [tree, rung];
      if (nearestBuilt(tree, r) < 0) buildRung(state, tree, rung);
    }
    const at = nearestBuilt(tree, r);
    const target = tree.rungs[at];
    if (!target?.built || (drawn & (1 << at)) !== 0) continue;
    drawn |= 1 << at;
    const { mesh } = target.built;
    writeBox(mesh.instanceMatrix.array, target.count, boxAt(place));
    mesh.setColorAt(target.count, state.tint.setRGB(place.tint, place.tint, place.tint));
    target.count += 1;
  }
  return distance;
}

/** Draws one tree as the next impostor card. */
function placeCard(cards: Cards, placing: Placing, place: ForestPlace): void {
  const { far } = placing;
  writeBox(cards.mesh.instanceMatrix.array, far, boxAt(place));
  cards.card[far * 2] = place.variant;
  cards.card[far * 2 + 1] = place.tint;
  placing.far += 1;
}

/** After a pass: a level unused long enough is freed, and every built one shows what the pass drew on it. */
function settleRungs(state: ForestState): void {
  for (const tree of state.trees) {
    for (const rung of tree.rungs) {
      rung.idle = rung.count > 0 ? 0 : rung.idle + 1;
      if (rung.built && rung.idle > state.keep) freeRung(state, tree, rung);
      if (!rung.built) continue;
      rung.built.mesh.count = rung.count;
      rung.built.mesh.instanceMatrix.needsUpdate = true;
      if (rung.built.mesh.instanceColor) rung.built.mesh.instanceColor.needsUpdate = true;
    }
  }
}

function placeTrees(state: ForestState, input: ForestUpdate, cardsOn: boolean): void {
  const { trees, cards, options, cardLod } = state;
  for (const tree of trees) {
    openEdges(tree, cardsOn);
    for (const rung of tree.rungs) rung.count = 0;
  }
  const placing: Placing = { cardsOn, c: input.camera.position, missing: null, far: 0 };
  for (const place of options.places) {
    const tree = trees[place.variant];
    if (!tree) continue;
    const distance = placeOnLadder(state, placing, tree, place);
    if (cards && cardsOn && distance > cardLod.x - cardLod.y) placeCard(cards, placing, place);
  }
  finishPass(state, placing);
}

/** After the places: build the one level found missing, settle the levels, and show or close the cards. */
function finishPass(state: ForestState, placing: Placing): void {
  const { cards } = state;
  const { cardsOn, missing, far } = placing;
  // One new level a frame, so a whole forest arriving costs no single long frame.
  if (missing) {
    const [tree, rung] = missing;
    if (!rung.built) buildRung(state, tree, rung);
  }
  settleRungs(state);
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
  if (input.fog) {
    fogColor.set(...input.fog.color);
    fog.x = input.fog.near;
    fog.y = input.fog.far;
  } else {
    fog.x = 0;
    fog.y = 0;
  }
}

function updateForest(state: ForestState, input: ForestUpdate): void {
  state.trees.forEach((tree, v) => {
    setYear(tree.uniforms, yearOf(input, v), tree.variant.model, tree.variant.colors);
    (tree.uniforms.uTime as { value: number }).value = input.elapsed;
    (tree.uniforms.uWind as { value: number }).value = input.wind;
    const shift = tree.uniforms.uDither?.value as { x: number; y: number } | undefined;
    if (shift) [shift.x, shift.y] = input.dither ?? [0, 0];
  });
  const renderer = input.renderer ?? null;
  const c = input.camera.position;
  const edge = state.cardLod.x - state.cardLod.y;
  // Cards exist only while some tree is far enough to be one.
  const wanted =
    renderer !== null && state.options.places.some((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) > edge);
  const cards = wanted ? (state.cards ?? openCards(state)) : state.cards;
  if (cards && renderer) {
    const key = seasonKey(state, input);
    if (key !== cards.key) {
      bakeCards(state.lit, renderer, cards, cards.rows);
      cards.key = key;
    }
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
  const trees = variants.map((variant, v) => ladderTree(lit, variant, counts[v] ?? 0, { options, lod }));
  const cardLod: Vector4Like = { ...lod, x: lod.x * LADDER_LAYERED, y: crossing(lod.y, lod.x * LADDER_LAYERED) };
  const state: ForestState = {
    lit,
    group,
    options: { ...options, variants },
    trees,
    cardLod,
    keep: options.keep ?? LEVEL_KEEP,
    tint: new lit.Color(),
    cards: null,
    far: 0,
  };
  return {
    group,
    get levels() {
      const drawn = (r: number): number => trees.reduce((sum, tree) => sum + (tree.rungs[r]?.count ?? 0), 0);
      const shapes = trees.flatMap((tree) => tree.rungs.flatMap((rung) => (rung.built ? [rung.built.shape] : [])));
      return {
        close: drawn(0),
        full: drawn(1),
        layered: drawn(2),
        cards: state.far,
        built: shapes.length + (state.cards ? 1 : 0),
        triangles: trees.reduce(
          (sum, tree) => sum + tree.rungs.reduce((n, rung) => n + rung.count * (rung.built?.shape.triangles ?? 0), 0),
          0,
        ),
      };
    },
    update: (input) => {
      updateForest(state, input);
    },
    setPlaces: (places) => {
      movePlaces(state, places);
    },
    dispose: () => {
      closeCards(state);
      for (const tree of trees) {
        for (const rung of tree.rungs) freeRung(state, tree, rung);
        tree.bakeMaterial.dispose();
      }
    },
  };
}
