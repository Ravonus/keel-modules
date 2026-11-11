// The bust put together: each part meshed from its shapes in the bust's frame (metres, the origin at the pit of the
// throat, y up, z out of the chest), the head posed on its neck by the face version. The cap and the hair sit where
// version A's head puts them, so both versions share them.

import { ARMS, chainPath, chemiseShape, dressShape, gownShape, neckShape, torso } from "./body.js";
import { capFrame, capShape } from "./cap.js";
import { compile } from "./compile.js";
import { deg, hash32, pick, turn } from "./exact.js";
import { hairMesh } from "./hair.js";
import { handShape, PINCH, POINT, type Finger } from "./hand.js";
import { EYE, EYE_Z, headShape } from "./head.js";
import { surface } from "./mesh.js";
import { blend, ellipsoid, frame, mul, rotIn, rotOut } from "./sdf.js";
import { CARD, cardPart, chainPart, eyeball, placed, type Part } from "./parts.js";
import type { Features } from "./head.js";
import type { M3, Node, V3 } from "./sdf.js";

export { type Part } from "./parts.js";

/** Which material a part draws with. */
export const PARTS = { skin: 0, hand: 1, eye: 2, cap: 3, hair: 4, dress: 5, chemise: 6, gown: 7, gold: 8, card: 9 };

/** How a part sits: a rotation (rows take a point in) and where its origin is. */
export interface Pose {
  readonly turn: M3;
  readonly at: V3;
}

export interface Detail {
  /** Cell sizes in metres: the face, the rest of the skin, the hand, cloth and the cap. */
  readonly face: number;
  readonly body: number;
  readonly hand: number;
  readonly cloth: number;
  /** Rings of an eye; locks of hair, and each lock's segments and sides. */
  readonly eye: number;
  readonly locks: number;
  readonly segments: number;
  readonly sides: number;
}

export const DETAIL: Readonly<Record<"hero" | "mid" | "far", Detail>> = {
  hero: { face: 0.0019, body: 0.004, hand: 0.0022, cloth: 0.0065, eye: 40, locks: 220, segments: 44, sides: 8 },
  mid: { face: 0.0026, body: 0.005, hand: 0.002, cloth: 0.006, eye: 24, locks: 160, segments: 22, sides: 6 },
  far: { face: 0.005, body: 0.009, hand: 0.004, cloth: 0.011, eye: 12, locks: 80, segments: 12, sides: 5 },
};

const HEAD_AT: V3 = [0, 0.185, 0.035];

/** Where the head's frame sits for each face version: A frontal, B turned and pitched down about the skull. */
export function headPose(face: "A" | "B"): Pose {
  const pivot: V3 = face === "A" ? [0, -0.07, -0.05] : [0, 0.0, -0.05];
  const r = face === "A" ? turn(deg(6), deg(-14), deg(10)) : turn(deg(20), deg(-24), deg(-3));
  const [px, py, pz] = rotOut(r, -pivot[0], -pivot[1], -pivot[2]);
  return { turn: r, at: [px + pivot[0] + HEAD_AT[0], py + pivot[1] + HEAD_AT[1], pz + pivot[2] + HEAD_AT[2]] };
}

/** Rest coordinates: each vertex taken back into a pose's frame. */
function restOf(position: Float32Array, pose: Pose): Float32Array {
  const rest = new Float32Array(position.length);
  for (let i = 0; i < position.length; i += 3) {
    rest.set(rotIn(pose.turn, (position[i] ?? 0) - pose.at[0], (position[i + 1] ?? 0) - pose.at[1],
      (position[i + 2] ?? 0) - pose.at[2]), i);
  }
  return rest;
}

function skin(f: Features, pose: Pose, detail: Detail): Part[] {
  // One field for the face and the chest, so the two meshes, at their own cell sizes, lie on the same surface.
  const all = blend(0.012, frame(pose.turn, pose.at, headShape(f)), neckShape(), torso(ARMS, -0.0006));
  const h = surface(all, { lo: [-0.105, 0.072, -0.045], hi: [0.105, 0.236, 0.13], cell: detail.face, reach: 0.014 });
  const b = surface(all, { lo: [-0.18, -0.105, -0.075], hi: [0.18, 0.092, 0.1], cell: detail.body, reach: 0.02 });
  return [
    { name: "skin", kind: PARTS.skin, ...h, rest: restOf(h.position, pose) },
    { name: "chest", kind: PARTS.skin, ...b, rest: restOf(b.position, pose) },
  ];
}

/**
 * Where each layer can be seen, down to the frame's lower edge: the chemise only in the neckline, the dress only in
 * the gown's opening and on the raised arm. What the outer layers or the frame hide is not meshed.
 */
const SEEN: Readonly<Record<string, readonly [V3, V3]>> = {
  chemise: [[-0.16, -0.16, -0.06], [0.16, 0.0, 0.1]],
  dress: [[-0.32, -0.3, -0.035], [0.16, 0.06, 0.32]],
  gown: [[-0.36, -0.3, -0.2], [0.36, 0.1, 0.32]],
};

function cloth(name: string, kind: number, node: Node, detail: Detail): Part {
  const [lo, hi] = SEEN[name] ?? [[-0.36, -0.46, -0.2], [0.36, 0.1, 0.32]];
  // The chemise is gathered finer than the cells the other layers need.
  const cell = name === "chemise" ? detail.cloth * 0.75 : detail.cloth;
  const s = surface(node, { lo, hi, cell, reach: 0.03 });
  return { name, kind, ...s, rest: s.position.slice() };
}

function capAndHair(seed: number, face: "A" | "B", detail: Detail): Part[] {
  const a = headPose("A");
  const cap = capFrame(face);
  const capNode = frame(a.turn, a.at, capShape(cap));
  const box = { lo: [-0.13, 0.14, -0.19], hi: [0.15, 0.38, 0.1] } as const;
  const c = surface(capNode, { ...box, cell: detail.cloth * 0.7, reach: 0.02 });
  const under = frame(a.turn, a.at, blend(0.03,
    ellipsoid([0, -0.01, -0.075], [0.078, 0.1, 0.068]),
    ...[1, -1].map((s) => ellipsoid([s * 0.062, -0.075, -0.105], [0.026, 0.085, 0.036])),
    ellipsoid([0, -0.09, -0.11], [0.07, 0.11, 0.03]),
  ));
  const u = surface(under, { lo: [-0.14, -0.08, -0.2], hi: [0.14, 0.28, 0.06], cell: detail.cloth * 1.5, reach: 0 });
  const body = compile(blend(0.01, frame(a.turn, a.at, ellipsoid([0, -0.01, -0.035], [0.078, 0.122, 0.1])),
    neckShape(), torso(ARMS, 0.03)), [0, 0, 0, 1], 1);
  const hair = hairMesh({ seed, locks: detail.locks, segments: detail.segments, sides: detail.sides, length: 0.28 },
    cap, body ?? (() => 1), a);
  return [
    { name: "cap", kind: PARTS.cap, ...c, rest: restOf(c.position, a) },
    { name: "under", kind: PARTS.hair, ...u, rest: new Float32Array(u.position.length).fill(0.5), flow: undefined },
    { name: "hair", kind: PARTS.hair, ...hair },
  ];
}

export interface BustRecipe {
  readonly seed: number;
  readonly face: "A" | "B";
  readonly detail: Detail;
  /** The hand: index raised with the card floating above it, or the card pinched. */
  readonly hand: "point" | "pinch";
}

export interface Bust {
  readonly parts: readonly Part[];
  readonly pose: Pose;
  readonly eyes: readonly [V3, V3];
  readonly cap: ReturnType<typeof capFrame>;
  /** Where the card is, in the bust's frame. */
  readonly card: Pose;
  readonly nails: readonly Nail[];
}

/** What a seed decides of the face, each a small share either side of the mean. */
export function featuresOf(seed: number): Features {
  return {
    eyes: pick(seed, 1, 0.0285, 0.03), nose: pick(seed, 2, 0.9, 0.96), lips: pick(seed, 3, 0.94, 1.06),
    jaw: pick(seed, 4, 0.95, 1.03), chin: pick(seed, 5, 0.97, 1.03), cheeks: pick(seed, 6, 0.96, 1.04),
  };
}

const HAND_TURN = turn(deg(-12), deg(28), deg(-14));

const unit3 = (v: readonly number[]): V3 => {
  const [x, y, z] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
};

/**
 * The card shown by its lower edge: square to the palm, pressed by the thumb against the index's and the middle's
 * pads, running on up past the fingertips and gripped a little in from a corner. In the hand's frame.
 */
function pinched(index: Finger): Pose {
  const [a, b] = [index.joints[2] ?? [0, 0, 0], index.joints[3] ?? [0, 0, 0]];
  const z: V3 = [0, 0, 1];
  const y = unit3([b[0] - a[0], b[1] - a[1], 0]);
  const x: V3 = [y[1], -y[0], 0];
  const grip = [0, 1, 2].map((i) => (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * 0.7);
  const front = (grip[2] ?? 0) + index.radius * 0.78 + CARD[2] / 2 + 0.0004;
  const [up, over] = [CARD[1] / 2 - 0.012, CARD[0] / 2 - 0.026];
  const at: V3 = [(grip[0] ?? 0) + y[0] * up - x[0] * over, (grip[1] ?? 0) + y[1] * up - x[1] * over, front];
  return { turn: [...x, ...y, ...z] as unknown as M3, at };
}

/** The last bone of each finger and the thumb, in the hand's frame: its two ends, its radius and its back. */
export interface Nail {
  readonly from: V3;
  readonly to: V3;
  readonly radius: number;
  readonly back: V3;
}

function handParts(kind: "point" | "pinch", detail: Detail): { parts: Part[]; card: Pose; nails: Nail[] } {
  const shape = handShape(kind === "point" ? POINT : PINCH);
  const s = surface(shape.node, { lo: [-0.05, -0.06, -0.05], hi: [0.075, 0.2, 0.08], cell: detail.hand, reach: 0.012 });
  const place: Pose = { turn: HAND_TURN, at: ARMS.wrist };
  const hand = placed({ name: "hand", kind: PARTS.hand, ...s, rest: s.position.slice() }, place);
  const index = shape.fingers[0];
  const tip = index?.joints[3] ?? [0, 0.18, 0];
  const local: Pose = kind === "point" || !index
    ? { turn: turn(deg(-10), deg(15), deg(36)), at: [tip[0] + 0.014, tip[1] + 0.05, tip[2] + 0.004] }
    : pinched(index);
  const card: Pose = {
    turn: mul(local.turn, HAND_TURN),
    at: rotOut(HAND_TURN, ...local.at).map((v, i) => v + (ARMS.wrist[i] ?? 0)) as unknown as V3,
  };
  const nails = [...shape.fingers, shape.thumb].map((f) => ({
    from: f.joints[2] ?? [0, 0, 0], to: f.joints[3] ?? [0, 0, 0], radius: f.radius, back: f.back,
  }));
  return { parts: [hand, cardPart(PARTS.card, card)], card, nails };
}


const cache = new Map<string, Bust>();

/** The recipe's digest: what the cache is keyed by. */
export function digestOf(recipe: BustRecipe): string {
  const d = recipe.detail;
  const words = [recipe.seed, recipe.face === "A" ? 1 : 2, recipe.hand === "point" ? 1 : 2,
    Math.round(d.face * 1e6), Math.round(d.body * 1e6), Math.round(d.hand * 1e6), Math.round(d.cloth * 1e6), d.eye,
    d.locks, d.segments, d.sides];
  return hash32(...words).toString(16).padStart(8, "0");
}

/** The bust for a recipe, meshed once and then taken from the cache. */
export function buildBust(recipe: BustRecipe): Bust {
  const key = digestOf(recipe);
  const hit = cache.get(key);
  if (hit) return hit;
  const pose = headPose(recipe.face);
  const f = featuresOf(recipe.seed);
  const eyes: [V3, V3] = [[f.eyes, 0, EYE_Z], [-f.eyes, 0, EYE_Z]];
  const d = recipe.detail;
  const hand = handParts(recipe.hand, d);
  const parts = [
    ...skin(f, pose, d),
    ...eyes.map((centre) => eyeball(PARTS.eye, { centre, radius: EYE }, d.eye, pose)),
    ...capAndHair(recipe.seed, recipe.face, d),
    cloth("chemise", PARTS.chemise, chemiseShape(ARMS), d),
    cloth("dress", PARTS.dress, dressShape(ARMS), d),
    cloth("gown", PARTS.gown, gownShape(ARMS), d),
    chainPart(PARTS.gold, chainPath(160), blend(0.012, neckShape(), torso(ARMS, 0))),
    ...hand.parts,
  ];
  const bust: Bust = { parts, pose, eyes, cap: capFrame(recipe.face), card: hand.card, nails: hand.nails };
  cache.set(key, bust);
  return bust;
}
