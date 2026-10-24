/**
 * Dithered voxel pixel art for any Three.js scene. MIT.
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
 *   const look = createVoxelDither(THREE, renderer, { style: "smart" });
 *   look.setSize(cssWidth, cssHeight, devicePixelRatio);
 *   look.shade(scene);                       // after building or rebuilding the scene
 *   renderer.setAnimationLoop(() => look.render(scene, camera));
 *
 * THREE is injected: the module never imports it and never touches globals.
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
}

type StyleFields = Partial<Omit<DitherSettings, "style">> & { readonly label: string };

const BLOSSOM_16 = ["#1b1726", "#3a2d45", "#5c4363", "#8a5a78", "#c77d97", "#f0a8bd", "#ffd9e2", "#fff6ef", "#2e4a3c", "#4f7a52", "#8fb36a", "#d6e59a", "#6b4a3a", "#a0705a", "#7fa7c9", "#cfe3ef"];

/** Named looks. A setting given alongside `style` overrides the preset's. */
export const DITHER_STYLES = {
  smart: { label: "Smart voxel", screen: "auto", pixel: 0, levels: 6, color: "luma", shading: "cel", bands: 4, outline: 0.9, crease: 0.35, contrast: 1.05, saturation: 1.1 },
  bayer: { label: "Bayer cel", screen: "bayer4", pixel: 4, levels: 4, color: "rgb", shading: "cel", bands: 3, outline: 0.85, crease: 0.25 },
  soft: { label: "Soft ordered", screen: "bayer8", pixel: 3, levels: 5, color: "luma", shading: "smooth", outline: 0.5, crease: 0.2 },
  halftone: { label: "Halftone print", screen: "halftone", pixel: 2, levels: 3, color: "rgb", shading: "smooth", outline: 0.7, crease: 0, contrast: 1.1 },
  engraving: { label: "Engraving", screen: "hatch", pixel: 2, levels: 3, color: "luma", shading: "smooth", outline: 1, outlineColor: "#1d1a24", crease: 0.3, saturation: 0.55, rays: 1.3 },
  chunky: { label: "Chunky 8-bit", screen: "bayer2", pixel: 6, levels: 4, color: "rgb", shading: "cel", bands: 3, outline: 1, crease: 0.4 },
  grain: { label: "Noise grain", screen: "ign", pixel: 3, levels: 5, color: "luma", shading: "smooth", outline: 0.6, crease: 0.15 },
  blossom: { label: "Blossom 16", screen: "bayer4", pixel: 3, palette: BLOSSOM_16, shading: "cel", bands: 4, outline: 0.9, crease: 0.3 },
  pocket: { label: "Pocket green", screen: "bayer4", pixel: 4, palette: ["#0f2a1d", "#2f5a35", "#7a9a4a", "#cddc8a"], shading: "cel", bands: 3, outline: 0, crease: 0, saturation: 1, rays: 0.6 },
  clean: { label: "Clean cel", screen: "none", pixel: 3, levels: 8, color: "luma", shading: "cel", bands: 4, outline: 1, crease: 0.4 },
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

function toneFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "levels" | "color" | "palette" | "amount" | "contrast" | "saturation"> {
  return {
    levels: Math.round(bounded(value.levels, 2, 16, base.levels)),
    color: oneOf(value.color, ["rgb", "luma"], base.color),
    palette: paletteOf(value.palette, base.palette),
    amount: bounded(value.amount, 0, 1, base.amount),
    contrast: bounded(value.contrast, 0.5, 2, base.contrast),
    saturation: bounded(value.saturation, 0, 2, base.saturation),
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
  return { ...base, ...toneFields(value, base), ...formFields(value, base) };
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
  // Three sizes its canvas as floor(css * ratio); the grid matches it exactly.
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
export function quantizeTone(value: number, levels: number, threshold: number, amount = 1): number {
  const steps = Math.max(1, levels - 1);
  const t = 0.5 + (threshold - 0.5) * Math.min(1, Math.max(0, amount));
  return Math.min(steps, Math.max(0, Math.floor(Math.min(1, Math.max(0, value)) * steps + t))) / steps;
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

/** A palette as the shader's flat vec3[32] (sRGB 0..1), plus its length. */
export function paletteUniform(palette: readonly string[]): { readonly data: Float32Array; readonly size: number } {
  const data = new Float32Array(96);
  const entries = palette.slice(0, 32);
  entries.forEach((hex, index) => { data.set(hexChannels(hex), index * 3); });
  return { data, size: entries.length };
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
uniform float uLuma;
uniform int uPaletteSize;
uniform vec3 uPalette[32];
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
vec3 stepTones(vec3 c, float t) {
  float steps = max(1.0, uLevels - 1.0);
  if (uLuma < 0.5) return clamp(floor(c * steps + t) / steps, 0.0, 1.0);
  // YCoCg: lightness gets twice the steps of colour, so shading reads as ramps.
  float y = dot(c, vec3(0.25, 0.5, 0.25));
  float co = 0.5 * (c.r - c.b);
  float cg = -0.25 * c.r + 0.5 * c.g - 0.25 * c.b;
  // Colour steps finer and dithers gently: lightness carries the pattern, so
  // dark greens never break into stray magenta. The colour grid is centred
  // on zero, so a grey stays exactly grey.
  float ys = steps * 2.0;
  float cs = steps * 2.0 + 2.0;
  float tc = 0.5 + (t - 0.5) * 0.35;
  y = floor(y * ys + t) / ys;
  co = floor(co * cs + tc) / cs;
  cg = floor(cg * cs + tc) / cs;
  return clamp(vec3(y + co - cg, y + cg, y - co - cg), 0.0, 1.0);
}
vec3 stepPalette(vec3 c, float t) {
  vec3 best = c; vec3 next = c;
  float bd = 1e9; float nd = 1e9;
  for (int i = 0; i < 32; i++) {
    if (i >= uPaletteSize) break;
    vec3 e = uPalette[i] - c;
    float d = dot(e * e, vec3(0.3, 0.59, 0.11));
    if (d < bd) { nd = bd; next = best; bd = d; best = uPalette[i]; }
    else if (d < nd) { nd = d; next = uPalette[i]; }
  }
  float m = sqrt(bd) / max(1e-5, sqrt(bd) + sqrt(nd));
  return t < m ? next : best;
}
void main() {
  vec2 cell = clamp(floor(gl_FragCoord.xy), vec2(0.0), uGrid - 1.0);
  vec3 c = toSrgb(texture2D(tColor, cellUv(cell)).rgb);
  float d0 = distanceAt(cell);
  bool sky = d0 >= uSkyFrom;
  float dl = distanceAt(cell - vec2(1.0, 0.0));
  float dr = distanceAt(cell + vec2(1.0, 0.0));
  float dd = distanceAt(cell - vec2(0.0, 1.0));
  float du = distanceAt(cell + vec2(0.0, 1.0));
  float edge = (!sky && max(max(dl, dr), max(du, dd)) - d0 > 0.06 * d0 + 0.08) ? 1.0 : 0.0;
  float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
  float crease = (!sky && edge < 0.5 && lap > 0.012 * d0 + 0.02) ? 1.0 : 0.0;

  float jitter = (bayer8(cell + 3.0) - 0.5) * 0.18;
  float far = d0 * (1.0 + jitter);
  int band = sky || far > uBands.y ? 2 : far > uBands.x ? 1 : 0;
  float screen = band == 0 ? uScreen.x : band == 1 ? uScreen.y : uScreen.z;
  float scale = band == 0 ? uScale.x : band == 1 ? uScale.y : uScale.z;
  float amount = band == 0 ? uAmount.x : band == 1 ? uAmount.y : uAmount.z;

  c += godRays(cell) * (sky ? 0.6 : 1.0);
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSaturation);
  // Outlines thin out with distance, so a far skyline is a soft edge, not a wire.
  float outline = uOutline * (band == 0 ? 1.0 : band == 1 ? 0.7 : 0.3);
  vec3 ink = uOutlineColor.a > 0.5 ? uOutlineColor.rgb : c * vec3(0.36, 0.33, 0.46);
  c = mix(c, ink, edge * outline);
  c = mix(c, c * vec3(0.74, 0.72, 0.8), crease * uCrease);
  c = clamp(c, 0.0, 1.0);

  // A silhouette is a solid run of tone, never broken speckle.
  float t = 0.5 + (screenAt(screen, floor(cell / scale)) - 0.5) * amount * (1.0 - edge * outline);
  gl_FragColor = vec4(uPaletteSize > 0 ? stepPalette(c, t) : stepTones(c, t), 1.0);
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
void main() {
  vec2 cell = clamp(floor((gl_FragCoord.xy - uOrigin) / uPixel), vec2(0.0), uGrid - 1.0);
  gl_FragColor = vec4(texture2D(tLook, (cell + 0.5) / uGrid).rgb, 1.0);
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
 * and projection matrices (column-major, as Three keeps them).
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

// ---------------------------------------------------------------- the minimal Three surface it uses

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
  readonly isMeshStandardMaterial?: boolean;
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

/** The parts of THREE this module calls. Pass the THREE namespace itself. */
export interface ThreeLike {
  readonly WebGLRenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) => RenderTargetLike;
  readonly DepthTexture: new (width: number, height: number) => TextureLike;
  readonly ShaderMaterial: new (parameters: Readonly<Record<string, unknown>>) => ShaderMaterialLike;
  readonly MeshToonMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number, format: unknown) => TextureLike;
  readonly PlaneGeometry: new (width: number, height: number) => DisposableLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => MeshLike;
  readonly Scene: new () => SceneLike;
  readonly OrthographicCamera: new (left: number, right: number, top: number, bottom: number, near: number, far: number) => unknown;
  readonly NearestFilter: unknown;
  readonly HalfFloatType: unknown;
  readonly RedFormat: unknown;
}

// ---------------------------------------------------------------- cel shading

/** Copies the members a lit material and its toon twin share. */
function carryOver(from: MaterialLike, to: MaterialLike): void {
  if (from.color !== undefined && to.color !== undefined) to.color.copy(from.color);
  to.opacity = from.opacity;
  to.transparent = from.transparent;
  to.visible = from.visible;
}

const TOON_KEYS = ["map", "emissive", "emissiveIntensity", "transparent", "opacity", "depthWrite", "depthTest", "side", "alphaTest", "vertexColors", "name"] as const;

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

function createCelShader(three: ThreeLike, bands: number): CelShader {
  const toons = new Map<MaterialLike, MaterialLike>();
  const ramp = (count: number): TextureLike => {
    const values = celRamp(count);
    const texture = new three.DataTexture(values, values.length, 1, three.RedFormat);
    texture.minFilter = three.NearestFilter;
    texture.magFilter = three.NearestFilter;
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
      if (source !== undefined || material.isMeshStandardMaterial !== true || material.userData.voxelDitherKeep === true) return material;
      let toon = toons.get(material);
      if (toon === undefined) {
        toon = new three.MeshToonMaterial(toonParameters(material, gradient));
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
  /** Draws `scene` from `camera` through the look into the renderer's current target. */
  render(scene: unknown, camera: CameraLike): void;
  dispose(): void;
}

function createUniforms(): Record<string, Uniform> {
  return {
    tColor: { value: null }, tDepth: { value: null }, uGrid: { value: [1, 1] }, uPixel: { value: 1 }, uOrigin: { value: [0, 0] },
    uScreen: { value: [2, 3, 8] }, uScale: { value: [1, 1, 1] },
    uAmount: { value: [1, 1, 1] }, uBands: { value: [18, 30] }, uLevels: { value: 6 }, uLuma: { value: 1 }, uPaletteSize: { value: 0 },
    uPalette: { value: new Float32Array(96) }, uOutline: { value: 0.9 }, uOutlineColor: { value: [0, 0, 0, 0] }, uCrease: { value: 0.35 },
    uContrast: { value: 1 }, uSaturation: { value: 1 }, uSkyFrom: { value: 100 }, uRaySource: { value: [0.5, 0.5] }, uRayColor: { value: [1, 1, 1] },
    uRayStrength: { value: 0 }, uRayDecay: { value: 0.95 }, uRayDensity: { value: 0.8 }, tLook: { value: null },
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
  set("uLuma", settings.color === "luma" ? 1 : 0);
  set("uPalette", palette.data);
  set("uPaletteSize", palette.size);
  set("uOutline", settings.outline);
  set("uOutlineColor", settings.outlineColor === null ? [0, 0, 0, 0] : [...hexChannels(settings.outlineColor), 1]);
  set("uCrease", settings.crease);
  set("uContrast", settings.contrast);
  set("uSaturation", settings.saturation);
  set("uGrid", [grid.width, grid.height]);
  set("uPixel", grid.pixel);
  set("uOrigin", [grid.originX, grid.originY]);
}

/** The scene target (linear light and depth), or the look target (stepped sRGB). */
function createTarget(three: ThreeLike, scene: boolean): RenderTargetLike {
  const filters = { minFilter: three.NearestFilter, magFilter: three.NearestFilter, generateMipmaps: false };
  if (!scene) return new three.WebGLRenderTarget(1, 1, { ...filters, depthBuffer: false });
  return new three.WebGLRenderTarget(1, 1, { ...filters, type: three.HalfFloatType, depthBuffer: true, depthTexture: new three.DepthTexture(1, 1) });
}

interface Pass {
  readonly scene: SceneLike;
  readonly material: ShaderMaterialLike;
}

/** A full-screen quad drawn with one fragment shader. */
function createPass(three: ThreeLike, geometry: DisposableLike, uniforms: Record<string, Uniform>, fragmentShader: string): Pass {
  const material = new three.ShaderMaterial({ uniforms, vertexShader: VERTEX_GLSL, fragmentShader, depthTest: false, depthWrite: false });
  const quad = new three.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new three.Scene();
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
function createPipeline(three: ThreeLike, uniforms: Record<string, Uniform>): Pipeline {
  const target = createTarget(three, true);
  const lookTarget = createTarget(three, false);
  const camera: Readonly<Record<"near" | "far" | "ortho" | "sky", Uniform>> = { near: { value: 0.1 }, far: { value: 100 }, ortho: { value: 0 }, sky: { value: 100 } };
  Object.assign(uniforms, { tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, tLook: { value: lookTarget.texture }, uNear: camera.near, uFar: camera.far, uOrtho: camera.ortho, uSkyFrom: camera.sky });
  const geometry = new three.PlaneGeometry(2, 2);
  const post = createPass(three, geometry, uniforms, FRAGMENT_GLSL);
  const blit = createPass(three, geometry, uniforms, BLIT_GLSL);
  const quadCamera = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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
 * @param three The THREE namespace (r150 or later, WebGL2).
 * @param renderer The WebGLRenderer that owns the canvas.
 * @param input Settings, normalized through `ditherSettings`.
 */
export function createVoxelDither(three: ThreeLike, renderer: RendererLike, input?: unknown): VoxelDither {
  let settings = ditherSettings(input);
  let grid: PixelGrid = { width: 1, height: 1, pixel: 1, originX: 0, originY: 0 };
  let frame = { width: 1, height: 1, ratio: 1 };
  let rays: RaySpec | null = null;
  const uniforms = createUniforms();
  const pipeline = createPipeline(three, uniforms);
  const cel = createCelShader(three, settings.bands);
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
      settings = { ...settings, depthBands: depthBandsOf([near, far], settings.depthBands) };
      const uniform = uniforms.uBands;
      if (uniform !== undefined) uniform.value = [...settings.depthBands];
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
