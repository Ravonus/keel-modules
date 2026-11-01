// The seabed: the ground baked for the shaders to read, the fine mesh under the water and the coarse one past it.

import type {
  DataTextureLike, DisposableLike, GeometryLike, LitLike, NodeLike, OceanOptions, SeaLike, Vec,
} from "./inputs.js";

/** Cells a side of the ground baked for the surface to read its depth from. */
export const GROUND_CELLS = 256;

function paintBed(
  lit: LitLike,
  geometry: GeometryLike,
  positions: Float32Array,
  colorAt: (x: number, y: number, z: number) => Vec,
): void {
  const colors = new Float32Array(positions.length);
  for (let at = 0; at + 2 < positions.length; at += 3) {
    colors.set(colorAt(positions[at] ?? 0, positions[at + 1] ?? 0, positions[at + 2] ?? 0), at);
  }
  geometry.setAttribute("color", new lit.Attribute(colors, 3));
}

export interface BakedGround {
  readonly height: DataTextureLike;
  readonly color: DataTextureLike;
  readonly top: number;
}

/** The ground as the shaders read it: its height, and its colour for the rays that land on it. */
export function bakeGround(lit: LitLike, sea: SeaLike, size: number, colorAt: OceanOptions["colorAt"]): BakedGround {
  const heights = new Float32Array(GROUND_CELLS * GROUND_CELLS);
  const colors = new Float32Array(GROUND_CELLS * GROUND_CELLS * 4);
  const share = (cell: number): number => (cell / (GROUND_CELLS - 1) - 0.5) * size;
  let top = 0;
  for (let cell = 0; cell < heights.length; cell += 1) {
    const x = share(cell % GROUND_CELLS);
    const z = share(Math.floor(cell / GROUND_CELLS));
    const y = sea.seabedAt(x, z);
    heights[cell] = y;
    top = Math.max(top, y);
    const tint = colorAt?.(x, y, z) ?? [0.27, 0.23, 0.14];
    colors.set([tint[0], tint[1], tint[2], 1], cell * 4);
  }
  const height = new lit.DataTexture(heights, GROUND_CELLS, GROUND_CELLS, "red", "float");
  const color = new lit.DataTexture(colors, GROUND_CELLS, GROUND_CELLS, "rgba", "float");
  height.needsUpdate = true;
  color.needsUpdate = true;
  return { height, color, top };
}

/** How far the far ground runs, as a share of the fine ground, and its cells a side across the fine ground. */
const FAR_SPAN = 5;
const FAR_CELLS = 40;

/**
 * The ground past the fine mesh, coarse and from the same answers. It reaches a
 * cell in under the fine mesh and sinks there, so the two never leave a crack.
 */
function farGroundOf(lit: LitLike, sea: SeaLike, size: number, colorAt: OceanOptions["colorAt"]): GeometryLike {
  const half = (FAR_SPAN * FAR_CELLS) / 2;
  const inner = FAR_CELLS / 2;
  const side = half * 2 + 1;
  const step = size / FAR_CELLS;
  const positions = new Float32Array(side * side * 3);
  const index: number[] = [];
  for (let row = -half; row <= half; row += 1) {
    for (let column = -half; column <= half; column += 1) {
      const [x, z] = [column * step, row * step];
      const under = Math.abs(column) < inner && Math.abs(row) < inner;
      const at = (row + half) * side + column + half;
      positions.set([x, sea.seabedAt(x, z) - (under ? 3 : 0), z], at * 3);
      const cut = Math.abs(column + 0.5) < inner - 1 && Math.abs(row + 0.5) < inner - 1;
      if (column < half && row < half && !cut) index.push(at, at + side, at + 1, at + 1, at + side, at + side + 1);
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  if (colorAt) paintBed(lit, geometry, positions, colorAt);
  return geometry;
}

/** The seabed's measures: metres across, cells a side, and the ground's colour. */
export interface BedPlan {
  readonly size: number;
  readonly cells: number;
  readonly colorAt: OceanOptions["colorAt"];
}

export interface Seabed {
  readonly mesh: NodeLike;
  readonly geometry: GeometryLike;
  readonly far: GeometryLike;
  readonly material: DisposableLike;
}

export function seabedOf(lit: LitLike, sea: SeaLike, plan: BedPlan): Seabed {
  const { size, cells, colorAt } = plan;
  const geometry = lit.plane(size, size, cells, cells);
  const position = geometry.getAttribute("position");
  if (position) {
    for (let at = 0; at + 2 < position.array.length; at += 3) {
      const x = position.array[at] ?? 0;
      const z = -(position.array[at + 1] ?? 0);
      position.array.set([x, sea.seabedAt(x, z), z], at);
    }
    position.needsUpdate = true;
  }
  geometry.computeVertexNormals();
  if (position && colorAt) paintBed(lit, geometry, position.array, colorAt);
  const material = new lit.LitMaterial({
    color: colorAt ? "#ffffff" : "#8f8468",
    vertexColors: colorAt !== undefined,
    roughness: 0.95,
    metalness: 0,
  });
  const near = new lit.Mesh(geometry, material);
  near.receiveShadow = true;
  const far = farGroundOf(lit, sea, size, colorAt);
  const mesh = new lit.Group();
  mesh.add(near, new lit.Mesh(far, material));
  return { mesh, geometry, far, material };
}
