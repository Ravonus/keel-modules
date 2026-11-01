// Wind: a breeze that rises, falls and wanders, the sway it gives a tree and the flutter it gives a leaf.

import { TAU, clamp, smoothstep } from "./math.js";

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
export function sway(
  out: Offset,
  x: number,
  y: number,
  z: number,
  elapsed: number,
  wind: number,
  height: number,
  dir = 0,
): Offset {
  const reach = clamp(y / Math.max(height, 1), 0, 1.4);
  const spread = Math.min(Math.hypot(x, z) / Math.max(height * 0.5, 0.5), 1.5);
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const along = x * dx + z * dz;
  const gust = gustAt(elapsed, along);
  // The lean: always downwind, steady with the breeze and swelling with the gust.
  const lean = wind * (0.5 + 1.0 * gust) * reach * reach * 0.3 * (1 + 0.15 * Math.sin(elapsed * 0.9 + along * 0.4));
  // Small give in the outer twigs, quick and short, mostly along the wind.
  const flick =
    (wind * 0.022 + 0.003) *
    reach *
    (0.3 + spread) *
    (Math.sin(elapsed * 2.2 + x * 2.1 + y * 1.3) * (0.4 + gust) + 0.5 * gust);
  const across = flick * 0.35 * Math.cos(elapsed * 1.7 + z * 1.9 + y);
  const idle =
    0.014 *
    reach *
    (Math.sin(elapsed * 0.6 + y * 0.3) + 0.6 * Math.sin(elapsed * 0.97 + 2.1)) *
    (1 - Math.min(1, wind * 3) * 0.5);
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
  return {
    droop: 0.35 + 0.25 * rank + idle - flip * 0.3,
    twist: rank * TAU * 0.25 + tremble * 0.8 + flip,
    nod: idle * 1.5 + tremble * 0.35,
  };
}
