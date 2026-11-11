// Surfaces demo: the painters' maps flat and tiled, the knit's relief lit on a sphere, and a payment card whose face is
// a print (an abstract shuttle mark, embossed digits and a gold chip with its own roughness and metalness) under the
// generated studio. Never published. `window.demo` is the driver's handle.

import * as lit from "keel://module/lit.js";
import * as S from "keel://module/surfaces.js";

const query = new URLSearchParams(location.search);
const RECIPES = { paper: S.PAPER, knit: S.KNIT, floral: S.PAINTED_FLORAL, cloth: S.PAINTED_CLOTH };

const renderer = lit.createLitRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = "srgb";
renderer.toneMapping = "neutral";
const gl = renderer.getContext();
const painter = S.createSurfacePainter(gl);
const print = S.createPrinter(lit, (w, h) => new OffscreenCanvas(w, h));
const environment = new lit.Environment(lit.STUDIO);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** A canvas holding RGBA bytes; `opaque` drops the alpha (the relief keeps its height there). */
function canvasOf(bytes, width, height, pick = (d) => d) {
  const c = document.createElement("canvas");
  [c.width, c.height] = [width, height];
  c.getContext("2d").putImageData(new ImageData(pick(new Uint8ClampedArray(bytes.slice(0))), width, height), 0, 0);
  return c;
}
const opaque = (d) => { for (let i = 3; i < d.length; i += 4) d[i] = 255; return d; };
const heightOnly = (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; } return d; };

/** `n` × `n` copies of a canvas, scaled by `scale`. */
function tiled(source, n, scale) {
  const c = document.createElement("canvas");
  const [w, h] = [Math.round(source.width * scale), Math.round(source.height * scale)];
  [c.width, c.height] = [w * n, h * n];
  const ctx = c.getContext("2d");
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) ctx.drawImage(source, x * w, y * h, w, h);
  return c;
}

/** The four tiles' shared corner at full size: where a seam would show. */
function corner(source, size) {
  const big = tiled(source, 2, 1);
  const c = document.createElement("canvas");
  [c.width, c.height] = [size, size];
  c.getContext("2d").drawImage(big, source.width - size / 2, source.height - size / 2, size, size, 0, 0, size, size);
  return c;
}

/** Mean and largest byte difference between two buffers, colour channels only. */
function difference(a, b) {
  const [x, y] = [new Uint8Array(a), new Uint8Array(b)];
  let [sum, most] = [0, 0];
  for (let i = 0; i < x.length; i += 1) {
    if (i % 4 === 3) continue;
    const d = Math.abs(x[i] - y[i]);
    sum += d;
    most = Math.max(most, d);
  }
  return { mean: sum / (x.length * 0.75), max: most };
}

/** Paints a recipe on the GPU `runs` times (the first compiles), on the CPU once, and returns stills and times. */
function paint(name, { width = 1024, height = width, seed = 0, runs = 9, tile = 3, cpu = true } = {}) {
  const recipe = RECIPES[name];
  const times = [];
  let surface;
  for (let i = 0; i < runs + 1; i += 1) {
    const t = performance.now();
    surface = painter.paint(recipe, { width, height, seed });
    times.push(performance.now() - t);
  }
  const plan = performance.now();
  S.planSurface(recipe, { width, height, seed });
  const planMs = performance.now() - plan;
  let cpuMs = null;
  let agree = null;
  if (cpu) {
    const t = performance.now();
    const other = S.paintSurface(recipe, { width, height, seed });
    cpuMs = performance.now() - t;
    agree = { digest: other.digest === surface.digest, albedo: difference(surface.buffers[0], other.buffers[0]),
      relief: difference(surface.buffers[1], other.buffers[1]) };
  }
  const albedo = canvasOf(surface.buffers[0], width, height);
  const out = {
    name, digest: surface.digest, width, height, seed, firstMs: times[0], medianMs: median(times.slice(1)),
    minMs: Math.min(...times.slice(1)), planMs, cpuMs, agree,
    albedo: albedo.toDataURL(), normal: canvasOf(surface.buffers[1], width, height, opaque).toDataURL(),
    height: canvasOf(surface.buffers[1], width, height, heightOnly).toDataURL(),
  };
  if (tile) {
    out.tiled = tiled(albedo, tile, 0.5).toDataURL();
    out.corner = corner(albedo, 512).toDataURL();
    out.normalTiled = tiled(canvasOf(surface.buffers[1], width, height, opaque), tile, 0.5).toDataURL();
  }
  return out;
}

/** Renders a stage to a still of `size` pixels and returns its PNG. */
function still(stage, camera, [w, h]) {
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(stage, camera);
  return renderer.domElement.toDataURL("image/png");
}

function studio(background) {
  const stage = new lit.Stage();
  stage.background = new lit.Color(background);
  stage.environment = environment;
  const sun = new lit.SunLight("#fff1dc", 1.2);
  sun.position.set(3, 5, 4);
  stage.add(sun, sun.target);
  return stage;
}

/** The knit's relief lit on a sphere under the studio, stitches about square around the equator. */
function sphere(name = "knit", { size = 1024, seed = 0, flat = false, albedo = true } = {}) {
  const surface = painter.paint(RECIPES[name], { width: 1024, seed });
  const { map, normalMap } = S.surfaceTextures(lit, surface);
  for (const t of [map, normalMap]) t.repeat.set(8, 4);
  const material = new lit.LitMaterial({ map: albedo ? map : null, color: albedo ? "#ffffff" : "#ff2f78",
    normalMap: flat ? null : normalMap, roughness: 0.85, metalness: 0 });
  const stage = studio("#1c1e23");
  stage.add(new lit.Mesh(lit.sphere(1, 192, 96), material));
  const camera = new lit.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.6, 4.2);
  camera.lookAt(0, 0, 0);
  return still(stage, camera, [size, size]);
}

// ------------------------------------------------------------------ the card

const CARD = { w: 1.586, h: 1, r: 0.037 * 1.586, depth: 0.015 * 1.586 };
const CHIP = { w: 0.14, h: 0.12, right: 0.18, top: 0.42 };

/** An abstract weaving shuttle: a long lens with pointed ends, a window for the bobbin and a thread leaving it. */
function shuttle(ctx, { x, y, length }, colour, ground) {
  const h = length * 0.26;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.25, -h, length * 0.75, -h, length, 0);
  ctx.bezierCurveTo(length * 0.75, h, length * 0.25, h, 0, 0);
  ctx.fill();
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.roundRect(length * 0.3, -h * 0.28, length * 0.4, h * 0.56, h * 0.28);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillRect(length * 0.36, -h * 0.08, length * 0.28, h * 0.16);
  ctx.strokeStyle = colour;
  ctx.lineWidth = h * 0.08;
  ctx.beginPath();
  ctx.moveTo(length * 0.64, 0);
  ctx.quadraticCurveTo(length * 0.95, h * 1.1, length * 1.3, h * 0.7);
  ctx.stroke();
  ctx.restore();
}

/** The chip's rectangle on a print `w` wide and `h` tall. */
function chipRect(w, h) {
  const [cw, ch] = [CHIP.w * w, CHIP.h * w];
  return { x: w - CHIP.right * w - cw, y: CHIP.top * h - ch / 2, cw, ch };
}

/** The chip's contact pads as grooves: a frame, a centre bar and three rows, eight pads. */
function chipGrooves(ctx, { x, y, cw, ch }, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = cw * 0.03;
  ctx.beginPath();
  ctx.roundRect(x + cw * 0.12, y + ch * 0.14, cw * 0.76, ch * 0.72, cw * 0.06);
  for (const f of [0.38, 0.62]) {
    ctx.moveTo(x + cw * 0.12, y + ch * f);
    ctx.lineTo(x + cw * 0.36, y + ch * f);
    ctx.moveTo(x + cw * 0.64, y + ch * f);
    ctx.lineTo(x + cw * 0.88, y + ch * f);
  }
  ctx.moveTo(x + cw * 0.36, y + ch * 0.14);
  ctx.lineTo(x + cw * 0.36, y + ch * 0.86);
  ctx.moveTo(x + cw * 0.64, y + ch * 0.14);
  ctx.lineTo(x + cw * 0.64, y + ch * 0.86);
  ctx.stroke();
}

/** The face: base colour, shuttle mark, sixteen embossed digits, the chip with a bevel and its grooves. */
function cardColour(ctx, w, h) {
  ctx.fillStyle = "#ff2a62";
  ctx.fillRect(0, 0, w, h);
  shuttle(ctx, { x: w * 0.07, y: h * 0.86, length: w * 0.16 }, "#ff8fae", "#ff2a62");
  ctx.font = `600 ${Math.round(h * 0.085)}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "middle";
  const digits = "4417 0718 2026 3302";
  const at = [w * 0.07, h * 0.66];
  for (const [dx, colour] of [[1, "#e91f57"], [-1, "#ff5c87"], [0, "#ff2a62"]]) {
    ctx.fillStyle = colour;
    ctx.fillText(digits, at[0] + dx * h * 0.004, at[1] + dx * h * 0.004);
  }
  const chip = chipRect(w, h);
  const bevel = ctx.createLinearGradient(chip.x, chip.y, chip.x + chip.cw, chip.y + chip.ch);
  bevel.addColorStop(0, "#e6c45a");
  bevel.addColorStop(0.5, "#c9a227");
  bevel.addColorStop(1, "#9a7a1c");
  ctx.fillStyle = bevel;
  ctx.beginPath();
  ctx.roundRect(chip.x, chip.y, chip.cw, chip.ch, chip.cw * 0.1);
  ctx.fill();
  ctx.fillStyle = "#c9a227";
  ctx.beginPath();
  ctx.roundRect(chip.x + chip.cw * 0.06, chip.y + chip.ch * 0.07, chip.cw * 0.88, chip.ch * 0.86, chip.cw * 0.07);
  ctx.fill();
  chipGrooves(ctx, chip, "#6e5512");
}

/** The same face as data: roughness in green, metalness in blue. */
function cardData(ctx, w, h) {
  ctx.fillStyle = S.pbr(0.5, 0.15);
  ctx.fillRect(0, 0, w, h);
  const chip = chipRect(w, h);
  ctx.fillStyle = S.pbr(0.3, 1);
  ctx.beginPath();
  ctx.roundRect(chip.x, chip.y, chip.cw, chip.ch, chip.cw * 0.1);
  ctx.fill();
  chipGrooves(ctx, chip, S.pbr(0.65, 0.6));
}

function roundedCard() {
  const { w, h, r } = CARD;
  const s = new lit.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return lit.extrude(s, { depth: CARD.depth, bevelEnabled: false, curveSegments: 12 });
}

/** The card under the studio: the print on its faces (the extrusion's caps carry x, y as UVs), plain on its edge. */
function card({ size = [1600, 1000], printWidth = 1024, turn = 0 } = {}) {
  const ph = Math.round(printWidth / CARD.w);
  const t = performance.now();
  const map = print([printWidth, ph], cardColour);
  const data = print([printWidth, ph], cardData, { data: true });
  const printMs = performance.now() - t;
  for (const tex of [map, data]) {
    tex.repeat.set(1 / CARD.w, 1 / CARD.h);
    tex.offset.set(0.5, 0.5);
  }
  const face = new lit.LitMaterial({ map, roughnessMap: data, metalnessMap: data, roughness: 1, metalness: 1 });
  const edge = new lit.LitMaterial({ color: "#e91f57", roughness: 0.5, metalness: 0.15 });
  const mesh = new lit.Mesh(roundedCard(), [face, edge]);
  mesh.rotation.set(-0.35, 0.45 + turn, 0.08);
  const stage = studio("#1c1e23");
  stage.add(mesh);
  const camera = new lit.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.2, 3.6);
  camera.lookAt(0, 0, 0);
  const png = still(stage, camera, size);
  const flat = document.createElement("canvas");
  [flat.width, flat.height] = [printWidth, ph];
  cardColour(flat.getContext("2d"), printWidth, ph);
  return { png, printMs, print: flat.toDataURL() };
}

window.demo = { paint, sphere, card, recipes: Object.keys(RECIPES),
  gpu: gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };

// A person opening the page sees one view.
const view = query.get("view") ?? "card";
const seed = Number(query.get("seed") ?? 0);
const img = new Image();
if (!(view in RECIPES) && view !== "card" && view !== "sphere") img.alt = "";
else if (view === "card") img.src = card().png;
else if (view === "sphere") img.src = sphere("knit", { seed });
else img.src = paint(view, { seed, runs: 0, cpu: false, ...(view in { floral: 1, cloth: 1 } ? { width: 1108, height: 652 } : {}) }).tiled;
img.style.maxWidth = "100vw";
document.body.append(img);
