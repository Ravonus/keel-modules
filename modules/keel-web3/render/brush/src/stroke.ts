// A stroke is what the planner hands the brush: a path, a tip, a size, a colour and how the paint behaves. The CPU
// never expands a stroke into dabs: it packs each stroke into 32 floats, and the vertex shader places the dabs.
import { digestOf } from "./exact.js";

/** An sRGB colour, 0..1 a channel. */
export type Rgb = readonly [number, number, number];
/** A point in canvas pixels, x across and y down from the top left. */
export type Point = readonly [number, number];

/** The tip shapes. The numbers are the shader's. */
export const TIP = { round: 0, flat: 1, filbert: 2, rake: 3 } as const;
export type Tip = keyof typeof TIP;
/** How the paint behaves. The numbers are the shader's. */
export const MEDIUM = { oil: 0, glaze: 1, scumble: 2 } as const;
export type Medium = keyof typeof MEDIUM;

/** Points a path may have; floats a stroke takes; the most dabs one stroke lays. */
export const MAX_POINTS = 8;
export const STROKE_FLOATS = 32;
export const MAX_DABS = 128;
/** Dabs are laid this share of the tip's width apart. */
export const SPACING = 0.15;

export interface Stroke {
  /** 2 to 8 points of a quadratic chain: it starts at the first, ends at the last and bends toward the rest. */
  readonly path: readonly Point[];
  readonly tip: Tip;
  /** Half the tip's width, in canvas pixels. */
  readonly size: number;
  readonly colour: Rgb;
  /** 0..1: how opaque the stroke is down its middle. */
  readonly opacity: number;
  readonly medium: Medium;
  /** 0..1: paint on the brush at the start; it runs out along the stroke, and dry paint breaks on the grain. */
  readonly load?: number;
  /** 0..1: how much of what is on the canvas the brush picks up and drags; 2: a clean blender, carrying only that. */
  readonly wet?: number;
  /** Relief the paint leaves, 0..1 at full load. */
  readonly height?: number;
  /** The tip's width at the start and at the end, as shares of `size`. */
  readonly taper?: readonly [number, number];
  /** Bristles of a rake. */
  readonly bristles?: number;
  /** Any integer: which bristle pattern. */
  readonly seed?: number;
}

/** Strokes packed for the GPU, in the order they are painted. */
export interface StrokeBatch {
  readonly data: Float32Array;
  readonly count: number;
  readonly digest: string;
}

/** The length of a path's polygon, in pixels. */
export function pathLength(path: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] ?? [0, 0];
    const b = path[i] ?? a;
    length += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
  }
  return length;
}

/** How long a tip is along the stroke, as a share of its width: a flat is laid edge first. */
export const TIP_LENGTH: Readonly<Record<Tip, number>> = { round: 1, flat: 0.35, filbert: 0.6, rake: 0.5 };

/**
 * How many dabs a stroke lays: one every `SPACING` of the tip's width, at least two, at most `MAX_DABS`.
 *
 * @param path The stroke's path.
 * @param size Half the tip's width.
 * @returns A whole number of dabs.
 */
export function dabsOf(path: readonly Point[], size: number): number {
  const step = SPACING * 2 * Math.max(size, 0.25);
  return Math.min(MAX_DABS, Math.max(2, Math.ceil(pathLength(path) / step) + 1));
}

function check(stroke: Stroke): void {
  const n = stroke.path.length;
  if (n < 2 || n > MAX_POINTS) throw new RangeError(`brush: a path has 2 to ${MAX_POINTS} points, not ${n}.`);
  if (!(stroke.size > 0)) throw new RangeError("brush: a stroke's size is above 0.");
}

function packOne(stroke: Stroke, out: Float32Array, at: number): void {
  const n = stroke.path.length;
  for (let k = 0; k < MAX_POINTS; k += 1) {
    const p = stroke.path[Math.min(k, n - 1)] ?? [0, 0];
    out[at + k * 2] = p[0];
    out[at + k * 2 + 1] = p[1];
  }
  const taper = stroke.taper ?? [1, 1];
  out.set([
    stroke.colour[0], stroke.colour[1], stroke.colour[2], stroke.opacity,
    stroke.size, taper[0], taper[1], stroke.load ?? 1,
    stroke.wet ?? 0, stroke.height ?? 0, TIP[stroke.tip], stroke.bristles ?? 7,
    MEDIUM[stroke.medium], ((stroke.seed ?? 0) % 4096) / 4096, n, dabsOf(stroke.path, stroke.size),
  ], at + 16);
}

/**
 * Strokes into the floats the brush reads, 32 a stroke: eight points, then colour and opacity, size, taper, load,
 * wet, height, tip, bristles, medium, seed, points and dabs.
 *
 * @param strokes In painting order, back first.
 * @returns The batch and its digest.
 */
export function packStrokes(strokes: readonly Stroke[]): StrokeBatch {
  const data = new Float32Array(strokes.length * STROKE_FLOATS);
  strokes.forEach((stroke, i) => {
    check(stroke);
    packOne(stroke, data, i * STROKE_FLOATS);
  });
  return { data, count: strokes.length, digest: digestOf([data]) };
}
