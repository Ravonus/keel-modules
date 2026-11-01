// Light: a grid of shadow cast down through the crown, and how exposed each node is.

import { at, clamp01, normalize, vec } from "./math.js";
import type { Vec } from "./math.js";

// ---------------------------------------------------------------- light

export const GRID_X = 84;
export const GRID_Y = 96;
const SHADOW_DEPTH = 7;
const SHADOW_FALLOFF = 1.75;
const LIGHT_FULL = 4.2;

/** The shadow-propagation light field: each internode darkens a pyramid below it. */
export interface LightGrid { readonly shadow: Float32Array }

export function cellOf(p: Vec): number {
  const ix = Math.round(p.x) + GRID_X / 2;
  const iy = Math.round(p.y) + 2;
  const iz = Math.round(p.z) + GRID_X / 2;
  if (ix < 0 || iz < 0 || iy < 0 || ix >= GRID_X || iz >= GRID_X || iy >= GRID_Y) return -1;
  return (iy * GRID_X + iz) * GRID_X + ix;
}

export function castShadow(grid: LightGrid, p: Vec, sign: number): void {
  const center = cellOf(p);
  if (center < 0) return;
  const ix = center % GRID_X;
  const iz = Math.floor(center / GRID_X) % GRID_X;
  const iy = Math.floor(center / (GRID_X * GRID_X));
  for (let q = 0; q <= SHADOW_DEPTH && iy - q >= 0; q += 1) {
    const amount = sign * SHADOW_FALLOFF ** -q;
    const reach = Math.min(q, 3);
    for (let oz = -reach; oz <= reach; oz += 1) {
      const row = ((iy - q) * GRID_X + Math.min(GRID_X - 1, Math.max(0, iz + oz))) * GRID_X;
      for (let ox = -reach; ox <= reach; ox += 1) {
        const index = row + Math.min(GRID_X - 1, Math.max(0, ix + ox));
        grid.shadow[index] = Math.max(0, at(grid.shadow, index) + amount);
      }
    }
  }
}

function shadowAt(grid: LightGrid, p: Vec): number {
  const index = cellOf(p);
  return index < 0 ? LIGHT_FULL * 2 : at(grid.shadow, index);
}

/** Exposure of a bud in [0, 1]: its own internode's shadow does not count. */
export function exposure(grid: LightGrid, p: Vec): number {
  return clamp01((LIGHT_FULL - shadowAt(grid, p) + 1) / LIGHT_FULL);
}

/** The direction of least shadow around `p`, leaning up. */
export function lightDirection(grid: LightGrid, p: Vec): Vec {
  const sample = (dx: number, dy: number, dz: number): number => shadowAt(grid, vec(p.x + dx * 2, p.y + dy * 2, p.z + dz * 2));
  const gradient = vec(sample(1, 0, 0) - sample(-1, 0, 0), sample(0, 1, 0) - sample(0, -1, 0), sample(0, 0, 1) - sample(0, 0, -1));
  return normalize(vec(-gradient.x, -gradient.y + 0.35, -gradient.z));
}
