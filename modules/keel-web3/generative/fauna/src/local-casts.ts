// Local casts: who lives where, what they look like there and what they are called.

import { speciesOf } from "./roster.js";
import type { RegionId, SpeciesId, WorldKey } from "./roster.js";
import type { CoatColors } from "./animals/coats.js";
import type { CastContext } from "./casting.js";

/**
 * How much likelier (or rarer) a species is in a region than its own weight
 * says, so each place is led by its own animals: mule deer and magpies in the
 * Rockies, grey squirrels and raccoons on the Atlantic coast, marmots in the
 * Alps, tanuki and jungle crows in Tokyo, kangaroos and cockatoos round Sydney,
 * vervets and guineafowl in Nairobi, macaques and tokay geckos in Bali. Left
 * out, a species keeps its weight.
 */
export const LOCAL_WEIGHT: Readonly<Record<RegionId, Partial<Record<SpeciesId, number>>>> = {
  rockies: {
    deer: 1.7,
    crow: 1.3,
    rabbit: 1.2,
    raccoon: 1.1,
    bear: 1.4,
    wolf: 0.4,
    cat: 0.6,
    mouse: 0.6,
    squirrel: 0.9,
    butterfly: 0.8,
    songbird: 0.9,
    marmot: 1.2,
  },
  atlantic: {
    squirrel: 1.5,
    raccoon: 1.7,
    deer: 1.3,
    rabbit: 1.1,
    firefly: 1.5,
    crow: 1.2,
    gull: 1.2,
    cat: 0.7,
    mouse: 0.6,
    songbird: 0.9,
    butterfly: 0.8,
  },
  alps: {
    deer: 1.4,
    fox: 1.3,
    squirrel: 1.1,
    rabbit: 0.5,
    crow: 1.3,
    hedgehog: 1.5,
    bear: 0.5,
    wolf: 0.7,
    cat: 0.6,
    mouse: 0.7,
    songbird: 0.9,
    butterfly: 0.9,
    marmot: 2.2,
  },
  tokyo: {
    macaque: 2.2,
    deer: 1.3,
    crow: 2,
    crane: 1.4,
    firefly: 1.5,
    tanuki: 1.6,
    squirrel: 0.6,
    rabbit: 0.35,
    capybara: 0.3,
    redpanda: 0.5,
    gull: 0.8,
    songbird: 0.9,
    butterfly: 0.8,
    mouse: 0.6,
  },
  sydney: {
    kangaroo: 2.4,
    koala: 2,
    parrot: 2.6,
    crow: 1.6,
    kookaburra: 1.8,
    possum: 1.4,
    cat: 0.5,
    mouse: 0.5,
    songbird: 0.8,
    butterfly: 0.7,
    gecko: 0.8,
  },
  nairobi: {
    monkey: 2.2,
    crane: 2.4,
    guineafowl: 1.8,
    dikdik: 1.6,
    mongoose: 1.8,
    songbird: 1,
    crow: 1,
    tortoise: 1.2,
    cat: 0.4,
    mouse: 0.6,
    butterfly: 0.8,
    owl: 0.8,
  },
  bali: {
    monkey: 2.6,
    gecko: 2.2,
    loris: 1.5,
    peacock: 1.5,
    firefly: 1.2,
    crow: 0.7,
    gull: 0.3,
    parrot: 0.35,
    cat: 0.6,
    mouse: 0.6,
    butterfly: 0.9,
  },
};
/** And in a world: a wild grove keeps its cats and mice few; a city has them everywhere. */
const WORLD_WEIGHT: Partial<Record<WorldKey, Partial<Record<SpeciesId, number>>>> = {
  nature: { cat: 0.45, mouse: 0.8 },
  voxel: { cat: 0.45, mouse: 0.8 },
  city: { cat: 1.6, crow: 1.4, raccoon: 1.3, tanuki: 1.2 },
};

/** A coat a species wears in a region, how often, and the name it goes by there (the species' own when left out). */
export type Look = readonly [coat: string, weight: number, label?: string];
/** Each region's own forms of the wide-ranging species. Left out, a species wears its own coats anywhere. */
export const LOOKS: Partial<Record<SpeciesId, Partial<Record<RegionId, readonly Look[]>>>> = {
  rabbit: { rockies: [["cottontail", 1, "Cottontail"]], atlantic: [["cottontail", 1, "Cottontail"]], alps: [["wild", 3], ["snowshoe", 1, "Mountain hare"]], tokyo: [["hare", 1, "Japanese hare"]] },
  fox: { rockies: [["red", 5], ["cross", 1, "Cross fox"]], atlantic: [["red", 1]], alps: [["red", 1]], tokyo: [["red", 1]] },
  deer: { rockies: [["mule", 1, "Mule deer"]], atlantic: [["whitetail", 1, "White-tailed deer"]], alps: [["roe", 3, "Roe deer"], ["red", 2, "Red deer"]], tokyo: [["sika", 1, "Sika deer"]] },
  wolf: { rockies: [["grey", 4], ["timber", 1], ["black", 1]], alps: [["grey", 1]] },
  bear: { rockies: [["black", 3, "Black bear"], ["cinnamon", 2, "Black bear"]], alps: [["brown", 1, "Brown bear"]], tokyo: [["moon", 1, "Asian black bear"]] },
  raccoon: { rockies: [["raccoon", 1]], atlantic: [["raccoon", 1]] },
  hedgehog: { alps: [["brown", 1]] },
  mouse: { rockies: [["deer mouse", 1, "Deer mouse"]], atlantic: [["deer mouse", 1, "White-footed mouse"]], alps: [["field", 1, "Wood mouse"]], tokyo: [["field", 1]], sydney: [["grey", 1, "House mouse"]], nairobi: [["striped", 1, "Striped grass mouse"]], bali: [["grey", 1, "House mouse"]] },
  squirrel: {
    rockies: [["abert", 2, "Abert's squirrel"], ["chipmunk", 3, "Chipmunk"], ["red", 1, "Pine squirrel"]],
    atlantic: [["grey", 4, "Grey squirrel"], ["chipmunk", 2, "Chipmunk"], ["black", 1, "Grey squirrel"]],
    alps: [["red", 3, "Red squirrel"], ["black", 2, "Red squirrel"]],
    tokyo: [["japanese", 1, "Japanese squirrel"]],
  },
  macaque: { tokyo: [["snow", 1, "Japanese macaque"]] },
  monkey: { bali: [["macaque", 1]], nairobi: [["vervet", 1, "Vervet monkey"]] },
  songbird: {
    rockies: [["american robin", 3, "American robin"], ["bluebird", 2, "Mountain bluebird"], ["chickadee", 2, "Chickadee"], ["steller's jay", 1, "Steller's jay"]],
    atlantic: [["american robin", 3, "American robin"], ["cardinal", 2, "Cardinal"], ["blue jay", 2, "Blue jay"], ["chickadee", 2, "Chickadee"], ["goldfinch", 1, "Goldfinch"], ["sparrow", 1, "Sparrow"]],
    alps: [["robin", 3, "Robin"], ["blackbird", 2, "Blackbird"], ["great tit", 2, "Great tit"], ["sparrow", 1, "Sparrow"]],
    tokyo: [["white-eye", 3, "Japanese white-eye"], ["sparrow", 2, "Tree sparrow"], ["bulbul", 2, "Brown-eared bulbul"]],
    sydney: [["fairy-wren", 3, "Superb fairy-wren"], ["noisy miner", 2, "Noisy miner"], ["sparrow", 1, "Sparrow"]],
    nairobi: [["superb starling", 3, "Superb starling"], ["sunbird", 2, "Sunbird"], ["sparrow", 1, "Weaver"]],
    bali: [["java sparrow", 2, "Java sparrow"], ["bali myna", 1, "Bali myna"], ["white-eye", 2, "White-eye"]],
  },
  crow: {
    rockies: [["magpie", 3, "Black-billed magpie"], ["crow", 2, "Raven"]], atlantic: [["crow", 1, "American crow"]], alps: [["crow", 3, "Carrion crow"], ["hooded", 1, "Hooded crow"]],
    tokyo: [["crow", 1, "Jungle crow"]], sydney: [["magpie-lark", 3, "Australian magpie"], ["crow", 1, "Raven"]], nairobi: [["pied", 1, "Pied crow"]], bali: [["crow", 1, "Large-billed crow"]],
  },
  owl: { rockies: [["great horned", 1, "Great horned owl"]], atlantic: [["great horned", 2, "Great horned owl"], ["barn", 1, "Barn owl"]], alps: [["tawny", 2, "Tawny owl"], ["great horned", 1, "Eagle owl"]], tokyo: [["ural", 1, "Ural owl"]], nairobi: [["barn", 1, "Barn owl"]] },
  parrot: { sydney: [["cockatoo", 3, "Sulphur-crested cockatoo"], ["lorikeet", 3, "Rainbow lorikeet"], ["galah", 2, "Galah"]], bali: [["lorikeet", 1, "Lorikeet"]] },
  gull: { atlantic: [["herring", 3, "Herring gull"], ["black-backed", 1, "Black-backed gull"]], sydney: [["silver", 1, "Silver gull"]], tokyo: [["herring", 1, "Black-tailed gull"]], bali: [["herring", 1]] },
  peacock: { bali: [["green", 1, "Green peafowl"]] },
  crane: { tokyo: [["red-crowned", 1, "Red-crowned crane"]], nairobi: [["grey crowned", 1, "Grey crowned crane"]] },
  woodpecker: { rockies: [["downy", 1, "Downy woodpecker"]], atlantic: [["downy", 1, "Downy woodpecker"]], alps: [["downy", 2, "Great spotted woodpecker"], ["green", 1, "Green woodpecker"]], tokyo: [["downy", 1, "Pygmy woodpecker"]] },
  snake: { rockies: [["garter", 1, "Garter snake"]], sydney: [["red-bellied", 1, "Red-bellied black snake"]], nairobi: [["green", 2, "Green mamba"], ["banded", 1]], bali: [["green", 1, "Tree snake"]] },
  gecko: { bali: [["tokay", 1, "Tokay gecko"]], sydney: [["leaf", 1, "Velvet gecko"]], nairobi: [["leaf", 1, "Day gecko"]] },
  butterfly: {
    rockies: [["monarch", 2, "Monarch"], ["swallowtail", 2, "Swallowtail"], ["cabbage", 1, "Cabbage white"]], atlantic: [["monarch", 3, "Monarch"], ["swallowtail", 1, "Swallowtail"], ["cabbage", 1, "Cabbage white"]],
    alps: [["peacock", 2, "Peacock butterfly"], ["swallowtail", 1, "Swallowtail"], ["cabbage", 2, "Cabbage white"]], tokyo: [["swallowtail", 2, "Swallowtail"], ["cabbage", 1, "Cabbage white"]],
    sydney: [["monarch", 1, "Wanderer"]], nairobi: [["monarch", 1, "African monarch"], ["swallowtail", 1, "Swallowtail"]], bali: [["birdwing", 2, "Birdwing"], ["swallowtail", 1, "Swallowtail"]],
  },
  crab: { atlantic: [["fiddler", 1, "Fiddler crab"]], sydney: [["ghost", 1, "Ghost crab"]], tokyo: [["red", 1]], nairobi: [["ghost", 1, "Ghost crab"]], bali: [["red", 2], ["fiddler", 1, "Fiddler crab"]] },
  kangaroo: { sydney: [["grey", 3, "Eastern grey kangaroo"], ["red", 1]] },
  tortoise: { nairobi: [["leopard", 1, "Leopard tortoise"]] },
  marmot: { alps: [["alpine", 1, "Alpine marmot"]], rockies: [["yellow-bellied", 1, "Yellow-bellied marmot"]] },
};
/** The colours of the local coats that are not among a species' own (coat, alt, belly, dark, accent). */
const LOCAL_COATS: Partial<Record<SpeciesId, Readonly<Record<string, CoatColors>>>> = {
  rabbit: { cottontail: ["#8e765a", "#6c5842", "#efe6d6", "#3a2c22", "#ffffff"], hare: ["#8a7458", "#6a563e", "#e8dcc8", "#2a2018", "#e8a8a8"] },
  fox: { cross: ["#a8582a", "#3a2a22", "#e8e0d4", "#141010", "#f4efe6"] },
  deer: { mule: ["#8a7866", "#6a5a4a", "#f0e8dc", "#2a2018", "#f8f4ec"], roe: ["#a8643a", "#7e4826", "#efe2cc", "#241812", "#ffffff"], red: ["#8a5236", "#5e3420", "#c8a07a", "#22140c", "#e8d8c0"] },
  bear: { moon: ["#1e1c1c", "#121010", "#2a2626", "#080606", "#f0ece4"] },
  mouse: { "deer mouse": ["#8a6a4a", "#5e4630", "#f4f0e8", "#1a120c", "#f0a8a8"], striped: ["#8a7a5a", "#4a3e2a", "#d8ccb0", "#141008", "#f0a8a8"] },
  squirrel: { abert: ["#5a5a5e", "#2e2e32", "#f0f0f0", "#141416", "#b8582a"], chipmunk: ["#b07a48", "#3a2a1e", "#f0e4d0", "#1a120c", "#f4ece0"], japanese: ["#8a6e58", "#5e4a3a", "#f0e8dc", "#1e160e", "#f4ece0"] },
  songbird: {
    "american robin": ["#5a5450", "#3a3634", "#c8582a", "#141210", "#f0c040"], cardinal: ["#c8201e", "#8a1414", "#d8402a", "#141010", "#f08030"],
    "blue jay": ["#4a7ad0", "#f4f4f0", "#e8eef4", "#141418", "#2a2a2a"], chickadee: ["#9a9a94", "#1a1a1a", "#efe8dc", "#0e0e0e", "#f4f4f0"],
    "steller's jay": ["#1a3a8a", "#141a2a", "#2a4a9a", "#0a0a10", "#3a5ad0"], blackbird: ["#1e1c1c", "#141212", "#2a2828", "#0a0a0a", "#f0a020"],
    "great tit": ["#5a7a3a", "#1a1a1a", "#f0d84a", "#0e0e0e", "#f4f4f0"], "white-eye": ["#8aa83a", "#6a8a2a", "#d8d890", "#1a1a10", "#ffffff"],
    bulbul: ["#7a7a80", "#5a5a60", "#a8a8ae", "#1a1a1e", "#a85a3a"], "fairy-wren": ["#2a6ae0", "#1a1a2a", "#d8d4c8", "#0a0a14", "#4ab8f0"],
    "noisy miner": ["#9a9a96", "#5a5a58", "#e0ded8", "#141414", "#f0d020"], "superb starling": ["#2a7a8a", "#1a4a6a", "#e07a2a", "#0a1418", "#f4f4f0"],
    sunbird: ["#2a9a5a", "#6a2a8a", "#e83a3a", "#0a1410", "#f0d020"], "java sparrow": ["#7a8088", "#1a1a1a", "#e8d0d0", "#0e0e10", "#f0f0f0"],
    "bali myna": ["#f4f4f0", "#e8e8e2", "#ffffff", "#1a1a1a", "#3a6ad0"],
  },
  crow: { magpie: ["#141418", "#f4f4f0", "#f4f4f0", "#08080a", "#2a4ab8"], "magpie-lark": ["#141414", "#f4f4f0", "#f4f4f0", "#08080a", "#e8e4dc"], pied: ["#141416", "#f4f4f0", "#f4f4f0", "#08080a", "#2a2a2e"] },
  owl: { tawny: ["#8a5a34", "#5a3a20", "#c8a07a", "#1e140a", "#c8a07e"], ural: ["#b8b0a0", "#8a8070", "#e8e4dc", "#2a2620", "#ece8e0"] },
  parrot: { galah: ["#d87a8a", "#a8a8b0", "#e86a80", "#2a2a2a", "#f4d0d8"] },
  gull: { silver: ["#f4f4f2", "#b8c0c8", "#ffffff", "#141414", "#e83030"] },
  peacock: { green: ["#2a8a5a", "#1a6a7a", "#3aa86a", "#0a1a14", "#e8c040"] },
  snake: { garter: ["#3a3a2a", "#e8d84a", "#c8c0a0", "#0e0e0a", "#e83030"], "red-bellied": ["#141414", "#2a2a2a", "#e83a3a", "#0a0a0a", "#e83030"] },
  butterfly: { peacock: ["#a82a2a", "#1a1a1a", "#3a6ad0", "#0a0a0a", "#f0d020"], birdwing: ["#1a1a1a", "#f0d020", "#2ab84a", "#0a0a0a", "#f0d020"] },
};

const GREY: CoatColors = ["#888888", "#666666", "#cccccc", "#222222", "#ffffff"];
export const coatColors = (id: SpeciesId, coat: string): CoatColors =>
  speciesOf(id).coats.find(([name]) => name === coat)?.[1] ??
  LOCAL_COATS[id]?.[coat] ??
  speciesOf(id).coats[0]?.[1] ??
  GREY;

/**
 * The coats a species can wear here, weighted: its region's own forms, or its own coats (the first five times the
 * rest).
 */
export function looksFor(id: SpeciesId, region: RegionId | null): readonly Look[] {
  const local = region ? LOOKS[id]?.[region] : undefined;
  // (With no region, the kind's usual coat nearly always: a red fox, a grey wolf, not a pack of arctic ones.)
  return local && local.length > 0 ? local : speciesOf(id).coats.map(([name], i) => [name, i === 0 ? 12 : 1] as const);
}

/** A species' weight in this place and world. */
export function localWeight(id: SpeciesId, ctx: CastContext): number {
  return (
    speciesOf(id).weight * (ctx.region ? (LOCAL_WEIGHT[ctx.region][id] ?? 1) : 1) * (WORLD_WEIGHT[ctx.world]?.[id] ?? 1)
  );
}

/**
 * A species' casting weight in a region (and, given one, a world), as `castFor` weighs it; 0 where it does not live.
 */
export function regionWeight(id: SpeciesId, region: RegionId, world?: WorldKey): number {
  const spec = speciesOf(id);
  if (!spec.regions.includes(region) || (world && !spec.worlds.includes(world))) return 0;
  return spec.weight * (LOCAL_WEIGHT[region][id] ?? 1) * (world ? WORLD_WEIGHT[world]?.[id] ?? 1 : 1);
}

