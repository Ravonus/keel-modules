/** Deterministic test vectors for sprite-sheet. Run by `keel module test`. */
export default [
  {
    name: "equalCells splits a grid row-major",
    run: ({ equalCells }) => equalCells(64, 32, { columns: 2, rows: 2 }),
    expect: [
      { x: 0, y: 0, width: 32, height: 16 },
      { x: 32, y: 0, width: 32, height: 16 },
      { x: 0, y: 16, width: 32, height: 16 },
      { x: 32, y: 16, width: 32, height: 16 },
    ],
  },
  {
    name: "equalCells defaults to a single row",
    run: ({ equalCells }) => equalCells(30, 10, { columns: 3 }),
    expect: [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
      { x: 20, y: 0, width: 10, height: 10 },
    ],
  },
  {
    name: "equalCells rejects a grid that does not divide evenly",
    run: ({ equalCells }) => {
      try {
        equalCells(65, 32, { columns: 2, rows: 2 });
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
  {
    name: "atlasFrames reads nested frame objects with w/h names",
    run: ({ atlasFrames }) => atlasFrames({ frames: { run0: { frame: { x: 0, y: 0, w: 16, h: 16 } }, run1: { x: 16, y: 0, width: 16, height: 16 } } }),
    expect: [
      { name: "run0", x: 0, y: 0, width: 16, height: 16 },
      { name: "run1", x: 16, y: 0, width: 16, height: 16 },
    ],
  },
  {
    name: "atlasFrames rejects array-style frames lists",
    run: ({ atlasFrames }) => {
      try {
        atlasFrames({ frames: [{ x: 0, y: 0, w: 1, h: 1 }] });
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
  {
    name: "atlasFrames rejects negative geometry",
    run: ({ atlasFrames }) => {
      try {
        atlasFrames({ frames: { bad: { x: -1, y: 0, w: 1, h: 1 } } });
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
  {
    name: "drawFrame disables smoothing and maps source to destination",
    run: ({ drawFrame }) => {
      const calls = [];
      const context = {
        imageSmoothingEnabled: true,
        drawImage(...args) { calls.push(args.slice(1)); },
      };
      drawFrame(context, { id: "sheet" }, { x: 1, y: 2, width: 3, height: 4 }, { x: 5, y: 6, width: 7, height: 8 });
      return [context.imageSmoothingEnabled, calls];
    },
    expect: [false, [[1, 2, 3, 4, 5, 6, 7, 8]]],
  },
];
