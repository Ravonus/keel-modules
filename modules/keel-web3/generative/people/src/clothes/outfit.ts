// The outfit: a wardrobe by genre, dressed for the weather, hatted, geared and sometimes in costume.

import { mix } from "../vec.js";
import { blend, hsl, pick, streamOf, weighted } from "../roll.js";
import type { Weighted } from "../roll.js";
import type { Bottom, Build, Costume, Gear, Genre, Hat, Outfit, Sex, Shoe, Top, Weather } from "../body/person.js";
import { glowOf } from "./palette.js";

interface Wardrobe {
  readonly tops: Weighted<Top>;
  readonly bottoms: Weighted<Bottom>;
  readonly shoes: Weighted<Shoe>;
  readonly hats: Weighted<Hat>;
  readonly fit: readonly [number, number];
}

const GENRES: Weighted<Genre> = [["casual", 5], ["street", 2.4], ["formal", 1.8], ["sport", 1.6], ["goth", 0.9], ["work", 1.4], ["boho", 1.2], ["preppy", 1.2]];

const WARDROBES: Readonly<Record<Genre, Wardrobe>> = {
  casual: { tops: [["tee", 5], ["long", 3], ["hoodie", 1.6], ["polo", 1], ["dress", 2], ["tank", 1.2]], bottoms: [["jeans", 5], ["shorts", 1.6], ["skirt", 1.6], ["trousers", 1.4]], shoes: [["sneaker", 5], ["sandal", 1.2], ["boot", 1]], hats: [["none", 9], ["cap", 1]], fit: [0.2, 0.55] },
  street: { tops: [["hoodie", 5], ["tee", 3], ["jacket", 2]], bottoms: [["cargo", 4], ["jeans", 3], ["shorts", 1]], shoes: [["sneaker", 6], ["boot", 1.4]], hats: [["none", 4], ["cap", 2.4], ["beanie", 2.4]], fit: [0.6, 1] },
  formal: { tops: [["blazer", 6], ["dress", 2.6], ["coat", 1.4]], bottoms: [["trousers", 6], ["skirt", 2]], shoes: [["boot", 1], ["loafer", 6]] as Weighted<Shoe>, hats: [["none", 9], ["fedora", 0.8]], fit: [0.15, 0.4] },
  sport: { tops: [["tee", 4], ["tank", 4], ["hoodie", 1.4]], bottoms: [["shorts", 4], ["leggings", 4]], shoes: [["sneaker", 1]], hats: [["none", 6], ["cap", 2]], fit: [0, 0.3] },
  goth: { tops: [["long", 3], ["coat", 3], ["dress", 2], ["tee", 1.4]], bottoms: [["leggings", 3], ["skirt", 2], ["jeans", 2]], shoes: [["boot", 1]], hats: [["none", 8], ["beanie", 1]], fit: [0.1, 0.5] },
  work: { tops: [["jacket", 3], ["long", 3], ["tee", 2], ["tank", 0.7]], bottoms: [["cargo", 4], ["jeans", 3], ["trousers", 2]], shoes: [["boot", 1]], hats: [["none", 5], ["cap", 2.4], ["beanie", 1.4]], fit: [0.4, 0.75] },
  boho: { tops: [["robe", 3], ["dress", 3], ["tank", 1], ["long", 1.4]], bottoms: [["skirt", 4], ["trousers", 2]], shoes: [["sandal", 4], ["boot", 1]], hats: [["none", 6], ["sunhat", 2]], fit: [0.55, 1] },
  preppy: { tops: [["polo", 5], ["long", 2], ["blazer", 1.4], ["dress", 1]], bottoms: [["trousers", 4], ["shorts", 2], ["skirt", 1.6]], shoes: [["loafer", 4], ["sneaker", 2]] as Weighted<Shoe>, hats: [["none", 8], ["cap", 1]], fit: [0.2, 0.45] },
};


/** The hats a head with none might wear after all, by how likely each is. A child's are only soft ones. */
const SPARE_HATS: Readonly<Record<Genre, Weighted<Hat>>> = {
  casual: [["bucket", 3], ["pompom", 1.6], ["visor", 1.4], ["flatcap", 1], ["beret", 0.8], ["bandana", 1]],
  street: [["bucket", 3], ["bandana", 2.4], ["pompom", 1], ["headwrap", 1.4]],
  formal: [["bowler", 2], ["flatcap", 2], ["beret", 1.4], ["tophat", 0.6]],
  sport: [["visor", 4], ["bandana", 2], ["bucket", 1]],
  goth: [["beret", 2], ["tophat", 1.4], ["bandana", 1], ["headwrap", 1]],
  work: [["hardhat", 4], ["flatcap", 2], ["bandana", 2]],
  boho: [["headwrap", 3], ["bucket", 1.6], ["beret", 1.4], ["bandana", 1.4]],
  preppy: [["visor", 2], ["flatcap", 2], ["beret", 1.4], ["bowler", 0.6]],
};

const SOFT_HATS: Weighted<Hat> = [["bucket", 3], ["pompom", 3], ["visor", 1]];

/** Whether a build is a child's. */
const childish = (build: Build): boolean => build.age === "toddler" || build.age === "child";

/** A bare head's chance of a hat from the wider rack, from a stream of its own. */
export function hatted(seed: number, build: Build, outfit: Outfit): Outfit {
  const r = streamOf(seed, 0x68617473);
  if (outfit.hat !== "none" || outfit.costume !== "none" || r() > 0.26) return outfit;
  return { ...outfit, hat: weighted(r, childish(build) ? SOFT_HATS : SPARE_HATS[outfit.genre]) };
}

/** One of `list`, or the first if `chance` misses. */
const someOf = <T>(r: () => number, chance: number, list: readonly T[]): T => { const hit = r();
const pick = r();
return list[hit < chance ? 1 + Math.floor(pick * (list.length - 1)) : 0] as T; };

/** How likely each is to wear each. */
const GEAR_ODDS = {
  child: { ears: 0, neck: 0, hair: 0.5 },
  woman: { ears: 0.55, neck: 0.3, hair: 0.3 },
  man: { ears: 0.14, neck: 0.12, hair: 0.05 },
} as const;

/** What a person has on them. A child has clips, a bow and maybe glasses, and nothing pierced; a teen's ears may be. */
export function gearOf(seed: number, build: Build, outfit: Outfit): Gear {
  const r = streamOf(seed, 0x67656172);
  const child = childish(build);
  const grown = !child && build.age !== "teen";
  const bare = outfit.hat === "none";
  const odds = GEAR_ODDS[child ? "child" : build.sex === "female" ? "woman" : "man"];
  return {
    glasses: someOf<Gear["glasses"]>(r, build.age === "elder" ? 0.5 : 0.2, child ? ["none", "clear", "round"] : ["none", "clear", "round", "cat", "sun"]),
    ears: someOf<Gear["ears"]>(r, odds.ears, grown ? ["none", "stud", "hoop", "drop"] : ["none", "stud", "hoop"]),
    nose: someOf<Gear["nose"]>(r, grown ? 0.07 : 0, ["none", "stud", "ring"]),
    neck: someOf<Gear["neck"]>(r, odds.neck, ["none", "chain", "pendant"]),
    hair: someOf<Gear["hair"]>(r, bare ? odds.hair : 0, ["none", "clip", "clips", "bow", "band"]),
    phones: !child && bare && r() < 0.05,
  };
}

/** The little metal and glass a person wears, and a bright colour for what is in their hair. */
export function gearColours(seed: number): Record<string, string> {
  const r = streamOf(seed, 0x6d65746c);
  const bright = ["#d8423c", "#e8b23a", "#3a7ad8", "#e86aa8", "#46b078", "#f4f0e8", "#7a4ac8"];
  return { metal: r() < 0.5 ? "#d8b35a" : "#c8c8cc", lens: r() < 0.5 ? "#16181c" : "#2c2418", clip: bright[Math.floor(r() * bright.length)] ?? "#d8423c" };
}

/** The shirt in a jacket's front: pale under a dark one and dark under a pale, never a bright. */
export const shirtUnder = (top: string): string => (glowOf(top) > 0.4 ? "#3a4252" : "#ece8e0");


/** Skirts and dresses mostly to women, and now and then to anyone: a choice, not a rule. */
const worn = <T extends string>(list: Weighted<T>, sex: Sex): Weighted<T> => list.map(([item, share]) => [item, sex === "male" && SKIRTED.includes(item) ? share * 0.06 : share]);

const SKIRTED: readonly string[] = ["dress", "skirt", "robe"];

const FOR_WEATHER: Readonly<Record<Exclude<Weather, "mild" | "beach">, { readonly tops: Weighted<Top>; readonly shoes: Weighted<Shoe>; readonly hats: Weighted<Hat>; readonly carry: number }>> = {
  rain: { tops: [["raincoat", 5], ["hoodie", 2.4], ["coat", 1.6], ["jacket", 1.6]], shoes: [["boot", 4], ["sneaker", 1]], hats: [["hood", 4], ["none", 3], ["cap", 1]], carry: 0.45 },
  cold: { tops: [["puffer", 4], ["coat", 3], ["hoodie", 2], ["jacket", 2]], shoes: [["boot", 5], ["sneaker", 1]], hats: [["beanie", 4], ["none", 3], ["hood", 1]], carry: 0 },
  hot: { tops: [["tee", 4], ["tank", 4], ["dress", 2], ["polo", 1]], shoes: [["sandal", 3], ["sneaker", 2]], hats: [["none", 5], ["sunhat", 2], ["cap", 2]], carry: 0 },
};

/** What a person wears at the beach: nothing here is cut for a child but a tee and swim shorts. */
function beachOf(rand: () => number, build: Build, base: Outfit): Outfit {
  const grown = build.age === "adult" || build.age === "elder";
  const female = build.sex === "female";
  const cut = rand();
  const top: Top = !grown ? "tee" : !female ? "bare" : cut < 0.34 ? "swimsuit" : cut < 0.67 ? "bikini" : "string";
  return { ...base, top, bottom: top === "string" || top === "swimsuit" ? "briefs" : "swim", shoe: "sandal", hat: rand() < 0.3 ? "sunhat" : "none", stripes: 0, fit: 0.1 };
}

const legsFor = (rand: () => number, bottom: Bottom, weather: Weather): Bottom => {
  if (weather === "hot") return rand() < 0.7 ? "shorts" : "skirt";
  return bottom === "shorts" || bottom === "skirt" ? "jeans" : bottom;
};

/** A person's clothes for the day: the same person, what suits the weather. */
export function dressedFor(rand: () => number, build: Build, base: Outfit, weather: Weather): Outfit {
  if (weather === "mild") return base;
  if (weather === "beach") return beachOf(rand, build, base);
  const w = FOR_WEATHER[weather];
  const top = weighted(rand, w.tops);
  const legs = legsFor(rand, base.bottom, weather);
  const hat = weighted(rand, w.hats);
  const hooded = top === "raincoat" || top === "hoodie" || top === "puffer";
  const small = build.age === "toddler";
  return { ...base, top, bottom: legs, shoe: weighted(rand, w.shoes), hat: hat === "hood" && !hooded ? "none" : hat, carry: !small && rand() < w.carry ? "umbrella" : "none", stripes: 0 };
}

const COSTUMES: Readonly<Record<Exclude<Costume, "none">, Pick<Outfit, "top" | "bottom" | "shoe" | "hat" | "stripes" | "fit">>> = {
  suit: { top: "blazer", bottom: "trousers", shoe: "loafer", hat: "none", stripes: 0, fit: 0.2 },
  firefighter: { top: "jacket", bottom: "trousers", shoe: "boot", hat: "helmet", stripes: 2, fit: 0.6 },
  police: { top: "long", bottom: "trousers", shoe: "boot", hat: "peaked", stripes: 0, fit: 0.25 },
  cowboy: { top: "long", bottom: "jeans", shoe: "boot", hat: "stetson", stripes: 0, fit: 0.3 },
  fursuit: { top: "bare", bottom: "swim", shoe: "sandal", hat: "none", stripes: 0, fit: 0 },
  latex: { top: "long", bottom: "leggings", shoe: "boot", hat: "none", stripes: 0, fit: 0 },
};
const COSTUME_SHARE: Weighted<Exclude<Costume, "none">> = [["suit", 4], ["police", 1], ["firefighter", 1], ["cowboy", 1], ["fursuit", 0.6], ["latex", 0.3]];
const FUR = ["#c87a3a", "#8a8a92", "#3a3a44", "#e8e0d4", "#4a78c8", "#a848a0", "#3aa888"] as const;

/** A job or getup for those of age: asked for, or now and then on a mild day. */
export function inCostume(rand: () => number, build: Build, outfit: Outfit, weather: Weather, asked?: Costume): Outfit {
  if (build.age !== "adult" && build.age !== "elder" && build.age !== "teen") return outfit;
  const costume = asked ?? (weather === "mild" && rand() < 0.08 ? weighted(rand, COSTUME_SHARE) : "none");
  if (costume === "none" || (costume === "latex" && build.age === "teen")) return outfit;
  return { ...outfit, ...COSTUMES[costume], carry: "none", costume };
}

const RAINCOATS = ["#d8a820", "#c83a2a", "#2a5a8a", "#2f6a4a", "#e0d8c4"] as const;
const JOB_COLOURS: Partial<Record<Costume, (rand: () => number) => Record<string, string>>> = {
  suit: (rand) => ({ top: pick(rand, ["#20242e", "#2c2c30", "#343a44"]), bottom: pick(rand, ["#20242e", "#2c2c30"]), trim: "#e8e6e0", dark: "#7a2030", shoe: "#1a1412" }),
  firefighter: () => ({ top: "#57503c", bottom: "#57503c", trim: "#d8c030", shoe: "#141210", sole: "#141210" }),
  police: () => ({ top: "#1e2a44", bottom: "#161e30", trim: "#14182a", badge: "#d8b840", shoe: "#101014", sole: "#101014" }),
  latex: (rand) => ({ top: "#101014", bottom: "#101014", shoe: "#101014", sole: "#101014", trim: pick(rand, ["#101014", "#8a1020", "#402060"]) }),
  cowboy: (rand) => ({ top: pick(rand, ["#8a3a2a", "#6a7a8a", "#3a6a6a"]), bottom: "#2e4468", trim: "#6a4426", shoe: "#5a3a20", sole: "#3a2614" }),
};

/** Colours only the day's clothes want: a bright raincoat, a loud swimsuit, an umbrella, a pelt. */
export function colourFor(rand: () => number, outfit: Outfit): Record<string, string> {
  if (outfit.costume === "fursuit") { const fur = pick(rand, FUR);
  return {
    skin: fur,
    belly: blend(fur, "#f4ece0", 0.66),
    bottom: fur,
    shoe: fur,
    sole: fur,
    trim: fur,
    lip: fur,
    brow: blend(fur, "#1a1412", 0.5),
  }; }
  const job = JOB_COLOURS[outfit.costume]?.(rand) ?? {};
  const loud = hsl(0.2 + rand() * 0.75, 0.62, 0.48);  // (Never near a skin's hue, so a swimsuit never reads as bare.)
  const swim = outfit.bottom === "swim" || outfit.bottom === "briefs" ? { bottom: loud, top: outfit.top === "tee" ? hsl(rand(), 0.4, 0.6) : loud } : {};
  const coat = outfit.top === "raincoat" && outfit.costume === "none" ? { top: pick(rand, RAINCOATS) } : {};
  return { ...swim, ...coat, brolly: hsl(rand(), 0.5, 0.34), ...job };
}

export function outfitOf(rand: () => number, build: Build): Outfit {
  const small = build.age === "toddler" || build.age === "child";
  const genre = small ? "casual" : weighted(rand, GENRES);
  const w = WARDROBES[genre];
  return {
    genre,
    fit: mix(w.fit[0], w.fit[1], rand()),
    top: weighted(rand, worn(w.tops, build.sex)),
    bottom: weighted(rand, worn(w.bottoms, build.sex)),
    shoe: weighted(rand, w.shoes),
    hat: weighted(rand, w.hats),
    carry: "none",
    costume: "none",
    stripes: rand() < 0.16 ? 2 : 0,
  };
}


/** A top that goes on down over the legs. */
export const LONG_TOP: Partial<Record<Top, number>> = { dress: 0.96, coat: 1.2, robe: 1.9, raincoat: 1 };
