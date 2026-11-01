// The idle matrix: what an animal does next, by species, hour and weather, as a Markov chain over its actions.

import { pick } from "../roll.js";
import { MOVES, speciesOf } from "../roster.js";
import type { Action, Plan, SpeciesId, SpeciesSpec } from "../roster.js";

// ---------------------------------------------------------------- the idle matrix

/** What each body plan can do, and how readily, before an animal's temper weights it. */
const PLAN_ACTIONS: Readonly<Record<Plan, Partial<Record<Action, number>>>> = {
  quad: { stand: 1, look: 1.2, sniff: 1, graze: 0.5, groom: 0.8, scratch: 0.5, sit: 1, lie: 0.7, sleep: 0.4, stretch: 0.4, shake: 0.3, yawn: 0.3, rear: 0.2, dig: 0.3, roll: 0.12, wander: 1.6, run: 0.25 },
  primate: { stand: 0.5, sit: 1.4, look: 1, groom: 1, scratch: 0.8, eat: 0.8, sleep: 0.4, yawn: 0.3, wander: 0.9, climb: 1, hang: 0.4 },
  bird: { stand: 1, look: 1.2, peck: 1, preen: 0.8, flap: 0.4, sing: 0.6, hop: 1, fly: 0.8, sleep: 0.25 },
  serpent: { bask: 1, coil: 0.8, flick: 0.8, look: 0.6, wander: 1, climb: 0.3 },
  bug: { hover: 1, wander: 1, sit: 0.5 },
  crab: { stand: 1, wave: 0.8, dig: 0.6, look: 0.6, wander: 1.4, sit: 0.9, lie: 0.5 },
};

/** How one action leads to the next: a row's multipliers on the plan's odds (1 when left out). */
const FLOW: Partial<Record<Action, Partial<Record<Action, number>>>> = {
  stand: { sleep: 0.05, roll: 0.3 },
  look: { sleep: 0.05, rear: 1.6, run: 1.5 },
  wander: { sniff: 1.6, look: 1.4, graze: 1.5, peck: 1.5, wander: 0.4, sleep: 0.05 },
  run: { stand: 2, look: 2, shake: 1.6, run: 0.1, sleep: 0 },
  sit: { lie: 2.2, groom: 1.6, scratch: 1.6, yawn: 1.4, howl: 2, eat: 1.6, sleep: 0.6 },
  lie: { sleep: 4, roll: 2.5, sit: 1.5, stretch: 2, groom: 1.4, run: 0.1, wander: 0.4 },
  sleep: { lie: 3, stretch: 3, yawn: 3, sit: 1.5, sleep: 0, wander: 0.2, run: 0, hang: 2 },
  stretch: { shake: 2, yawn: 1.5, wander: 1.4, stretch: 0 },
  roll: { shake: 3, lie: 2, roll: 0 },
  graze: { graze: 1.2, look: 1.8, wander: 1.4, sleep: 0.05 },
  peck: { peck: 0.8, hop: 1.6, look: 1.6, fly: 1.2 },
  hang: { hang: 0.4, sleep: 2.5, eat: 1.6, climb: 1.6 },
  bask: { bask: 0.6, flick: 2, coil: 1.4 },
  hover: { hover: 0.5, wander: 2, sit: 1.6 },
  howl: { howl: 0.2, sit: 2, lie: 1.4 },
  display: { display: 0, preen: 2, peck: 1.4 },
  drum: { drum: 0.4, look: 2, fly: 1.4 },
  // A hunter's creep ends in a pounce (a run or a hop) or a dig at what it heard; it never just stops and sleeps.
  stalk: { dig: 3, sniff: 2, run: 1.6, hop: 1.4, look: 1.4, stalk: 0, sleep: 0, lie: 0.3 },
  rear: { look: 1.6, rear: 0.3, run: 1.3, sleep: 0.1 },
  sing: { fly: 1.4, preen: 1.3, sing: 0.5 },
  dig: { eat: 1.6, sniff: 1.4, dig: 0.5 },
  eat: { groom: 1.6, sit: 1.3, eat: 0.5 },
  // A flight ends looking about, preening or singing where it landed, and seldom straight off again.
  fly: { look: 1.6, preen: 1.4, sing: 1.3, peck: 1.2, fly: 0.25 },
  climb: { eat: 1.6, sit: 1.4, look: 1.4, hang: 1.3 },
};

export const SPAN: Readonly<Record<Action, readonly [number, number]>> = {
  stand: [2, 5], look: [2, 4.5], sniff: [1.5, 3.5], graze: [4, 10], groom: [3, 7], scratch: [1.5, 3], sit: [4, 10], lie: [6, 14],
  sleep: [12, 30], stretch: [1.8, 2.6], shake: [0.9, 1.3], yawn: [1.4, 2], rear: [2, 5], dig: [2, 5], roll: [2.5, 4], howl: [3, 5],
  eat: [3, 8], peck: [1.2, 3], preen: [2, 5], flap: [1, 2], sing: [2, 4.5], display: [5, 9], drum: [1.5, 3.5], bask: [6, 14],
  coil: [6, 12], flick: [1, 2], hover: [2, 5], wave: [1.5, 3], hang: [6, 16], nuzzle: [2.5, 4], play: [1.6, 2.6],
  wander: [2, 5], run: [1, 2], hop: [1, 2.5], climb: [3, 6], fly: [2, 4], stalk: [2, 4],
};

/** Actions that only make sense on the ground; an animal up a tree comes down first. */
export const GROUNDED: ReadonlySet<Action> = new Set<Action>(["graze", "dig", "roll", "run", "wander", "hop", "display", "wave", "play", "stretch", "stalk"]);

export interface IdleMatrix {
  readonly actions: readonly Action[];
  /** rows[i][j]: the chance that action j follows action i. Every row sums to 1. */
  readonly rows: readonly (readonly number[])[];
}

/** The columns an animal can choose: its plan's actions and the ones its temper adds. */
export function actionsOf(spec: SpeciesSpec): Action[] {
  const base = PLAN_ACTIONS[spec.plan];
  const out = new Set<Action>(Object.keys(base) as Action[]);
  // A temper of 0 takes an action off the animal's menu: a tortoise does not run, a fox does not graze.
  for (const [action, weight] of Object.entries(spec.temper) as [Action, number][]) if (weight > 0) out.add(action); else out.delete(action);
  if (!spec.climbs && spec.plan !== "bird") { out.delete("climb"); out.delete("hang"); }
  if (!spec.flies) out.delete("fly");
  return [...out];
}

/** What the hour and the sky are doing: night, rain or snow, and the half-light of dawn and dusk. */
export interface Mood {
  readonly night?: boolean | undefined;
  readonly weather?: string | undefined;
  readonly twilight?: boolean | undefined;
}

/** Rain sends animals to rest and shelter (a bird sits it out preening, a butterfly folds its wings); snow slows everything and sets the hungry digging. */
const WET: Partial<Record<Action, number>> = { sit: 1.8, lie: 1.6, sleep: 1.5, preen: 2, shake: 3, groom: 1.4, hang: 1.5, coil: 1.5, play: 0.3, display: 0.3, sing: 0.4, bask: 0.1, hover: 0.25 };
const SNOWY: Partial<Record<Action, number>> = { lie: 1.8, sleep: 1.8, sit: 1.4, dig: 1.8, shake: 2, play: 0.6, bask: 0.2, display: 0.4, sing: 0.5, graze: 0.8 };
/** At dawn and dusk the birds sing, the wolves howl and the kookaburras laugh; the deer come out to graze. */
const TWILIGHT: Partial<Record<Action, number>> = { sing: 3, howl: 2.5, graze: 1.4, look: 1.2, drum: 1.5, display: 1.3, sleep: 0.6 };

function columnWeight(spec: SpeciesSpec, action: Action, mood: Mood): number {
  const base = PLAN_ACTIONS[spec.plan][action] ?? 0.6;
  const temper = spec.temper[action] ?? 1;
  const night = mood.night === true;
  const asleepNow = spec.active !== "any" && (spec.active === "day") === night;
  const sky = skyWeight(action, mood);
  const hour = mood.twilight === true ? TWILIGHT[action] ?? 1 : 1;
  if (!asleepNow) return base * temper * sky * hour;
  const drowsy: Partial<Record<Action, number>> = { sleep: 8, lie: 3, sit: 2, hang: 3, coil: 3, hover: 0.1 };
  return base * temper * sky * hour * (drowsy[action] ?? (MOVES.has(action) ? 0.15 : 0.35));
}

/** How the weather weighs an action: rain and snow keep animals still, and fliers out of the air. */
function skyWeight(action: Action, mood: Mood): number {
  const moving = MOVES.has(action);
  if (mood.weather === "rain") return WET[action] ?? (action === "fly" ? 0.3 : moving ? 0.5 : 1);
  if (mood.weather === "snow") return SNOWY[action] ?? (moving ? 0.6 : 1);
  return 1;
}

export function matrixOf(spec: SpeciesSpec, mood: Mood): IdleMatrix {
  const actions = actionsOf(spec);
  const columns = actions.map((action) => columnWeight(spec, action, mood));
  const rows = actions.map((from) => {
    const flow = FLOW[from] ?? {};
    const raw = actions.map((to, j) => (columns[j] ?? 0) * (flow[to] ?? (to === from ? 0.25 : 1)));
    const total = raw.reduce((sum, value) => sum + value, 0) || 1;
    return raw.map((value) => value / total);
  });
  return { actions, rows };
}

/**
 * The animal's matrix of idle actions: which action follows which, and how
 * often. A sleeping row leads to waking things, a lying row to sleep or a roll,
 * and at the wrong time of day (an owl at noon, a deer at midnight) every row
 * leans toward rest. Rain and snow lean it toward shelter and rest too, and
 * dawn and dusk toward song.
 */
export function idleMatrix(id: SpeciesId, mood: Mood = {}): IdleMatrix {
  return matrixOf(speciesOf(id), mood);
}

export function nextAction(matrix: IdleMatrix, from: Action, rand: () => number): Action {
  const row = matrix.rows[matrix.actions.indexOf(from)] ?? matrix.rows[0] ?? [];
  return pick(rand, matrix.actions.map((action, j) => [action, row[j] ?? 0] as const));
}
