// Snakes and lizards: a spine laid on its trail, its girth, lines and saddles, and a gecko's feet.

import { TAU, UP, add, cross, dot, length, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Role } from "../roster.js";
import { bodyStride } from "../stage/moments.js";
import type { Moment } from "../stage/moments.js";
import { ball, cap, decal, footCycle, headAxes, limb } from "./kit.js";
import type { Kit } from "./kit.js";
import { at3, eyeAt } from "./quad-head.js";
import type { Head } from "./quad-head.js";
import { eyeOfSpecies } from "./coats.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- snakes and lizards

/** A point `back` along an animal's trail, in its own frame; past the trail's end, straight on the way it was going. */
function onTrail(m: Moment, back: number): Vec {
  const way = m.trail ?? [];
  let left = back;
  let at: Vec = way[0] ?? m.frame.o;
  let last: Vec = [0, 0, -1];
  for (const next of way.slice(1)) {
    const span = length(sub(next, at));
    if (span < 1e-6) continue;
    last = scale(sub(next, at), 1 / span);
    if (span >= left) break;
    left -= span;
    at = next;
  }
  const { o, x, y, z } = m.frame;
  const from = sub(madd(at, last, left), o);
  return [dot(from, x), dot(from, y), dot(from, z)];
}

function serpentSpine(who: Who, m: Moment): Vec[] {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const lizard = b.leg > 0;
  const n = lizard ? 8 : 12;
  const r0 = b.body * size;
  const seg = size / n;
  // (A coil wants the ground: on the wood it stays laid along the branch.)
  const flat = lizard || m.trail ? 0 : q.curl;
  const points: Vec[] = [];
  for (let i = 0; i <= n; i += 1) {
    const moving =
      m.moving * Math.sin(TAU * m.phase * 0.8 - i * 0.7) * size * 0.06 * (lizard ? 0.4 : 1) * Math.min(1, i / 3);
    // At rest a snake lies in a loose S, a lizard nearly straight.
    const rest =
      size * (lizard ? 0.07 : 0.12) * Math.sin(i * (lizard ? 0.55 : 0.62) + 0.2 * Math.sin(m.t * 0.3)) * (1 - m.moving);
    const straight: Vec = m.trail
      ? add(onTrail(m, i * seg), [moving * 0.3, r0, 0])
      : [moving + rest, r0, -i * seg * 0.95];
    // Coiled, one loose turn (an open ring at a distance, not a disc), the head reared up in the middle.
    const a = i * 0.55;
    const ring = r0 * (8.5 - i * 0.42);
    const coil: Vec = [Math.cos(a) * ring, r0 + (n - i) * r0 * 0.2, Math.sin(a) * ring - r0 * 8.5];
    const lift = Math.max(0, 3 - i) / 3;
    const rear = flat === 0 ? 0 : q.curl * lift * size * 0.14;
    points.push(
      add(lerpV(straight, coil, flat), [0, rear + lift * (q.headPitch * size * 0.08 + q.mouth * size * 0.02), 0]),
    );
  }
  return points;
}

/** A snake's girth along it, 0 at the neck, 1 at the tip: slim at the neck, fullest a third of the way down, to a fine tip. */
const snakeGirth = (k: number): number =>
  k < 0.3 ? 0.78 + (k / 0.3) * 0.22 : 1 - Math.pow((k - 0.3) / 0.7, 1.6) * 0.85;

export function poseSerpent(kit: Kit, who: Who, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const points = serpentSpine(who, m);
  const r0 = b.body * size;
  const n = points.length - 1;
  const banded = who.member.coat === "banded";
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const c = points[i + 1];
    if (!a || !c) continue;
    // Slim at the neck, fullest a third of the way down, to a fine tip.
    const taper = snakeGirth(i / n);
    cap(kit, `body.${i}`, banded && i % 2 === 1 ? "alt" : "coat", a, c, r0 * taper, 0.8, UP, { r1: r0 * snakeGirth((i + 1) / n) });
    if (b.extras.includes("spots") && i % 2 === 0) ball(kit, "spot", "accent", add(lerpV(a, c, 0.5), [0, r0 * taper * 0.6, 0]), r0 * taper * 0.35, 0.5);
  }
  if (b.leg === 0) snakeMarks(kit, who, points, r0);
  serpentHead(kit, who, points, m);
  if (b.leg > 0) lizardLegs(kit, who, points, m);
}

/** How a snake is marked, by coat: long lines down it or saddles across it. A plain one is its colour, and a banded one its rings. */
const SNAKE_LINES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  garter: [[0, 0.94], [-0.8, 0.5], [0.8, 0.5]],
  "red-bellied": [[-0.86, -0.2], [0.86, -0.2]],
};
const SNAKE_SADDLED: ReadonlySet<string> = new Set(["corn"]);

/** Which way is out to the side of a spine going from `a` to `b`. */
const spineSide = (a: Vec, b: Vec): Vec => unit(cross(UP, sub(b, a)));

/** The long lines down a snake, laid on it every other bone so they follow its bends. */
function snakeLines(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  const lines = SNAKE_LINES[who.member.coat] ?? [];
  const role: Role = who.member.coat === "garter" ? "alt" : "belly";
  const n = points.length - 1;
  for (let i = 0; i + 2 <= n; i += 2) {
    const [a, c] = [points[i], points[i + 2]];
    if (!a || !c) continue;
    const side = spineSide(a, c);
    const [gA, gC] = [r0 * snakeGirth(i / n), r0 * snakeGirth((i + 2) / n)];
    const on = (p: Vec, x: number, y: number, g: number): Vec =>
      add(add(p, scale(side, x * g * 0.8)), [0, y * g * 0.8, 0]);
    // (Sunk well into the body, so the line stays on the skin where the bones bend away from a straight run.)
    lines.forEach(([x, y], line) => { cap(kit, `line.${line}`, role, on(a, x, y, gA), on(c, x, y, gC), gA * 0.24, 1, UP, { decal: true, r1: gC * 0.24 }); });
  }
}

/** Saddles across a snake's back, as many and as far apart as its own mark says. */
function snakeSaddles(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  const gene = createRandom(markOf(who) ^ 0x6c8e9cf5);
  const n = points.length - 1;
  const gap = mix(1.5, 2.3, gene());
  for (let k = 1 + gene(); k < n - 1.5; k += gap) {
    const i = Math.floor(k);
    const [a, c] = [points[i], points[i + 1]];
    if (!a || !c) continue;
    const at = add(lerpV(a, c, k - i), [0, r0 * 0.8, 0]);
    const side = scale(spineSide(a, c), r0 * mix(0.5, 0.8, gene()) * (1 - k / n / 2));
    decal(kit, "saddle", "alt", sub(at, side), add(at, side), r0 * 0.42);
  }
}

function snakeMarks(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  snakeLines(kit, who, points, r0);
  if (SNAKE_SADDLED.has(who.member.coat)) snakeSaddles(kit, who, points, r0);
}

function serpentHead(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const r0 = b.body * size;
  const head = points[0] ?? [0, r0, 0];
  const hd = unit(sub(head, points[1] ?? [0, r0, -1]));
  const h: Head = {
    c: madd(head, hd, b.head * size * 0.4),
    d: hd,
    ...headAxes(hd, 0),
    r: b.head * size,
    ...eyeOfSpecies(who),
  };
  // (A wedge, broad behind the jaws and flat, wider than the neck it sits on.)
  cap(kit, "head", "coat", at3(h, -0.35, 0, 0), at3(h, 0.8, 0, -0.08), h.r * 0.92, 0.62, h.u, { r1: h.r * 0.52, melt: 0.8 });
  // (Set into the flat of the head's side, not on the sphere an eye usually sits on.)
  for (const x of [-1, 1]) eyeAt(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.3, x * 0.7, 0.2), unit(add(scale(h.s, x), scale(h.u, 0.5))), h.r * 0.2, true);
  if (m.pose.mouth > 0.2 && m.segment.act === "flick") cap(kit, "tongue", "accent", at3(h, 1, 0, -0.1), madd(at3(h, 1, 0, -0.1), hd, h.r * 1.4 * m.pose.mouth), h.r * 0.08);
}

/** A gecko's foot: five thin toes spread from the wrist, each ending in a round sticky pad. */
function geckoFoot(kit: Kit, part: string, at: Vec, r0: number, x: number, fore: boolean): void {
  const flat: Vec = [at[0], r0 * 0.1, at[2]];
  const lean = fore ? 1 : -0.3;
  const [a, b] = [add(flat, [-r0 * 0.34, 0, r0 * 0.12 * lean]), add(flat, [r0 * 0.34, 0, r0 * 0.12 * lean])];
  const reach: Vec = [x * r0 * 0.3, 0, r0 * 0.62 * lean];
  cap(kit, `${part}.toes`, "coat", a, b, r0 * 0.085, 1, UP, { row: 5, reach, melt: 0.2, shadow: false });
  cap(kit, `${part}.pads`, "coat", add(a, reach), add(b, reach), r0 * 0.15, 0.6, UP, { row: 5, melt: 0.1, shadow: false, detail: 1 });
}

function lizardLegs(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const size = who.member.size;
  const r0 = who.spec.build.body * size;
  for (const [k, at] of [["F", 2], ["H", 5]] as const) {
    const body = points[at] ?? [0, r0, 0];
    for (const x of [-1, 1]) {
      const leg = `${k}${x < 0 ? "L" : "R"}`;
      const step = footCycle(m.phase - (leg === "FL" || leg === "HR" ? 0 : 0.5), 0.55, 0.55 * bodyStride(who) * m.moving, size * 0.06);
      const foot: Vec = [body[0] + x * size * 0.2, step.y, body[2] + step.z + (k === "F" ? size * 0.05 : -size * 0.03)];
      const wide: Vec = [foot[0] + x * size * 0.1, foot[1], foot[2]];
      limb(kit, `leg.${leg}`, "coat", add(body, [x * r0 * 0.8, r0 * 0.1, 0]), wide, [size * 0.13, size * 0.13], r0 * 0.27, [x, 1, 0], "coat");
      geckoFoot(kit, `leg.${leg}`, wide, r0, x, k === "F");
    }
  }
}
