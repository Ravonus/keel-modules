// The species table: every animal's build, outline, pace, temper and company, and the birds' wings, as data.

import type { Build, RegionId, SpeciesId, SpeciesSpec, WingStyle, WorldKey } from "./roster.js";

export const ALL_REGIONS: readonly RegionId[] = ["rockies", "atlantic", "alps", "tokyo", "sydney", "nairobi", "bali"];
const TEMPERATE: readonly RegionId[] = ["rockies", "atlantic", "alps", "tokyo"];
const WILD: readonly WorldKey[] = ["nature", "voxel", "crystal"];

const BUILD: Build = {
  len: 1.3, leg: 0.6, body: 0.24, neck: 0.3, rise: 0.7, head: 0.17, snout: 0.16, ears: "point", tail: "thin", tailLen: 0.8, hip: 1, extras: [],
  foot: "paw", fore: 1, legR: 1, chest: 1.1, haunch: 1, sit: "dog", earLen: 1, snoutTip: 0.7, tailGirth: 1, tailRise: 0, neckGirth: 1, foreBone: 0.53,
};
/**
 * Outlines by family, so each animal is drawn from its kind's real shape: a
 * dog's deep chest and tucked waist, a cat's level back and round skull, a
 * deer's narrow barrel and long face, a rabbit's high round haunch. Each is
 * the torso along the spine and the skull and muzzle along the head (see
 * `Station`); an animal's own traits still stretch and scale it.
 */
type Outline = Pick<Build, "torso" | "skull" | "muzzle">;
/** A runner's leg: muscle high up, drawn in to a slim cannon below the knee or hock. */
const RUNNER_TAPER = { fore: [1.65, 0.92, 0.78, 0.42], hind: [2.2, 1.08, 0.9, 0.42] } as const;
const OUTLINE = {
  canid: {
    torso: [[0, 0.8, 0.68, 0.7], [0.38, 0.76, 0.5, 0.64], [0.75, 0.9, 1.02, 0.78], [1.05, 0.86, 0.95, 0.7]],
    skull: [[-0.6, 0.58, 0.55, 0.62], [-0.1, 0.8, 0.62, 0.8], [0.35, 0.6, 0.52, 0.58]],
    muzzle: [[0.5, 0.4, 0.4, 0.36], [1, 0.24, 0.26, 0.2]],
  },
  vulpine: {
    torso: [[0, 0.78, 0.66, 0.66], [0.38, 0.72, 0.5, 0.6], [0.75, 0.84, 0.95, 0.72], [1.05, 0.8, 0.88, 0.64]],
    skull: [[-0.6, 0.55, 0.52, 0.66], [-0.1, 0.78, 0.6, 0.86], [0.35, 0.55, 0.5, 0.56]],
    muzzle: [[0.5, 0.34, 0.36, 0.3], [1, 0.18, 0.2, 0.14]],
  },
  // (A cat is one smooth bean: a gentle arc of spine over a round barrel and a soft low belly.)
  felid: {
    torso: [[-0.02, 0.86, 0.74, 0.86], [0.5, 0.92, 0.84, 0.92], [1.04, 0.84, 0.82, 0.84]],
  },
  cervid: {
    torso: [[-0.05, 0.82, 0.72, 0.62], [0.35, 0.8, 0.86, 0.7], [0.75, 0.86, 0.96, 0.68], [1.05, 1, 0.78, 0.55]],
    skull: [[-0.6, 0.55, 0.5, 0.56], [-0.1, 0.74, 0.6, 0.72], [0.3, 0.6, 0.55, 0.55]],
    muzzle: [[0.5, 0.46, 0.46, 0.4], [1, 0.32, 0.34, 0.28]],
  },
  leporid: {
    torso: [[-0.1, 1.08, 0.98, 1], [0.35, 1.04, 0.95, 0.92], [0.8, 0.8, 0.86, 0.75], [1.05, 0.7, 0.8, 0.65]],
    skull: [[-0.6, 0.66, 0.6, 0.7], [0, 0.86, 0.75, 0.85], [0.4, 0.7, 0.6, 0.66]],
    muzzle: [[1, 0.46, 0.42, 0.46]],
  },
  rodent: {
    torso: [[-0.1, 0.95, 0.9, 0.9], [0.4, 0.98, 0.9, 0.9], [0.85, 0.8, 0.82, 0.74], [1.05, 0.7, 0.75, 0.64]],
    skull: [[-0.6, 0.62, 0.6, 0.68], [0, 0.82, 0.7, 0.82], [0.35, 0.62, 0.56, 0.6]],
    muzzle: [[0.6, 0.42, 0.42, 0.42], [1, 0.3, 0.3, 0.28]],
  },
  murid: {
    torso: [[-0.1, 0.98, 0.95, 0.95], [0.45, 1.02, 0.95, 0.95], [1.05, 0.78, 0.8, 0.72]],
    skull: [[-0.6, 0.66, 0.62, 0.72], [-0.05, 0.84, 0.7, 0.86], [0.3, 0.58, 0.52, 0.56]],
    muzzle: [[1, 0.2, 0.22, 0.18]],
  },
  cavy: {
    torso: [[-0.05, 0.95, 0.9, 0.85], [0.4, 0.95, 1, 0.92], [0.8, 0.9, 0.95, 0.85], [1.05, 0.85, 0.85, 0.74]],
    skull: [[-0.6, 0.7, 0.7, 0.64], [0, 0.8, 0.74, 0.72], [0.3, 0.78, 0.72, 0.66]],
    muzzle: [[1, 0.7, 0.6, 0.58]],
  },
  mustelid: {
    torso: [[-0.05, 0.88, 0.74, 0.84], [0.4, 0.98, 0.78, 0.9], [0.8, 0.88, 0.8, 0.82], [1.05, 0.78, 0.78, 0.7]],
    skull: [[-0.6, 0.6, 0.6, 0.72], [-0.05, 0.8, 0.65, 0.88], [0.35, 0.6, 0.55, 0.62]],
    muzzle: [[1, 0.28, 0.3, 0.24]],
  },
  // (A raccoon is pear-shaped: its back arches over deep wide loins and falls to low narrow shoulders. Its head is a
  // round one: the face marks sit true on it.)
  procyonid: {
    torso: [[-0.12, 1, 1.04, 1.1], [0.4, 1.2, 1.08, 1.08], [1.05, 0.78, 0.84, 0.72]],
  },
  viverrid: {
    torso: [[-0.05, 0.78, 0.68, 0.7], [0.4, 0.82, 0.66, 0.72], [0.8, 0.8, 0.76, 0.7], [1.05, 0.72, 0.74, 0.62]],
    skull: [[-0.6, 0.58, 0.56, 0.66], [-0.05, 0.76, 0.62, 0.78], [0.35, 0.56, 0.52, 0.56]],
    muzzle: [[1, 0.26, 0.28, 0.22]],
  },
  koala: {
    torso: [[0, 1, 1, 0.95], [0.6, 1.02, 1, 0.95], [1.05, 0.9, 0.95, 0.85]],
    skull: [[-0.5, 0.78, 0.74, 0.95], [0, 0.95, 0.8, 1.05], [0.35, 0.8, 0.7, 0.85]],
    muzzle: [[1, 0.62, 0.5, 0.56]],
  },
  macropod: {
    torso: [[-0.1, 1.1, 1, 0.9], [0.4, 0.95, 0.95, 0.8], [0.85, 0.72, 0.76, 0.6], [1.05, 0.62, 0.66, 0.55]],
    skull: [[-0.6, 0.56, 0.52, 0.58], [-0.1, 0.74, 0.6, 0.72], [0.3, 0.6, 0.55, 0.55]],
    muzzle: [[0.5, 0.46, 0.46, 0.4], [1, 0.34, 0.34, 0.3]],
  },
  // Birds: the body from the tail's root to the breast (the back on top, the deep keel under), and
  // the skull back to front, its forehead sloping down into the bill.
  passerine: {
    torso: [[-0.2, 0.42, 0.36, 0.42], [0.25, 0.8, 0.86, 0.8], [0.7, 0.92, 1.12, 0.92], [1.1, 0.7, 0.74, 0.68]],
    skull: [[-0.7, 0.6, 0.55, 0.62], [-0.1, 0.9, 0.74, 0.82], [0.45, 0.66, 0.54, 0.58], [0.75, 0.42, 0.34, 0.36]],
  },
  corvid: {
    torso: [[-0.3, 0.38, 0.3, 0.38], [0.2, 0.8, 0.84, 0.76], [0.7, 0.92, 1.08, 0.86], [1.12, 0.66, 0.68, 0.6]],
    skull: [[-0.8, 0.52, 0.52, 0.58], [-0.15, 0.8, 0.72, 0.76], [0.45, 0.66, 0.56, 0.58], [0.85, 0.48, 0.4, 0.4]],
  },
  larid: {
    torso: [[-0.35, 0.34, 0.28, 0.36], [0.2, 0.76, 0.8, 0.72], [0.68, 0.86, 1.12, 0.86], [1.12, 0.6, 0.66, 0.58]],
    skull: [[-0.8, 0.5, 0.52, 0.56], [-0.15, 0.76, 0.7, 0.72], [0.45, 0.6, 0.54, 0.54], [0.85, 0.4, 0.36, 0.34]],
  },
  // (An owl stands upright: broadest across its chest, under the head, and narrowing down to its base so
  // its feathered legs show beneath, its breast falling back under the face so the face disc shows whole.)
  strigid: {
    torso: [[-0.3, 0.56, 0.54, 0.58], [0.25, 0.92, 0.98, 0.98], [0.8, 0.98, 0.96, 1.04], [1.15, 0.8, 0.74, 0.96]],
  },
  psittacid: {
    torso: [[-0.25, 0.42, 0.36, 0.42], [0.3, 0.84, 0.9, 0.8], [0.75, 0.9, 1.08, 0.88], [1.1, 0.7, 0.72, 0.68]],
    skull: [[-0.7, 0.68, 0.62, 0.7], [-0.05, 0.95, 0.8, 0.86], [0.45, 0.8, 0.62, 0.7], [0.7, 0.62, 0.46, 0.5]],
  },
  galliform: {
    torso: [[-0.2, 0.62, 0.4, 0.5], [0.3, 1.05, 0.85, 0.88], [0.75, 1, 1, 0.9], [1.1, 0.7, 0.75, 0.65]],
    skull: [[-0.6, 0.62, 0.58, 0.62], [0, 0.82, 0.72, 0.75], [0.55, 0.58, 0.5, 0.5]],
  },
  gruid: {
    torso: [[-0.3, 0.5, 0.38, 0.5], [0.3, 0.9, 0.85, 0.8], [0.75, 0.88, 0.98, 0.8], [1.1, 0.6, 0.62, 0.55]],
    skull: [[-0.7, 0.55, 0.5, 0.55], [0, 0.72, 0.62, 0.62], [0.6, 0.48, 0.42, 0.42]],
  },
} as const satisfies Readonly<Record<string, Outline>>;

type SpeciesDraft = Omit<SpeciesSpec, "build" | "temper" | "friends" | "groups" | "pack" | "winter" | "climbs" | "flies" | "active" | "worlds">
  & Partial<Pick<SpeciesSpec, "temper" | "friends" | "groups" | "pack" | "winter" | "climbs" | "flies" | "active" | "worlds">>
  & { readonly build?: Partial<Build> };
const define = (draft: SpeciesDraft): SpeciesSpec => ({
  worlds: WILD, active: "day", winter: true, climbs: false, flies: draft.plan === "bird" || draft.plan === "bug",
  groups: [6, 2, 1, 0], pack: [3, 4], temper: {}, friends: [],
  ...draft,
  build: { ...BUILD, ...draft.build },
});

export const SPECIES = {
  rabbit: define({ label: "Rabbit", plan: "quad", size: 0.2, rarity: "common", weight: 70, regions: TEMPERATE, speed: 1.4, groups: [6, 3, 2, 1], pack: [3, 5],
    build: { ...OUTLINE.leporid, len: 0.85, leg: 0.36, body: 0.4, neck: 0.1, rise: 0.9, head: 0.27, snout: 0.08, ears: "long", tail: "puff", tailLen: 0.25, hip: 1.18, fore: 0.78, haunch: 1.3, chest: 0.95, sit: "loaf", snoutTip: 0.8, legR: 1.1 },
    coats: [["wild", ["#9a7e5e", "#7c6248", "#efe6d6", "#3a2c22", "#e8a8a8"]], ["snowshoe", ["#f2efe8", "#d8d2c8", "#ffffff", "#5a4a40", "#f0b0b8"]], ["dutch", ["#3a3230", "#f4f0ea", "#f4f0ea", "#1e1a18", "#e8a8a8"]]],
    temper: { graze: 2.2, groom: 1.6, rear: 1.4, hop: 1.8, sit: 1.3, wander: 0.4, sniff: 1.4 }, friends: ["songbird", "deer"] }),
  fox: define({ label: "Fox", plan: "quad", size: 0.36, rarity: "uncommon", weight: 34, regions: TEMPERATE, speed: 1.6, groups: [7, 2, 2, 0],
    build: { ...OUTLINE.vulpine, taper: RUNNER_TAPER, len: 1.35, leg: 0.62, body: 0.25, neck: 0.3, rise: 0.75, head: 0.18, snout: 0.26, ears: "point", tail: "bushy", tailLen: 1.1, extras: ["socks", "bib", "muzzle"], earLen: 1.1, snoutTip: 0.32, chest: 1.15, haunch: 0.95, tailGirth: 1.15, legR: 0.85 },
    coats: [["red", ["#d2662a", "#a8481c", "#f4efe6", "#2a1a14", "#f4efe6"]], ["silver", ["#5a5a62", "#2e2e34", "#e8e8ec", "#16161a", "#f0f0f4"]], ["arctic", ["#f4f4f0", "#dcdcd6", "#ffffff", "#2a2a2a", "#ffffff"]]],
    temper: { sniff: 2.2, dig: 1.6, play: 1.4, stretch: 1.3, sit: 1, sleep: 1, look: 1.4, wander: 1.4, stalk: 1.2, graze: 0 }, friends: ["crow"] }),
  deer: define({ label: "Deer", plan: "quad", size: 0.95, rarity: "uncommon", weight: 26, regions: TEMPERATE, speed: 1.1, groups: [4, 3, 4, 2], pack: [3, 4],
    build: { ...OUTLINE.cervid, len: 1.1, leg: 0.72, body: 0.22, neck: 0.55, rise: 1.05, head: 0.12, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.18, extras: ["antlers", "spots", "rump"], foot: "hoof", sit: "lie", legR: 0.55, chest: 1.2, earLen: 1.5, snoutTip: 0.5 },
    coats: [["whitetail", ["#a87a4e", "#8a6038", "#f4ece0", "#2a1e16", "#f8f4ec"]], ["sika", ["#9a5e34", "#7a4422", "#f0e4d0", "#241810", "#f6efe2"]], ["fallow", ["#c8925a", "#9e6c3e", "#f6ecd8", "#2e2014", "#ffffff"]]],
    temper: { graze: 2.8, look: 1.8, groom: 1, wander: 0.8, lie: 1.6, run: 0.3, dig: 0, roll: 0, sit: 0 }, friends: ["rabbit", "songbird", "crow"] }),
  wolf: define({ label: "Wolf", plan: "quad", size: 0.72, rarity: "rare", weight: 10, regions: ["rockies", "alps"], speed: 1.3, groups: [3, 2, 1, 5], pack: [3, 5],
    build: { ...OUTLINE.canid, taper: RUNNER_TAPER, len: 1.35, leg: 0.7, body: 0.25, neck: 0.3, rise: 0.55, head: 0.17, snout: 0.24, ears: "point", tail: "bushy", tailLen: 0.75, extras: ["ruff", "bib", "saddle", "muzzle"], earLen: 1.15, snoutTip: 0.45, chest: 1.25, haunch: 0.9, tailRise: -0.5, tailGirth: 0.9, legR: 0.95 },
    coats: [["grey", ["#7c7a74", "#4e4c48", "#e0dcd4", "#1e1c1a", "#d6d0c4"]], ["timber", ["#8a6a4a", "#4a3828", "#dcccb4", "#1c1610", "#cdb898"]], ["white", ["#e8e6e0", "#c8c4bc", "#ffffff", "#2a2826", "#ffffff"]], ["black", ["#2c2a2a", "#1a1818", "#4a4644", "#0c0a0a", "#5a5654"]]],
    temper: { howl: 2.4, sniff: 1.6, lie: 1.6, play: 1.4, look: 1.5, wander: 1.4, run: 0.6, graze: 0 }, friends: ["crow"] }),
  dog: define({ label: "Dog", plan: "quad", size: 0.46, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1.2, groups: [3, 2, 1, 5],
    build: { ...OUTLINE.canid, taper: RUNNER_TAPER, len: 1.1, leg: 0.52, body: 0.3, neck: 0.22, rise: 0.55, head: 0.2, snout: 0.2, ears: "point", tail: "bushy", tailLen: 0.8, extras: ["muzzle", "bib"], earLen: 0.8, snoutTip: 0.5, chest: 1.2, haunch: 0.95, tailRise: -0.2, tailGirth: 0.8, legR: 0.95 },
    coats: [["golden", ["#c89a58", "#a87a3c", "#f0dcb4", "#2a1c10", "#e8cc98"]], ["black", ["#2a2826", "#1a1816", "#d8d0c4", "#0c0a08", "#f0ece4"]], ["brown", ["#7a5236", "#583822", "#c8a888", "#1c120a", "#b89878"]]],
    temper: { sniff: 2.2, play: 2, sit: 1.8, sleep: 1.4, look: 1.6, wander: 1.8, run: 1, dig: 0.8, shake: 0.6, graze: 0 }, friends: ["cat", "deer"] }),
  bear: define({ label: "Bear", plan: "quad", size: 0.9, rarity: "rare", weight: 8, regions: ["rockies", "alps", "tokyo"], speed: 0.8, winter: false, groups: [6, 0, 3, 0],
    build: { len: 1.3, leg: 0.58, body: 0.36, neck: 0.42, rise: -0.05, head: 0.25, snout: 0.15, ears: "round", tail: "none", tailLen: 0.1, hip: 0.92, extras: ["hump", "muzzle"], foot: "plant", sit: "rump", legR: 1.5, chest: 1.15, earLen: 1.5, snoutTip: 0.8,
      // A round rump, a deep belly, the back rising to the hump over the shoulders; a broad skull dished down to a
      // short, blunt muzzle.
      torso: [[-0.05, 0.8, 0.62, 0.78], [0.3, 0.78, 0.72, 0.85], [0.68, 0.92, 0.72, 0.88], [0.95, 1.05, 0.68, 0.82], [1.1, 0.75, 0.7, 0.7]],
      skull: [[-0.55, 0.6, 0.6, 0.68], [-0.08, 0.85, 0.72, 0.95], [0.35, 0.62, 0.62, 0.7]],
      muzzle: [[0.5, 0.44, 0.5, 0.46], [1, 0.34, 0.38, 0.34]] },
    coats: [["brown", ["#6a4a30", "#4a3220", "#8a6a4a", "#1a120c", "#a88a68"]], ["black", ["#262220", "#141210", "#3a3430", "#0a0808", "#b89a72"]], ["cinnamon", ["#9a6236", "#764824", "#b8865a", "#22140a", "#c8a07a"]]],
    temper: { rear: 1.6, scratch: 2, sit: 1.8, sniff: 1.4, dig: 1.3, lie: 1.4, roll: 0.8, graze: 0 }, friends: ["songbird"] }),
  raccoon: define({ label: "Raccoon", plan: "quad", size: 0.3, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 1.1, active: "night", climbs: true, groups: [5, 2, 3, 0],
    build: { ...OUTLINE.procyonid, len: 0.9, leg: 0.36, fore: 0.94, body: 0.35, neck: 0.16, rise: 0.15, head: 0.285, snout: 0.17, ears: "rimmed", tail: "banded", tailLen: 1, tailGirth: 0.87, hip: 1.32, extras: ["mask", "brows", "muzzle", "socks", "jowls", "button", "fingers"], foot: "plant", sit: "haunch", haunch: 1.1, chest: 0.95, snoutTip: 0.5, eyeSet: [0.46, 0.66, 0.3], earLen: 1.1, legR: 0.72, legMake: { fore: [1.9, 1.25, 1.05, 0.72], hind: [2.6, 1.3, 1.15, 0.95], hindBones: [0.66, 0.4] } },
    coats: [["raccoon", ["#80858c", "#4e5258", "#c8c8c6", "#181310", "#f4f2ec"]], ["tanuki", ["#8a6c4a", "#4a3828", "#b89a78", "#18110b", "#e6e0d4"]]],
    temper: { dig: 1.8, sniff: 1.8, rear: 1.4, eat: 1.6, climb: 1.2, groom: 1.2, graze: 0 }, friends: ["cat"] }),
  cat: define({ label: "Cat", plan: "quad", size: 0.24, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1, active: "any", climbs: true, groups: [8, 2, 2, 0],
    build: { ...OUTLINE.felid, len: 0.7, leg: 0.4, body: 0.3, neck: 0.19, neckGirth: 0.78, foreBone: 0.503, rise: 0.85, head: 0.25, hip: 1.03, snout: 0.14, ears: "point", tail: "thin", tailLen: 0.95, tailGirth: 1.95, tailLine: [[0.42, 1, 0.3], [0.68, 0.85, 0.3], [0.78, 0.45, 0.26], [0.12, 0.1, 0.14]], extras: ["bib", "mitts"], chest: 1, haunch: 1, snoutTip: 0.8, legR: 0.64, legMake: { fore: [1.95, 1.5, 1.45, 0.92], hind: [2.8, 1.15, 1.12, 0.92], hindBones: [0.74, 0.31] }, stoop: 0.5 },
    coats: [["tabby", ["#e4b48c", "#d09058", "#fff2e0", "#704424", "#e8a098"]], ["black", ["#191716", "#100f0e", "#191716", "#080706", "#54403f"]], ["calico", ["#f6f0e6", "#d8782a", "#ffffff", "#1e1a18", "#eea2a2"]], ["grey", ["#9a9ca4", "#5e6068", "#e4e4e8", "#262830", "#eea8b4"]]],
    temper: { groom: 2.4, sit: 2, sleep: 1.8, stretch: 1.6, look: 1.4, play: 1.1, yawn: 1.4, climb: 0.8, stalk: 1, graze: 0 }, friends: ["raccoon", "crow", "songbird"] }),
  hedgehog: define({ label: "Hedgehog", plan: "quad", size: 0.11, rarity: "uncommon", weight: 14, regions: ["alps"], speed: 0.9, active: "night", winter: false,
    build: { len: 0.6, leg: 0.13, body: 0.33, neck: 0.05, neckGirth: 0.7, rise: -1.15, head: 0.18, snout: 0.185, stance: 0.5, snoutUp: 0.08, dip: 0.5, curlIn: 1.3, ears: "cup", tail: "stub", tailLen: 0.1, hip: 1, extras: ["quills", "wet", "toes"], foot: "paw", sit: "lie", earLen: 0.95, snoutTip: 0.62, legR: 0.42, chest: 0.5, haunch: 0.6, eyeSet: [0.68, 0.45, 0.24], legMake: { fore: [1.5, 1.15, 1.05, 0.85], hind: [1.7, 1.15, 1.05, 0.85], hindBones: [0.6, 0.5] } },
    coats: [["brown", ["#c0a88e", "#5e3a26", "#dcc8a8", "#1c1410", "#5e4432"]], ["blond", ["#dccdb8", "#c4b698", "#f2e6c8", "#907068", "#c8ae98"]]],
    temper: { sniff: 2.6, dig: 1.6, coil: 1.2, wander: 1.4, sleep: 1, run: 0, graze: 0 }, friends: [] }),
  mouse: define({ label: "Field mouse", plan: "quad", size: 0.07, rarity: "common", weight: 30, regions: ALL_REGIONS, speed: 2.4, active: "night", groups: [5, 2, 2, 2], pack: [3, 4],
    build: { ...OUTLINE.murid, len: 1.02, leg: 0.3, body: 0.35, neck: 0.15, rise: 0.35, head: 0.25, snout: 0.24, ears: "round", tail: "thin", tailLen: 1.5, hip: 1.05, haunch: 1.2, chest: 0.85, sit: "haunch", earLen: 1.7, snoutTip: 0.28, tailRise: -0.7, legR: 0.8 },
    coats: [["field", ["#9a7a58", "#6a5038", "#efe2cc", "#1a120c", "#f0a8a8"]], ["grey", ["#7c7a78", "#55524f", "#d8d4cc", "#141210", "#f0a8a8"]]],
    temper: { sniff: 2.4, eat: 2, groom: 1.6, rear: 1.4, run: 1.4, wander: 1.2, graze: 0 }, friends: [] }),
  capybara: define({ label: "Capybara", plan: "quad", size: 0.5, rarity: "rare", weight: 9, regions: ["tokyo"], worlds: ["nature", "beach", "voxel"], speed: 0.6, groups: [3, 3, 3, 2], pack: [3, 4],
    build: { ...OUTLINE.cavy, len: 1.45, leg: 0.36, body: 0.38, neck: 0.2, rise: 0.35, head: 0.28, snout: 0.3, ears: "round", tail: "none", tailLen: 0.05, earLen: 0.55, snoutTip: 0.85, haunch: 1.1, legR: 1.2 },
    coats: [["capybara", ["#9a6c42", "#764e2c", "#a87c52", "#20140c", "#b88c62"]]],
    temper: { lie: 2.6, graze: 2, sit: 1.6, sleep: 1.6, look: 0.6, wander: 0.5, run: 0, roll: 0 }, friends: ["songbird", "parrot", "monkey"] }),
  kangaroo: define({ label: "Kangaroo", plan: "quad", size: 0.9, rarity: "rare", weight: 14, regions: ["sydney"], speed: 1.8, groups: [3, 2, 4, 2], pack: [3, 4],
    build: { ...OUTLINE.macropod, len: 0.95, leg: 0.75, body: 0.25, neck: 0.22, rise: 1.2, head: 0.13, snout: 0.18, ears: "long", tail: "thick", tailLen: 1.15, hip: 0.8, extras: ["pouch"], fore: 0.45, foot: "plant", sit: "haunch", haunch: 1.4, chest: 0.9, earLen: 0.55, snoutTip: 0.55, tailGirth: 1.1 },
    coats: [["red", ["#b06a3e", "#8a4e2a", "#e4cdb0", "#2a1a10", "#d8b898"]], ["grey", ["#8a8278", "#5e564e", "#d8d0c4", "#1e1a16", "#c8bcae"]]],
    temper: { graze: 1.8, rear: 2.6, groom: 1.2, hop: 2, look: 1.4, lie: 1, dig: 0, roll: 0 }, friends: [] }),
  tortoise: define({ label: "Tortoise", plan: "quad", size: 0.16, rarity: "rare", weight: 10, regions: ["nairobi"], worlds: ["nature", "beach", "voxel"], speed: 0.25, winter: false,
    build: { len: 0.8, leg: 0.27, body: 0.5, neck: 0.44, neckGirth: 0.28, neckEnd: 0.14, neckRoot: [-0.1, 0.56], rise: 0.5, head: 0.112, snout: 0.05, ears: "none", tail: "none", tailLen: 0.1, extras: ["shell"], foot: "plant", sit: "tuck", legR: 0.74, snoutTip: 0.9, chest: 0.5, haunch: 0.5, stance: 0.86, stoop: 0.16, foreBone: 0.48, legMake: { fore: [1, 0.92, 0.92, 0.72], hind: [1.02, 0.96, 0.96, 0.76], hindBones: [0.445, 0.445] } },
    coats: [["leopard", ["#b09f7e", "#d8c8a0", "#ece2c8", "#2a2212", "#3a3020"]], ["star", ["#b0a068", "#d8bc70", "#e4d6a0", "#141008", "#d8c47c"]]],
    temper: { graze: 2.4, bask: 2.6, sleep: 1.2, look: 0.6, wander: 0.8, run: 0, roll: 0, shake: 0, rear: 0, scratch: 0, groom: 0, stretch: 0, sit: 0 }, friends: ["songbird", "crab", "guineafowl"] }),
  meerkat: define({ label: "Meerkat", plan: "quad", size: 0.22, rarity: "rare", weight: 12, regions: [], speed: 1.8, groups: [1, 2, 3, 6], pack: [3, 6],
    build: { ...OUTLINE.viverrid, len: 1.05, leg: 0.36, body: 0.24, neck: 0.22, rise: 0.8, head: 0.19, snout: 0.2, ears: "round", tail: "thin", tailLen: 0.85, hip: 1, extras: ["mask"], sit: "haunch", earLen: 0.6, snoutTip: 0.4, tailRise: -0.2 },
    coats: [["meerkat", ["#b8966c", "#8a6c48", "#d8c4a4", "#1a120a", "#e8d8bc"]]],
    temper: { rear: 3.2, look: 2.4, dig: 2, groom: 1.4, bask: 1.2, run: 1, graze: 0 }, friends: [] }),
  squirrel: define({ label: "Squirrel", plan: "quad", size: 0.12, rarity: "common", weight: 60, regions: TEMPERATE, worlds: ["nature", "voxel", "crystal", "city"], speed: 2.2, climbs: true, groups: [6, 3, 1, 1], pack: [3, 3],
    build: { ...OUTLINE.rodent, len: 1, leg: 0.4, body: 0.32, neck: 0.08, rise: 0.8, head: 0.26, snout: 0.12, ears: "tuft", tail: "curl", tailLen: 1.25, hip: 1.18, fore: 0.85, haunch: 1.25, chest: 0.95, sit: "haunch", tailGirth: 1.3 },
    coats: [["red", ["#b8582a", "#8a3e1a", "#f0e4d4", "#24140a", "#f4ece0"]], ["grey", ["#86827c", "#5e5a54", "#e8e4dc", "#1c1a18", "#efe8de"]], ["black", ["#2a2624", "#181614", "#4a4440", "#0a0808", "#4a4440"]]],
    temper: { eat: 2.6, climb: 2.6, rear: 1.6, dig: 1.4, look: 1.4, run: 1.4, play: 1.4, graze: 0 }, friends: ["songbird", "woodpecker"] }),
  redpanda: define({ label: "Red panda", plan: "quad", size: 0.28, rarity: "epic", weight: 5, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [6, 2, 2, 0],
    build: { ...OUTLINE.mustelid, len: 1.12, leg: 0.45, body: 0.3, neck: 0.16, rise: 0.6, head: 0.26, snout: 0.12, ears: "point", tail: "ring", tailLen: 1.1, hip: 1.08, extras: ["cheeks", "muzzle", "socks"], foot: "plant", earLen: 0.85, snoutTip: 0.55, tailGirth: 1.2 },
    coats: [["red panda", ["#b84a1e", "#5a2210", "#1e1210", "#140a06", "#f4ece0"]]],
    temper: { climb: 2.4, eat: 2, sleep: 1.8, groom: 1.4, stretch: 1.2, rear: 1.2, roll: 0, graze: 0 }, friends: [] }),
  koala: define({ label: "Koala", plan: "quad", size: 0.3, rarity: "epic", weight: 7, regions: ["sydney"], speed: 0.4, climbs: true, groups: [7, 1, 3, 0],
    build: { ...OUTLINE.koala, len: 0.75, leg: 0.45, body: 0.4, neck: 0.08, rise: 1, head: 0.33, snout: 0.06, ears: "fluffy", tail: "none", tailLen: 0.05, hip: 1, extras: ["bignose"], foot: "plant", sit: "rump", earLen: 1.8, snoutTip: 0.9, legR: 1.2 },
    coats: [["koala", ["#8a8a8e", "#5e5e62", "#e8e6e2", "#1a1a1c", "#2a2a2c"]]],
    temper: { sleep: 3.4, eat: 2.2, climb: 1.4, look: 0.6, wander: 0.2, scratch: 1.2, run: 0, roll: 0 }, friends: [] }),
  macaque: define({ label: "Snow monkey", plan: "primate", size: 0.5, rarity: "rare", weight: 12, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [3, 3, 4, 3], pack: [3, 5],
    build: { len: 0.42, leg: 0.56, body: 0.2, neck: 0.06, head: 0.168, snout: 0.03, ears: "none", tail: "puff", tailLen: 0.13 },
    coats: [["snow", ["#96a2ae", "#4a4a56", "#e2e6e6", "#2a2018", "#a8565a"]]],
    temper: { groom: 3, sit: 2, eat: 1.6, look: 1.4, climb: 1.4, sleep: 1.2, hang: 0.4 }, friends: ["crow", "deer"] }),
  monkey: define({ label: "Long-tailed macaque", plan: "primate", size: 0.44, rarity: "uncommon", weight: 18, regions: ["bali", "nairobi"], worlds: ["nature", "beach", "voxel"], speed: 1.2, climbs: true, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { len: 0.58, leg: 0.64, body: 0.118, neck: 0.1, head: 0.122, snout: 0.05, ears: "round", tail: "thin", tailLen: 1.5 },
    coats: [["macaque", ["#8a7a5e", "#5e5038", "#c8b898", "#241c12", "#d8a088"]], ["vervet", ["#8a8c78", "#5a5c4a", "#e8e6dc", "#141410", "#2a2a2a"]]],
    temper: { climb: 2.4, hang: 1.6, groom: 2.2, eat: 1.8, play: 1.6, look: 1.2, scratch: 1.4 }, friends: ["parrot", "peacock", "guineafowl"] }),
  sloth: define({ label: "Sloth", plan: "primate", size: 0.45, rarity: "epic", weight: 4, regions: [], worlds: ["nature", "beach", "voxel"], speed: 0.12, climbs: true, groups: [9, 0, 2, 0],
    build: { len: 0.42, leg: 0.38, body: 0.155, neck: 0.1, head: 0.14, snout: 0.03, ears: "none", tail: "none", tailLen: 0.05, extras: ["mask", "claws"] },
    coats: [["sloth", ["#747a74", "#4a4438", "#5c6c48", "#241c14", "#dcd6c4"]]],
    temper: { hang: 4, sleep: 3, eat: 1.2, look: 0.8, climb: 0.6 }, friends: [] }),
  songbird: define({ label: "Songbird", plan: "bird", size: 0.13, rarity: "common", weight: 80, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "city", "beach"], speed: 1.4, groups: [5, 4, 2, 2], pack: [3, 5],
    build: { ...OUTLINE.passerine, bill: 0.36, len: 1, leg: 0.22, body: 0.27, neck: 0.1, rise: 0.4, head: 0.17, snout: 0.14, ears: "none", tail: "fan", tailLen: 0.38 },
    coats: [["robin", ["#6a5a4a", "#4a3e32", "#e2702e", "#141010", "#e8c048"]], ["bluebird", ["#3a6ad0", "#2a4a9a", "#e8945a", "#0e1220", "#2a2a2a"]], ["goldfinch", ["#f0d020", "#2a2a2a", "#f8e870", "#121212", "#e8a060"]], ["sparrow", ["#9a7a5a", "#5e4a36", "#d8ccb8", "#1a1410", "#3a3028"]]],
    temper: { sing: 2.6, peck: 2.2, hop: 2, preen: 1.6, look: 1.4, fly: 2.2 }, friends: ["deer", "rabbit", "bear", "capybara", "tortoise", "squirrel"] }),
  crow: define({ label: "Crow", plan: "bird", size: 0.24, rarity: "common", weight: 34, regions: ALL_REGIONS, worlds: ["nature", "voxel", "city", "synth", "crystal"], speed: 1.2, active: "day", groups: [5, 3, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.corvid, bill: 0.5, len: 1.15, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.3, head: 0.15, snout: 0.2, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["crow", ["#23262e", "#1b1e28", "#2e3038", "#08080a", "#2c3040"]], ["hooded", ["#66676c", "#1a1a1e", "#74757a", "#0a0a0c", "#2a2a2e"]]],
    temper: { peck: 2.4, look: 2, hop: 1.6, flap: 1.2, sing: 0.8, fly: 2 }, friends: ["deer", "cat", "wolf"] }),
  owl: define({ label: "Owl", plan: "bird", size: 0.3, rarity: "rare", weight: 10, regions: ["rockies", "atlantic", "alps", "tokyo", "nairobi"], worlds: ["nature", "voxel", "crystal", "city"], speed: 0.8, active: "night", groups: [8, 2, 2, 0],
    build: { ...OUTLINE.strigid, bill: 0.3, len: 0.9, leg: 0.26, body: 0.37, neck: 0.04, rise: 1.2, head: 0.25, snout: 0.06, ears: "tuft", tail: "fan", tailLen: 0.3 },
    coats: [["barn", ["#cab084", "#98938c", "#ffffff", "#4a2e18", "#b4804e"]], ["great horned", ["#8a6a4a", "#5a4430", "#b4703c", "#1e140c", "#fbf8f2"]], ["snowy", ["#e8edf6", "#c8d2e2", "#ebf0f9", "#2a2a2e", "#ffffff"]]],
    temper: { look: 3, preen: 1.6, sleep: 2, flap: 0.8, fly: 1.3, peck: 0, hop: 0, sing: 0 }, friends: ["crow"] }),
  parrot: define({ label: "Parrot", plan: "bird", size: 0.28, rarity: "rare", weight: 14, regions: ["bali", "sydney"], worlds: ["nature", "beach", "voxel", "vapor"], speed: 1, groups: [4, 4, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.psittacid, bill: 0.6, len: 1.2, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.9, head: 0.16, snout: 0.1, ears: "none", tail: "fan", tailLen: 0.9, extras: ["crest"] },
    coats: [["macaw", ["#e2282e", "#2a5ad8", "#f0d020", "#141414", "#3ab84a"]], ["cockatoo", ["#f8f8f4", "#e8e4d8", "#ffffff", "#2a2a2a", "#f8d830"]], ["lorikeet", ["#2ab84a", "#3a4ad8", "#f06a20", "#141414", "#e83030"]]],
    temper: { preen: 2.4, sing: 2, eat: 1.6, flap: 1.6, look: 1.2, hang: 0.8, fly: 1.6 }, friends: ["monkey", "kangaroo", "koala"] }),
  gull: define({ label: "Gull", plan: "bird", size: 0.32, rarity: "common", weight: 36, regions: ["atlantic", "sydney", "bali", "tokyo"], worlds: ["beach", "city", "nature"], speed: 1.2, groups: [4, 3, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.larid, bill: 0.36, len: 1.2, leg: 0.24, body: 0.19, neck: 0.12, rise: 0.4, head: 0.14, snout: 0.18, ears: "none", tail: "fan", tailLen: 0.36 },
    coats: [["herring", ["#f4f4f2", "#9aa4ae", "#ffffff", "#141414", "#f0c030"]], ["black-backed", ["#f4f4f2", "#2a2e34", "#ffffff", "#141414", "#f0c030"]]],
    temper: { look: 2, peck: 1.8, flap: 1.6, sing: 1.4, preen: 1.2, fly: 2.6 }, friends: ["crab"] }),
  peacock: define({ label: "Peacock", plan: "bird", size: 0.55, rarity: "epic", weight: 5, regions: ["bali"], speed: 0.7, groups: [5, 4, 2, 0],
    build: { ...OUTLINE.galliform, bill: 0.32, len: 1, leg: 0.3, body: 0.18, neck: 0.32, neckGirth: 0.5, rise: 1.1, head: 0.08, snout: 0.11, ears: "none", tail: "fan", tailLen: 1.7, extras: ["crown", "train"] },
    coats: [["indian", ["#1a5ad8", "#2a8a5a", "#1a4ab8", "#0a1020", "#e8c040"]], ["white", ["#f8f8f4", "#e8e8e2", "#ffffff", "#2a2a2a", "#f0f0ea"]]],
    temper: { display: 3, peck: 1.8, look: 1.4, preen: 1.2, wander: 1, fly: 0.3, sing: 0 }, friends: [] }),
  crane: define({ label: "Crane", plan: "bird", size: 0.85, rarity: "epic", weight: 6, regions: ["tokyo", "nairobi"], speed: 0.8, groups: [3, 6, 2, 0],
    build: { ...OUTLINE.gruid, bill: 0.3, len: 0.85, leg: 0.55, body: 0.16, neck: 0.55, rise: 1.2, head: 0.07, snout: 0.16, ears: "none", tail: "fan", tailLen: 0.3, extras: ["longneck", "crown"] },
    coats: [["red-crowned", ["#f6f6f2", "#1a1a1a", "#ffffff", "#141414", "#e02828"]], ["grey crowned", ["#8a9098", "#f4f4f0", "#a0a6ae", "#141414", "#e8c040"]]],
    temper: { display: 2.2, peck: 2, preen: 1.6, look: 1.4, flap: 1.2, fly: 1.2, wander: 1.2, hop: 0, sing: 0 }, friends: ["deer", "dikdik"] }),
  woodpecker: define({ label: "Woodpecker", plan: "bird", size: 0.18, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "alps", "tokyo"], speed: 1, groups: [8, 2, 1, 0],
    build: { ...OUTLINE.passerine, bill: 0.34, len: 1.1, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.6, head: 0.15, snout: 0.22, ears: "none", tail: "fan", tailLen: 0.5, extras: ["crest"] },
    coats: [["downy", ["#1e1e20", "#f4f4f0", "#f4f4f0", "#0e0e10", "#e02828"]], ["green", ["#6a8a3a", "#4a6a2a", "#c8d098", "#1a1a10", "#e02828"]]],
    temper: { drum: 4, look: 1.2, preen: 1, fly: 1.4, peck: 0, hop: 0, sing: 0 }, friends: ["squirrel"] }),
  snake: define({ label: "Snake", plan: "serpent", size: 1.1, rarity: "rare", weight: 9, regions: ["nairobi", "bali", "sydney", "rockies"], worlds: ["nature", "voxel", "beach"], speed: 0.35, winter: false, climbs: true,
    build: { len: 1, leg: 0, body: 0.034, neck: 0, rise: 0, head: 0.048, snout: 0.03, ears: "none", tail: "thin", tailLen: 0.3 },
    coats: [["green", ["#3a9a3a", "#1e6a22", "#c8e090", "#0e1a0a", "#e83030"]], ["corn", ["#e07a3a", "#b8401e", "#f4e0c0", "#2a120a", "#e83030"]], ["banded", ["#2a2a2a", "#f0e8d8", "#f0e8d8", "#0a0a0a", "#e83030"]]],
    temper: { bask: 2.6, coil: 2.2, flick: 2, climb: 1.4, look: 0.6, wander: 1 }, friends: [] }),
  gecko: define({ label: "Gecko", plan: "serpent", size: 0.16, rarity: "uncommon", weight: 18, regions: ["bali", "sydney", "nairobi"], worlds: ["nature", "voxel", "beach", "vapor", "synth"], speed: 1.2, winter: false, climbs: true, active: "any", groups: [6, 2, 1, 0],
    build: { len: 1, leg: 0.12, body: 0.08, neck: 0, rise: 0, head: 0.1, snout: 0.06, ears: "none", tail: "thin", tailLen: 0.45, extras: ["spots"] },
    coats: [["tokay", ["#7a8aa8", "#e88a3a", "#c8d0e0", "#141820", "#e88a3a"]], ["leaf", ["#5ab84a", "#e8c040", "#c8e8a0", "#0e1a0a", "#e86040"]], ["neon", ["#3af0e0", "#ff3ad8", "#c8fff8", "#0a0a14", "#ff3ad8"]]],
    temper: { bask: 2.4, climb: 2.4, flick: 1.6, look: 1.2, run: 1.2 }, friends: [] }),
  butterfly: define({ label: "Butterfly", plan: "bug", size: 0.09, rarity: "common", weight: 50, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "beach", "vapor"], speed: 1, winter: false, groups: [4, 4, 0, 2], pack: [3, 5],
    build: { len: 1, leg: 0, body: 0.08, neck: 0, rise: 0, head: 0.06, snout: 0, ears: "none", tail: "none", tailLen: 0 },
    coats: [["monarch", ["#f07a1a", "#1a1a1a", "#f8f4ec", "#0a0a0a", "#ffffff"]], ["morpho", ["#2a8af0", "#0a2a6a", "#7ad0ff", "#0a0a14", "#ffffff"]], ["swallowtail", ["#f0d84a", "#1a1a1a", "#f8f0b0", "#0a0a0a", "#3a6ad0"]], ["cabbage", ["#f6f4ea", "#2a2a2a", "#ffffff", "#141414", "#f6f4ea"]]],
    temper: { hover: 3, wander: 2, sit: 1.2 }, friends: [] }),
  firefly: define({ label: "Fireflies", plan: "bug", size: 0.035, rarity: "uncommon", weight: 30, regions: ["tokyo", "atlantic", "rockies", "bali"], worlds: ["nature", "voxel", "crystal"], speed: 0.5, winter: false, active: "night", groups: [0, 1, 0, 6], pack: [5, 9],
    build: { len: 1, leg: 0, body: 0.12, neck: 0, rise: 0, head: 0.08, snout: 0, ears: "none", tail: "none", tailLen: 0, extras: ["glowtail"] },
    coats: [["firefly", ["#3a3020", "#2a2418", "#4a4030", "#0a0806", "#d8ff5a"]]],
    temper: { hover: 3, wander: 2 }, friends: [] }),
  crab: define({ label: "Crab", plan: "crab", size: 0.12, rarity: "uncommon", weight: 40, regions: ["bali", "sydney", "atlantic", "tokyo", "nairobi"], worlds: ["beach", "vapor", "synth"], speed: 1, active: "any", groups: [4, 3, 1, 2], pack: [3, 4],
    build: { len: 1, leg: 0.5, body: 0.42, neck: 0, rise: 0, head: 0.1, snout: 0, ears: "none", tail: "none", tailLen: 0, extras: ["claws"] },
    coats: [["red", ["#d8402a", "#a8281a", "#f0c8a0", "#141010", "#f4f0e8"]], ["ghost", ["#e8d8b8", "#c8b890", "#f8f0dc", "#1a1610", "#ffffff"]], ["fiddler", ["#3a5ad0", "#e8c040", "#e8e0d0", "#0e0e14", "#ffffff"]]],
    temper: { wave: 2.4, dig: 1.8, wander: 2, look: 1.2 }, friends: ["gull", "tortoise"] }),
  // ---- local animals, so each region has its own cast (builds are first drafts from the shared parts)
  tanuki: define({ label: "Tanuki", plan: "quad", size: 0.3, rarity: "uncommon", weight: 16, regions: ["tokyo"], worlds: ["nature", "voxel", "city"], speed: 1, active: "night", groups: [4, 5, 3, 0],
    build: { ...OUTLINE.canid, taper: RUNNER_TAPER, len: 1.25, leg: 0.42, body: 0.36, neck: 0.16, rise: 0.55, head: 0.22, snout: 0.17, ears: "round", tail: "bushy", tailLen: 0.55, hip: 1.02, extras: ["mask"], foot: "paw", sit: "dog", tailGirth: 1.2, tailRise: -0.4 },
    coats: [["tanuki", ["#8a6c4a", "#4a3828", "#c8b08c", "#1a120c", "#e8dcc4"]], ["winter", ["#9a8060", "#5a4430", "#d8c4a4", "#1e140c", "#f0e6d4"]]],
    temper: { sniff: 2.2, dig: 1.6, eat: 1.4, sleep: 1.4, groom: 1.4, wander: 1.3, look: 1.2, graze: 0, run: 0.4 }, friends: ["crow"] }),
  marmot: define({ label: "Marmot", plan: "quad", size: 0.26, rarity: "uncommon", weight: 18, regions: ["alps", "rockies"], speed: 1, winter: false, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { ...OUTLINE.rodent, len: 1.15, leg: 0.36, body: 0.38, neck: 0.2, rise: 0.6, head: 0.23, snout: 0.15, ears: "round", tail: "bushy", tailLen: 0.5, tailGirth: 0.6, hip: 1.05, foot: "plant", sit: "haunch", haunch: 1.15, snoutTip: 0.6, earLen: 0.7, extras: ["muzzle"] },
    coats: [["alpine", ["#8a6e4e", "#5e4a34", "#c8a878", "#1e160e", "#e8dcc8"]], ["yellow-bellied", ["#7a6450", "#4e3e30", "#d8a850", "#1a140e", "#efe4cc"]]],
    temper: { rear: 3, bask: 2, graze: 2, look: 2, groom: 1.2, dig: 1.4, run: 1.2, sleep: 1, wander: 0.8 }, friends: ["crow"] }),
  badger: define({ label: "Badger", plan: "quad", size: 0.3, rarity: "rare", weight: 9, regions: ["alps"], speed: 0.9, active: "night", groups: [5, 3, 3, 0],
    build: { ...OUTLINE.mustelid, len: 1.35, leg: 0.34, body: 0.4, neck: 0.15, rise: 0.35, head: 0.2, snout: 0.24, ears: "round", tail: "puff", tailLen: 0.22, hip: 1, extras: ["mask", "stripes"], foot: "plant", sit: "lie", snoutTip: 0.35, earLen: 0.6 },
    coats: [["badger", ["#9a9a98", "#2a2a2a", "#2a2826", "#121212", "#f4f4f0"]]],
    temper: { dig: 3, sniff: 2.4, groom: 1.2, sleep: 1.2, wander: 1.3, roll: 0.5, graze: 0, sit: 0.4, run: 0.3 }, friends: [] }),
  skunk: define({ label: "Skunk", plan: "quad", size: 0.2, rarity: "uncommon", weight: 12, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", groups: [7, 1, 3, 0],
    build: { ...OUTLINE.mustelid, len: 1.12, leg: 0.4, body: 0.38, neck: 0.12, rise: 0.5, head: 0.22, snout: 0.2, ears: "round", tail: "bushy", tailLen: 1.1, hip: 1.12, extras: ["stripes"], foot: "plant", sit: "haunch", tailGirth: 1.4, tailRise: 0.6, snoutTip: 0.4 },
    coats: [["striped", ["#1a1a1c", "#f4f4f0", "#2a2a2c", "#0a0a0a", "#f4f4f0"]]],
    temper: { dig: 2.4, sniff: 2.4, groom: 1, wander: 1.2, graze: 0, run: 0.2, look: 0.8 }, friends: [] }),
  possum: define({ label: "Brushtail possum", plan: "quad", size: 0.26, rarity: "uncommon", weight: 14, regions: ["sydney"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", climbs: true, groups: [7, 2, 3, 0],
    build: { ...OUTLINE.viverrid, len: 1.3, leg: 0.42, body: 0.32, neck: 0.14, rise: 0.6, head: 0.22, snout: 0.16, ears: "point", tail: "bushy", tailLen: 1.1, hip: 1.05, foot: "plant", sit: "haunch", earLen: 1.2, tailGirth: 0.9, tailRise: -0.3 },
    coats: [["brushtail", ["#8a8a88", "#5a5a58", "#e8e4dc", "#1a1a1a", "#2a2624"]], ["copper", ["#9a6a4a", "#6a4430", "#e8d8c4", "#1e140c", "#2a1a10"]]],
    temper: { climb: 2.8, eat: 2.2, sit: 1.4, look: 1.6, sleep: 1.2, groom: 1.4, graze: 0, run: 0.4 }, friends: ["koala"] }),
  kookaburra: define({ label: "Kookaburra", plan: "bird", size: 0.36, rarity: "uncommon", weight: 16, regions: ["sydney"], worlds: ["nature", "voxel", "city", "beach"], speed: 1, groups: [3, 4, 3, 3], pack: [3, 5],
    build: { ...OUTLINE.passerine, bill: 0.55, len: 1, leg: 0.18, body: 0.24, neck: 0.08, rise: 0.5, head: 0.24, snout: 0.4, ears: "none", tail: "fan", tailLen: 0.55 },
    coats: [["laughing", ["#e2d6c0", "#6a5034", "#f4eee2", "#2a2018", "#4a7ab8"]]],
    temper: { sing: 3, look: 2.6, preen: 1.2, fly: 1.4, peck: 0.6, hop: 0.3 }, friends: ["kangaroo"] }),
  mongoose: define({ label: "Banded mongoose", plan: "quad", size: 0.18, rarity: "uncommon", weight: 16, regions: ["nairobi"], speed: 1.8, groups: [1, 2, 2, 7], pack: [4, 7],
    build: { ...OUTLINE.viverrid, len: 1.3, leg: 0.36, body: 0.26, neck: 0.2, rise: 0.6, head: 0.18, snout: 0.22, ears: "round", tail: "thin", tailLen: 0.9, hip: 1, extras: ["stripes"], foot: "paw", sit: "haunch", snoutTip: 0.35, earLen: 0.6 },
    coats: [["banded", ["#7a6e5e", "#4a4034", "#a89a84", "#1a1610", "#c8bca4"]]],
    temper: { rear: 2.2, dig: 2.4, sniff: 2.4, look: 1.6, groom: 1.6, run: 1.4, play: 1.4, bask: 1, graze: 0 }, friends: ["guineafowl"] }),
  dikdik: define({ label: "Dik-dik", plan: "quad", size: 0.4, rarity: "rare", weight: 12, regions: ["nairobi"], speed: 1.2, groups: [3, 7, 2, 0],
    build: { ...OUTLINE.cervid, len: 1, leg: 0.75, body: 0.2, neck: 0.4, rise: 0.95, head: 0.15, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.12, foot: "hoof", sit: "lie", legR: 0.6, earLen: 1.2, snoutTip: 0.5 },
    coats: [["kirk", ["#a08468", "#7a6048", "#e8dccb", "#241a12", "#f4ece0"]]],
    temper: { graze: 2.4, look: 2.4, groom: 1, lie: 1.4, run: 0.6, sit: 0, dig: 0, roll: 0 }, friends: ["guineafowl", "songbird"] }),
  guineafowl: define({ label: "Guineafowl", plan: "bird", size: 0.5, rarity: "uncommon", weight: 14, regions: ["nairobi"], speed: 1, groups: [1, 2, 1, 8], pack: [4, 7],
    build: { ...OUTLINE.galliform, bill: 0.38, len: 1, leg: 0.3, body: 0.25, neck: 0.24, rise: 0.8, head: 0.1, snout: 0.08, ears: "none", tail: "fan", tailLen: 0.24, extras: ["spots", "crown"] },
    coats: [["helmeted", ["#4a4e5c", "#3a3e4a", "#5e6270", "#101216", "#5a8ae0"]]],
    temper: { peck: 3, wander: 2, look: 1.4, preen: 1, sing: 1, fly: 0.3, hop: 0.3 }, friends: ["dikdik", "mongoose"] }),
  loris: define({ label: "Slow loris", plan: "primate", size: 0.24, rarity: "epic", weight: 6, regions: ["bali"], worlds: ["nature", "beach", "voxel"], speed: 0.15, active: "night", climbs: true, groups: [8, 1, 2, 0],
    build: { len: 0.6, leg: 0.4, body: 0.24, neck: 0.08, head: 0.18, snout: 0.05, ears: "round", tail: "none", tailLen: 0.05, extras: ["mask"] },
    coats: [["javan", ["#b89a78", "#8a6c4e", "#e8d8c0", "#3a2416", "#f4ecdc"]]],
    temper: { hang: 2.4, climb: 2.4, eat: 1.6, sleep: 2.4, look: 1.2, groom: 1.4, wander: 0.2 }, friends: [] }),
} as const satisfies Record<string, SpeciesSpec>;

export const WING: WingStyle = { rate: 14, span: 0.7, chord: 0.2, fingers: 0, top: "alt", trail: "alt", tip: "alt", fold: ["alt", "alt"], glide: 0.25, bout: 2, bound: false, dihedral: 0.06, tail: "alt" };
export const WINGS: Partial<Record<SpeciesId, WingStyle>> = {
  songbird: { ...WING, rate: 28, span: 0.62, chord: 0.21, glide: 0, bout: 0.75, bound: true, dihedral: 0.04 },
  woodpecker: { ...WING, rate: 24, span: 0.66, chord: 0.21, top: "coat", trail: "alt", tip: "coat", fold: ["coat", "alt"], glide: 0, bout: 1.1, bound: true, tail: "coat", spots: "belly" },
  parrot: { ...WING, rate: 19, span: 0.72, chord: 0.17, trail: "coat", fold: ["coat", "alt"], glide: 0.12, bout: 1.6 },
  crow: { ...WING, rate: 12, span: 0.86, chord: 0.24, fingers: 4, top: "alt", trail: "accent", tip: "alt", fold: ["alt", "alt"], glide: 0.4, bout: 3.2, dihedral: 0.1 },
  owl: { ...WING, rate: 8, span: 0.92, chord: 0.32, top: "coat", fold: ["coat", "alt"], glide: 0.6, bout: 2.6, dihedral: 0.02 },
  gull: { ...WING, rate: 7.5, span: 1.08, chord: 0.2, fingers: 4, trail: "belly", tip: "dark", fold: ["alt", "dark"], glide: 0.75, bout: 4.5, dihedral: 0.14 },
  peacock: { ...WING, rate: 12, span: 0.5, chord: 0.24, glide: 0.35, bout: 1.4 },
  crane: { ...WING, rate: 5, span: 1.1, chord: 0.2, fingers: 4, top: "coat", tip: "coat", fold: ["coat", "alt"], glide: 0.35, bout: 5, dihedral: 0.08 },
  kookaburra: { ...WING, rate: 17, span: 0.66, chord: 0.23, glide: 0.3, bout: 1.6 },
  guineafowl: { ...WING, rate: 20, span: 0.5, chord: 0.27, top: "coat", fold: ["coat", "coat"], glide: 0.45, bout: 1.2 },
};
