// Hand-over demo: two lit scenes of our own, a sphere field and a torus knot, blended by scroll position, then a
// paper panel swept over the second. Never published. Every query value holds a frame still for a capture.

import * as lit from "keel://module/lit.js";
import * as finishModule from "keel://module/lit-finish.js";
import { createSceneBlend } from "keel://module/scene-blend.js";
import { createSectionPost } from "keel://module/section-post.js";

const query = new URLSearchParams(location.search);
const held = (key) => (query.has(key) ? Number(query.get(key)) : null);
const holdT = held("t");
const holdOverlay = held("overlay");
const still = holdT !== null || holdOverlay !== null || query.has("bench");
if (still) document.body.classList.add("still");

const renderer = lit.createLitRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Number(query.get("dpr") ?? devicePixelRatio));
renderer.toneMapping = "none";
document.body.prepend(renderer.domElement);

/** A seeded share in [0, 1): the demo's own small hash, so the scenes are the same every load. */
const share = (i, salt) => {
  let v = Math.imul(i ^ salt, 0x2c1b3c6d);
  v = Math.imul(v ^ (v >>> 12), 0x297a2d39);
  return ((v ^ (v >>> 15)) >>> 0) / 0x1_0000_0000;
};

function lights(stage, sun, sky, ground) {
  const light = new lit.SunLight(sun, 3.2);
  light.position.set(4, 7, 5);
  stage.add(light, light.target, new lit.SkyLight(sky, ground, 1.1));
}

function sphereField() {
  const stage = new lit.Stage();
  stage.background = new lit.Color("#1d2a33");
  lights(stage, "#fff2dc", "#9ec2d8", "#2a2620");
  const ball = lit.sphere(0.42, 32, 16);
  const palette = ["#c9a227", "#b5452f", "#3f6f8a", "#d8d2c0", "#6c8c4a"];
  const balls = [];
  for (let i = 0; i < 77; i += 1) {
    const material = new lit.LitMaterial({ color: palette[i % palette.length], roughness: 0.25 + share(i, 3) * 0.6, metalness: share(i, 5) > 0.7 ? 1 : 0 });
    const mesh = new lit.Mesh(ball, material);
    const x = (i % 11) - 5, z = Math.floor(i / 11) - 3;
    mesh.position.set(x * 1.05, 0.42 + share(i, 9) * 0.6, z * 1.05);
    stage.add(mesh);
    balls.push(mesh);
  }
  const floor = new lit.Mesh(lit.plane(40, 40), new lit.LitMaterial({ color: "#3a3630", roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  stage.add(floor);
  const camera = new lit.PerspectiveCamera(36, 1, 0.1, 100);
  return {
    stage, camera,
    at(time) {
      const a = 0.4 + time * 0.05;
      camera.position.set(Math.sin(a) * 10, 5.2, Math.cos(a) * 10);
      camera.lookAt(0, 0.5, 0);
      balls.forEach((m, i) => { m.position.y = 0.42 + share(i, 9) * 0.6 + Math.sin(time + i) * 0.08; });
    },
  };
}

class Knot extends lit.Curve {
  getPoint(t, target = new lit.Vector3()) {
    const a = t * Math.PI * 2, p = 2, q = 3, r = 1.2 + 0.45 * Math.cos(q * a);
    return target.set(r * Math.cos(p * a), 0.45 * Math.sin(q * a) * 1.6, r * Math.sin(p * a));
  }
}

function torusKnot() {
  const stage = new lit.Stage();
  stage.background = new lit.Color("#0e1517");
  lights(stage, "#ffe6c4", "#7f9fb0", "#20180f");
  const knot = new lit.Mesh(lit.tube(new Knot(), 320, 0.32, 24, true), new lit.LitMaterial({ color: "#d4a640", roughness: 0.3, metalness: 1 }));
  knot.position.y = 1.6;
  stage.add(knot);
  const plinth = new lit.Mesh(lit.cylinder(1.6, 1.8, 0.4, 48), new lit.LitMaterial({ color: "#5b6b66", roughness: 0.7 }));
  plinth.position.y = 0.2;
  const floor = new lit.Mesh(lit.plane(40, 40), new lit.LitMaterial({ color: "#26302c", roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  stage.add(plinth, floor);
  const camera = new lit.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 3.2, 7.5);
  camera.lookAt(0, 1.4, 0);
  return { stage, camera, at(time) { knot.rotation.y = time * 0.3; knot.rotation.x = 0.25; } };
}

const a = sphereField();
const b = torusKnot();
const finish = finishModule.createLitFinish(lit, renderer, { tonemap: "agx", ao: 0.7, hazeDensity: 0.01 });
finish.setSun([4, 7, 5], "#fff2dc");
const blend = createSceneBlend(lit, renderer, finish, { seed: 7 });
const post = createSectionPost(lit, renderer, finishModule, { seed: 7, tear: Number(query.get("tear") ?? 1), fibre: 0.8 });
const mode = query.get("mode") ?? "noise";

function resize() {
  const [w, h] = [innerWidth, innerHeight];
  renderer.setSize(w, h);
  for (const part of [finish, blend, post]) part.setSize(w, h, renderer.getPixelRatio());
  for (const scene of [a, b]) { scene.camera.aspect = w / h; scene.camera.updateProjectionMatrix(); }
}
addEventListener("resize", resize);
resize();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** The page's state at a scroll position in screens: the blend over the second screen, the panel over the fourth and fifth. */
function stateAt(screens) {
  const t = holdT ?? clamp(screens - 1, 0, 1);
  const overlay = holdOverlay ?? clamp((screens - 2.6) * 1.25, 0, 2);
  return { t, overlay };
}

const shotA = { scene: a.stage, camera: a.camera };
const shotB = { scene: b.stage, camera: b.camera };
let current = "a";

function frame(time, state) {
  a.at(time);
  b.at(time);
  post.render(() => { current = blend.draw(shotA, shotB, state.t, { mode, darken: 0 }); }, {
    progress: state.overlay, position: state.overlay - 1,
  });
}

/** Times `count` frames, each to the GPU's finish (a one-pixel read waits for it), after 30 to warm up. */
function bench(count, state) {
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < count + 30; i += 1) {
    const start = performance.now();
    frame(i / 60, state);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (i >= 30) times.push(performance.now() - start);
  }
  times.sort((x, y) => x - y);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { frames: count, median: at(0.5), p95: at(0.95), min: times[0], max: times.at(-1) };
}

if (query.has("bench")) {
  const state = { t: holdT ?? 0.5, overlay: holdOverlay ?? 0 };
  window.benchResult = bench(Number(query.get("bench")) || 300, state);
} else if (still) {
  frame(Number(query.get("time") ?? 0), stateAt(0));
  frame(Number(query.get("time") ?? 0), stateAt(0));
  window.frameReady = true;
} else {
  renderer.setAnimationLoop((ms) => frame(ms / 1000, stateAt(scrollY / innerHeight)));
}
window.current = () => current;
