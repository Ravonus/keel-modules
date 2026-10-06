/** Deterministic vectors for the Flash edition module. */

function createSeededRandom(hexSeed) {
  const clean = String(hexSeed).replace(/^0x/u, "").padEnd(64, "0").slice(0, 64);
  const words = (index) => (
    (Number.parseInt(clean.slice(index * 8, index * 8 + 8), 16) >>> 0) ^
    (Number.parseInt(clean.slice((index + 4) * 8, (index + 5) * 8), 16) >>> 0)
  ) >>> 0;
  let [a, b, c, d] = [0, 1, 2, 3].map(words);
  if ((a | b | c | d) === 0) d = 1;
  return () => {
    const result = Math.imul(((b * 5) >>> 0), 0x7fffffff) >>> 0;
    const value = (((result << 7) | (result >>> 25)) * 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    return value / 0x1_0000_0000;
  };
}

const randomModule = {
  createSeededRandom,
  randomInt: (random, minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1)),
};

const ROOT_SEED = "0x957fae940b0a63c139b65a7c75adc164391dd6a68053c7e37344595f7afc7620";

export default [
  {
    name: "token 7 has a stable token seed and trait vector",
    run: ({ deriveTokenSeed, deriveFlashEdition }) => {
      const tokenSeed = deriveTokenSeed(ROOT_SEED, 7, randomModule);
      return deriveFlashEdition(tokenSeed, 7, randomModule);
    },
    expect: {
      seedHex: "0xfb4597f45168cbe42800c0d5fb292f876a0eef6a9ea1b40f3c9cb09273a5df84",
      paletteIndex: 4,
      motion: 0.012157742939889431,
      attraction: 0.1673027704283595,
      gravity: 0.16327233969233929,
      length: 279.73824897781014,
      bend: 41.34777438361198,
    },
  },
  {
    name: "token id changes the canonical seed",
    run: ({ deriveTokenSeed }) => deriveTokenSeed(ROOT_SEED, 8, randomModule),
    expect: "0xf71a62bf4538d110980c2106b11c1020f4983c3e3ee479419b0b02c1e3aa7b15",
  },
  {
    name: "invalid token ids fail closed",
    run: ({ deriveTokenSeed }) => {
      try {
        deriveTokenSeed(ROOT_SEED, 0, randomModule);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];
