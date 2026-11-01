// Shapes: leaf blades, sprays, sprigs and needles, one geometry per species, cached.

import type { GeometryLike, LitLike } from "../inputs.js";
import { TAU, clamp, smoothstep } from "../math.js";
import { UP, cross3, isZero, norm3 } from "../instances.js";
import type { V3 } from "../instances.js";

// ---------------------------------------------------------------- shapes

/** A slim pointed leaf, stalk at the origin and tip up +Y, as [half-width, height] pairs. */
export const LEAF_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.09, 0.07],
  [0.18, 0.26],
  [0.21, 0.48],
  [0.17, 0.7],
  [0.09, 0.9],
  [0.02, 1.06],
  [0, 1.16],
];

/**
 * A leaf blade folded along a pale midrib with darker margins, so even a few
 * pixels read as a leaf and not a dot. Colours are baked as vertex colours.
 */
export function bladeGeometry(
  lit: LitLike,
  outline: readonly (readonly [number, number])[] = LEAF_OUTLINE,
  fold = 0.1,
  bend = 0,
): GeometryLike {
  return bladeFrom(lit, outline, { fold, bend }, CRISP_BLADE);
}

/** A blade's tone: its midrib's brightness, how much darker its margin and its foot go. */
type BladeTone = readonly [mid: number, margin: number, foot: number];
const CRISP_BLADE: BladeTone = [1.22, 0.5, 0.18];
/**
 * Soft blades (the `clumps` look) keep the midrib but drop most of the margin's
 * darkening: at a pixel or two per leaf that contrast only reads as speckle.
 */
const SOFT_BLADE: BladeTone = [1.08, 0.2, 0.08];

/** The broad leaf blade with a soft margin (the `clumps` look). */
export function softBladeGeometry(lit: LitLike): GeometryLike {
  return bladeFrom(lit, LEAF_OUTLINE, { fold: 0.1, bend: 0 }, SOFT_BLADE);
}

/** How a blade curves: `fold` along its midrib, `bend` arching it along its length. */
interface BladeCurve {
  readonly fold: number;
  readonly bend: number;
}

function bladeFrom(
  lit: LitLike,
  outline: readonly (readonly [number, number])[],
  { fold, bend }: BladeCurve,
  [mid, margin, foot]: BladeTone,
): GeometryLike {
  const widest = Math.max(...outline.map(([x]) => x));
  const positions: number[] = [];
  const colors: number[] = [];
  const tone = (x: number, y: number): number[] => {
    const edge = Math.abs(x) / widest;
    const shade = mid - margin * edge - foot * smoothstep(0.25, 0, y);
    return [shade, shade * (1 + 0.04 * (1 - edge)), shade];
  };
  for (let index = 0; index < outline.length - 1; index += 1) {
    const [x0, y0] = outline[index] ?? [0, 0];
    const [x1, y1] = outline[index + 1] ?? [0, 0];
    for (const side of [-1, 1]) {
      // `bend` arches the blade along its length, its tip dropping away from its face.
      const a = [0, y0, bend * y0 * y0];
      const d = [0, y1, bend * y1 * y1];
      const b = [side * x0, y0, (fold * x0) / widest + bend * y0 * y0];
      const c = [side * x1, y1, (fold * x1) / widest + bend * y1 * y1];
      const quad = side > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
      for (const point of quad) {
        positions.push(...point);
        colors.push(...tone(point[0] ?? 0, point[1] ?? 0));
      }
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface TreeShapes {
  readonly wood: GeometryLike;
  readonly leaf: GeometryLike;
  readonly blade: GeometryLike;
  readonly bud: GeometryLike;
  readonly box: GeometryLike;
  /** The broad blade with a soft margin (the `clumps` look). */
  readonly softBlade: GeometryLike;
  /** A blossom spray: a few round flower heads in a puff, lit on top and rose in its own shade (the `sprays` look). */
  readonly spray: GeometryLike;
}

/** Each head of a spray: centre (x, y, z) and radius, in a unit about one flower head across. */
const SPRAY_HEADS = [
  [0, 0.2, 0, 0.56],
  [0.5, -0.08, 0.12, 0.46],
  [-0.34, -0.04, 0.4, 0.44],
  [-0.16, -0.12, -0.46, 0.45],
  [0.12, -0.42, 0.04, 0.36],
];

/**
 * A spray of blossom as one shape: a few flower heads bunched round the twig.
 * Vertex colours carry two tones so the spray reads at a few pixels: the tops
 * of the heads catch the light near white, the undersides sink to a deeper,
 * rosier shade of the petal colour (red holds, green and blue drop).
 */
export function sprayGeometry(lit: LitLike): GeometryLike {
  const positions: number[] = [];
  const colors: number[] = [];
  // keel/lit's icosahedron is non-indexed: three corners per face.
  // (Never drawn, so it holds no GPU buffer to dispose.)
  const corners = lit.icosahedron(1, 0).attributes.position?.array ?? new Float32Array(0);
  const h = (index: number): number => corners[index] ?? 0;
  for (const [cx = 0, cy = 0, cz = 0, r = 0.5] of SPRAY_HEADS) {
    for (let face = 0; face + 8 < corners.length; face += 9) {
      // A face's tone follows how far up it faces and how high the head sits in the spray.
      const light = clamp(0.5 + ((h(face + 1) + h(face + 4) + h(face + 7)) / 3) * 0.55 + cy * 0.6, 0, 1);
      const k = 0.74 + 0.34 * light;
      for (let corner = face; corner < face + 9; corner += 3) {
        positions.push(cx + h(corner) * r, cy + h(corner + 1) * r, cz + h(corner + 2) * r);
        colors.push(k, k * (0.8 + 0.2 * light), k * (0.88 + 0.12 * light));
      }
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The vertex positions and colours a sprig's strips go into. */
interface Strips {
  readonly positions: number[];
  readonly colors: number[];
}

/** One strip from `from` to `to`, `width` wide either side of `across`, toned along its length, bent down by `bend`. */
interface Strip {
  readonly from: V3;
  readonly to: V3;
  readonly across: V3;
  readonly width: number;
  readonly tone: (t: number) => V3;
  readonly bend?: number;
}

function needleStrip(out: Strips, strip: Strip): void {
  const { positions, colors } = out;
  const { from, to, across, width, tone } = strip;
  const bend = strip.bend ?? 0;
  // A needle keeps its width to near the end, then closes to a sharp point.
  const stops = bend > 0 ? [0, 0.45, 0.8, 1] : [0, 0.8, 1];
  const point = (t: number): [number, number, number] => [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t - bend * t * t,
    from[2] + (to[2] - from[2]) * t,
  ];
  const span = (t: number): number => width * (t <= 0.8 ? 1 : 0.06);
  for (let index = 0; index < stops.length - 1; index += 1) {
    const t0 = stops[index] ?? 0;
    const t1 = stops[index + 1] ?? 1;
    const p0 = point(t0);
    const p1 = point(t1);
    const w0 = span(t0);
    const w1 = span(t1);
    const a: V3 = [p0[0] - across[0] * w0, p0[1] - across[1] * w0, p0[2] - across[2] * w0];
    const b: V3 = [p0[0] + across[0] * w0, p0[1] + across[1] * w0, p0[2] + across[2] * w0];
    const c: V3 = [p1[0] + across[0] * w1, p1[1] + across[1] * w1, p1[2] + across[2] * w1];
    const d: V3 = [p1[0] - across[0] * w1, p1[1] - across[1] * w1, p1[2] - across[2] * w1];
    for (const [q, t] of [
      [a, t0],
      [b, t0],
      [c, t1],
      [a, t0],
      [c, t1],
      [d, t1],
    ] as const) {
      positions.push(...q);
      colors.push(...tone(t));
    }
  }
}

/** One needle, round from every side: two thin strips crossed along its length. */
function needle(out: Strips, spec: Omit<Strip, "across">): void {
  const { from, to } = spec;
  const along = norm3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  let across: V3 = norm3(...cross3(along, UP));
  if (isZero(across)) across = [1, 0, 0];
  const other = norm3(...cross3(along, across));
  needleStrip(out, { ...spec, across });
  needleStrip(out, { ...spec, across: other });
}

/** A conifer's needle sprig. */
export type NeedleKind = "pine" | "spruce" | "redwood";

/**
 * A conifer sprig for the forest: the same shoot and the same sweep of needles,
 * each one flat and wider, so `count` of them hold the sprig's mass for a tenth
 * of its triangles.
 */
export function lightSprig(lit: LitLike, kind: string, count: number): GeometryLike {
  const strips: Strips = { positions: [], colors: [] };
  const shade = (t: number): V3 => {
    const v = 0.8 + 0.34 * t;
    return [v, v, v];
  };
  const twig = (): V3 => [0.62, 0.6, 0.58];
  const pine = kind === "pine";
  const out = pine ? 0.32 : 0.24;
  const rise = pine ? 0.62 : 0.3;
  const width = (pine ? 0.075 : 0.1) * Math.sqrt(10 / count);
  needleStrip(strips, { from: [0, 0, 0], to: [0, 1, 0], across: [1, 0, 0], width: 0.025, tone: twig });
  for (let index = 0; index < count; index += 1) {
    const t = 0.06 + (index / count) * 0.84;
    const angle = index * 2.39996;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    needleStrip(strips, {
      from: [0, t, 0],
      to: [dx * out, t + rise, dz * out],
      across: [-dz, 0.1, dx],
      width,
      tone: shade,
    });
  }
  return stripGeometry(lit, strips);
}

/** The strips as one geometry with vertex colours. */
function stripGeometry(lit: LitLike, strips: Strips): GeometryLike {
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(strips.positions), 3));
  geometry.setAttribute("color", new lit.Attribute(new Float32Array(strips.colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A grey that brightens along a needle, from `low` at its foot to `high` at its tip. */
const grey =
  (low: number, high: number) =>
  (t: number): V3 => {
    const v = low + (high - low) * t;
    return [v, v, v];
  };

/** The shoot itself, a thin brown-dark line the needles grow from. */
function twig(out: Strips, length: number, tone: V3 = [0.62, 0.6, 0.58]): void {
  needleStrip(out, { from: [0, 0, 0], to: [0, length, 0], across: [1, 0, 0], width: 0.02, tone: () => tone });
  needleStrip(out, { from: [0, 0, 0], to: [0, length, 0], across: [0, 0, 1], width: 0.02, tone: () => tone });
}

/** A shoot lined with bundles of long needles swept forward, a tuft at its tip. */
function pineSprig(out: Strips): void {
  twig(out, 1.0);
  for (let bundle = 0; bundle < 5; bundle += 1) {
    const t = 0.12 + bundle * 0.2;
    for (let index = 0; index < 3; index += 1) {
      const angle = bundle * 2.39996 + (index / 3) * TAU;
      const reach = 0.3 + 0.05 * index;
      const tip: V3 = [Math.cos(angle) * reach, t + 0.62, Math.sin(angle) * reach];
      needle(out, { from: [0, t, 0], to: tip, width: 0.014, tone: grey(0.78, 1.16), bend: 0.06 });
    }
  }
}

/**
 * A brown shoot bristling with short stiff needles all round, ending in a
 * star of needles round a tan bud, as on a blue spruce's branch tips.
 */
function spruceSprig(out: Strips): void {
  twig(out, 1.0, [0.78, 0.52, 0.36]);
  const wax = (s: number): V3 => [0.78 + 0.24 * s, 0.82 + 0.24 * s, 0.84 + 0.26 * s];
  const count = 30;
  for (let index = 0; index < count; index += 1) {
    const t = 0.04 + (index / count) * 0.86;
    const angle = index * 2.39996;
    const reach = 0.24;
    const tip: V3 = [Math.cos(angle) * reach, t + 0.2, Math.sin(angle) * reach];
    needle(out, { from: [0, t, 0], to: tip, width: 0.016, tone: wax });
  }
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU + 0.2;
    const lift = index % 2 === 0 ? 0.24 : 0.08;
    const tip: V3 = [Math.cos(angle) * 0.24, 1.0 + lift, Math.sin(angle) * 0.24];
    needle(out, { from: [0, 0.96, 0], to: tip, width: 0.016, tone: wax });
  }
  const bud = (): V3 => [1.25, 0.95, 0.62];
  needleStrip(out, { from: [0, 0.94, 0], to: [0, 1.08, 0], across: [1, 0, 0], width: 0.05, tone: bud });
  needleStrip(out, { from: [0, 0.94, 0], to: [0, 1.08, 0], across: [0, 0, 1], width: 0.05, tone: bud });
}

/** A redwood's flat spray: short needles in pairs either side of the shoot, longest in the middle. */
function redwoodSprig(out: Strips): void {
  twig(out, 1.1);
  const pairs = 9;
  for (let index = 0; index < pairs; index += 1) {
    const t = 0.08 + (index / pairs) * 0.92;
    const reach = 0.24 * Math.sin(Math.PI * (0.2 + 0.8 * (1 - t))) + 0.06;
    for (const side of [-1, 1]) {
      needleStrip(out, {
        from: [0, t, 0],
        to: [side * reach, t + reach * 0.35, 0],
        across: [0, 0.4, 1],
        width: 0.035,
        tone: grey(0.8, 1.12),
      });
    }
  }
}

/** The needles of one conifer sprig. */
export function needleGeometry(lit: LitLike, kind: NeedleKind): GeometryLike {
  const strips: Strips = { positions: [], colors: [] };
  if (kind === "pine") pineSprig(strips);
  else if (kind === "spruce") spruceSprig(strips);
  else redwoodSprig(strips);
  return stripGeometry(lit, strips);
}

export const NEEDLE_KINDS: Readonly<Record<string, NeedleKind>> = { pine: "pine", spruce: "spruce", redwood: "redwood" };
const needleCache = new WeakMap<LitLike, Map<NeedleKind, GeometryLike>>();

/** A palm leaflet: a long narrow strap, slim at its base, tapering to a point. */
export const PALM_LEAFLET: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.012, 0.04],
  [0.026, 0.18],
  [0.03, 0.4],
  [0.027, 0.62],
  [0.018, 0.82],
  [0.008, 0.94],
  [0, 1],
];
const palmCache = new WeakMap<LitLike, GeometryLike>();

/**
 * The blade a species grows: needles for the conifers, arched straps for a palm, the broad leaf for everything else.
 */
export function speciesBlade(lit: LitLike, speciesId: string): GeometryLike {
  if (speciesId === "palm") {
    let strap = palmCache.get(lit);
    if (!strap) palmCache.set(lit, (strap = bladeGeometry(lit, PALM_LEAFLET, 0.014, 0.24)));
    return strap;
  }
  const kind = NEEDLE_KINDS[speciesId];
  if (!kind) return treeShapes(lit).blade;
  let cache = needleCache.get(lit);
  if (!cache) needleCache.set(lit, (cache = new Map<NeedleKind, GeometryLike>()));
  let geometry = cache.get(kind);
  if (!geometry) cache.set(kind, (geometry = needleGeometry(lit, kind)));
  return geometry;
}

const shapeCache = new WeakMap<LitLike, TreeShapes>();

/**
 * The shared shapes, made once per keel/lit namespace: round wood, low-poly leaf lumps, blades, buds and a unit box.
 */
export function treeShapes(lit: LitLike): TreeShapes {
  let shapes = shapeCache.get(lit);
  if (!shapes) {
    shapes = {
      wood: lit.cylinder(0.5, 0.5, 1, 7, 1),
      leaf: lit.icosahedron(0.56, 0),
      blade: bladeGeometry(lit),
      bud: lit.icosahedron(0.55, 1),
      box: lit.box(1, 1, 1),
      softBlade: softBladeGeometry(lit),
      spray: sprayGeometry(lit),
    };
    shapeCache.set(lit, shapes);
  }
  return shapes;
}
