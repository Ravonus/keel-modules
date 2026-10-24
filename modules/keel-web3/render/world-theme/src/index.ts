/**
 * Themes for a small floating world: the planter a tree grows in, and the
 * world around it (sky, skyline, clouds, sun and moon). A theme is a recipe
 * with several palettes and ranges; a seed resolves it into one concrete
 * look, so every object wears its own variant. MIT.
 *
 *   const look = themeFor({ planter: "seed", world: "seed", seed: 1234 });
 *   look.planter.colors.top   -> ["#d8264a", "#ff7d95"]
 *   look.world.sun.style      -> "striped"
 *   look.name                 -> "Ruby · deep cut · neon trim over Synthwave · night drive"
 *
 * Pure and deterministic. Colours are sRGB hex; the renderer decides how to
 * build geometry and keeps real light (sun height, night) from its own model.
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
  | "earth" | "gold" | "goldOre" | "emerald" | "ruby" | "sapphire" | "amethyst"
  | "marble" | "obsidian" | "granite" | "sandstone"
  | "cyber" | "vapor" | "antigravity" | "hologram" | "glitter" | "cosmic";

export type WorldId = "nature" | "city" | "synth" | "vapor" | "crystal" | "cosmic";

/** How the planter's top is laid out. */
export type Surface = "turf" | "bars" | "slab" | "crystal" | "panel" | "grid" | "tile" | "speckle" | "strata";
/** What hangs under the planter. */
export type Underside = "cone" | "spire" | "float" | "slab" | "crystal";
/** A band round the rim: none, a lit neon line, metal studs or a chrome strip. */
export type Trim = "none" | "neon" | "studs" | "chrome";

/** One palette: [top, top2, body, body2, rim, accent]. */
type PlanterPalette = readonly [string, string, string, string, string, string];

interface PlanterRecipe {
  readonly label: string;
  readonly family: "earth" | "metal" | "gem" | "stone" | "tech" | "synth" | "float" | "holo" | "glitter" | "cosmic";
  readonly palettes: readonly (readonly [string, PlanterPalette])[];
  readonly surface: readonly Surface[];
  readonly underside: readonly Underside[];
  readonly trim: readonly Trim[];
  /** 0 matte to 1 mirror-bright: drives highlight ramps, since a cel look has no reflections. */
  readonly shine: number;
  /** Self-lit share of the accent (veins, traces, crystals): 0 none, 1 neon. */
  readonly glow: number;
  /** Share of surface cells that sparkle. */
  readonly sparkle: number;
  /** Veins or traces of the accent through the body and top, [min, max] share. */
  readonly veins: readonly [number, number];
  /** Crystal clusters on the top, [min, max]. */
  readonly crystals: readonly [number, number];
  /** Opacity: below 1 is see-through (hologram). */
  readonly alpha: number;
  /** Hue drift between variants, degrees either way. */
  readonly drift: number;
  readonly worlds: readonly WorldId[];
}

const GEM = { surface: ["crystal", "slab"], underside: ["crystal", "spire", "cone"], trim: ["none", "chrome", "studs"], shine: 0.75, glow: 0.35, sparkle: 0.06, veins: [0.04, 0.12], crystals: [8, 18], alpha: 1, drift: 8, worlds: ["crystal", "nature", "cosmic"] } as const;
const STONE = { underside: ["cone", "spire", "slab"], trim: ["none", "studs"], shine: 0.2, glow: 0, sparkle: 0, crystals: [0, 3], alpha: 1, drift: 5, worlds: ["nature", "crystal", "city"] } as const;

export const PLANTERS: Readonly<Record<PlanterId, PlanterRecipe>> = {
  earth: { label: "Earth", family: "earth", palettes: [["meadow", ["#739e61", "#b9c979", "#6d4d39", "#5a3f2e", "#6f4b35", "#8fbf58"]]], surface: ["turf"], underside: ["cone"], trim: ["none"], shine: 0, glow: 0, sparkle: 0, veins: [0, 0], crystals: [0, 0], alpha: 1, drift: 0, worlds: ["nature", "city", "crystal"] },
  gold: {
    label: "Polished gold", family: "metal", surface: ["bars", "bars", "slab", "tile"], underside: ["slab", "cone", "spire"], trim: ["chrome", "studs", "none"],
    palettes: [["yellow gold", ["#ffd75e", "#ffe9a0", "#e0a92e", "#b8841c", "#f6c445", "#fff6d0"]], ["rose gold", ["#f4b9a0", "#ffd9c8", "#d48c72", "#b06a54", "#e8a48c", "#fff0e8"]], ["24 karat", ["#ffcc2e", "#ffe680", "#d99a14", "#a8740c", "#f2b81e", "#fffbe0"]], ["old gold", ["#e6b84a", "#f4d27a", "#b8862a", "#8e6418", "#cf9c36", "#fff0b8"]]],
    shine: 1, glow: 0.05, sparkle: 0.18, veins: [0, 0.02], crystals: [0, 0], alpha: 1, drift: 4, worlds: ["nature", "city", "crystal", "cosmic"],
  },
  goldOre: {
    label: "Gold ore", family: "stone", surface: ["speckle", "strata", "slab"], underside: ["cone", "spire"], trim: ["none", "studs"],
    palettes: [["granite seam", ["#6e6458", "#857a6c", "#4f463d", "#3c352e", "#5d544a", "#ffcf4a"]], ["basalt seam", ["#3d3a3a", "#504b4a", "#2a2727", "#1f1d1d", "#3a3636", "#f5c23c"]], ["red rock seam", ["#9a5a3a", "#b4704a", "#7a4228", "#5e321e", "#8a4e32", "#ffd65a"]]],
    shine: 0.3, glow: 0.15, sparkle: 0.08, veins: [0.12, 0.26], crystals: [0, 4], alpha: 1, drift: 3, worlds: ["nature", "city", "crystal", "cosmic"],
  },
  emerald: { ...GEM, label: "Emerald", family: "gem", palettes: [["clear", ["#2fbf7a", "#7ff0b8", "#1b6b4a", "#114a33", "#2a8a5e", "#c8ffe6"]], ["deep", ["#14915a", "#46c88a", "#0c4a30", "#07311f", "#167048", "#9affd0"]]] },
  ruby: { ...GEM, label: "Ruby", family: "gem", palettes: [["pigeon blood", ["#d8264a", "#ff7d95", "#7a1028", "#520a1a", "#a8183a", "#ffd0da"]], ["star", ["#c41e5a", "#ff8ab4", "#6a0e30", "#44081e", "#981846", "#ffe0ee"]]] },
  sapphire: { ...GEM, label: "Sapphire", family: "gem", palettes: [["royal", ["#2856d8", "#7aa0ff", "#142f7a", "#0c1f52", "#1e44a8", "#d0deff"]], ["teal", ["#1c8ab0", "#6fd2f0", "#0e4a60", "#08303e", "#166e8c", "#d0f6ff"]]] },
  amethyst: { ...GEM, label: "Amethyst", family: "gem", palettes: [["violet", ["#8f4ad8", "#c9a0ff", "#4c2478", "#331852", "#6a34a8", "#efe0ff"]], ["lavender", ["#b48ae8", "#e0ccff", "#6a4a98", "#4a3270", "#8e6ac0", "#ffffff"]]] },
  marble: { ...STONE, label: "Marble", family: "stone", surface: ["slab", "tile"], palettes: [["carrara", ["#ecebe6", "#ffffff", "#d6d3cb", "#bdb9ae", "#c9c5bb", "#8a857c"]], ["nero", ["#2a2a2e", "#3c3c42", "#1c1c20", "#121216", "#26262a", "#e8e2d0"]], ["rosa", ["#ead2cc", "#f8e6e2", "#d0b2aa", "#b8968c", "#dcc0b8", "#9a6e64"]]], veins: [0.14, 0.28], shine: 0.45 },
  obsidian: { ...STONE, label: "Obsidian", family: "stone", surface: ["slab", "crystal"], palettes: [["black glass", ["#1a1622", "#2c2638", "#0e0b14", "#08060c", "#1c1828", "#8a6cff"]], ["snowflake", ["#1c1c22", "#33333c", "#101014", "#08080a", "#202026", "#e8eef8"]]], veins: [0.02, 0.08], shine: 0.7, glow: 0.2, crystals: [2, 8] },
  granite: { ...STONE, label: "Granite", family: "stone", surface: ["speckle", "slab"], palettes: [["grey", ["#8e8a86", "#a8a39d", "#6b6764", "#585451", "#7a7672", "#c9c3bb"]], ["pink", ["#b08a80", "#c8a49a", "#8a6a62", "#6e544e", "#9a7a72", "#e8d0c8"]]], veins: [0.02, 0.06] },
  sandstone: { ...STONE, label: "Sandstone", family: "stone", surface: ["strata", "slab"], palettes: [["desert", ["#d8a86c", "#e8c48e", "#b07e48", "#8e6236", "#c49058", "#f2dcb0"]], ["red canyon", ["#c4744a", "#dc9468", "#9a5432", "#7a3e22", "#b0623c", "#f0c4a0"]]], veins: [0.04, 0.1] },
  cyber: {
    label: "Cyber tech", family: "tech", surface: ["panel", "grid"], underside: ["slab", "float"], trim: ["neon"],
    palettes: [["ice", ["#1c2030", "#262c40", "#121521", "#0b0d15", "#161a28", "#00f0ff"]], ["magenta", ["#221a2e", "#30243f", "#140f1c", "#0c0812", "#1c1426", "#ff2bd6"]], ["acid", ["#18221e", "#22302a", "#0e1512", "#080d0b", "#141e1a", "#3dff8a"]], ["amber", ["#241e18", "#322a20", "#15110d", "#0c0a08", "#1e1913", "#ffb000"]]],
    shine: 0.6, glow: 1, sparkle: 0.02, veins: [0.1, 0.22], crystals: [0, 0], alpha: 1, drift: 10, worlds: ["city", "synth"],
  },
  vapor: {
    label: "Vapor", family: "synth", surface: ["grid", "tile"], underside: ["slab", "cone", "float"], trim: ["chrome", "neon"],
    palettes: [["sunset", ["#ff9ad5", "#ffd1ec", "#9a6bff", "#6c48c8", "#7fe9ff", "#ffffff"]], ["mall", ["#7fe9ff", "#c8f8ff", "#ff7ac8", "#c85aa0", "#ffd36e", "#ffffff"]], ["lilac", ["#c8a8ff", "#efe2ff", "#ff9ec8", "#d872a4", "#9ef0ff", "#ffffff"]]],
    shine: 0.8, glow: 0.6, sparkle: 0.04, veins: [0, 0.04], crystals: [0, 2], alpha: 1, drift: 12, worlds: ["vapor", "synth"],
  },
  antigravity: {
    label: "Anti-gravity", family: "float", surface: ["slab", "panel", "speckle"], underside: ["float"], trim: ["neon", "none"],
    palettes: [["void stone", ["#5a5868", "#6e6c80", "#3c3a48", "#2a2834", "#4a4858", "#7af0ff"]], ["red moon", ["#6a4a44", "#82605a", "#48302c", "#32201e", "#5a3e3a", "#ff6a4a"]], ["violet", ["#4a4060", "#5e5278", "#302844", "#201a2e", "#3e3452", "#c08aff"]]],
    shine: 0.3, glow: 0.8, sparkle: 0.03, veins: [0.06, 0.14], crystals: [0, 5], alpha: 1, drift: 10, worlds: ["cosmic", "synth", "crystal"],
  },
  hologram: {
    label: "Hologram", family: "holo", surface: ["grid", "panel"], underside: ["float", "slab"], trim: ["neon"],
    palettes: [["cyan", ["#1fb8e8", "#3fd8ff", "#1f78d8", "#1a4ab0", "#6ff0ff", "#0a5aa8"]], ["rose", ["#d83ac8", "#ff6ae0", "#9a3aff", "#6a2ad0", "#ff9af0", "#7a1a9a"]], ["lime", ["#2ad870", "#5aff8a", "#1ac8a0", "#10a078", "#a8ff8a", "#0a7a48"]]],
    shine: 0.5, glow: 1, sparkle: 0.05, veins: [0, 0], crystals: [0, 0], alpha: 0.4, drift: 14, worlds: ["synth", "city", "cosmic"],
  },
  glitter: {
    label: "Glitter", family: "glitter", surface: ["tile", "speckle"], underside: ["cone", "float", "crystal"], trim: ["chrome", "neon", "studs"],
    palettes: [["party", ["#ff8ad8", "#ffd36e", "#8affd8", "#a68aff", "#ffffff", "#ffffff"]], ["silver", ["#d8dce8", "#ffffff", "#a8b0c8", "#8890a8", "#e8ecf4", "#ffffff"]], ["disco", ["#ffcf5a", "#ff6ab0", "#5ad8ff", "#8a5aff", "#ffffff", "#ffffff"]]],
    shine: 1, glow: 0.3, sparkle: 0.4, veins: [0, 0], crystals: [0, 6], alpha: 1, drift: 30, worlds: ["vapor", "cosmic", "crystal"],
  },
  cosmic: {
    label: "Cosmic", family: "cosmic", surface: ["speckle", "slab"], underside: ["float", "spire"], trim: ["none", "neon"],
    palettes: [["nebula", ["#1a1040", "#2a1a60", "#0c0820", "#06040f", "#1e1448", "#ff9af0"]], ["deep field", ["#0c1430", "#162448", "#060a18", "#03050c", "#0e1838", "#9af0ff"]], ["supernova", ["#2a0e2a", "#401640", "#160616", "#0c030c", "#2a0a2a", "#ffcf6a"]]],
    shine: 0.4, glow: 0.7, sparkle: 0.22, veins: [0.04, 0.1], crystals: [0, 6], alpha: 1, drift: 20, worlds: ["cosmic"],
  },
};

export const PLANTER_IDS = Object.keys(PLANTERS) as PlanterId[];

export interface PlanterLook {
  readonly id: PlanterId;
  readonly label: string;
  readonly family: PlanterRecipe["family"];
  readonly variant: string;
  readonly colors: { readonly top: readonly [string, string]; readonly body: readonly [string, string]; readonly rim: string; readonly accent: string };
  readonly surface: Surface;
  readonly underside: Underside;
  readonly trim: Trim;
  readonly shine: number;
  readonly glow: number;
  readonly sparkle: number;
  readonly veins: number;
  readonly crystals: number;
  readonly alpha: number;
  /** Earth turf follows the seasons; every other planter keeps its colours. */
  readonly seasonal: boolean;
  /** Bob of floating chunks, world units (anti-gravity floats the most). */
  readonly bob: number;
  /** How deep the underside hangs, as a share of the default. */
  readonly depth: number;
}

function resolvePlanter(id: PlanterId, random: () => number): PlanterLook {
  const recipe = PLANTERS[id];
  const [paletteName, palette] = pick(recipe.palettes, random);
  const hue = (random() * 2 - 1) * recipe.drift;
  const tint = (hex: string): string => (hue === 0 ? hex : shiftHue(hex, hue));
  const [top, top2, body, body2, rim, accent] = palette.map(tint) as unknown as PlanterPalette;
  const surface = pick(recipe.surface, random);
  const underside = pick(recipe.underside, random);
  const trim = pick(recipe.trim, random);
  const veins = recipe.veins[0] + random() * (recipe.veins[1] - recipe.veins[0]);
  const crystals = Math.round(recipe.crystals[0] + random() * (recipe.crystals[1] - recipe.crystals[0]));
  const words = [paletteName, surface === "turf" ? "" : surface, trim === "none" ? "" : `${trim} trim`].filter((word) => word !== "");
  return {
    id, label: recipe.label, family: recipe.family, variant: words.join(" · "),
    colors: { top: [top, top2], body: [body, body2], rim, accent },
    surface, underside, trim, shine: recipe.shine, glow: recipe.glow, sparkle: recipe.sparkle, veins, crystals, alpha: recipe.alpha,
    seasonal: recipe.family === "earth",
    bob: underside === "float" ? (recipe.family === "float" ? 0.16 : 0.08) * (0.7 + random() * 0.6) : 0,
    depth: 0.8 + random() * 0.6,
  };
}

// ---------------------------------------------------------------- worlds

export type Skyline = "ridges" | "city" | "grid" | "spires" | "void";
export type CloudStyle = "voxel" | "pastel" | "neon" | "nebula" | "none";
export type SunStyle = "disc" | "striped" | "ring" | "star";
export type MoonStyle = "disc" | "ringed" | "big" | "neon";

interface WorldPalette {
  /** Sky top and horizon by day, horizon and top by night. */
  readonly sky: readonly [string, string, string, string];
  /** Skyline low, mid and high, then its accent (window lights, neon, crystal glow). */
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
    label: "Nature", skyline: "ridges", clouds: ["voxel"], sun: ["disc"], moon: ["disc"], skyMix: 0, lightMix: 0, stars: 1,
    palettes: [["valley", { sky: ["#d6edf0", "#91b4bd", "#2a5963", "#081a24"], skyline: ["#739e61", "#4c6b55", "#7d8486", "#f1f4f2"], cloud: ["#ffffff", "#e6eef2"], sun: ["#fff1cf", "#fff1cf"], moon: "#c9d6ff", light: "#ffffff" }]],
  },
  city: {
    label: "Cityscape", skyline: "city", clouds: ["voxel", "none"], sun: ["disc"], moon: ["disc", "big"], skyMix: 0.3, lightMix: 0.12, stars: 0.4,
    palettes: [
      ["dusk", { sky: ["#f2c9a0", "#e98a6a", "#2a2440", "#0a0a18"], skyline: ["#2a2e3c", "#3a3f52", "#52586e", "#ffd27a"], cloud: ["#ffd9c0", "#c8a0a8"], sun: ["#ffe6a0", "#ff8a5a"], moon: "#f4e8d0", light: "#ffd8b0" }],
      ["neon", { sky: ["#3a2a6a", "#c84aa0", "#1a0f30", "#06040e"], skyline: ["#14121e", "#1e1a2c", "#2a243e", "#ff2bd6"], cloud: ["#8a5ab0", "#5a3a80"], sun: ["#ffb0e0", "#ff3d8b"], moon: "#e0d0ff", light: "#ffb0f0" }],
      ["metro", { sky: ["#cfdbe6", "#8ea4b8", "#1e2a38", "#080c14"], skyline: ["#4a5260", "#5e6878", "#76808e", "#9ff0ff"], cloud: ["#e8eef4", "#b8c4d0"], sun: ["#fff6e0", "#ffe0a0"], moon: "#d8e4ff", light: "#f0f4ff" }],
    ],
  },
  synth: {
    label: "Synthwave", skyline: "grid", clouds: ["neon", "none"], sun: ["striped"], moon: ["neon", "big"], skyMix: 0.78, lightMix: 0.3, stars: 1.6,
    palettes: [
      ["night drive", { sky: ["#1a0838", "#ff3d8b", "#12052a", "#05020c"], skyline: ["#12052a", "#2a0a4a", "#4a1070", "#ff2bd6"], cloud: ["#ff5ad8", "#5ad8ff"], sun: ["#ffe23f", "#ff2b7a"], moon: "#5af0ff", light: "#ff9ad8" }],
      ["outrun", { sky: ["#0a0628", "#ff7a3d", "#0a0420", "#030108"], skyline: ["#0a0628", "#1a0a48", "#2a1070", "#00f0ff"], cloud: ["#00f0ff", "#ff3dd0"], sun: ["#fff04a", "#ff3d3d"], moon: "#ff8af0", light: "#ffb08a" }],
    ],
  },
  vapor: {
    label: "Vaporwave", skyline: "grid", clouds: ["pastel"], sun: ["striped", "disc"], moon: ["big", "ringed"], skyMix: 0.7, lightMix: 0.25, stars: 0.8,
    palettes: [
      ["pastel", { sky: ["#ffc8ec", "#a8e8ff", "#5a3a8a", "#1a1038"], skyline: ["#b88ae8", "#d8a8f0", "#ffc8ec", "#7ff0ff"], cloud: ["#ffd8f0", "#c8f0ff"], sun: ["#ffe8a8", "#ff9ad0"], moon: "#ffe0f8", light: "#ffd8f0" }],
      ["mall", { sky: ["#a8f0ff", "#ffb0d8", "#4a2a7a", "#140a30"], skyline: ["#7fd8e8", "#a8b8ff", "#ffb0d8", "#ffffff"], cloud: ["#ffffff", "#ffd0ea"], sun: ["#ffd0f0", "#8ad8ff"], moon: "#ffffff", light: "#e8f0ff" }],
    ],
  },
  crystal: {
    label: "Crystal", skyline: "spires", clouds: ["voxel", "pastel"], sun: ["ring", "disc"], moon: ["ringed", "disc"], skyMix: 0.35, lightMix: 0.1, stars: 1.3,
    palettes: [
      ["aurora", { sky: ["#c8f0e8", "#9ab8e8", "#1a2a58", "#060a1e"], skyline: ["#4a6aa8", "#6a8ad8", "#a8c8ff", "#9affe0"], cloud: ["#f0faff", "#d0e0ff"], sun: ["#f8fff0", "#c8f0ff"], moon: "#e0f0ff", light: "#e8f8ff" }],
      ["rose quartz", { sky: ["#ffe0ea", "#e8b0c8", "#3a1a40", "#10061a"], skyline: ["#b87a98", "#d898b8", "#ffc8e0", "#ffd0f0"], cloud: ["#fff0f6", "#f0d0e0"], sun: ["#fff0f0", "#ffc8d8"], moon: "#ffe8f0", light: "#fff0f4" }],
    ],
  },
  cosmic: {
    label: "Cosmic", skyline: "void", clouds: ["nebula"], sun: ["star", "ring"], moon: ["ringed", "big"], skyMix: 0.9, lightMix: 0.2, stars: 3.5,
    palettes: [
      ["nebula", { sky: ["#1a0c3a", "#5a2a8a", "#0a0420", "#020108"], skyline: ["#2a2438", "#3a3248", "#4a4258", "#ff9af0"], cloud: ["#ff6ad8", "#6a8aff"], sun: ["#ffffff", "#ffe0a0"], moon: "#ffd0a0", light: "#e0d0ff" }],
      ["deep field", { sky: ["#06102a", "#18306a", "#020618", "#000206"], skyline: ["#1e2430", "#2a3242", "#3a4456", "#9af0ff"], cloud: ["#4ad8ff", "#8a5aff"], sun: ["#e8f8ff", "#a8d8ff"], moon: "#c8e0ff", light: "#d8ecff" }],
    ],
  },
};

export const WORLD_IDS = Object.keys(WORLDS) as WorldId[];

export interface WorldLook {
  readonly id: WorldId;
  readonly label: string;
  readonly variant: string;
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
    id, label: recipe.label, variant, skyline: recipe.skyline, clouds: pick(recipe.clouds, random),
    sky: palette.sky, skylineColors: palette.skyline, cloudColors: palette.cloud,
    sun: { style: sun, colors: palette.sun, size: sun === "striped" ? 0.16 + random() * 0.06 : sun === "star" ? 0.05 : 0.04 + random() * 0.02 },
    moon: { style: moon, color: palette.moon, size: moon === "big" || moon === "neon" ? 0.1 + random() * 0.05 : 0.035 + random() * 0.02 },
    skyMix: recipe.skyMix, light: { tint: palette.light, mix: recipe.lightMix }, stars: recipe.stars,
    height: 0.8 + random() * 0.5, density: 0.75 + random() * 0.5,
  };
}

// ---------------------------------------------------------------- the theme

export interface ThemeInput {
  /** A planter id, or "seed" (or anything unknown) to let the seed choose. */
  readonly planter?: string;
  /** A world id, or "seed" to let the seed choose one that suits the planter. */
  readonly world?: string;
  readonly seed: number;
}

export interface Theme {
  readonly planter: PlanterLook;
  readonly world: WorldLook;
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
  const planter = resolvePlanter(planterId, random);
  const worldId = Object.hasOwn(WORLDS, input.world ?? "") ? (input.world as WorldId) : pick(PLANTERS[planterId].worlds, random);
  const world = resolveWorld(worldId, random);
  const planterName = planter.variant === "" ? planter.label : `${planter.label} · ${planter.variant}`;
  return { planter, world, name: `${planterName} over ${world.label} · ${world.variant}` };
}
