/** Deterministic test vectors for camera-rail. Run by `keel module test`. */
const round = (value) => Math.round(value * 1e6) / 1e6 + 0;
const roundAll = (values) => values.map(round);
const roundView = ({ eye, target, fov, roll }) => [roundAll(eye), roundAll(target), round(fov), round(roll)];

/**
 * A stand-in for the `tracks` module's sampler: straight lines between keys, holds at both ends.
 * The rail only needs the shape; the real sampler's easing is pinned by the `tracks` vectors.
 */
function sampleLinear(tracks, position) {
  const out = {};
  for (const { target, property, keys } of tracks) {
    let i = 0;
    while (i + 1 < keys.length && keys[i + 1][0] <= position) i += 1;
    const [from, to] = [keys[i], keys[i + 1]];
    const t = to && position > from[0] ? (position - from[0]) / (to[0] - from[0]) : 0;
    const mix = (a, b) => a + (b - a) * t;
    (out[target] ??= {})[property] = to && Array.isArray(from[1]) ? from[1].map((a, k) => mix(a, to[1][k])) : to ? mix(from[1], to[1]) : from[1];
  }
  return out;
}

/** Section 06's camera: one move from before the section to past its end. */
const CAMERA = [
  { target: "camera", property: "eye", keys: [[-0.49, [-1.06, 1.43, 2.1]], [2.13, [0, -0.52, 4.87]]] },
  { target: "camera", property: "target", keys: [[-0.49, [-0.43, 0.91, -1]], [2.13, [0, -0.75, 1]]] },
  { target: "camera", property: "roll", keys: [[-0.49, -0.1], [2.13, 0.22]] },
  { target: "camera", property: "fov", keys: [[0, 25], [1.07, 22]] },
];

/** A camera that records what applyView did to it. */
function fakeCamera(fov) {
  const log = [];
  return {
    log,
    position: { set: (x, y, z) => log.push(["position", x, y, z]) },
    lookAt: (x, y, z) => log.push(["lookAt", x, y, z]),
    rotateZ: (a) => log.push(["rotateZ", a]),
    fov,
    updateProjectionMatrix: () => log.push(["projection"]),
  };
}

export default [
  {
    name: "a camera at its keys: the first, the last and the fov key",
    run: ({ createCameraRail }) => {
      const rail = createCameraRail(sampleLinear, { tracks: CAMERA });
      return [roundView(rail.at(-0.49)), roundView(rail.at(2.13)), roundView(rail.at(1.07))];
    },
    expect: [
      [[-1.06, 1.43, 2.1], [-0.43, 0.91, -1], 25, -0.1],
      [[0, -0.52, 4.87], [0, -0.75, 1], 22, 0.22],
      [[-0.428855, 0.268931, 3.749313], [-0.173969, -0.078397, 0.19084], 22, 0.090534],
    ],
  },
  {
    name: "the view holds before the first key and past the last (an intro, a hand-over)",
    run: ({ createCameraRail }) => {
      const rail = createCameraRail(sampleLinear, { tracks: CAMERA });
      return [roundView(rail.at(-3)), roundView(rail.at(3.44))];
    },
    expect: [
      [[-1.06, 1.43, 2.1], [-0.43, 0.91, -1], 25, -0.1],
      [[0, -0.52, 4.87], [0, -0.75, 1], 22, 0.22],
    ],
  },
  {
    name: "half way between two keys the stand-in sampler is the midpoint, and the rail passes it through",
    run: ({ createCameraRail }) => {
      const tracks = [
        { target: "camera", property: "eye", keys: [[0, [0, 0, 10]], [2, [2, 4, 6]]] },
        { target: "camera", property: "target", keys: [[0, [0, 0, 0]], [2, [1, 1, 1]]] },
        { target: "camera", property: "fov", keys: [[0, 10], [2, 30]] },
        { target: "camera", property: "roll", keys: [[0, 0.27], [2, 0]] },
      ];
      return roundView(createCameraRail(sampleLinear, { tracks }).at(1));
    },
    expect: [[1, 2, 8], [0.5, 0.5, 0.5], 20, 0.135],
  },
  {
    name: "with nothing keyed the camera stands at [0, 0, 5] looking at the origin, fov 30, no roll",
    run: ({ createCameraRail }) => roundView(createCameraRail(sampleLinear, { tracks: [] }).at(0.5)),
    expect: [[0, 0, 5], [0, 0, 0], 30, 0],
  },
  {
    name: "the fov setting and the target name are honoured",
    run: ({ createCameraRail }) => {
      const tracks = [{ target: "cam-b", property: "fov", keys: [[0, 66.59]] }];
      const rail = createCameraRail(sampleLinear, { tracks, fov: 11, name: "cam-b" });
      return [createCameraRail(sampleLinear, { tracks, fov: 11 }).at(0).fov, rail.at(0).fov];
    },
    expect: [11, 66.59],
  },
  {
    name: "the clock is handed to the sampler for time tracks",
    run: ({ createCameraRail }) => {
      const seen = [];
      const rail = createCameraRail((tracks, position, time) => {
        seen.push([tracks, position, time]);
        return {};
      }, { tracks: "T" });
      rail.at(1.5, { time: 4 });
      rail.at(2);
      return seen;
    },
    expect: [["T", 1.5, 4], ["T", 2, undefined]],
  },
  {
    name: "pointerStrength: 1 at rest, 0.25 as scrolling starts, floor 0.05 from |v| = 0.02",
    run: ({ pointerStrength }) => roundAll([0, 1e-9, 0.01, 0.02, 1, -1].map(pointerStrength)),
    expect: [1, 0.25, 0.15, 0.05, 0.05, 0.05],
  },
  {
    name: "turnView: a quarter pan turns a view down -z to +x, a quarter tilt turns it up; the distance is kept",
    run: ({ turnView }) => [
      roundAll(turnView([0, 0, 0], [0, 0, -1], Math.PI / 2, 0)),
      roundAll(turnView([0, 0, 0], [0, 0, -1], 0, Math.PI / 2)),
      roundAll(turnView([1, 2, 3], [4, 6, 3], 0, 0)),
      round(Math.hypot(...turnView([0, 0, 0], [3, 4, 12], 0.3, -0.2))),
    ],
    expect: [[1, 0, 0], [0, 1, 0], [4, 6, 3], 13],
  },
  {
    name: "turnView straight down has no horizontal axis to tilt round and turns in place",
    run: ({ turnView }) => roundAll(turnView([0, 5, 0], [0, 0, 0], 1, 1)),
    expect: [0, 0, 0],
  },
  {
    name: "the pointer at the right edge pans the view by 0.1 rad times the scale, settling from rest",
    run: ({ createCameraRail }) => {
      const tracks = [
        { target: "camera", property: "eye", keys: [[0, [0, 0, 0]]] },
        { target: "camera", property: "target", keys: [[0, [0, 0, -1]]] },
      ];
      const rail = createCameraRail(sampleLinear, { tracks, pan: 0.05, tilt: 0.02 });
      const first = rail.at(0, { pointer: { x: 1, y: 0 }, velocity: 0 }).target;
      let view;
      for (let i = 0; i < 60; i += 1) view = rail.at(0, { pointer: { x: 1, y: 0 }, velocity: 0 });
      return [roundAll(first), roundAll(view.target), roundAll([Math.sin(0.0025), Math.sin(0.005)])];
    },
    expect: [[0.0025, 0, -0.999997], [0.005, 0, -0.999988], [0.0025, 0.005]],
  },
  {
    name: "the pointer at the top tilts the view up by 0.1 rad times the tilt scale",
    run: ({ createCameraRail }) => {
      const tracks = [{ target: "camera", property: "target", keys: [[0, [0, 0, -1]]] }];
      const rail = createCameraRail(sampleLinear, { tracks, pan: 0.05, tilt: 0.5 });
      let view;
      for (let i = 0; i < 60; i += 1) view = rail.at(0, { pointer: { x: 0, y: 1 } });
      // The eye defaults to [0, 0, 5], so the view is 6 long and tilts up by 0.1 * 0.5 rad.
      return [roundAll(view.eye), roundAll(view.target), roundAll([6 * Math.sin(0.05), 5 - 6 * Math.cos(0.05)])];
    },
    expect: [[0, 0, 5], [0, 0.299875, -0.992502], [0.299875, -0.992502]],
  },
  {
    name: "a scene with zero scales (06) ignores the pointer, bit for bit",
    run: ({ createCameraRail }) => {
      const rail = createCameraRail(sampleLinear, { tracks: CAMERA });
      const still = rail.at(0.5).target;
      const moved = rail.at(0.5, { pointer: { x: 1, y: -1 }, velocity: 0.3 }).target;
      return still.every((v, i) => v === moved[i]);
    },
    expect: true,
  },
  {
    name: "while scrolling the pointer takes hold slower, and lets go toward rest when it leaves",
    run: ({ createCameraRail }) => {
      const tracks = [
        { target: "camera", property: "eye", keys: [[0, [0, 0, 0]]] },
        { target: "camera", property: "target", keys: [[0, [0, 0, -1]]] },
      ];
      const make = () => createCameraRail(sampleLinear, { tracks, pan: 1 });
      const [rest, scroll] = [make(), make()];
      let a;
      let b;
      for (let i = 0; i < 5; i += 1) {
        a = rest.at(0, { pointer: { x: 1, y: 0 }, velocity: 0 });
        b = scroll.at(0, { pointer: { x: 1, y: 0 }, velocity: 1 });
      }
      const gone = scroll.at(0, { pointer: null, velocity: 1 }).target[0];
      return [round(a.target[0]), round(b.target[0]), b.target[0] < a.target[0], gone < b.target[0]];
    },
    expect: [0.096724, 0.090515, true, true],
  },
  {
    name: "catmullRom holds its ends, passes through its points and splits two points at the midpoint",
    run: ({ catmullRom }) => {
      const points = [[0, 0, 0], [1, 2, 0], [3, 2, 1], [4, 0, 1]];
      return [
        roundAll(catmullRom(points, -1)),
        roundAll(catmullRom(points, 0)),
        roundAll(catmullRom(points, 1 / 3)),
        roundAll(catmullRom(points, 1)),
        roundAll(catmullRom(points, 2)),
        roundAll(catmullRom([[1, 1, 1], [3, 5, 7]], 0.5)),
        roundAll(catmullRom([[2, 3, 4]], 0.7)),
        roundAll(catmullRom([], 0.5)),
      ];
    },
    expect: [[0, 0, 0], [0, 0, 0], [1, 2, 0], [4, 0, 1], [4, 0, 1], [2, 3, 4], [2, 3, 4], [0, 0, 0]],
  },
  {
    name: "catmullRom between points is the spline, not the chord: golden values",
    run: ({ catmullRom }) => {
      const points = [[0, 0, 0], [1, 2, 0], [3, 2, 1], [4, 0, 1]];
      return [roundAll(catmullRom(points, 0.5)), roundAll(catmullRom(points, 1 / 6))];
    },
    expect: [[2, 2.25, 0.5], [0.375, 1, -0.0625]],
  },
  {
    name: "a path drives the eye and target by the keyed along; a keyed eye wins over the path",
    run: ({ createCameraRail }) => {
      const path = { eye: [[0, 0, 10], [5, 5, 5], [10, 0, 0]], target: [[0, 0, 0], [1, 0, 0]] };
      const along = { target: "camera", property: "along", keys: [[0, 0], [1, 1]] };
      const ride = createCameraRail(sampleLinear, { tracks: [along], path });
      const keyed = createCameraRail(sampleLinear, { tracks: [along, { target: "camera", property: "eye", keys: [[0, [7, 7, 7]]] }], path });
      return [roundView(ride.at(0)), roundView(ride.at(0.5)), roundView(ride.at(1)), roundView(keyed.at(0.5))];
    },
    expect: [
      [[0, 0, 10], [0, 0, 0], 30, 0],
      [[5, 5, 5], [0.5, 0, 0], 30, 0],
      [[10, 0, 0], [1, 0, 0], 30, 0],
      [[7, 7, 7], [0.5, 0, 0], 30, 0],
    ],
  },
  {
    name: "applyView stands, aims and rolls the camera, and sets the fov only when it changed",
    run: ({ applyView }) => {
      const camera = fakeCamera(30);
      applyView(camera, { eye: [1, 2, 3], target: [0, 0, 0], fov: 25, roll: 0.27 });
      applyView(camera, { eye: [1, 2, 3], target: [0, 1, 0], fov: 25, roll: 0 });
      return [camera.fov, camera.log];
    },
    expect: [25, [["position", 1, 2, 3], ["lookAt", 0, 0, 0], ["rotateZ", 0.27], ["projection"], ["position", 1, 2, 3], ["lookAt", 0, 1, 0]]],
  },
];
