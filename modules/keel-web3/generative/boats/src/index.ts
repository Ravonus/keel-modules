/**
 * A fleet as a function: boats that sail, swing at anchor or sit on the sand,
 * floating on whatever sea they are given. Deterministic and renderer-free. MIT.
 *
 *   const fleet = createFleet({ seed, sea, center: [0, -40], count: 6 });
 *   fleet.at(t, level) -> where each boat is and how the water has tipped it
 *   hullOf("sloop")    -> the boat as plain coloured triangles
 *
 * Nothing is simulated. A boat's place is a function of time, and it floats by
 * asking the sea how high the water stands at its bow, stern and sides, so a
 * long hull rides over short waves and a dinghy feels every one. A beached boat
 * sits on the ground until the tide comes in under it. Frame: +y up, the hull's
 * bow toward +z and its waterline at y = 0, metres and seconds.
 */

export type Vec3 = readonly [number, number, number];
export type HullKind = "dinghy" | "fishing" | "sloop";
export type Errand = "sailing" | "anchored" | "beached";

const TAU = Math.PI * 2;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** mulberry32: a seed's stream of numbers in [0, 1). */
function streamOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How big each hull is, in metres, and how fast it goes in metres per second. */
export interface HullFacts {
  readonly length: number;
  readonly beam: number;
  readonly draft: number;
  readonly freeboard: number;
  readonly speed: number;
}

export const HULLS: Readonly<Record<HullKind, HullFacts>> = {
  dinghy: { length: 3.6, beam: 1.4, draft: 0.22, freeboard: 0.42, speed: 1.6 },
  fishing: { length: 9, beam: 3.1, draft: 0.9, freeboard: 0.95, speed: 3.4 },
  sloop: { length: 11, beam: 3.2, draft: 1.5, freeboard: 0.85, speed: 2.8 },
};

/** The part of `generative/ocean`'s Sea a fleet reads. */
export interface FleetSea {
  surfaceAt(x: number, z: number, t: number, level?: number): { readonly height: number };
  seabedAt(x: number, z: number): number;
}

export interface FleetInput {
  readonly seed?: number;
  readonly sea: FleetSea;
  /** Where the fleet keeps to, x then z. */
  readonly center?: readonly [number, number];
  /** How far from there boats may lie, metres. */
  readonly radius?: number;
  /** How many boats are on the water. */
  readonly count?: number;
  /** Where boats are pulled up on the sand, x then z. */
  readonly beached?: readonly (readonly [number, number])[];
}

interface Route {
  readonly kind: HullKind;
  readonly errand: Errand;
  readonly x: number;
  readonly z: number;
  /** Across a sailing boat's circle, or how far an anchored one swings on its line. */
  readonly reach: number;
  readonly phase: number;
  /** Which way it goes round: 1 or -1. */
  readonly turn: number;
}

/** One boat's plan, for a renderer to know what to draw. */
export interface Boat {
  readonly index: number;
  readonly kind: HullKind;
  readonly errand: Errand;
}

/** One boat at one moment. */
export interface BoatPose extends Boat {
  /** Where its waterline's middle is. */
  readonly at: Vec3;
  /** Toward the bow, up through the deck, and across to the +x side: the hull's own axes. */
  readonly front: Vec3;
  readonly up: Vec3;
  readonly side: Vec3;
  /** Metres per second over the water. */
  readonly speed: number;
  /** Whether the water is carrying it. */
  readonly afloat: boolean;
}

export interface Fleet {
  readonly boats: readonly Boat[];
  /** Every boat at t, with the tide at `level`. */
  at(t: number, level?: number): BoatPose[];
}

/** Whether a boat this deep can go right round a circle. */
function clearRound(sea: FleetSea, x: number, z: number, radius: number, draft: number): boolean {
  for (let step = 0; step < 18; step += 1) {
    const angle = (step / 18) * TAU;
    if (sea.seabedAt(x + Math.sin(angle) * radius, z + Math.cos(angle) * radius) > -draft - 2.5) return false;
  }
  return true;
}

/** A plan for one boat on the water: it sails if it has room, and otherwise anchors where it is deep enough. */
function routeOn(input: FleetInput, random: () => number): Route {
  const kind = (["dinghy", "fishing", "sloop", "sloop", "fishing"] as const)[Math.floor(random() * 5)] ?? "sloop";
  const [cx, cz] = input.center ?? [0, 0];
  const radius = input.radius ?? 120;
  const { draft } = HULLS[kind];
  const phase = random() * TAU;
  const turn = random() < 0.5 ? -1 : 1;
  const sailing = random() < 0.55;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const [angle, out] = [random() * TAU, Math.sqrt(random()) * radius];
    const [x, z] = [cx + Math.sin(angle) * out, cz + Math.cos(angle) * out];
    const reach = 30 + random() * 40;
    if (sailing && clearRound(input.sea, x, z, reach, draft)) return { kind, errand: "sailing", x, z, reach, phase, turn };
    if (!sailing && input.sea.seabedAt(x, z) < -draft - 1.5) return { kind, errand: "anchored", x, z, reach: 1.5 + random() * 2, phase, turn };
  }
  return { kind, errand: "anchored", x: cx, z: cz, reach: 1.5, phase, turn };
}

function routesOf(input: FleetInput, seed: number): Route[] {
  const random = streamOf(seed);
  const afloat = Array.from({ length: input.count ?? 5 }, () => routeOn(input, random));
  const ashore = (input.beached ?? []).map(([x, z]): Route => ({ kind: "dinghy", errand: "beached", x, z, reach: 0, phase: random() * TAU, turn: 1 }));
  return [...afloat, ...ashore];
}

/** Where a boat is and which way it points: `heading` runs from +z toward +x. */
function placeAt(route: Route, t: number): { x: number; z: number; heading: number; speed: number } {
  if (route.errand === "sailing") {
    const speed = HULLS[route.kind].speed;
    const angle = route.phase + (route.turn * speed * t) / route.reach;
    return { x: route.x + Math.sin(angle) * route.reach, z: route.z + Math.cos(angle) * route.reach, heading: angle + (route.turn * Math.PI) / 2, speed };
  }
  if (route.errand === "anchored") {
    const swing = Math.sin(t * 0.05 + route.phase) * 0.9;
    return { x: route.x + Math.sin(swing) * route.reach, z: route.z + Math.cos(swing) * route.reach, heading: route.phase + swing, speed: 0 };
  }
  return { x: route.x, z: route.z, heading: route.phase, speed: 0 };
}

/**
 * How a hull lies across four heights.
 *
 * @param span Metres from bow to stern, and from side to side.
 * @param heading Radians from +z toward +x.
 * @param rise How far the bow stands over the stern, and the +x side over the other.
 * @returns The hull's axes.
 */
export function axesOf(span: readonly [number, number], heading: number, rise: readonly [number, number]): Pick<BoatPose, "front" | "up" | "side"> {
  const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
  const front = unit([fx * span[0], rise[0], fz * span[0]]);
  const up = unit(cross(front, unit([fz * span[1], rise[1], -fx * span[1]])));
  return { front, up, side: cross(up, front) };
}

/** A boat's height and tilt on one kind of surface, sampled at bow, stern and sides. */
function layOn(height: (x: number, z: number) => number, x: number, z: number, heading: number, facts: HullFacts): { y: number; pitch: number; roll: number } {
  const [fx, fz] = [Math.sin(heading) * facts.length * 0.4, Math.cos(heading) * facts.length * 0.4];
  const [sx, sz] = [Math.cos(heading) * facts.beam * 0.45, -Math.sin(heading) * facts.beam * 0.45];
  const [bow, stern, port, other] = [height(x + fx, z + fz), height(x - fx, z - fz), height(x + sx, z + sz), height(x - sx, z - sz)];
  return { y: (bow + stern + port + other) / 4, pitch: bow - stern, roll: port - other };
}

function poseOf(sea: FleetSea, route: Route, index: number, t: number, level: number): BoatPose {
  const facts = HULLS[route.kind];
  const place = placeAt(route, t);
  const { x, z } = place;
  const water = layOn((px, pz) => sea.surfaceAt(px, pz, t, level).height, x, z, place.heading, facts);
  const ground = layOn((px, pz) => sea.seabedAt(px, pz) + facts.draft, x, z, place.heading, facts);
  // Afloat once the water stands over the place it rests: until then it sits on the keel, leaning a little.
  const carried = clamp((water.y - ground.y) / 0.15 + 1, 0, 1);
  const lean = (1 - carried) * facts.beam * 0.16;
  const axes = axesOf([facts.length * 0.8, facts.beam * 0.9], place.heading, [mix(ground.pitch, water.pitch, carried), mix(ground.roll, water.roll, carried) + lean]);
  return { index, kind: route.kind, errand: route.errand, at: [x, mix(ground.y, water.y, carried), z], ...axes, speed: place.speed, afloat: carried >= 1 };
}

/**
 * Puts a fleet on a sea.
 *
 * @param input The seed, the sea, and where the boats keep to.
 * @returns A fleet whose every answer is a pure function of its input and the sea.
 */
export function createFleet(input: FleetInput): Fleet {
  const routes = routesOf(input, (input.seed ?? 1) >>> 0);
  return {
    boats: routes.map((route, index) => ({ index, kind: route.kind, errand: route.errand })),
    at: (t, level = 0) => routes.map((route, index) => poseOf(input.sea, route, index, t, level)),
  };
}

// ---------------------------------------------------------------- the hulls

/** A boat as triangles: three corners, then one colour, each linear RGB, per corner. */
export interface HullMesh {
  readonly positions: number[];
  readonly colors: number[];
}

const PAINTS: Readonly<Record<HullKind, Vec3>> = { dinghy: [0.72, 0.2, 0.08], fishing: [0.05, 0.2, 0.34], sloop: [0.82, 0.82, 0.8] };
const BOTTOM: Vec3 = [0.3, 0.06, 0.05];
const STRIPE: Vec3 = [0.86, 0.86, 0.82];
const DECK: Vec3 = [0.52, 0.38, 0.22];
const SAIL: Vec3 = [0.9, 0.87, 0.78];
const SPAR: Vec3 = [0.16, 0.13, 0.11];

function triangle(mesh: HullMesh, a: Vec3, b: Vec3, c: Vec3, color: Vec3): void {
  mesh.positions.push(...a, ...b, ...c);
  mesh.colors.push(...color, ...color, ...color);
}

function quad(mesh: HullMesh, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3): void {
  triangle(mesh, a, b, c, color);
  triangle(mesh, a, c, d, color);
}

/** A box from `low` to `high`. */
function box(mesh: HullMesh, low: Vec3, high: Vec3, color: Vec3): void {
  const corner = (x: number, y: number, z: number): Vec3 => [x === 0 ? low[0] : high[0], y === 0 ? low[1] : high[1], z === 0 ? low[2] : high[2]];
  quad(mesh, corner(0, 1, 0), corner(0, 1, 1), corner(1, 1, 1), corner(1, 1, 0), color);
  quad(mesh, corner(0, 0, 1), corner(0, 1, 1), corner(0, 1, 0), corner(0, 0, 0), color);
  quad(mesh, corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1), color);
  quad(mesh, corner(0, 0, 0), corner(0, 1, 0), corner(1, 1, 0), corner(1, 0, 0), color);
  quad(mesh, corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1), corner(0, 0, 1), color);
}

/** How wide a hull is along its length, from 0 at the stern to 1 at the bow, as a share of its beam: a transom, a full middle and a fine bow. */
export function widthAlong(s: number): number {
  const shoulder = 0.74 + 0.26 * Math.sin(Math.min(s / 0.4, 1) * (Math.PI / 2));
  return (shoulder * Math.sqrt(Math.max(0, 1 - (Math.max(s - 0.4, 0) / 0.6) ** 2))) / 2;
}

/** One cross-section's corners from the sheer down one side to the keel: x is the side it is on. */
function sectionAt(facts: HullFacts, s: number, side: number): Vec3[] {
  const z = (s - 0.5) * facts.length;
  const width = facts.beam * widthAlong(s) * side;
  const sheer = facts.freeboard * (1 + 0.7 * s * s);
  const keel = -facts.draft * (1 - 0.7 * s ** 4);
  return [[width, sheer, z], [width * 0.97, 0.1, z], [width * 0.93, 0, z], [width * 0.68, keel * 0.42, z], [0, keel, z]];
}

const ORIGIN: Vec3 = [0, 0, 0];

/** One bay of a hull between two stations: its planks down both sides, and its deck. */
function bay(mesh: HullMesh, facts: HullFacts, s0: number, s1: number, colors: readonly Vec3[]): void {
  const corners = (s: number, side: number, band: number): Vec3 => sectionAt(facts, s, side)[band] ?? ORIGIN;
  for (const side of [-1, 1]) {
    colors.forEach((color, band) => { quad(mesh, corners(s0, side, band), corners(s0, side, band + 1), corners(s1, side, band + 1), corners(s1, side, band), color); });
  }
  quad(mesh, corners(s0, -1, 0), corners(s1, -1, 0), corners(s1, 1, 0), corners(s0, 1, 0), DECK);
}

/** The planks of a hull, station by station, and the deck that closes it so no water stands inside. */
function loft(mesh: HullMesh, kind: HullKind, facts: HullFacts): void {
  const colors = [PAINTS[kind], STRIPE, BOTTOM, BOTTOM];
  const stations = 14;
  for (let at = 0; at < stations; at += 1) bay(mesh, facts, at / stations, (at + 1) / stations, colors);
  const [left, right] = [sectionAt(facts, 0, -1), sectionAt(facts, 0, 1)];
  colors.forEach((color, band) => { quad(mesh, left[band] ?? ORIGIN, right[band] ?? ORIGIN, right[band + 1] ?? ORIGIN, left[band + 1] ?? ORIGIN, color); });
}

const FITTINGS: Readonly<Record<HullKind, (mesh: HullMesh, facts: HullFacts) => void>> = {
  dinghy(mesh, { length, freeboard }) {
    box(mesh, [-0.12, freeboard * 0.7, -length / 2 - 0.25], [0.12, freeboard + 0.28, -length / 2 + 0.05], SPAR);
    box(mesh, [-0.55, freeboard + 0.01, -0.2], [0.55, freeboard + 0.07, 0.1], DECK);
  },
  fishing(mesh, { freeboard }) {
    box(mesh, [-1, freeboard, -1.6], [1, freeboard + 1.7, 0.7], STRIPE);
    box(mesh, [-1.1, freeboard + 1.7, -1.7], [1.1, freeboard + 1.84, 0.8], PAINTS.fishing);
    box(mesh, [-1.02, freeboard + 0.95, 0.68], [1.02, freeboard + 1.5, 0.72], [0.05, 0.08, 0.1]);
    box(mesh, [-0.06, freeboard, 1], [0.06, freeboard + 4.2, 1.12], SPAR);
    box(mesh, [-0.05, freeboard + 2.9, -2.9], [0.05, freeboard + 3, 1.1], SPAR);
    box(mesh, [-1.2, freeboard, -3.6], [1.2, freeboard + 0.55, -2.4], [0.3, 0.26, 0.2]);
  },
  sloop(mesh, { freeboard, length }) {
    const top = freeboard + 12;
    box(mesh, [-0.85, freeboard, -1.6], [0.85, freeboard + 0.62, 1.9], STRIPE);
    box(mesh, [-0.07, freeboard, 0.6], [0.07, top, 0.76], SPAR);
    // Both sails eased out to one side, so they fill and show from astern.
    triangle(mesh, [0, freeboard + 1.7, 0.56], [0, top - 0.3, 0.56], [1.5, freeboard + 1.7, -3.2], SAIL);
    triangle(mesh, [0, freeboard + 1.3, length / 2 - 0.4], [0, top - 1.6, 0.86], [0.9, freeboard + 1.3, 1.2], SAIL);
  },
};

/**
 * A boat as plain triangles, with its bow toward +z and waterline at y = 0.
 *
 * @param kind Which hull.
 * @returns Corners and colours, ready for any renderer.
 */
export function hullOf(kind: HullKind): HullMesh {
  const mesh: HullMesh = { positions: [], colors: [] };
  const facts = HULLS[kind];
  loft(mesh, kind, facts);
  FITTINGS[kind](mesh, facts);
  return mesh;
}
