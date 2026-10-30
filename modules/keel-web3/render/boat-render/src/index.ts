/**
 * Draws boats for keel/lit: one instanced hull per kind, posed by what
 * `generative/boats` says. Hands `render/ocean-render` the casters and wakes
 * that put them in the water. MIT.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export type Vec = readonly [number, number, number];

interface DisposableLike { dispose(): void }
interface AttributeLike { readonly array: Float32Array; needsUpdate: boolean }
interface GeometryLike extends DisposableLike {
  setAttribute(name: string, attribute: unknown): unknown;
  computeVertexNormals(): void;
}
interface NodeLike {
  add(...nodes: unknown[]): void;
  frustumCulled: boolean;
  castShadow?: boolean;
}
interface InstancesLike extends NodeLike {
  count: number;
  readonly instanceMatrix: AttributeLike;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancesLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly LitMaterial: new (parameters: Readonly<Record<string, unknown>>) => DisposableLike;
}

/** A boat at a moment: `generative/boats`'s BoatPose fits. */
export interface PoseLike {
  readonly kind: string;
  readonly at: Vec;
  readonly front: Vec;
  readonly up: Vec;
  readonly side: Vec;
  readonly speed: number;
}

/** How big a hull is: `generative/boats`'s HULLS fits. */
export type HullSizes = Readonly<Record<string, { readonly length: number; readonly beam: number; readonly freeboard: number }>>;

export interface BoatsOptions {
  /** `generative/boats`'s hullOf. */
  hullOf(kind: string): { readonly positions: readonly number[]; readonly colors: readonly number[] };
  /** Which hulls to make ready. */
  readonly kinds: readonly string[];
  /** The most boats of one kind on the water. */
  readonly most?: number;
}

/** What `render/ocean-render` takes as a wake. */
export interface WakeOut {
  readonly x: number;
  readonly z: number;
  readonly ahead: readonly [number, number];
  readonly speed: number;
  readonly length: number;
}

/** What `render/ocean-render` takes as a caster. */
export interface CasterOut {
  readonly at: Vec;
  readonly r: number;
  readonly tint: Vec;
}

export interface Boats {
  /** Add it to the scene. */
  readonly group: NodeLike;
  /** Poses every boat for this frame. */
  draw(poses: readonly PoseLike[]): void;
  /** The white water each boat makes. */
  wakes(poses: readonly PoseLike[], sizes: HullSizes): WakeOut[];
  /** Spheres standing in for each hull in the water's rays. */
  casters(poses: readonly PoseLike[], sizes: HullSizes): CasterOut[];
  dispose(): void;
}

/**
 * A pose as the 16 numbers of a matrix, column by column.
 *
 * @param pose Where the boat is and its axes.
 * @returns The hull's matrix.
 */
export function matrixOf(pose: PoseLike): number[] {
  return [...pose.side, 0, ...pose.up, 0, ...pose.front, 0, ...pose.at, 1];
}

/**
 * Where each boat meets the water, moving or not.
 *
 * @param poses The boats.
 * @param sizes Each kind's size.
 * @returns A wake for each.
 */
export function wakesOf(poses: readonly PoseLike[], sizes: HullSizes): WakeOut[] {
  return poses.map((pose) => {
    const across = Math.hypot(pose.front[0], pose.front[2]) || 1;
    return { x: pose.at[0], z: pose.at[2], ahead: [pose.front[0] / across, pose.front[2] / across], speed: pose.speed, length: sizes[pose.kind]?.length ?? 4 };
  });
}

/**
 * Stands each hull in the rays as a sphere at its bow, middle and stern.
 *
 * @param poses The boats.
 * @param sizes Each kind's size.
 * @returns Three spheres a boat.
 */
export function castersOf(poses: readonly PoseLike[], sizes: HullSizes): CasterOut[] {
  return poses.flatMap((pose) => {
    const size = sizes[pose.kind] ?? { length: 4, beam: 1.5, freeboard: 0.5 };
    return [-0.3, 0, 0.3].map((share) => ({
      at: [pose.at[0] + pose.front[0] * size.length * share, pose.at[1] + size.freeboard * 0.5, pose.at[2] + pose.front[2] * size.length * share] as Vec,
      r: size.beam * 0.5,
      tint: [0.55, 0.55, 0.55] as Vec,
    }));
  });
}

/**
 * Makes the hulls ready.
 *
 * @param lit The keel/lit namespace.
 * @param options Where the hulls come from, and which.
 * @returns The group for the scene, and what to call each frame.
 */
export function createBoats(lit: LitLike, options: BoatsOptions): Boats {
  const most = options.most ?? 32;
  const material = new lit.LitMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.6, metalness: 0, side: "both" });
  const group = new lit.Group();
  const made = new Map<string, { instances: InstancesLike; geometry: GeometryLike }>();
  for (const kind of options.kinds) {
    const mesh = options.hullOf(kind);
    const geometry = new lit.Geometry();
    geometry.setAttribute("position", new lit.Attribute(new Float32Array(mesh.positions), 3));
    geometry.setAttribute("color", new lit.Attribute(new Float32Array(mesh.colors), 3));
    geometry.computeVertexNormals();
    const instances = new lit.Instances(geometry, material, most);
    instances.count = 0;
    instances.frustumCulled = false;
    group.add(instances);
    made.set(kind, { instances, geometry });
  }
  return {
    group,
    draw(poses) {
      for (const { instances } of made.values()) instances.count = 0;
      for (const pose of poses) {
        const hull = made.get(pose.kind);
        if (!hull || hull.instances.count >= most) continue;
        hull.instances.instanceMatrix.array.set(matrixOf(pose), hull.instances.count * 16);
        hull.instances.count += 1;
        hull.instances.instanceMatrix.needsUpdate = true;
      }
    },
    wakes: wakesOf,
    casters: castersOf,
    dispose() {
      material.dispose();
      for (const { geometry } of made.values()) geometry.dispose();
    },
  };
}
