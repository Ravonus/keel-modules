// Screens, the CPU mirror of the shader: thresholds, tone quantising, cel ramps and palettes in OKLab.

import { bounded } from "./settings.js";
import type { ScreenId } from "./settings.js";

// ---------------------------------------------------------------- screens (CPU mirror of the shader)

const fract = (value: number): number => value - Math.floor(value);
const tri = (value: number, period: number): number => Math.abs(fract(value / period) * 2 - 1);

function bayer2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return fract(fx * 0.5 + fy * fy * 0.75);
}
const bayer4 = (x: number, y: number): number => bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y);
const bayer8 = (x: number, y: number): number => bayer4(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y);

function halftone(x: number, y: number): number {
  const u = fract((x + y + 1) * 0.1767767) - 0.5;
  const v = fract((x - y) * 0.1767767) - 0.5;
  return Math.min(0.999, Math.hypot(u, v) * 1.41421356);
}

function stipple(x: number, y: number): number {
  let hash = (Math.imul(Math.floor(x) >>> 0, 1973) + Math.imul(Math.floor(y) >>> 0, 9277)) | 1;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash & 0xffff) / 65536;
}

const THRESHOLDS: Readonly<Record<ScreenId, (x: number, y: number) => number>> = {
  none: () => 0.5,
  bayer2,
  bayer4,
  bayer8,
  halftone,
  // Line screens have few distinct values; a Bayer tie-break gives them every tone.
  lines: (x, y) => tri(y + 0.5, 4) * 0.7 + bayer4(x, y) * 0.3,
  diagonal: (x, y) => tri(x + y + 0.5, 4) * 0.7 + bayer4(x, y) * 0.3,
  hatch: (x, y) => Math.min(tri(x + y + 0.5, 4), 0.5 + 0.5 * tri(x - y + 0.5, 4)) * 0.75 + bayer4(x, y) * 0.25,
  ign: (x, y) => fract(52.9829189 * fract(0.06711056 * Math.floor(x) + 0.00583715 * Math.floor(y))),
  stipple,
  checker: (x, y) => ((Math.floor(x) + Math.floor(y)) & 1) * 0.5 + 0.25,
};

/** A screen's threshold at an art pixel, 0 to just under 1. The shader computes the same maps. */
export function thresholdAt(screen: ScreenId, x: number, y: number): number {
  return THRESHOLDS[screen](x, y);
}

/** One channel through a screen: `levels` steps, the threshold deciding which neighbour a tone between two lands on. */
export function quantizeTone(value: number, levels: number, threshold: number, amount = 1, snap = 0): number {
  const steps = Math.max(1, levels - 1);
  const t = 0.5 + (threshold - 0.5) * Math.min(1, Math.max(0, amount));
  const scaled = Math.min(1, Math.max(0, value)) * steps;
  const base = Math.floor(scaled);
  const share = Math.min(
    1,
    Math.max(0, (scaled - base - 0.5) / Math.max(1 - Math.min(0.9, Math.max(0, snap)), 0.001) + 0.5),
  );
  return Math.min(steps, Math.max(0, base + (share >= 1 - t ? 1 : 0))) / steps;
}

/** The stepped light a cel ramp of `bands` steps returns, darkest first (0..255). */
export function celRamp(bands: number): Uint8Array {
  const count = Math.round(bounded(bands, 2, 8, 4));
  const ramp = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) ramp[index] = Math.round(255 * (0.3 + 0.7 * (index / (count - 1)) ** 1.2));
  return ramp;
}

export function hexChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** An sRGB colour (0..1) in OKLab: lightness, then green-red and blue-yellow. */
export function okLab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122 * r + 0.5363 * g + 0.0514 * b);
  const m = Math.cbrt(0.2119 * r + 0.6807 * g + 0.1074 * b);
  const s = Math.cbrt(0.0883 * r + 0.2817 * g + 0.63 * b);
  return [
    0.2105 * l + 0.7936 * m - 0.0041 * s,
    1.978 * l - 2.4286 * m + 0.4506 * s,
    0.0259 * l + 0.7828 * m - 0.8087 * s,
  ];
}

/** A palette as the shader's flat vec3[32] (sRGB 0..1) and the same entries in OKLab, plus its length. */
export function paletteUniform(palette: readonly string[]): {
  readonly data: Float32Array;
  readonly lab: Float32Array;
  readonly size: number;
} {
  const data = new Float32Array(96);
  const lab = new Float32Array(96);
  const entries = palette.slice(0, 32);
  entries.forEach((hex, index) => {
    const rgb = hexChannels(hex);
    data.set(rgb, index * 3);
    lab.set(okLab(rgb), index * 3);
  });
  return { data, lab, size: entries.length };
}
