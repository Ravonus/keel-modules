/**
 * Dithered voxel pixel art for any keel/lit stage. MIT.
 *
 * The scene is drawn at a low, integer-scaled resolution and only ever SHOWN
 * through a dither screen: a threshold map plus a few tone steps, or a fixed
 * palette. Each art pixel picks its screen by depth band (near things crisp
 * and structured, far things fine and calm), carries a one-pixel silhouette
 * outline and voxel creases, and can be cel-lit through stepped toon ramps.
 *
 * Every screen is a pure function of the art pixel, never of time or of a
 * neighbour's error, so a pixel whose light does not change never changes
 * colour and the picture does not crawl.
 *
 *   const look = createVoxelDither(lit, renderer, { style: "smart" });
 *   look.setSize(cssWidth, cssHeight, devicePixelRatio);
 *   look.shade(scene);                       // after building or rebuilding the scene
 *   renderer.setAnimationLoop(() => look.render(scene, camera));
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 *
 * Outlines and creases come from the depth buffer, so anything drawn with
 * `depthWrite: false` (rain, sparks, glows) is still dithered but never outlined.
 */

// ---------------------------------------------------------------- vocabulary

/** Threshold maps, in the order the shader numbers them. */
export const SCREENS = ["none", "bayer2", "bayer4", "bayer8", "halftone", "lines", "diagonal", "hatch", "ign", "stipple", "checker"] as const;
export type ScreenId = (typeof SCREENS)[number];
/** A screen, or "auto": chosen per depth band from the grid size. */
export type ScreenChoice = ScreenId | "auto";
/** "cel" swaps lit materials for stepped toon ramps; "smooth" leaves the scene's own lighting. */
export type Shading = "cel" | "smooth";
/** "rgb" steps each channel; "luma" steps lightness finer than colour, so shading reads as ramps. */
export type ColorMode = "rgb" | "luma";
export type DepthBand = "near" | "mid" | "far";

/** One depth band's screen: which map, read at 1/scale, with this much of its spread. */
export interface BandScreen {
  readonly screen: ScreenId;
  readonly scale: number;
  readonly amount: number;
}
export type BandScreens = Readonly<Record<DepthBand, BandScreen>>;

/** A complete, normalized look. Every member has a safe default. */
export interface DitherSettings {
  /** The preset this look started from. */
  readonly style: StyleId;
  readonly screen: ScreenChoice;
  /** CSS pixels per art pixel, 1 to 12; 0 picks one from the frame size. */
  readonly pixel: number;
  /** Tone steps per channel, 2 to 16 (ignored when a palette is set). */
  readonly levels: number;
  readonly color: ColorMode;
  /** Up to 32 #rrggbb entries; when set, every pixel is one of them. */
  readonly palette: readonly string[];
  /** How much of the screen's spread is used, 0 (posterized) to 1. */
  readonly amount: number;
  /**
   * 0 to 0.9: how much of each step between two tones snaps flat instead of
   * dithering. 0 dithers every in-between tone; higher keeps flats clean and
   * leaves a short dithered seam where one tone meets the next, as pixel art does.
   */
  readonly snap: number;
  /** 0 to 0.3: lifts the darkest tones toward a cool blue, so night never crushes to black (ink stays dark). */
  readonly lift: number;
  /** 0 to 1: gathers sub-pixel speckle (leaves, blossom, turf) into masses of one tone; silhouettes stay sharp. */
  readonly clump: number;
  /** 0 to 1: hue-shifted ramps, as pixel artists paint them: lights lean warm, shadows cool. */
  readonly ramp: number;
  readonly shading: Shading;
  /** Cel light steps, 2 to 8. */
  readonly bands: number;
  /** Silhouette outline strength, 0 to 1. */
  readonly outline: number;
  /** A fixed outline ink, or null to darken each pixel's own colour. */
  readonly outlineColor: string | null;
  /** Inner voxel-edge strength, 0 to 1. */
  readonly crease: number;
  readonly contrast: number;
  readonly saturation: number;
  /** View distances where near turns mid and mid turns far. */
  readonly depthBands: readonly [number, number];
  /** God-ray strength multiplier, 0 (off) to 2. The rays themselves come from `setRays`. */
  readonly rays: number;
  /** View distance from which a pixel counts as open sky (it lets light through); 0 means the camera's far plane. */
  readonly skyDistance: number;
  /** CRT scanlines across every art-pixel row, 0 (off) to 1. */
  readonly scanlines: number;
  /** Colour fringe: red and blue drift sideways off the image, 0 (off) to 1. */
  readonly chroma: number;
  /**
   * Signal glitch, 0 (off) to 1: bursts that tear rows sideways and drop blocks
   * of the frame out of place. Higher means more often and more violent.
   * Bursts follow the time given to `setTime`, so a still frame never glitches.
   */
  readonly glitch: number;
}

type StyleFields = Partial<Omit<DitherSettings, "style">> & { readonly label: string };

/** PICO-8's sixteen: the fantasy-console palette, bold and warm. */
const PICO_16 = ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"];
/** DawnBringer's thirty-two, the classic pixel-art ramps. */
const DB_32 = ["#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a", "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74", "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87", "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30"];
/** Risograph inks on cream paper, with the light tints of pink and blue a riso screen gives. */
const RISO_10 = ["#f3ead6", "#1e1c2a", "#2f8fc4", "#e2477d", "#f4c542", "#d9503f", "#3c9a63", "#3e4597", "#f4a8c6", "#a8cde4"];
const BLOSSOM_16 = ["#1b1726", "#3a2d45", "#5c4363", "#8a5a78", "#c77d97", "#f0a8bd", "#ffd9e2", "#fff6ef", "#2e4a3c", "#4f7a52", "#8fb36a", "#d6e59a", "#6b4a3a", "#a0705a", "#7fa7c9", "#cfe3ef"];

/** Named looks. A setting given alongside `style` overrides the preset's. */
export const DITHER_STYLES = {
  pixel: { label: "3D pixel art", screen: "bayer4", pixel: 4, levels: 5, snap: 0.45, lift: 0.07, clump: 0.6, ramp: 0.6, color: "luma", shading: "cel", bands: 3, outline: 1, crease: 0.3, contrast: 1.25, saturation: 1.45 },
  smart: { label: "Smart voxel", screen: "auto", pixel: 0, levels: 6, lift: 0.03, clump: 0.5, ramp: 0.35, color: "luma", shading: "cel", bands: 4, outline: 0.9, crease: 0.35, contrast: 1.05, saturation: 1.1 },
  bayer: { label: "Bayer 32", screen: "bayer4", pixel: 4, palette: DB_32, lift: 0.04, shading: "cel", bands: 3, outline: 0.85, crease: 0.25, contrast: 1.1, saturation: 1.25 },
  soft: { label: "Soft ordered", screen: "bayer8", pixel: 3, levels: 5, lift: 0.12, clump: 0.4, ramp: 0.3, color: "luma", shading: "smooth", outline: 0.5, crease: 0.2, contrast: 0.92, saturation: 0.95 },
  halftone: { label: "Riso print", screen: "halftone", pixel: 2, palette: RISO_10, shading: "smooth", outline: 0.7, outlineColor: "#3e4597", crease: 0, contrast: 1.15, saturation: 1.3 },
  engraving: { label: "Engraving", screen: "hatch", pixel: 2, levels: 3, color: "luma", shading: "smooth", outline: 1, outlineColor: "#1d1a24", crease: 0.3, saturation: 0.55, rays: 1.3 },
  chunky: { label: "Chunky 8-bit", screen: "bayer2", pixel: 6, palette: PICO_16, clump: 0.5, shading: "cel", bands: 3, outline: 1, crease: 0.4, contrast: 1.15, saturation: 1.3 },
  grain: { label: "Film grain", screen: "ign", pixel: 2, levels: 6, lift: 0.14, ramp: 1, color: "luma", shading: "smooth", outline: 0.4, crease: 0.1, contrast: 1.2, saturation: 0.8 },
  blossom: { label: "Blossom 16", screen: "bayer4", pixel: 3, palette: BLOSSOM_16, shading: "cel", bands: 4, outline: 0.9, crease: 0.3 },
  pocket: { label: "Pocket green", screen: "bayer4", pixel: 4, palette: ["#0f2a1d", "#2f5a35", "#7a9a4a", "#cddc8a"], shading: "cel", bands: 3, outline: 0, crease: 0, saturation: 1, rays: 0.6 },
  clean: { label: "Clean cel", screen: "none", pixel: 3, levels: 5, clump: 1, lift: 0.05, color: "luma", shading: "cel", bands: 3, outline: 1, outlineColor: "#241a2e", crease: 0.5, contrast: 1.15, saturation: 1.35 },
  crt: { label: "CRT painted", screen: "bayer8", pixel: 2, levels: 7, snap: 0.75, color: "luma", shading: "smooth", outline: 1, outlineColor: "#0b0d22", crease: 0.15, contrast: 1.3, saturation: 1.55, scanlines: 0.55, chroma: 0.5 },
} as const satisfies Readonly<Record<string, StyleFields>>;
export type StyleId = keyof typeof DITHER_STYLES;
export const STYLE_IDS = Object.keys(DITHER_STYLES) as readonly StyleId[];

export const DEFAULT_DITHER_SETTINGS: DitherSettings = {
  style: "smart",
  screen: "auto",
  pixel: 0,
  levels: 6,
  color: "luma",
  palette: [],
  amount: 1,
  snap: 0,
  lift: 0,
  clump: 0,
  ramp: 0,
  shading: "cel",
  bands: 4,
  outline: 0.9,
  outlineColor: null,
  crease: 0.35,
  contrast: 1.05,
  saturation: 1.1,
  depthBands: [18, 30],
  rays: 1,
  skyDistance: 0,
  scanlines: 0,
  chroma: 0,
  glitch: 0,
};

// ---------------------------------------------------------------- settings

const HEX = /^#[0-9a-f]{6}$/iu;
type Bag = Readonly<Record<string, unknown>>;

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function hexOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
}

function paletteOf(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string" && HEX.test(entry)).slice(0, 32).map((entry) => entry.toLowerCase());
}

function depthBandsOf(value: unknown, fallback: readonly [number, number]): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const near = bounded(value[0], 0.1, 1000, fallback[0]);
  return [near, bounded(value[1], near, 1000, Math.max(near, fallback[1]))];
}

/** The preset a style id names, merged over the defaults. */
function presetOf(style: StyleId): DitherSettings {
  const fields = Object.fromEntries(Object.entries(DITHER_STYLES[style]).filter(([key]) => key !== "label")) as Partial<DitherSettings>;
  return { ...DEFAULT_DITHER_SETTINGS, ...fields, style };
}

function toneFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "levels" | "color" | "palette" | "amount" | "snap" | "lift" | "clump" | "ramp" | "contrast" | "saturation"> {
  return {
    levels: Math.round(bounded(value.levels, 2, 16, base.levels)),
    color: oneOf(value.color, ["rgb", "luma"], base.color),
    palette: paletteOf(value.palette, base.palette),
    amount: bounded(value.amount, 0, 1, base.amount),
    snap: bounded(value.snap, 0, 0.9, base.snap),
    lift: bounded(value.lift, 0, 0.3, base.lift),
    clump: bounded(value.clump, 0, 1, base.clump),
    ramp: bounded(value.ramp, 0, 1, base.ramp),
    contrast: bounded(value.contrast, 0.5, 2, base.contrast),
    saturation: bounded(value.saturation, 0, 2, base.saturation),
  };
}

function signalFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "scanlines" | "chroma" | "glitch"> {
  return {
    scanlines: bounded(value.scanlines, 0, 1, base.scanlines),
    chroma: bounded(value.chroma, 0, 1, base.chroma),
    glitch: bounded(value.glitch, 0, 1, base.glitch),
  };
}

function formFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "screen" | "pixel" | "shading" | "bands" | "outline" | "outlineColor" | "crease" | "depthBands" | "rays" | "skyDistance"> {
  return {
    screen: oneOf<ScreenChoice>(value.screen, ["auto", ...SCREENS], base.screen),
    pixel: Math.round(bounded(value.pixel, 0, 12, base.pixel)),
    shading: oneOf(value.shading, ["cel", "smooth"], base.shading),
    bands: Math.round(bounded(value.bands, 2, 8, base.bands)),
    outline: bounded(value.outline, 0, 1, base.outline),
    outlineColor: hexOrNull(value.outlineColor, base.outlineColor),
    crease: bounded(value.crease, 0, 1, base.crease),
    depthBands: depthBandsOf(value.depthBands, base.depthBands),
    rays: bounded(value.rays, 0, 2, base.rays),
    skyDistance: bounded(value.skyDistance, 0, 100000, base.skyDistance),
  };
}

/**
 * Normalizes untrusted settings into a complete look. `style` picks a preset;
 * any other member given overrides it. Anything missing or malformed falls
 * back to the preset, then to the defaults.
 *
 * @param input Plain settings object (usually `KEEL_INPUTS["voxel-dither"]`), or undefined.
 */
export function ditherSettings(input?: unknown): DitherSettings {
  if (input === null || typeof input !== "object") return DEFAULT_DITHER_SETTINGS;
  const value = input as Bag;
  const base = presetOf(oneOf(value.style, STYLE_IDS, DEFAULT_DITHER_SETTINGS.style));
  return { ...base, ...toneFields(value, base), ...formFields(value, base), ...signalFields(value, base) };
}

// ---------------------------------------------------------------- grid

/** The art-pixel grid for a frame: its size, the device pixels each art pixel covers, and where it starts. */
export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  /** Device pixels per art pixel (a whole number, so every pixel is the same size). */
  readonly pixel: number;
  /** Device-pixel offset that centres the grid in the frame (zero or negative). */
  readonly originX: number;
  readonly originY: number;
}

/** CSS pixels per art pixel when `pixel` is 0: about 210 art pixels on the short side, 2 to 6 px each. */
export function autoPixel(cssWidth: number, cssHeight: number): number {
  const short = Math.max(1, Math.min(cssWidth, cssHeight));
  return Math.min(6, Math.max(2, Math.round(short / 210)));
}

/**
 * Resolves the art-pixel grid for a frame. Art pixels are a whole number of
 * device pixels, so the picture never has uneven rows; the grid overhangs the
 * frame by under one art pixel and is centred.
 */
export function resolveGrid(cssWidth: number, cssHeight: number, devicePixelRatio: number, settings: DitherSettings): PixelGrid {
  const ratio = bounded(devicePixelRatio, 0.5, 4, 1);
  const css = settings.pixel === 0 ? autoPixel(cssWidth, cssHeight) : settings.pixel;
  const pixel = Math.max(1, Math.round(css * ratio));
  // The renderer sizes its canvas as floor(css * ratio); the grid matches it exactly.
  const deviceWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const deviceHeight = Math.max(1, Math.floor(cssHeight * ratio));
  const width = Math.ceil(deviceWidth / pixel);
  const height = Math.ceil(deviceHeight / pixel);
  return { width, height, pixel, originX: Math.floor((deviceWidth - width * pixel) / 2), originY: Math.floor((deviceHeight - height * pixel) / 2) };
}

/**
 * The screens a look wears in each depth band. A fixed screen is worn
 * everywhere, softer with distance. "auto" picks by grid size: a small grid
 * needs a 2x2 lattice to have room for tone, a large one can afford a fine
 * matrix throughout and a fine grain only far away. Distance always flattens
 * the screen's spread, so far things snap to calm fills.
 */
export function bandScreens(settings: DitherSettings, gridShort: number): BandScreens {
  const amount = settings.amount;
  if (settings.screen !== "auto") {
    const screen = settings.screen;
    return { near: { screen, scale: 1, amount }, mid: { screen, scale: 1, amount: amount * 0.85 }, far: { screen, scale: 1, amount: amount * 0.6 } };
  }
  if (gridShort < 128) {
    return { near: { screen: "bayer2", scale: 1, amount }, mid: { screen: "bayer2", scale: 1, amount: amount * 0.8 }, far: { screen: "checker", scale: 1, amount: amount * 0.5 } };
  }
  if (gridShort < 260) {
    return { near: { screen: "bayer4", scale: 1, amount }, mid: { screen: "bayer8", scale: 1, amount: amount * 0.8 }, far: { screen: "bayer8", scale: 1, amount: amount * 0.5 } };
  }
  return { near: { screen: "bayer8", scale: 1, amount }, mid: { screen: "bayer8", scale: 1, amount: amount * 0.8 }, far: { screen: "ign", scale: 1, amount: amount * 0.45 } };
}

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
  const share = Math.min(1, Math.max(0, (scaled - base - 0.5) / Math.max(1 - Math.min(0.9, Math.max(0, snap)), 0.001) + 0.5));
  return Math.min(steps, Math.max(0, base + (share >= 1 - t ? 1 : 0))) / steps;
}

/** The stepped light a cel ramp of `bands` steps returns, darkest first (0..255). */
export function celRamp(bands: number): Uint8Array {
  const count = Math.round(bounded(bands, 2, 8, 4));
  const ramp = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) ramp[index] = Math.round(255 * (0.3 + 0.7 * (index / (count - 1)) ** 1.2));
  return ramp;
}

function hexChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** An sRGB colour (0..1) in OKLab: lightness, then green-red and blue-yellow. */
export function okLab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const l = Math.cbrt(0.4122 * r + 0.5363 * g + 0.0514 * b);
  const m = Math.cbrt(0.2119 * r + 0.6807 * g + 0.1074 * b);
  const s = Math.cbrt(0.0883 * r + 0.2817 * g + 0.63 * b);
  return [0.2105 * l + 0.7936 * m - 0.0041 * s, 1.978 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
}

/** A palette as the shader's flat vec3[32] (sRGB 0..1) and the same entries in OKLab, plus its length. */
export function paletteUniform(palette: readonly string[]): { readonly data: Float32Array; readonly lab: Float32Array; readonly size: number } {
  const data = new Float32Array(96);
  const lab = new Float32Array(96);
  const entries = palette.slice(0, 32);
  entries.forEach((hex, index) => { const rgb = hexChannels(hex); data.set(rgb, index * 3); lab.set(okLab(rgb), index * 3); });
  return { data, lab, size: entries.length };
}

// ---------------------------------------------------------------- shader

const SCREEN_GLSL = /* glsl */ `
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float tri(float v, float p) { return abs(fract(v / p) * 2.0 - 1.0); }
float halftone(vec2 a) {
  vec2 f = fract(vec2(a.x + a.y + 1.0, a.x - a.y) * 0.1767767) - 0.5;
  return min(0.999, length(f) * 1.41421356);
}
float stipple(vec2 a) {
  uint h = (uint(a.x) * 1973u + uint(a.y) * 9277u) | 1u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h & 0xffffu) / 65536.0;
}
float screenAt(float id, vec2 a) {
  int s = int(id + 0.5);
  if (s == 1) return bayer2(a);
  if (s == 2) return bayer4(a);
  if (s == 3) return bayer8(a);
  if (s == 4) return halftone(a);
  if (s == 5) return tri(a.y + 0.5, 4.0) * 0.7 + bayer4(a) * 0.3;
  if (s == 6) return tri(a.x + a.y + 0.5, 4.0) * 0.7 + bayer4(a) * 0.3;
  if (s == 7) return min(tri(a.x + a.y + 0.5, 4.0), 0.5 + 0.5 * tri(a.x - a.y + 0.5, 4.0)) * 0.75 + bayer4(a) * 0.25;
  if (s == 8) return fract(52.9829189 * fract(0.06711056 * a.x + 0.00583715 * a.y));
  if (s == 9) return stipple(a);
  if (s == 10) return mod(a.x + a.y, 2.0) * 0.5 + 0.25;
  return 0.5;
}
`;

const VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT_GLSL = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uGrid;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform vec3 uScreen;
uniform vec3 uScale;
uniform vec3 uAmount;
uniform vec2 uBands;
uniform float uLevels;
uniform float uSnap;
uniform float uLift;
uniform float uClump;
uniform float uRamp;
uniform float uLuma;
uniform int uPaletteSize;
uniform vec3 uPalette[32];
uniform vec3 uPaletteLab[32];
uniform float uOutline;
uniform vec4 uOutlineColor;
uniform float uCrease;
uniform float uContrast;
uniform float uSaturation;
uniform float uSkyFrom;
uniform vec2 uRaySource;
uniform vec3 uRayColor;
uniform float uRayStrength;
uniform float uRayDecay;
uniform float uRayDensity;
uniform float uScanlines;
uniform float uChroma;
uniform float uGlitch;
uniform float uTime;
// Per-part signals: x scanlines, y chroma, z glitch, for the parts tagged 1, 2 and 3.
uniform vec3 uSignal[3];
// Per-part filters: x the filter's number in SIGNAL_FILTERS, y its amount.
uniform vec2 uFilter[3];
${SCREEN_GLSL}
vec2 cellUv(vec2 cell) { return (clamp(cell, vec2(0.0), uGrid - 1.0) + 0.5) / uGrid; }
float distanceAt(vec2 cell) {
  float d = texture2D(tDepth, cellUv(cell)).x;
  if (d >= 0.99999) return uFar;
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
// God rays: walk from the pixel toward the light, gathering the open sky the
// walk crosses. Trees and terrain block it, so shafts fall between them. The
// result is added in continuous light and only then stepped, so the shafts
// come out as dithered bands.
vec3 godRays(vec2 cell) {
  if (uRayStrength <= 0.001) return vec3(0.0);
  vec2 uv = (cell + 0.5) / uGrid;
  vec2 step = (uv - uRaySource) * uRayDensity / 40.0;
  vec2 aspect = vec2(uGrid.x / uGrid.y, 1.0);
  vec2 p = uv;
  float weight = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 40; i++) {
    p -= step;
    float open = distanceAt(floor(clamp(p, 0.0, 0.9999) * uGrid)) >= uSkyFrom ? 1.0 : 0.0;
    float near = 0.3 + 0.7 * exp(-3.5 * length((p - uRaySource) * aspect));
    sum += open * near * weight;
    weight *= uRayDecay;
  }
  return uRayColor * (sum / 40.0) * uRayStrength;
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
// One step: the share past the lower tone, squeezed by uSnap so most of it
// snaps flat and only the middle of the step dithers.
float snapStep(float value, float t) {
  float base = floor(value);
  float share = clamp((value - base - 0.5) / max(1.0 - uSnap, 0.001) + 0.5, 0.0, 1.0);
  return base + step(1.0 - t, share);
}
vec3 stepTones(vec3 c, float t) {
  float steps = max(1.0, uLevels - 1.0);
  if (uLuma < 0.5) {
    // Dither between two step colours only, never off-hue confetti.
    vec3 q = floor(c * steps + 0.5);
    vec3 e = c * steps - q;
    vec3 a = abs(e);
    vec3 lean = step(0.5 * max(a.x, max(a.y, a.z)) + 0.001, a);
    float share = dot(a, lean) / max(1.0, dot(lean, vec3(1.0)));
    share = clamp((share - 0.5) / max(1.0 - uSnap, 0.001) + 0.5, 0.0, 1.0);
    return clamp((q + sign(e) * lean * step(1.0 - t, share)) / steps, 0.0, 1.0);
  }
  // YCoCg: lightness gets twice the steps of colour, so shading reads as ramps.
  float y = dot(c, vec3(0.25, 0.5, 0.25));
  float co = 0.5 * (c.r - c.b);
  float cg = -0.25 * c.r + 0.5 * c.g - 0.25 * c.b;
  // Colour dithers gently; warm-cool steps finely, so a pale sky or night navy keeps its hue. Grey stays grey.
  float ys = steps * 2.0;
  float cs = steps * 2.0 + 2.0;
  float tc = 0.5 + (t - 0.5) * 0.35;
  y = snapStep(y * ys, t) / ys;
  co = snapStep(co * cs * 2.0, tc) / (cs * 2.0);
  cg = snapStep(cg * cs, tc) / cs;
  return clamp(vec3(y + co - cg, y + cg, y - co - cg), 0.0, 1.0);
}
// OKLab, so the nearest palette entry is the one that looks nearest.
vec3 okLab(vec3 c) {
  c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  vec3 lms = pow(max(mat3(0.4122, 0.2119, 0.0883, 0.5363, 0.6807, 0.2817, 0.0514, 0.1074, 0.63) * c, 0.0), vec3(1.0 / 3.0));
  return mat3(0.2105, 1.978, 0.0259, 0.7936, -2.4286, 0.7828, -0.0041, 0.4506, -0.8087) * lms;
}
vec3 stepPalette(vec3 c, float t) {
  vec3 best = c; vec3 next = c; vec3 bl = c; vec3 nl = c;
  float bd = 1e9; float nd = 1e9;
  vec3 lab = okLab(c);
  for (int i = 0; i < 32; i++) {
    if (i >= uPaletteSize) break;
    // Hue outweighs lightness: a pale sky picks a pale blue, not a grey.
    vec3 e = (uPaletteLab[i] - lab) * vec3(1.0, 1.6, 1.6);
    float d = dot(e, e);
    if (d < bd) { nd = bd; next = best; nl = bl; bd = d; best = uPalette[i]; bl = uPaletteLab[i]; }
    else if (d < nd) { nd = d; next = uPalette[i]; nl = uPaletteLab[i]; }
  }
  // Only neighbours on a ramp dither; far-apart entries meet in a clean edge.
  float m = sqrt(bd) / max(1e-5, sqrt(bd) + sqrt(nd)) * clamp(1.6 - 3.0 * length(bl - nl), 0.0, 1.0);
  return t < m ? next : best;
}
float signalHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// The part a pixel belongs to, from the alpha its material wrote (see tagSignal):
// 0 untagged, else 1 to 3.
int partAt(vec2 cell) {
  float a = texture2D(tColor, cellUv(cell)).a;
  return a < 0.375 ? 1 : a < 0.625 ? 2 : a < 0.875 ? 3 : 0;
}
vec3 signalOf(int part) {
  vec3 own = part == 1 ? uSignal[0] : part == 2 ? uSignal[1] : part == 3 ? uSignal[2] : vec3(0.0);
  return max(own, vec3(uScanlines, uChroma, uGlitch));
}
// A burst lasts one eighth of a second; each part keeps its own timing, and how
// many of its slots burst grows with its glitch strength.
float burstOf(float strength, float part) {
  if (strength <= 0.0) return 0.0;
  return step(1.0 - strength * 0.16, signalHash(vec2(floor(uTime * 8.0), 1.7 + part * 13.1)));
}
// Where a bursting part reads from: bands of rows slide sideways (carrying the
// part's silhouette out over its neighbours), and one block of the part shows
// what sits above it, so sky tears into it.
vec2 tornCell(vec2 cell, float strength, float part) {
  float slot = floor(uTime * 8.0) + part * 31.0;
  float rows = floor(cell.y / (2.0 + floor(signalHash(vec2(slot, 3.1)) * 6.0)));
  if (signalHash(vec2(rows, slot)) > 1.0 - 0.5 * strength) cell.x += floor((signalHash(vec2(rows, slot + 9.0)) - 0.5) * uGrid.x * 0.12 * strength);
  return clamp(cell, vec2(0.0), uGrid - 1.0);
}
bool inTearBlock(vec2 cell, float part) {
  float slot = floor(uTime * 8.0) + part * 31.0;
  vec2 size = uGrid * vec2(0.12 + 0.2 * signalHash(vec2(slot, 5.0)), 0.02 + 0.035 * signalHash(vec2(slot, 6.0)));
  vec2 origin = vec2(signalHash(vec2(slot, 7.0)), signalHash(vec2(slot, 8.0))) * uGrid;
  return all(greaterThan(cell, origin)) && all(lessThan(cell, origin + size));
}
vec2 glitchCell(vec2 cell, int part) {
  for (int k = 1; k <= 3; k++) {
    float strength = signalOf(k).z;
    if (burstOf(strength, float(k)) < 0.5) continue;
    vec2 source = tornCell(cell, strength, float(k));
    if (part == k && inTearBlock(cell, float(k))) return clamp(source + vec2(0.0, floor(uGrid.y * 0.06)), vec2(0.0), uGrid - 1.0);
    if (part == k || partAt(source) == k) return source;
  }
  return cell;
}
vec2 filterOf(int part) { return part == 1 ? uFilter[0] : part == 2 ? uFilter[1] : part == 3 ? uFilter[2] : vec2(0.0); }
bool isFilter(vec2 f, float id) { return f.y > 0.0 && abs(f.x - id) < 0.5; }
vec3 rgbAt(vec2 cell) { return toSrgb(texture2D(tColor, cellUv(cell)).rgb); }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hueOf(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// Filters that move pixels: where a filtered part reads from. Every offset is a
// whole art pixel, so a filter never smears the grid.
vec2 filterCell(vec2 cell, vec2 f, int part) {
  float a = f.y;
  // mosaic: the part is drawn in blocks of 2 to 4 art pixels
  if (isFilter(f, 3.0)) { float k = 2.0 + floor(a * 2.0); cell = floor(cell / k) * k + floor(k * 0.5); }
  // vhs: rows wobble, and a band of tracking noise rolls up the frame
  if (isFilter(f, 7.0)) {
    float band = 1.0 - smoothstep(0.0, 5.0, abs(cell.y - fract(uTime * 0.06) * uGrid.y));
    cell.x += floor(sin(cell.y * 0.37 + uTime * 2.7) * a * 1.4 + band * a * 7.0 * (signalHash(vec2(cell.y, floor(uTime * 12.0))) - 0.5));
  }
  // wave: heat haze, rows sway on a slow sine
  if (isFilter(f, 9.0)) cell.x += floor(sin(cell.y * 0.22 + uTime * 2.1) * (1.0 + 2.5 * a) + 0.5);
  // slitscan: each row shows the part at its own moment, so the part shears and unshears
  if (isFilter(f, 15.0)) cell.x += floor(sin(cell.y * 0.045 - uTime * 0.9) * uGrid.x * 0.035 * a + 0.5);
  // datamosh: blocks of the part jump and stick for half a second
  if (isFilter(f, 17.0)) {
    vec2 block = floor(cell / 6.0);
    float slot = floor(uTime * 2.0);
    if (signalHash(block + slot * 7.31) > 1.0 - 0.32 * a) cell += floor((vec2(signalHash(block + slot), signalHash(block - slot + 3.0)) - 0.5) * 14.0 * a);
  }
  // pixel sort: bright runs of the part drip down over darker pixels below them
  if (isFilter(f, 16.0)) {
    vec2 pick = cell;
    float best = 0.42;
    for (int k = 1; k <= 14; k++) {
      if (float(k) > 14.0 * a) break;
      vec2 p = clamp(cell + vec2(0.0, float(k)), vec2(0.0), uGrid - 1.0);
      if (partAt(p) != part) break;
      float l = lumaOf(rgbAt(p));
      if (l > best + 0.03) { best = l; pick = p; }
    }
    cell = pick;
  }
  return clamp(cell, vec2(0.0), uGrid - 1.0);
}
// Filters that change colour, applied before the tones are stepped, so a
// filtered part is still dithered pixel art.
vec3 filterColor(vec3 c, vec2 cell, vec2 f, float edge) {
  if (f.y <= 0.0) return c;
  float a = clamp(f.y, 0.0, 1.0);
  float l = lumaOf(c);
  float frame = floor(uTime * 12.0);
  vec3 o = c;
  // snow: static speckles
  if (isFilter(f, 1.0)) o = mix(c, vec3(signalHash(cell + frame * 1.37)), step(1.0 - 0.22 * a, signalHash(cell * 1.31 + frame)));
  // film: sepia, a little grain, and the gate's flicker
  if (isFilter(f, 2.0)) o = vec3(l * 1.07 + 0.05, l * 0.9 + 0.03, l * 0.68) * (0.93 + 0.07 * signalHash(vec2(frame, 2.0))) + (signalHash(cell + frame) - 0.5) * 0.08;
  // cga: the four-colour 1981 palette
  if (isFilter(f, 4.0)) o = l < 0.2 ? vec3(0.0) : l < 0.5 ? vec3(0.33, 1.0, 1.0) * (0.55 + l) : l < 0.78 ? vec3(1.0, 0.33, 1.0) : vec3(1.0);
  // negative
  if (isFilter(f, 5.0)) o = 1.0 - c;
  // glow: bright pixels bloom into their neighbours
  if (isFilter(f, 6.0) || isFilter(f, 13.0)) {
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      float t = float(k) * 0.785398;
      vec3 s = rgbAt(cell + floor(vec2(cos(t), sin(t)) * 2.5 + 0.5));
      sum += s * smoothstep(0.45, 0.9, lumaOf(s));
    }
    o = c + sum * 0.22;
    // neon: dark bodies, glowing rims in a cycling hue
    if (isFilter(f, 13.0)) o = edge > 0.5 ? hueOf(fract(cell.y * 0.01 + uTime * 0.12)) * 1.2 : c * 0.22 + sum * 0.12;
  }
  // bleed: colour smears to the right of where it belongs, as on a worn tape
  if (isFilter(f, 8.0)) {
    vec3 smear = (rgbAt(cell - vec2(1.0, 0.0)) + rgbAt(cell - vec2(2.0, 0.0)) + rgbAt(cell - vec2(3.0, 0.0))) / 3.0;
    o = vec3(l) + (smear - vec3(lumaOf(smear))) * 1.3;
  }
  // night vision: green phosphor and noise
  if (isFilter(f, 10.0)) o = vec3(0.12, 1.0, 0.28) * (l * 1.35 + 0.06) + (signalHash(cell + frame) - 0.5) * 0.12;
  // sparkle: bright pixels twinkle white
  if (isFilter(f, 11.0)) o = c + step(0.5, l) * step(1.0 - 0.07 * a, signalHash(cell + floor(uTime * 6.0) * 2.17)) * vec3(0.9);
  // thermal: black, blue, magenta, red, yellow, white by brightness
  if (isFilter(f, 12.0)) {
    float h = clamp(l * 1.15, 0.0, 1.0);
    o = h < 0.25 ? mix(vec3(0.02, 0.0, 0.1), vec3(0.15, 0.1, 0.9), h * 4.0) : h < 0.5 ? mix(vec3(0.15, 0.1, 0.9), vec3(0.9, 0.1, 0.7), h * 4.0 - 1.0) : h < 0.75 ? mix(vec3(0.9, 0.1, 0.7), vec3(1.0, 0.55, 0.0), h * 4.0 - 2.0) : mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 1.0, 0.85), h * 4.0 - 3.0);
  }
  // rainbow: colours cycle through the hues
  if (isFilter(f, 14.0)) o = hueOf(fract(l * 1.4 + cell.y * 0.008 + uTime * 0.18)) * (0.35 + 0.85 * l);
  // holo: iridescent foil that shifts across the part, with a sweeping sheen
  if (isFilter(f, 18.0)) {
    float sheen = smoothstep(0.92, 1.0, fract((cell.x + cell.y) * 0.02 - uTime * 0.35));
    o = mix(c, hueOf(fract(cell.x * 0.018 + cell.y * 0.012 + uTime * 0.2 + l * 0.6)) * (0.55 + 0.6 * l), 0.65) + sheen * 0.5;
  }
  return mix(c, clamp(o, 0.0, 1.0), isFilter(f, 1.0) || isFilter(f, 11.0) ? 1.0 : a);
}
// Clump: a smooth Kuwahara filter gathers speckle into masses; what lies behind never bleeds in.
vec3 clumpAt(vec2 cell, vec3 c, float d0, float gap) {
  vec3 s[9];
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    vec2 at = cell + vec2(float(i) - 1.0, float(j) - 1.0);
    s[j * 3 + i] = (i == 1 && j == 1) || distanceAt(at) - d0 > gap ? c : rgbAt(at);
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int q = 0; q < 4; q++) {
    int ox = q - (q / 2) * 2;
    int oy = q / 2;
    vec3 a = s[oy * 3 + ox]; vec3 b = s[oy * 3 + ox + 1]; vec3 d = s[oy * 3 + ox + 3]; vec3 e = s[oy * 3 + ox + 4];
    vec3 mean = (a + b + d + e) * 0.25;
    vec3 va = a - mean; vec3 vb = b - mean; vec3 vd = d - mean; vec3 ve = e - mean;
    float w = 1.0 / (0.004 + dot(va, va) + dot(vb, vb) + dot(vd, vd) + dot(ve, ve));
    sum += mean * w * w;
    total += w * w;
  }
  return sum / total;
}
void main() {
  vec2 home = clamp(floor(gl_FragCoord.xy), vec2(0.0), uGrid - 1.0);
  int part = partAt(home);
  vec3 signal = signalOf(part);
  vec2 partFilter = filterOf(part);
  vec2 cell = filterCell(glitchCell(home, part), partFilter, part);
  vec3 c = toSrgb(texture2D(tColor, cellUv(cell)).rgb);
  // Red and blue drift apart by whole art pixels around a fringed part, and
  // further while it bursts.
  float fringe = max(signal.y, max(signalOf(partAt(home + vec2(2.0, 0.0))).y, signalOf(partAt(home - vec2(2.0, 0.0))).y));
  float split = floor(fringe * 1.6) + burstOf(signal.z, float(part));
  if (split >= 1.0) {
    c.r = toSrgb(texture2D(tColor, cellUv(clamp(cell + vec2(split, 0.0), vec2(0.0), uGrid - 1.0))).rgb).r;
    c.b = toSrgb(texture2D(tColor, cellUv(clamp(cell - vec2(split, 0.0), vec2(0.0), uGrid - 1.0))).rgb).b;
  }
  float d0 = distanceAt(cell);
  bool sky = d0 >= uSkyFrom;
  float dl = distanceAt(cell - vec2(1.0, 0.0));
  float dr = distanceAt(cell + vec2(1.0, 0.0));
  float dd = distanceAt(cell - vec2(0.0, 1.0));
  float du = distanceAt(cell + vec2(0.0, 1.0));
  float gap = 0.06 * d0 + 0.08;
  float edge = (!sky && max(max(dl, dr), max(du, dd)) - d0 > gap) ? 1.0 : 0.0;
  // Clumped, a leaf among leaves is not a silhouette.
  if (uClump > 0.0 && d0 - min(min(dl, dr), min(du, dd)) > gap) edge = 0.0;
  float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
  float crease = (!sky && edge < 0.5 && lap > 0.012 * d0 + 0.02) ? 1.0 : 0.0;
  if (uClump > 0.0 && !sky && split < 1.0) c = mix(c, clumpAt(cell, c, d0, gap), uClump);
  c = filterColor(c, cell, partFilter, edge);

  float jitter = (bayer8(cell + 3.0) - 0.5) * 0.18;
  float far = d0 * (1.0 + jitter);
  int band = sky || far > uBands.y ? 2 : far > uBands.x ? 1 : 0;
  float screen = band == 0 ? uScreen.x : band == 1 ? uScreen.y : uScreen.z;
  float scale = band == 0 ? uScale.x : band == 1 ? uScale.y : uScale.z;
  float amount = band == 0 ? uAmount.x : band == 1 ? uAmount.y : uAmount.z;

  c += godRays(cell) * (sky ? 0.6 : 1.0);
  // Soft knee into black; lift the darkest toward cool blue; ramps lean lights warm, shadows cool.
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(0.1 * exp(c * 10.0 - 1.0), c, step(0.1, c));
  float lo = 1.0 - clamp(lumaOf(c), 0.0, 1.0);
  c += uLift * lo * lo * lo * vec3(0.8, 0.9, 1.3) + (sky ? 0.0 : uRamp) * 0.09 * (0.55 - lo) * vec3(1.0, 0.3, -0.9);
  c = mix(vec3(lumaOf(c)), c, uSaturation);
  // Outlines thin out with distance, so a far skyline is a soft edge, not a wire.
  float outline = uOutline * (band == 0 ? 1.0 : band == 1 ? 0.7 : 0.3);
  vec3 ink = uOutlineColor.a > 0.5 ? uOutlineColor.rgb : c * vec3(0.36, 0.33, 0.46);
  c = mix(c, ink, edge * outline);
  c = mix(c, c * vec3(0.74, 0.72, 0.8), crease * uCrease);
  c = clamp(c, 0.0, 1.0);

  // A silhouette is a solid run of tone, never broken speckle.
  // A dark sky bands, never a grid of dots.
  if (sky) amount *= smoothstep(0.03, 0.2, lumaOf(c));
  // On a fixed palette the sky keeps its hue and settles into bands rather than a checker of far-apart inks.
  if (sky && uPaletteSize > 0) amount *= 0.35;
  float t = 0.5 + (screenAt(screen, floor(cell / scale)) - 0.5) * amount * (1.0 - edge * outline);
  // Alpha carries this pixel's scanline strength to the blit.
  gl_FragColor = vec4(uPaletteSize > 0 ? stepPalette(c, t) : stepTones(c, t), signal.x);
}
`;

// The look is resolved once per art pixel into a grid-sized target; this pass
// only scales it up by whole device pixels.
const BLIT_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tLook;
uniform vec2 uGrid;
uniform float uPixel;
uniform vec2 uOrigin;
uniform float uScanlines;
uniform float uTime;
void main() {
  vec2 frame = (gl_FragCoord.xy - uOrigin) / uPixel;
  vec2 cell = clamp(floor(frame), vec2(0.0), uGrid - 1.0);
  vec4 look = texture2D(tLook, (cell + 0.5) / uGrid);
  vec3 c = look.rgb;
  // Each pixel's scanline strength came from the look pass (whole frame or its part);
  // none show when an art pixel is too few device pixels tall.
  float scan = uPixel >= 2.0 ? look.a : 0.0;
  // Scanlines: the lower part of every art-pixel row is dimmed, and a faint
  // brighter band rolls slowly down the frame, as on a tube screen.
  // Dark gaps between lines, with the lit rows lifted to keep the frame's brightness.
  float line = (1.0 + scan * 0.22) * (1.0 - scan * 0.5 * step(fract(frame.y), 0.4));
  float roll = 1.0 + scan * 0.07 * sin((frame.y / uGrid.y + uTime * 0.12) * 6.2832);
  gl_FragColor = vec4(c * line * roll, 1.0);
}
`;

/** The passes' GLSL, for hosts that run their own pipeline. Uniform names are the contract. */
export const VOXEL_DITHER_GLSL = { vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, blit: BLIT_GLSL } as const;

// ---------------------------------------------------------------- rays

/** God rays as a scene describes them: toward which light (a world direction), its colour, and how the shafts fall off. */
export interface RaySpec {
  readonly direction: readonly [number, number, number];
  readonly color: string;
  /** 0 to about 1.5. */
  readonly strength: number;
  /** Falloff per step along a shaft, 0.85 to 0.995. */
  readonly decay?: number | undefined;
  /** How much of the way to the light a shaft samples, 0.2 to 1. */
  readonly density?: number | undefined;
}

/** Where a light direction lands on screen: uv (0..1, may fall outside) and how squarely the camera faces it (0..1). */
export interface ScreenLight {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

/**
 * Projects a world direction (a light at infinity) through a camera's view
 * and projection matrices (column-major, as keel/lit keeps them).
 */
export function screenLight(view: ArrayLike<number>, projection: ArrayLike<number>, direction: readonly [number, number, number]): ScreenLight {
  const at = (m: ArrayLike<number>, index: number): number => m[index] ?? 0;
  const [dx, dy, dz] = direction;
  const vx = at(view, 0) * dx + at(view, 4) * dy + at(view, 8) * dz;
  const vy = at(view, 1) * dx + at(view, 5) * dy + at(view, 9) * dz;
  const vz = at(view, 2) * dx + at(view, 6) * dy + at(view, 10) * dz;
  const cx = at(projection, 0) * vx + at(projection, 4) * vy + at(projection, 8) * vz;
  const cy = at(projection, 1) * vx + at(projection, 5) * vy + at(projection, 9) * vz;
  const cw = at(projection, 3) * vx + at(projection, 7) * vy + at(projection, 11) * vz;
  const length = Math.hypot(vx, vy, vz) || 1;
  const facing = Math.max(0, -vz / length);
  if (cw <= 1e-4) return { x: 0.5, y: 0.5, facing: 0 };
  return { x: Math.max(-2, Math.min(3, (cx / cw) * 0.5 + 0.5)), y: Math.max(-2, Math.min(3, (cy / cw) * 0.5 + 0.5)), facing };
}

// ---------------------------------------------------------------- the minimal keel/lit surface it uses

interface ColorLike {
  copy(color: ColorLike): ColorLike;
}
interface TextureLike {
  minFilter: unknown;
  magFilter: unknown;
  generateMipmaps: boolean;
  needsUpdate: boolean;
  dispose(): void;
}
interface RenderTargetLike {
  readonly texture: TextureLike;
  readonly depthTexture: TextureLike | null;
  setSize(width: number, height: number): void;
  dispose(): void;
}
interface Uniform {
  value: unknown;
}
interface ShaderMaterialLike {
  readonly uniforms: Record<string, Uniform>;
  dispose(): void;
}
interface MaterialLike {
  readonly isLitMaterial?: boolean;
  onCompile?: (shader: { fragmentShader: string }, renderer: unknown) => void;
  customProgramCacheKey?: () => string;
  readonly color?: ColorLike;
  opacity: number;
  transparent: boolean;
  visible: boolean;
  readonly userData: Record<string, unknown>;
  gradientMap?: TextureLike | null;
  needsUpdate: boolean;
  dispose(): void;
}
interface NodeLike {
  readonly isMesh?: boolean;
  material?: MaterialLike | MaterialLike[];
  traverse(visit: (node: NodeLike) => void): void;
}
interface MatrixLike {
  readonly elements: ArrayLike<number>;
}
interface CameraLike {
  readonly near: number;
  readonly far: number;
  readonly isOrthographicCamera?: boolean;
  readonly matrixWorldInverse?: MatrixLike;
  readonly projectionMatrix?: MatrixLike;
}
interface RendererLike {
  getRenderTarget(): RenderTargetLike | null;
  setRenderTarget(target: RenderTargetLike | null): void;
  render(scene: unknown, camera: unknown): void;
}
interface DisposableLike {
  dispose(): void;
}
interface MeshLike {
  frustumCulled: boolean;
}
interface SceneLike {
  add(object: unknown): void;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly RenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) => RenderTargetLike;
  readonly DepthTexture: new (width: number, height: number) => TextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => ShaderMaterialLike;
  readonly ToonMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number, format: string) => TextureLike;
  plane(width: number, height: number): DisposableLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => MeshLike;
  readonly Stage: new () => SceneLike;
  readonly OrthoCamera: new (left: number, right: number, top: number, bottom: number, near: number, far: number) => unknown;
}

// ---------------------------------------------------------------- cel shading

/** Copies the members a lit material and its toon twin share. */
function carryOver(from: MaterialLike, to: MaterialLike): void {
  if (from.color !== undefined && to.color !== undefined) to.color.copy(from.color);
  to.opacity = from.opacity;
  to.transparent = from.transparent;
  to.visible = from.visible;
}

const TOON_KEYS = ["map", "emissive", "emissiveIntensity", "transparent", "opacity", "depthWrite", "depthTest", "side", "alphaTest", "vertexColors", "flatShading", "name"] as const;

function toonParameters(source: MaterialLike, gradientMap: TextureLike): Record<string, unknown> {
  const bag = source as unknown as Readonly<Record<string, unknown>>;
  const parameters: Record<string, unknown> = { gradientMap };
  if (source.color !== undefined) parameters.color = source.color;
  for (const key of TOON_KEYS) if (bag[key] !== undefined && bag[key] !== null) parameters[key] = bag[key];
  return parameters;
}

interface CelShader {
  setBands(bands: number): void;
  swap(material: MaterialLike, mode: Shading): MaterialLike;
  dispose(): void;
}

function createCelShader(lit: LitLike, bands: number): CelShader {
  const toons = new Map<MaterialLike, MaterialLike>();
  const ramp = (count: number): TextureLike => {
    const values = celRamp(count);
    const texture = new lit.DataTexture(values, values.length, 1, "red");
    texture.minFilter = "nearest";
    texture.magFilter = "nearest";
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };
  let gradient = ramp(bands);
  return {
    setBands(count) {
      gradient.dispose();
      gradient = ramp(count);
      for (const toon of toons.values()) { toon.gradientMap = gradient; toon.needsUpdate = true; }
    },
    swap(material, mode) {
      const source = material.userData.voxelDitherSource as MaterialLike | undefined;
      if (mode === "smooth") {
        if (source === undefined) return material;
        carryOver(material, source);
        return source;
      }
      if (source !== undefined || material.isLitMaterial !== true || material.userData.voxelDitherKeep === true) return material;
      let toon = toons.get(material);
      if (toon === undefined) {
        toon = new lit.ToonMaterial(toonParameters(material, gradient));
        toon.userData.voxelDitherSource = material;
        toons.set(material, toon);
      }
      carryOver(material, toon);
      return toon;
    },
    dispose() {
      gradient.dispose();
      for (const toon of toons.values()) toon.dispose();
      toons.clear();
    },
  };
}

// ---------------------------------------------------------------- part signals

/** One of three scene parts a host can tag (say platform, tree, background) to give it its own signal. */
export type SignalPart = 1 | 2 | 3;
/**
 * The filters a part can wear on top of its signal, in the shader's numbering. Some move pixels
 * (mosaic, vhs, wave, slitscan, pixelsort, datamosh), the rest change colour before the tones are
 * stepped, so a filtered part is still dithered pixel art.
 */
export const SIGNAL_FILTERS = ["none", "snow", "film", "mosaic", "cga", "negative", "glow", "vhs", "bleed", "wave", "nightvision", "sparkle", "thermal", "neon", "rainbow", "slitscan", "pixelsort", "datamosh", "holo"] as const;
export type SignalFilter = (typeof SIGNAL_FILTERS)[number];

/** A part's own scanlines, colour fringe and glitch, each 0 to 1, and an optional filter at `amount` (0 to 1, default 1). */
export interface SignalSpec {
  readonly scanlines?: number;
  readonly chroma?: number;
  readonly glitch?: number;
  readonly filter?: SignalFilter;
  readonly amount?: number;
}

/** The alpha a tagged material writes into the scene target; untagged pixels keep 1. */
export const SIGNAL_TAG_ALPHA: Readonly<Record<SignalPart, number>> = { 1: 0.25, 2: 0.5, 3: 0.75 };

/** Packs up to three part signals into the shader's uniform, in part order. */
export function signalUniform(parts: readonly (SignalSpec | null | undefined)[]): Float32Array {
  const data = new Float32Array(9);
  for (let index = 0; index < 3; index += 1) {
    const part = parts[index];
    if (part === null || part === undefined) continue;
    data[index * 3] = bounded(part.scanlines, 0, 1, 0);
    data[index * 3 + 1] = bounded(part.chroma, 0, 1, 0);
    data[index * 3 + 2] = bounded(part.glitch, 0, 1, 0);
  }
  return data;
}

/** Packs up to three part filters into the shader's uniform: each filter's number and amount, in part order. */
export function filterUniform(parts: readonly (SignalSpec | null | undefined)[]): Float32Array {
  const data = new Float32Array(6);
  for (let index = 0; index < 3; index += 1) {
    const part = parts[index];
    const filter = part?.filter === undefined ? -1 : SIGNAL_FILTERS.indexOf(part.filter);
    if (part === null || part === undefined || filter <= 0) continue;
    data[index * 2] = filter;
    data[index * 2 + 1] = bounded(part.amount, 0, 1, 1);
  }
  return data;
}

interface SignalBase {
  readonly compile: MaterialLike["onCompile"];
  readonly key: MaterialLike["customProgramCacheKey"];
}

/**
 * Makes an opaque material write its part's tag into alpha after its own
 * shading. Transparent materials blend alpha, so they stay untagged.
 */
function tagMaterial(material: MaterialLike, part: SignalPart): void {
  if (material.transparent || material.userData.voxelDitherSignal === part) return;
  const base = (material.userData.voxelDitherSignalBase as SignalBase | undefined) ?? { compile: material.onCompile, key: material.customProgramCacheKey };
  material.userData.voxelDitherSignalBase = base;
  material.userData.voxelDitherSignal = part;
  const alpha = SIGNAL_TAG_ALPHA[part].toFixed(2);
  material.onCompile = (shader, renderer) => {
    base.compile?.call(material, shader, renderer);
    const end = shader.fragmentShader.lastIndexOf("}");
    shader.fragmentShader = `${shader.fragmentShader.slice(0, end)}  gl_FragColor.a = ${alpha};\n}\n`;
  };
  material.customProgramCacheKey = () => `${base.key?.call(material) ?? ""}|voxel-dither-signal-${String(part)}`;
  material.needsUpdate = true;
}

function tagTree(root: NodeLike, part: SignalPart): void {
  root.traverse((node) => {
    if (node.isMesh !== true || node.material === undefined) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) tagMaterial(material, part);
  });
}

// ---------------------------------------------------------------- the pass

/** A live dithered-voxel look bound to one renderer. */
export interface VoxelDither {
  readonly settings: DitherSettings;
  readonly grid: PixelGrid;
  /** Replaces the look; returns the normalized settings. Call `shade` again if `shading` or `bands` changed. */
  setSettings(input?: unknown): DitherSettings;
  /** Moves the near/mid and mid/far boundaries (view distances) without re-resolving the look; cheap enough per frame. */
  setDepthBands(near: number, far: number): void;
  /** Sizes the grid for a frame of this many CSS pixels. The renderer's canvas must already be that size. */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): PixelGrid;
  /** Swaps every lit mesh material under `root` to the look's shading (cel toon ramps or the scene's own). */
  shade(root: NodeLike): void;
  /** Sets (or clears, with null) the light the god rays stream from; cheap enough per frame. */
  setRays(rays: RaySpec | null): void;
  /** Sets the clock, in seconds, that rolls the scanlines and times glitch bursts; cheap enough per frame. */
  setTime(seconds: number): void;
  /**
   * Tags every opaque mesh material under `root` as one part, so that part can
   * carry its own signal. Call it again after `shade`, which swaps materials.
   */
  tagSignal(root: NodeLike, part: SignalPart): void;
  /** Sets the signal of parts 1 to 3 (null for none), on top of the look's own whole-frame settings. */
  setSignals(parts: readonly (SignalSpec | null | undefined)[]): void;
  /** Draws `scene` from `camera` through the look into the renderer's current target. */
  render(scene: unknown, camera: CameraLike): void;
  dispose(): void;
}

function createUniforms(): Record<string, Uniform> {
  return {
    tColor: { value: null }, tDepth: { value: null }, uGrid: { value: [1, 1] }, uPixel: { value: 1 }, uOrigin: { value: [0, 0] },
    uScreen: { value: [2, 3, 8] }, uScale: { value: [1, 1, 1] },
    uAmount: { value: [1, 1, 1] }, uBands: { value: [18, 30] }, uLevels: { value: 6 }, uSnap: { value: 0 }, uLift: { value: 0 }, uClump: { value: 0 }, uRamp: { value: 0 }, uLuma: { value: 1 }, uPaletteSize: { value: 0 },
    uPalette: { value: new Float32Array(96) }, uPaletteLab: { value: new Float32Array(96) }, uOutline: { value: 0.9 }, uOutlineColor: { value: [0, 0, 0, 0] }, uCrease: { value: 0.35 },
    uContrast: { value: 1 }, uSaturation: { value: 1 }, uSkyFrom: { value: 100 }, uRaySource: { value: [0.5, 0.5] }, uRayColor: { value: [1, 1, 1] },
    uRayStrength: { value: 0 }, uRayDecay: { value: 0.95 }, uRayDensity: { value: 0.8 }, tLook: { value: null },
    uScanlines: { value: 0 }, uChroma: { value: 0 }, uGlitch: { value: 0 }, uTime: { value: 0 }, uSignal: { value: new Float32Array(9) }, uFilter: { value: new Float32Array(6) },
  };
}

function writeLook(uniforms: Record<string, Uniform>, settings: DitherSettings, grid: PixelGrid): void {
  const bands = bandScreens(settings, Math.min(grid.width, grid.height));
  const order = [bands.near, bands.mid, bands.far];
  const palette = paletteUniform(settings.palette);
  const set = (name: string, value: unknown): void => { const uniform = uniforms[name]; if (uniform !== undefined) uniform.value = value; };
  set("uScreen", order.map((band) => SCREENS.indexOf(band.screen)));
  set("uScale", order.map((band) => band.scale));
  set("uAmount", order.map((band) => band.amount));
  set("uBands", [...settings.depthBands]);
  set("uLevels", settings.levels);
  set("uSnap", settings.snap);
  set("uLift", settings.lift);
  set("uClump", settings.clump);
  set("uRamp", settings.ramp);
  set("uLuma", settings.color === "luma" ? 1 : 0);
  set("uPalette", palette.data);
  set("uPaletteLab", palette.lab);
  set("uPaletteSize", palette.size);
  set("uOutline", settings.outline);
  set("uOutlineColor", settings.outlineColor === null ? [0, 0, 0, 0] : [...hexChannels(settings.outlineColor), 1]);
  set("uCrease", settings.crease);
  set("uContrast", settings.contrast);
  set("uSaturation", settings.saturation);
  set("uScanlines", settings.scanlines);
  set("uChroma", settings.chroma);
  set("uGlitch", settings.glitch);
  set("uGrid", [grid.width, grid.height]);
  set("uPixel", grid.pixel);
  set("uOrigin", [grid.originX, grid.originY]);
}

/** The scene target (linear light and depth), or the look target (stepped sRGB). */
function createTarget(lit: LitLike, scene: boolean): RenderTargetLike {
  const filters = { minFilter: "nearest", magFilter: "nearest", generateMipmaps: false };
  if (!scene) return new lit.RenderTarget(1, 1, { ...filters, depthBuffer: false });
  return new lit.RenderTarget(1, 1, { ...filters, type: "half", depthBuffer: true, depthTexture: new lit.DepthTexture(1, 1) });
}

interface Pass {
  readonly scene: SceneLike;
  readonly material: ShaderMaterialLike;
}

/** A full-screen quad drawn with one fragment shader. */
function createPass(lit: LitLike, geometry: DisposableLike, uniforms: Record<string, Uniform>, fragmentShader: string): Pass {
  const material = new lit.CustomMaterial({ uniforms, vertexShader: VERTEX_GLSL, fragmentShader, depthTest: false, depthWrite: false });
  const quad = new lit.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new lit.Stage();
  scene.add(quad);
  return { scene, material };
}

function writeRays(uniforms: Record<string, Uniform>, rays: RaySpec | null, view: CameraLike, scale: number): void {
  const strength = uniforms.uRayStrength;
  if (strength === undefined) return;
  if (rays === null || view.matrixWorldInverse === undefined || view.projectionMatrix === undefined) {
    strength.value = 0;
    return;
  }
  const light = screenLight(view.matrixWorldInverse.elements, view.projectionMatrix.elements, rays.direction);
  strength.value = Math.max(0, rays.strength) * scale * Math.min(1, light.facing * 2.5);
  Object.assign(uniforms.uRaySource ?? {}, { value: [light.x, light.y] });
  Object.assign(uniforms.uRayColor ?? {}, { value: [...hexChannels(HEX.test(rays.color) ? rays.color : "#ffffff")] });
  Object.assign(uniforms.uRayDecay ?? {}, { value: bounded(rays.decay, 0.85, 0.995, 0.95) });
  Object.assign(uniforms.uRayDensity ?? {}, { value: bounded(rays.density, 0.2, 1, 0.8) });
}

interface Pipeline {
  resize(grid: PixelGrid): void;
  draw(renderer: RendererLike, scene: unknown, view: CameraLike, settings: DitherSettings, rays: RaySpec | null): void;
  dispose(): void;
}

/** The two targets and two passes: scene -> grid target, look at grid size, blit to the frame. */
function createPipeline(lit: LitLike, uniforms: Record<string, Uniform>): Pipeline {
  const target = createTarget(lit, true);
  const lookTarget = createTarget(lit, false);
  const camera: Readonly<Record<"near" | "far" | "ortho" | "sky", Uniform>> = { near: { value: 0.1 }, far: { value: 100 }, ortho: { value: 0 }, sky: { value: 100 } };
  Object.assign(uniforms, { tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, tLook: { value: lookTarget.texture }, uNear: camera.near, uFar: camera.far, uOrtho: camera.ortho, uSkyFrom: camera.sky });
  const geometry = lit.plane(2, 2);
  const post = createPass(lit, geometry, uniforms, FRAGMENT_GLSL);
  const blit = createPass(lit, geometry, uniforms, BLIT_GLSL);
  const quadCamera = new lit.OrthoCamera(-1, 1, 1, -1, 0, 1);
  return {
    resize(grid) {
      target.setSize(grid.width, grid.height);
      lookTarget.setSize(grid.width, grid.height);
    },
    draw(renderer, scene, view, settings, rays) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, view);
      camera.near.value = view.near;
      camera.far.value = view.far;
      camera.ortho.value = view.isOrthographicCamera === true ? 1 : 0;
      camera.sky.value = settings.skyDistance > 0 ? Math.min(settings.skyDistance, view.far * 0.999) : view.far * 0.999;
      writeRays(uniforms, rays, view, settings.rays);
      renderer.setRenderTarget(lookTarget);
      renderer.render(post.scene, quadCamera);
      renderer.setRenderTarget(previous);
      renderer.render(blit.scene, quadCamera);
    },
    dispose() {
      target.depthTexture?.dispose();
      target.dispose();
      lookTarget.dispose();
      post.material.dispose();
      blit.material.dispose();
      geometry.dispose();
    },
  };
}

/**
 * Binds a dithered-voxel look to a renderer.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The WebGLRenderer that owns the canvas.
 * @param input Settings, normalized through `ditherSettings`.
 */
export function createVoxelDither(lit: LitLike, renderer: RendererLike, input?: unknown): VoxelDither {
  let settings = ditherSettings(input);
  let grid: PixelGrid = { width: 1, height: 1, pixel: 1, originX: 0, originY: 0 };
  let frame = { width: 1, height: 1, ratio: 1 };
  let rays: RaySpec | null = null;
  const uniforms = createUniforms();
  const pipeline = createPipeline(lit, uniforms);
  const cel = createCelShader(lit, settings.bands);
  writeLook(uniforms, settings, grid);

  const look: VoxelDither = {
    get settings() { return settings; },
    get grid() { return grid; },
    setSettings(next) {
      const previous = settings;
      settings = ditherSettings(next);
      if (settings.bands !== previous.bands) cel.setBands(settings.bands);
      look.setSize(frame.width, frame.height, frame.ratio);
      return settings;
    },
    setDepthBands(near, far) {
      const [a, b] = depthBandsOf([near, far], settings.depthBands);
      if (a !== settings.depthBands[0] || b !== settings.depthBands[1]) settings = { ...settings, depthBands: [a, b] };
      Object.assign((uniforms.uBands?.value ?? []) as number[], [a, b]);
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      frame = { width: cssWidth, height: cssHeight, ratio: devicePixelRatio };
      grid = resolveGrid(cssWidth, cssHeight, devicePixelRatio, settings);
      pipeline.resize(grid);
      writeLook(uniforms, settings, grid);
      return grid;
    },
    shade(root) {
      root.traverse((node) => {
        if (node.isMesh !== true || node.material === undefined) return;
        node.material = Array.isArray(node.material) ? node.material.map((entry) => cel.swap(entry, settings.shading)) : cel.swap(node.material, settings.shading);
      });
    },
    setRays(next) {
      rays = next;
    },
    setTime(seconds) {
      if (uniforms.uTime !== undefined) uniforms.uTime.value = Number.isFinite(seconds) ? seconds % 3600 : 0;
    },
    tagSignal(root, part) {
      tagTree(root, part);
    },
    setSignals(parts) {
      Object.assign(uniforms.uSignal ?? {}, { value: signalUniform(parts) });
      Object.assign(uniforms.uFilter ?? {}, { value: filterUniform(parts) });
    },
    render(scene, view) {
      pipeline.draw(renderer, scene, view, settings, rays);
    },
    dispose() {
      pipeline.dispose();
      cel.dispose();
    },
  };
  return look;
}
