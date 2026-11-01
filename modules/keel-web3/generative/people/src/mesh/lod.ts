// Levels of detail: a crowd's cells by distance, within a budget that gives way to long frames.

import { clamp } from "../vec.js";

/**
 * How finely to build a person by how far off they are, finest first: `reach` in metres, `kept` how many to hold built
 * at once, `tris` about what one comes to.
 */
export const PERSON_LODS = [
  { name: "touching", cell: 0.014, reach: 3, kept: 4, tris: 75000 },
  { name: "close", cell: 0.02, reach: 9, kept: 8, tris: 43000 },
  { name: "medium", cell: 0.03, reach: 28, kept: 48, tris: 13000 },
  { name: "far", cell: 0.05, reach: 80, kept: 96, tris: 7700 },
  { name: "least", cell: 0.09, reach: Infinity, kept: 256, tris: 2000 },
] as const;
/** A grid this coarse has no use for a cage's second cut, and that alone is most of a far person. */
export const LEAST_CELL = 0.07;

/**
 * Which of `PERSON_LODS` a person at `distance` wants. `was`, the tier they are on, holds them a little past its reach,
 * so nobody flickers on a line.
 */
export function lodFor(distance: number, was?: number): number {
  const want = PERSON_LODS.findIndex((lod) => distance < lod.reach);
  return was !== undefined && want === was + 1 && distance < (PERSON_LODS[was]?.reach ?? 0) * 1.15 ? was : want;
}

/**
 * The tier each of a crowd gets, nearest first, for `budget` triangles in all: everybody has the least, then the
 * nearest have what they want while it lasts.
 */
export function lodsWithin(wants: readonly number[], budget: number): readonly number[] {
  const last = PERSON_LODS.length - 1;
  const least = PERSON_LODS[last]?.tris ?? 0;
  let left = budget - wants.length * least;
  return wants.map((want) => {
    const tier = PERSON_LODS.findIndex(
      (lod, i) => i >= Math.min(want, last) && (i === last || lod.tris - least <= left),
    );
    left -= (PERSON_LODS[tier]?.tris ?? least) - least;
    return tier;
  });
}

/**
 * Frames longer than this (ms) are too long, and shorter than this leave room; one longer still is a pause, not load.
 */
const FRAME_LONG = 28;
const FRAME_ROOMY = 20;
const FRAME_PAUSE = 250;

/**
 * A crowd's triangle budget following the frame: down quickly while frames run long, back slowly when they don't.
 * Nothing but drawing may hang on it.
 */
/** How a budget moves on one frame: down a little after a long one, up a hair after a roomy one, else held. */
function paceOf(frameMs: number): number {
  if (frameMs > FRAME_LONG) return 0.98;
  return frameMs < FRAME_ROOMY ? 1.002 : 1;
}

export function crowdBudget(most: number, floor: number): (frameMs: number) => number {
  let budget = most;
  return (frameMs) => {
    if (frameMs < FRAME_PAUSE) budget = clamp(budget * paceOf(frameMs), floor, most);
    return budget;
  };
}
