// The mesh: built once at a cell size, and posed each frame, from an action or from joints set by hand.

import { add, madd, scale, sub } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import { LONG_TOP } from "../clothes/outfit.js";
import { blended, restSkeleton, skeletonOf } from "../motion/skeleton.js";
import type { Action, Arm, Leg, Skeleton } from "../motion/skeleton.js";
import { headFrame } from "../head/head.js";
import { bodyOf, phaseOf } from "../motion/pose.js";
import { HANG_LATE, HEAD, PANEL_LATE, boneOfPart, bonesOf } from "../body/bones.js";
import { FACE_PAINT, legsOf, unrolled } from "../body/field.js";
import type { Net, PersonMesh } from "../body/field.js";
import { bareParts, netOf } from "../head/wrap.js";
import { FABRICS } from "../clothes/fabric.js";
import { WRAPPED, creases, dressedBody, hemShadow, layersOf, roofOf } from "../clothes/cloth.js";
import { boundOf, compacted, earsOf, hairLocks } from "../head/hair.js";
import type { Seat } from "../head/hair.js";
import { browLineOf, faceBake, faceInks } from "../head/paint.js";
import { cornersOf, crownOver, gearOn, jacketFront, moustacheOf, poloFront } from "../clothes/gear.js";

/** The mesh of a person, built once, each layer its own closed shell on the same bones: `cell` the body's grid in metres, so a far person can have a coarser one; the head's is finer, for the face. */
export function meshOf(p: Person, cell = 0.016): PersonMesh {
  const body = bodyOf(p, "rest", 0, [0, 0, 0], 0, true);
  const decals = body.capsules.filter((c) => c.decal === true && !FACE_PAINT.test(c.part));
  const dressed = body.capsules.filter((c) => c.decal !== true && c.carve !== true && c.role !== "eye" && c.role !== "lip").flatMap(unrolled);
  const bare = bareParts(p);
  const roles = Object.keys(p.palette);
  const net: Net = { position: [], normal: [], role: [], bones: [], weight: [], fabric: [], loose: [], cloth: [], soft: [], index: [] };
  const headOnly = bare.filter((c) => boneOfPart(c.part) === HEAD);
  dressedBody(net, p, roles, cell);
  for (const layer of layersOf(p, dressed, bare, cell)) netOf(net, layer, decals, layer.rigid === true || layer.parts.some((c) => c.role === "hair" || /^(hat|peak)/.test(c.part)) ? headOnly : bare, roles, cell);
  const s = restSkeleton(p), h = headFrame(s, p.build.head, p.face), size = p.build.size;
  const eyeAt = (x: number): Vec => scale(h.mark(x * p.face.apart, p.face.bone.pupil, 0.8), size);
  const roof = roofOf(dressed, size);
  const locks = hairLocks(net, p, roles, cell, roof), skinRole = roles.indexOf("skin");
  const seat: Seat = { skin: boundOf(net, h, size, (v) => net.bones[v * 2] === HEAD && net.fabric[v] === FABRICS.skin && net.role[v] === skinRole), tops: [null, null], lobes: [null, null] };
  const tones = [...locks, ...earsOf(net, p, roles, cell, seat), ...(cell < WRAPPED ? [] : cornersOf(net, p, roles, cell, h)), ...moustacheOf(net, p, roles, cell, h), ...crownOver(net, p, roles, cell, h, seat), ...jacketFront(net, p, roles, cell), ...poloFront(net, p, roles, cell), ...gearOn(net, p, roles, cell, h, seat)];
  const kept = compacted(net);
  const shade = hemShadow(kept, creases(kept), roles, size);
  // (The locks went in last, so theirs are the last vertices.)
  shade.set(tones, shade.length - tones.length);
  faceBake(kept, shade, p, roles, cell, tones.length);
  return {
    position: Float32Array.from(kept.position), normal: Float32Array.from(kept.normal), role: Uint8Array.from(kept.role), roles, palette: p.palette,
    bones: Uint8Array.from(kept.bones), weight: Float32Array.from(kept.weight), fabric: Uint8Array.from(kept.fabric), loose: Float32Array.from(kept.loose), cloth: Float32Array.from(kept.cloth), shade, soft: Float32Array.from(kept.soft), index: Uint32Array.from(kept.index),
    legs: legsOf(p),
    face: { eyes: [eyeAt(-1), eyeAt(1)], eye: p.build.head * p.face.eye * size, mouth: scale(h.mark(0, p.face.bone.sto, 0.9), size), mouthWide: p.build.head * p.face.mouthWide * size, head: p.build.head * size, lip: p.face.look.lip ?? p.palette.lip ?? "#a85a52", browLine: browLineOf(p), look: p.outfit.costume === "fursuit" ? {} : { ...p.face.look, seed: p.seed }, ...faceInks(p) },
  };
}


/** A pose's bone matrices; given `from`, that many parts of the way from another action, for a fade. */
export function poseMesh(p: Person, action: Action, t: number, from?: { readonly action: Action; readonly t: number; readonly k: number }): Float32Array {
  const target = skeletonOf(p, action, phaseOf(p, action, t)), at = (lag: number): Skeleton => skeletonOf(p, action, phaseOf(p, action, t - lag));
  const late = LONG_TOP[p.outfit.top] !== undefined || p.outfit.bottom === "skirt" ? { panel: at(PANEL_LATE), hang: at(HANG_LATE) } : undefined;
  return bonesOf(p, from ? blended(skeletonOf(p, from.action, phaseOf(p, from.action, from.t)), target, 1 - from.k) : target, late);
}

/** Where a body's joints have been thrown, by physics or anything else, in metres from the point the mesh stands on. */
export interface Limp {
  /** How far the head has turned, radians. */
  readonly turn?: number;
  readonly pelvis: Vec;
  readonly neck: Vec;
  readonly head: Vec;
  readonly left: { readonly elbow: Vec; readonly wrist: Vec; readonly knee: Vec; readonly ankle: Vec };
  readonly right: { readonly elbow: Vec; readonly wrist: Vec; readonly knee: Vec; readonly ankle: Vec };
}

/** Bone matrices for joints something else has placed: a ragdoll, a mocap frame, a hand-set pose. */
export function limpBones(p: Person, limp: Limp): Float32Array {
  const stand = skeletonOf(p, "stand", 0), k = p.build.size;
  const down = (v: Vec): Vec => [v[0] / k, v[1] / k, v[2] / k];
  const pelvis = down(limp.pelvis), neck = down(limp.neck), head = down(limp.head);
  const limb = (side: "left" | "right"): { leg: Leg; arm: Arm } => {
    const j = limp[side], { arm, leg } = stand[side], wrist = down(j.wrist), ankle = down(j.ankle);
    const atWrist = (v: Vec): Vec => add(v, sub(wrist, arm.wrist)), atAnkle = (v: Vec): Vec => add(v, sub(ankle, leg.ankle));
    return {
      arm: { ...arm, shoulder: add(neck, sub(arm.shoulder, stand.neck)), elbow: down(j.elbow), wrist, hand: atWrist(arm.hand), tip: atWrist(arm.tip), nail: atWrist(arm.nail), thumb: atWrist(arm.thumb) },
      leg: { hip: add(pelvis, sub(leg.hip, stand.pelvis)), knee: down(j.knee), ankle, toe: atAnkle(leg.toe), end: atAnkle(leg.end) },
    };
  };
  const waist = madd(pelvis, sub(neck, pelvis), 0.25), chest = madd(pelvis, sub(neck, pelvis), 0.6);
  return bonesOf(p, { spin: 0, turn: limp.turn ?? 0, pelvis, waist, chest, neck, head, left: limb("left"), right: limb("right") });
}
