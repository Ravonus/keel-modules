// The sky: flocks, swarms, bats and planes passing over, on routes that fit the hour, the weather and the world.

import { TAU, UP, add, clamp, cross, frameOf, length, lerpV, madd, smooth, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { between, intBetween } from "../roll.js";
import type { Palette } from "../roster.js";
import { bankedUp } from "./paths.js";
import type { Segment } from "./director.js";
import { restPose } from "./moments.js";
import type { Moment } from "./moments.js";
import { ball, cap } from "../animals/kit.js";
import type { Kit } from "../animals/kit.js";
import type { PlaneKind, SkyKind, SkyNow, SkyPlan, SkyTraffic } from "../casting.js";
import { bodyOf, poseWho } from "../animals/bodies.js";
import type { Body, Who } from "../animals/bodies.js";

// ---------------------------------------------------------------- the sky

export interface Pass {
  readonly kind: SkyKind;
  readonly start: number;
  readonly end: number;
  readonly from: Vec;
  readonly to: Vec;
  readonly count: number;
  readonly v: boolean;
  readonly seed: number;
}

/** Schedule passes ahead to `t`; `make` may decline one (nothing fits the sky just then). */
/** The sky's traffic: its passes so far, when the last was set off, its own roll, and how often one comes. */
export interface Traffic {
  readonly list: Pass[];
  readonly clock: { last: number };
  readonly rand: () => number;
  readonly every: readonly [number, number];
}

export function passesUntil(traffic: Traffic, t: number, make: (start: number) => Pass | null): void {
  const { list, clock, rand, every } = traffic;
  while (clock.last < t + 1) {
    clock.last += between(rand, every);
    const pass = make(clock.last);
    if (pass) list.push(pass);
  }
  while (list.length > 0 && (list[0]?.end ?? 0) < t - 5) list.shift();
}

function chord(
  rand: () => number,
  near: readonly [number, number],
  height: readonly [number, number],
  span: number,
): { from: Vec; to: Vec } {
  const heading = rand() * TAU;
  const offset = between(rand, near) * (rand() < 0.5 ? -1 : 1);
  const y = between(rand, height);
  const dir: Vec = [Math.sin(heading), 0, Math.cos(heading)];
  const side: Vec = [Math.cos(heading), 0, -Math.sin(heading)];
  const mid: Vec = [side[0] * offset, y, side[2] * offset];
  return { from: madd(mid, dir, -span), to: madd(mid, dir, span) };
}

/** How each kind crosses the sky: how far off, how high, how long a path, how fast, how many together. */
interface Route {
  readonly near: readonly [number, number];
  readonly height: readonly [number, number];
  readonly span: number;
  readonly speed: readonly [number, number];
  readonly count: readonly [number, number];
}
const ROUTES: Readonly<Record<SkyKind, Route>> = {
  flock: { near: [8, 26], height: [6, 15], span: 45, speed: [3.5, 5.5], count: [1, 9] },
  vee: { near: [10, 30], height: [12, 22], span: 55, speed: [4, 5.5], count: [5, 11] },
  murmuration: { near: [14, 26], height: [9, 15], span: 40, speed: [1.6, 2.4], count: [14, 20] },
  bats: { near: [1.5, 7], height: [3, 7], span: 20, speed: [2.4, 3.4], count: [3, 7] },
  airliner: { near: [50, 75], height: [26, 38], span: 110, speed: [7, 10], count: [1, 1] },
  prop: { near: [25, 45], height: [12, 20], span: 80, speed: [5, 7], count: [1, 1] },
  jet: { near: [45, 70], height: [24, 36], span: 120, speed: [13, 17], count: [1, 1] },
  ufo: { near: [50, 75], height: [26, 38], span: 110, speed: [4, 6], count: [1, 1] },
  balloon: { near: [30, 50], height: [16, 26], span: 110, speed: [1.7, 2.5], count: [1, 1] },
  helicopter: { near: [18, 40], height: [9, 16], span: 70, speed: [3, 4.5], count: [1, 1] },
  blimp: { near: [35, 55], height: [16, 24], span: 90, speed: [1.4, 2], count: [1, 1] },
  kite: { near: [11, 17], height: [7, 11], span: 1.5, speed: [0.04, 0.06], count: [1, 1] },
  satellite: { near: [20, 70], height: [70, 95], span: 150, speed: [10, 13], count: [1, 1] },
  rocket: { near: [70, 95], height: [1, 3], span: 0, speed: [9, 13], count: [1, 1] },
  comet: { near: [20, 70], height: [45, 70], span: 60, speed: [45, 60], count: [1, 1] },
};

export const SKY_AT_ONCE = 2;
const FOUL = new Set(["rain", "snow"]);
const fitsNow = (each: SkyTraffic, now: SkyNow): boolean =>
  (each.when === undefined || (each.when === "night") === (now.night === true))
  && (each.fair !== true || !FOUL.has(now.weather ?? ""))
  && (each.seasons === undefined || each.seasons.some((season) => season === now.season));

/** What passes next, chosen from what fits the sky right now (null when nothing does). */
export function nextTraffic(rand: () => number, plan: SkyPlan, now: SkyNow): SkyKind | null {
  const roll = rand();
  const fitting = plan.traffic.filter((each) => fitsNow(each, now));
  // Birds keep low and few in rain and snow.
  const weights = fitting.map((each) => each.weight * (FOUL.has(now.weather ?? "") && BIRD_KINDS.has(each.kind) ? 0.3 : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let left = roll * total;
  for (const [i, each] of fitting.entries()) {
    left -= weights[i] ?? 0;
    if (left < 0) return each.kind;
  }
  return null;
}
const BIRD_KINDS: ReadonlySet<SkyKind> = new Set<SkyKind>(["flock", "vee", "murmuration", "bats"]);

function routeOf(kind: SkyKind, rand: () => number, reach: number): { from: Vec; to: Vec } {
  const route = ROUTES[kind];
  const near: [number, number] = [route.near[0] * reach, route.near[1] * reach];
  if (kind === "rocket") {
    // A rocket climbs from far off on the horizon, straight up and leaning over.
    const heading = rand() * TAU;
    const d = between(rand, near);
    const from: Vec = [Math.sin(heading) * d, between(rand, route.height), Math.cos(heading) * d];
    return { from, to: add(from, [Math.sin(heading) * 20, 140, Math.cos(heading) * 20]) };
  }
  const { from, to } = chord(rand, near, route.height, route.span * reach);
  // A shooting star falls as it crosses.
  return kind === "comet" ? { from: add(from, [0, 14, 0]), to: add(to, [0, -14, 0]) } : { from, to };
}

/** How long traffic takes to come out of the sky and go back into it, at most: a quarter of a short pass. */
const SKY_FADE = 3;

/** How much of a pass is there at `t`: none at either end, whole between. */
export function skyFade(start: number, end: number, t: number): number {
  const span = Math.min(SKY_FADE, (end - start) * 0.25);
  return smooth(clamp(Math.min(t - start, end - t) / Math.max(1e-6, span), 0, 1));
}

export const fading = (bodies: readonly Body[], pass: Pass, t: number): Body[] => {
  const fade = skyFade(pass.start, pass.end, t);
  return bodies.map((body) => ({ ...body, fade }));
};

export function passOf(
  kind: SkyKind,
  start: number,
  rand: () => number,
  over: { readonly reach: number; readonly plan: SkyPlan },
): Pass {
  const { reach, plan } = over;
  const route = ROUTES[kind];
  const { from, to } = routeOf(kind, rand, reach);
  const crane = kind === "flock" && plan.birds === "crane";
  const count = crane ? intBetween(rand, 3, 7) : intBetween(rand, route.count[0], route.count[1]);
  const v = kind === "vee" || (kind === "flock" && count >= 5 && rand() < 0.4);
  return {
    kind,
    start,
    end: start + Math.max(1.2, length(sub(to, from)) / between(rand, route.speed)),
    from,
    to,
    count,
    v,
    seed: Math.floor(rand() * 1e6),
  };
}

/** (A cruise with no start or end in sight: no launch, no landing, just its own flaps and glides.) */
export const FLY_SEGMENT: Segment = { act: "fly", t0: -1e6, t1: 1e6, from: { on: "ground", x: 0, z: 0 }, to: { on: "ground", x: 0, z: 0 }, yaw: 0, face: -1, mode: "fly", pace: 4 };

/** Where a bird of the sky is and which way it points, and its up when banked. */
interface Aloft { readonly p: Vec; readonly dir: Vec; readonly up?: Vec }

/** How much a thing in the sky glows: a comet or a satellite outright, a UFO or a jet by its lights. */
function glowOf(kind: PlaneKind): number {
  if (kind === "ufo" || kind === "jet") return 0.6;
  return kind === "comet" || kind === "satellite" ? 1 : 0;
}

function flyingBird(id: string, who: Who, t: number, aloft: Aloft): Body {
  const { p, dir, up = UP } = aloft;
  const m: Moment = { frame: frameOf(p, dir, up), phase: 0, moving: 1, pace: 4, mode: "fly", segment: FLY_SEGMENT, pose: { ...restPose(), wing: 1 }, t };
  return bodyOf(id, who, m, { capsules: poseWho(who, m) });
}

/**
 * A flock crossing the sky on a long seeded curve, banked into it, each bird
 * keeping its place in the loose bunch or the vee and its own wingbeat.
 */
export function flockBodies(pass: Pass, who: Who, t: number): Body[] {
  const u = (t - pass.start) / (pass.end - pass.start);
  const line = sub(pass.to, pass.from);
  const span = Math.max(1e-3, length(line));
  const side = unit(cross(UP, line));
  const bow = ((pass.seed % 997) / 997 - 0.5) * 0.3 * span;
  const headingAt = (k: number): Vec => unit(madd(line, side, bow * Math.PI * Math.cos(Math.PI * k)));
  const dir = headingAt(u);
  const up = bankedUp(
    headingAt(u - 0.02),
    headingAt(u + 0.02),
    span * 0.04,
    span / Math.max(0.01, pass.end - pass.start),
  );
  const middle = madd(lerpV(pass.from, pass.to, u), side, bow * Math.sin(Math.PI * clamp(u, 0, 1)));
  const across = unit(cross(UP, dir));
  const out: Body[] = [];
  for (let i = 0; i < pass.count; i += 1) {
    const rank = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
    const spread = pass.v
      ? [rank * 0.9, -Math.abs(rank) * 1.1]
      : [Math.sin(i * 2.4 + pass.seed) * 2.2, Math.cos(i * 1.7 + pass.seed) * 2.4];
    const bobbing = Math.sin(t * 1.3 + i * 1.1) * 0.25;
    const p = add(madd(madd(middle, across, spread[0] ?? 0), dir, spread[1] ?? 0), [
      0,
      bobbing + (pass.v ? 0 : Math.sin(i * 3.3) * 0.8),
      0,
    ]);
    // (Down a vee each bird beats a little after the one ahead, a wave along the line.)
    out.push(flyingBird(`flock.${String(pass.seed)}.${String(i)}`, who, t + (pass.v ? Math.abs(rank) * 0.22 : i * 0.37), { p, dir, up }));
  }
  return out;
}

/**
 * A swarm that wheels as it goes: each one weaves on its own slow loops about
 * the moving middle, the whole cloud breathing in and out, and faces the way
 * it is moving. A murmuration is wide and smooth; bats flit, tight and quick.
 */
function swarmAt(pass: Pass, i: number, t: number, bats: boolean): Vec {
  const u = (t - pass.start) / (pass.end - pass.start);
  const k = i * 1.618 + (pass.seed % 97);
  const breath = 1 + 0.45 * Math.sin(t * 0.37 + pass.seed);
  const wide = bats ? 1.1 : 3.2 * breath;
  const quick = bats ? 3 : 0.8;
  const off: Vec = [
    (Math.sin(t * quick * 1.1 + k * 2.1) + 0.6 * Math.sin(t * quick * 0.43 + k)) * wide,
    (Math.sin(t * quick * 1.3 + k * 1.3) * 0.5 + 0.4 * Math.sin(t * 0.21 + k * 0.7)) * wide * 0.5,
    (Math.cos(t * quick * 0.9 + k * 1.7) + 0.6 * Math.cos(t * quick * 0.51 + k * 0.4)) * wide,
  ];
  return add(lerpV(pass.from, pass.to, clamp(u, 0, 1)), off);
}

export function swarmBodies(pass: Pass, who: Who | null, t: number): Body[] {
  const bats = pass.kind === "bats";
  const out: Body[] = [];
  for (let i = 0; i < pass.count; i += 1) {
    const p = swarmAt(pass, i, t, bats);
    const dir = unit(sub(swarmAt(pass, i, t + 0.05, bats), p), [0, 0, 1]);
    const id = `${pass.kind}.${String(pass.seed)}.${String(i)}`;
    if (bats || !who) out.push(batBody(id, p, dir, t + i * 0.21));
    else out.push(flyingBird(id, who, t + i * 0.29, { p, dir }));
  }
  return out;
}

const BAT_LOOK: Palette = { coat: "#3a2e34", alt: "#2a2026", belly: "#4a3a40", dark: "#1a1216", eye: "#ffd27a", nose: "#2a1a1e", accent: "#5a4048", glow: "#ffd27a", horn: "#2a2026", shell: "#2a2026" };

/** A bat: a small furred body, big ears, and membranes that beat fast and fold. */
function batBody(id: string, p: Vec, dir: Vec, t: number): Body {
  const size = 0.22;
  const kit: Kit = { f: frameOf(p, dir), out: [], roll: 0, pivot: [0, 0, 0] };
  ball(kit, "body", "coat", { p: [0, 0, 0], r: size * 0.22, flat: 0.85 });
  ball(kit, "head", "coat", { p: [0, size * 0.04, size * 0.22], r: size * 0.14 });
  for (const x of [-1, 1]) {
    cap(kit, "ear", "dark", { a: [x * size * 0.06, size * 0.12, size * 0.24], b: [x * size * 0.09, size * 0.26, size * 0.2], r: size * 0.04, flat: 0.4, up: [0, 0, 1] });
    const beat = Math.sin(t * 15 + (x > 0 ? 0 : 0.2));
    const tip: Vec = [x * size * 0.95, beat * size * 0.5, -size * 0.05];
    const elbow: Vec = [x * size * 0.45, beat * size * 0.3 + size * 0.08, size * 0.1];
    cap(kit, "wing", "alt", { a: [x * size * 0.1, 0, size * 0.05], b: elbow, r: size * 0.16, flat: 0.12 });
    cap(kit, "wing", "alt", { a: elbow, b: tip, r: size * 0.14, flat: 0.12 });
  }
  return { id, kind: "bat", label: "Bat", action: "fly", morph: "normal", at: p, front: dir, capsules: kit.out, palette: BAT_LOOK, glow: 0 };
}

const PLANE_LOOKS: Readonly<Record<PlaneKind, Palette>> = {
  airliner: { coat: "#f4f6f8", alt: "#c8d0d8", belly: "#e8ecf0", dark: "#3a4250", eye: "#1a2230", nose: "#3a4250", accent: "#2a5ad0", glow: "#ff4a3a", horn: "#9aa4ae", shell: "#c8d0d8" },
  prop: { coat: "#f0d040", alt: "#d83a2a", belly: "#f8f0d0", dark: "#2a2a2a", eye: "#1a1a1a", nose: "#2a2a2a", accent: "#f4f0e8", glow: "#ff4a3a", horn: "#8a7a5a", shell: "#d83a2a" },
  jet: { coat: "#1a1a2a", alt: "#ff3ad8", belly: "#2a2a3a", dark: "#0a0a14", eye: "#0a0a14", nose: "#0a0a14", accent: "#3af0ff", glow: "#f4f8ff", horn: "#3af0ff", shell: "#ff3ad8" },
  ufo: { coat: "#c8ccd8", alt: "#8a90a0", belly: "#5a6070", dark: "#2a2e38", eye: "#1a1e28", nose: "#2a2e38", accent: "#7affc8", glow: "#9ff4ff", horn: "#f0f4ff", shell: "#8a90a0" },
  balloon: { coat: "#e83a3a", alt: "#f0d040", belly: "#3a6ad0", dark: "#6a4a2a", eye: "#2a1a10", nose: "#6a4a2a", accent: "#ffffff", glow: "#ffb050", horn: "#6a4a2a", shell: "#f0d040" },
  helicopter: { coat: "#d83a2a", alt: "#f4f0e8", belly: "#2a2a2a", dark: "#22262c", eye: "#1a1a1a", nose: "#22262c", accent: "#9fd8ff", glow: "#ff4a3a", horn: "#8a8a8a", shell: "#f4f0e8" },
  blimp: { coat: "#d8dce4", alt: "#2a5ad0", belly: "#f0f2f6", dark: "#3a4250", eye: "#1a2230", nose: "#3a4250", accent: "#f0c040", glow: "#ff4a3a", horn: "#9aa4ae", shell: "#2a5ad0" },
  kite: { coat: "#ff4a6a", alt: "#ffd040", belly: "#40c8ff", dark: "#f4f0e8", eye: "#1a1a1a", nose: "#2a2a2a", accent: "#40c8ff", glow: "#ffd040", horn: "#f4f0e8", shell: "#ffd040" },
  satellite: { coat: "#d8d0b0", alt: "#2a4a9a", belly: "#c8c0a0", dark: "#3a3a3a", eye: "#1a1a1a", nose: "#3a3a3a", accent: "#4a7ad8", glow: "#fffbe8", horn: "#9a9a9a", shell: "#2a4a9a" },
  rocket: { coat: "#f4f4f4", alt: "#2a2a2a", belly: "#e8e8e8", dark: "#2a2a2a", eye: "#1a1a1a", nose: "#d83a2a", accent: "#d83a2a", glow: "#ffb040", horn: "#c8c8c8", shell: "#f0f0f0" },
  comet: { coat: "#fff8e0", alt: "#c8e8ff", belly: "#fff8e0", dark: "#fff8e0", eye: "#fff8e0", nose: "#fff8e0", accent: "#c8e8ff", glow: "#fffbe8", horn: "#fff8e0", shell: "#fff8e0" },
};

/** A red light that blinks: on aircraft by day and night. */
function beacon(kit: Kit, at: Vec, r: number, t: number): void {
  if (Math.sin(t * 5.2) > 0.6) ball(kit, "beacon", "glow", { p: at, r });
}

function airliner(kit: Kit, size: number, prop: boolean, t: number): void {
  const L = size;
  cap(kit, "fuselage", "coat", { a: [0, 0, -L * 0.5], b: [0, 0, L * 0.5], r: L * 0.07 });
  for (const x of [-1, 1]) {
    cap(kit, "wing", "alt", { a: [0, -L * 0.02, L * 0.02], b: [x * L * 0.5, -L * 0.02, -L * 0.12], r: L * 0.06, flat: 0.18 });
    cap(kit, "tailplane", "alt", { a: [0, 0, -L * 0.45], b: [x * L * 0.18, 0, -L * 0.52], r: L * 0.03, flat: 0.2 });
    ball(kit, "light", "glow", { p: [x * L * 0.5, -L * 0.02, -L * 0.12], r: L * 0.025 });
    if (!prop) ball(kit, "engine", "dark", { p: [x * L * 0.18, -L * 0.07, L * 0.06], r: L * 0.04 });
  }
  cap(kit, "fin", "accent", { a: [0, 0, -L * 0.4], b: [0, L * 0.18, -L * 0.52], r: L * 0.04, flat: 0.2, up: [1, 0, 0] });
  if (prop) ball(kit, "propeller", "dark", { p: [0, 0, L * 0.53], r: L * 0.09, flat: 0.08, up: [0, 0, 1] });
  beacon(kit, [0, L * 0.09, 0], L * 0.03, t);
  beacon(kit, [0, -L * 0.08, 0.1 * L], L * 0.03, t + 0.5);
}

function banner(kit: Kit, size: number, t: number): void {
  cap(kit, "rope", "dark", { a: [0, 0, -size * 0.5], b: [0, -size * 0.05, -size * 0.9], r: size * 0.006 });
  for (let i = 0; i < 5; i += 1) {
    const wave = Math.sin(t * 6 - i) * size * 0.03;
    cap(kit, "banner", i % 2 === 0 ? "accent" : "alt", { a: [wave, -size * 0.05, -size * (0.92 + i * 0.22)], b: [wave, -size * 0.05, -size * (1.12 + i * 0.22)], r: size * 0.09, flat: 0.08, up: [1, 0, 0] });
  }
}

function saucer(kit: Kit, size: number, t: number): void {
  ball(kit, "disc", "coat", { p: [0, 0, 0], r: size * 0.5, flat: 0.22 });
  ball(kit, "rim", "alt", { p: [0, -size * 0.04, 0], r: size * 0.56, flat: 0.08 });
  ball(kit, "dome", "glow", { p: [0, size * 0.12, 0], r: size * 0.2, flat: 0.8 });
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + t * 1.5;
    if (Math.sin(t * 5 + i) > -0.2) ball(kit, "light", "accent", { p: [Math.cos(a) * size * 0.52, -size * 0.04, Math.sin(a) * size * 0.52], r: size * 0.04 });
  }
}

function balloonShape(kit: Kit, size: number): void {
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    cap(kit, "gore", i % 2 === 0 ? "coat" : "alt", { a: [Math.cos(a) * size * 0.2, size * 0.75, Math.sin(a) * size * 0.2], b: [Math.cos(a) * size * 0.14, size * 0.25, Math.sin(a) * size * 0.14], r: size * 0.27 });
  }
  ball(kit, "envelope", "belly", { p: [0, size * 0.55, 0], r: size * 0.4 });
  for (const x of [-1, 1]) cap(kit, "rope", "dark", { a: [x * size * 0.12, size * 0.12, 0], b: [x * size * 0.06, -size * 0.22, 0], r: size * 0.006 });
  ball(kit, "basket", "dark", { p: [0, -size * 0.27, 0], r: size * 0.07, flat: 0.8 });
  ball(kit, "flame", "glow", { p: [0, -size * 0.1, 0], r: size * 0.04 });
}

function helicopter(kit: Kit, size: number, t: number): void {
  ball(kit, "cabin", "coat", { p: [0, 0, size * 0.1], r: size * 0.22, flat: 0.9 });
  ball(kit, "window", "accent", { p: [0, size * 0.05, size * 0.22], r: size * 0.13, flat: 0.7 });
  cap(kit, "boom", "coat", { a: [0, size * 0.03, -size * 0.08], b: [0, size * 0.09, -size * 0.66], r: size * 0.05 });
  cap(kit, "fin", "alt", { a: [0, size * 0.08, -size * 0.62], b: [0, size * 0.24, -size * 0.7], r: size * 0.04, flat: 0.25, up: [1, 0, 0] });
  cap(kit, "mast", "dark", { a: [0, size * 0.18, size * 0.06], b: [0, size * 0.28, size * 0.06], r: size * 0.025 });
  for (let blade = 0; blade < 2; blade += 1) {
    const a = t * 31 + blade * (Math.PI / 2);
    const d: Vec = [Math.cos(a) * size * 0.68, 0, Math.sin(a) * size * 0.68];
    cap(kit, "blade", "dark", { a: add([0, size * 0.29, size * 0.06], d), b: sub([0, size * 0.29, size * 0.06], d), r: size * 0.022, flat: 0.3 });
  }
  const tail = t * 40;
  cap(kit, "tail-rotor", "dark", { a: [size * 0.03, size * 0.09 + Math.cos(tail) * size * 0.1, -size * 0.66 + Math.sin(tail) * size * 0.1], b: [size * 0.03, size * 0.09 - Math.cos(tail) * size * 0.1, -size * 0.66 - Math.sin(tail) * size * 0.1], r: size * 0.012 });
  for (const x of [-1, 1]) cap(kit, "skid", "dark", { a: [x * size * 0.14, -size * 0.25, -size * 0.12], b: [x * size * 0.14, -size * 0.25, size * 0.26], r: size * 0.016 });
  beacon(kit, [0, -size * 0.2, 0], size * 0.03, t);
}

function blimp(kit: Kit, size: number, t: number): void {
  cap(kit, "envelope", "coat", { a: [0, 0, -size * 0.3], b: [0, 0, size * 0.3], r: size * 0.18 });
  cap(kit, "band", "alt", { a: [0, 0, -size * 0.04], b: [0, 0, size * 0.04], r: size * 0.185 });
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    cap(kit, "fin", "alt", { a: [x * size * 0.08, y * size * 0.08, -size * 0.38], b: [x * size * 0.2, y * size * 0.2, -size * 0.47], r: size * 0.05, flat: 0.2, up: x === 0 ? [1, 0, 0] : UP });
  }
  ball(kit, "gondola", "dark", { p: [0, -size * 0.2, size * 0.05], r: size * 0.06, flat: 0.7 });
  for (let i = 0; i < 3; i += 1) ball(kit, "window", "glow", { p: [size * 0.04, -size * 0.2, size * (i * 0.04 - 0.01)], r: size * 0.012 });
  beacon(kit, [0, size * 0.19, 0], size * 0.015, t);
}

function kiteShape(kit: Kit, size: number, t: number): void {
  // Faces the way it looks; a diamond of two crossed sails, bows down its tail, and the long line down to the ground.
  cap(kit, "sail", "coat", { a: [0, -size * 0.55, 0], b: [0, size * 0.45, 0], r: size * 0.26, flat: 0.08, up: [0, 0, 1] });
  cap(kit, "sail", "alt", { a: [-size * 0.32, size * 0.12, 0.01], b: [size * 0.32, size * 0.12, 0.01], r: size * 0.18, flat: 0.08, up: [0, 0, 1] });
  for (let i = 0; i < 6; i += 1) ball(kit, "bow", i % 2 === 0 ? "accent" : "alt", { p: [Math.sin(t * 3.4 - i * 0.8) * size * 0.12, -size * (0.7 + i * 0.22), -size * 0.05 * i], r: size * 0.05, flat: 0.4, up: [0, 0, 1] });
  cap(kit, "line", "dark", { a: [0, -size * 0.45, 0], b: [0, -9, -7], r: 0.008 });
}

function satellite(kit: Kit, size: number, t: number): void {
  // Far off it is a steady point of light, now and then flaring as its panels catch the sun.
  const flare = Math.max(0, Math.sin(t * 0.7) - 0.9) * 10;
  ball(kit, "light", "glow", { p: [0, 0, 0], r: size * (0.3 + flare * 0.5) });
  for (const x of [-1, 1]) cap(kit, "panel", "alt", { a: [x * size * 0.3, 0, 0], b: [x * size * 0.9, 0, 0], r: size * 0.16, flat: 0.1, up: [0, 0, 1] });
}

function rocket(kit: Kit, size: number, t: number): void {
  cap(kit, "hull", "coat", { a: [0, 0, -size * 0.35], b: [0, 0, size * 0.3], r: size * 0.09 });
  ball(kit, "nose", "accent", { p: [0, 0, size * 0.38], r: size * 0.08, flat: 0.9 });
  for (const a of [0, 2.1, 4.2]) cap(kit, "fin", "alt", { a: [0, 0, -size * 0.25], b: [Math.cos(a) * size * 0.18, Math.sin(a) * size * 0.18, -size * 0.4], r: size * 0.03, flat: 0.25 });
  ball(kit, "flame", "glow", { p: [0, 0, -size * (0.48 + 0.04 * Math.sin(t * 40))], r: size * 0.1, flat: 0.7 });
  for (let i = 1; i <= 9; i += 1) ball(kit, "smoke", "belly", { p: [Math.sin(t * 2 + i) * size * 0.04 * i, 0, -size * (0.55 + i * 0.4)], r: size * (0.08 + i * 0.03), flat: 0.9 });
}

function comet(kit: Kit, size: number): void {
  // A bright head and a tail of light streaming back along its path.
  ball(kit, "head", "glow", { p: [0, 0, 0], r: size * 0.22 });
  for (let i = 1; i <= 10; i += 1) ball(kit, "tail", "glow", { p: [0, 0, -size * i * 0.6], r: size * 0.2 * (1 - i / 12) });
}

const PLANE_SIZE: Readonly<Record<PlaneKind, number>> = {
  airliner: 3.4,
  prop: 1.6,
  jet: 2.4,
  ufo: 2.6,
  balloon: 3,
  helicopter: 1.8,
  blimp: 7,
  kite: 0.9,
  satellite: 1.4,
  rocket: 4,
  comet: 2.2,
};

const PLANE_SHAPES: Readonly<Record<PlaneKind, (kit: Kit, size: number, t: number) => void>> = {
  airliner: (kit, size, t) => { airliner(kit, size, false, t); },
  prop: (kit, size, t) => { airliner(kit, size, true, t);
  banner(kit, size, t); },
  jet: (kit, size, t) => {
    airliner(kit, size, false, t);
    for (let i = 1; i <= 10; i += 1) ball(kit, "contrail", "glow", { p: [0, 0, -size * (0.5 + i * 0.45)], r: size * (0.03 + i * 0.012), flat: 0.9 });
  },
  ufo: saucer,
  balloon: (kit, size) => { balloonShape(kit, size); },
  helicopter,
  blimp,
  kite: kiteShape,
  satellite,
  rocket,
  comet: (kit, size) => { comet(kit, size); },
};
const PLANE_DRIFT: Partial<Record<PlaneKind, (t: number) => Vec>> = {
  ufo: (t) => [Math.sin(t * 0.7) * 3, Math.sin(t * 1.9) * 1.2, 0],
  balloon: (t) => [0, Math.sin(t * 0.2) * 0.8, 0],
  helicopter: (t) => [0, Math.sin(t * 0.9) * 0.3, 0],
  kite: (t) => [Math.sin(t * 0.6) * 1.4 + Math.sin(t * 1.7) * 0.3, Math.sin(t * 1.1) * 0.5, 0],
};
const PLANE_LABELS: Readonly<Record<PlaneKind, string>> = {
  airliner: "Airliner", prop: "Banner plane", jet: "Jet", ufo: "Saucer", balloon: "Hot-air balloon", helicopter: "Helicopter",
  blimp: "Blimp", kite: "Kite", satellite: "Satellite", rocket: "Rocket", comet: "Shooting star",
};

export function planeBody(kind: PlaneKind, pass: Pass, t: number): Body {
  const u = (t - pass.start) / (pass.end - pass.start);
  const route = unit(sub(pass.to, pass.from));
  // A kite faces back down its line toward whoever flies it.
  const dir: Vec = kind === "kite" ? unit([-pass.from[0], 0, -pass.from[2]], [0, 0, 1]) : route;
  const p = add(lerpV(pass.from, pass.to, kind === "ufo" ? smooth(u) * 0.6 + u * 0.4 : u), PLANE_DRIFT[kind]?.(t) ?? [0, 0, 0]);
  const kit: Kit = { f: frameOf(p, dir), out: [], roll: 0, pivot: [0, 0, 0] };
  PLANE_SHAPES[kind](kit, PLANE_SIZE[kind], t);
  return { id: `${kind}.${String(pass.seed)}`, kind, label: PLANE_LABELS[kind], action: "fly", morph: "normal", at: p, front: dir, capsules: kit.out, palette: PLANE_LOOKS[kind], glow: glowOf(kind) };
}
