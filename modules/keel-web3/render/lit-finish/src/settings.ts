// Settings, checked and bounded; the AO sample kernel; and the sun carried into the camera's space.

export const TONEMAPS = ["agx", "neutral", "aces"] as const;
export type Tonemap = (typeof TONEMAPS)[number];

/** How a lit picture is finished. */
export interface FinishSettings {
  /** Multiplies the light before the tone map. */
  readonly exposure: number;
  readonly tonemap: Tonemap;
  /** Ambient occlusion strength, 0 (off) to 1. */
  readonly ao: number;
  /** How far round a point AO looks for what shades it, metres. */
  readonly aoRadius: number;
  /** Aerial haze: how much air there is per metre (0 none), and where it starts, metres from the eye. */
  readonly hazeDensity: number;
  readonly hazeStart: number;
  /** How bright the air glows toward the sun, 0 to 2. */
  readonly hazeGlow: number;
  /**
   * What the far plane holds. false: sky, all air. true: a backdrop the camera carries (a painted plate drawn without
   * depth), which keeps its own air: no haze over it, and TAA holds it where it is on screen.
   */
  readonly backdrop: boolean;
  /** After the tone map: saturation 0 to 2, contrast 0.5 to 2. */
  readonly saturation: number;
  readonly contrast: number;
  /** Lights lean warm and shadows cool, 0 to 1. */
  readonly warmth: number;
  /** Darkens the corners, 0 to 1. */
  readonly vignette: number;
  /** How much sunlight comes through leaves and blades, 0 to 2 (in their own shadow, none). */
  readonly translucency: number;
  /** Patches of drier and damper colour across every surface, 0 to 1. */
  readonly variation: number;
  /** Takes the saturation out of the stage's own colours before they are lit, 0 to 1 (a pixel palette is loud). */
  readonly mute: number;
  /** Glow round the brightest light, 0 to 1, from light brighter than `bloomThreshold` (after exposure). */
  readonly bloom: number;
  readonly bloomThreshold: number;
  /** Temporal antialiasing: each frame jittered and blended with the last, reprojected; `taaBlend` is the new share. */
  readonly taa: boolean;
  readonly taaBlend: number;
}

export const DEFAULT_FINISH_SETTINGS: FinishSettings = {
  exposure: 1,
  tonemap: "agx",
  ao: 0.8,
  aoRadius: 1.2,
  hazeDensity: 0.012,
  hazeStart: 4,
  hazeGlow: 0.9,
  backdrop: false,
  saturation: 1.05,
  contrast: 1.18,
  warmth: 0.25,
  vignette: 0.3,
  translucency: 0.8,
  variation: 0.5,
  mute: 0.2,
  bloom: 0.12,
  bloomThreshold: 1,
  taa: true,
  taaBlend: 0.1,
};

type Bag = Readonly<Record<string, unknown>>;

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Normalizes untrusted settings into a complete finish. Anything missing or malformed falls back to the defaults;
 * anything out of range is held to it.
 *
 * @param input Plain settings object, or undefined.
 */
export function finishSettings(input?: unknown): FinishSettings {
  if (input === null || typeof input !== "object") return DEFAULT_FINISH_SETTINGS;
  const v = input as Bag;
  const d = DEFAULT_FINISH_SETTINGS;
  return {
    exposure: bounded(v.exposure, 0, 16, d.exposure),
    tonemap: oneOf(v.tonemap, TONEMAPS, d.tonemap),
    ao: bounded(v.ao, 0, 1, d.ao),
    aoRadius: bounded(v.aoRadius, 0.05, 8, d.aoRadius),
    hazeDensity: bounded(v.hazeDensity, 0, 0.5, d.hazeDensity),
    hazeStart: bounded(v.hazeStart, 0, 10000, d.hazeStart),
    hazeGlow: bounded(v.hazeGlow, 0, 2, d.hazeGlow),
    backdrop: typeof v.backdrop === "boolean" ? v.backdrop : d.backdrop,
    saturation: bounded(v.saturation, 0, 2, d.saturation),
    contrast: bounded(v.contrast, 0.5, 2, d.contrast),
    warmth: bounded(v.warmth, 0, 1, d.warmth),
    vignette: bounded(v.vignette, 0, 1, d.vignette),
    translucency: bounded(v.translucency, 0, 2, d.translucency),
    variation: bounded(v.variation, 0, 1, d.variation),
    mute: bounded(v.mute, 0, 1, d.mute),
    bloom: bounded(v.bloom, 0, 1, d.bloom),
    bloomThreshold: bounded(v.bloomThreshold, 0, 8, d.bloomThreshold),
    taa: typeof v.taa === "boolean" ? v.taa : d.taa,
    taaBlend: bounded(v.taaBlend, 0.02, 1, d.taaBlend),
  };
}

export const AO_SAMPLES = 16;

/**
 * The AO kernel: points in the unit hemisphere round +z, cosine-weighted on a golden-angle spiral and gathered
 * toward the centre, so near occluders count most. The same every run.
 *
 * @param count How many points.
 * @returns x, y, z for each, flat.
 */
export function aoKernel(count = AO_SAMPLES): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = (i + 0.5) / count;
    const r = Math.sqrt(u);
    const phi = i * 2.399963229728653;
    const t = (i + 1) / count;
    const scale = 0.1 + 0.9 * t * t;
    out.push(Math.cos(phi) * r * scale, Math.sin(phi) * r * scale, Math.sqrt(1 - u) * scale);
  }
  return out;
}

/**
 * A world direction in the camera's space: the rotation of its view matrix (column-major, as keel/lit keeps it).
 *
 * @param direction World direction (need not be unit length).
 * @param view The camera's matrixWorldInverse elements.
 * @returns The unit direction in view space, or straight ahead for a zero direction.
 */
export function directionInView(direction: readonly number[], view: ArrayLike<number>): [number, number, number] {
  const [x = 0, y = 0, z = 0] = direction;
  const e = (i: number): number => view[i] ?? 0;
  const out: [number, number, number] = [
    e(0) * x + e(4) * y + e(8) * z,
    e(1) * x + e(5) * y + e(9) * z,
    e(2) * x + e(6) * y + e(10) * z,
  ];
  const length = Math.hypot(out[0], out[1], out[2]);
  return length > 0 ? [out[0] / length, out[1] / length, out[2] / length] : [0, 0, -1];
}

const HEX = /^#[0-9a-f]{6}$/iu;
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A colour as linear RGB: "#rrggbb" (sRGB) or [r, g, b] already linear.
 *
 * @param value The colour.
 * @param fallback Used when the colour is malformed.
 */
export function linearColour(value: unknown, fallback: readonly [number, number, number]): [number, number, number] {
  if (typeof value === "string" && HEX.test(value)) {
    const n = Number.parseInt(value.slice(1), 16);
    return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
  }
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((c) => typeof c === "number" && Number.isFinite(c))) {
    const [r, g, b] = value as number[];
    return [Math.max(0, r ?? 0), Math.max(0, g ?? 0), Math.max(0, b ?? 0)];
  }
  return [fallback[0], fallback[1], fallback[2]];
}

/**
 * Two column-major 4x4 matrices multiplied, a then b applied last (a * b, as keel/lit's Matrix4.multiplyMatrices).
 *
 * @param a The left matrix.
 * @param b The right matrix.
 */
export function multiply4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    f /= base;
    r += f * (i % base);
  }
  return r;
}

/**
 * This frame's subpixel jitter for TAA: Halton (2, 3) over eight frames, in pixels, -0.5 to 0.5.
 *
 * @param frame The frame number.
 */
export function jitterAt(frame: number): [number, number] {
  const i = (Math.floor(frame) % 8) + 1;
  return [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
}

/**
 * Whole pixels to move a 4x4 dither by this frame, so over sixteen frames every pixel meets every threshold and a
 * dithered fade averages, under TAA, to its real cover.
 *
 * @param frame The frame number.
 */
export function ditherShiftAt(frame: number): [number, number] {
  const i = Math.floor(frame) % 16;
  return [i % 4, Math.floor(i / 4)];
}
