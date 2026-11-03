/** Deterministic test vectors for look. Run by `keel module test`. keel-engine core's resolveLook holds the same cases. */
import { readFileSync } from "node:fs";

const CASES = JSON.parse(readFileSync(new URL("./look-cases.json", import.meta.url), "utf8"));

export default [
  ...CASES.map((c) => ({ name: `shared: ${c.name}`, run: ({ resolveLook }) => resolveLook(c.recipe, c.target), expect: c.expect })),
  {
    name: "a pixel look goes to voxel-dither as it is, with a small target's limits beside it",
    run: ({ resolveLook, stageOfLook, LOOK_TARGETS }) => {
      const recipe = { format: "keel-look@1", pixel: { style: "chunky", outline: 0.5 } };
      const big = stageOfLook(resolveLook(recipe, LOOK_TARGETS.native));
      const gb = stageOfLook(resolveLook(recipe, LOOK_TARGETS["game-boy"]));
      return [big.dither, big.toneMapping, big.trees, big.finish, gb.dither];
    },
    expect: [{ style: "chunky", outline: 0.5 }, null, {}, null, { style: "chunky", outline: 0.5, screen: "bayer2", limit: { levels: 2, colours: 4 } }],
  },
  {
    name: "realism draws straight (or through its grade), denser, with real blades and bark",
    run: ({ resolveLook, stageOfLook, LOOK_TARGETS }) => {
      const plain = stageOfLook(resolveLook({ format: "keel-look@1", realism: { tonemap: "aces", density: 3 } }, LOOK_TARGETS.lit));
      const graded = stageOfLook(resolveLook({ format: "keel-look@1", realism: { grade: { screen: "bayer8", amount: 0.2 } } }, LOOK_TARGETS.lit));
      return [plain.dither, plain.toneMapping, plain.density, plain.trees, plain.finish, graded.dither, graded.toneMapping];
    },
    expect: [null, "aces-filmic", 3, { form: "smooth", features: { sprays: false, clumps: false, rootSink: false } }, { exposure: 1, tonemap: "aces", ao: 0.7 }, { screen: "bayer8", amount: 0.2 }, "neutral"],
  },
  {
    name: "anything that isn't a keel-look@1 recipe is refused by name",
    run: ({ checkLookRecipe }) => [{ format: "keel-look@2" }, { format: "keel-look@1", pixel: { glow: 1 } }, { format: "keel-look@1", realism: { ao: 3 } }].map((r) => {
      try { checkLookRecipe(r); return "ok"; } catch (e) { return e.message.split(" ")[0]; }
    }),
    expect: ["A", "look.pixel.glow", "look.realism.ao"],
  },
];
