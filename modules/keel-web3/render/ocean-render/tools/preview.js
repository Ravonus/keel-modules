// Ocean Preview: every ocean module together in one local scene. Never published.
// The cameras follow the animals, so each view shows one thing the slice has to prove.

import * as lit from "keel://module/lit.js";
import { createSea, tideOn, tideTimes, TIDE_PERIOD } from "keel://module/ocean.js";
import { createBeach } from "keel://module/beach.js";
import { HULLS, createFleet, hullOf } from "keel://module/boats.js";
import { createBoats } from "keel://module/boat-render.js";
import { SPECIES, castFor, createSwim, poseSwimmer } from "keel://module/marine.js";
import { createOcean, createSwarm, lightFromWorld } from "keel://module/ocean-render.js";
import { createSdfBodies } from "keel://module/sdf-body.js";
import { createQuality } from "keel://module/quality.js";
import { createVoxelDither } from "keel://module/voxel-dither.js";
import { worldLight } from "keel://module/world-light.js";

const query = new URLSearchParams(location.search);
const number = (key, fallback) => (query.has(key) ? Number(query.get(key)) : fallback);
const held = query.has("t") ? number("t", 0) : null;
// Everything sits 120 m offshore of a beach, so the same world holds the deep and the shore.
const beach = createBeach({ seed: number("seed", 7), heading: 0, offset: 120, kind: query.get("kind") ?? "cove", sand: query.get("sand") ?? "golden" });
const sea = createSea({ seed: number("seed", 7), wind: number("wind", 7), ground: beach.groundAt });
const swim = createSwim(castFor({ seed: number("seed", 7), sea, center: [0, -30] }), sea);

const renderer = lit.createLitRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = "srgb";
renderer.toneMapping = "none";
document.getElementById("stage").append(renderer.domElement);

const scene = new lit.Stage();
const camera = new lit.PerspectiveCamera(58, 1, 0.1, 1800);
const sunDirection = [0.34, 0.86, 0.38];
const sunColor = [3.6, 3.35, 2.95];
const sun = new lit.SunLight("#fff2dc", 3.4);
sun.position.set(sunDirection[0] * 100, sunDirection[1] * 100, sunDirection[2] * 100);
const fill = new lit.SkyLight("#9fd0e6", "#2a4a58", 1.2);
scene.add(sun, sun.target, fill);

const quality = createQuality({ level: query.get("quality") ?? "high", tier: "high" });
// Sand dries fast here because the tide below runs a whole cycle in two minutes.
// Where the water's edge is along the coast, and the widest run of sand for the shore views to stand on.
const edgeAt = (x) => { let z = 120; for (let round = 0; round < 10; round += 1) z -= beach.inlandOf(x, z); return z; };
const sandiness = (x) => [-70, -35, 0, 35, 70].map((side) => [4, 12, 20].filter((inland) => beach.takesPrints(x + side, edgeAt(x + side) + inland) && beach.groundAt(x + side, edgeAt(x + side) + inland) < 3).length).reduce((sum, count) => sum + count, 0);
const openX = Array.from({ length: 81 }, (_, at) => (at - 40) * 7).sort((a, b) => sandiness(b) - sandiness(a) || Math.abs(a) - Math.abs(b))[0];
const [sx, sz] = [openX, edgeAt(openX) - 120];
const rocks = beach.rocksWithin(0, 0, 450).filter((rock) => Math.abs(rock.at[0]) < 320 && Math.abs(rock.at[2]) < 320);
const ocean = createOcean(lit, { sea, colorAt: beach.colorAt, size: 640, quality, dryTime: number("dry", 40), rocks, rockColor: beach.rockColor, prints: beach.trails(14, [openX, sz + 130]) });
scene.add(ocean.group);

// A dinghy pulled up wherever the sand is, and the rest of the fleet off the shore.
const sandy = Array.from({ length: 60 }, (_, at) => (at - 30) * 8).map((x) => [x + openX, edgeAt(x + openX) + 2.4]).filter(([x, z]) => beach.takesPrints(x, z) && [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dz]) => beach.zoneAt(x + dx, z + dz) !== "rock" && Math.abs(beach.groundAt(x + dx, z + dz) - beach.groundAt(x, z)) < 0.5));
const fleet = createFleet({ seed: number("seed", 7), sea, center: [openX, sz + 10], radius: 110, count: 7, beached: sandy.slice(0, 2) });
const boats = createBoats(lit, { hullOf, kinds: Object.keys(HULLS) });
scene.add(boats.group);

const bodies = createSdfBodies(lit, { shadows: false, maxBodies: 18, maxParts: 48, ink: 0 });
const swarm = createSwarm(lit, { bodies, pose: poseSwimmer, species: SPECIES, near: 18 });
scene.add(swarm.group);

// ?hour=7.5 lights the sea by world-light at that hour on a tropical coast, and ?look=pixel wears voxel-dither.
const hour = query.has("hour") ? number("hour", 12) : null;
const lightNow = () => {
  if (hour === null) return { sun: sunDirection, sunColor };
  const world = worldLight({ timestamp: Date.UTC(2026, 5, 21, 0, Math.round(hour * 60)), lat: 12, lon: 0, season: "summer", climate: "maritime" });
  const light = lightFromWorld(world);
  sun.position.set(light.sun[0] * 100, light.sun[1] * 100, light.sun[2] * 100);
  sun.color.set(world.night > 0.5 ? world.moon.color : world.sun.color);
  sun.intensity = world.night > 0.5 ? world.moon.intensity : world.sun.intensity;
  fill.color.set(world.fill.sky);
  fill.groundColor.set(world.fill.ground);
  fill.intensity = world.fill.intensity;
  return light;
};
const dither = createVoxelDither(lit, renderer, { style: query.get("look") ?? "pixel" });
let looking = query.has("look");

const bodyLight = { sun: sunDirection, sunColor, fill: [0, 1, 0], fillColor: [0, 0, 0], sky: [0.55, 0.95, 1.2], ground: [0.12, 0.22, 0.26], rim: [0, 1, 0], rimColor: [0.5, 0.8, 1], saturation: 1.15 };

const find = (all, id) => all.find((one) => one.id === id);
const mean = (list) => [0, 1, 2].map((axis) => list.reduce((sum, one) => sum + one.at[axis], 0) / list.length);
const behind = (target, front, back, rise) => [target[0] - front[0] * back, target[1] - front[1] * back + rise, target[2] - front[2] * back];

// Each view gives where the eye is and what it looks at.
const VIEWS = {
  school(all) {
    const fish = all.filter((one) => one.id === "sardine");
    const middle = mean(fish);
    return { eye: [middle[0] + 7, middle[1] - 1, middle[2] + 7], look: middle };
  },
  shark(all) {
    const shark = find(all, "shark");
    return { eye: [shark.at[0] + shark.front[2] * 5, shark.at[1] + 0.3, shark.at[2] - shark.front[0] * 5], look: shark.at };
  },
  jelly(all) {
    const jelly = find(all, "jelly");
    return { eye: [jelly.at[0] + 1.3, jelly.at[1] - 0.15, jelly.at[2] + 1.3], look: jelly.at };
  },
  window(all) {
    const middle = mean(all.filter((one) => one.id === "sardine"));
    return { eye: [middle[0], -7, middle[2]], look: [middle[0] + 1, 0, middle[2] + 3] };
  },
  // Wading ashore: out of the shallows and up the sand on a loop, or held by ?t.
  surf() {
    return { eye: [sx - 12, 2.4, sz + 92], look: [sx + 14, 0, sz + 116] };
  },
  // Along a breaking front, at the height of its lip.
  break() {
    return { eye: [sx - 4, 1.5, sz + number("z", 109)], look: [sx + 30, 0.7, sz + number("z", 109) + 5] };
  },
  // Along the coast and past the fine ground, to show nothing ends.
  coast() {
    return { eye: [sx + 120, 34, sz + 190], look: [sx + 800, 0, sz + 150] };
  },
  shore(all, t) {
    const walk = Math.sin(t * 0.08) * 0.5 + 0.5;
    const z = sz + 92 + walk * 44;
    return { eye: [sx + 8, sea.seabedAt(sx + 8, z) + 1.5, z], look: [sx + 14, 1.2, z + 30] };
  },
  beach() {
    const z = edgeAt(sx - 30) + 10;
    return { eye: [sx - 30, sea.seabedAt(sx - 30, z) + 1.6, z], look: [sx + 40, 0.2, edgeAt(sx + 40) - 7] };
  },
  // Under the coast's tallest cliff, watching the waves hit it.
  cliff() {
    let z = tallest[1];
    while (beach.groundAt(tallest[0], z) > -0.5 && z > -200) z -= 2;
    return { eye: [tallest[0] - 34, 4.5, z - 46], look: [tallest[0] + 4, 5, z + 8] };
  },
  // Over the shore at the biggest rock in the water.
  rocks() {
    const rock = stack;
    const back = rock.radius * 2.4 + 16;
    return { eye: [rock.at[0] - back * 0.5, 3.4, rock.at[2] - back], look: [rock.at[0], 2.5, rock.at[2]] };
  },
  // Down at a trail of footprints.
  prints() {
    const print = trail;
    return { eye: [print.x - 2.2, print.y + 1.5, print.z - 1.6], look: [print.x + 1, print.y, print.z + 1] };
  },
  // On the water among the boats.
  harbor() {
    const boat = fleet.at(33)[1];
    return { eye: [boat.at[0] - 22, 3.6, boat.at[2] - 26], look: boat.at };
  },
  above(all) {
    const middle = mean(all.filter((one) => one.id === "sardine"));
    return { eye: [middle[0] - 16, 5, middle[2] - 18], look: [middle[0], 0, middle[2]] };
  },
};
const standing = Array.from({ length: 120 }, (_, at) => (at - 60) * 5).flatMap((x) => [80, 110, 140, 170, 200].map((z) => [x, z, beach.groundAt(x, z)]));
const tallest = standing.reduce((a, b) => (b[2] > a[2] ? b : a));
const stack = rocks.filter((rock) => rock.at[1] < -1).sort((a, b) => a.at[2] - b.at[2] - (b.radius - a.radius) * 4)[0] ?? { at: [0, 0, 100], radius: 2, height: 2 };
const trail = beach.trails(14, [openX, sz + 130]).find((print) => print.y > 1) ?? { x: 0, y: 1, z: 130 };
const IDS = Object.keys(VIEWS);
let view = IDS.includes(query.get("view")) ? query.get("view") : "school";

const bar = document.getElementById("bar");
for (const id of IDS) {
  const button = document.createElement("button");
  button.textContent = id;
  button.onclick = () => { view = id; for (const each of bar.children) each.setAttribute("aria-pressed", String(each.textContent === view)); if (held !== null) frame(held); };
  button.setAttribute("aria-pressed", String(id === view));
  bar.append(button);
}

// Live switches, and a timing run so the cost of each is a number.
function toggle(label, read, flip) {
  const button = document.createElement("button");
  const paint = () => { button.textContent = `${label} ${read() ? "on" : "off"}`; button.setAttribute("aria-pressed", String(read())); };
  button.onclick = () => { flip(); paint(); if (held !== null) frame(held); };
  paint();
  bar.append(button);
}
toggle("rays", () => quality.tracing, () => quality.set({ tracing: !quality.tracing }));
// The tide: pick a state of it, or let it run a whole cycle in two minutes.
const TIDES = { low: TIDE_PERIOD / 2, mid: TIDE_PERIOD / 4, high: 0 };
let tide = query.get("tide") ?? "auto";
const hours = (t) => (tide === "auto" ? (t / 120) * TIDE_PERIOD : TIDES[tide]);
const tideButton = document.createElement("button");
const paintTide = () => { tideButton.textContent = `tide ${tide}`; };
tideButton.onclick = () => { const order = ["auto", "low", "mid", "high"]; tide = order[(order.indexOf(tide) + 1) % 4]; paintTide(); if (held !== null) frame(held); };
paintTide();
bar.append(tideButton);
toggle("upscale", () => quality.upscale, () => quality.set({ upscale: !quality.upscale }));
toggle("spray", () => quality.spray, () => quality.set({ spray: !quality.spray }));
toggle("pixels", () => looking, () => { looking = !looking; });

function fit() {
  renderer.setSize(innerWidth, innerHeight, false);
  dither.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", () => { fit(); if (held !== null) frame(held); });
fit();

const info = document.getElementById("info");
let frames = 0;
let lastTide = "";
let last = performance.now();

/** Draws one moment. */
function frame(t, frameMs) {
  const all = swim.at(t);
  const clock = hours(t);
  const level = tideOn(clock);
  const { eye, look } = VIEWS[view](all, t);
  // The camera rides over the swell rather than through it.
  const top = sea.surfaceAt(eye[0], eye[2], t, level).height;
  camera.position.set(eye[0], ["above", "window", "shore", "beach", "surf", "break", "coast", "cliff", "rocks", "prints", "harbor"].includes(view) ? eye[1] : Math.min(eye[1], top - 0.6), eye[2]);
  camera.lookAt(look[0], look[1], look[2]);
  camera.updateMatrixWorld();
  swarm.draw(all, eye, bodyLight);
  const poses = query.get("boats") === "0" ? [] : fleet.at(t, level);
  boats.draw(poses);
  const light = { ...lightNow(), casters: [...swarm.casters, ...boats.casters(poses, HULLS)], wakes: boats.wakes(poses, HULLS), frameMs, level };
  if (looking) dither.renderWith(() => ocean.draw(renderer, scene, camera, t, light), camera);
  else ocean.draw(renderer, scene, camera, t, light);
  lastTide = `tide ${level.toFixed(2)} m, next ${tideTimes(clock)[0].kind} in ${(tideTimes(clock)[0].at - clock).toFixed(1)} h`;
  return all;
}

/** Milliseconds a frame takes with the GPU flushed, so the number is the real cost. */
function bench(count = 40) {
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const started = performance.now();
  for (let i = 0; i < count; i += 1) {
    frame(30 + i / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  }
  return Math.round(((performance.now() - started) / count) * 100) / 100;
}
window.__ocean = { renderer, camera, rocks, sandy, frame, sea, swim, quality, bench, beach, fleet, ocean, setView: (id) => { view = id; } };
if (held !== null) requestAnimationFrame(() => { fit(); frame(held); });
else {
  const start = performance.now();
  let previous = start;
  const tick = (now) => {
    const all = frame((now - start) / 1000 + 20, now - previous);
    previous = now;
    frames += 1;
    if (now - last > 1000) {
      info.textContent = `${frames} fps · ${quality.level} at ${Math.round(quality.scale * 100)}% · ${lastTide} · ${all.length} animals · wind ${sea.wind} m/s`;
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
