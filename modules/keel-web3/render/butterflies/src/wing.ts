// A butterfly's mesh: two wings cut from one outline, and a slim body. A wing is a fan from its root to an inner ring
// and a band from that ring to the outline, so the edge light has a band to fade across.

/** A point of a wing's outline: x out along the span (0 at the body, 1 at the tip), y forward along the body. */
export interface WingPoint {
  readonly x: number;
  readonly y: number;
}

/** A Shape as keel/lit makes it: the parts this module calls. */
export interface ShapeLike {
  moveTo(x: number, y: number): unknown;
  bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number): unknown;
  getPoints(divisions?: number): readonly WingPoint[];
}

/**
 * The mesh. `position` is three numbers a vertex: the span out from the body (a wing's, never negative), 0, and the
 * place along the body, forward positive; a body vertex gives its own x. `wing` is two: the side (1 right, -1 left,
 * 0 the body) and the edge (0 at the root, 1 on the outline).
 */
export interface WingMesh {
  readonly position: Float32Array;
  readonly wing: Float32Array;
  readonly index: number[];
}

/** Where a wing joins the body, and how far toward the outline its inner ring lies. */
const ROOT: WingPoint = { x: 0.03, y: 0 };
const INNER = 0.72;
const INNER_EDGE = 0.2;
/** The body, a diamond each way: nose, tail and half its width. */
const NOSE = 0.3;
const TAIL = -0.42;
const GIRTH = 0.035;

/**
 * Draws one wing's outline on a keel/lit Shape: a forewing reaching forward to its tip, a notch, a rounder hindwing.
 *
 * @param shape A new keel/lit Shape.
 * @param divisions Points along each curve.
 * @returns The outline, without its closing repeat.
 */
export function wingOutline(shape: ShapeLike, divisions = 8): WingPoint[] {
  shape.moveTo(0.03, 0.12);
  shape.bezierCurveTo(0.25, 0.45, 0.72, 0.64, 0.96, 0.52);
  shape.bezierCurveTo(1.02, 0.32, 0.78, 0.1, 0.56, 0.03);
  shape.bezierCurveTo(0.82, -0.15, 0.76, -0.5, 0.5, -0.56);
  shape.bezierCurveTo(0.3, -0.62, 0.1, -0.36, 0.03, -0.12);
  const points = shape.getPoints(divisions).map((p) => ({ x: p.x, y: p.y }));
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && points.length > 1 && first.x === last.x && first.y === last.y) points.pop();
  return points;
}

/** Twice the outline's signed area: above 0 when it runs counter-clockwise in its own x and y. */
export function windingOf(outline: readonly WingPoint[]): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i] ?? ROOT;
    const b = outline[(i + 1) % outline.length] ?? ROOT;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice;
}

interface Builder {
  readonly position: number[];
  readonly wing: number[];
  readonly index: number[];
}

function vertex(mesh: Builder, at: readonly [number, number, number], wing: readonly [number, number]): number {
  mesh.position.push(at[0], at[1], at[2]);
  mesh.wing.push(wing[0], wing[1]);
  return mesh.position.length / 3 - 1;
}

/** One wing; its triangles wound so its upper side is the front face whichever side it is on. */
function addWing(mesh: Builder, outline: readonly WingPoint[], side: number): void {
  const flip = windingOf(outline) > 0 === side > 0;
  const tri = (a: number, b: number, c: number): void => {
    mesh.index.push(...(flip ? [a, c, b] : [a, b, c]));
  };
  const root = vertex(mesh, [ROOT.x, 0, ROOT.y], [side, 0]);
  const inner: number[] = [];
  const outer: number[] = [];
  for (const p of outline) {
    const x = ROOT.x + (p.x - ROOT.x) * INNER;
    const y = ROOT.y + (p.y - ROOT.y) * INNER;
    inner.push(vertex(mesh, [x, 0, y], [side, INNER_EDGE]));
    outer.push(vertex(mesh, [p.x, 0, p.y], [side, 1]));
  }
  for (let i = 0; i < outline.length; i += 1) {
    const j = (i + 1) % outline.length;
    const [ii, ij, oi, oj] = [inner[i] ?? root, inner[j] ?? root, outer[i] ?? root, outer[j] ?? root];
    tri(root, ii, ij);
    tri(ii, oi, oj);
    tri(ii, oj, ij);
  }
}

/** The body: a flat diamond and an upright one, nose forward. */
function addBody(mesh: Builder): void {
  const nose = vertex(mesh, [0, 0, NOSE], [0, 0]);
  const tail = vertex(mesh, [0, 0, TAIL], [0, 0]);
  for (const side of [
    [GIRTH, 0],
    [-GIRTH, 0],
    [0, GIRTH],
    [0, -GIRTH],
  ] as const) {
    const waist = vertex(mesh, [side[0], side[1], 0], [0, 0]);
    mesh.index.push(nose, waist, tail);
  }
}

/**
 * A butterfly's mesh from one wing's outline: the right wing as drawn, the left its mirror, and the body.
 *
 * @param outline One wing, as `wingOutline` gives it.
 * @returns The mesh's arrays, for a keel/lit Geometry.
 */
export function wingMesh(outline: readonly WingPoint[]): WingMesh {
  const mesh: Builder = { position: [], wing: [], index: [] };
  addWing(mesh, outline, 1);
  addWing(mesh, outline, -1);
  addBody(mesh);
  return { position: new Float32Array(mesh.position), wing: new Float32Array(mesh.wing), index: mesh.index };
}
