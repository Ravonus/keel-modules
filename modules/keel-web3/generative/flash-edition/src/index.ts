/** Deterministic Flash edition traits backed by Keel's seeded-random module. MIT. */

export type SeededRandom = () => number;

/** The exact API supplied by the reusable `seeded-random` module. */
export interface SeededRandomModule {
  readonly createSeededRandom: (hexSeed: string) => SeededRandom;
  readonly randomInt: (random: SeededRandom, minimum: number, maximum: number) => number;
}

export interface FlashEditionTraits {
  /** Canonical 32-byte hexadecimal seed for the artwork runtime. */
  readonly seedHex: `0x${string}`;
  /** Palette index in the shared Ghost Circuit palette. */
  readonly paletteIndex: number;
  /** Motion rate in radians per frame. */
  readonly motion: number;
  /** Endpoint pull toward the pointer. */
  readonly attraction: number;
  /** Signed gravity bias applied to the arm midpoint. */
  readonly gravity: number;
  /** Arm length in stage pixels. */
  readonly length: number;
  /** Arm bend amplitude in stage pixels. */
  readonly bend: number;
}

const HEX_SEED = /^0x[0-9a-f]{64}$/u;

function requireSeed(value: string, label: string): `0x${string}` {
  if (typeof value !== "string" || !HEX_SEED.test(value)) {
    throw new RangeError(`${label} must be a canonical 32-byte hexadecimal seed.`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function requireRandomModule(value: SeededRandomModule): SeededRandomModule {
  if (typeof value !== "object" || value === null ||
      typeof value.createSeededRandom !== "function" || typeof value.randomInt !== "function") {
    throw new TypeError("flash-edition requires the Keel seeded-random module.");
  }
  return value;
}

function wordHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function randomWord(random: SeededRandom): number {
  return Math.floor(random() * 0x1_0000_0000) >>> 0;
}

/**
 * Derive a preview token seed from a collection root seed.
 *
 * Production viewers should prefer `context.derivedTokenSeed` from
 * KeelSeedRegistry. This fallback exists for the local playground, where a
 * persisted random root seed is expanded with the same global module.
 */
export function deriveTokenSeed(
  rootSeedHex: string,
  tokenId: number,
  randomModule: SeededRandomModule,
): `0x${string}` {
  const rootSeed = requireSeed(rootSeedHex, "rootSeedHex");
  requireRandomModule(randomModule);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 111) {
    throw new RangeError("tokenId must be an integer from 1 through 111.");
  }
  const random = randomModule.createSeededRandom(rootSeed);
  let words: number[] = [];
  for (let index = 1; index <= tokenId; index += 1) {
    words = Array.from({ length: 8 }, () => randomWord(random));
  }
  return `0x${words.map(wordHex).join("")}` as `0x${string}`;
}

/**
 * Derive a replayable Flash trait set from a canonical token seed.
 *
 * @param tokenSeedHex Canonical 32-byte seed from KeelSeedRegistry or the
 * local `deriveTokenSeed` fallback.
 * @param tokenId One-based token id.
 * @param randomModule The separately committed Keel seeded-random module.
 * @returns Immutable deterministic traits and the canonical runtime seed.
 * @throws RangeError when tokenId is not in the collection range.
 */
export function deriveFlashEdition(
  tokenSeedHex: string,
  tokenId: number,
  randomModule: SeededRandomModule,
): FlashEditionTraits {
  const tokenSeed = requireSeed(tokenSeedHex, "tokenSeedHex");
  requireRandomModule(randomModule);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 111) {
    throw new RangeError("tokenId must be an integer from 1 through 111.");
  }
  const random = randomModule.createSeededRandom(tokenSeed);
  return Object.freeze({
    seedHex: tokenSeed,
    paletteIndex: randomModule.randomInt(random, 0, 5),
    motion: 0.007 + random() * 0.016,
    attraction: 0.08 + random() * 0.16,
    gravity: -0.18 + random() * 0.36,
    length: 130 + random() * 210,
    bend: 40 + random() * 100,
  });
}
