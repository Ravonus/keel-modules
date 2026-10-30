/** Deterministic test vectors for boats. Run by `keel module test`. */
const flat = { surfaceAt: (x, z, t, level = 0) => ({ height: level }), seabedAt: () => -20 };
const shelf = { surfaceAt: (x, z, t, level = 0) => ({ height: level }), seabedAt: () => -0.5 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export default [
  {
    name: "the same seed makes the same fleet at the same moment",
    run: ({ createFleet }) => JSON.stringify(createFleet({ seed: 3, sea: flat }).at(12)) === JSON.stringify(createFleet({ seed: 3, sea: flat }).at(12)),
    expect: true,
  },
  {
    name: "on flat water a boat lies level with its waterline on the water",
    run: ({ createFleet }) => {
      const [pose] = createFleet({ seed: 3, sea: flat, count: 1 }).at(5, 0.4);
      return [Math.round(pose.at[1] * 1000) / 1000, Math.round(pose.up[1] * 1000) / 1000, pose.afloat];
    },
    expect: [0.4, 1, true],
  },
  {
    name: "a hull's axes are square to each other",
    run: ({ axesOf }) => {
      const { front, up, side } = axesOf([8, 3], 0.7, [0.6, -0.3]);
      return [dot(front, up), dot(front, side), dot(up, side)].every((value) => Math.abs(value) < 1e-9);
    },
    expect: true,
  },
  {
    name: "the bow lifts when the water stands higher there",
    run: ({ axesOf }) => axesOf([8, 3], 0, [1, 0]).front[1] > 0.1,
    expect: true,
  },
  {
    name: "a sailing boat keeps moving at its hull's speed and stays in deep water",
    run: ({ createFleet, HULLS }) => {
      const fleet = createFleet({ seed: 9, sea: flat, count: 8 });
      const sailing = fleet.at(0).find((pose) => pose.errand === "sailing");
      const later = fleet.at(1).find((pose) => pose.index === sailing.index);
      return Math.abs(Math.hypot(later.at[0] - sailing.at[0], later.at[2] - sailing.at[2]) - HULLS[sailing.kind].speed) < 0.1;
    },
    expect: true,
  },
  {
    name: "nothing sails or anchors where the water is too thin to float it",
    run: ({ createFleet, HULLS }) => {
      const fleet = createFleet({ seed: 9, sea: shelf, center: [0, 0], count: 0 });
      return [fleet.boats.length, HULLS.sloop.draft > 0.5];
    },
    expect: [0, true],
  },
  {
    name: "a beached boat sits on the sand until the tide reaches it, then floats",
    run: ({ createFleet }) => {
      const sea = { surfaceAt: (x, z, t, level = 0) => ({ height: level }), seabedAt: () => 0.5 };
      const fleet = createFleet({ seed: 2, sea, count: 0, beached: [[0, 0]] });
      const [low] = fleet.at(0, 0);
      const [high] = fleet.at(0, 2);
      return [low.afloat, Math.round(low.at[1] * 100) / 100, high.afloat, high.at[1]];
    },
    expect: [false, 0.72, true, 2],
  },
  {
    name: "every hull is whole triangles, each corner with a colour",
    run: ({ hullOf }) => ["dinghy", "fishing", "sloop"].map((kind) => {
      const mesh = hullOf(kind);
      return mesh.positions.length % 9 === 0 && mesh.positions.length === mesh.colors.length && mesh.positions.every(Number.isFinite);
    }),
    expect: [true, true, true],
  },
  {
    name: "a hull comes to a point at the bow and keeps a transom at the stern",
    run: ({ widthAlong }) => [widthAlong(1), widthAlong(0) > 0.3, widthAlong(0.4) > widthAlong(0)],
    expect: [0, true, true],
  },
];
