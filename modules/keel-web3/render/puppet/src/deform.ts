// A frame's deformation: shape keys, then bones (children first), then the states crossed by their dissolve. On the
// CPU, a few thousand vertices a frame; only layers with keys or bones are touched, and only when a value changed.

import { clamp, cosine, radians, sine, smooth } from "./exact.js";
import { liftAt, reachWeight } from "./figure.js";
import type { BindPlan, LayerPlan, Sheet, Vec2 } from "./figure.js";

/** A bone's turn this frame for one state: the pivot, cosine and sine. */
interface Turn {
  readonly x: number;
  readonly y: number;
  readonly c: number;
  readonly s: number;
}

/** A bone's angle for a state, in radians: its parameter less the angle that state was painted at. */
const angleOf = (bind: BindPlan, state: number, values: Readonly<Record<string, number>>): number =>
  radians((values[bind.bone.param] ?? 0) - (bind.rest[state] ?? 0));

function turnsOf(plan: LayerPlan, state: number, values: Readonly<Record<string, number>>): Turn[] {
  return plan.binds.map((bind) => {
    const a = angleOf(bind, state, values);
    return { x: bind.bone.at[0], y: bind.bone.at[1], c: cosine(a), s: sine(a) };
  });
}

/** Turns a point about each bone in order, by its weight there: a linear blend, a bone at a time. */
function turned(turns: readonly Turn[], weights: readonly number[], p: Vec2): [number, number] {
  let [x, y] = p;
  turns.forEach((t, b) => {
    const w = weights[b] ?? 0;
    if (w <= 0) return;
    const [dx, dy] = [x - t.x, y - t.y];
    x += w * (t.x + t.c * dx - t.s * dy - x);
    y += w * (t.y + t.s * dx + t.c * dy - y);
  });
  return [x, y];
}

/** The dissolve's share of the second state, 0 to 1, from its parameter through its window. */
export function dissolveOf(plan: LayerPlan, values: Readonly<Record<string, number>>): number {
  const d = plan.spec.dissolve;
  if (d === undefined) return 0;
  const [lo, hi] = d.window ?? [0.3, 0.7];
  return clamp(((values[d.param] ?? 0) - lo) / Math.max(1e-6, hi - lo), 0, 1);
}

/**
 * Writes one state's deformed positions into `out` (x, y, z a vertex), and, with `clip`, the matching place in the
 * clipping layer's matte into `clipUv`.
 */
export function deformSheet(plan: LayerPlan, state: number, values: Readonly<Record<string, number>>,
  out: { position: Float32Array; clipUv?: Float32Array; clip?: LayerPlan }): void {
  const sheet = plan.sheets[state] ?? plan.sheets[0];
  if (sheet === undefined) return;
  const turns = turnsOf(plan, state, values);
  const weights = plan.spec.keys?.map((k) => values[k.param] ?? 0) ?? [];
  const boneWeights: number[] = [];
  const box = out.clip?.spec.rect;
  for (let v = 0; v < sheet.rest.length / 3; v += 1) {
    let [x, y] = [sheet.rest[v * 3] ?? 0, sheet.rest[v * 3 + 1] ?? 0];
    plan.keys.forEach((key, k) => {
      x += (weights[k] ?? 0) * (key[v * 2] ?? 0);
      y += (weights[k] ?? 0) * (key[v * 2 + 1] ?? 0);
    });
    plan.binds.forEach((bind, b) => (boneWeights[b] = bind.weight[v] ?? 0));
    [x, y] = turned(turns, boneWeights, [x, y]);
    out.position.set([x, y, sheet.rest[v * 3 + 2] ?? 0], v * 3);
    if (box && out.clipUv) out.clipUv.set([(x - box[0]) / box[2], (y - box[1]) / box[3]], v * 2);
  }
}

/** A named point of a layer this frame, in the figure's frame, and how far the bones there turn it (radians). */
export interface Anchor {
  readonly at: readonly [number, number, number];
  readonly turn: number;
}

function anchorIn(plan: LayerPlan, state: number, p: Vec2, values: Readonly<Record<string, number>>): Anchor {
  const weights = plan.binds.map((bind) => (bind.reach ? reachWeight(bind.reach, p) : 1));
  const [x, y] = turned(turnsOf(plan, state, values), weights, p);
  const sheet: Sheet | undefined = plan.sheets[state] ?? plan.sheets[0];
  const lift = sheet ? liftAt(plan, sheet, p) : 0;
  const turn = plan.binds.reduce((sum, bind, b) => sum + (weights[b] ?? 0) * angleOf(bind, state, values), 0);
  return { at: [x, y, plan.spec.z + lift], turn };
}

/**
 * A named point carried by its layer's bones, crossed between the two states' points by the dissolve's eased share.
 *
 * @returns The point and its turn, or undefined when no state of the layer names it.
 */
export function anchorOf(plan: LayerPlan, name: string, values: Readonly<Record<string, number>>): Anchor | undefined {
  const found = plan.spec.states.map((s, i) => {
    const p = s.anchors?.[name];
    return p === undefined ? undefined : anchorIn(plan, i, p, values);
  });
  const [a, b] = [found[0] ?? found[1], found[1] ?? found[0]];
  if (a === undefined || b === undefined) return undefined;
  const t = smooth(dissolveOf(plan, values));
  const mix = (p: number, q: number): number => p + (q - p) * t;
  return { at: [mix(a.at[0], b.at[0]), mix(a.at[1], b.at[1]), mix(a.at[2], b.at[2])], turn: mix(a.turn, b.turn) };
}
