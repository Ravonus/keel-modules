// A dab is one shape the GPU draws on a quad: a soft blot, a spire of a tree, a round crown, a wall, a leaf or a
// stem. Each is 16 floats in an instance buffer; the shapes themselves are in paint.glsl.ts.

/** An sRGB colour, 0..1 a channel. */
export type Rgb = readonly [number, number, number];

/** The shapes a dab can take. The numbers are the shader's. */
export const KIND = { blot: 0, spire: 1, crown: 2, wall: 3, leaf: 4, stem: 5 } as const;

/** Floats per dab in the instance buffer. */
export const STRIDE = 16;

/** One dab. Position in plate fractions; sizes and axis in plate heights (x scaled by the aspect). */
export interface Dab {
  /** Centre, x across and y down, 0..1. */
  readonly x: number;
  readonly y: number;
  /** Half its length along the axis and half its width across it. */
  readonly len: number;
  readonly wid: number;
  /** A unit vector from its foot or stalk toward its tip. */
  readonly ax: number;
  readonly ay: number;
  readonly kind: number;
  /** 0..1, varies the shape's detail. */
  readonly seed: number;
  readonly color: Rgb;
  readonly alpha: number;
  /** How much light falls on it, 0..1. */
  readonly light: number;
  /** Lobes for a leaf (1, 3 or 5); the shaded side's share for a wall. */
  readonly variant: number;
  /** For a reflection: the waterline y it is clipped to. 0 is no reflection. */
  readonly water: number;
  /** Depth steps toward the haze. */
  readonly depth: number;
}

/** `#rrggbb` to 0..1 channels. */
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  if (hex.length !== 7 || !Number.isInteger(n)) throw new TypeError(`plate-painter: "${hex}" is not #rrggbb.`);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The colour `t` of the way from `a` to `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Dabs as an instance buffer, in the order given (back first). */
export function packDabs(dabs: readonly Dab[]): Float32Array {
  const out = new Float32Array(dabs.length * STRIDE);
  dabs.forEach((d, i) => {
    out.set([d.x, d.y, d.len, d.wid, d.ax, d.ay, d.kind, d.seed, d.color[0], d.color[1], d.color[2], d.alpha,
      d.light, d.variant, d.water, d.depth], i * STRIDE);
  });
  return out;
}
