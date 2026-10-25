/**
 * Themes for a small floating world: the planter a tree grows in, and the
 * world around it (sky, skyline, clouds, sun and moon). A theme is a recipe
 * with several palettes and ranges; a seed resolves it into one concrete
 * look, so every object wears its own variant. MIT.
 *
 *   const look = themeFor({ planter: "seed", world: "seed", seed: 1234 });
 *   look.planter.colors.top   -> ["#d8264a", "#ff7d95"]
 *   look.planter.pattern      -> "facet"   (with shape, effect, decor, grain, speed)
 *   look.world.form           -> "pixel"   (only the voxel world is built of blocks)
 *   look.world.sun.style      -> "striped"
 *   look.name                 -> "Ruby · star · facet · shimmer · shards over Synthwave · night drive"
 *
 * Pure and deterministic. Colours are sRGB hex; the renderer decides how to
 * build geometry and animate effects, and keeps real light (sun height, night)
 * from its own model.
 */

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], random: () => number): T {
  const value = list[Math.floor(random() * list.length)] ?? list[0];
  if (value === undefined) throw new Error("pick from an empty list");
  return value;
}

// ---------------------------------------------------------------- colour

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

/** Mixes two sRGB colours; `amount` 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const t = clamp(amount, 0, 1);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Turns a colour round the hue wheel by `degrees`, keeping its lightness and saturation. */
export function shiftHue(hex: string, degrees: number): string {
  const [r, g, b] = parseHex(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return hex.toLowerCase();
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  const hue = (((raw * 60 + degrees) % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const sector = Math.floor(hue / 60);
  const sectors: readonly (readonly [number, number, number])[] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const [rr, gg, bb] = sectors[sector] ?? [0, 0, 0];
  const base = light - chroma / 2;
  return toHex((rr + base) * 255, (gg + base) * 255, (bb + base) * 255);
}

// ---------------------------------------------------------------- planters

export type PlanterId =
  | "earth" | "gold" | "goldOre" | "emerald" | "ruby" | "sapphire" | "amethyst" | "jade"
  | "marble" | "obsidian" | "granite" | "sandstone" | "lava" | "ice" | "chrome"
  | "cyber" | "vapor" | "antigravity" | "hologram" | "glitter" | "cosmic";

export type WorldId = "nature" | "beach" | "city" | "synth" | "vapor" | "crystal" | "cosmic" | "voxel";

/** The planter's outline seen from above; "tiered" steps down like a pedestal. */
export type Shape = "square" | "rounded" | "octagon" | "round" | "hex" | "tiered" | "blob" | "scallop" | "diamond" | Sculpt;
/** A sculpted planter: a carved body the tree grows out of the top of, instead of an outline pushed down. */
export type Sculpt = "skull" | "urn" | "stump" | "shell" | "head";
/** The pattern drawn over the planter's top and sides (a shader, not geometry). */
export type Pattern =
  | "turf" | "ingot" | "hammered" | "brushed" | "coins" | "nugget" | "facet" | "marble" | "speckle" | "strata"
  | "magma" | "frost" | "mirror" | "circuit" | "grid" | "checker" | "tile" | "scan" | "flake" | "stars";
/** How the surface moves: a light sweep, twinkles, pulses, scrolling, hue shimmer, swirling, flicker, flow, slow breathing, rainbow. */
export type Effect = "none" | "sweep" | "sparkle" | "pulse" | "scroll" | "shimmer" | "swirl" | "flicker" | "flow" | "breathe" | "rainbow";
/** Things set on the planter. */
export type Decor =
  | "none" | "ingots" | "coins" | "nuggets" | "shards" | "geodes" | "pillars" | "rocks" | "icicles"
  | "antennas" | "pylons" | "orbs" | "rings" | "discoball" | "vents";
/** Older layout name, kept for block (voxel) renderers. */
export type Surface = "turf" | "bars" | "slab" | "crystal" | "panel" | "grid" | "tile" | "speckle" | "strata";
/** What hangs under the planter. */
export type Underside = "cone" | "spire" | "float" | "slab" | "crystal" | "drip";
/** A band round the rim. */
export type Trim = "none" | "neon" | "studs" | "chrome" | "gold" | "frost";

/** One palette: [top, top2, body, body2, rim, accent]. */
type PlanterPalette = readonly [string, string, string, string, string, string];

interface PlanterRecipe {
  readonly label: string;
  readonly family: "earth" | "metal" | "gem" | "stone" | "molten" | "ice" | "tech" | "synth" | "float" | "holo" | "glitter" | "cosmic";
  readonly palettes: readonly (readonly [string, PlanterPalette])[];
  readonly patterns: readonly Pattern[];
  readonly effects: readonly Effect[];
  readonly decor: readonly Decor[];
  /** How many decor pieces, [min, max]. */
  readonly decorCount: readonly [number, number];
  readonly underside: readonly Underside[];
  readonly trim: readonly Trim[];
  /** 0 matte to 1 mirror-bright. */
  readonly shine: number;
  /** Self-lit share of the accent (veins, traces, crystals): 0 none, 1 neon. */
  readonly glow: number;
  /** Density of twinkling flakes in the surface, 0 to 1. */
  readonly sparkle: number;
  /** Veins or traces of the accent through the body and top, [min, max] share. */
  readonly veins: readonly [number, number];
  /** Opacity: below 1 is see-through (hologram). */
  readonly alpha: number;
  /** Hue drift between variants, degrees either way. */
  readonly drift: number;
  readonly worlds: readonly WorldId[];
}

const GEM = {
  patterns: ["facet", "facet", "marble"], effects: ["shimmer", "sparkle", "breathe"], decor: ["shards", "shards", "geodes"], decorCount: [5, 14],
  underside: ["crystal", "spire", "cone"], trim: ["none", "chrome", "gold"], shine: 0.8, glow: 0.4, sparkle: 0.25, veins: [0.04, 0.12], alpha: 1, drift: 8, worlds: ["crystal", "nature", "cosmic", "voxel"],
} as const;
const STONE = {
  effects: ["none", "breathe"], decor: ["rocks", "none", "pillars"], decorCount: [2, 7],
  underside: ["cone", "spire", "slab"], trim: ["none", "studs", "gold"], shine: 0.25, glow: 0, sparkle: 0.04, alpha: 1, drift: 5, worlds: ["nature", "crystal", "city", "voxel"],
} as const;

export const PLANTERS: Readonly<Record<PlanterId, PlanterRecipe>> = {
  earth: {
    label: "Earth", family: "earth", palettes: [["meadow", ["#739e61", "#b9c979", "#6d4d39", "#5a3f2e", "#6f4b35", "#8fbf58"]]],
    patterns: ["turf"], effects: ["none"], decor: ["none", "rocks"], decorCount: [0, 4], underside: ["cone"], trim: ["none"],
    shine: 0, glow: 0, sparkle: 0, veins: [0, 0], alpha: 1, drift: 0, worlds: ["nature", "beach", "city", "crystal", "voxel"],
  },
  gold: {
    label: "Polished gold", family: "metal", patterns: ["ingot", "hammered", "brushed", "coins"], effects: ["sweep", "sweep", "sparkle"],
    decor: ["ingots", "coins", "nuggets"], decorCount: [4, 12], underside: ["slab", "cone", "spire"], trim: ["gold", "chrome", "studs"],
    palettes: [["yellow gold", ["#d89a18", "#ffd040", "#8a5a0c", "#5a3a06", "#ffc830", "#fff0b0"]], ["rose gold", ["#c86a50", "#f0a080", "#8a4838", "#5e2e24", "#e89078", "#ffe0d0"]], ["24 karat", ["#e08a08", "#ffc820", "#8a4a04", "#5a3002", "#ffb810", "#fff0a0"]], ["white gold", ["#d8d2c0", "#f4efe0", "#a8a290", "#7c7666", "#e8e2d0", "#fffdf4"]], ["old gold", ["#b88c30", "#e8c460", "#7a5818", "#4e360c", "#d0a038", "#fff0b8"]]],
    shine: 1, glow: 0.05, sparkle: 0.35, veins: [0, 0], alpha: 1, drift: 4, worlds: ["nature", "city", "crystal", "cosmic", "vapor"],
  },
  goldOre: {
    label: "Gold ore", family: "stone", patterns: ["nugget", "strata", "speckle"], effects: ["sparkle", "breathe"], decor: ["nuggets", "rocks"], decorCount: [3, 9],
    underside: ["cone", "spire"], trim: ["none", "studs"],
    palettes: [["granite seam", ["#6e6458", "#857a6c", "#4f463d", "#3c352e", "#5d544a", "#ffcf4a"]], ["basalt seam", ["#3d3a3a", "#504b4a", "#2a2727", "#1f1d1d", "#3a3636", "#f5c23c"]], ["red rock seam", ["#9a5a3a", "#b4704a", "#7a4228", "#5e321e", "#8a4e32", "#ffd65a"]]],
    shine: 0.35, glow: 0.2, sparkle: 0.3, veins: [0.12, 0.26], alpha: 1, drift: 3, worlds: ["nature", "city", "crystal", "cosmic", "voxel"],
  },
  emerald: { ...GEM, label: "Emerald", family: "gem", palettes: [["clear", ["#2fbf7a", "#7ff0b8", "#1b6b4a", "#114a33", "#2a8a5e", "#c8ffe6"]], ["deep", ["#14915a", "#46c88a", "#0c4a30", "#07311f", "#167048", "#9affd0"]]] },
  ruby: { ...GEM, label: "Ruby", family: "gem", palettes: [["pigeon blood", ["#d8264a", "#ff7d95", "#7a1028", "#520a1a", "#a8183a", "#ffd0da"]], ["star", ["#c41e5a", "#ff8ab4", "#6a0e30", "#44081e", "#981846", "#ffe0ee"]]] },
  sapphire: { ...GEM, label: "Sapphire", family: "gem", palettes: [["royal", ["#2856d8", "#7aa0ff", "#142f7a", "#0c1f52", "#1e44a8", "#d0deff"]], ["teal", ["#1c8ab0", "#6fd2f0", "#0e4a60", "#08303e", "#166e8c", "#d0f6ff"]]] },
  amethyst: { ...GEM, label: "Amethyst", family: "gem", palettes: [["violet", ["#8f4ad8", "#c9a0ff", "#4c2478", "#331852", "#6a34a8", "#efe0ff"]], ["lavender", ["#b48ae8", "#e0ccff", "#6a4a98", "#4a3270", "#8e6ac0", "#ffffff"]]] },
  jade: {
    ...GEM, label: "Jade", family: "gem", patterns: ["marble", "speckle"], effects: ["breathe", "shimmer"], decor: ["pillars", "orbs", "rocks"], decorCount: [2, 6], shine: 0.55, glow: 0.15, sparkle: 0.05,
    palettes: [["imperial", ["#3aa86a", "#8ad8a0", "#1e6a40", "#124428", "#2a8a54", "#e8fff0"]], ["lavender jade", ["#9a86c8", "#c4b4e4", "#6a5a98", "#483a70", "#8a78b8", "#4a3a78"]], ["celadon", ["#9cc8a8", "#cce8d4", "#6a9a7a", "#4a7058", "#88b898", "#f4fff8"]]],
  },
  marble: { ...STONE, label: "Marble", family: "stone", patterns: ["marble"], effects: ["none", "sweep"], decor: ["pillars", "orbs", "none"], palettes: [["carrara", ["#ecebe6", "#ffffff", "#d6d3cb", "#bdb9ae", "#c9c5bb", "#8a857c"]], ["nero", ["#2a2a2e", "#3c3c42", "#1c1c20", "#121216", "#26262a", "#e8e2d0"]], ["rosa", ["#ead2cc", "#f8e6e2", "#d0b2aa", "#b8968c", "#dcc0b8", "#9a6e64"]], ["verde", ["#2e4a40", "#45685a", "#1e322a", "#14241e", "#2a4038", "#e8f0e0"]]], veins: [0.14, 0.28], shine: 0.5 },
  obsidian: { ...STONE, label: "Obsidian", family: "stone", patterns: ["facet", "mirror", "marble"], effects: ["sweep", "shimmer"], decor: ["shards", "rocks"], palettes: [["black glass", ["#1a1622", "#2c2638", "#0e0b14", "#08060c", "#1c1828", "#8a6cff"]], ["snowflake", ["#1c1c22", "#33333c", "#101014", "#08080a", "#202026", "#e8eef8"]], ["rainbow", ["#141620", "#222838", "#0a0c12", "#06070a", "#181c28", "#5af0c8"]]], veins: [0.02, 0.08], shine: 0.85, glow: 0.2, sparkle: 0.1 },
  granite: { ...STONE, label: "Granite", family: "stone", patterns: ["speckle"], palettes: [["grey", ["#8e8a86", "#a8a39d", "#6b6764", "#585451", "#7a7672", "#c9c3bb"]], ["pink", ["#b08a80", "#c8a49a", "#8a6a62", "#6e544e", "#9a7a72", "#e8d0c8"]], ["blue pearl", ["#4a5260", "#6a7484", "#323844", "#22262e", "#3e4654", "#a8c8f0"]]], veins: [0.02, 0.06], sparkle: 0.12 },
  sandstone: { ...STONE, label: "Sandstone", family: "stone", patterns: ["strata"], decor: ["rocks", "pillars"], palettes: [["desert", ["#d8a86c", "#e8c48e", "#b07e48", "#8e6236", "#c49058", "#f2dcb0"]], ["red canyon", ["#c4744a", "#dc9468", "#9a5432", "#7a3e22", "#b0623c", "#f0c4a0"]], ["wave", ["#e0a070", "#f4c8a0", "#b8683c", "#904c28", "#cc8250", "#fff0dc"]]], veins: [0.04, 0.1], worlds: ["nature", "beach", "crystal", "voxel"] },
  lava: {
    label: "Lava", family: "molten", patterns: ["magma"], effects: ["flow", "breathe"], decor: ["rocks", "vents"], decorCount: [3, 8],
    underside: ["drip", "cone", "spire"], trim: ["none"],
    palettes: [["basalt", ["#2a2220", "#3a2e2a", "#1a1412", "#100c0a", "#241c1a", "#ff5a14"]], ["blue fire", ["#1e2028", "#2a2e38", "#121418", "#0a0c10", "#1c1e26", "#3ac8ff"]], ["magma", ["#3a1e14", "#4a2a1c", "#22100a", "#140806", "#301810", "#ffb020"]]],
    shine: 0.3, glow: 1, sparkle: 0.05, veins: [0.18, 0.32], alpha: 1, drift: 6, worlds: ["nature", "cosmic", "synth", "voxel"],
  },
  ice: {
    label: "Ice", family: "ice", patterns: ["frost", "facet"], effects: ["shimmer", "sparkle"], decor: ["icicles", "shards"], decorCount: [4, 12],
    underside: ["drip", "crystal", "spire"], trim: ["frost", "none", "chrome"],
    palettes: [["glacier", ["#bfe6f4", "#ecfaff", "#7ab8d8", "#4a88b0", "#a8d8f0", "#ffffff"]], ["aurora", ["#a8f0e0", "#e8fff8", "#5ab0c8", "#3a7898", "#90e0d0", "#c8a8ff"]], ["deep ice", ["#6aa8d8", "#b8e0ff", "#2a68a8", "#18487a", "#5a98c8", "#e8f8ff"]]],
    shine: 0.85, glow: 0.2, sparkle: 0.4, veins: [0.04, 0.12], alpha: 1, drift: 8, worlds: ["nature", "crystal", "cosmic", "voxel"],
  },
  chrome: {
    label: "Liquid chrome", family: "metal", patterns: ["mirror", "brushed"], effects: ["sweep", "rainbow", "flow"], decor: ["orbs", "rings", "pillars"], decorCount: [2, 6],
    underside: ["slab", "cone", "float"], trim: ["chrome", "neon"],
    palettes: [["mirror", ["#c8ccd8", "#f4f6fc", "#8a90a0", "#5a6070", "#e0e4ec", "#ffffff"]], ["black chrome", ["#3a3c44", "#7a7e8c", "#1e2026", "#121318", "#5a5e6a", "#c8d0ff"]], ["oil slick", ["#2e2a42", "#5a7a98", "#1e1c30", "#121020", "#8a6ab8", "#ffe0a8"]]],
    shine: 1, glow: 0.1, sparkle: 0.15, veins: [0, 0], alpha: 1, drift: 20, worlds: ["city", "vapor", "synth", "cosmic"],
  },
  cyber: {
    label: "Cyber tech", family: "tech", patterns: ["circuit", "grid"], effects: ["pulse", "scroll"], decor: ["antennas", "pylons", "vents"], decorCount: [3, 8],
    underside: ["slab", "float"], trim: ["neon"],
    palettes: [["ice", ["#1c2030", "#262c40", "#121521", "#0b0d15", "#161a28", "#00f0ff"]], ["magenta", ["#221a2e", "#30243f", "#140f1c", "#0c0812", "#1c1426", "#ff2bd6"]], ["acid", ["#18221e", "#22302a", "#0e1512", "#080d0b", "#141e1a", "#3dff8a"]], ["amber", ["#241e18", "#322a20", "#15110d", "#0c0a08", "#1e1913", "#ffb000"]]],
    shine: 0.6, glow: 1, sparkle: 0.02, veins: [0.1, 0.22], alpha: 1, drift: 10, worlds: ["city", "synth"],
  },
  vapor: {
    label: "Vapor", family: "synth", patterns: ["checker", "grid", "tile"], effects: ["rainbow", "scroll", "shimmer"], decor: ["pillars", "orbs", "rings"], decorCount: [2, 6],
    underside: ["slab", "cone", "float"], trim: ["chrome", "neon"],
    palettes: [["sunset", ["#ff9ad5", "#ffd1ec", "#9a6bff", "#6c48c8", "#7fe9ff", "#ffffff"]], ["mall", ["#7fe9ff", "#c8f8ff", "#ff7ac8", "#c85aa0", "#ffd36e", "#ffffff"]], ["lilac", ["#c8a8ff", "#efe2ff", "#ff9ec8", "#d872a4", "#9ef0ff", "#ffffff"]]],
    shine: 0.8, glow: 0.6, sparkle: 0.06, veins: [0, 0.04], alpha: 1, drift: 12, worlds: ["vapor", "synth", "beach"],
  },
  antigravity: {
    label: "Anti-gravity", family: "float", patterns: ["speckle", "facet", "circuit"], effects: ["breathe", "pulse"], decor: ["rings", "rocks", "orbs"], decorCount: [3, 8],
    underside: ["float"], trim: ["neon", "none"],
    palettes: [["void stone", ["#5a5868", "#6e6c80", "#3c3a48", "#2a2834", "#4a4858", "#7af0ff"]], ["red moon", ["#6a4a44", "#82605a", "#48302c", "#32201e", "#5a3e3a", "#ff6a4a"]], ["violet", ["#4a4060", "#5e5278", "#302844", "#201a2e", "#3e3452", "#c08aff"]]],
    shine: 0.3, glow: 0.8, sparkle: 0.05, veins: [0.06, 0.14], alpha: 1, drift: 10, worlds: ["cosmic", "synth", "crystal"],
  },
  hologram: {
    label: "Hologram", family: "holo", patterns: ["scan", "grid"], effects: ["flicker", "scroll"], decor: ["rings", "pylons", "orbs"], decorCount: [2, 5],
    underside: ["float", "slab"], trim: ["neon"],
    palettes: [["cyan", ["#1fb8e8", "#3fd8ff", "#1f78d8", "#1a4ab0", "#6ff0ff", "#0a5aa8"]], ["rose", ["#d83ac8", "#ff6ae0", "#9a3aff", "#6a2ad0", "#ff9af0", "#7a1a9a"]], ["lime", ["#2ad870", "#5aff8a", "#1ac8a0", "#10a078", "#a8ff8a", "#0a7a48"]]],
    shine: 0.5, glow: 1, sparkle: 0.05, veins: [0, 0], alpha: 0.4, drift: 14, worlds: ["synth", "city", "cosmic"],
  },
  glitter: {
    label: "Glitter", family: "glitter", patterns: ["flake"], effects: ["sparkle", "rainbow", "shimmer"], decor: ["discoball", "orbs", "shards"], decorCount: [1, 5],
    underside: ["cone", "float", "crystal"], trim: ["chrome", "neon", "gold"],
    palettes: [["party", ["#ff6ac8", "#ffb0e4", "#a04ad8", "#6a2aa0", "#ffd36e", "#ffffff"]], ["silver", ["#a8b0c8", "#e8ecf4", "#6a7088", "#4a5068", "#d8dce8", "#ffffff"]], ["disco", ["#3a5aff", "#8ab0ff", "#2a2a8a", "#1a1a5a", "#ffcf5a", "#ffffff"]], ["gold dust", ["#d8a030", "#ffe08a", "#8a5a18", "#5a3a0c", "#ffd060", "#ffffff"]], ["mermaid", ["#2ad8c8", "#a8fff0", "#1a7a9a", "#0e4a6a", "#c88aff", "#ffffff"]]],
    shine: 1, glow: 0.3, sparkle: 1, veins: [0, 0], alpha: 1, drift: 20, worlds: ["vapor", "cosmic", "crystal", "city", "beach"],
  },
  cosmic: {
    label: "Cosmic", family: "cosmic", patterns: ["stars"], effects: ["swirl", "sparkle"], decor: ["orbs", "rings", "shards"], decorCount: [2, 6],
    underside: ["float", "spire"], trim: ["none", "neon"],
    palettes: [["nebula", ["#1a1040", "#2a1a60", "#0c0820", "#06040f", "#1e1448", "#ff9af0"]], ["deep field", ["#0c1430", "#162448", "#060a18", "#03050c", "#0e1838", "#9af0ff"]], ["supernova", ["#2a0e2a", "#401640", "#160616", "#0c030c", "#2a0a2a", "#ffcf6a"]]],
    shine: 0.4, glow: 0.7, sparkle: 0.4, veins: [0.04, 0.1], alpha: 1, drift: 20, worlds: ["cosmic"],
  },
};

export const PLANTER_IDS = Object.keys(PLANTERS) as PlanterId[];

export interface PlanterLook {
  readonly id: PlanterId;
  readonly label: string;
  readonly family: PlanterRecipe["family"];
  readonly variant: string;
  readonly colors: { readonly top: readonly [string, string]; readonly body: readonly [string, string]; readonly rim: string; readonly accent: string };
  readonly shape: Shape;
  /** Side slope: below 0 the body narrows toward its foot like a pedestal, above 0 it flares like a bowl. */
  readonly flare: number;
  /** Body depth as a share of the default, and a seed for organic outlines. */
  readonly height: number;
  readonly wobble: number;
  readonly pattern: Pattern;
  readonly effect: Effect;
  readonly decor: Decor;
  readonly decorCount: number;
  /** Pattern scale and effect speed, around 1, so two of a kind still differ. */
  readonly grain: number;
  readonly speed: number;
  /** The layout a block (voxel) renderer uses for this pattern. */
  readonly surface: Surface;
  readonly underside: Underside;
  readonly trim: Trim;
  readonly shine: number;
  readonly glow: number;
  readonly sparkle: number;
  readonly veins: number;
  /** Crystal clusters a block renderer grows on the top. */
  readonly crystals: number;
  readonly alpha: number;
  /** Earth turf follows the seasons; every other planter keeps its colours. */
  readonly seasonal: boolean;
  /** Bob of floating chunks, world units (anti-gravity floats the most). */
  readonly bob: number;
  /** How deep the underside hangs, as a share of the default. */
  readonly depth: number;
  /** The planter's width as a share of the full-size one: most are small, a few tiny, a few large. */
  readonly size: number;
  /** True when `shape` is a sculpt. */
  readonly sculpted: boolean;
}

// ---------------------------------------------------------------- planter form
// The planter's shape and size are their own attribute, rolled on their own
// stream: any material can take any outline or sculpt at any size.

/** Plain outlines, equally likely. */
export const PLAIN_SHAPES: readonly Shape[] = ["square", "rounded", "octagon", "round", "hex", "tiered", "blob", "scallop", "diamond"];
/** Sculpts by draw weight out of 1000 (130 in all, so about one planter in eight): urns and stumps are the commonest, a skull the rarest. */
export const SCULPT_WEIGHTS: Readonly<Record<Sculpt, number>> = { urn: 34, stump: 30, shell: 26, head: 22, skull: 18 };
export const SHAPE_IDS: readonly Shape[] = [...PLAIN_SHAPES, ...(Object.keys(SCULPT_WEIGHTS) as Sculpt[])];

export interface PlanterForm {
  readonly shape: Shape;
  /** True when `shape` is a sculpt. */
  readonly sculpted: boolean;
  /** Width as a share of the full-size planter. */
  readonly size: number;
  /** "tiny", "grand" or "" for the name. */
  readonly sizeWord: string;
  readonly flare: number;
  readonly height: number;
  readonly wobble: number;
}

const isSculpt = (shape: string): shape is Sculpt => Object.hasOwn(SCULPT_WEIGHTS, shape);

function rolledShape(roll: number, plain: Shape): Shape {
  let reach = 0;
  for (const [sculpt, weight] of Object.entries(SCULPT_WEIGHTS) as [Sculpt, number][]) {
    reach += weight;
    if (roll < reach) return sculpt;
  }
  return plain;
}

/** The planter's shape and size; `forced` is a shape id, anything else lets the seed roll. Every draw is taken either way, so forcing the shape never moves the size. */
export function resolveForm(forced: string | undefined, random: () => number): PlanterForm {
  const { size, word } = planterSize(random);
  const roll = Math.floor(random() * 1000);
  const plain = pick(PLAIN_SHAPES, random);
  const flare = Math.round((random() * 2 - 1) * 100) / 100 * 0.25;
  const height = 0.75 + random() * 0.7;
  const wobble = Math.floor(random() * 1000);
  const shape = SHAPE_IDS.includes(forced as Shape) ? (forced as Shape) : rolledShape(roll, plain);
  return { shape, sculpted: isSculpt(shape), size, sizeWord: word, flare, height, wobble };
}

/** Planter size classes: [upper bound of the roll, smallest, largest, word for the name]. */
const PLANTER_SIZES: readonly (readonly [number, number, number, string])[] = [
  [0.18, 0.45, 0.58, "tiny"],
  [0.6, 0.58, 0.75, ""],
  [0.92, 0.75, 0.9, ""],
  [1, 0.9, 1.05, "grand"],
];

/** A sculpt is its own foot: it floats on loose rocks, with no rim band. */
function footFor(form: PlanterForm, underside: Underside, trim: Trim, bob: number): { readonly underside: Underside; readonly trim: Trim; readonly bob: number } {
  return form.sculpted ? { underside: "float", trim: "none", bob: 0.05 } : { underside, trim, bob };
}

function planterSize(random: () => number): { readonly size: number; readonly word: string } {
  const roll = random();
  const [, low, high, word] = PLANTER_SIZES.find(([upper]) => roll < upper) ?? PLANTER_SIZES[1] ?? [1, 0.6, 0.75, ""];
  return { size: Math.round((low + random() * (high - low)) * 100) / 100, word };
}

const BLOCK_SURFACE: Readonly<Record<Pattern, Surface>> = {
  turf: "turf", ingot: "bars", hammered: "slab", brushed: "slab", coins: "tile", nugget: "speckle", facet: "crystal", marble: "slab", speckle: "speckle", strata: "strata",
  magma: "speckle", frost: "crystal", mirror: "slab", circuit: "panel", grid: "grid", checker: "tile", tile: "tile", scan: "grid", flake: "tile", stars: "speckle",
};

function resolvePlanter(id: PlanterId, random: () => number, form: PlanterForm): PlanterLook {
  const recipe = PLANTERS[id];
  const [paletteName, palette] = pick(recipe.palettes, random);
  const hue = (random() * 2 - 1) * recipe.drift;
  const tint = (hex: string): string => (hue === 0 ? hex : shiftHue(hex, hue));
  const [top, top2, body, body2, rim, accent] = palette.map(tint) as unknown as PlanterPalette;
  const pattern = pick(recipe.patterns, random);
  const effect = pick(recipe.effects, random);
  const decor = pick(recipe.decor, random);
  const decorCount = decor === "none" ? 0 : Math.round(recipe.decorCount[0] + random() * (recipe.decorCount[1] - recipe.decorCount[0]));
  const underside = pick(recipe.underside, random);
  const trim = pick(recipe.trim, random);
  const veins = recipe.veins[0] + random() * (recipe.veins[1] - recipe.veins[0]);
  const bob = underside === "float" ? (recipe.family === "float" ? 0.16 : 0.08) * (0.7 + random() * 0.6) : 0;
  const depth = 0.8 + random() * 0.6;
  const foot = footFor(form, underside, trim, bob);
  const words = [form.sizeWord, form.sculpted ? form.shape : "", paletteName, pattern === "turf" ? "" : pattern, effect === "none" ? "" : effect, decor === "none" ? "" : decor].filter((word) => word !== "");
  return {
    id, label: recipe.label, family: recipe.family, variant: words.join(" · "),
    colors: { top: [top, top2], body: [body, body2], rim, accent },
    shape: form.shape, sculpted: form.sculpted, flare: form.flare, height: form.height, wobble: form.wobble, pattern, effect, decor, decorCount, grain: 0.75 + random() * 0.6, speed: 0.7 + random() * 0.7,
    surface: BLOCK_SURFACE[pattern], underside: foot.underside, trim: foot.trim, shine: recipe.shine, glow: recipe.glow, sparkle: recipe.sparkle, veins,
    crystals: decor === "shards" || decor === "geodes" ? decorCount : 0, alpha: recipe.alpha,
    seasonal: recipe.family === "earth",
    bob: foot.bob, depth, size: form.size,
  };
}

// ---------------------------------------------------------------- worlds

export type Skyline = "ridges" | "shore" | "city" | "grid" | "spires" | "void";
export type CloudStyle = "puff" | "voxel" | "pastel" | "neon" | "nebula" | "none";
/** How the whole scene is built: smooth low-poly shapes drawn as pixel art, or whole voxel blocks. */
export type Form = "pixel" | "voxel";
export type SunStyle = "disc" | "striped" | "ring" | "star";
export type MoonStyle = "disc" | "ringed" | "big" | "neon";

interface WorldPalette {
  /** Sky top and horizon by day, horizon and top by night. */
  readonly sky: readonly [string, string, string, string];
  /** Skyline low, mid and high, then its accent (window lights, neon, crystal glow). On a shore: sand, shallows, deep water, surf. */
  readonly skyline: readonly [string, string, string, string];
  readonly cloud: readonly [string, string];
  /** Sun gradient top to bottom. */
  readonly sun: readonly [string, string];
  readonly moon: string;
  /** Tint mixed into the key light. */
  readonly light: string;
}

interface WorldRecipe {
  readonly label: string;
  readonly form: Form;
  readonly skyline: Skyline;
  readonly clouds: readonly CloudStyle[];
  readonly sun: readonly SunStyle[];
  readonly moon: readonly MoonStyle[];
  readonly palettes: readonly (readonly [string, WorldPalette])[];
  /** How far the theme's sky overrides the real sky colours, 0 to 1. */
  readonly skyMix: number;
  /** How far the key light takes the theme's tint. */
  readonly lightMix: number;
  /** Stars, as a multiple of the natural count. */
  readonly stars: number;
}

export const WORLDS: Readonly<Record<WorldId, WorldRecipe>> = {
  nature: {
    label: "Nature", form: "pixel", skyline: "ridges", clouds: ["puff"], sun: ["disc"], moon: ["disc"], skyMix: 0, lightMix: 0, stars: 1,
    palettes: [["valley", { sky: ["#d6edf0", "#91b4bd", "#2a5963", "#081a24"], skyline: ["#739e61", "#4c6b55", "#7d8486", "#f1f4f2"], cloud: ["#ffffff", "#e6eef2"], sun: ["#fff1cf", "#fff1cf"], moon: "#c9d6ff", light: "#ffffff" }]],
  },
  beach: {
    label: "Beach", form: "pixel", skyline: "shore", clouds: ["puff", "pastel"], sun: ["disc", "striped"], moon: ["big", "disc"], skyMix: 0.75, lightMix: 0.15, stars: 1.2,
    palettes: [
      ["tropic noon", { sky: ["#2fa8ff", "#bff4ff", "#1a3a6a", "#040a1e"], skyline: ["#f4e2b0", "#2ad8d0", "#0a6ab8", "#ffffff"], cloud: ["#ffffff", "#d8f4ff"], sun: ["#fffbe0", "#fff0a0"], moon: "#f0f4ff", light: "#fff6e0" }],
      ["golden hour", { sky: ["#ff9a4a", "#ffd88a", "#3a1a4a", "#0a0418"], skyline: ["#f0c890", "#ff8a6a", "#2a2a7a", "#fff0d0"], cloud: ["#ffd0a0", "#ff9a8a"], sun: ["#fff0a0", "#ff6a3a"], moon: "#ffe0c0", light: "#ffc89a" }],
      ["vapor cove", { sky: ["#ff9ad8", "#9af0ff", "#3a1a6a", "#0e0628"], skyline: ["#ffd8ec", "#5af0e8", "#8a4ae8", "#ffffff"], cloud: ["#ffe0f4", "#c0f4ff"], sun: ["#fff09a", "#ff5ab0"], moon: "#e0f8ff", light: "#ffd8f4" }],
    ],
  },
  city: {
    label: "Cityscape", form: "pixel", skyline: "city", clouds: ["puff", "none"], sun: ["disc"], moon: ["disc", "big"], skyMix: 0.3, lightMix: 0.12, stars: 0.4,
    palettes: [
      ["dusk", { sky: ["#f2c9a0", "#e98a6a", "#2a2440", "#0a0a18"], skyline: ["#2a2e3c", "#3a3f52", "#52586e", "#ffd27a"], cloud: ["#ffd9c0", "#c8a0a8"], sun: ["#ffe6a0", "#ff8a5a"], moon: "#f4e8d0", light: "#ffd8b0" }],
      ["neon", { sky: ["#3a2a6a", "#c84aa0", "#1a0f30", "#06040e"], skyline: ["#14121e", "#1e1a2c", "#2a243e", "#ff2bd6"], cloud: ["#8a5ab0", "#5a3a80"], sun: ["#ffb0e0", "#ff3d8b"], moon: "#e0d0ff", light: "#ffb0f0" }],
      ["metro", { sky: ["#cfdbe6", "#8ea4b8", "#1e2a38", "#080c14"], skyline: ["#4a5260", "#5e6878", "#76808e", "#9ff0ff"], cloud: ["#e8eef4", "#b8c4d0"], sun: ["#fff6e0", "#ffe0a0"], moon: "#d8e4ff", light: "#f0f4ff" }],
    ],
  },
  synth: {
    label: "Synthwave", form: "pixel", skyline: "grid", clouds: ["neon", "none"], sun: ["striped"], moon: ["neon", "big"], skyMix: 0.78, lightMix: 0.3, stars: 1.6,
    palettes: [
      ["night drive", { sky: ["#1a0838", "#ff3d8b", "#12052a", "#05020c"], skyline: ["#12052a", "#2a0a4a", "#4a1070", "#ff2bd6"], cloud: ["#ff5ad8", "#5ad8ff"], sun: ["#ffe23f", "#ff2b7a"], moon: "#5af0ff", light: "#ff9ad8" }],
      ["outrun", { sky: ["#0a0628", "#ff7a3d", "#0a0420", "#030108"], skyline: ["#0a0628", "#1a0a48", "#2a1070", "#00f0ff"], cloud: ["#00f0ff", "#ff3dd0"], sun: ["#fff04a", "#ff3d3d"], moon: "#ff8af0", light: "#ffb08a" }],
    ],
  },
  vapor: {
    label: "Vaporwave", form: "pixel", skyline: "grid", clouds: ["pastel"], sun: ["striped", "disc"], moon: ["big", "ringed"], skyMix: 0.7, lightMix: 0.25, stars: 0.8,
    palettes: [
      ["pastel", { sky: ["#ffc8ec", "#a8e8ff", "#5a3a8a", "#1a1038"], skyline: ["#b88ae8", "#d8a8f0", "#ffc8ec", "#7ff0ff"], cloud: ["#ffd8f0", "#c8f0ff"], sun: ["#ffe8a8", "#ff9ad0"], moon: "#ffe0f8", light: "#ffd8f0" }],
      ["mall", { sky: ["#a8f0ff", "#ffb0d8", "#4a2a7a", "#140a30"], skyline: ["#7fd8e8", "#a8b8ff", "#ffb0d8", "#ffffff"], cloud: ["#ffffff", "#ffd0ea"], sun: ["#ffd0f0", "#8ad8ff"], moon: "#ffffff", light: "#e8f0ff" }],
    ],
  },
  crystal: {
    label: "Crystal", form: "pixel", skyline: "spires", clouds: ["puff", "pastel"], sun: ["ring", "disc"], moon: ["ringed", "disc"], skyMix: 0.35, lightMix: 0.1, stars: 1.3,
    palettes: [
      ["aurora", { sky: ["#c8f0e8", "#9ab8e8", "#1a2a58", "#060a1e"], skyline: ["#4a6aa8", "#6a8ad8", "#a8c8ff", "#9affe0"], cloud: ["#f0faff", "#d0e0ff"], sun: ["#f8fff0", "#c8f0ff"], moon: "#e0f0ff", light: "#e8f8ff" }],
      ["rose quartz", { sky: ["#ffe0ea", "#e8b0c8", "#3a1a40", "#10061a"], skyline: ["#b87a98", "#d898b8", "#ffc8e0", "#ffd0f0"], cloud: ["#fff0f6", "#f0d0e0"], sun: ["#fff0f0", "#ffc8d8"], moon: "#ffe8f0", light: "#fff0f4" }],
    ],
  },
  cosmic: {
    label: "Cosmic", form: "pixel", skyline: "void", clouds: ["nebula"], sun: ["star", "ring"], moon: ["ringed", "big"], skyMix: 0.9, lightMix: 0.2, stars: 3.5,
    palettes: [
      ["nebula", { sky: ["#1a0c3a", "#5a2a8a", "#0a0420", "#020108"], skyline: ["#2a2438", "#3a3248", "#4a4258", "#ff9af0"], cloud: ["#ff6ad8", "#6a8aff"], sun: ["#ffffff", "#ffe0a0"], moon: "#ffd0a0", light: "#e0d0ff" }],
      ["deep field", { sky: ["#06102a", "#18306a", "#020618", "#000206"], skyline: ["#1e2430", "#2a3242", "#3a4456", "#9af0ff"], cloud: ["#4ad8ff", "#8a5aff"], sun: ["#e8f8ff", "#a8d8ff"], moon: "#c8e0ff", light: "#d8ecff" }],
    ],
  },
  voxel: {
    label: "Voxel craft", form: "voxel", skyline: "ridges", clouds: ["voxel"], sun: ["disc"], moon: ["disc"], skyMix: 0.2, lightMix: 0.05, stars: 1,
    palettes: [
      ["blockland", { sky: ["#bfe4ff", "#88b8e8", "#203a68", "#060c20"], skyline: ["#6aa84a", "#4a7a3a", "#8a8a8a", "#ffffff"], cloud: ["#ffffff", "#e8f0f8"], sun: ["#fff8d0", "#fff8d0"], moon: "#e0e8ff", light: "#ffffff" }],
      ["highlands", { sky: ["#d8e8e0", "#a0b8b0", "#28404a", "#08121a"], skyline: ["#7a9a5a", "#5a7048", "#908880", "#f4f4f0"], cloud: ["#f4f8f8", "#d8e4e4"], sun: ["#fff0c8", "#fff0c8"], moon: "#d0dcff", light: "#fff8f0" }],
    ],
  },
};

export const WORLD_IDS = Object.keys(WORLDS) as WorldId[];

export interface WorldLook {
  readonly id: WorldId;
  readonly label: string;
  readonly variant: string;
  readonly form: Form;
  readonly skyline: Skyline;
  readonly clouds: CloudStyle;
  readonly sky: WorldPalette["sky"];
  readonly skylineColors: WorldPalette["skyline"];
  readonly cloudColors: WorldPalette["cloud"];
  readonly sun: { readonly style: SunStyle; readonly colors: WorldPalette["sun"]; readonly size: number };
  readonly moon: { readonly style: MoonStyle; readonly color: string; readonly size: number };
  readonly skyMix: number;
  readonly light: { readonly tint: string; readonly mix: number };
  readonly stars: number;
  /** Skyline height scale and density, for variety between objects. */
  readonly height: number;
  readonly density: number;
}

function resolveWorld(id: WorldId, random: () => number): WorldLook {
  const recipe = WORLDS[id];
  const [variant, palette] = pick(recipe.palettes, random);
  const sun = pick(recipe.sun, random);
  const moon = pick(recipe.moon, random);
  return {
    id, label: recipe.label, variant, form: recipe.form, skyline: recipe.skyline, clouds: pick(recipe.clouds, random),
    sky: palette.sky, skylineColors: palette.skyline, cloudColors: palette.cloud,
    sun: { style: sun, colors: palette.sun, size: sun === "striped" ? 0.16 + random() * 0.06 : sun === "star" ? 0.05 : 0.04 + random() * 0.02 },
    moon: { style: moon, color: palette.moon, size: moon === "big" || moon === "neon" ? 0.1 + random() * 0.05 : 0.035 + random() * 0.02 },
    skyMix: recipe.skyMix, light: { tint: palette.light, mix: recipe.lightMix }, stars: recipe.stars,
    height: 0.8 + random() * 0.5, density: 0.75 + random() * 0.5,
  };
}

// ---------------------------------------------------------------- tree skins

export type TreeSkinId = "natural" | "crystal" | "petrified" | "frost" | "gold" | "ember" | "mystic" | "hologram" | "cosmic";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
/** The shape each leaf takes: the species' own leaf, or one that matches the material. */
export type LeafShape = "natural" | "shard" | "chip" | "spike" | "coin" | "ember" | "orb" | "pixel" | "star";
/** The bark's surface: the species' own, or one of the planter patterns. */
export type BarkPattern = "natural" | Pattern;

interface TreeSkinRecipe {
  readonly label: string;
  readonly rarity: Rarity;
  /** Draws out of 1000. */
  readonly weight: number;
  readonly leaf: LeafShape;
  readonly bark: BarkPattern;
  readonly effect: Effect;
  /** Each: [bark, bark2, leaf, leaf2, leaf3, accent]. */
  readonly palettes: readonly (readonly [string, PlanterPalette])[];
  /** Leaf self-light, 0 to 1: above 0.5 the leaves are lights, not lit. */
  readonly glow: number;
  readonly shine: number;
  readonly alpha: number;
  /** Drifting lights round the crown. */
  readonly motes: number;
  /** Leaf size as a share of the species' own. */
  readonly leafSize: number;
}

export const TREE_SKINS: Readonly<Record<TreeSkinId, TreeSkinRecipe>> = {
  natural: { label: "Natural", rarity: "common", weight: 870, leaf: "natural", bark: "natural", effect: "none", palettes: [["species", ["#000000", "#000000", "#000000", "#000000", "#000000", "#000000"]]], glow: 0, shine: 0, alpha: 1, motes: 0, leafSize: 1 },
  crystal: {
    label: "Crystal", rarity: "uncommon", weight: 40, leaf: "shard", bark: "facet", effect: "shimmer", glow: 0.35, shine: 0.8, alpha: 1, motes: 0, leafSize: 1.1,
    palettes: [["emerald", ["#14583c", "#2a8a5e", "#2fbf7a", "#7ff0b8", "#46c88a", "#c8ffe6"]], ["ruby", ["#5a0c20", "#981846", "#d8264a", "#ff7d95", "#c41e5a", "#ffd0da"]], ["sapphire", ["#0c2a6a", "#1e44a8", "#2856d8", "#7aa0ff", "#1c8ab0", "#d0deff"]], ["amethyst", ["#3a1a60", "#6a34a8", "#8f4ad8", "#c9a0ff", "#b48ae8", "#efe0ff"]]],
  },
  petrified: {
    label: "Petrified", rarity: "uncommon", weight: 35, leaf: "chip", bark: "marble", effect: "none", glow: 0, shine: 0.4, alpha: 1, motes: 0, leafSize: 0.9,
    palettes: [["jade", ["#6a6a64", "#8e8a80", "#3aa86a", "#8ad8a0", "#2a8a54", "#e8fff0"]], ["sandstone", ["#8e6236", "#b07e48", "#d8a86c", "#e8c48e", "#c49058", "#f2dcb0"]], ["marble", ["#bdb9ae", "#d6d3cb", "#ecebe6", "#ffffff", "#c9c5bb", "#8a857c"]]],
  },
  frost: {
    label: "Frost", rarity: "rare", weight: 18, leaf: "spike", bark: "frost", effect: "sparkle", glow: 0.45, shine: 0.85, alpha: 1, motes: 12, leafSize: 1,
    palettes: [["glacier", ["#7ab8d8", "#bfe6f4", "#d8f4ff", "#ffffff", "#a8d8f0", "#e8f8ff"]], ["aurora", ["#5ab0c8", "#a8f0e0", "#c8fff0", "#e0d0ff", "#90e0d0", "#c8a8ff"]]],
  },
  gold: {
    label: "Golden", rarity: "rare", weight: 15, leaf: "coin", bark: "brushed", effect: "sweep", glow: 0.35, shine: 1, alpha: 1, motes: 0, leafSize: 0.85,
    palettes: [["yellow gold", ["#8a5a0c", "#d89a18", "#ffd040", "#f2b020", "#ffe48a", "#fff0b0"]], ["24 karat", ["#9a6a08", "#f0b820", "#ffe066", "#ffc61a", "#fff2a8", "#ffffff"]], ["antique gold", ["#6a4a10", "#b8862a", "#e8b84a", "#d49a2a", "#f6d68a", "#fff0c0"]]],
  },
  ember: {
    label: "Ember", rarity: "epic", weight: 8, leaf: "ember", bark: "magma", effect: "flow", glow: 0.9, shine: 0.3, alpha: 1, motes: 30, leafSize: 0.8,
    palettes: [["wildfire", ["#1a1412", "#2a2220", "#ff5a14", "#ffb020", "#ff3a0a", "#ffd06a"]], ["blue flame", ["#121418", "#1e2028", "#3ac8ff", "#a8ecff", "#2a7aff", "#e0f8ff"]]],
  },
  mystic: {
    label: "Mystic", rarity: "epic", weight: 7, leaf: "orb", bark: "marble", effect: "breathe", glow: 0.8, shine: 0.4, alpha: 1, motes: 40, leafSize: 0.7,
    palettes: [["twilight", ["#1e1430", "#3a2858", "#c08aff", "#7af0e0", "#ff9ae0", "#e8d0ff"]], ["spirit", ["#102028", "#1e3a48", "#7affd0", "#c8fff0", "#5ac8ff", "#e0fff8"]], ["blossom", ["#2a1424", "#4a2440", "#ff9ad8", "#ffd0f0", "#c88aff", "#fff0fa"]]],
  },
  hologram: {
    label: "Hologram", rarity: "legendary", weight: 4, leaf: "pixel", bark: "scan", effect: "flicker", glow: 1, shine: 0.5, alpha: 0.55, motes: 20, leafSize: 0.75,
    palettes: [["cyan", ["#1f78d8", "#3fd8ff", "#3fd8ff", "#6ff0ff", "#1fb8e8", "#ffffff"]], ["magenta", ["#9a3aff", "#ff6ae0", "#ff6ae0", "#ff9af0", "#d83ac8", "#ffffff"]], ["matrix", ["#10a078", "#5aff8a", "#5aff8a", "#a8ff8a", "#2ad870", "#ffffff"]]],
  },
  cosmic: {
    label: "Cosmic", rarity: "legendary", weight: 3, leaf: "star", bark: "stars", effect: "swirl", glow: 1, shine: 0.4, alpha: 1, motes: 50, leafSize: 0.7,
    palettes: [["nebula", ["#0c0820", "#2a1a60", "#ffffff", "#ff9af0", "#9af0ff", "#ffcf6a"]], ["supernova", ["#160616", "#401640", "#ffcf6a", "#ffffff", "#ff6a4a", "#ffe0a0"]]],
  },
};

export const TREE_SKIN_IDS = Object.keys(TREE_SKINS) as TreeSkinId[];

export interface TreeLook {
  readonly id: TreeSkinId;
  readonly label: string;
  readonly rarity: Rarity;
  readonly variant: string;
  readonly leaf: LeafShape;
  readonly bark: BarkPattern;
  readonly effect: Effect;
  readonly colors: { readonly bark: readonly [string, string]; readonly leaves: readonly [string, string, string]; readonly accent: string };
  readonly glow: number;
  readonly shine: number;
  readonly alpha: number;
  readonly motes: number;
  readonly leafSize: number;
  /** A natural tree keeps its species' colours and seasons. */
  readonly natural: boolean;
}

function rollSkin(random: () => number): TreeSkinId {
  let roll = random() * 1000;
  for (const id of TREE_SKIN_IDS) {
    roll -= TREE_SKINS[id].weight;
    if (roll < 0) return id;
  }
  return "natural";
}

function resolveTree(id: TreeSkinId, random: () => number): TreeLook {
  const recipe = TREE_SKINS[id];
  const [variant, palette] = pick(recipe.palettes, random);
  const [bark, bark2, leaf, leaf2, leaf3, accent] = palette;
  return {
    id, label: recipe.label, rarity: recipe.rarity, variant, leaf: recipe.leaf, bark: recipe.bark, effect: recipe.effect,
    colors: { bark: [bark, bark2], leaves: [leaf, leaf2, leaf3], accent },
    glow: recipe.glow, shine: recipe.shine, alpha: recipe.alpha, motes: recipe.motes, leafSize: recipe.leafSize, natural: id === "natural",
  };
}

// ---------------------------------------------------------------- signal glitch

/** The parts of the scene a glitch can hit. It never takes the whole frame unless it hits all three. */
export type GlitchPart = "planter" | "tree" | "world";
export const GLITCH_PARTS: readonly GlitchPart[] = ["planter", "tree", "world"];
/** How badly one part misbehaves. */
export type GlitchKind = "clean" | "scanlines" | "fringe" | "flicker" | "tear";

interface GlitchRecipe {
  readonly label: string;
  readonly rarity: Rarity;
  /** Draws out of 1000, per part. */
  readonly weight: number;
  /** Strengths handed to the render look, each 0 to 1. */
  readonly scanlines: number;
  readonly chroma: number;
  readonly glitch: number;
}

export const GLITCH_KINDS: Readonly<Record<GlitchKind, GlitchRecipe>> = {
  clean: { label: "Clean", rarity: "common", weight: 820, scanlines: 0, chroma: 0, glitch: 0 },
  scanlines: { label: "Scanlines", rarity: "uncommon", weight: 90, scanlines: 0.55, chroma: 0, glitch: 0 },
  fringe: { label: "Colour fringe", rarity: "uncommon", weight: 50, scanlines: 0.3, chroma: 0.8, glitch: 0 },
  flicker: { label: "Flicker", rarity: "rare", weight: 25, scanlines: 0.5, chroma: 0.5, glitch: 0.35 },
  tear: { label: "Torn signal", rarity: "epic", weight: 15, scanlines: 0.65, chroma: 0.7, glitch: 0.75 },
};
const GLITCH_KIND_IDS = Object.keys(GLITCH_KINDS) as GlitchKind[];
/** Draws out of 1000 for a full glitch: every part torn at full strength. */
const FULL_GLITCH_WEIGHT = 6;

export interface PartGlitch {
  readonly kind: GlitchKind;
  readonly scanlines: number;
  readonly chroma: number;
  readonly glitch: number;
}

export interface GlitchLook {
  /** "clean", "full", or the parts that glitch joined by "+", such as "tree" or "planter+world". */
  readonly id: string;
  readonly rarity: Rarity;
  readonly full: boolean;
  readonly parts: Readonly<Record<GlitchPart, PartGlitch>>;
}

const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

function rollKind(random: () => number): GlitchKind {
  let roll = random() * 1000;
  for (const id of GLITCH_KIND_IDS) {
    roll -= GLITCH_KINDS[id].weight;
    if (roll < 0) return id;
  }
  return "clean";
}

/** Each strength wavers a little per seed, so two torn trees never tear alike. */
function partGlitch(kind: GlitchKind, random: () => number, full = false): PartGlitch {
  const recipe = GLITCH_KINDS[kind];
  const vary = (value: number): number => (value === 0 ? 0 : Math.min(1, Math.round(value * (0.85 + random() * 0.3) * 100) / 100));
  return full ? { kind, scanlines: 0.8, chroma: 1, glitch: 1 } : { kind, scanlines: vary(recipe.scanlines), chroma: vary(recipe.chroma), glitch: vary(recipe.glitch) };
}

/**
 * Rolls each part on its own; a full glitch (all three torn at once) is a
 * separate, rarer draw. `forced` is "clean", "full", or one part's name, which
 * tears that part alone.
 */
function resolveGlitch(forced: string | undefined, random: () => number): GlitchLook {
  const fullRoll = random() * 1000 < FULL_GLITCH_WEIGHT;
  const kinds = GLITCH_PARTS.map((part) => {
    const rolled = rollKind(random);
    if (forced === "clean") return "clean";
    if (forced === "full") return "tear";
    if (forced !== undefined && (GLITCH_PARTS as readonly string[]).includes(forced)) return forced === part ? "tear" : "clean";
    return fullRoll ? "tear" : rolled;
  });
  const full = forced === "full" || (forced === undefined && fullRoll);
  const parts = Object.fromEntries(GLITCH_PARTS.map((part, index) => [part, partGlitch(kinds[index] ?? "clean", random, full)])) as Record<GlitchPart, PartGlitch>;
  const hit = GLITCH_PARTS.filter((part) => parts[part].kind !== "clean");
  const worst = hit.reduce<Rarity>((rarest, part) => {
    const rarity = GLITCH_KINDS[parts[part].kind].rarity;
    return RARITY_ORDER.indexOf(rarity) > RARITY_ORDER.indexOf(rarest) ? rarity : rarest;
  }, "common");
  return { id: full ? "full" : hit.length === 0 ? "clean" : hit.join("+"), rarity: full ? "legendary" : worst, full, parts };
}

function glitchName(glitch: GlitchLook): string {
  if (glitch.full) return " · legendary full glitch";
  const hit = GLITCH_PARTS.filter((part) => glitch.parts[part].kind !== "clean");
  if (hit.length === 0) return "";
  const label = { planter: "platform", tree: "tree", world: "background" } as const;
  return ` · ${hit.map((part) => `${label[part]} ${GLITCH_KINDS[glitch.parts[part].kind].label.toLowerCase()}`).join(", ")}`;
}

// ---------------------------------------------------------------- the theme

export interface ThemeInput {
  /** A planter id, or "seed" (or anything unknown) to let the seed choose. */
  readonly planter?: string;
  /** A planter shape or sculpt id (see `SHAPE_IDS`), or "seed" to roll it apart from the material. */
  readonly form?: string;
  /** A world id, or "seed" to let the seed choose one that suits the planter. */
  readonly world?: string;
  /** A tree skin id, or "seed" to roll one: most trees are natural, the finest are the rarest. */
  readonly tree?: string;
  /** "clean", "full", a part to tear ("planter", "tree", "world"), or "seed" to roll each part: most are clean, a full glitch is the rarest. */
  readonly glitch?: string;
  readonly seed: number;
}

export interface Theme {
  readonly planter: PlanterLook;
  readonly world: WorldLook;
  readonly tree: TreeLook;
  readonly glitch: GlitchLook;
  readonly name: string;
}

/** Earth is the most common planter; everything else is an even draw. */
function seededPlanter(random: () => number): PlanterId {
  const roll = random();
  return roll < 0.22 ? "earth" : pick(PLANTER_IDS.filter((id) => id !== "earth"), random);
}

/** Resolves a theme: the same input always gives the same look. */
export function themeFor(input: ThemeInput): Theme {
  const random = createRandom((input.seed >>> 0) ^ 0x7e3a11);
  const planterId = Object.hasOwn(PLANTERS, input.planter ?? "") ? (input.planter as PlanterId) : seededPlanter(random);
  // The shape and size roll on their own stream, apart from the material.
  const form = resolveForm(input.form, createRandom((input.seed >>> 0) ^ 0x5ca1e));
  const planter = resolvePlanter(planterId, random, form);
  const worldId = Object.hasOwn(WORLDS, input.world ?? "") ? (input.world as WorldId) : pick(PLANTERS[planterId].worlds, random);
  const world = resolveWorld(worldId, random);
  const planterName = planter.variant === "" ? planter.label : `${planter.label} · ${planter.variant}`;
  // The skin rolls on its own stream, so adding skins never moved a planter or world.
  const treeRandom = createRandom((input.seed >>> 0) ^ 0x5eed7a);
  const tree = resolveTree(Object.hasOwn(TREE_SKINS, input.tree ?? "") ? (input.tree as TreeSkinId) : rollSkin(treeRandom), treeRandom);
  const treeName = tree.natural ? "" : ` · ${tree.rarity} ${tree.label.toLowerCase()} tree (${tree.variant})`;
  const glitchRandom = createRandom((input.seed >>> 0) ^ 0x611c4);
  const forced = ["clean", "full", ...GLITCH_PARTS].includes(input.glitch ?? "") ? input.glitch : undefined;
  const glitch = resolveGlitch(forced, glitchRandom);
  return { planter, world, tree, glitch, name: `${planterName} over ${world.label} · ${world.variant}${treeName}${glitchName(glitch)}` };
}
