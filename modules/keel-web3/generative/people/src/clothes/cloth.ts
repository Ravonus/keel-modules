// Cloth: fabrics, hems and skirts over the cage, the layers a body is dressed in, and their creases.

import { FAR, UP, clamp, lerpV, madd, mix, scale } from "../vec.js";
import type { Vec } from "../vec.js";
import { hashed } from "../roll.js";
import type { Bottom, Person, Top } from "../body/person.js";
import { LONG_TOP } from "./outfit.js";
import { restSkeleton } from "../motion/skeleton.js";
import type { Skeleton } from "../motion/skeleton.js";
import { neckBy } from "../mesh/parts.js";
import type { Capsule } from "../mesh/parts.js";
import { headFrame } from "../head/head.js";
import type { HeadFrame } from "../head/head.js";
import { HEAD, boneOfPart } from "../body/bones.js";
import { dentsOf, loftOf } from "../body/field.js";
import type { Layer, Net } from "../body/field.js";
import type { Wrap } from "../head/wrap.js";
import { ARM, FOOT, LEG, TORSO, cageOf, layOf, normalsOf, pointOf, shellOf, subdivided } from "../body/cage.js";
import type { Cage, Cut, Shell } from "../body/cage.js";
import { FABRICS, hatCloth, lowerCloth, topCloth } from "./fabric.js";
import { LEAST_CELL } from "../mesh/lod.js";
import { styleOf } from "../head/hair.js";
import { COMBS, FAR_HAIR } from "../head/hair.data.js";
import { BILLS, fitsHat } from "./crown.js";
import { hemOf, skirtShell, waistLoop } from "./skirt.js";
import { umbrellaShell } from "./umbrella.js";

/** How far down each top comes, a ring of the torso; a long top goes on past it. */
const TOP_HEM: Readonly<Record<Top, number>> = {
  tank: 2, tee: 1, polo: 1, long: 1, hoodie: 1, jacket: 0, blazer: 0, coat: 3, robe: 3, dress: 3, raincoat: 3,
  puffer: 1, swimsuit: 1, bikini: 6, string: 4, bare: 99,
};
/** Where a top stops at the chest, if not at the neck. */
const TOP_END: Partial<Record<Top, number>> = { bikini: 8, string: 10 };


const inRange = (tag: number, from: number, to: number): boolean => tag >= from && tag <= to;

/** How many of the arm's rings each sleeve runs down: nine is to the wrist. */
export const SLEEVE_RINGS: Readonly<Record<Top, number>> = {
  tank: 0, swimsuit: 0, bikini: 0, string: 0, bare: 0, dress: 1, tee: 2, polo: 2, robe: 7, long: 9, hoodie: 9,
  jacket: 9, blazer: 9, coat: 9, raincoat: 9, puffer: 9,
};
const SKINTIGHT: readonly Top[] = ["swimsuit", "bikini", "string"];

/** The ring a top stops at: over a skirt, at the skirt's waist, or the two come through each other all round it. */
const hemRing = ({ top, bottom }: Person["outfit"]): number => (bottom === "skirt" && LONG_TOP[top] === undefined ? Math.max(TOP_HEM[top], 3) : TOP_HEM[top]);

/** What of a body each garment covers, by the ring it is on; `bare` where a dress or robe leaves nothing under it. */
interface Cover {
  readonly top: (t: number) => boolean;
  readonly lower: (t: number) => boolean;
  readonly feet: (t: number) => boolean;
  readonly bare: boolean;
}

/** How many of the leg's rings a bottom comes down: `trunks` of them for swimwear. */
function legRings(bottom: Bottom, trunks: number): number {
  if (bottom === "briefs") return 1;
  if (bottom === "swim") return trunks;
  return bottom === "shorts" ? 3 : 8;
}

function coverOf(p: Person): Cover {
  const { top, bottom, shoe } = p.outfit;
  const bare = bottom === "skirt" ? false : top === "dress" || top === "robe";
  const skirted = bottom === "skirt" || bare;
  const sleeve = SLEEVE_RINGS[top];
  const trunks = p.build.sex === "male" || p.build.age !== "adult" ? 3 : 0;
  const legsTo = legRings(bottom, trunks);
  return {
    bare,
    top: (t) =>
      inRange(t, TORSO + hemRing(p.outfit), TORSO + (TOP_END[top] ?? 10)) || inRange(t, ARM, ARM + sleeve - 1),
    lower: (t) => inRange(t, TORSO + (skirted ? 3 : 0), TORSO + 3) || (!skirted && inRange(t, LEG, LEG + legsTo)),
    feet: (t) => inRange(t, FOOT, FOOT + 9) || (shoe === "boot" && inRange(t, LEG + 6, LEG + 9)),
  };
}

/** A jacket's open front, a narrowing V of shirt, and a formal one's tie down the middle of it; a coat's belt. */
function frontOf(p: Person, under: (at: Vec) => string, cell: number): (at: Vec) => string {
  const { top, costume } = p.outfit;
  if (top === "coat" || top === "raincoat") return bandsAt([restSkeleton(p).pelvis[1] + 0.12], 0.02, "dark", under);
  if ((top !== "jacket" && top !== "blazer") || costume === "firefighter" || cell < WRAPPED) return under;
  const s = restSkeleton(p);
  const from = s.neck[1] - 0.02;
  const to = s.waist[1] + 0.04;
  return (at) => {
    const k = (at[1] - to) / (from - to);
    if (at[2] < s.chest[2] || k < 0 || k > 1 || Math.abs(at[0]) > 0.012 + k * 0.08) return under(at);
    return top === "blazer" && Math.abs(at[0]) < 0.014 ? "dark" : "trim";
  };
}

/** How far a top stands off the body: a puffer well out, a swimsuit on the skin, the rest by how loose it is cut. */
export function topLift(top: Top, fit: number): number {
  if (top === "puffer") return 0.03;
  if (SKINTIGHT.includes(top)) return 0.002;
  return 0.01 + fit * 0.012;
}
const lowerLift = (bottom: Bottom, fit: number): number => (bottom === "leggings" ? 0.002 : 0.005 + fit * 0.008);

/** A fursuit is the whole body, shagged, paler down the front. */
const PELT: Shell = { on: () => true, lift: 0.006, shag: 0.022, role: (at) => (at[2] > 0.02 && Math.abs(at[0]) < 0.1 && at[1] > 0.86 && at[1] < 1.42 ? "belly" : "skin"), fabric: FABRICS.fur };

/**
 * A grown woman's bust: where each side sits, and how it falls off, longer above than below and to the side, as weight
 * settles it low.
 */
interface Form {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly deep: number;
  readonly wide: number;
  readonly above: number;
  readonly below: number;
}

function formOf(p: Person): Form | undefined {
  const { sex, age, bust, shoulder } = p.build;
  if (sex !== "female" || (age !== "adult" && age !== "elder")) return undefined;
  const s = restSkeleton(p);
  const full = Math.sqrt(bust);
  const sag = age === "elder" ? 0.03 : 0.012;
  // (Every woman her own: most near the middle, a few well to either side. Hashed, so it moves nothing else about her.)
  const bell = (salt: number): number => hashed(p.seed, salt) + hashed(p.seed, salt + 1) - 1;
  const high = bell(701);
  const apart = bell(703);
  const narrow = bell(705);
  return {
    x: shoulder * 0.5 * (1 + 0.18 * apart),
    y: s.chest[1] + 0.012 - sag * bust + 0.04 * high,
    z: s.chest[2],
    deep: 0.05 * bust,
    wide: 0.06 * full * (1 + 0.16 * narrow),
    above: 0.09 * full * (1 - 0.3 * high),
    below: 0.05 * full * (1 + 0.3 * high),
  };
}

/** How far one side stands out at a point of the chest. */
const sideAt = (f: Form, x: number, y: number): number => {
  const up = (y - f.y) / (y > f.y ? f.above : f.below);
  const out = (x - f.x) / f.wide;
  return f.deep * Math.exp(-(up * up + out * out));
};
const formAt = (f: Form, at: Vec): number => (at[2] < f.z ? 0 : sideAt(f, Math.abs(at[0]), at[1]));

/**
 * The body with the form on it: on the finished surface, where there are vertices enough for two sides and the hollow
 * between.
 */
function shaped(body: Cage, form: Form | undefined): Cage {
  if (!form) return body;
  const torso = new Set(
    body.quads.flatMap((q, f) => (inRange(body.tags[f] ?? 0, TORSO + 4, TORSO + 10) ? [...q] : [])),
  );
  return {
    ...body,
    rows: body.rows.map((row, i) =>
      torso.has(i) ? row.map((v, c) => (c === 2 ? v + formAt(form, pointOf(row)) : v)) : row,
    ),
  };
}

/**
 * Where a grown body is soft: its bust, a belly in proportion to its fat, its seat. Nothing on a child or a teenager
 * moves this way.
 */
function softOf(p: Person, form: Form | undefined): (at: Vec) => number {
  const { age, girth, rear, belly } = p.build;
  if (age !== "adult" && age !== "elder") return () => 0;
  const s = restSkeleton(p);
  const fat = Math.max(0, girth - 1) + belly;
  const low = s.waist[1] - 0.05;
  const seat = s.left.leg.hip[1] + 0.05;
  const bell = (x: number, y: number): number => Math.exp(-(x * x + y * y));
  return (at) => {
    const front = at[2] > s.pelvis[2];
    const x = Math.abs(at[0]);
    const up = form ? clamp(formAt(form, at) / Math.max(0.001, form.deep * 0.8), 0, 1) : 0;
    const gut = front ? Math.min(0.9, fat * 2.4) * bell(x / 0.17, (at[1] - low) / 0.15) : 0;
    const back = front ? 0 : Math.min(0.8, 0.22 * rear + fat * 1.4) * bell((x - 0.08) / 0.11, (at[1] - seat) / 0.11);
    return Math.min(1, up + gut + back);
  };
}

/** How far ordinary cloth stands off the hollow between the two sides: it lies across, where a swimsuit goes in. */
const bridged = (form: Form | undefined) => (at: Vec): number => {
  const x = Math.abs(at[0]);
  return !form || at[2] < form.z || x > form.x ? 0 : Math.max(0, sideAt(form, form.x, at[1]) - sideAt(form, x, at[1]));
};


/** A body being dressed: whose, its finished surface, what is soft on it, and what of it each garment covers. */
interface Dress {
  readonly net: Net;
  readonly p: Person;
  readonly roles: readonly string[];
  readonly cell: number;
  readonly body: Cage;
  readonly normals: readonly Vec[];
  readonly form: Form | undefined;
  readonly s: Skeleton;
  readonly cover: Cover;
  readonly cut: ReturnType<typeof cutOf>;
  readonly clear: (at: Vec, tag: number) => boolean;
  readonly soft: (at: Vec) => number;
}

/**
 * Everything of the body that is seen or worn: skin where nothing covers it, and each garment cut from the same
 * surface.
 */
export function dressedBody(net: Net, p: Person, roles: readonly string[], cell: number): void {
  const size = p.build.size;
  const first = cell >= LEAST_CELL ? cageOf(p) : subdivided(cageOf(p));
  const form = formOf(p);
  const body = shaped(cell < 0.03 ? subdivided(first) : first, form);
  const normals = normalsOf(body);
  const { top, bottom, fit } = p.outfit;
  const cover = coverOf(p);
  const s = restSkeleton(p);
  const soft = softOf(p, form);
  const long = LONG_TOP[top] !== undefined;
  if (p.outfit.costume === "fursuit") {
    shellOf(net, { body, normals }, PELT, { roles, size });
    return;
  }
  // (What is in a tube is never seen: it is simply not built above the hem, so a belly or a pair of trousers cannot
  // come through it.)
  const clear = clearOf(p);
  const cut = cutOf(p);
  const d: Dress = { net, p, roles, cell, body, normals, form, s, cover, cut, clear, soft };
  skinShell(d);
  garmentShells(d);
  const lift = long ? topLift(top, fit) : lowerLift(bottom, fit);
  skirtShell(net, p, roles, { long, loop: waistLoop(body, normals, lift), body });
  if (p.outfit.carry === "umbrella") umbrellaShell(net, p, roles);
}

/** What a garment lies over at a ring of the body, if one does: skin under it takes that garment's colour. */
function garmentOver(cover: Cover, cut: ReturnType<typeof cutOf>, t: number): string | undefined {
  if (!cut.top && cover.top(t)) return "top";
  if (!cover.bare && !cut.lower && cover.lower(t)) return "bottom";
  return undefined;
}

/** The skin: everything no garment wholly covers, and what stays under one sunk in, in that garment's colour. */
function skinShell(d: Dress): void {
  const { net, p, roles, body, normals, cover, cut, clear, soft } = d;
  const sandal = p.outfit.shoe === "sandal";
  const worn = wornOver(cover, cut, sandal);
  // (Round the shoulders the cloth stretches off the skin as an arm moves, so the skin stays, sunk, and no gap there
  // opens on nothing.)
  const hidden = (t: number): boolean =>
    !inRange(t, TORSO + 7, TORSO + 11) &&
    !inRange(t, ARM, ARM + 2) &&
    worn.some((on) => on(t) && on(t - 1) && on(t + 1));
  // (Skin that stays under a garment goes in under it, so the two can never meet, however either is bent.)
  const seen = new Set(body.quads.flatMap((q, f) => (worn.some((on) => on(body.tags[f] ?? 0)) ? [] : [...q])));
  // (And it takes the colour of what is over it, so if a bent joint ever brings it through, it does not read as a
  // hole.)
  const under = new Map<number, string | undefined>(
    body.quads.flatMap((q, f) =>
      q.map((v): [number, string | undefined] => [v, garmentOver(cover, cut, body.tags[f] ?? 0)]),
    ),
  );
  const skin: Shell = {
    on: (t) => !hidden(t),
    keep: clear,
    lift: 0,
    role: (_, v) => (v === undefined || seen.has(v) ? "skin" : (under.get(v) ?? "skin")),
    fabric: 0,
    soft,
    sink: (v) => (seen.has(v) ? 0 : 0.016),
  };
  shellOf(net, { body, normals }, skin, { roles, size: p.build.size });
}

/** What is worn over the skin: the bottom, the top, and the shoes or the feet. */
function garmentShells(d: Dress): void {
  const { net, p, roles, cell, body, normals, form, s, cover, cut, clear, soft } = d;
  const size = p.build.size;
  const { top, bottom, shoe, fit } = p.outfit;
  const sandal = shoe === "sandal";
  const lay = layOf(p);
  const long = LONG_TOP[top] !== undefined;
  const joined = cover.bare || long ? s.pelvis[1] : -FAR;
  const groundY = s.left.leg.ankle[1] - 0.07;
  if (!cover.bare) {
    const lower: Shell = {
      on: cover.lower, keep: clear, cut: cut.lower, lift: lowerLift(bottom, fit), role: beltedBottom(p, s),
      fabric: lowerCloth(p), lay, soft,
    };
    shellOf(net, { body, normals }, lower, { roles, size });
  }
  const upper: Shell = {
    on: cover.top, cut: cut.top, ...(SKINTIGHT.includes(top) ? {} : { span: bridged(form) }), lift: topLift(top, fit),
    role: frontOf(p, stripedTop(p, s), cell), fabric: topCloth(p), lay, soft, edge: (at) => at[1] > joined,
  };
  shellOf(net, { body, normals }, upper, { roles, size });
  const footRole = sandal ? "skin" : "shoe";
  const feet: Shell = {
    on: cover.feet, lift: 0.006, role: (at) => (at[1] < groundY ? "sole" : footRole),
    fabric: sandal ? FABRICS.skin : FABRICS.leather,
  };
  shellOf(net, { body, normals }, feet, { roles, size });
}

/** Which quads of a body are worth building, given what hangs over them. */
function clearOf(p: Person): (at: Vec, tag: number) => boolean {
  if (LONG_TOP[p.outfit.top] === undefined && p.outfit.bottom !== "skirt") return () => true;
  const hem = hemOf(p);
  return (at, tag) => at[1] < hem + 0.18 || !(inRange(tag, TORSO, TORSO + 2) || inRange(tag, LEG, FOOT - 1));
}

/** The garments that wholly cover what they lie on: a cut one leaves skin between its pieces. */
function wornOver(
  cover: ReturnType<typeof coverOf>,
  cut: ReturnType<typeof cutOf>,
  sandal: boolean,
): readonly ((t: number) => boolean)[] {
  const worn: ((t: number) => boolean)[] = [];
  if (!cut.top) worn.push(cover.top);
  if (!cover.bare && !cut.lower) worn.push(cover.lower);
  if (!sandal) worn.push(cover.feet);
  return worn;
}

function beltedBottom(p: Person, s: Skeleton): (at: Vec) => string {
  const { bottom } = p.outfit;
  const belted = bottom === "jeans" || bottom === "trousers" || bottom === "cargo";
  return bandsAt(belted ? [lerpV(s.pelvis, s.waist, 0.72)[1]] : [], 0.016, "dark", () => "bottom");
}

/** Bands round the body at these heights, cut in the surface itself, so they lie true on any figure. */
const bandsAt =
  (ys: readonly number[], half: number, role: string, under: (at: Vec) => string) =>
  (at: Vec): string =>
    ys.some((y) => Math.abs(at[1] - y) < half) ? role : under(at);

function stripedTop(p: Person, s: Skeleton): (at: Vec) => string {
  const { top, stripes, costume } = p.outfit;
  const at = madd(s.chest, UP, 0.05);
  const plain = (v: Vec): string => (costume === "police" && v[2] > at[2] && Math.hypot(v[0] + p.build.shoulder * 0.5, v[1] - at[1]) < 0.028 ? "badge" : "top");
  if (stripes === 0 || (LONG_TOP[top] !== undefined && costume !== "firefighter")) return plain;
  return bandsAt(Array.from({ length: stripes }, (_, i) => mix(s.waist[1], s.chest[1], (i + 0.5) / stripes)), 0.022, "trim", plain);
}

/**
 * A cut across the rings: how far inside what is left of a garment a point is, in metres, under nought outside it. The
 * renderer draws the line itself, sharper than any quad.
 */
function cutOf(p: Person): { readonly top?: Cut; readonly lower?: Cut } {
  const s = restSkeleton(p);
  const { shoulder, bust } = p.build;
  const form = formOf(p);
  const cups = {
    x: form?.x ?? shoulder * 0.42,
    y: form?.y ?? s.chest[1],
    h: 0.055 * Math.sqrt(bust),
    wide: 0.058 * Math.sqrt(bust),
  };
  const neck = shoulder * 0.26;
  const string: Cut = (at) => {
    const x = Math.abs(at[0]);
    const k = clamp((cups.y + cups.h - at[1]) / (2 * cups.h), 0, 1);
    const low = cups.y - cups.h;
    const tie = 0.011 - Math.abs(at[1] - low);
    if (at[2] < s.chest[2]) return tie;
    const strap = 0.014 - Math.abs(x - mix(cups.x, neck, clamp((at[1] - cups.y - cups.h) / 0.13, 0, 1)));
    if (at[1] > cups.y + cups.h) return strap;
    return Math.max(tie, Math.min(at[1] - low, 0.008 + cups.wide * k - Math.abs(x - cups.x)));
  };
  const crotch = s.left.leg.hip[1] - 0.06;
  const rise = s.pelvis[1] + 0.05;
  const brief: Cut = (at) => {
    const k = clamp((at[1] - crotch) / (rise - crotch), 0, 1);
    return Math.min(
      rise - at[1],
      mix(0.035, p.build.hip * 1.25, k * k) * (at[2] < s.pelvis[2] ? 1.5 : 1) - Math.abs(at[0]),
    );
  };
  return { ...(p.outfit.top === "string" ? { top: string } : {}), ...(p.outfit.bottom === "briefs" ? { lower: brief } : {}) };
}

/** How high hair may go: to a hat's hem. */
export const roofOf = (dressed: readonly Capsule[], size: number): number =>
  (dressed.find((c) => c.part === "hat")?.hem ?? FAR) - 0.006 * size;

/** What of a hairstyle's parts stays solid in a mesh: a beard, and an afro's mass. */
const meshHair = (massive: boolean, far: boolean) => (c: Capsule): boolean => far || (!/^(fringe|curl|bob|lock|fall|bun|tail|wave|plait|locs)/.test(c.part) && (massive || c.part !== "hair"));

/** Further off than this a head is what it melts to: a fixed mesh would have nothing to show there. */
export const WRAPPED = 0.05;

/**
 * The neck as the body builds it, a little inside it so it closes over the head's edge: where its middle lies from the
 * head's, and its half width and depth, in head radii.
 */
function neckFor(p: Person, h: HeadFrame): readonly [number, number, number] {
  const s = restSkeleton(p);
  const R = h.r * 0.5 * neckBy(p);
  const z = lerpV(s.neck, s.head, 0.72)[2] - h.r * 0.1 * p.face.bone.m;
  return [(z - h.c[2]) / h.r, (R * 0.86 * 0.94) / h.r, (R * 0.96 * 0.94) / h.r];
}

/** How finely a head's fixed mesh is cut, by how near it is. */
function levelOf(cell: number): number {
  if (cell < 0.018) return 2;
  return cell < 0.026 ? 1 : 0;
}

function wrapOf(p: Person, cell: number): Wrap {
  const f = p.face;
  const b = f.bone;
  const size = p.build.size;
  const h = headFrame(restSkeleton(p), p.build.head, f);
  const low = (y: number): number => (y < 0 ? y * b.L : y);
  return {
    c: scale(h.c, size),
    R: p.build.head * size,
    eyeX: f.apart,
    eye: f.eye,
    pupil: low(b.pupil),
    sn: low(b.sub),
    sto: low(b.sto),
    men: low(b.men),
    mouth: f.mouthWide,
    neck: neckFor(p, h),
    level: levelOf(cell),
  };
}

/** The fixed mesh a layer of a head goes on, and the dents that suit it, if it is near enough for one. */
function headLayerOf(p: Person, cell: number): Pick<Layer, "dents" | "wrap"> {
  return p.outfit.costume !== "fursuit" && cell < WRAPPED ? { dents: dentsOf(p, true), wrap: wrapOf(p, cell) } : { dents: dentsOf(p) };
}

/** The hair's layer: its solid parts, loose below the chin and under a hat's hem; an afro's mass tufted. */
function hairLayer(p: Person, dressed: readonly Capsule[], hair: readonly Capsule[], massive: boolean): Layer {
  const k = p.build.size;
  const chin = dressed.find((c) => c.part === "chin")?.a[1] ?? 1.4;
  const hairAt = dressed.find((c) => c.part === "skull")?.a ?? [0, 1.6, 0];
  const curled = { locks: { head: hairAt, kind: "tuft" as const, size: k } };
  return {
    parts: hair,
    fine: 0.55,
    fabric: FABRICS.hair,
    lift: 0.004 * k,
    roof: roofOf(dressed, k),
    free: [chin + 0.02 * k, 0.4 * k],
    ...(massive ? curled : {}),
  };
}

/** A hat's own parts: all of them far off, and near to only what the crown built over the head does not replace. */
function hatLayer(p: Person, dressed: readonly Capsule[], cell: number): Layer {
  const built = (c: Capsule): boolean =>
    (c.part === "hat" || c.part === "hat.ridge" || (c.part === "peak" && BILLS[p.outfit.hat] !== undefined)) &&
    fitsHat(p, cell);
  return {
    parts: dressed.filter((c) => /^(hat|peak)/.test(c.part) && !built(c)),
    fine: cell < WRAPPED ? 0.36 : 0.55,
    fabric: hatCloth(p.outfit.hat),
    lift: 0.008 * p.build.size,
  };
}

/**
 * The layers a person is built of, inside out, each its own shell: body, head and neck, what they have on, their hair.
 */
export function layersOf(
  p: Person,
  dressed: readonly Capsule[],
  bare: readonly Capsule[],
  cell: number,
): readonly Layer[] {
  const k = p.build.size;
  const on = (...roles: readonly string[]): readonly Capsule[] =>
    dressed.filter((c) => roles.includes(c.role) && !/^(hat|peak)/.test(c.part));
  const head = (c: Capsule): boolean => boneOfPart(c.part) === HEAD || c.part === "neck";
  const { fit } = p.outfit;
  const hairAt = dressed.find((c) => c.part === "skull")?.a ?? [0, 1.6, 0];
  const furred = p.outfit.costume === "fursuit";
  const pelt = furred ? { locks: { head: hairAt, kind: "curl" as const, size: k } } : {};
  const bareStuff = furred ? FABRICS.fur : FABRICS.skin;
  // (Near to, a style is its locks: what they grow from is only the shell under them, and a beard.)
  const massive = COMBS[styleOf(p)]?.shell === true;
  const hair = on("hair").filter(meshHair(massive, cell >= FAR_HAIR));
  const collar = (c: Capsule): boolean =>
    /^(hood|collar|brush)/.test(c.part) && !(c.part === "collar" && p.outfit.top === "polo" && cell < WRAPPED);
  // (The scalp stops where hair is thick over it, so it never shows through a parting; hair stops at a hat's hem, so it
  // never shows through the crown.)
  const layers: Layer[] = [
    {
      parts: bare.filter((c) => head(c) && c.part !== "neck"),
      fine: 0.5,
      fabric: bareStuff,
      lift: 0,
      under: hair,
      tuck: -0.008 * k,
      relax: 2,
      loft: loftOf(p),
      rigid: true,
      ...pelt,
      ...headLayerOf(p, cell),
    },
    { parts: bare.filter((c) => /^(palm|fingers|thumb)/.test(c.part)), fine: 0.35, fabric: bareStuff, lift: 0 },
    {
      parts: dressed.filter(collar),
      fine: 0.7,
      fabric: furred ? FABRICS.fur : topCloth(p),
      lift: (furred ? 0.01 : 0.012 + fit * 0.016) * k,
      ...pelt,
    },
    { parts: on("beard"), fine: 0.5, fabric: FABRICS.skin, lift: 0.002 * k, rigid: true, relax: 3 },
    hairLayer(p, dressed, hair, massive),
    hatLayer(p, dressed, cell),
  ];
  return layers.filter((l) => l.parts.length > 0);
}

/**
 * How open each vertex lies: a surface turning in on itself round a vertex shuts it off from the sky, and that spreads
 * a little either side of the fold.
 */
export function creases(net: Net): Float32Array {
  const n = net.position.length / 3;
  const shut = new Float32Array(n);
  const links = new Float32Array(n);
  const towards = (a: number, b: number): void => {
    const d = [0, 1, 2].map((c) => (net.position[b * 3 + c] ?? 0) - (net.position[a * 3 + c] ?? 0));
    const l = Math.hypot(...d) || 1;
    shut[a] = (shut[a] ?? 0) + d.reduce((sum, v, c) => sum + (v / l) * (net.normal[a * 3 + c] ?? 0), 0);
    links[a] = (links[a] ?? 0) + 1;
  };
  const eachEdge = (visit: (a: number, b: number) => void): void => {
    for (let i = 0; i < net.index.length; i += 3) {
      for (let j = 0; j < 3; j += 1) visit(net.index[i + j] ?? 0, net.index[i + ((j + 1) % 3)] ?? 0);
    }
  };
  eachEdge(towards);
  for (let v = 0; v < n; v += 1) shut[v] = (shut[v] ?? 0) / Math.max(1, links[v] ?? 1);
  for (let pass = 0; pass < 5; pass += 1) {
    const sum = new Float32Array(n);
    eachEdge((a, b) => {
      sum[a] = (sum[a] ?? 0) + (shut[b] ?? 0);
    });
    for (let v = 0; v < n; v += 1) shut[v] = mix(shut[v] ?? 0, (sum[v] ?? 0) / Math.max(1, links[v] ?? 1), 0.7);
  }
  return shut.map((c) => 1 - 0.5 * clamp((c - 0.01) / 0.1, 0, 1));
}

/**
 * A shirt hangs over what is under it, and the shadow it throws there is what parts the two, whatever their colours.
 */
export function hemShadow(net: Net, shade: Float32Array, roles: readonly string[], size: number): Float32Array {
  const top = roles.indexOf("top");
  const lower = [roles.indexOf("bottom"), roles.indexOf("dark")];
  const hem = net.role.reduce(
    (low, role, v) => (role === top ? Math.min(low, net.position[v * 3 + 1] ?? FAR) : low),
    FAR,
  );
  return shade.map((c, v) => {
    const under = (hem - (net.position[v * 3 + 1] ?? 0)) / size;
    return lower.includes(net.role[v] ?? -1) && under > -0.03 && under < 0.06
      ? c * mix(0.52, 1, clamp(under / 0.06, 0, 1))
      : c;
  });
}
