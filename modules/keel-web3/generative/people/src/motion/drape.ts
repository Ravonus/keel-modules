// How cloth carries on after the body: state a host keeps for each person and steps each frame, so a stop can settle,
// a turn can wrap and swing back, and a move can send a wave down what hangs. What it gives goes to the renderer whole.

import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import type { Action } from "./skeleton.js";
import { createHang, velocityAt } from "./pose.js";

/** What cloth is doing: how far it trails, how far round it has been left by a turn, and the wave running down it. */
export interface Drape {
  /** In the body's frame, metres: `sway`'s first three. */
  readonly trail: Vec;
  /** Radians the hem lags the hips by. */
  readonly twist: number;
  /** How tall the wave is, metres, and where it has got to. */
  readonly wave: number;
  readonly phase: number;
}

/** How a body is moving this step: velocity in its own frame, metres a second, and turning, radians a second. */
export interface Going {
  readonly velocity: Vec;
  readonly turn?: number;
}

/** How hard the hem is pulled back round, how fast that dies, and how far each radian a second leaves it. */
const TWIST_STIFF = 26;
const TWIST_DAMP = 4.5;
const TWIST_HELD = 0.1;
const TWIST_MOST = 0.8;
/** How much wave a change of speed starts, and how fast it dies: a stop's is gone in about a second. */
const WAVE_FROM = 0.012;
const WAVE_DIES = 2.6;
const WAVE_MOST = 0.035;
/** How fast the wave runs when still, and for each metre a second of going. */
const WAVE_RUNS = 7;
const WAVE_RUNS_MORE = 1.5;

const clamp = (v: number, most: number): number => Math.max(-most, Math.min(most, v));

/** One person's cloth over time: start one for each, and step it with how they go. */
export function createDrape(p: Person): { step(dt: number, going: Going): Drape } {
  const hang = createHang();
  const size = p.build.size;
  let twist = 0;
  let spin = 0;
  let wave = 0;
  let phase = 0;
  let last: Vec = [0, 0, 0];
  let lastTurn = 0;
  return {
    step(dt, { velocity, turn = 0 }) {
      const trail = hang.step(dt, velocity);
      const pull = (-turn * TWIST_HELD - twist) * TWIST_STIFF - spin * TWIST_DAMP;
      spin += pull * dt - (turn - lastTurn) * TWIST_HELD;
      twist = clamp(twist + spin * dt, TWIST_MOST);
      lastTurn = turn;
      const kick = Math.hypot(velocity[0] - last[0], velocity[1] - last[1], velocity[2] - last[2]);
      const speed = Math.hypot(...velocity);
      last = velocity;
      wave = Math.min(WAVE_MOST * size, wave * Math.exp(-WAVE_DIES * dt) + kick * WAVE_FROM * size);
      phase += dt * (WAVE_RUNS + speed * WAVE_RUNS_MORE);
      return { trail, twist, wave, phase };
    },
  };
}

/** Where a person's cloth has got to by `t`, for one still: its state run up to then. */
export function drapeAt(p: Person, action: Action, t: number): Drape {
  const drape = createDrape(p);
  let now = drape.step(1 / 60, { velocity: velocityAt(p, action, t - 2) });
  for (let i = 119; i >= 0; i -= 1) now = drape.step(1 / 60, { velocity: velocityAt(p, action, t - i / 60) });
  return now;
}
