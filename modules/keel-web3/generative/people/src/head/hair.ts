// Hair: a head's locks grown from their roots over the skull, the cap and sheets under them, and what ties them.

import { FAR, FRONT, SIDE, TAU, UP, add, clamp, cross, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { streamOf } from "../roll.js";
import type { HairStyle, Person } from "../body/person.js";
import { restSkeleton } from "../motion/skeleton.js";
import { HATTED, headFrame } from "./head.js";
import type { HeadFrame } from "./head.js";
import { HEAD } from "../body/bones.js";
import type { Net, Wearer } from "../body/field.js";
import { FABRICS } from "../clothes/fabric.js";
import { COMBS, FAR_HAIR, LOOSE, MID_HAIR, SKULL, SKULL_AT } from "./hair.data.js";
import type { Comb } from "./hair.data.js";
import {
  combed, gathered, headVertex, layLock, offHead, onSkull, ringQuads, roped, scalped, sheetQuads, tieOf,
} from "./lock.js";
import type { Lay } from "./lock.js";

/** What a loose style's locks do past the ear, from the root `u` they grew at. */
type Past = (line: readonly Vec[], u: Vec) => readonly Vec[];

/** A head of hair as it grows: where it is laid, its comb, its own random stream, and how near the mesh looks. */
interface Growth extends Lay {
  readonly c: Comb;
  readonly rand: () => number;
  /** Further than the mid distance: fewer, broader locks. */
  readonly far: boolean;
  /** How high hair may go, in metres: a hat's hem. */
  readonly roof: number;
  readonly parted: number;
  readonly roots: readonly Vec[];
  readonly past: Past;
}

/** The roots of a head of hair, evenly over it, as far as its hairline and its style let them go. */
function rootsOf(c: Comb, far: boolean): readonly Vec[] {
  const thin = far ? 0.2 : 0.46;
  const all = Math.ceil(c.count * (roped(c) ? 1 : thin) * 2.6);
  const every = Array.from({ length: all }, (_, i): Vec => {
    const y = 1 - (2 * (i + 0.5)) / all;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + 0.7;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  return every.filter((u) => scalped(u) && (c.keep?.(u) ?? true));
}

/**
 * What hair grows from is its roots' dark, so nothing between the locks reads as a bald patch: the skin behind the
 * hairline, painted `paint`, the role of hair or of stubble.
 */
function paintScalp(net: Net, paint: number, h: HeadFrame, size: number): void {
  net.role.forEach((_, v) => {
    if ((net.bones[v * 2] !== HEAD && net.bones[v * 2 + 1] !== HEAD) || net.fabric[v] !== FABRICS.skin) return;
    const local = (c: number): number => ((net.position[v * 3 + c] ?? 0) / size - (h.c[c] ?? 0)) / h.r;
    const at = [0, 1, 2].map(local) as unknown as Vec;
    const e = sub(at, SKULL_AT);
    const u = unit([e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]], UP);
    // (Not an ear, which stands out past the skull; and short of the hairline, which the cap draws.)
    const ear = Math.hypot(e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]) > 1.08;
    if (scalped(unit([u[0], u[1] - 0.09, u[2]], UP)) && e[1] > -0.9 && !ear) net.role[v] = paint;
  });
}

export const styleOf = (p: Person): HairStyle => (p.outfit.hat === "none" ? p.hair : (HATTED[p.hair] ?? p.hair));

/** A lock's shade along it: deep at the root, and a band of sheen where hair rounds the crown. */
const lockTone = (s: number, tone: number): number => tone * mix(0.72, 1, clamp(s * 5, 0, 1));

const ELASTIC = { role: "trim", fabric: FABRICS.satin };

/** A loop round a line, where it is tied. */
const looped = (at: Vec, along: Vec, r: number): readonly Vec[] => {
  const a = unit(cross(along, SIDE), FRONT);
  const b = cross(along, a);
  return Array.from({ length: 11 }, (_, i) => {
    const t = (i / 10) * TAU;
    return add(madd(at, a, Math.cos(t) * r), scale(b, Math.sin(t) * r));
  });
};

/**
 * What holds a style up or just dresses it: every tie has its elastic, and now and then a head has a band or a clip.
 */
function decorOf(g: Growth): readonly number[] {
  const lay = (line: readonly Vec[], size: readonly [number, number, number]): number[] =>
    Array.from({ length: layLock(g, line, size, ELASTIC) }, () => 1);
  const bands = (g.c.ties ?? []).flatMap((t) =>
    (t.plait === true ? [t.tail(0.98, 0), t.at] : [t.at]).map((at) => {
      const down =
        t.plait === true ? unit(sub(t.tail(0.99, 0), t.tail(0.9, 0)), UP) : unit(sub(t.tail(0.06, 0), t.at), UP);
      return lay(looped(at, down, t.plait === true ? 0.16 : t.spread * 0.3 + 0.13), [0.06, 0.06, 4]);
    }),
  );
  return bands.flat();
}

/**
 * Which ears are bare, left and right. Hair worn loose goes over them, or is tucked back behind one or both; every
 * other head shows them.
 */
export function tuckOf(p: Person): readonly [boolean, boolean] {
  if (!LOOSE.includes(styleOf(p))) return [true, true];
  const rand = streamOf(p.seed, 0x7475636b);
  const roll = rand();
  const side = rand() < 0.5;
  if (roll < 0.6) return [false, false];
  return roll < 0.8 ? [true, true] : [side, !side];
}

/** Hair that would come down over the face stops short of it; what falls beside the face stays beside it. */
function offFace(line: readonly Vec[]): readonly Vec[] {
  const on = (q: Vec): boolean => q[2] > 0.12 && q[1] < 0.62 && Math.abs(q[0]) < 0.8;
  const at = line.findIndex(on);
  return at < 0 ? line : line.slice(0, at);
}

/** Ropes of hair lie on the cap, not in it. */
const onCap = (c: Comb, q: Vec): Vec => (roped(c) ? add(SKULL_AT, scale(sub(q, SKULL_AT), 1.05)) : q);

/** Tucked means tucked: what starts ahead of the ear stops above it, and nothing hangs in front. */
function clearOfEar(line: readonly Vec[], tucked: boolean): readonly Vec[] {
  const at = tucked ? line.findIndex((q) => q[1] < 0.3 && q[2] > -0.3) : -1;
  return at < 0 ? line : line.slice(0, at);
}

/**
 * A lock past the ear on its way down: all of it behind the ear if that side is tucked, all of it clear over the ear if
 * not.
 */
function pastEar(q: Vec, tucked: boolean): Vec {
  const low = clamp((0.42 - q[1]) / 0.25, 0, 1);
  if (tucked) return offHead([q[0], q[1], q[2] > -0.36 ? mix(q[2], -0.36 - (q[2] + 0.36) * 0.2, low) : q[2]], true);
  const round =
    low * clamp((q[1] + 0.55) / 0.2, 0, 1) * clamp((0.2 - q[2]) / 0.15, 0, 1) * clamp((q[2] + 0.5) / 0.15, 0, 1);
  return [q[0] < 0 ? Math.min(q[0], mix(q[0], -1.08, round)) : Math.max(q[0], mix(q[0], 1.08, round)), q[1], q[2]];
}

/** What a style's locks do past the ears: a loose one is tucked behind or carried over each, and kept off the face. */
function pastEars(c: Comb, tucks: readonly [boolean, boolean], loose: boolean): Past {
  if (!loose) return (line) => line;
  return (line, u) => {
    const tucked = tucks[u[0] > 0 ? 1 : 0];
    return offFace(clearOfEar(line, tucked).map((q) => onCap(c, pastEar(q, tucked))));
  };
}

/** How low hair comes round the head, at a bearing from the brow. */
function edgeAt(a: number, c: Comb): number {
  const held = (y: number): boolean => {
    const u = unit([Math.sin(a), y, Math.cos(a)], UP);
    return scalped(u) && (c.keep?.(u) ?? true);
  };
  let y = 2.4;
  while (y > -2.4 && held(y - 0.04)) y -= 0.04;
  return y;
}

/** The way hair runs over the cap: to its tie, or back and down. */
function flowOf(c: Comb, u: Vec): Vec {
  const tie = tieOf(c, u);
  if (!tie) return unit([u[0] * 0.3, -0.5, -1], UP);
  return unit(sub(tie.at, add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]])), UP);
}

/**
 * What hair grows out of: a skin of it over the skull, ending along the hairline itself, a curve and not a mesh's
 * steps, a little ragged.
 */
function capOf(g: Growth): readonly number[] {
  const { net, roles, to, c, roof, far, rand } = g;
  const around = far ? 40 : 96;
  const rows = far ? 6 : 10;
  const base = net.position.length / 3;
  const role = Math.max(0, roles.indexOf("hair"));
  const tones: number[] = [];
  const rag = Array.from({ length: around }, () => (rand() - 0.5) * 0.05);
  const puff = roped(c) ? 1.08 : 1.03;
  for (let k = 0; k <= rows; k += 1) {
    for (let i = 0; i < around; i += 1) {
      const a = (i / around) * TAU;
      const s = k / rows;
      const low = edgeAt(a, c) + (rag[i] ?? 0) * s;
      const y = mix(2.4, low, s);
      const u = unit([Math.sin(a), y, Math.cos(a)], UP);
      const q = to(add(SKULL_AT, [u[0] * SKULL[0] * puff, u[1] * SKULL[1] * puff, u[2] * SKULL[2] * puff]));
      const at: Vec = [q[0], Math.min(q[1], roof), q[2]];
      headVertex(net, { at, normal: u, role, fabric: FABRICS.hair, loose: 0, cloth: [...flowOf(c, u), a * 2.2] });
      tones.push(mix(0.94, 0.84, s));
    }
  }
  ringQuads(net.index, base, rows, around);
  return tones;
}

/** The hair down over an ear: one sheet from the temple to where the hair ends, round the ear and not through it. */
function sideOf(g: Growth, x: number): readonly number[] {
  const { net, roles, to, c, far, rand } = g;
  const across = far ? 8 : 20;
  const rows = far ? 8 : 16;
  const base = net.position.length / 3;
  const role = Math.max(0, roles.indexOf("hair"));
  const tones: number[] = [];
  const bottom = Math.max(-1.5, c.cut ?? -FAR, 0.7 - c.length * 0.75);
  const scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.09);
  for (let k = 0; k <= rows; k += 1) {
    for (let i = 0; i <= across; i += 1) {
      const s = k / rows;
      const z = mix(mix(0.14, -0.1, s) + 0.035 * Math.sin(s * 9 + x), -0.72, i / across);
      const y = mix(0.62, bottom + (scallops[i] ?? 0) + (1 - i / across) ** 3 * 0.7, s);
      const inside = 1 - ((y - SKULL_AT[1]) / SKULL[1]) ** 2 - ((z - SKULL_AT[2]) / SKULL[2]) ** 2;
      const round = Math.sqrt(Math.max(0, inside)) * SKULL[0] * 1.045;
      const ear =
        clamp((y + 0.5) / 0.2, 0, 1) *
        clamp((0.62 - y) / 0.2, 0, 1) *
        clamp((0.24 - z) / 0.14, 0, 1) *
        clamp((z + 0.5) / 0.12, 0, 1);
      const wide = Math.max(round, 0.74, mix(0, 1.02, ear));
      headVertex(net, {
        at: to([x * wide, y, z]),
        normal: unit([x, 0.1, z * 0.6], UP),
        role,
        fabric: FABRICS.hair,
        loose: clamp(s * 1.4 - 0.4, 0, 1) * 0.5,
        cloth: [0, -1, -0.1, z * 1.6],
      });
      tones.push(0.86);
    }
  }
  sheetQuads(net.index, base, rows, across);
  return tones;
}

/** Where a fringe's sheet lies at `x` across and `y` up the brow: out from the skull there, and a point just off it. */
function onBrow(x: number, y: number): readonly [Vec, Vec] {
  const ex = x / SKULL[0];
  const ey = (y - SKULL_AT[1]) / SKULL[1];
  const z = Math.sqrt(Math.max(0.02, 1 - ex * ex - ey * ey));
  const out = unit([ex, ey, z], UP);
  return [out, add(SKULL_AT, [out[0] * SKULL[0] * 1.045, out[1] * SKULL[1] * 1.045, out[2] * SKULL[2] * 1.045])];
}

/**
 * A fringe: one sheet of hair from under the cap down over the brow, cut in an even line that rises to the temples, a
 * little scalloped.
 */
function fringeOf(g: Growth): readonly number[] {
  const { net, roles, to, c, far, rand } = g;
  if (c.fringe === undefined) return [];
  const across = far ? 16 : 40;
  const rows = 6;
  const base = net.position.length / 3;
  const role = Math.max(0, roles.indexOf("hair"));
  const tones: number[] = [];
  const wide = 0.76;
  const scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.035);
  const beat = rand() * TAU;
  for (let k = 0; k <= rows; k += 1) {
    for (let i = 0; i <= across; i += 1) {
      const x = ((i / across) * 2 - 1) * wide;
      const s = k / rows;
      const scallop = scallops[i] ?? 0;
      const edge = (c.fringe ?? 0) + 0.3 * (x / wide) ** 4 + 0.03 * Math.sin(x * 16 + beat) + scallop * 1.8;
      const y = mix(1.04, edge, s);
      const [out, q] = onBrow(x, y);
      const flow = x * 0.12 + 0.3 * Math.sin(x * 23 + beat) + scallop * 26;
      headVertex(net, {
        at: to(q),
        normal: out,
        role,
        fabric: FABRICS.hair,
        loose: 0,
        cloth: [flow, -1, 0.15 + 0.3 * Math.sin(x * 31 + beat * 2), x * 1.6],
      });
      tones.push(mix(0.8, 0.66, s) * (0.92 + ((0.5 * scallop) / 0.035) * 0.3));
    }
  }
  sheetQuads(net.index, base, rows, across);
  return tones;
}

/** Short fine hairs along the hairline, lying back on the skull: where a head of hair really starts is never a line. */
function featherOf(g: Growth): readonly number[] {
  const { net, c, far, rand } = g;
  const tones: number[] = [];
  for (let i = 0; i < (far || c.shell === true ? 0 : 150); i += 1) {
    const a = (i / 150) * TAU + rand() * 0.04;
    const ground: Vec = [Math.sin(a), 0, Math.cos(a)];
    const y = edgeAt(a, c);
    const u = unit([ground[0], y - rand() * 0.08, ground[2]], UP);
    const root = add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]]);
    const back = unit([-ground[0] * 0.25, 0.75, -ground[2] * 0.7 + (rand() - 0.5) * 0.3], UP);
    const long = mix(0.1, 0.24, rand());
    const line = [0, 0.33, 0.66, 1].map((s) => {
      const q = onSkull(madd(root, back, s * long));
      return add(SKULL_AT, scale(sub(q, SKULL_AT), 1.012));
    });
    const from = net.loose.length;
    const verts = layLock(g, line, [c.width * 0.42, c.thick * 0.6, 3]);
    const tone = 0.76 + rand() * 0.24;
    net.loose.fill(0, from); // (Too short to blow about.)
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone((v / verts) * 0.3, tone)));
  }
  return tones;
}

/** Each plait's three strands, round as rope, over and under one another. */
function plaitsOf(g: Growth): readonly number[] {
  const ties = (g.c.ties ?? []).filter((t) => t.plait === true);
  return ties.flatMap((tie) =>
    [0, 1, 2].flatMap((strand) => {
      const line = Array.from({ length: 44 }, (_, i) => tie.tail(i / 43, strand));
      const verts = layLock(g, line, [0.125, 0.125, 6]);
      return Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.86 + strand * 0.06));
    }),
  );
}

/** The broad locks under a fall of hair, sunk a little in from the fine ones. */
function curtainOf(g: Growth): readonly number[] {
  const { c, roots, past, rand, parted } = g;
  const tones: number[] = [];
  for (const u of roots.filter((_, i) => c.curtain === true && i % 3 === 0)) {
    const line = past(combed(c, u, rand, parted), u)
      .slice(0, -2)
      .map((q) => add(SKULL_AT, scale(sub(q, SKULL_AT), 0.95)));
    if (line.length < 3) continue;
    const verts = layLock(g, line, [c.width * 2.8, c.thick, 3]);
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.82)));
  }
  return tones;
}

/** How broad a fine lock is, of its comb's width: a rope its own, a tied lock a little more, a loose one a clump. */
function lockWidth(c: Comb, tied: boolean, far: boolean): number {
  if (roped(c)) return 1;
  if (tied) return 1.3;
  return far ? 3.4 : 2.3;
}

/** The fine locks of a head, each its own width and shade. */
function fineLocks(g: Growth): readonly number[] {
  const { c, to, roots, past, rand, roof, far, parted } = g;
  const tones: number[] = [];
  // (Ropes start back from the brow: hanging from its very edge, they would only be teeth.)
  for (const u of roots.filter((r) => !(roped(c) && c.stand < 1 && r[2] > 0.16))) {
    const tie = tieOf(c, u);
    const grown = tie ? gathered(tie, u, rand) : combed(c, u, rand, parted);
    const line = past(grown, u).filter((q) => to(q)[1] < roof);
    if (line.length < 3) continue;
    const width = c.width * lockWidth(c, tie !== undefined, far) * (0.85 + rand() * 0.3);
    const verts = layLock(g, line, [width, c.thick * (roped(c) ? 1 : 1.5), far ? 3 : 5]);
    const tone = 0.9 + rand() * 0.1;
    for (let v = 0; v < verts; v += 1) tones.push(lockTone(v / verts, tone));
  }
  return tones;
}

/**
 * A head of hair as locks, on their head's bone, up to `roof`. Each vertex's shade comes back, in order: deep at the
 * root, lock from lock a little apart.
 */
export function hairLocks(w: Wearer, roof: number): readonly number[] {
  const { net, p, roles, cell } = w;
  const comb = COMBS[styleOf(p)];
  if (!comb || p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const rand = streamOf(p.seed, 0x68616972);
  const h = headFrame(restSkeleton(p), p.build.head, p.face);
  const size = p.build.size;
  const to = (q: Vec): Vec => scale(h.at(q[0], q[1], q[2]), size);
  const far = cell >= MID_HAIR;
  const c = { ...comb, length: comb.length * mix(0.88, 1.14, rand()) };
  const parted = (c.part ?? 0) * (rand() < 0.5 ? -1 : 1);
  const shaved = c.shave === true || c.length < 1;
  paintScalp(net, Math.max(0, roles.indexOf(shaved ? "brow" : "hair")), h, size);
  const roots = rootsOf(c, far);
  const tucks = tuckOf(p);
  const loose = LOOSE.includes(styleOf(p));
  const g: Growth = { net, roles, to, c, rand, far, roof, parted, roots, past: pastEars(c, tucks, loose) };
  const sides = [-1, 1].flatMap((x, side) => (loose && !roped(c) && !tucks[side] ? sideOf(g, x) : []));
  return [
    ...sides,
    ...capOf(g),
    ...fringeOf(g),
    ...curtainOf(g),
    ...fineLocks(g),
    ...featherOf(g),
    ...plaitsOf(g),
    ...decorOf(g),
  ];
}

/** A net without the vertices no face uses. */
export function compacted(net: Net): Net {
  const next = new Map<number, number>();
  for (const v of net.index) if (!next.has(v)) next.set(v, next.size);
  const keep = (list: readonly number[], width: number): number[] =>
    [...next.keys()].flatMap((v) => list.slice(v * width, v * width + width));
  return {
    position: keep(net.position, 3),
    normal: keep(net.normal, 3),
    role: keep(net.role, 1),
    bones: keep(net.bones, 2),
    weight: keep(net.weight, 1),
    fabric: keep(net.fabric, 1),
    loose: keep(net.loose, 1),
    cloth: keep(net.cloth, 4),
    soft: keep(net.soft, 1),
    index: net.index.map((v) => next.get(v) ?? 0),
  };
}
