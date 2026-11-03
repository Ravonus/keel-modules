// Vocabulary and settings: screens, styles and their presets, settings checked and bounded, and the pixel grid.

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
  /**
   * The coarsest art pixel, in CSS pixels, of the parts tagged with
   * `tagDetail`: they are drawn on a grid that divides the look's own, so a
   * small animal keeps its shape in a coarse world. 0 draws them on the look's grid.
   */
  readonly detail: number;
  /** Tone steps per channel, 2 to 16 (ignored when a palette is set). */
  readonly levels: number;
  readonly color: ColorMode;
  /** Up to 32 #rrggbb entries; when set, every pixel is one of them. */
  readonly palette: readonly string[];
  /**
   * Up to 4 spot inks beside the palette. A pixel takes one only when it is
   * already clearly of that ink's hue (never the sky), so a four-tone palette
   * can keep a pink blossom without turning a pale sky pink.
   */
  readonly accent: readonly string[];
  /**
   * 0 to 3: the sky and far band's saturation, and how much their hue outweighs lightness when it picks a palette
   * entry, so a fixed palette finds its blue instead of greys.
   */
  readonly skySaturation: number;
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
  chunky: { label: "Chunky 8-bit", screen: "bayer2", pixel: 6, palette: PICO_16, amount: 0.4, skySaturation: 2, clump: 0.85, shading: "cel", bands: 3, outline: 1, crease: 0.4, contrast: 1.15, saturation: 1.3 },
  grain: { label: "Film grain", screen: "ign", pixel: 2, levels: 6, lift: 0.14, ramp: 1, color: "luma", shading: "smooth", outline: 0.4, crease: 0.1, contrast: 1.2, saturation: 0.8 },
  blossom: { label: "Blossom 16", screen: "bayer4", pixel: 3, palette: BLOSSOM_16, shading: "cel", bands: 4, outline: 0.9, crease: 0.3 },
  pocket: { label: "Pocket green", screen: "bayer4", pixel: 4, palette: ["#0f2a1d", "#2f5a35", "#7a9a4a", "#cddc8a"], accent: ["#e8a6b8", "#a85a76"], shading: "cel", bands: 3, outline: 0, crease: 0, saturation: 1, rays: 0.6 },
  clean: { label: "Clean cel", screen: "none", pixel: 3, levels: 5, clump: 1, lift: 0.05, color: "luma", shading: "cel", bands: 3, outline: 1, outlineColor: "#241a2e", crease: 0.5, contrast: 1.15, saturation: 1.35 },
  crt: { label: "CRT painted", screen: "bayer8", pixel: 2, levels: 7, snap: 0.75, color: "luma", shading: "smooth", outline: 1, outlineColor: "#0b0d22", crease: 0.15, contrast: 1.3, saturation: 1.55, scanlines: 0.55, chroma: 0.5 },
} as const satisfies Readonly<Record<string, StyleFields>>;
export type StyleId = keyof typeof DITHER_STYLES;
export const STYLE_IDS = Object.keys(DITHER_STYLES) as readonly StyleId[];

export const DEFAULT_DITHER_SETTINGS: DitherSettings = {
  style: "smart",
  screen: "auto",
  pixel: 0,
  detail: 0,
  levels: 6,
  color: "luma",
  palette: [],
  accent: [],
  skySaturation: 1,
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

export const HEX = /^#[0-9a-f]{6}$/iu;
type Bag = Readonly<Record<string, unknown>>;

export function bounded(value: unknown, min: number, max: number, fallback: number): number {
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

export function depthBandsOf(value: unknown, fallback: readonly [number, number]): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const near = bounded(value[0], 0.1, 1000, fallback[0]);
  return [near, bounded(value[1], near, 1000, Math.max(near, fallback[1]))];
}

/** The preset a style id names, merged over the defaults. */
function presetOf(style: StyleId): DitherSettings {
  const fields = Object.fromEntries(Object.entries(DITHER_STYLES[style]).filter(([key]) => key !== "label")) as Partial<DitherSettings>;
  return { ...DEFAULT_DITHER_SETTINGS, ...fields, style };
}

function toneFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "levels" | "color" | "palette" | "accent" | "skySaturation" | "amount" | "snap" | "lift" | "clump" | "ramp" | "contrast" | "saturation"> {
  return {
    levels: Math.round(bounded(value.levels, 2, 16, base.levels)),
    color: oneOf(value.color, ["rgb", "luma"], base.color),
    palette: paletteOf(value.palette, base.palette),
    accent: paletteOf(value.accent, base.accent).slice(0, 4),
    skySaturation: bounded(value.skySaturation, 0, 3, base.skySaturation),
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

function formFields(value: Bag, base: DitherSettings): Pick<DitherSettings, "screen" | "pixel" | "detail" | "shading" | "bands" | "outline" | "outlineColor" | "crease" | "depthBands" | "rays" | "skyDistance"> {
  return {
    screen: oneOf<ScreenChoice>(value.screen, ["auto", ...SCREENS], base.screen),
    // Half steps: half a CSS pixel is one device pixel on a 2x screen.
    pixel: Math.round(bounded(value.pixel, 0, 12, base.pixel) * 2) / 2,
    detail: Math.round(bounded(value.detail, 0, 12, base.detail) * 2) / 2,
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
 * `limit: { levels, colours }` caps the finished look for a small target (a
 * look recipe's resolved limit; 0 is no limit): the preset's own tone steps
 * and palette are cut to fit, never raised.
 *
 * @param input Plain settings object (usually `KEEL_INPUTS["voxel-dither"]`), or undefined.
 */
export function ditherSettings(input?: unknown): DitherSettings {
  if (input === null || typeof input !== "object") return DEFAULT_DITHER_SETTINGS;
  const value = input as Bag;
  const base = presetOf(oneOf(value.style, STYLE_IDS, DEFAULT_DITHER_SETTINGS.style));
  const look = { ...base, ...toneFields(value, base), ...formFields(value, base), ...signalFields(value, base) };
  return limited(look, value.limit);
}

function limited(look: DitherSettings, limit: unknown): DitherSettings {
  if (limit === null || typeof limit !== "object") return look;
  const levels = Math.round(bounded((limit as Bag).levels, 0, 16, 0));
  const colours = Math.round(bounded((limit as Bag).colours, 0, 1 << 24, 0));
  return {
    ...look,
    levels: levels >= 2 ? Math.min(look.levels, levels) : look.levels,
    palette: colours >= 2 ? look.palette.slice(0, colours) : look.palette,
  };
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
  /** Detail pixels along each side of an art pixel, 1 to 4 (1: detail parts share the grid). */
  readonly detail: number;
}

/** Most detail pixels along an art pixel's side: 4 is sixteen to an art pixel. */
const MOST_DETAIL = 4;

/** The finest whole split of an art pixel whose detail pixels are still at least `css` CSS pixels. */
function detailSplit(pixel: number, css: number, ratio: number): number {
  if (css <= 0) return 1;
  const least = Math.max(1, Math.round(css * ratio));
  let split = 1;
  for (let k = 2; k <= MOST_DETAIL; k += 1) if (pixel % k === 0 && pixel / k >= least) split = k;
  return split;
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
export function resolveGrid(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  settings: DitherSettings,
): PixelGrid {
  const ratio = bounded(devicePixelRatio, 0.5, 4, 1);
  const css = settings.pixel === 0 ? autoPixel(cssWidth, cssHeight) : settings.pixel;
  const pixel = Math.max(1, Math.round(css * ratio));
  // The renderer sizes its canvas as floor(css * ratio); the grid matches it exactly.
  const deviceWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const deviceHeight = Math.max(1, Math.floor(cssHeight * ratio));
  const width = Math.ceil(deviceWidth / pixel);
  const height = Math.ceil(deviceHeight / pixel);
  return {
    width,
    height,
    pixel,
    originX: Math.floor((deviceWidth - width * pixel) / 2),
    originY: Math.floor((deviceHeight - height * pixel) / 2),
    detail: detailSplit(pixel, settings.detail, ratio),
  };
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
    return {
      near: { screen, scale: 1, amount },
      mid: { screen, scale: 1, amount: amount * 0.85 },
      far: { screen, scale: 1, amount: amount * 0.6 },
    };
  }
  if (gridShort < 128) {
    return { near: { screen: "bayer2", scale: 1, amount }, mid: { screen: "bayer2", scale: 1, amount: amount * 0.8 }, far: { screen: "checker", scale: 1, amount: amount * 0.5 } };
  }
  if (gridShort < 260) {
    return { near: { screen: "bayer4", scale: 1, amount }, mid: { screen: "bayer8", scale: 1, amount: amount * 0.8 }, far: { screen: "bayer8", scale: 1, amount: amount * 0.5 } };
  }
  return { near: { screen: "bayer8", scale: 1, amount }, mid: { screen: "bayer8", scale: 1, amount: amount * 0.8 }, far: { screen: "ign", scale: 1, amount: amount * 0.45 } };
}
