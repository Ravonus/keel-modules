/** Deterministic test vectors for palette. Run by `keel module test`. */
export default [
  {
    name: "parseHexColor reads #rrggbb with a default alpha",
    run: ({ parseHexColor }) => parseHexColor("#336699"),
    expect: [51, 102, 153, 255],
  },
  {
    name: "parseHexColor reads #rrggbbaa case-insensitively",
    run: ({ parseHexColor }) => parseHexColor("#FFcc0080"),
    expect: [255, 204, 0, 128],
  },
  {
    name: "parseHexColor rejects malformed strings",
    run: ({ parseHexColor }) => {
      try {
        parseHexColor("#12345");
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
  {
    name: "rgba formats channels with scaled alpha",
    run: ({ rgba }) => rgba([51, 102, 153, 128]),
    expect: "rgba(51, 102, 153, 0.5019607843137255)",
  },
  {
    name: "mixColors interpolates and rounds channel by channel",
    run: ({ mixColors }) => mixColors([0, 0, 0], [255, 128, 64, 128], 0.5),
    expect: [128, 64, 32, 192],
  },
  {
    name: "mixColors clamps the amount into [0, 1]",
    run: ({ mixColors }) => mixColors([10, 20, 30, 40], [50, 60, 70, 80], 2),
    expect: [50, 60, 70, 80],
  },
  {
    name: "paletteColor wraps negative and overflow indexes",
    run: ({ paletteColor }) => [paletteColor(["#ff0000", "#00ff00"], -1), paletteColor(["#ff0000", "#00ff00"], 2)],
    expect: [[0, 255, 0, 255], [255, 0, 0, 255]],
  },
  {
    name: "paletteColor rejects an empty palette",
    run: ({ paletteColor }) => {
      try {
        paletteColor([], 0);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];
