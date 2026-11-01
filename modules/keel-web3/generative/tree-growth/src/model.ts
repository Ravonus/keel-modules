// The model: a tree grown from its species and seed, its leaf slots, sectors, ornaments and pace through life.

import { SPECIES, speciesOf } from "./species.js";
import type { OrnamentSpec, PalmSpec, Species, SpeciesId } from "./species.js";
import { add, at, clamp01, createRandom, cross, normalize, perpendicular, ramp, vec } from "./math.js";
import type { Vec } from "./math.js";
import { GRID_X, GRID_Y } from "./light.js";
import { addBud, addNode, declineCycle, growCycle } from "./simulation.js";
import type { Sim } from "./simulation.js";

// ---------------------------------------------------------------- the model

export interface TreeModel {
  readonly species: Species;
  readonly seed: number;
  /** Cycles of the whole life; the tree is dead at `cycles`. */
  readonly cycles: number;
  /** Last cycle that adds wood; after it the tree declines. */
  readonly matureAt: number;
  readonly count: number;
  readonly parent: Int32Array;
  /** Grown positions, world units, trunk base at the origin. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly order: Uint8Array;
  /** An internode starts growing at `birth` and is full length `span` later. */
  readonly birth: Float32Array;
  readonly span: Float32Array;
  readonly deadAt: Float32Array;
  readonly shedAt: Float32Array;
  /** Wind phase per internode. */
  readonly phase: Float32Array;
  readonly leaves: LeafSlots;
  /** Flower places (blossoms, catkins, candles, puffs); empty when the species has none. */
  readonly blossoms: LeafSlots;
  /** Fruit places (cherries, acorns, cones, pods). */
  readonly fruit: LeafSlots;
  /** Root flare: angle and reach of each surface root. */
  readonly roots: readonly { readonly angle: number; readonly reach: number }[];
}

/** Leaf or blossom places, each tied to a node with a fixed offset and a rank for the year's timing. */
export interface LeafSlots {
  readonly count: number;
  readonly node: Int32Array;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly dz: Float32Array;
  readonly rank: Float32Array;
  readonly size: Float32Array;
  readonly tone: Uint8Array;
}

export interface GrowInput {
  /** A species id; anything else grows a cherry. */
  readonly species: string;
  readonly seed: number;
  readonly maxNodes?: number;
  /**
   * A hybrid: each species' share of the tree's makeup (any positive weights;
   * they are normalised). The tree grows a form between them by share; the
   * largest share decides what cannot be halved (a palm's way of growing,
   * whorls, flowers, fruit, evergreen). `species` is ignored when it is set.
   */
  readonly mix?: Readonly<Record<string, number>>;
}

/** The species' shares in a mix, largest first, unknown ids and non-positive weights dropped, summing to 1. */
export function mixShares(mix: Readonly<Record<string, number>>): [SpeciesId, number][] {
  const known = Object.entries(mix).filter(([id, weight]) => Object.hasOwn(SPECIES, id) && weight > 0) as [
    SpeciesId,
    number,
  ][];
  const total = known.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return [["cherry", 1]];
  return known
    .map(([id, weight]) => [id, weight / total] as [SpeciesId, number])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** Past this many internodes a leader's ceiling never comes into play, so an unbounded one blends as this. */
const OPEN_CEILING = 60;

const blendNumber = (shares: readonly [SpeciesId, number][], pick: (species: Species) => number): number => {
  const mean = shares.reduce((sum, [id, share]) => sum + Math.min(pick(SPECIES[id]), OPEN_CEILING) * share, 0);
  return shares.some(([id]) => pick(SPECIES[id]) === Infinity) && mean >= OPEN_CEILING * 0.95 ? Infinity : mean;
};

/**
 * A hybrid species: every measure of form is the shares' weighted mean (an
 * 80/20 cherry-oak is mostly a cherry's crown with an oak's broader reach and
 * flatter limbs); what has no middle comes from the major share.
 */
export function blendSpecies(mix: Readonly<Record<string, number>>): Species {
  const shares = mixShares(mix);
  const major = SPECIES[shares[0]![0]];
  if (shares.length === 1 || major.palm !== null) return major;
  const mean = (pick: (species: Species) => number): number => blendNumber(shares, pick);
  const round = (pick: (species: Species) => number): number => Math.max(1, Math.round(mean(pick)));
  const window = (pick: (species: Species) => readonly [number, number]): [number, number] => [
    mean((species) => pick(species)[0]),
    mean((species) => pick(species)[1]),
  ];
  // A clean bole has no middle either: the kind that prunes its low limbs hardest keeps the trunk bare (lift).
  // Shoot lengths go with the branching habit: a whorled kind buds only at a shoot's end, so a pine
  // given a willow's long side shoots would grow bare whips. Across habits they come from the major share.
  const sameHabit = shares.every(([id]) => (SPECIES[id].whorl > 0) === (major.whorl > 0));
  const shoot = (pick: (species: Species) => number): number => (sameHabit ? round(pick) : pick(major));
  return {
    ...major,
    cycles: round((species) => species.cycles),
    height: mean((species) => species.height),
    apical: mean((species) => species.apical),
    vigor: mean((species) => species.vigor),
    maxShoot: shoot((species) => species.maxShoot),
    sideShoot: shoot((species) => species.sideShoot),
    angle: mean((species) => species.angle),
    straight: mean((species) => species.straight),
    light: mean((species) => species.light),
    up: mean((species) => species.up),
    lateralUp: mean((species) => species.lateralUp),
    weep: mean((species) => species.weep),
    flat: mean((species) => species.flat),
    crownAt: mean((species) => species.crownAt),
    lift: Math.max(...shares.map(([id]) => SPECIES[id].lift ?? 0)),
    spread: mean((species) => species.spread),
    cone: mean((species) => species.cone ?? 0),
    ceiling: mean((species) => species.ceiling),
    shed: mean((species) => species.shed),
    leafSlots: round((species) => species.leafSlots),
    leafSpread: mean((species) => species.leafSpread),
    hang: mean((species) => species.hang),
    radiusTip: mean((species) => species.radiusTip),
    pipe: mean((species) => species.pipe),
    phenology: {
      ...major.phenology,
      marcescent: mean((species) => species.phenology.marcescent),
      dropMax: mean((species) => species.phenology.dropMax),
      leaf: window((species) => species.phenology.leaf),
      color: window((species) => species.phenology.color),
      drop: window((species) => species.phenology.drop),
      flush: window((species) => species.phenology.flush),
    },
  };
}

/**
 * The growth curve: the wood a tree may have made by `cycle` rises fast while
 * young and eases off with age, but never flattens before old age, so a tree
 * keeps getting bigger every cycle until it starts to decline.
 */
function growthAllowance(sim: Sim, cycle: number, matureAt: number): number {
  const life = Math.min(1, cycle / matureAt);
  // The curve is of living wood: twigs that starve in the shade are replaced,
  // so the crown keeps filling out instead of peaking young and thinning.
  let living = 0;
  for (const value of sim.deadAt) if (value === Infinity) living += 1;
  const target = sim.maxNodes * LIVING_AT_PRIME * (0.08 + 0.92 * life);
  // A share of the whole budget, dead wood included, is kept back for old age, which still grows.
  const room = sim.maxNodes * OLD_AGE_KEEP - sim.pos.length;
  return Math.min(room, Math.max(target - living, living * 0.015));
}

const OLD_AGE_KEEP = 0.84;
/** Living internodes at maturity, as a share of the budget; the rest is wood the crown shed on the way. */
const LIVING_AT_PRIME = 0.5;



function newSim(species: Species, seed: number, maxNodes: number): Sim {
  return {
    species,
    random: createRandom(seed ^ 0x7ee5),
    grid: { shadow: new Float32Array(GRID_X * GRID_X * GRID_Y) },
    maxNodes,
    pos: [],
    dir: [],
    parent: [],
    order: [],
    birth: [],
    span: [],
    main: [],
    deadAt: [],
    shedAt: [],
    weak: [],
    children: [],
    buds: [],
    nodeBuds: [],
    height: 0,
  };
}

/** Unfolds one frond from the crown: a rachis that leaves steep and arches out and down. */
function growFrond(sim: Sim, top: number, around: number, length: number, cycle: number): void {
  const segments = 8;
  const out = vec(Math.cos(around), 0, Math.sin(around));
  const lift = 1 - sim.random() * 0.5;
  const sag = 1.6 + sim.random() * 0.4;
  let node = top;
  for (let step = 0; step < segments; step += 1) {
    const heading = normalize(vec(out.x, lift - (step / (segments - 1)) * sag, out.z));
    node = addNode(
      sim,
      node,
      add(sim.pos[node] ?? vec(0, 0, 0), heading, length / segments),
      heading,
      1,
      cycle + step * 0.03,
      0.2,
      false,
    );
  }
}

/** Two trunk internodes a cycle: barely rising while the young palm establishes, curving back toward the sky. */
function climbTrunk(sim: Sim, top: number, heading: Vec, cycle: number, vigor: number): [number, Vec] {
  const rise = (0.2 + 0.85 * ramp(cycle, 2, 6)) * vigor;
  let node = top;
  let dir = heading;
  for (let step = 0; step < 2; step += 1) {
    dir = normalize(add(dir, vec(0, 1, 0), 0.05));
    node = addNode(sim, node, add(sim.pos[node] ?? vec(0, 0, 0), dir, rise), dir, 0, cycle - 1 + step * 0.5, 0.5, true);
  }
  return [node, dir];
}

function simulatePalm(sim: Sim, palm: PalmSpec): void {
  const { species, random } = sim;
  const toward = random() * Math.PI * 2;
  const lean = palm.lean * (0.6 + random() * 0.8);
  let heading = normalize(vec(Math.cos(toward) * lean, 1, Math.sin(toward) * lean));
  let top = addNode(sim, -1, vec(0, 0.2, 0), heading, 0, 0, 1, true);
  const matureAt = Math.round(species.cycles * 0.72);
  let around = random() * Math.PI * 2;
  for (let cycle = 1; cycle < species.cycles; cycle += 1) {
    const life = Math.min(1, cycle / matureAt);
    const decline = cycle > matureAt ? (cycle - matureAt) / (species.cycles - matureAt) : 0;
    [top, heading] = climbTrunk(sim, top, heading, cycle, 1 - decline * 0.75);
    const fronds = Math.max(1, Math.round(palm.fronds * (1 - decline * 0.6)));
    for (let index = 0; index < fronds; index += 1) {
      around += (species.divergence * Math.PI) / 180;
      const first = sim.pos.length;
      growFrond(
        sim,
        top,
        around,
        palm.frond * (0.15 + 0.85 * life ** 0.8) * (1 - decline * 0.35),
        cycle - 1 + index / fronds,
      );
      const dies = cycle + palm.frondLife * (0.8 + random() * 0.4);
      for (let node = first; node < sim.pos.length; node += 1) sim.deadAt[node] = dies;
      sim.shedAt[first] = dies + 0.3 + random() * 0.5;
    }
  }
  // The last crown dies with the palm and drops, leaving the bare trunk standing.
  for (let node = 0; node < sim.pos.length; node += 1) {
    sim.deadAt[node] = Math.min(at(sim.deadAt, node), species.cycles - 0.6);
    if (at(sim.shedAt, node) !== Infinity) sim.shedAt[node] = Math.min(at(sim.shedAt, node), species.cycles - 0.2);
  }
}

function simulate(species: Species, seed: number, maxNodes: number): Sim {
  const sim = newSim(species, seed, maxNodes);
  if (species.palm !== null) {
    simulatePalm(sim, species.palm);
    return sim;
  }
  const lean = normalize(vec((sim.random() - 0.5) * 0.12, 1, (sim.random() - 0.5) * 0.12));
  const seedling = addNode(sim, -1, vec(lean.x, 1, lean.z), lean, 0, 0, 1, true);
  addBud(sim, seedling, lean, true);
  const matureAt = Math.round(species.cycles * 0.72);
  for (let cycle = 1; cycle < species.cycles; cycle += 1) {
    if (cycle <= matureAt) growCycle(sim, cycle, 1 + 1.6 / (1 + cycle * 0.4), species.shed, growthAllowance(sim, cycle, matureAt));
    else declineCycle(sim, cycle, (cycle - matureAt) / (species.cycles - matureAt));
  }
  // Whatever still lives dies over the last cycle; the snag then stands frozen.
  for (let node = 0; node < sim.pos.length; node += 1) if (at(sim.deadAt, node) === Infinity) sim.deadAt[node] = species.cycles - 0.6;
  return sim;
}

/** What slots hang from: how many nodes, each one's heading, and whether the tree is a palm. */
interface SlotSource {
  readonly count: number;
  readonly palm: boolean;
  heading(node: number): Vec;
}

const simSource = (sim: Sim): SlotSource => ({
  count: sim.pos.length,
  palm: sim.species.palm !== null,
  heading: (node) => sim.dir[node] ?? vec(0, 1, 0),
});

function leafSlots(
  source: SlotSource,
  perNode: number,
  spread: number,
  hang: number,
  seed: number,
  eligible: (node: number) => boolean,
): LeafSlots {
  const random = createRandom(seed);
  const nodes: number[] = [];
  for (let node = 0; node < source.count; node += 1)
    if (eligible(node)) for (let index = 0; index < perNode; index += 1) nodes.push(node);
  const count = nodes.length;
  const slots = {
    count,
    node: Int32Array.from(nodes),
    dx: new Float32Array(count),
    dy: new Float32Array(count),
    dz: new Float32Array(count),
    rank: new Float32Array(count),
    size: new Float32Array(count),
    tone: new Uint8Array(count),
  };
  for (let index = 0; index < count; index += 1) {
    const heading = source.heading(at(slots.node, index));
    if (source.palm && hang > 0) {
      leaflet(slots, index, heading, spread, hang, random);
      continue;
    }
    const theta = random() * Math.PI * 2;
    const lift = random() * 2 - 1;
    const ring = Math.sqrt(1 - lift * lift) * Math.cbrt(random());
    // Weeping trees hang their leaves in strands below the twig.
    const drop = hang > 0 ? hang * ((index % perNode) / perNode) * (0.6 + random() * 0.4) : 0;
    slots.dx[index] = (Math.cos(theta) * ring + heading.x * 0.45) * spread * (drop > 0 ? 0.5 : 1);
    slots.dy[index] = (lift * 0.7 + heading.y * 0.45 + 0.18) * spread - drop;
    slots.dz[index] = (Math.sin(theta) * ring + heading.z * 0.45) * spread * (drop > 0 ? 0.5 : 1);
    slots.rank[index] = random();
    slots.size[index] = 0.82 + random() * 0.36;
    slots.tone[index] = Math.floor(random() * 3);
  }
  return slots;
}

/** A palm frond's first internode, where flowers and coconuts hang. */
const frondBase = (sim: Sim, node: number): boolean =>
  at(sim.order, node) > 0 && at(sim.order, at(sim.parent, node)) === 0;

/** A palm leaflet: one of a pair of rows down each side of the frond's rachis, drooping at its tip. */
function leaflet(
  slots: LeafSlots & { dx: Float32Array; dy: Float32Array; dz: Float32Array },
  index: number,
  heading: Vec,
  spread: number,
  hang: number,
  random: () => number,
): void {
  const side = normalize(cross(heading, vec(0, 1, 0)), perpendicular(heading));
  const sign = index % 2 === 0 ? 1 : -1;
  const reach = spread * (0.25 + 0.75 * random());
  const along = (random() - 0.5) * spread * 0.6;
  slots.dx[index] = side.x * sign * reach + heading.x * along;
  slots.dy[index] = side.y * sign * reach + heading.y * along - hang * (reach / spread) ** 2;
  slots.dz[index] = side.z * sign * reach + heading.z * along;
  slots.rank[index] = random();
  slots.size[index] = 0.7 + random() * 0.3;
  slots.tone[index] = Math.floor(random() * 3);
}

function ornamentSlots(sim: Sim, spec: OrnamentSpec | null, spread: number, seed: number): LeafSlots {
  if (spec === null) return leafSlots(simSource(sim), 0, 0, 0, 0, () => false);
  const palm = sim.species.palm !== null;
  const floor = (spec.above ?? 0) * sim.height;
  return leafSlots(simSource(sim), spec.perNode, spread, 0, seed, (node) =>
    palm ? frondBase(sim, node) : at(sim.order, node) > 0 && (sim.pos[node]?.y ?? 0) >= floor,
  );
}

function leafEligible(sim: Sim, node: number): boolean {
  if (sim.species.palm !== null) return at(sim.order, node) > 0 && !frondBase(sim, node);
  return at(sim.order, node) > 0 || at(sim.birth, node) < 4;
}

/** Grows one tree from its seed. The same species and seed always give the same tree. */
export function growTree(input: GrowInput): TreeModel {
  const species = input.mix ? blendSpecies(input.mix) : speciesOf(input.species);
  const seed = input.seed >>> 0;
  const sim = simulate(species, seed, Math.max(64, Math.min(input.maxNodes ?? 4800, 6000)));
  const count = sim.pos.length;
  const scale = species.height / Math.max(sim.height, 1);
  const random = createRandom(seed ^ 0x51ab);
  const rootCount = 5 + Math.floor(random() * 3);
  const model: TreeModel = {
    species,
    seed,
    cycles: species.cycles,
    matureAt: Math.round(species.cycles * 0.72),
    count,
    parent: Int32Array.from(sim.parent),
    x: Float32Array.from(sim.pos, (p) => p.x * scale),
    y: Float32Array.from(sim.pos, (p) => p.y * scale),
    z: Float32Array.from(sim.pos, (p) => p.z * scale),
    order: Uint8Array.from(sim.order, (value) => Math.min(value, 255)),
    birth: Float32Array.from(sim.birth),
    span: Float32Array.from(sim.span),
    deadAt: Float32Array.from(sim.deadAt),
    shedAt: Float32Array.from(sim.shedAt, (value) => (value === Infinity ? 1e9 : value)),
    phase: Float32Array.from(sim.pos, () => random() * Math.PI * 2),
    leaves: leafSlots(simSource(sim), species.leafSlots, species.leafSpread, species.hang, seed ^ 0x1eaf, (node) =>
      leafEligible(sim, node),
    ),
    blossoms: ornamentSlots(sim, species.flower, species.leafSpread * 0.8, seed ^ 0xb105),
    fruit: ornamentSlots(sim, species.fruit, species.leafSpread * 0.7, seed ^ 0xf2017),
    roots: Array.from({ length: rootCount }, (_, index) => ({
      angle: (index / rootCount) * Math.PI * 2 + random() * 0.6,
      reach: 0.7 + random() * 0.6,
    })),
  };
  return model;
}

/**
 * Splits a grown tree into sectors, the way a chimera plant carries whole
 * limbs of different tissue: each main limb (and everything it carries) goes
 * to one strain, so that each strain's share of the crown's leaves is close
 * to its share in `shares`. Strain 0, the first, keeps the trunk. Returns the
 * strain of every internode. A strain with too small a share for any limb
 * still gets the smallest one, so a trace of hidden makeup always shows.
 */
/** Whether `node` grows from `limb` (anywhere out along it). */
function isBelow(model: TreeModel, node: number, limb: number): boolean {
  for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (up === limb) return true;
  return false;
}

export function sectors(model: TreeModel, shares: readonly number[], seed = model.seed): Uint8Array {
  const strain = new Uint8Array(model.count);
  if (shares.length <= 1) return strain;
  const order = model.order;
  // Leaf-years each internode carries, counted up from the twigs (parents come first, so walk backwards):
  // a shoot that is shaded out young counts for little.
  const carried = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    const held = Math.max(0, Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node)) / model.cycles;
    carried[node] = at(carried, node) + held;
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) carried[parent] = at(carried, parent) + at(carried, node);
  }
  // Main limbs that live a good while (a quarter of the life): a limb shaded out young would carry its strain as bare sticks.
  const main: number[] = [];
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (at(order, node) > 0 && (parent < 0 || at(order, parent) === 0) && at(carried, node) > 0) main.push(node);
  }
  const lasting = main.filter(
    (node) => Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node) >= model.cycles * 0.25,
  );
  const limbs = lasting.length >= shares.length ? lasting : main;
  const random = createRandom(seed ^ 0x5ec7);
  // Shuffle first so limbs born together (a whorl) fall to different strains, then walk them in the order
  // they grow: each goes to the strain furthest behind its share, so every age of the tree shows each strain
  // at its share, not only the old tree.
  for (let index = limbs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [limbs[index], limbs[other]] = [limbs[other]!, limbs[index]!];
  }
  limbs.sort((a, b) => Math.round(at(model.birth, a) * 2) - Math.round(at(model.birth, b) * 2));
  const sum = shares.reduce((acc, share) => acc + Math.max(0, share), 0) || 1;
  const want = shares.map((share) => Math.max(0, share) / sum);
  const have = new Float64Array(shares.length);
  const owner = new Map<number, number>();
  let walked = 0;
  for (const limb of limbs) {
    walked += at(carried, limb);
    let pick = 0;
    let behind = -Infinity;
    for (let index = 0; index < shares.length; index += 1) {
      const short = (want[index] ?? 0) * walked - at(have, index);
      if ((want[index] ?? 0) > 0 && short > behind) {
        behind = short;
        pick = index;
      }
    }
    owner.set(limb, pick);
    have[pick] = at(have, pick) + at(carried, limb);
  }
  // Even a tiny share holds a limb: the smallest one, taken from the first strain.
  for (let index = 1; index < shares.length; index += 1) {
    if ((want[index] ?? 0) <= 0 || at(have, index) > 0) continue;
    let small = -1;
    for (const limb of limbs)
      if (owner.get(limb) === 0 && (small < 0 || at(carried, limb) < at(carried, small))) small = limb;
    if (small >= 0) {
      owner.set(small, index);
      have[index] = at(carried, small);
    }
  }
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    strain[node] = owner.get(node) ?? (parent >= 0 ? at(strain, parent) : 0);
  }
  // Whole limbs come in big lumps, and old low limbs that carried leaves for years may hold few now, so a
  // strain can end well short in the grown crown (the third kind gets what is left). Counting the leaves
  // on the tree through the middle of its life, it takes side branches off the strains over their share, the biggest that
  // still fit first, so a quarter share shows as about a quarter of the grown crown.
  const prime = (node: number): number =>
    [0.35, 0.5, 0.65].filter(
      (t) => at(model.birth, node) <= model.cycles * t && at(model.deadAt, node) > model.cycles * t,
    ).length;
  const alive = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    alive[node] = at(alive, node) + prime(node);
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) alive[parent] = at(alive, parent) + at(alive, node);
  }
  const now = new Float64Array(shares.length);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    now[at(strain, node)] = at(now, at(strain, node)) + prime(node);
  }
  const total = now.reduce((acc, count) => acc + count, 0);
  const taken = new Set<number>();
  const takenAbove = (node: number): boolean => {
    for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (taken.has(up)) return true;
    return false;
  };
  // The strain furthest short goes first, the main kind included (an oak limb can outgrow the cherry it is on).
  const needy = shares
    .map((_, index) => index)
    .sort((a, b) => (want[b] ?? 0) * total - at(now, b) - ((want[a] ?? 0) * total - at(now, a)));
  for (const index of needy) {
    let short = (want[index] ?? 0) * total - at(now, index);
    if (short <= total * 0.03) continue;
    const side: number[] = [];
    for (let node = 0; node < model.count; node += 1) {
      const parent = at(model.parent, node);
      if (
        parent < 0 ||
        at(order, parent) === 0 ||
        at(order, node) <= at(order, parent) ||
        at(strain, node) === index ||
        at(alive, node) <= 0
      )
        continue;
      side.push(node);
    }
    side.sort((a, b) => at(alive, b) - at(alive, a));
    for (const node of side) {
      if (short <= total * 0.03) break;
      const from = at(strain, node);
      const load = at(alive, node);
      const spare = at(now, from) - (want[from] ?? 0) * total;
      if (from === index || load > short * 1.25 || load > spare || takenAbove(node)) continue;
      taken.add(node);
      now[from] = at(now, from) - load;
      now[index] = at(now, index) + load;
      short -= load;
      for (let child = node; child < model.count; child += 1) {
        if (child === node || isBelow(model, child, node)) strain[child] = index;
      }
    }
  }
  return strain;
}

/** One kind's flowers or fruit: what they are and where they hang. */
export interface KindOrnament {
  readonly spec: OrnamentSpec;
  readonly slots: LeafSlots;
}

/**
 * A hybrid's minor kind bears its own flowers and fruit on the limbs it holds
 * (`kinds` from `sectors`): cherry limbs on an oak blossom though the oak only
 * hangs catkins. Places follow the kind's own spec; a renderer opens them on
 * that kind's calendar. Null where the kind has none.
 */
export function kindOrnaments(
  model: TreeModel,
  species: string,
  kinds: ArrayLike<number>,
  kind: number,
): { readonly flower: KindOrnament | null; readonly fruit: KindOrnament | null } {
  const own = speciesOf(species);
  const top = model.y.reduce((most, y) => Math.max(most, y), 0);
  const source: SlotSource = {
    count: model.count,
    palm: false,
    heading: (node) => {
      const parent = at(model.parent, node);
      return parent < 0
        ? vec(0, 1, 0)
        : normalize(
            vec(
              at(model.x, node) - at(model.x, parent),
              at(model.y, node) - at(model.y, parent),
              at(model.z, node) - at(model.z, parent),
            ),
          );
    },
  };
  const grow = (spec: OrnamentSpec | null, spread: number, salt: number): KindOrnament | null => {
    if (spec === null) return null;
    const floor = (spec.above ?? 0) * top;
    const slots = leafSlots(
      source,
      spec.perNode,
      spread,
      0,
      (model.seed ^ salt ^ (kind * 0x9e37)) >>> 0,
      (node) => at(kinds, node) === kind && at(model.order, node) > 0 && at(model.y, node) >= floor,
    );
    return slots.count > 0 ? { spec, slots } : null;
  };
  return {
    flower: grow(own.flower, own.leafSpread * 0.8, 0xb105),
    fruit: grow(own.fruit, own.leafSpread * 0.7, 0xf2017),
  };
}

/**
 * How a species spends its life, as shares of the lifespan: by `prime` it is
 * most of its way grown, getting there fastest while young (`quick`
 * front-loads it); it then keeps growing, more slowly, until `old`, near the
 * very end, when the decline begins.
 */
export interface Pace {
  readonly prime: number;
  readonly quick: number;
  readonly old: number;
}

export const PACE: Readonly<Record<SpeciesId, Pace>> = {
  willow: { prime: 0.22, quick: 4.9, old: 0.875 },
  birch: { prime: 0.28, quick: 4.4, old: 0.875 },
  acacia: { prime: 0.25, quick: 4.4, old: 0.9 },
  jacaranda: { prime: 0.28, quick: 4.4, old: 0.9 },
  // Cherries are quick growers: a nursery tree is well over head height by its sixth year.
  cherry: { prime: 0.3, quick: 4.9, old: 0.9 },
  maple: { prime: 0.38, quick: 3.6, old: 0.925 },
  palm: { prime: 0.4, quick: 3.1, old: 0.925 },
  pine: { prime: 0.45, quick: 3.4, old: 0.925 },
  spruce: { prime: 0.5, quick: 3.1, old: 0.93 },
  oak: { prime: 0.55, quick: 2.9, old: 0.94 },
  baobab: { prime: 0.65, quick: 2.1, old: 0.96 },
  redwood: { prime: 0.7, quick: 2.3, old: 0.96 },
  peach: { prime: 0.22, quick: 4.6, old: 0.875 },
  plum: { prime: 0.26, quick: 4.2, old: 0.89 },
  fig: { prime: 0.25, quick: 4.4, old: 0.9 },
  apple: { prime: 0.3, quick: 3.9, old: 0.9 },
  lemon: { prime: 0.3, quick: 3.9, old: 0.9 },
  pear: { prime: 0.35, quick: 3.6, old: 0.92 },
  orange: { prime: 0.35, quick: 3.6, old: 0.92 },
  mango: { prime: 0.45, quick: 3.2, old: 0.93 },
};

const SPROUT = 0.32;

/**
 * The share of its growing done `u` of the way to old age: a Chapman–Richards
 * curve, settling in for a moment, then fast, then slowing as it fills out,
 * with a steady share on top so it never flattens: still growing every year
 * right up to old age.
 */
function grownShare(u: number, quick: number): number {
  const q = quick * YOUTH;
  const curve = ((1 - Math.exp(-q * u)) / (1 - Math.exp(-q))) ** 1.25;
  return curve * (1 - STEADY_GROWTH) + u * STEADY_GROWTH;
}

/**
 * How much faster the early curve runs over a life measured to old age: a young tree puts on most of its
 * crown in its first years (a 6-year cherry stands about 4.5 m), then fills out slowly.
 */
const YOUTH = 3.2;

/** The share of a tree's growing that comes on steadily, year after year, rather than early. */
const STEADY_GROWTH = 0.42;

/**
 * The growth cycle at an age: a fresh sprout at birth, quick when young, then
 * less and less each year on one curve until old age, then the decline to death.
 * By `prime` most of the crown is there; it never stops filling out before `old`.
 */
export function cycleAt(model: TreeModel, ageYears: number, lifespanYears: number): number {
  const life = clamp01(ageYears / Math.max(lifespanYears, 1e-6));
  const pace = PACE[model.species.id];
  if (life < pace.old) return SPROUT + (model.matureAt - SPROUT) * grownShare(life / pace.old, pace.quick);
  // Old age starts slowly: a few limbs a year at first, most of the crown only near the end.
  return model.matureAt + (model.cycles - model.matureAt) * ((life - pace.old) / (1 - pace.old)) ** 1.5;
}
