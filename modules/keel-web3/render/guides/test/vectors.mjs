// The ID table, the taggers and the CPU read-back pinned. The GPU passes are checked by render in a browser.

const PARTS = { skin: 0, hand: 1, eye: 2, cap: 3, hair: 4, dress: 5, chemise: 6, gown: 7, gold: 8, card: 9 };

/** FNV-1a over a list of byte triples: one number for a whole table's colours. */
const fnv = (rows) => {
  let h = 0x811c9dc5;
  for (const row of rows) for (const b of row) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
};

/** A 2 x 2 `id` pass: cap, nothing, skin, card. */
const idImage = ({ idTable }) => {
  const table = idTable(["skin", "cap", "card"]);
  const colour = (name) => [...table.find((e) => e.name === name).colour, 255];
  const data = Uint8Array.from([...colour("cap"), 0, 0, 0, 0, ...colour("skin"), ...colour("card")]);
  return { table, image: { width: 2, height: 2, data } };
};

export default [
  {
    name: "the passes, in order",
    run: ({ PASSES, MAX_IDS }) => [...PASSES, MAX_IDS],
    expect: ["depth", "normal", "id", "light", "line", "block", 255],
  },
  {
    name: "every ID up to 255 has its own colour, none black or dark",
    run: ({ idColours }) => {
      const c = idColours(255);
      return [new Set(c.map(String)).size, c.filter((x) => Math.max(...x) < 160).length];
    },
    expect: [255, 0],
  },
  {
    name: "the first colours, and all 255 by digest",
    run: ({ idColours }) => [idColours(4), fnv(idColours(255))],
    expect: [[[50, 94, 200], [111, 160, 40], [240, 60, 218], [50, 200, 174]], 3401253653],
  },
  {
    name: "a table is its names in code-point order from 1, whatever order they came in",
    run: ({ idTable }) => idTable(["skin", "Skin", "cap", "skin", "cap.cuff"]).map((e) => [e.id, e.name]),
    expect: [[1, "Skin"], [2, "cap"], [3, "cap.cuff"], [4, "skin"]],
  },
  {
    name: "the bust's parts as a table: IDs, ID colours, block colours by name or pattern, else the material's",
    run: ({ idTable }) => idTable(Object.keys(PARTS), { skin: "#e8cbb0", "c*": "#ff2f78" }, { gown: [23, 27, 25] })
      .map((e) => [e.id, e.name, ...e.colour, ...e.block]),
    expect: [
      [1, "cap", 50, 94, 200, 255, 47, 120], [2, "card", 111, 160, 40, 255, 47, 120],
      [3, "chemise", 240, 60, 218, 255, 47, 120], [4, "dress", 50, 200, 174, 128, 128, 128],
      [5, "eye", 160, 104, 40, 128, 128, 128], [6, "gold", 104, 60, 240, 128, 128, 128],
      [7, "gown", 57, 200, 50, 23, 27, 25], [8, "hair", 160, 40, 81, 128, 128, 128],
      [9, "hand", 60, 173, 240, 128, 128, 128], [10, "skin", 188, 200, 50, 232, 203, 176],
    ],
  },
  {
    name: "more than 255 names is refused",
    run: ({ idTable }) => {
      try {
        idTable(Array.from({ length: 256 }, (_, i) => `p${i}`));
        return "made";
      } catch (error) {
        return String(error.message);
      }
    },
    expect: "guides: 256 names, at most 255",
  },
  {
    name: "byName: the mesh's guide tag, the material's, the mesh's name, the material's",
    run: ({ byName }) => [
      byName({ name: "m", userData: { guide: "tagged" } }, { name: "mat", userData: { guide: "slot" } }, 0),
      byName({ name: "m", userData: {} }, { name: "mat", userData: { guide: "slot" } }, 0),
      byName({ name: "m" }, { name: "mat" }, 0),
      byName({ name: "" }, { name: "mat" }, 0),
      byName({ name: "" }, { name: "" }, 0) ?? null,
    ],
    expect: ["tagged", "slot", "m", "mat", null],
  },
  {
    name: "bySlot: a shader define looked up in a { name: slot } record, or the slot in a list",
    run: ({ bySlot }) => {
      const parts = bySlot(PARTS, "PART");
      const list = bySlot(["a", "b"]);
      return [
        parts({}, { defines: { PART: 7 } }, 0), parts({}, { defines: { PART: 0 } }, 3),
        parts({}, { defines: {} }, 0) ?? null, parts({}, { defines: { PART: 12 } }, 0) ?? null,
        list({}, {}, 1), list({}, {}, 2) ?? null,
      ];
    },
    expect: ["gown", "skin", null, null, "b", null],
  },
  {
    name: "patterns: exact, and * for any run",
    run: ({ matches }) => [
      matches("skin", "skin"), matches("skin", "skin.face"), matches("skin.*", "skin.face"), matches("skin.*", "skin"),
      matches("*.left", "eye.left"), matches("eye*left", "eye.far.left"), matches("a*b*c", "abc"),
      matches("a*b*c", "acb"), matches("*", ""),
    ],
    expect: [true, false, true, false, true, true, true, false, true],
  },
  {
    name: "idsOf: the IDs whose names match",
    run: ({ idTable, idsOf }) => idsOf(idTable(["skin.face", "skin.neck", "eye.left", "cap"]), ["skin.*", "cap"]),
    expect: [1, 3, 4],
  },
  {
    name: "an id pass read back: each pixel's ID from its colour, and a mask by pattern",
    run: (m) => {
      const { table, image } = idImage(m);
      return [[...m.idsIn(image, table)], [...m.idMask(image, table, ["ca*"])], table.map((e) => e.name)];
    },
    expect: [[1, 0, 3, 2], [255, 0, 0, 255], ["cap", "card", "skin"]],
  },
  {
    name: "a colour not in the table, or under no coverage, reads as nothing",
    run: ({ idTable, idsIn }) => [...idsIn({ width: 2, height: 1, data: Uint8Array.from([1, 2, 3, 255, 50, 94, 200, 0]) },
      idTable(["cap"]))],
    expect: [0, 0],
  },
  {
    name: "depth: red and green a 16-bit share, 65535 at the near end, nothing where uncovered",
    run: ({ depthIn }) => {
      const data = Uint8Array.from([255, 255, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255, 9, 9, 0, 0]);
      const image = { width: 4, height: 1, data };
      return [0, 1, 2, 3].map((i) => depthIn(image, i, { near: 2, far: 4 })).map((d) => Math.round(d * 1e4) / 1e4);
    },
    expect: [2, 4, 3, Infinity],
  },
  {
    name: "hexBytes, and a bad colour named",
    run: ({ hexBytes }) => {
      let error = "";
      try { hexBytes("#12345"); } catch (e) { error = e.message; }
      return [hexBytes("#ff2f78"), hexBytes("0a0B0c"), error];
    },
    expect: [[255, 47, 120], [10, 11, 12], 'guides: "#12345" is not a #rrggbb colour'],
  },
  {
    name: "enclose: one ball round the parts' balls",
    run: ({ enclose }) => {
      const s = enclose([{ centre: [0, 0, 0], radius: 1 }, { centre: [4, 0, 0], radius: 1 }]);
      return [s.centre, s.radius, enclose([]).radius];
    },
    expect: [[2, 0, 0], 3, 1],
  },
  {
    name: "depthRange: the view distances the parts span, kept past the camera's near",
    run: ({ depthRange }) => {
      // A camera at z = 5 looking down -z: world to view is a shift by -5 in z.
      const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1];
      return [
        depthRange([{ centre: [0, 0, 0], radius: 1 }, { centre: [0, 0, -2], radius: 0.5 }], view, 0.1),
        depthRange([{ centre: [0, 0, 4.5], radius: 1 }], view, 0.1),
        depthRange([], view, 0.1),
      ];
    },
    expect: [{ near: 4, far: 7.5 }, { near: 0.1, far: 1.5 }, { near: 0.1, far: 1.1 }],
  },
  {
    name: "shadowFrame: the key's camera two radii up the key, seeing the ball",
    run: ({ shadowFrame }) => shadowFrame({ centre: [1, 0, 0], radius: 2 }, [0, 3, 4]),
    expect: { eye: [1, 2.4, 3.2], half: 2, far: 7 },
  },
];
