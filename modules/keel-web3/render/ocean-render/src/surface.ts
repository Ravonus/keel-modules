// The moving surface: a disc of rings round the eye, and the spray thrown off the surf.

import { SPRAY_FRAGMENT, SPRAY_VERTEX, SURFACE_FRAGMENT, SURFACE_VERTEX } from "./shaders.glsl.js";
import type { DisposableLike, GeometryLike, LitLike, NodeLike, Uniforms } from "./inputs.js";

/** Cells a side of the wrapping grid spray is thrown from, and their size in metres. */
const SPRAY_GRID = 90;
const SPRAY_CELL = 0.9;

/** A disc of rings round the eye, fine underfoot and coarse at the horizon. */
function surfaceGeometry(lit: LitLike, rings: number, spokes: number, radius: number): GeometryLike {
  const positions = new Float32Array((rings + 1) * spokes * 3);
  const index: number[] = [];
  const growth = Math.pow(radius, 1 / rings);
  for (let ring = 0; ring <= rings; ring += 1) {
    const r = ring === 0 ? 0 : Math.pow(growth, ring) * 0.35;
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = (spoke / spokes) * Math.PI * 2;
      positions.set([Math.cos(angle) * r, 0, Math.sin(angle) * r], (ring * spokes + spoke) * 3);
      if (ring === rings) continue;
      const a = ring * spokes + spoke;
      const b = ring * spokes + ((spoke + 1) % spokes);
      index.push(a, a + spokes, b, b, a + spokes, b + spokes);
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

export function surfaceOf(
  lit: LitLike,
  uniforms: Uniforms,
  defines: Readonly<Record<string, unknown>>,
): { stage: NodeLike; disc: GeometryLike; material: DisposableLike } {
  const material = new lit.CustomMaterial({
    defines,
    uniforms,
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    side: "double",
    depthWrite: true,
    depthTest: true,
  });
  const disc = surfaceGeometry(lit, 150, 220, 1400);
  const mesh = new lit.Mesh(disc, material);
  mesh.frustumCulled = false;
  const stage = new lit.Stage();
  stage.add(mesh);
  return { stage, disc, material };
}

/** One quad a drop, thrown and aged in its vertex shader. */
export function sprayOf(
  lit: LitLike,
  stage: NodeLike,
  uniforms: Uniforms,
  defines: Readonly<Record<string, unknown>>,
): { mesh: NodeLike; quad: GeometryLike; material: DisposableLike } {
  const quad = lit.plane(1, 1);
  const cells = new Float32Array(SPRAY_GRID * SPRAY_GRID * 2);
  for (let index = 0; index < SPRAY_GRID * SPRAY_GRID; index += 1)
    cells.set([index % SPRAY_GRID, Math.floor(index / SPRAY_GRID)], index * 2);
  quad.setAttribute("aCell", new lit.InstanceAttribute(cells, 2));
  const material = new lit.CustomMaterial({
    defines: { ...defines, SPRAY_GRID: `${SPRAY_GRID}.0`, SPRAY_CELL: SPRAY_CELL.toFixed(2) },
    uniforms,
    vertexShader: SPRAY_VERTEX,
    fragmentShader: SPRAY_FRAGMENT,
    side: "double",
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new lit.Instances(quad, material, SPRAY_GRID * SPRAY_GRID);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  stage.add(mesh);
  return { mesh, quad, material };
}
