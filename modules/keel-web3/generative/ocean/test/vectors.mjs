/** Deterministic test vectors for ocean. Run by `keel module test`. */
const near = (a, b, within) => Math.abs(a - b) < within;

export default [
  {
    name: "the same seed makes the same sea",
    run: ({ createSea }) => createSea({ seed: 7 }).surfaceAt(3, 4, 5).height === createSea({ seed: 7 }).surfaceAt(3, 4, 5).height,
    expect: true,
  },
  {
    name: "different seeds make different seas",
    run: ({ createSea }) => createSea({ seed: 7 }).surfaceAt(3, 4, 5).height !== createSea({ seed: 8 }).surfaceAt(3, 4, 5).height,
    expect: true,
  },
  {
    name: "every wave keeps deep water's dispersion",
    run: ({ wavesOf }) => wavesOf({ seed: 3, wind: 9 }).every((wave) => near(wave.omega, Math.sqrt(9.81 * wave.k), 1e-9)),
    expect: true,
  },
  {
    name: "a stronger wind raises taller waves",
    run: ({ wavesOf }) => {
      const tallest = (wind) => Math.max(...wavesOf({ seed: 3, wind }).map((wave) => wave.amp));
      return tallest(15) > tallest(7) && tallest(7) > tallest(2);
    },
    expect: true,
  },
  {
    name: "crests never loop over themselves",
    run: ({ wavesOf }) => {
      for (const wind of [2, 7, 15, 30]) {
        const waves = wavesOf({ seed: 5, wind });
        if (waves.reduce((sum, wave) => sum + wave.q * wave.k * wave.amp, 0) > 0.83) return false;
      }
      return true;
    },
    expect: true,
  },
  {
    name: "surfaceAt answers for the exact point asked about",
    run: ({ createSea }) => {
      const sea = createSea({ seed: 11, wind: 12 });
      for (let i = 0; i < 40; i += 1) {
        const x = i * 7.3;
        const z = -i * 3.1;
        const t = i * 0.7;
        const { height } = sea.surfaceAt(x, z, t);
        // Walk the water back to the column above (x, z): the displaced point there must match.
        let sx = x;
        let sz = z;
        for (let round = 0; round < 40; round += 1) {
          const moved = sea.displace(sx, sz, t);
          sx += x - moved[0];
          sz += z - moved[2];
        }
        if (!near(sea.displace(sx, sz, t)[1], height, 0.002)) return false;
      }
      return true;
    },
    expect: true,
  },
  {
    name: "the surface normal is a unit vector pointing up",
    run: ({ createSea }) => {
      const { normal } = createSea({ seed: 2, wind: 15 }).surfaceAt(10, 20, 30);
      return near(Math.hypot(...normal), 1, 1e-9) && normal[1] > 0;
    },
    expect: true,
  },
  {
    name: "the wave packing carries eight floats a wave",
    run: ({ createSea }) => {
      const sea = createSea({ seed: 2, count: 5 });
      return [sea.packed.length, near(sea.packed[2], sea.waves[0].k, 1e-5)];
    },
    expect: [40, true],
  },
  {
    name: "the floor lies under still water",
    run: ({ createSea }) => {
      const sea = createSea({ seed: 4, depth: 22, relief: 9 });
      for (let i = 0; i < 200; i += 1) if (sea.seabedAt(i * 13, i * -9) >= 0) return false;
      return true;
    },
    expect: true,
  },
  {
    name: "a sea takes any ground for its floor",
    run: ({ createSea }) => createSea({ seed: 4, ground: (x) => x - 50 }).seabedAt(30, 0),
    expect: -20,
  },
  {
    name: "waves shrink over shallow ground and stay whole over deep",
    run: ({ createSea, shoalOf }) => {
      const open = createSea({ seed: 4, wind: 9 });
      const shore = createSea({ seed: 4, wind: 9, ground: () => -0.3 });
      const range = (sea) => { let most = 0; for (let t = 0; t < 40; t += 0.5) most = Math.max(most, Math.abs(sea.surfaceAt(3, 3, t).height)); return most; };
      return [range(shore) < range(open), shoalOf(0.1, 100), shoalOf(4, 0) < shoalOf(0.1, 0)];
    },
    expect: [true, 1, true],
  },
  {
    name: "a crest is thrown up the shore only where it breaks",
    run: ({ surfThrow }) => {
      const most = (depth) => { let top = 0; for (let t = 0; t < 30; t += 0.05) top = Math.max(top, surfThrow(depth, 4, 9, t, 7)); return top; };
      return [most(1.5) > 0.8, most(6) === 0, most(0.2) === 0];
    },
    expect: [true, true, true],
  },
  {
    name: "a lip is thrown further in a stronger wind",
    run: ({ surfThrow }) => Math.abs(surfThrow(1.5, 4, 9, 3, 14) - surfThrow(1.5, 4, 9, 3, 7) * 2) < 1e-9,
    expect: true,
  },
  {
    name: "surf crashes in the last metres and nowhere else",
    run: ({ surfBurst }) => {
      const most = (depth) => { let top = 0; for (let t = 0; t < 30; t += 0.05) top = Math.max(top, surfBurst(depth, 4, 9, t)); return top; };
      return [most(1) > 0.5, most(1) <= 1, most(4) === 0, most(0.1) === 0];
    },
    expect: [true, true, true, true],
  },
  {
    name: "surf is nothing in deep water and builds near the shore",
    run: ({ surfAt }) => {
      let shallow = 0;
      for (let t = 0; t < 30; t += 0.1) shallow = Math.max(shallow, surfAt(1.5, 4, 9, t, 7));
      let deep = 0;
      for (let t = 0; t < 30; t += 0.1) deep = Math.max(deep, surfAt(12, 4, 9, t, 7));
      return [deep, shallow > 0.2];
    },
    expect: [0, true],
  },
  {
    name: "swash runs up and drains away",
    run: ({ surfAt }) => {
      const heights = Array.from({ length: 90 }, (_, i) => surfAt(-0.2, 4, 9, i * 0.1, 7));
      return Math.max(...heights) - Math.min(...heights) > 0.2;
    },
    expect: true,
  },
  {
    name: "a stronger sea breaks harder",
    run: ({ surfAt }) => Math.abs(surfAt(1.5, 4, 9, 3, 14) - surfAt(1.5, 4, 9, 3, 7) * 2) < 1e-9 && surfAt(1.5, 4, 9, 3, 7) > 0,
    expect: true,
  },
  {
    name: "the tide lifts the water",
    run: ({ createSea }) => {
      const sea = createSea({ seed: 4 });
      return Math.abs(sea.surfaceAt(5, 5, 3, 1.5).height - sea.surfaceAt(5, 5, 3, 0).height - 1.5) < 1e-9;
    },
    expect: true,
  },
  {
    name: "high and low water come 6 h 13 min apart",
    run: ({ tideTimes, TIDE_PERIOD }) => {
      const turns = tideTimes(1, { offset: 0 }, 3);
      return [turns.map((turn) => turn.kind), Math.abs(turns[1].at - turns[0].at - TIDE_PERIOD / 2) < 1e-9, turns[0].at > 1];
    },
    expect: [["low", "high", "low"], true, true],
  },
  {
    name: "the clock's tide is highest at its high water and lowest at its low",
    run: ({ tideOn, TIDE_PERIOD }) => tideOn(0) > tideOn(TIDE_PERIOD / 4) && tideOn(TIDE_PERIOD / 4) > tideOn(TIDE_PERIOD / 2),
    expect: true,
  },
  {
    name: "the wave orbit fades with depth",
    run: ({ createSea }) => {
      const sea = createSea({ seed: 4, wind: 10 });
      const speed = (y) => Math.hypot(...sea.currentAt(5, y, 5, 3));
      return speed(-60) < speed(-1);
    },
    expect: true,
  },
  {
    name: "the tide is high with the moon overhead and low on the horizon",
    run: ({ tideAt }) => [tideAt({ moon: 90, sun: 90, range: 2 }), tideAt({ moon: 0, sun: 0, range: 2 })],
    expect: [1, -0.5],
  },
  {
    name: "a moon underfoot heaps the water as high as one overhead",
    run: ({ tideAt }) => tideAt({ moon: -90, sun: 0 }) === tideAt({ moon: 90, sun: 0 }),
    expect: true,
  },
  {
    name: "depth zones change at 200 m and 1000 m",
    run: ({ zoneAt }) => [zoneAt(199), zoneAt(200), zoneAt(999), zoneAt(1000)],
    expect: ["sunlit", "twilight", "twilight", "midnight"],
  },
  {
    name: "red dies first and nothing is lost over no water",
    run: ({ lightThrough }) => {
      const deep = lightThrough(20);
      return [deep[0] < deep[1] && deep[1] < deep[2], lightThrough(0), lightThrough(-5)];
    },
    expect: [true, [1, 1, 1], [1, 1, 1]],
  },
];
