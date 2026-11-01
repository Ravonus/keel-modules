// createSwarm: the near animals as real bodies, the rest as instances cut from the same body at rest.

import { unit } from "./math.js";
import { SWARM_FRAGMENT, SWARM_VERTEX } from "./shaders.glsl.js";
import { setVec } from "./uniforms.js";
import type {
  AttributeLike, Caster, ColorLike, DisposableLike, GeometryLike, InstancesLike, LitLike, NodeLike, Uniforms, Vec,
} from "./inputs.js";

/** One capsule of a body, as `render/sdf-body` takes it. */
interface PartLike {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: string;
  readonly r1?: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly decal?: boolean;
  readonly carve?: boolean;
}

/** A posed body: whatever `render/sdf-body` draws, of which this reads the parts and palette. */
export interface SwarmBody {
  readonly capsules: readonly PartLike[];
  readonly palette: Readonly<Record<string, string>>;
}

/** One animal, as `generative/marine` gives it. */
export interface SwarmMember {
  readonly id: string;
  readonly at: Vec;
  readonly front: Vec;
  readonly phase: number;
  readonly build: number;
  readonly index: number;
  readonly seed: number;
}

/** The species facts a swarm needs. */
export interface SwarmSpecies {
  readonly size: number;
  readonly swing: number;
}

export interface SwarmOptions<Body extends SwarmBody, Light> {
  /** `render/sdf-body`'s bodies, for the near animals. */
  readonly bodies: { readonly group: unknown; draw(bodies: readonly Body[], light: Light): void };
  /** `generative/marine`'s poseSwimmer. */
  readonly pose: (swimmer: SwarmMember, options?: { readonly rest?: boolean }) => Body;
  /** `generative/marine`'s SPECIES. */
  readonly species: Readonly<Record<string, SwarmSpecies>>;
  /** How many animals are drawn as real bodies. */
  readonly near?: number;
  /** The most of any one species drawn far. */
  readonly most?: number;
}

export interface SwarmLight {
  readonly sun: Vec;
  readonly sunColor: Vec;
  readonly sky: Vec;
  readonly ground: Vec;
}

export interface Swarm<Light> {
  readonly group: NodeLike;
  /** The near animals as spheres, for `ocean.draw`'s rays. */
  readonly casters: readonly Caster[];
  draw(swimmers: readonly SwarmMember[], eye: Vec, light: Light & SwarmLight): void;
  dispose(): void;
}

const SIDES = 6;

interface Mesh2 { positions: number[]; normals: number[]; tints: number[]; index: number[] }

function perpendicular(axis: Vec, hint: Vec | undefined): Vec {
  const seed = hint ?? (Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const along = axis[0] * seed[0] + axis[1] * seed[1] + axis[2] * seed[2];
  return unit([seed[0] - axis[0] * along, seed[1] - axis[1] * along, seed[2] - axis[2] * along]);
}

/** One capsule as a six-sided tapered tube, flattened as the part is, closed to a point at each end. */
function addTube(mesh: Mesh2, part: PartLike, tint: ColorLike): void {
  const gap: Vec = [part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]];
  const round = Math.hypot(gap[0], gap[1], gap[2]) < 1e-6;
  const axis = round ? ([0, 1, 0] as Vec) : unit(gap);
  const u = perpendicular(axis, part.up);
  const v: Vec = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  const flat = part.flat ?? 1;
  const base = mesh.positions.length / 3;
  const ends: readonly (readonly [Vec, number])[] = round
    ? [
        [[part.a[0], part.a[1] - part.r * 0.7, part.a[2]], part.r * 0.7],
        [[part.a[0], part.a[1] + part.r * 0.7, part.a[2]], part.r * 0.7],
      ]
    : [
        [part.a, part.r],
        [part.b, part.r1 ?? part.r],
      ];
  for (const [center, r] of ends) {
    for (let side = 0; side < SIDES; side += 1) {
      const angle = (side / SIDES) * Math.PI * 2;
      const c = Math.cos(angle) * r * flat;
      const s = Math.sin(angle) * r;
      mesh.positions.push(
        center[0] + u[0] * c + v[0] * s,
        center[1] + u[1] * c + v[1] * s,
        center[2] + u[2] * c + v[2] * s,
      );
      const n = unit([u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]);
      mesh.normals.push(n[0], n[1], n[2]);
      mesh.tints.push(tint.r, tint.g, tint.b);
    }
  }
  for (let side = 0; side < SIDES; side += 1) {
    const next = (side + 1) % SIDES;
    mesh.index.push(
      base + side,
      base + next,
      base + side + SIDES,
      base + next,
      base + next + SIDES,
      base + side + SIDES,
    );
    // (The ends, as a fan from each ring's first corner.)
    if (side > 0 && next > 0) {
      mesh.index.push(base, base + next, base + side, base + SIDES, base + SIDES + side, base + SIDES + next);
    }
  }
}

function cutFrom(lit: LitLike, body: SwarmBody, phases: AttributeLike): GeometryLike {
  const mesh: Mesh2 = { positions: [], normals: [], tints: [], index: [] };
  for (const part of body.capsules) {
    if (part.decal === true || part.carve === true) continue;
    addTube(mesh, part, new lit.Color(body.palette[part.role] ?? "#808080"));
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(mesh.positions), 3));
  geometry.setAttribute("normal", new lit.Attribute(new Float32Array(mesh.normals), 3));
  geometry.setAttribute("aTint", new lit.Attribute(new Float32Array(mesh.tints), 3));
  geometry.setAttribute("aPhase", phases);
  geometry.setIndex(mesh.index);
  return geometry;
}

interface Herd {
  readonly mesh: InstancesLike;
  readonly geometry: GeometryLike;
  readonly material: DisposableLike;
  readonly phases: AttributeLike;
  readonly uniforms: Uniforms;
}

function writeMember(herd: Herd, slot: number, member: SwarmMember): void {
  const z = member.front;
  const side: Vec = [z[2], 0, -z[0]];
  const x = Math.hypot(side[0], side[2]) > 1e-4 ? unit(side) : ([1, 0, 0] as Vec);
  const y: Vec = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const s = member.build;
  herd.mesh.instanceMatrix.array.set(
    [
      x[0] * s,
      x[1] * s,
      x[2] * s,
      0,
      y[0] * s,
      y[1] * s,
      y[2] * s,
      0,
      z[0] * s,
      z[1] * s,
      z[2] * s,
      0,
      member.at[0],
      member.at[1],
      member.at[2],
      1,
    ],
    slot * 16,
  );
  herd.phases.array[slot] = member.phase;
}

/** How a herd is cut: the poser that gives the body at rest, and the most instances it may hold. */
interface HerdPlan {
  readonly pose: (swimmer: SwarmMember, options?: { readonly rest?: boolean }) => SwarmBody;
  readonly most: number;
}

function herdOf(lit: LitLike, id: string, facts: SwarmSpecies, plan: HerdPlan): Herd {
  const { pose, most } = plan;
  const phases = new lit.InstanceAttribute(new Float32Array(most), 1);
  const body = pose({ id, index: 0, at: [0, 0, 0], front: [0, 0, 1], phase: 0, build: 1, seed: 1 }, { rest: true });
  const geometry = cutFrom(lit, body, phases);
  const uniforms: Uniforms = {
    uSize: { value: facts.size },
    uSwing: { value: facts.swing },
    uSunDir: { value: new lit.Vector3(0, 1, 0) },
    uSunCol: { value: new lit.Vector3(1, 1, 1) },
    uSky: { value: new lit.Vector3(1, 1, 1) },
    uGround: { value: new lit.Vector3(0, 0, 0) },
  };
  const material = new lit.CustomMaterial({ uniforms, vertexShader: SWARM_VERTEX, fragmentShader: SWARM_FRAGMENT });
  const mesh = new lit.Instances(geometry, material, most);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, geometry, material, phases, uniforms };
}

function lightHerd(herd: Herd, light: SwarmLight): void {
  setVec(herd.uniforms.uSunDir, unit(light.sun));
  setVec(herd.uniforms.uSunCol, light.sunColor);
  setVec(herd.uniforms.uSky, light.sky);
  setVec(herd.uniforms.uGround, light.ground);
}

/** A body's largest parts, as spheres. */
function castersOf(lit: LitLike, body: SwarmBody, most: number): Caster[] {
  const solid = body.capsules
    .filter((part) => part.decal !== true && part.carve !== true)
    .sort((a, b) => b.r - a.r)
    .slice(0, most);
  return solid.map((part) => {
    const tint = new lit.Color(body.palette[part.role] ?? "#808080");
    const reach = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]) * 0.5;
    return {
      at: [(part.a[0] + part.b[0]) / 2, (part.a[1] + part.b[1]) / 2, (part.a[2] + part.b[2]) / 2],
      r: Math.max(part.r, reach * 0.75),
      tint: [tint.r, tint.g, tint.b],
    };
  });
}

/**
 * Makes a swarm: any number of animals for the price of a few. The nearest are
 * real bodies; the rest are instances cut from those same bodies at rest, so
 * nothing has to be modelled twice, and they share one draw call a species.
 * Nearness is measured against the animal's size, so a far shark outranks a
 * near sardine.
 *
 * @param lit The keel/lit namespace.
 * @param options The sdf bodies, the posing function and the species table.
 * @returns A swarm to add to the scene.
 */
export function createSwarm<Body extends SwarmBody, Light>(
  lit: LitLike,
  options: SwarmOptions<Body, Light>,
): Swarm<Light> {
  const near = options.near ?? 16;
  const most = options.most ?? 512;
  const group = new lit.Group();
  group.add(options.bodies.group);
  const herds = new Map<string, Herd>();
  const herd = (id: string): Herd | undefined => {
    const existing = herds.get(id);
    if (existing) return existing;
    const facts = options.species[id];
    if (!facts) return undefined;
    const made = herdOf(lit, id, facts, { pose: options.pose, most });
    herds.set(id, made);
    group.add(made.mesh);
    return made;
  };
  const rank = (member: SwarmMember, eye: Vec): number =>
    Math.hypot(member.at[0] - eye[0], member.at[1] - eye[1], member.at[2] - eye[2]) /
    (options.species[member.id]?.size ?? 1);
  let casters: Caster[] = [];
  return {
    group,
    get casters() {
      return casters;
    },
    draw(swimmers, eye, light) {
      const ranked = swimmers.map((member) => ({ member, rank: rank(member, eye) })).sort((a, b) => a.rank - b.rank);
      const posed = ranked.slice(0, near).map((entry) => options.pose(entry.member));
      options.bodies.draw(posed, light);
      // (Bigger animals first: a shark in the mirror matters more than a sardine.)
      casters = posed.flatMap((body) => castersOf(lit, body, 4)).sort((a, b) => b.r - a.r);
      for (const each of herds.values()) each.mesh.count = 0;
      for (const { member } of ranked.slice(near)) {
        const each = herd(member.id);
        if (!each || each.mesh.count >= most) continue;
        writeMember(each, each.mesh.count, member);
        each.mesh.count += 1;
      }
      for (const each of herds.values()) {
        each.mesh.instanceMatrix.needsUpdate = true;
        each.phases.needsUpdate = true;
        lightHerd(each, light);
      }
    },
    dispose() {
      for (const each of herds.values()) {
        each.geometry.dispose();
        each.material.dispose();
      }
    },
  };
}
