// What clothes cover at rest: the skin close under cloth, away from a garment's edge. The clip score tints it, so any of
// it a pose brings into view is skin that came through.
import { boneIndex } from "../../modules/keel-web3/generative/people/src/body/bones.ts";
import type { PersonMesh } from "../../modules/keel-web3/generative/people/src/index.ts";

const SKIN = 0, HAIR = 3;
const ARM_BONES = ["chest", "upper.L", "upper.R", "fore.L", "fore.R"];
/** How near cloth has to lie to count as covering skin, in metres. */
const COVERED = 0.07;
/** How far from a garment's edge cloth has to be: skin beside a hem is shown, not clipped. */
const EDGE = 0.04;
/** How far into a sleeve or armhole skin has to be: you can see into one's mouth at rest. */
const EDGE_ARM = 0.14;
const GRID = 0.07;
/** How many rings of skin to leave out beside what's on show, as collars and cuffs let it be seen at rest. */
const BESIDE_SHOWN = 3;
const TINT = "#ff00ff";
const ABOVE_COLLAR = new Set([boneIndex("head"), boneIndex("neck")]);
const ARMS = new Set(ARM_BONES.map(boneIndex));

const keyOf = (x: number, y: number, z: number): string =>
  `${String(Math.floor(x / GRID))},${String(Math.floor(y / GRID))},${String(Math.floor(z / GRID))}`;

/** Each vertex at rest, and its neighbours in a grid of the cloth. */
function clothGrid(mesh: PersonMesh): Map<string, number[]> {
  const grid = new Map<string, number[]>(), at = mesh.position;
  for (let v = 0; v < at.length / 3; v += 1) {
    const fabric = mesh.fabric[v];
    if (fabric === SKIN || fabric === HAIR) continue;
    const key = keyOf(at[v * 3] ?? 0, at[v * 3 + 1] ?? 0, at[v * 3 + 2] ?? 0), list = grid.get(key);
    if (list) list.push(v);
    else grid.set(key, [v]);
  }
  return grid;
}

/** The nearest cloth to a skin vertex, within reach, or -1. */
function nearestCloth(mesh: PersonMesh, grid: Map<string, number[]>, v: number): number {
  const at = mesh.position, x = at[v * 3] ?? 0, y = at[v * 3 + 1] ?? 0, z = at[v * 3 + 2] ?? 0;
  let best = -1, near = COVERED * COVERED;
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) {
    for (const u of grid.get(keyOf(x + i * GRID, y + j * GRID, z + k * GRID)) ?? []) {
      const d = ((at[u * 3] ?? 0) - x) ** 2 + ((at[u * 3 + 1] ?? 0) - y) ** 2 + ((at[u * 3 + 2] ?? 0) - z) ** 2;
      if (d < near) [best, near] = [u, d];
    }
  }
  return best;
}

/** Whether a vertex lies on the inner side of cloth vertex `u`. */
function under(mesh: PersonMesh, u: number, v: number): boolean {
  const at = mesh.position, n = mesh.normal;
  return [0, 1, 2].reduce((sum, k) => sum + (n[u * 3 + k] ?? 0) * ((at[v * 3 + k] ?? 0) - (at[u * 3 + k] ?? 0)), 0) < 0;
}

/** Each vertex's neighbours along the mesh's edges. */
function neighboursOf(mesh: PersonMesh): readonly Set<number>[] {
  const next = Array.from({ length: mesh.fabric.length }, () => new Set<number>());
  for (let i = 0; i < mesh.index.length; i += 3) {
    const corners = [mesh.index[i] ?? 0, mesh.index[i + 1] ?? 0, mesh.index[i + 2] ?? 0];
    for (const a of corners) for (const b of corners) if (a !== b) next[a]?.add(b);
  }
  return next;
}

/** A set of skin less the rings of it that touch any skin outside it. */
function eroded(mesh: PersonMesh, covered: Set<number>): Set<number> {
  const next = neighboursOf(mesh), kept = new Set(covered);
  const bordersShown = (v: number): boolean =>
    [...(next[v] ?? [])].some((n) => mesh.fabric[n] === SKIN && !kept.has(n));
  for (let ring = 0; ring < BESIDE_SHOWN; ring += 1) {
    for (const v of [...kept].filter(bordersShown)) kept.delete(v);
  }
  return kept;
}

/** The skin vertices a mesh's clothes cover. */
export function coveredSkin(mesh: PersonMesh): readonly number[] {
  const grid = clothGrid(mesh), out = new Set<number>();
  for (let v = 0; v < mesh.fabric.length; v += 1) {
    const bone = mesh.bones[v * 2] ?? 0;
    if (mesh.fabric[v] !== SKIN || ABOVE_COLLAR.has(bone) || ABOVE_COLLAR.has(mesh.bones[v * 2 + 1] ?? 0)) continue;
    const u = nearestCloth(mesh, grid, v);
    if (u >= 0 && (mesh.cloth[u * 4 + 3] ?? 0) > (ARMS.has(bone) ? EDGE_ARM : EDGE) && under(mesh, u, v)) out.add(v);
  }
  return [...eroded(mesh, out)];
}

/** The same mesh, those vertices painted a colour nothing else is. */
export function tinted(mesh: PersonMesh, covered: readonly number[]): PersonMesh {
  const role = Uint8Array.from(mesh.role), roles = [...mesh.roles, "clip-score"];
  for (const v of covered) role[v] = roles.length - 1;
  return { ...mesh, role, roles, palette: { ...mesh.palette, "clip-score": TINT } };
}
