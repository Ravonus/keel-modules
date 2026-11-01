// Birds: beaks, wings, stances and flight; the spine, head, face, crest, wings, tail, torso, legs and feet.

import {
  TAU, UP, add, clamp, cross, dirOf, dot, length, lerpV, madd, mix, scale, smooth, solveTwoBone, sub, unit,
} from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import { wingStyle } from "../roster.js";
import type { Build, Role, SpeciesId, Station } from "../roster.js";
import { bodyStride } from "../stage/moments.js";
import type { Finish, Moment, Pose } from "../stage/moments.js";
import { ball, cap, cone, decal, footCycle, headAxes, ownPhase } from "./kit.js";
import type { Kit } from "./kit.js";
import { CHARM, at3, eyeOf, eyeSpot, loft, onFace, outlinedEye, sectionAt, sideAt } from "./quad-head.js";
import type { FacePoint, Head } from "./quad-head.js";
import { owlBib, owlFold, owlFoot, owlHead, owlTail, owlTorso, owlVeil, wingSpots } from "./owls.js";
import { eyeOfSpecies } from "./coats.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- birds



/**
 * How a bird holds itself on its feet: its body's tilt standing or perched
 * (0 level, π/2 upright: a robin sits up, an owl stands straight, a gull and
 * a crane keep level), the tilt as it walks or hops, and its body's reach in
 * front of and behind its middle, in its lengths.
 */
interface Stance { readonly pitch: number; readonly walk: number; readonly fore: number; readonly aft: number }
const STANCE: Stance = { pitch: 0.4, walk: 0.3, fore: 0.22, aft: 0.26 };
export const STANCES: Partial<Record<SpeciesId, Stance>> = {
  songbird: { pitch: 0.78, walk: 0.5, fore: 0.14, aft: 0.17 },
  woodpecker: { pitch: 0.82, walk: 0.5, fore: 0.16, aft: 0.2 },
  parrot: { pitch: 1, walk: 0.55, fore: 0.16, aft: 0.2 },
  crow: { pitch: 0.48, walk: 0.32, fore: 0.2, aft: 0.24 },
  owl: { pitch: 1.38, walk: 1.22, fore: 0.13, aft: 0.13 },
  gull: { pitch: 0.24, walk: 0.18, fore: 0.22, aft: 0.24 },
  peacock: { pitch: 0.22, walk: 0.18, fore: 0.2, aft: 0.24 },
  crane: { pitch: 0.16, walk: 0.12, fore: 0.2, aft: 0.22 },
  kookaburra: { pitch: 0.72, walk: 0.45, fore: 0.16, aft: 0.2 },
  guineafowl: { pitch: 0.18, walk: 0.14, fore: 0.18, aft: 0.2 },
};


export interface BirdBody {
  readonly C: Vec;
  readonly K: Vec;
  readonly T: Vec;
  readonly r: number;
  readonly pitch: number;
  readonly flying: boolean;
  readonly flight: Flight;
  readonly turn: number;
}

/**
 * Where a bird is in its flight: beating hard to climb off, cruising on its
 * own rhythm (flaps and held wings, or bursts and shut wings), coming in on
 * spread wings, then flaring, its body tipped up and its feet thrown
 * forward, to kill its speed and land. All by the clock, so a long flight
 * round the tree cruises and a hop to the next branch is nearly all launch
 * and landing.
 */
interface Flight { readonly launch: number; readonly glide: number; readonly flare: number; readonly closed: number }

const ON_FOOT: Flight = { launch: 0, glide: 0, flare: 0, closed: 0 };

function flightOf(who: Who, m: Moment): Flight {
  if (m.mode !== "fly") return ON_FOOT;
  const style = wingStyle(who);
  const span = Math.max(0.01, m.segment.t1 - m.segment.t0);
  const since = clamp(m.t - m.segment.t0, 0, span);
  const left = span - since;
  const flare = smooth(1 - left / Math.min(0.75, span * 0.3));
  const launch = (1 - smooth(since / Math.min(0.9, span * 0.3))) * (1 - flare);
  const cruise = (1 - launch) * (1 - flare);
  const c = (since / style.bout + ownPhase(who)) % 1;
  const held = style.bound ? 0 : smooth((c - (1 - style.glide)) / 0.08) * smooth((1 - c) / 0.04);
  const shut = style.bound ? smooth((c - 0.6) / 0.05) * smooth((0.97 - c) / 0.05) : 0;
  const into = Math.min(2.2, span * 0.45);
  const coming = smooth((into - left) / Math.max(0.05, into * 0.3));
  return { launch, flare, glide: Math.max(held * cruise, coming * (1 - flare)), closed: shut * cruise * (1 - coming) };
}

/**
 * An owl's proportions by coat, as shares of its kind's build, and its chest
 * as a share of its shoulders' width: a barn owl slim and long in the leg, a
 * great horned owl bulky and barrel-chested with a wide head, a snowy owl
 * broad, low and stocky with a smaller head for its body.
 */
interface OwlShape { readonly body: number; readonly leg: number; readonly head: number; readonly chest: number }
const OWL_SHAPE: OwlShape = { body: 1, leg: 1, head: 1, chest: 1 };
const OWL_SHAPES: Readonly<Record<string, OwlShape>> = {
  barn: { body: 0.94, leg: 1.12, head: 0.95, chest: 1.02 },
  "great horned": { body: 1.06, leg: 1, head: 1.06, chest: 1.08 },
  snowy: { body: 1.12, leg: 0.86, head: 0.96, chest: 1.02 },
};
export const owlShapeOf = (coat: string): OwlShape => OWL_SHAPES[coat] ?? OWL_SHAPE;

/** A bird's build, an owl's by its coat. */
function birdBuild(who: Who): Build {
  const b = who.spec.build;
  if (who.member.species !== "owl") return b;
  const shape = owlShapeOf(who.member.coat);
  return { ...b, body: b.body * shape.body, leg: b.leg * shape.leg, head: b.head * shape.head };
}

function birdSpine(who: Who, m: Moment): BirdBody {
  const q = m.pose;
  const b = birdBuild(who);
  const size = who.member.size;
  const stance = STANCES[who.member.species] ?? STANCE;
  const r = b.body * size * 0.85;
  const flying = m.mode === "fly";
  const flight = flightOf(who, m);
  const drum = m.segment.act === "drum";
  const standing = mix(stance.pitch, stance.walk, m.mode === "walk" ? m.moving : 0);
  const afoot = drum ? 1.35 : standing;
  let pitch = flying ? 0.05 + flight.launch * 0.3 + flight.flare * 0.85 : afoot;
  pitch -= q.peck * (drum ? 0.15 : 0.6);
  const legH = b.leg * size;
  const along = dirOf(0, pitch);
  const aft = stance.aft * size;
  // Standing or asleep, the low end of the body (its tail end, as it sits up) stays on top of what it stands on.
  const rest = Math.max(legH + r * 1.06 + q.hop * size * 0.3 - (m.segment.act === "sleep" ? r * 0.35 : 0), r + Math.max(0, along[1]) * aft);
  const grounded: Vec = drum ? [0, 0, -r * 0.4] : [0, rest, 0];
  const C: Vec = flying ? [0, 0, 0] : grounded;
  return {
    C,
    K: madd(C, along, stance.fore * size),
    T: madd(C, along, -aft),
    r,
    pitch,
    flying,
    flight,
    turn: bodyTurn(who, m),
  };
}

/**
 * How far a bird turns its head and how it cocks it. An owl swivels its
 * whole head where another bird would turn its body: barely as it stands,
 * but looking about, round over its shoulder until its face looks out past
 * its own wing, its face kept level (its shoulders follow it a little, see
 * `bodyTurn`); asleep, it sinks its head facing forward where another bird
 * tucks its bill back over its shoulder.
 */
function headTurn(who: Who, m: Moment): { readonly yaw: number; readonly roll: number; readonly tuck: number } {
  const q = m.pose;
  if (who.member.species !== "owl") return { yaw: q.headYaw, roll: q.headRoll, tuck: m.segment.act === "sleep" ? 1 : 0 };
  // (Cubed, so a glance stays small and a look goes all the way round.)
  const k = q.headYaw / 0.4;
  return { yaw: -1.3 * Math.tanh(k * k * k), roll: q.headRoll, tuck: 0 };
}

/**
 * How far a bird's shoulders turn after its head, on feet that stay put: an owl's only, so a long look is the whole
 * bird's.
 */
function bodyTurn(who: Who, m: Moment): number {
  return who.member.species === "owl" && m.mode !== "fly" ? headTurn(who, m).yaw * 0.2 : 0;
}

function birdHead(kit: Kit, who: Who, body: BirdBody, m: Moment): Head {
  const q = m.pose;
  const b = birdBuild(who);
  const size = who.member.size;
  const drum = m.segment.act === "drum";
  const { yaw, roll, tuck } = headTurn(who, m);
  const neckRise = (drum ? 0.2 : 1.2) - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0);
  const hd = dirOf(yaw + tuck * 2.6, (who.member.species === "owl" ? 0 : -0.1) + q.headPitch * 0.5 - q.peck * (drum ? 0.1 : 1.1) - (drum ? 1.2 : 0) + (body.flying ? 0.05 : 0));
  const hr = birdSkullR(who, b, body);
  if (who.member.species === "owl") return withSkull({ c: owlSkullAt(who, body, q, { yaw, tuck, hd, hr }), d: hd, ...headAxes(hd, roll), r: hr, ...eyeOfSpecies(who) }, b.skull);
  const occiput = cervical(kit, who, body, { rise: neckRise, yaw: yaw * 0.5 + tuck * 2.6, hr });
  // (The skull hangs forward of where the neck meets it: the neck comes in at its back, never under its middle.)
  const c = madd(madd(occiput, hd, hr * 0.72), [0, 0, 1], drum ? q.peck * size * 0.12 : 0);
  return withSkull({ c, d: hd, ...headAxes(hd, roll), r: hr, ...eyeOfSpecies(who) }, b.skull);
}

/** How a head is held: turned `yaw`, tucked in `tuck`, pointing `hd`, of radius `hr`. */
interface Held { readonly yaw: number; readonly tuck: number; readonly hd: Vec; readonly hr: number }

/** An owl carries its head right on top of its body, a short neck under its ruff. */
function owlSkullAt(who: Who, body: BirdBody, q: Pose, held: Held): Vec {
  const { yaw, tuck, hd, hr } = held;
  const b = birdBuild(who);
  const upright = body.flying ? 0 : clamp((body.pitch - 1.1) / 0.3, 0, 1);
  const base = madd(body.K, UP, body.r * (0.45 + upright * 0.1));
  const dir = dirOf(
    yaw * 0.5 + tuck * 2.6,
    1.2 + upright * 0.35 - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0),
  );
  const top = madd(base, dir, Math.max(b.neck * who.member.size, body.r * 0.3) * (1 - tuck * 0.6));
  return madd(madd(top, hd, hr * 0.4 * (1 - upright * 0.85)), UP, hr * upright * 0.15);
}

/**
 * How long a bird's neck is, in its body's radii: at its least still a real neck, the length of the skull it carries.
 */
const neckLength = (who: Who, b: Build, body: BirdBody): number =>
  Math.max(b.neck * who.member.size * 1.15, body.r * 0.95);
const longNeck = (who: Who, b: Build, body: BirdBody): boolean => neckLength(who, b, body) > body.r * 1.6;
/** A skull's radius: a short-necked bird's a little smaller, its neck carrying it into its shoulders. */
const birdSkullR = (who: Who, b: Build, body: BirdBody): number => b.head * who.member.size * CHARM * (who.member.species === "owl" || longNeck(who, b, body) ? 1 : 0.88);

/**
 * The neck, as a skeleton: from the shoulders three joints in the S every
 * bird carries it in, forward first, up, then forward again to the back of
 * the skull, and skinned from those joints, broad under the feathers on a
 * short neck and slim on a long one. Returns where it meets the skull.
 */
function cervical(
  kit: Kit,
  who: Who,
  body: BirdBody,
  neck: { readonly rise: number; readonly yaw: number; readonly hr: number },
): Vec {
  const { rise, yaw, hr } = neck;
  const b = birdBuild(who);
  const L = neckLength(who, b, body);
  const long = longNeck(who, b, body);
  const up: Vec = [0, Math.cos(body.pitch), -Math.sin(body.pitch)];
  const root = madd(body.K, up, body.r * 0.3);
  const low = madd(root, dirOf(yaw * 0.5, rise - 0.55), L * 0.4);
  const mid = madd(low, dirOf(yaw, rise + 0.3), L * 0.35);
  const occiput = madd(mid, dirOf(yaw, rise - 0.3), L * 0.25);
  const [r0, r1, r2] = long ? [body.r * 0.42, body.r * 0.3, hr * 0.5] : [body.r * 0.8, hr * 0.98, hr * 0.84];
  const crowned = who.member.coat === "red-crowned";
  cone(kit, "neck", "coat", { a: root, b: low, r: r0, r1, melt: 1 });
  cone(kit, "neck.upper", crowned ? "dark" : "coat", { a: low, b: occiput, r: r1, r1: r2, melt: 1 });
  return occiput;
}

/** A bird's head drawn from its kind's skull, its front (where the bill grows) at the last station. */
function withSkull(head: Head, skull: readonly Station[] | undefined): Head {
  if (!skull) return head;
  return {
    ...head,
    stations: skull,
    stop: skull[skull.length - 1]?.[0] ?? 0.6,
    sec: (k: number) => sectionAt(skull, k),
  };
}

/**
 * The colour of a bird's head, where it is not its coat's: a kookaburra's
 * pale head, a guineafowl's bare blue one.
 */
const HEADS: Partial<Record<SpeciesId, Role>> = { kookaburra: "belly", guineafowl: "accent" };

function birdFace(kit: Kit, who: Who, h: Head, m: Moment): void {
  const id = who.member.species;
  if (id === "owl") {
    owlHead(kit, who, h, m);
    return;
  }
  const role = HEADS[id] ?? "coat";
  if (h.stations) loft(kit, "head", role, { st: h.stations, along: (k) => madd(h.c, h.d, k * h.r), u: h.u, s: h.s, size: h.r, melt: 1 });
  else cap(kit, "head", role, { a: h.c, b: h.c, r: h.r, flat: 1, up: UP });
  birdBeak(kit, who, h, m);
  // A kookaburra's dark stripe back through the eye.
  // (Found from the eye, so the stripe runs through it whatever the skull.)
  if (id === "kookaburra")
    for (const x of [-1, 1]) {
      const eye = birdEyeSpot(h, x);
      decal(kit, "stripe", "alt", {
        a: onFace(h, eye),
        b: onFace(h, sideAt(x, eye[0] - 0.55, eye[2] - 0.06)),
        r: h.r * 0.2,
      });
    }
  for (const x of [-1, 1]) birdEye(kit, h, x, m.segment.act !== "sleep");
  birdCrest(kit, who, h);
}


/** An eye on a drawn skull, on its side just behind the bill, where a bird's is; on a round head, out on its side. */
/** Where a bird's eye sits: on a drawn skull's side just behind the bill, on a round head a little forward. */
const birdEyeSpot = (h: Head, x: number): FacePoint =>
  h.stations ? eyeSpot(Math.max(0, (h.stop ?? 0.6) - 0.5), x * 0.75, 0.3) : [0.35, x * 0.62, 0.2];

function birdEye(kit: Kit, h: Head, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  if (h.stations) outlinedEye(kit, part, h, { spot: birdEyeSpot(h, x), r: h.r * 0.2, open });
  else eyeOf(kit, part, h, { toward: onFace(h, birdEyeSpot(h, x)), r: h.r * 0.2, open });
}

/**
 * Where the bill grows and how deep it is there: on a drawn skull from its
 * front, as deep as the bird's own bill but never deeper than the face; on a
 * round head out of its front. (Tapered to its point from there, so a small
 * bird's bill reads as a bill and not a dark bead.)
 */
function billRoot(who: Who, h: Head): { root: Vec; br: number } {
  const front = h.stop ?? 0;
  const face = h.sec?.(front);
  if (!face) return { root: at3(h, 0.65, 0, 0.05), br: h.r * 0.27 };
  return {
    root: madd(madd(h.c, h.d, (front - 0.15) * h.r), h.u, face.o * h.r),
    br: h.r * Math.min(who.spec.build.bill ?? 0.3, face.h * 0.95),
  };
}

/**
 * How a bill grows, in shares of its length: how far its top line arches, how far its tip droops below its root, and
 * how far along the lower half reaches.
 */
interface Bill { readonly arch: number; readonly hook: number; readonly low: number }
const BILL: Bill = { arch: 0.08, hook: 0.04, low: 0.88 };
const BILLS: Partial<Readonly<Record<string, Bill>>> = {
  songbird: { arch: 0.06, hook: 0, low: 0.86 },
  crow: { arch: 0.13, hook: 0.07, low: 0.86 },
  parrot: { arch: 0.42, hook: 0.3, low: 0.5 },
  gull: { arch: 0.1, hook: 0.17, low: 0.84 },
  crane: { arch: 0.02, hook: 0, low: 0.96 },
  woodpecker: { arch: 0.02, hook: 0, low: 0.95 },
  kookaburra: { arch: 0.06, hook: 0.06, low: 0.92 },
  guineafowl: { arch: 0.14, hook: 0.1, low: 0.8 },
  peacock: { arch: 0.1, hook: 0.08, low: 0.84 },
};

/**
 * The bill, two sheaths of horn meeting along a gape: the upper arched and drawn down to its point, the lower slimmer
 * and shorter under it, dropping as the mouth opens. No two birds' are quite the same.
 */
function birdBeak(kit: Kit, who: Who, h: Head, m: Moment): void {
  const beak = who.spec.build.snout * who.member.size;
  const mouth = m.pose.mouth;
  const { root, br } = billRoot(who, h);
  const gene = createRandom(markOf(who) ^ 0x51ed270b);
  const bill = BILLS[who.member.species] ?? BILL;
  const long = (beak + (h.sec ? h.r * 0.15 : 0)) * mix(0.93, 1.07, gene());
  const arch = long * bill.arch * mix(0.8, 1.2, gene());
  const top = madd(root, h.u, br * 0.26);
  const tip = madd(madd(top, h.d, long), h.u, -(long * bill.hook + br * 0.26));
  const along = unit(sub(tip, top), h.d);
  cap(kit, "beak", "horn", { a: top, b: tip, r: br * 0.76, flat: 1, up: UP, finish: { r1: br * mix(0.07, 0.17, bill.hook), bow: scale(unit(madd(h.u, along, -dot(h.u, along)), h.u), arch), melt: 0.2 } });
  const jaw = madd(root, h.u, -br * 0.46);
  const end = madd(madd(jaw, h.d, long * bill.low), h.u, br * 0.28 - long * 0.5 * mouth);
  cap(kit, "beak.lower", "horn", { a: jaw, b: end, r: br * 0.5, flat: 1, up: UP, finish: { r1: br * 0.05, bow: scale(h.u, -long * 0.03), melt: 0.15, shadow: false } });
}

/** A peacock's crest: a fan of bare quills up off its crown, each with a small flag at its tip. */
function peacockCrest(kit: Kit, h: Head): void {
  const [a, b] = [at3(h, -0.1, -0.7, 0.7), at3(h, -0.1, 0.7, 0.7)];
  const reach = add(scale(h.u, h.r * 1.3), scale(h.d, -h.r * 0.25));
  cap(kit, "crown", "dark", { a, b, r: h.r * 0.035, flat: 1, up: UP, finish: { row: 5, reach, melt: 0.1, shadow: false } });
  cap(kit, "crown.tip", "alt", { a: add(a, reach), b: add(b, reach), r: h.r * 0.1, flat: 0.7, up: h.d, finish: { row: 5, melt: 0, shadow: false } });
}

function birdCrest(kit: Kit, who: Who, h: Head): void {
  const b = who.spec.build;
  const id = who.member.species;
  if (b.extras.includes("crest")) {
    if (id === "woodpecker") {
      // A woodpecker's red is a patch on its crown and nape, not a plume.
      ball(kit, "crest", "accent", { p: at3(h, -0.5, 0, 0.55), r: h.r * 0.32, flat: 0.4, up: unit(add(h.u, scale(h.d, -0.8))) });
    } else if (who.member.coat === "cockatoo") {
      // A cockatoo's crest: a few thin feathers raised up and back.
      for (const [i, s] of [[0, 0], [1, -0.28], [2, 0.28]] as const) {
        const root = at3(h, -0.05 - i * 0.05, s * 0.4, 0.75);
        cap(kit, `crest.${String(i)}`, "accent", { a: root, b: madd(root, unit(add(add(h.u, scale(h.d, -0.9)), scale(h.s, s))), h.r * (0.95 - i * 0.12)), r: h.r * 0.12, flat: 0.45, up: h.s });
      }
    }
  }
  if (b.extras.includes("crown")) {
    if (id === "peacock") peacockCrest(kit, h);
    else if (id === "guineafowl") {
      // A helmeted guineafowl's bony casque, up and back off its bare blue crown.
      const root = at3(h, -0.1, 0, 0.7);
      cap(kit, "casque", "horn", { a: root, b: madd(root, unit(add(h.u, scale(h.d, -0.55))), h.r * 1.1), r: h.r * 0.42, flat: 0.7, up: h.s, finish: { r1: h.r * 0.12, melt: 0.5 } });
    } else ball(kit, "crown", "accent", { p: at3(h, 0.1, 0, 0.78), r: h.r * 0.5, flat: 0.5 });
  }
}

/**
 * What a wing is doing this moment: how high the arm is raised (`elev`), how
 * far the hand is flexed back (on the upstroke, to slip the air), how far the
 * primaries spread (held wings, a flare), how open the whole wing is (0
 * folded on the back) and how far it sweeps back.
 */
interface Beat {
  readonly elev: number;
  readonly flex: number;
  readonly spread: number;
  readonly open: number;
  readonly sweep: number;
}

function wingBeat(who: Who, body: BirdBody, m: Moment): Beat {
  const q = m.pose;
  if (!body.flying) {
    // A flap on the spot, a display, a stretch: open and beating; otherwise folded.
    const open = clamp(q.wing, 0, 1);
    return { elev: 0.25 + 0.75 * q.flap, flex: 0.25 * (1 - q.flap), spread: open * 0.6, open, sweep: 0 };
  }
  const style = wingStyle(who);
  const f = body.flight;
  const phase = m.t * style.rate * (1 + f.launch * 0.3 + f.flare * 0.5) + ownPhase(who) * TAU;
  const amp = mix(0.75, 1.05, f.launch);
  const s = Math.sin(phase);
  // (The wing is rising while the sine climbs: the upstroke.)
  const rising = Math.max(0, Math.cos(phase));
  const held = f.glide;
  return {
    elev: mix(mix(0.12 + amp * s, style.dihedral + 0.03 * Math.sin(m.t * 1.7), held), 0.5 + 0.5 * s, f.flare),
    flex: mix(rising * 0.75, 0, held) * (1 - f.flare * 0.5),
    spread: Math.max(held, f.flare, 0.3 * (1 - rising)),
    open: 1 - f.closed * 0.85,
    sweep: f.closed * 0.6 - f.flare * 0.35 + held * 0.08,
  };
}

/**
 * One wing. Folded, two flat plates along the body's side, the hand crossing
 * over the tail. Open, a broad arm with its trailing edge in its own colour
 * and a long hand, its tip in the tip colour or splayed into primaries: the
 * arm rises and falls with the beat, the hand further, flexed back on the
 * upstroke and straight out on the downstroke.
 */
/** A wing's side and joints this moment: where its shoulder, elbow and tip lie. */
interface WingPose { readonly x: number; readonly shoulder: Vec; readonly elbow: Vec; readonly tip: Vec }

/** Where a wing's joints lie: between folded on the flank and raised on the beat, as open as it is. */
function wingJoints(who: Who, body: BirdBody, x: number, beat: Beat): WingPose {
  const style = wingStyle(who);
  const size = who.member.size;
  const span = style.span * size;
  const side: Vec = [x, 0, 0];
  const forward = dirOf(0, body.pitch);
  const shoulder = add(body.K, [x * body.r * 0.7, body.r * 0.3, -body.r * 0.1]);
  // (Well back along the flank, so the wing runs long and low, not a disc at the shoulder.)
  const foldElbow = madd(lerpV(body.C, body.T, 0.3), side, body.r * 0.88);
  const foldTip = madd(madd(body.T, side, body.r * 0.45), forward, -size * 0.16);
  const open = beat.open;
  const armDir = unit([x * Math.cos(beat.elev), Math.sin(beat.elev), -0.12 - beat.sweep * 0.5]);
  const handElev = beat.elev * 1.35 - beat.flex * 0.35;
  const handDir = unit([
    x * Math.cos(handElev) * (1 - beat.flex * 0.45),
    Math.sin(handElev),
    -0.28 - beat.flex * 0.9 - beat.sweep,
  ]);
  const elbow = lerpV(foldElbow, madd(shoulder, armDir, span * 0.44), open);
  const tip = lerpV(foldTip, madd(elbow, handDir, span * 0.56 * (1 - beat.flex * 0.25)), open);
  return { x, shoulder, elbow, tip };
}

function wingOf(kit: Kit, who: Who, body: BirdBody, side: { readonly x: number; readonly beat: Beat }): void {
  const { x, beat } = side;
  const style = wingStyle(who);
  const chord = style.chord * who.member.size;
  const L = x < 0 ? "L" : "R";
  const wing = wingJoints(who, body, x, beat);
  const { shoulder, elbow, tip } = wing;
  if (beat.open < 0.45) {
    foldedWing(kit, who, body, wing);
    return;
  }
  const plane = (dir: Vec): Vec => unit(cross(dir, [0, 0, 1]), UP);
  const armUp = plane(sub(elbow, shoulder));
  const handUp = plane(sub(tip, elbow));
  const behind = (p: Vec, k: number): Vec => madd(p, [0, 0, -1], chord * k);
  // (Thin, and melting barely into the body, so a wing stands off it as a wing at any size, even
  // a black wing on a black bird: the arm broad, the hand tapering to its tip. The trailing edge
  // shows behind the arm as its own band.)
  const thin: Finish = { melt: 0.12 };
  cap(kit, `wing.${L}`, style.top, { a: behind(shoulder, 0.1), b: behind(elbow, 0.1), r: chord * 0.46, flat: 0.16, up: armUp, finish: { ...thin, r1: chord * 0.42 } });
  cap(kit, `wing.trail.${L}`, style.trail, { a: behind(shoulder, 0.62), b: behind(elbow, 0.55), r: chord * 0.3, flat: 0.13, up: armUp, finish: { melt: 0.1 } });
  if (style.spots) wingSpots(kit, style.spots, L, { root: behind(shoulder, 0.25), tip: behind(tip, 0.25), chord });
  const fingers = style.fingers > 0 && beat.spread > 0.35 ? style.fingers : 0;
  const wrist = fingers > 0 ? lerpV(elbow, tip, 0.55) : tip;
  cap(kit, `wing.hand.${L}`, style.top, { a: behind(elbow, 0.12), b: behind(wrist, 0.05), r: chord * 0.4, flat: 0.15, up: handUp, finish: { melt: 0.15, r1: chord * (fingers > 0 ? 0.3 : 0.16) } });
  if (fingers === 0) {
    cap(kit, `wingtip.${L}`, style.tip, { a: behind(lerpV(elbow, tip, 0.6), 0.03), b: tip, r: chord * 0.26, flat: 0.14, up: handUp, finish: { melt: 0.1, r1: chord * 0.08 } });
    return;
  }
  primaries(kit, `wing.primary.${L}`, style.tip, { elbow, wrist, tip, up: handUp, chord, fingers, spread: beat.spread });
}

/** A hand's primaries: how many, from the wrist to the tip, their face, the wing's chord, and how far they spread. */
interface Hand {
  readonly elbow: Vec;
  readonly wrist: Vec;
  readonly tip: Vec;
  readonly up: Vec;
  readonly chord: number;
  readonly fingers: number;
  readonly spread: number;
}

/** The primaries, splayed like fingers: the more it holds its wings, the wider. */
function primaries(kit: Kit, part: string, role: Role, hand: Hand): void {
  const { elbow, wrist, tip, up, chord, fingers, spread } = hand;
  const axis = unit(sub(tip, elbow));
  const across = unit(cross(up, axis), [0, 0, -1]);
  const back = across[2] <= 0 ? across : scale(across, -1);
  const reach = length(sub(tip, wrist));
  for (let i = 0; i < fingers; i += 1) {
    const k = i / (fingers - 1 || 1);
    const dir = unit(madd(axis, back, (k * 0.95 - 0.15) * spread));
    const root = madd(wrist, back, chord * (k * 0.5 - 0.1));
    cap(kit, `${part}${String(i)}`, role, { a: root, b: madd(root, dir, reach * (1 - k * 0.25)), r: chord * 0.15, flat: 0.12, up, finish: { melt: 0.1, r1: chord * 0.09 } });
  }
}

/** A folded wing: two plates along the flank, the hand over the tail (an owl's its own, see `owlFold`). */
function foldedWing(kit: Kit, who: Who, body: BirdBody, wing: WingPose): void {
  const { x, shoulder, elbow, tip } = wing;
  const style = wingStyle(who);
  if (who.member.species === "owl") {
    owlFold(kit, style, body, x);
    return;
  }
  const L = x < 0 ? "L" : "R";
  const side: Vec = [x, 0, 0];
  // (A blade, not a plate: narrow at the shoulder, broadest over the flank, drawn to a point past the rump, laid close
  // along the body.)
  cap(kit, `wing.${L}`, style.fold[0], {
    a: madd(shoulder, side, -body.r * 0.12),
    b: madd(elbow, side, -body.r * 0.12),
    r: body.r * 0.3,
    flat: 0.22,
    up: side,
    finish: { r1: body.r * 0.46, melt: 0.35 },
  });
  cap(kit, `wingtip.${L}`, style.fold[1], { a: madd(elbow, side, -body.r * 0.12), b: tip, r: body.r * 0.44, flat: 0.18, up: side, finish: {
    r1: body.r * 0.07,
    melt: 0.3,
  } });
}


/** How many separate feathers a spread train shows. */
const TRAIN_SPREAD = 15;

/** A peacock's train: tiers of separate long feathers, spread or closed. */
/** A feather's flat face, square to its own length: the outermost of a fan still shows its face and not its edge. */
const featherFace = (dir: Vec, want: Vec): Vec => unit(madd(want, dir, -dot(want, dir)), want);

function trainFeathers(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const fan = m.pose.fan;
  const above = aboveFloor(m);
  // (Spread, tiers of separate long feathers, the shorter set before the longer and showing between them; closed, a
  // tapering train.)
  const count = fan > 0.3 ? TRAIN_SPREAD : 6;
  for (let i = 0; i < count; i += 1) {
    const a = (i / (count - 1) - 0.5) * 2.6;
    const fore = fan > 0.3 && i % 2 === 1;
    const spread = unit(add(scale(UP, Math.cos(a)), scale([1, 0, 0], Math.sin(a))));
    const dir = unit(
      lerpV(dirOf(Math.PI + (i / (count - 1) - 0.5) * 0.75, -0.25), add(spread, [0, 0, fore ? -0.2 : -0.28]), fan),
    );
    // (Closed, the middle feathers run longest, so the train comes to a point behind; spread, they make an even fan.)
    const tip = above(
      madd(
        body.T,
        dir,
        b.tailLen * size * mix(0.62 + 0.38 * Math.cos(a * 1.6), (fore ? 0.74 : 1) * (0.88 + 0.12 * Math.cos(a)), fan),
      ),
      body.r * 0.42,
    );
    // (Each feather a thin shaft at its root and broad toward its end; its shaft, barbs and eye are the renderer's to
    // paint.)
    cap(kit, `train.${String(i)}`, fan > 0.3 ? "shell" : "alt", {
      a: body.T,
      b: tip,
      r: body.r * 0.07,
      flat: 0.14,
      up: featherFace(dir, unit(lerpV(UP, [0, 0, 1], fan), UP)),
      finish: { r1: body.r * mix(0.5, fore ? 0.82 : 0.95, fan), melt: mix(1, 0.08, fan) },
    });
    // Closed, its eyespots show down each feather, a dark heart in each gold eye.
    if (fan <= 0.3)
      for (const [role, wide, detail] of [
        ["accent", 0.13, undefined],
        ["dark", 0.06, 1],
      ] as const)
        cap(kit, `eyespot.${String(i)}`, role, {
          a: lerpV(body.T, tip, 0.4 + (i % 2) * 0.08),
          b: lerpV(body.T, tip, 0.96),
          r: body.r * wide,
          flat: 1,
          up: UP,
          finish: { row: 4, decal: true, ...(detail === undefined ? {} : { detail }) },
        });
  }
}

const TAIL_FEATHERS = [-1, -0.5, 0, 0.5, 1];

/** On the ground a tail (or a train) drags along it, never through it: a feather's tip, kept its radius above. */
function aboveFloor(m: Moment): (tip: Vec, r: number) => Vec {
  const floor = m.mode !== "fly" && m.segment.to.on === "ground" && m.segment.from.on === "ground";
  return (tip, r) => (floor ? [tip[0], Math.max(tip[1], r), tip[2]] : tip);
}

function birdTail(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const tilt = -body.pitch * 0.8 - 0.1 + m.pose.tailUp;
  const above = aboveFloor(m);
  if (!b.extras.includes("train")) {
    // A fan of feathers, spread wide as it steers and lands, closed as it sits.
    const spread = clamp(0.1 + body.flight.flare * 0.45 + body.flight.glide * 0.2 + m.pose.fan * 0.4, 0, 0.6);
    // (The rump narrows into it, so the tail grows out of the body and doesn't end it.)
    cap(kit, "rump", "coat", { a: lerpV(body.C, body.T, 0.2), b: madd(body.T, dirOf(Math.PI, tilt), body.r * 0.9), r: body.r * 0.86, flat: 1, up: UP, finish: { r1: body.r * 0.18, melt: 1.6 } });
    // (Thin, and broader at the tip than the root: each its own feather, not a stump off the rump.)
    TAIL_FEATHERS.forEach((k, i) => {
      const dir = dirOf(Math.PI + 0.15 * m.pose.tailWag + k * spread, tilt);
      const r = body.r * 0.2;
      const root = madd(body.T, dir, body.r * 0.3);
      cap(kit, `tail.${String(i)}`, wingStyle(who).tail, { a: root, b: above(madd(body.T, dir, b.tailLen * size * (1 - 0.1 * Math.abs(k))), r), r, flat: 0.1, up: unit(cross(dir, [1, 0, 0]), UP), finish: { r1: r * 1.3, melt: 0.1 } });
    });
    return;
  }
  trainFeathers(kit, who, body, m);
}

/** Plumage painted on: a kookaburra's brown mantle over its pale body. */
function birdMarks(kit: Kit, who: Who, body: BirdBody): void {
  const id = who.member.species;
  const over: Vec = [0, Math.cos(body.pitch), -Math.sin(body.pitch)];
  if (id === "kookaburra") decal(kit, "mantle", "alt", { a: madd(body.T, over, body.r * 0.75), b: madd(body.K, over, body.r * 0.6), r: body.r * 0.62 });
}

/**
 * The body: a drawn one follows its kind's back and keel, the breast a patch of colour on its front-and-under side
 * (whichever way it is tipped), not a lump.
 */
function birdTorso(kit: Kit, b: Build, body: BirdBody): void {
  const under: Vec = [0, -Math.cos(body.pitch), Math.sin(body.pitch)];
  if (!b.torso) {
    cap(kit, "body", "coat", { a: body.T, b: body.K, r: body.r });
    ball(kit, "breast", "belly", { p: madd(lerpV(body.C, body.K, 0.55), under, body.r * 0.32), r: body.r * 0.86 });
    return;
  }
  loft(kit, "body", "coat", { st: b.torso, along: (k) => lerpV(body.T, body.K, k), u: scale(under, -1), s: [1, 0, 0], size: body.r, melt: 1 });
  ball(kit, "breast", "belly", { p: madd(lerpV(body.C, body.K, 0.55), under, body.r * 0.38), r: body.r * 0.74 });
}



export function poseBird(kit: Kit, who: Who, m: Moment): void {
  const body = birdSpine(who, m);
  if (who.member.species === "owl") owlTorso(kit, who.member.coat, body);
  else birdTorso(kit, who.spec.build, body);
  birdMarks(kit, who, body);
  const head = birdHead(kit, who, body, m);
  birdFace(kit, who, head, m);
  if (who.member.coat === "great horned") owlBib(kit, head);
  const beat = wingBeat(who, body, m);
  for (const x of [-1, 1]) wingOf(kit, who, body, { x, beat });
  if (who.member.species === "owl" && !body.flying) owlTail(kit, who, body);
  else birdTail(kit, who, body, m);
  birdLegs(kit, who, body, m);
  if (who.member.coat === "barn") owlVeil(kit, body, head);
}

/** The toes a bird stands on, as angles off its front: three splayed ahead, one behind. */
const BIRD_TOES = [-0.52, 0, 0.52, Math.PI] as const;
/** How much foot a body can afford: what its parts budget leaves, for each foot, at each level of detail. */
function footDetail(kit: Kit): "claws" | "toes" | "foot" {
  const room = 48 - kit.out.length - 4;
  if (room >= 16) return "claws";
  return room >= 8 ? "toes" : "foot";
}

/**
 * A foot's toes down from the ankle, each drawn out to its own curved claw; with fewer parts to spend, plain toes, or
 * one foot.
 */
/** How long a toe is, in the foot's radii: the middle one longest, the hind one short. */
function toeLength(i: number): number {
  if (i === 3) return 3.6;
  return i === 1 ? 6.2 : 5.2;
}

/** A leg to draw: which side, where its foot is, how long it is, and how much foot the body can afford. */
interface BirdLeg {
  readonly x: number;
  readonly foot: Vec;
  readonly legH: number;
  readonly detail: ReturnType<typeof footDetail>;
}

function birdFoot(
  kit: Kit,
  part: string,
  foot: { readonly sole: Vec; readonly r: number },
  detail: ReturnType<typeof footDetail>,
): void {
  const { sole, r } = foot;
  if (detail === "foot") {
    cone(kit, `${part}.toes`, "horn", {
      a: add(sole, [0, 0, -r * 2.4]),
      b: add(sole, [0, -r * 0.3, r * 5.2]),
      r: r * 0.9,
      r1: r * 0.5,
      melt: 0.3,
    });
    return;
  }
  const low: Vec = [sole[0], sole[1] - r * 0.5, sole[2]];
  BIRD_TOES.forEach((angle, i) => {
    const way: Vec = [Math.sin(angle), 0, Math.cos(angle)];
    const length = r * toeLength(i);
    const tip = madd(low, way, length);
    cone(kit, `${part}.toe.${String(i)}`, "horn", { a: low, b: tip, r: r * 0.72, r1: r * 0.42, melt: 0.3 });
    if (detail !== "claws") return;
    cap(kit, `${part}.claw.${String(i)}`, "dark", {
      a: tip,
      b: add(madd(tip, way, r * 2.1), [0, -r * 0.5, 0]),
      r: r * 0.4,
      flat: 1,
      up: UP,
      finish: { r1: r * 0.06, melt: 0.15, bow: [0, r * 0.4, 0] },
    });
  });
}

/**
 * A bird's leg as its bones lie: the hip back under the body, the feathered
 * thigh down to an ankle that bends backward (what looks like a bird's knee),
 * the bare shank down to the foot, and its toes and claws.
 */
function birdLeg(kit: Kit, body: BirdBody, leg: BirdLeg): void {
  const { x, foot, legH, detail } = leg;
  const part = `leg.${x < 0 ? "L" : "R"}`;
  const hip = add(lerpV(body.C, body.T, 0.2), [x * body.r * 0.4, -body.r * 0.55, 0]);
  const r = Math.max(0.005, body.r * 0.085);
  const sole: Vec = [foot[0], foot[1] + r, foot[2]];
  const { mid } = solveTwoBone(hip, sole, [legH * 0.62, legH * 0.62], [0, 0, -1]);
  cone(kit, `${part}.thigh`, "coat", { a: hip, b: mid, r: body.r * 0.34, r1: r * 1.4, melt: 0.7 });
  cone(kit, `${part}.shank`, "horn", { a: mid, b: sole, r: r * 1.2, r1: r, melt: 0.3 });
  birdFoot(kit, part, { sole, r }, detail);
}

/**
 * A bird's legs: tucked in or trailed behind in the air, on the ground walking or standing (an owl's feathered, on
 * talons).
 */
function birdLegs(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = birdBuild(who);
  const size = who.member.size;
  const legH = b.leg * size;
  // A long-legged bird trails its legs out behind it in the air; others tuck them in.
  const trails = legH > body.r * 2.5;
  const detail = footDetail(kit);
  for (const x of [-1, 1]) {
    const hip = add(body.C, [x * body.r * 0.35, -body.r * 0.6, 0]);
    if (body.flying) {
      const tucked: Vec = trails
        ? [x * body.r * 0.15, -body.r * 0.25, -(legH + body.r * 0.9)]
        : [0, -body.r * 0.2, -body.r * 1.1];
      const reaching: Vec = [x * body.r * 0.2, -legH - body.r * 0.3, body.r * 0.5];
      cap(kit, "leg", "horn", { a: hip, b: add(hip, lerpV(tucked, reaching, body.flight.flare)), r: body.r * 0.12 });
      continue;
    }
    // (Hopping, both feet land together; walking, the right foot a half stride behind the left.)
    const lag = m.segment.act === "hop" || x < 0 ? 0 : 0.5;
    const step =
      m.moving > 0
        ? footCycle(m.phase - lag, 0.5, 0.5 * bodyStride(who) * m.moving, legH * 0.35 * m.moving)
        : { z: 0, y: 0 };
    const foot: Vec = m.segment.act === "drum" ? [x * body.r * 0.5, -size * 0.12, 0] : [x * body.r * 0.45, step.y, step.z];
    if (who.member.species === "owl") {
      owlFoot(kit, who, body, { x, foot });
      continue;
    }
    birdLeg(kit, body, { x, foot, legH, detail });
  }
}
