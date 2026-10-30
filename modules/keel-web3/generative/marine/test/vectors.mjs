/** Deterministic test vectors for marine. Run by `keel module test`. */

// A flat stand-in for generative/ocean: still water at 0, a floor at -30.
const sea = {
  surfaceAt: () => ({ height: 0 }),
  seabedAt: () => -30,
  displace: (x, z) => [x, 0, z],
};

const inWater = (swimmer) => swimmer.at[1] < 0 && swimmer.at[1] > -30;
const unitLength = (v) => Math.abs(Math.hypot(...v) - 1) < 1e-9;

export default [
  {
    name: "the same seed casts the same sea",
    run: ({ castFor }) => JSON.stringify(castFor({ seed: 5, sea })) === JSON.stringify(castFor({ seed: 5, sea })),
    expect: true,
  },
  {
    name: "a sunlit sea gets a school, a shark and jellies",
    run: ({ castFor }) => castFor({ seed: 5, sea }).companies.map((company) => company.id),
    expect: ["sardine", "shark", "jelly"],
  },
  {
    name: "a zone only gets what lives in it",
    run: ({ castFor }) => castFor({ seed: 5, sea, zone: "twilight" }).companies.map((company) => company.id),
    expect: ["jelly"],
  },
  {
    name: "a moment does not depend on what was asked before it",
    run: ({ castFor, createSwim }) => {
      const cast = castFor({ seed: 9, sea });
      const fresh = JSON.stringify(createSwim(cast, sea).at(41.5));
      const used = createSwim(cast, sea);
      used.at(900);
      used.at(2);
      return JSON.stringify(used.at(41.5)) === fresh;
    },
    expect: true,
  },
  {
    name: "everyone stays in the water with a unit heading",
    run: ({ castFor, createSwim }) => {
      const swim = createSwim(castFor({ seed: 3, sea }), sea);
      for (let t = 0; t < 300; t += 37) {
        if (!swim.at(t).every((swimmer) => inWater(swimmer) && unitLength(swimmer.front))) return false;
      }
      return true;
    },
    expect: true,
  },
  {
    name: "the school opens a hole round its shark",
    run: ({ castFor, createSwim }) => {
      const swim = createSwim(castFor({ seed: 3, sea, center: [0, 0] }), sea);
      for (let t = 0; t < 400; t += 3) {
        const all = swim.at(t);
        const shark = all.find((swimmer) => swimmer.id === "shark");
        const nearest = Math.min(...all.filter((swimmer) => swimmer.id === "sardine").map((fish) => Math.hypot(fish.at[0] - shark.at[0], fish.at[1] - shark.at[1], fish.at[2] - shark.at[2])));
        if (nearest < 1) return false;
      }
      return true;
    },
    expect: true,
  },
  {
    name: "the school holds together",
    run: ({ castFor, createSwim }) => {
      const fish = createSwim(castFor({ seed: 3, sea }), sea).at(120).filter((swimmer) => swimmer.id === "sardine");
      const middle = [0, 1, 2].map((axis) => fish.reduce((sum, one) => sum + one.at[axis], 0) / fish.length);
      return Math.max(...fish.map((one) => Math.hypot(one.at[0] - middle[0], one.at[1] - middle[1], one.at[2] - middle[2]))) < 14;
    },
    expect: true,
  },
  {
    name: "every species poses into a body with every role on its palette",
    run: ({ SPECIES_IDS, poseSwimmer }) => SPECIES_IDS.every((id) => {
      const body = poseSwimmer({ id, index: 0, at: [0, -5, 0], front: [0, 0, 1], phase: 1, build: 1, seed: 1 });
      return body.capsules.length > 0 && body.capsules.length <= 48 && body.capsules.every((part) => body.palette[part.role] !== undefined);
    }),
    expect: true,
  },
  {
    name: "a fish's tail swings and its head holds still",
    run: ({ poseSwimmer }) => {
      const pose = (phase) => poseSwimmer({ id: "shark", index: 0, at: [0, 0, 0], front: [0, 0, 1], phase, build: 1, seed: 1 }).capsules[0].a[0];
      const tail = (phase) => poseSwimmer({ id: "shark", index: 0, at: [0, 0, 0], front: [0, 0, 1], phase, build: 1, seed: 1 }).capsules[5].b[0];
      return [Math.abs(pose(1) - pose(3)) < 1e-9, Math.abs(tail(1) - tail(3)) > 0.05];
    },
    expect: [true, true],
  },
  {
    name: "a rest pose is straight whatever the moment",
    run: ({ poseSwimmer }) => {
      const body = (phase) => JSON.stringify(poseSwimmer({ id: "sardine", index: 0, at: [0, 0, 0], front: [0, 0, 1], phase, build: 1, seed: 1 }, { rest: true }).capsules);
      return body(1) === body(2);
    },
    expect: true,
  },
  {
    name: "an unknown species says so",
    run: ({ poseSwimmer }) => {
      try {
        poseSwimmer({ id: "kraken", index: 0, at: [0, 0, 0], front: [0, 0, 1], phase: 0, build: 1, seed: 1 });
        return "no error";
      } catch (error) {
        return error.message;
      }
    },
    expect: 'marine: no species "kraken"',
  },
];
