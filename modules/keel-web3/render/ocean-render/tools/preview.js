// Ocean Preview: every ocean module together in one local scene. Never published.
// The cameras follow the animals, so each view shows one thing the slice has to prove.

import * as lit from "keel://module/lit.js";
import { createSea, tideOn, tideTimes, TIDE_PERIOD } from "keel://module/ocean.js";
import { createBeach } from "keel://module/beach.js";
import { SPECIES, castFor, createSwim, poseSwimmer } from "keel://module/marine.js";
import { createOcean, createSwarm } from "keel://module/ocean-render.js";
import { createSdfBodies } from "keel://module/sdf-body.js";
import { createQuality } from "keel://module/quality.js";

const query = new URLSearchParams(location.search);
const number = (key, fallback) => (query.has(key) ? Number(query.get(key)) : fallback);
const held = query.has("t") ? number("t", 0) : null;
// Everything sits 120 m offshore of a beach, so the same world holds the deep and the shore.
const beach = createBeach({ seed: number("seed", 7), heading: 0, offset: 120 });
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
scene.add(sun, sun.target, new lit.SkyLight("#9fd0e6", "#2a4a58", 1.2));

const quality = createQuality({ level: query.get("quality") ?? "high", tier: "high" });
const ocean = createOcean(lit, { sea, colorAt: beach.colorAt, size: 640, quality });
scene.add(ocean.group);

const bodies = createSdfBodies(lit, { shadows: false, maxBodies: 18, maxParts: 48, ink: 0 });
const swarm = createSwarm(lit, { bodies, pose: poseSwimmer, species: SPECIES, near: 18 });
scene.add(swarm.group);

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
    return { eye: [-12, 2.4, 92], look: [14, 0, 116] };
  },
  shore(all, t) {
    const walk = Math.sin(t * 0.08) * 0.5 + 0.5;
    const z = 92 + walk * 44;
    return { eye: [8, sea.seabedAt(8, z) + 1.5, z], look: [14, 1.2, z + 30] };
  },
  beach() {
    return { eye: [-34, 4.2, 150], look: [10, -0.5, 96] };
  },
  above(all) {
    const middle = mean(all.filter((one) => one.id === "sardine"));
    return { eye: [middle[0] - 16, 5, middle[2] - 18], look: [middle[0], 0, middle[2]] };
  },
};
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

function fit() {
  renderer.setSize(innerWidth, innerHeight, false);
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
  camera.position.set(eye[0], ["above", "window", "shore", "beach", "surf"].includes(view) ? eye[1] : Math.min(eye[1], top - 0.6), eye[2]);
  camera.lookAt(look[0], look[1], look[2]);
  camera.updateMatrixWorld();
  swarm.draw(all, eye, bodyLight);
  ocean.draw(renderer, scene, camera, t, { sun: sunDirection, sunColor, casters: swarm.casters, frameMs, level });
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
window.__ocean = { frame, sea, swim, quality, bench, setView: (id) => { view = id; } };
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
