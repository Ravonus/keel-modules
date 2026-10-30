/** Test vectors for boat-render: it only draws, so these hold what can be checked off a GPU. */
const pose = { kind: "sloop", at: [1, 2, 3], side: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1], speed: 2 };
const sizes = { sloop: { length: 10, beam: 3, freeboard: 1 } };

export default [
  {
    name: "a pose makes a matrix with the hull's axes as columns",
    run: ({ matrixOf }) => matrixOf(pose),
    expect: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
  },
  {
    name: "a wake points the way the boat does, on the water",
    run: ({ wakesOf }) => wakesOf([{ ...pose, front: [0, 0.6, 0.8] }], sizes)[0].ahead,
    expect: [0, 1],
  },
  {
    name: "a hull stands in the rays as three spheres along it",
    run: ({ castersOf }) => castersOf([pose], sizes).map((caster) => caster.at[2]),
    expect: [0, 3, 6],
  },
];
