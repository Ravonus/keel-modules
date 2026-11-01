// The year: leaves, flowers and fruit by the day, species and hemisphere.

import { speciesOf } from "./species.js";
import type { Hemisphere, OrnamentSpec, Species } from "./species.js";
import { createRandom, ramp, smooth } from "./math.js";

// ---------------------------------------------------------------- the year

export type Climate = "temperate" | "maritime" | "alpine" | "monsoon" | "highland" | "desert";

export interface YearInput {
  /** A species id; anything else grows a cherry. */
  readonly species: string;
  /** Day of the year, 1–366, at the tree. */
  readonly day: number;
  readonly year?: number;
  readonly hemisphere?: Hemisphere;
  readonly climate?: string;
}

/** What the year is doing to the crown, every value in [0, 1]. */
export interface YearState {
  /** Share of flowers open. */
  readonly bloom: number;
  /** Share of flowers that have dropped. */
  readonly petals: number;
  /** Share of fruit set and growing. */
  readonly fruit: number;
  /** Share of fruit that has fallen. */
  readonly fruitDrop: number;
  /** Leaves still on the tree are dead and brown (winter-held oak leaves). */
  readonly withered: boolean;
  /** Leaf size: 0 a closed bud, 1 full grown. */
  readonly leaf: number;
  /** Autumn color mix. */
  readonly color: number;
  /** Share of leaves that have fallen. */
  readonly drop: number;
  /** Share of fallen leaves still lying on the ground. */
  readonly litter: number;
  /** Fresh pale green of new growth. */
  readonly flush: number;
  /** The tree is bare and resting. */
  readonly dormant: boolean;
}

const SPRING_SHIFT: Readonly<Record<string, number>> = {
  alpine: 14,
  maritime: -5,
  monsoon: -6,
  desert: -10,
  highland: 0,
  temperate: 0,
};
const AUTUMN_SHIFT: Readonly<Record<string, number>> = {
  alpine: -14,
  maritime: 10,
  monsoon: 6,
  desert: 4,
  highland: 0,
  temperate: 0,
};

/** A year's own small shift: no two springs bloom on quite the same day. */
function yearJitter(year: number, seed: number): number {
  return (createRandom((year * 2654435761) ^ seed)() - 0.5) * 8;
}

interface Ornament { readonly open: number; readonly fallen: number }

/** An ornament's window, read in spring days early in the year and autumn days late in it. */
function ornamentYear(spec: OrnamentSpec | null, spring: number, autumn: number): Ornament {
  if (spec === null) return { open: 0, fallen: 0 };
  const t = spec.window[0] < 200 ? spring : autumn;
  return { open: smooth(ramp(t, spec.window[0], spec.window[1])), fallen: ramp(t, spec.window[2], spec.window[3]) };
}

function leafYear(species: Species, spring: number, autumn: number): Omit<YearState, "bloom" | "petals" | "fruit" | "fruitDrop"> {
  const spec = species.phenology;
  const leaf = smooth(ramp(spring, spec.leaf[0], spec.leaf[1]));
  const color = smooth(ramp(autumn, spec.color[0], spec.color[1]));
  const drop = spec.dropMax * ramp(autumn, spec.drop[0], spec.drop[1]);
  const lastYear = (1 - ramp(spring, 60, 104)) * 0.35 * spec.dropMax;
  const flush = 1 - ramp(spring, spec.flush[0], spec.flush[1]);
  const fallen = autumn >= spec.drop[1];
  if (spec.dropMax >= 1 && (fallen || spring < spec.leaf[0])) {
    // Bare and resting in bud while last autumn's litter rots; an oak keeps
    // some dead leaves until the new ones push them off.
    const litter = fallen ? spec.dropMax * (1 - 0.65 * ramp(autumn, spec.drop[1], 425)) : lastYear;
    const held = spec.marcescent;
    return {
      leaf: held > 0 ? 1 : 0,
      color: held > 0 ? 1 : 0,
      drop: held > 0 ? 1 - held : 0,
      litter,
      flush: 0,
      withered: held > 0,
      dormant: true,
    };
  }
  const litter = autumn >= spec.drop[0] ? drop : lastYear;
  return {
    leaf,
    color,
    drop,
    litter,
    flush: spring >= spec.flush[0] - 6 ? flush : 0,
    withered: false,
    dormant: leaf <= 0,
  };
}

/** Where the year stands for a species at a place: bud, blossom, leaf, color and fall. */
export function yearState(input: YearInput): YearState {
  const species = speciesOf(input.species);
  const spec = species.phenology;
  const hemisphere = input.hemisphere ?? "north";
  const day = hemisphere === "south" ? (input.day + 182) % 365 : input.day;
  const t = ((day - 60 + 365) % 365) + 60;
  const climate = input.climate ?? "temperate";
  const jitter = yearJitter(input.year ?? 2026, spec.leaf[0]);
  const spring = t - (SPRING_SHIFT[climate] ?? 0) - jitter;
  const autumn = t - (AUTUMN_SHIFT[climate] ?? 0) - jitter * 0.5;
  const flower = ornamentYear(species.flower, spring, autumn);
  const fruit = ornamentYear(species.fruit, spring, autumn);
  let state: YearState = {
    ...leafYear(species, spring, autumn),
    bloom: flower.open,
    petals: flower.fallen,
    fruit: fruit.open,
    fruitDrop: fruit.fallen,
  };
  if (spec.dropMax < 1) state = { ...state, leaf: 1, dormant: false };
  if (hemisphere === "equatorial") {
    state = {
      ...state,
      leaf: Math.max(state.leaf, 0.85),
      color: state.color * 0.35,
      drop: state.drop * 0.3,
      litter: state.litter * 0.3,
      withered: false,
      dormant: false,
    };
  }
  return state;
}
