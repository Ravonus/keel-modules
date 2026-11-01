// Casting: who turns up for a seed, region, world and season, in what company, coats and names, and what flies over.

import { between, hashName, intBetween, pick, streamOf } from "./roll.js";
import { ALL_REGIONS, MOVES, SPECIES, SPECIES_IDS, speciesOf } from "./roster.js";
import type {
  Action, Build, GroupKind, Palette, Rarity, RegionId, Season, SpeciesId, SpeciesSpec, WorldKey,
} from "./roster.js";
import { actionsOf } from "./stage/idle.js";
import { MORPHS, WILD_SKINS, WORLD_SKINS, paletteOf, varied } from "./animals/coats.js";
import type { Morph } from "./animals/coats.js";
import { LOCAL_WEIGHT, LOOKS, coatColors, localWeight, looksFor } from "./local-casts.js";

// ---------------------------------------------------------------- casting

export interface CastMember {
  readonly species: SpeciesId;
  readonly label: string;
  /** How big it is drawn: its true size, lifted toward a toy scale so small animals read (see `shownSize`). */
  readonly size: number;
  /** Its true size, before that lift: what it weighs on a branch goes by this. */
  readonly heft: number;
  readonly coat: string;
  readonly palette: Palette;
  readonly morph: Morph;
  readonly young: boolean;
  /** Antlered (a stag, not a doe). */
  readonly horned: boolean;
  /** What makes this one itself: its sex, its proportions, its pace and its nerve. */
  readonly traits: Traits;
}

/**
 * One animal's own make and manner, drawn on its own stream so the cast's
 * coat and size rolls never move. The build shares multiply its kind's
 * proportions (a fox with longer legs, a rabbit with a bigger head); tempo
 * scales its gait; bold above 1 watches less and roams farther; lively scales
 * how much it gets up to.
 */
export interface Traits {
  readonly sex: "male" | "female";
  readonly len: number;
  readonly leg: number;
  readonly body: number;
  readonly head: number;
  readonly snout: number;
  readonly neck: number;
  readonly tail: number;
  readonly ears: number;
  readonly tempo: number;
  readonly bold: number;
  readonly lively: number;
  /** This animal's own mark: all 32 bits seed how its coat and markings grow, so no two are the same. */
  readonly mark: number;
}

export interface CastGroup { readonly kind: GroupKind | "mixed"; readonly members: readonly CastMember[] }

/** Craft and lights in the sky. */
export type PlaneKind = "airliner" | "prop" | "jet" | "ufo" | "balloon" | "helicopter" | "blimp" | "kite" | "satellite" | "rocket" | "comet";
/** What can pass over: birds (a loose flock, a V, a swirling murmuration), bats, or a craft. */
export type SkyKind = PlaneKind | "flock" | "vee" | "murmuration" | "bats";

/** One kind of sky traffic, how often it comes, and when it can. */
export interface SkyTraffic {
  readonly kind: SkyKind;
  readonly weight: number;
  /** Only by day, or only by night. */
  readonly when?: "day" | "night";
  /** Only in fair weather: not in rain or snow. */
  readonly fair?: boolean;
  /** Only in these seasons (a migration). */
  readonly seasons?: readonly Season[];
}

/** What passes over this world. */
export interface SkyPlan {
  /** The birds that flock over, those that fly in a V, and those that gather in a murmuration (null where none do). */
  readonly birds: SpeciesId | null;
  readonly vee: SpeciesId | null;
  readonly swarm: SpeciesId | null;
  /** The coat each of those wears: its region's own (a jungle crow over Tokyo, a silver gull over Sydney). */
  readonly coats: { readonly birds: string; readonly vee: string; readonly swarm: string };
  /** Where the sky is, for the flyers' local names. */
  readonly region: RegionId | null;
  /** Everything that can pass over, weighted; what fits the moment is picked as each pass comes. */
  readonly traffic: readonly SkyTraffic[];
  /** Seconds between passes. */
  readonly every: readonly [number, number];
}

/**
 * The sky right now, so what passes fits it: bats and satellites by night, balloons and kites in fair weather by day.
 */
export interface SkyNow {
  /** Scales how far off things pass. */
  readonly radius?: number;
  readonly night?: boolean;
  /** "rain" and "snow" keep fair-weather traffic down; anything else is fair. */
  readonly weather?: string;
  readonly season?: string;
}

export interface Cast {
  readonly seed: number;
  readonly rarity: Rarity;
  readonly label: string;
  readonly groups: readonly CastGroup[];
  readonly sky: SkyPlan;
}

export interface CastInput {
  readonly seed?: number | string | undefined;
  readonly region?: string | undefined;
  readonly world?: string | undefined;
  readonly season?: string | undefined;
  /** Walkable radius: big animals need room. */
  readonly radius?: number | undefined;
  /** Force a species ("none" for an empty scene). */
  readonly species?: string | undefined;
  /** Force a group: solo, pair, family, pack, mixed. */
  readonly group?: string | undefined;
  /** Force a morph: albino, melanistic, golden, spirit. */
  readonly morph?: string | undefined;
}

export interface CastContext {
  readonly region: RegionId | null;
  readonly world: WorldKey;
  readonly season: Season;
  readonly radius: number;
}

const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const rarer = (a: Rarity, b: Rarity): Rarity => (RARITY_ORDER.indexOf(a) >= RARITY_ORDER.indexOf(b) ? a : b);
const bumpRarity = (r: Rarity): Rarity => RARITY_ORDER[Math.min(4, RARITY_ORDER.indexOf(r) + 1)] ?? r;
const isSpecies = (id: string | undefined): id is SpeciesId => id !== undefined && Object.hasOwn(SPECIES, id);
const WORLD_KEYS: readonly WorldKey[] = ["nature", "beach", "city", "synth", "vapor", "crystal", "cosmic", "voxel"];
const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

function numericSeed(seed: CastInput["seed"]): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  return hashName(String(seed ?? "keel-fauna"));
}

function contextOf(input: CastInput): CastContext {
  const region = ALL_REGIONS.find((id) => id === input.region) ?? null;
  return {
    region,
    world: WORLD_KEYS.find((id) => id === input.world) ?? "nature",
    season: SEASONS.find((id) => id === input.season) ?? "summer",
    radius: Math.max(0.5, input.radius ?? 5),
  };
}

/** Whether a species belongs in this place, world, season and space. */
export function fits(id: SpeciesId, input: CastInput): boolean {
  const ctx = contextOf(input);
  const spec = speciesOf(id);
  const span = spec.plan === "serpent" ? spec.size * 0.3 : spec.size;
  if (ctx.region !== null && !spec.regions.includes(ctx.region)) return false;
  if (!spec.worlds.includes(ctx.world)) return false;
  if (ctx.season === "winter" && !spec.winter) return false;
  return span <= ctx.radius * 0.3;
}

/**
 * Animals share a scene with a whole tree, so drawn true to life a mouse or a
 * songbird is a pixel or two. Each is drawn at a toy scale instead: small
 * animals grow the most (a square-root curve), a deer hardly at all, and
 * none shrinks. Casting, room and weight on a branch still go by the true
 * size. Birds go by the same curve (a songbird, three and a half times
 * its size at most, so it still reads as a bird at grove scale); insects
 * 1.6 times. A snake is long already and keeps
 * its true size.
 */
export const TOY = 1.4;
export function shownSize(id: SpeciesId, size: number): number {
  const plan = speciesOf(id).plan;
  if (plan === "bug") return size * 1.6;
  if (plan === "serpent") return size;
  if (plan === "bird") return Math.max(size, Math.min(size * 3.5, TOY * Math.sqrt(size)));
  return Math.max(size, TOY * Math.sqrt(size));
}

/** A special skin, or none: forced, or rolled on its own stream so the coat and size rolls never move it. */
function morphFor(skin: () => number, input: CastInput): Morph {
  if (Object.hasOwn(MORPHS, input.morph ?? "")) return input.morph as Morph;
  const skins = [...(WORLD_SKINS[contextOf(input).world] ?? []), ...WILD_SKINS];
  const rare = skins.reduce((sum, [, odds]) => sum + odds, 0);
  return pick(skin, [["normal", Math.max(0, 1 - rare)], ...skins]);
}

export function traitsOf(rand: (() => number) | null, young: boolean, sex?: Traits["sex"]): Traits {
  // (With no stream, the kind's own make: a gallery's or a test's animal, a stag rather than a doe.)
  const jit = (spread: number): number => (rand ? 1 + (rand() * 2 - 1) * spread : 1);
  const drawn = !rand || rand() < 0.5 ? "male" : "female";
  const t = {
    len: jit(0.05),
    leg: jit(0.06),
    body: jit(0.07),
    head: jit(0.05),
    snout: jit(0.08),
    neck: jit(0.06),
    tail: jit(0.12),
    ears: jit(0.1),
    tempo: jit(0.1),
    bold: jit(0.28),
    lively: jit(0.22),
    mark: rand ? Math.floor(rand() * 4294967296) : 1,
  };
  if (!young) return { sex: sex ?? drawn, ...t };
  return {
    ...t,
    sex: sex ?? drawn,
    len: t.len * 0.9,
    leg: t.leg * 0.88,
    head: t.head * 1.16,
    snout: t.snout * 0.72,
    neck: t.neck * 0.85,
    tail: t.tail * 0.8,
    ears: t.ears * 1.1,
    lively: t.lively * 1.35,
  };
}

/** The local name of a coat in a region, or the species' own. */
function lookLabel(id: SpeciesId, coat: string, region: RegionId | null): string {
  const look = region ? LOOKS[id]?.[region]?.find(([name]) => name === coat) : undefined;
  return look?.[2] ?? speciesOf(id).label;
}

/** What a member is cast as: its species, coat and whether it is young. */
export interface Look { readonly id: SpeciesId; readonly coat: string; readonly young: boolean }

/** A member's own rolls: the stream its morph comes from (the cast's by default), and its traits when it has them. */
export interface Own { readonly skin?: () => number; readonly traits?: Traits }

export function memberOf(rand: () => number, input: CastInput, look: Look, own?: Own): CastMember {
  const { id, coat, young } = look;
  const { skin = rand, traits = traitsOf(null, young) } = own ?? {};
  const spec = speciesOf(id);
  const colors = coatColors(id, coat);
  const morph = morphFor(skin, input);
  const heft = spec.size * between(rand, [0.88, 1.12]) * (young ? 0.55 : 1);
  const size = shownSize(id, heft / (young ? 0.55 : 1)) * (young ? 0.6 : 1);
  rand(); // (the old antler roll: kept so the coat rolls after it stay where they were)
  // Antlers on a grown stag, out of velvet: not on a doe or a fawn, nor in spring, when they are growing back.
  const horned = traits.sex === "male" && !young && contextOf(input).season !== "spring";
  return {
    species: id,
    label: lookLabel(id, coat, contextOf(input).region),
    size,
    heft,
    coat,
    palette: paletteOf(id, varied(colors, rand, young), morph, coat),
    morph,
    young,
    horned,
    traits,
  };
}

/** Who is which sex in a group: a pair is a male and a female, a parent with young most often the mother. */
function sexOf(kind: GroupKind, i: number, rand: () => number): Traits["sex"] | undefined {
  if (kind === "pair") return i === 0 ? "male" : "female";
  if (kind === "family" && i === 0) return rand() < 0.75 ? "female" : "male";
  return undefined;
}

/** How many a group of a kind has: one, two, a parent and its young, or a pack of the species' own size. */
function countOf(rand: () => number, kind: GroupKind, spec: SpeciesSpec): number {
  if (kind === "solo") return 1;
  if (kind === "pair") return 2;
  return kind === "family" ? 1 + intBetween(rand, 1, 2) : intBetween(rand, spec.pack[0], spec.pack[1]);
}

function groupOf(rand: () => number, id: SpeciesId, kind: GroupKind, input: CastInput): CastGroup {
  const spec = speciesOf(id);
  const seed = numericSeed(input.seed);
  const coats = looksFor(id, contextOf(input).region);
  const coat = pick(rand, coats.map(([name, weight]) => [name, weight] as const));
  const count = countOf(rand, kind, spec);
  const skin = streamOf(seed, `fauna.skin.${id}`);
  const members = Array.from({ length: count }, (_, i) => {
    const young = kind === "family" && i > 0;
    const own = streamOf(seed, `fauna.traits.${id}.${i}`);
    // (A mixed-up pack: now and then one wears another of the local coats.)
    const wears = rand() < 0.15 ? pick(rand, coats.map(([name, weight]) => [name, weight] as const)) : coat;
    return memberOf(
      rand,
      input,
      { id, coat: wears, young },
      { skin, traits: traitsOf(own, young, sexOf(kind, i, own)) },
    );
  });
  return { kind, members };
}

function pickSpecies(rand: () => number, input: CastInput, not: readonly SpeciesId[] = []): SpeciesId | null {
  const ctx = contextOf(input);
  const pool = SPECIES_IDS.filter((id) => fits(id, input) && !not.includes(id));
  if (pool.length === 0) return null;
  return pick(rand, pool.map((id) => [id, localWeight(id, ctx)] as const));
}

/**
 * Options for `poseSpecies`: a morph, a young one, a seeded individual (its coat and proportions), a coat or region's
 * coat, and its sex.
 */
export interface PoseOptions {
  readonly morph?: Morph | undefined;
  readonly young?: boolean | undefined;
  readonly seed?: number | undefined;
  readonly coat?: string | undefined;
  readonly region?: string | undefined;
  readonly sex?: Traits["sex"] | undefined;
}

/** Unseeded and nowhere, a species' own first coat; seeded or in a region, one of that region's coats, rolled. */
export function poseCoat(id: SpeciesId, region: RegionId | null, seed: number | undefined): string {
  const looks = looksFor(id, region);
  if (seed === undefined && region === null) return looks[0]?.[0] ?? "";
  return pick(streamOf(seed ?? 1, "fauna.pose.coat"), looks.map(([name, weight]) => [name, weight] as const));
}

/**
 * Actions a wary animal does more and a bold one less, the restful ones a lively animal does less, and the ones it does
 * more.
 */
const WARY: ReadonlySet<Action> = new Set<Action>(["look", "rear"]);
const RESTFUL: ReadonlySet<Action> = new Set<Action>(["sit", "lie", "sleep", "bask"]);
const LIVELY: ReadonlySet<Action> = new Set<Action>([...MOVES, "play", "dig", "sniff", "display", "sing"]);

const OWN_SPECS = new WeakMap<CastMember, SpeciesSpec>();
/**
 * An animal's own copy of its species' spec: its kind's, with the build
 * shares, tempo and temperament of its traits (see `Traits`) worked in. The
 * pose code reads proportions and the director reads speed and temper from
 * it, so two foxes of a pack differ in leg and tail, in pace, and in how much
 * they watch, rest and roam. Its menu of actions stays its kind's.
 */
/** How much a trait scales an action's temper: a wary act by boldness, a restful or lively one by liveliness. */
function temperScale(action: Action, t: Traits): number {
  if (WARY.has(action)) return 1 / t.bold;
  if (RESTFUL.has(action)) return 1 / t.lively;
  return LIVELY.has(action) ? t.lively : 1;
}

export function specOf(member: CastMember): SpeciesSpec {
  const known = OWN_SPECS.get(member);
  if (known) return known;
  const kind = speciesOf(member.species);
  const t = member.traits;
  const b = kind.build;
  const build: Build = {
    ...b,
    len: b.len * t.len,
    leg: b.leg * t.leg,
    body: b.body * t.body,
    head: b.head * t.head,
    snout: b.snout * t.snout,
    neck: b.neck * t.neck,
    tailLen: b.tailLen * t.tail,
    earLen: b.earLen * t.ears,
  };
  const temper: Partial<Record<Action, number>> = { ...kind.temper };
  for (const action of actionsOf(kind)) {
    const k = temperScale(action, t);
    if (Math.abs(k - 1) > 1e-9) temper[action] = (kind.temper[action] ?? 1) * k;
  }
  const spec: SpeciesSpec = { ...kind, speed: kind.speed * t.tempo, build, temper };
  OWN_SPECS.set(member, spec);
  return spec;
}

const GROUP_KINDS: readonly GroupKind[] = ["solo", "pair", "family", "pack"];

function kindFor(rand: () => number, id: SpeciesId, together: boolean): GroupKind {
  const odds = speciesOf(id).groups;
  return pick(rand, GROUP_KINDS.map((kind, i) => [kind, together && kind === "solo" ? 0 : odds[i] ?? 0] as const).filter(([, w]) => w > 0).concat(together ? [] : [["solo", 0.01]]));
}

/** Two species that are seen together: a deer and a songbird, a capybara and a monkey. */
function mixedGroup(rand: () => number, input: CastInput, forced: SpeciesId | null = null): CastGroup | null {
  // (A forced species hosts its own company; the host is rolled still, so the rolls after it stay put.)
  const rolled = pickSpecies(rand, input);
  const host = forced ?? rolled;
  if (!host) return null;
  const friends = speciesOf(host).friends.filter((id): id is SpeciesId => isSpecies(id) && fits(id, input));
  const guest = friends.length > 0 ? pick(rand, friends.map((id) => [id, 1] as const)) : null;
  if (!guest) return null;
  const a = groupOf(rand, host, rand() < 0.6 ? "solo" : "pair", input);
  const b = groupOf(rand, guest, rand() < 0.65 ? "solo" : "pair", input);
  const members = [...a.members, ...b.members].sort((x, y) => y.size - x.size);
  return { kind: "mixed", members };
}

const TIERS = [["none", 440], ["solo", 300], ["group", 170], ["mixed", 70], ["menagerie", 20]] as const;
type Tier = (typeof TIERS)[number][0];

function tierFor(rand: () => number, input: CastInput): Tier {
  const roll = pick(rand, TIERS);
  if (input.species === "none" || input.group === "none") return "none";
  if (input.group === "mixed") return "mixed";
  if (input.group !== undefined && GROUP_KINDS.includes(input.group as GroupKind)) return "group";
  return isSpecies(input.species) && roll === "none" ? "solo" : roll;
}

function groupsFor(rand: () => number, tier: Tier, input: CastInput): CastGroup[] {
  if (tier === "none") return [];
  if (tier === "mixed") {
    const g = mixedGroup(rand, input, isSpecies(input.species) ? input.species : null);
    return g ? [g] : groupsFor(rand, "solo", input);
  }
  const forced = isSpecies(input.species) ? input.species : null;
  const id = forced ?? pickSpecies(rand, input);
  if (!id) return [];
  const asked = GROUP_KINDS.find((kind) => kind === input.group);
  // (Some never go alone: a lone firefly is a pack of them.)
  const kind = asked ?? (tier === "solo" && speciesOf(id).groups[0] > 0 ? "solo" : kindFor(rand, id, true));
  const first = groupOf(rand, id, kind, input);
  return tier === "menagerie" ? [first, ...secondGroup(rand, id, input)] : [first];
}

/** A menagerie's other company: a mixed group, or another species of its own. */
function secondGroup(rand: () => number, first: SpeciesId, input: CastInput): CastGroup[] {
  const mixed = rand() < 0.5 ? mixedGroup(rand, input) : null;
  if (mixed) return [mixed];
  const other = pickSpecies(rand, input, [first]);
  return other ? [groupOf(rand, other, kindFor(rand, other, false), input)] : [];
}

const PLURALS: Partial<Record<SpeciesId, string>> = { deer: "deer", mouse: "field mice", fox: "foxes", wolf: "wolves", butterfly: "butterflies", firefly: "fireflies", sloth: "sloths", redpanda: "red pandas" };
/** A name as it reads mid-sentence: lower case, but for the names of places and people in it. */
const PROPER = /^(American|Japanese|Steller's|Abert's|Bali|Java|Javan|Australian|Asian|African|Eastern|Kirk's)$/;
const spoken = (label: string): string => label.split(" ").map((word) => (PROPER.test(word) ? word : word.toLowerCase())).join(" ");
/** More than one: "deer" stays, "mouse" is "mice", a "fox" "foxes", a "butterfly" "butterflies". */
function pluralName(name: string): string {
  if (/(deer|fowl|sheep|fireflies)$/.test(name)) return name;
  if (name.endsWith("mouse")) return `${name.slice(0, -5)}mice`;
  if (name.endsWith("wolf")) return `${name.slice(0, -4)}wolves`;
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}
const plural = (member: CastMember): string =>
  (member.label === speciesOf(member.species).label ? PLURALS[member.species] : undefined) ??
  pluralName(spoken(member.label));

function labelOf(groups: readonly CastGroup[]): string {
  if (groups.length === 0) return "no animals";
  return groups.map((group) => {
    const first = group.members[0];
    if (!first) return "";
    const morph = MORPHS[first.morph].label;
    const name = `${morph ? `${morph} ` : ""}${spoken(first.label)}`;
    if (group.kind === "solo") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
    if (group.kind === "pair") return `a pair of ${plural(first)}`;
    if (group.kind === "family") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name} with ${group.members.length - 1} young`;
    if (group.kind === "pack") return `${group.members.length} ${plural(first)}`;
    const kinds = new Map(group.members.map((m) => [m.species, m] as const));
    return [...kinds.values()].map((m) => plural(m)).join(" and ");
  }).join(", ");
}

function rarityOf(tier: Tier, groups: readonly CastGroup[]): Rarity {
  let rarity: Rarity = "common";
  for (const group of groups) {
    for (const member of group.members) {
      rarity = rarer(rarer(rarity, speciesOf(member.species).rarity), MORPHS[member.morph].rarity);
    }
    if (group.kind === "pack" || group.kind === "family") rarity = rarer(rarity, "uncommon");
  }
  if (tier === "mixed") rarity = bumpRarity(rarer(rarity, "uncommon"));
  if (tier === "menagerie") rarity = rarer(bumpRarity(rarity), "epic");
  return rarity;
}

const tr = (kind: SkyKind, weight: number, extra: Omit<SkyTraffic, "kind" | "weight"> = {}): SkyTraffic => ({ kind, weight, ...extra });
const DAY = { when: "day" } as const;
const NIGHT = { when: "night" } as const;
const FAIR_DAY = { when: "day", fair: true } as const;
const FAIR_NIGHT = { when: "night", fair: true } as const;
const MIGRATING = { when: "day", seasons: ["spring", "autumn"] } as const;

const COUNTRY_SKY: readonly SkyTraffic[] = [
  tr("flock", 5, DAY), tr("vee", 3, MIGRATING), tr("murmuration", 1, FAIR_DAY), tr("bats", 3, NIGHT),
  tr("airliner", 3), tr("prop", 1.5, FAIR_DAY), tr("balloon", 1.2, FAIR_DAY), tr("satellite", 2.5, FAIR_NIGHT), tr("comet", 1.2, FAIR_NIGHT),
];

/** What each world's sky carries, and how busy it is. */
const WORLD_SKY: Readonly<
  Record<WorldKey, { readonly traffic: readonly SkyTraffic[]; readonly every: readonly [number, number] }>
> = {
  nature: { traffic: COUNTRY_SKY, every: [12, 34] },
  voxel: { traffic: COUNTRY_SKY, every: [12, 34] },
  beach: {
    traffic: [
      tr("flock", 6, DAY),
      tr("vee", 1.5, DAY),
      tr("kite", 2.5, FAIR_DAY),
      tr("prop", 3, FAIR_DAY),
      tr("airliner", 2),
      tr("balloon", 0.8, FAIR_DAY),
      tr("bats", 1.5, NIGHT),
      tr("satellite", 2.5, FAIR_NIGHT),
      tr("comet", 1.2, FAIR_NIGHT),
    ],
    every: [10, 30],
  },
  city: {
    traffic: [
      tr("flock", 4, DAY),
      tr("murmuration", 1.2, FAIR_DAY),
      tr("helicopter", 2.5),
      tr("blimp", 1.2, FAIR_DAY),
      tr("airliner", 5),
      tr("jet", 1.5),
      tr("bats", 1, NIGHT),
      tr("satellite", 0.6, FAIR_NIGHT),
    ],
    every: [8, 24],
  },
  synth: {
    traffic: [tr("jet", 5), tr("ufo", 1.8), tr("helicopter", 1), tr("comet", 1.5, NIGHT), tr("satellite", 1, NIGHT)],
    every: [14, 36],
  },
  vapor: {
    traffic: [
      tr("jet", 3),
      tr("balloon", 2, FAIR_DAY),
      tr("blimp", 2, { fair: true }),
      tr("flock", 1, DAY),
      tr("kite", 1, FAIR_DAY),
      tr("ufo", 1),
      tr("comet", 0.8, NIGHT),
    ],
    every: [14, 36],
  },
  crystal: {
    traffic: [
      tr("vee", 2.5, DAY),
      tr("flock", 2, DAY),
      tr("balloon", 3, FAIR_DAY),
      tr("airliner", 1),
      tr("comet", 1.8, NIGHT),
      tr("satellite", 1.5, FAIR_NIGHT),
    ],
    every: [14, 38],
  },
  cosmic: { traffic: [tr("ufo", 2), tr("satellite", 3), tr("rocket", 1.5), tr("comet", 3)], every: [9, 24] },
};
const FLOCK_WEIGHTS: Partial<Record<SpeciesId, number>> = { songbird: 4, crow: 2, gull: 4, parrot: 2, crane: 0.6 };
const BIRDS_FOR: Readonly<Record<"vee" | "murmuration", readonly SpeciesId[]>> = { vee: ["crane", "gull", "crow"], murmuration: ["songbird", "crow"] };

function skyFor(rand: () => number, input: CastInput): SkyPlan {
  const ctx = contextOf(input);
  const here = (id: SpeciesId): boolean => (ctx.region === null || speciesOf(id).regions.includes(ctx.region)) && speciesOf(id).worlds.includes(ctx.world === "voxel" ? "nature" : ctx.world);
  const flockers = (Object.keys(FLOCK_WEIGHTS) as SpeciesId[]).filter(here);
  // (Weighed as the ground cast is weighed here: crows over Tokyo, gulls over the Atlantic.)
  const local = (id: SpeciesId): number =>
    (FLOCK_WEIGHTS[id] ?? 1) * (ctx.region ? (LOCAL_WEIGHT[ctx.region][id] ?? 1) : 1);
  const birds = flockers.length > 0 ? pick(rand, flockers.map((id) => [id, local(id)] as const)) : null;
  const vee = BIRDS_FOR.vee.find(here) ?? null;
  const swarm = BIRDS_FOR.murmuration.find(here) ?? null;
  const has: Partial<Record<SkyKind, boolean>> = {
    flock: birds !== null,
    vee: vee !== null,
    murmuration: swarm !== null,
  };
  const sky = WORLD_SKY[ctx.world];
  const coat = (id: SpeciesId | null): string => (id ? pick(rand, looksFor(id, ctx.region).map(([name, weight]) => [name, weight] as const)) : "");
  const coats = { birds: coat(birds), vee: coat(vee), swarm: coat(swarm) };
  return {
    birds,
    vee,
    swarm,
    coats,
    region: ctx.region,
    traffic: sky.traffic.filter((each) => has[each.kind] !== false),
    every: sky.every,
  };
}

/**
 * Cast a scene: which animals live in it (most scenes have none; a lone
 * animal is likelier than a pair, a pair than a family or pack, and mixed
 * company rarest), their coats and rare morphs, and what passes over in the sky.
 */
export function castFor(input: CastInput = {}): Cast {
  const seed = numericSeed(input.seed);
  const rand = streamOf(seed, "fauna.cast");
  const tier = tierFor(rand, input);
  const groups = groupsFor(rand, tier, input);
  return { seed, rarity: groups.length > 0 ? rarityOf(tier, groups) : "common", label: labelOf(groups), groups, sky: skyFor(streamOf(seed, "fauna.sky"), input) };
}
