#!/usr/bin/env node
// The painterly module's demo, rendered in real Chrome on the GPU: a seeded person in a knit cap holding a card before
// a lake and mountains, drawn raw, smoothed (the base alone) and stroked along the form. Writes a still of each, the
// frame times, and a sheet of the three beside any image given to compare.
//
//   node scripts/painterly-demo/demo.mjs --out trial/ --width 1440 --height 900 --dpr 2 --frames 300
//   node scripts/painterly-demo/demo.mjs --out trial/ --compare some-painting.jpg     (a fourth tile on the sheet)
//
// Needs keel-engine beside this repo (or KEEL_ENGINE), and Playwright with a browser (ESBUILD, PLAYWRIGHT, CHROME to point at them).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, loadavg, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  out: { type: "string", default: "painterly-demo" }, width: { type: "string", default: "1440" }, height: { type: "string", default: "900" },
  dpr: { type: "string", default: "2" }, frames: { type: "string", default: "300" }, seed: { type: "string", default: "52" },
  compare: { type: "string" }, variants: { type: "string", default: "raw,smooth,stroked" },
} });
const dirs = (dir) => (existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : []);

const engine = resolve(process.env.KEEL_ENGINE ?? join(here, "../../../keel-engine"));
const esbuild = [process.env.ESBUILD ?? "", join(engine, "node_modules/.bin/esbuild"), join(here, "../../node_modules/.bin/esbuild"), join(here, "../../../keel-sdk/node_modules/.bin/esbuild"), ...dirs(join(homedir(), ".npm/_npx")).map((dir) => join(dir, "node_modules/.bin/esbuild"))].find(existsSync);
if (!existsSync(join(engine, "packages/lit/src/index.ts")) || !esbuild) throw new Error(`need keel-engine with esbuild, looked in ${engine}`);

async function playwright() {
  const found = process.env.PLAYWRIGHT ?? dirs(join(homedir(), ".npm/_npx")).map((dir) => join(dir, "node_modules/playwright/index.mjs")).find(existsSync);
  return found ? import(pathToFileURL(found).href) : import("playwright");
}
function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const builds = dirs(join(homedir(), "Library/Caches/ms-playwright")).filter((dir) => /chromium-\d+$/.test(dir)).sort().reverse();
  return builds.map((dir) => join(dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")).find(existsSync);
}
const png = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64");
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { frames: sorted.length, median: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), min: sorted[0], max: sorted.at(-1) };
};

const shot = { width: Number(values.width), height: Number(values.height), dpr: Number(values.dpr), seed: Number(values.seed) };
const frames = Number(values.frames);
const variants = values.variants.split(",");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "painterly-demo-"));
try {
  const bundle = join(work, "page.js");
  execFileSync(esbuild, [join(here, "page.ts"), "--bundle", "--format=iife", `--outfile=${bundle}`, "--log-level=error", `--alias:keel-lit=${join(engine, "packages/lit/src/index.ts")}`], { stdio: ["ignore", "inherit", "inherit"] });
  const { chromium } = await playwright(), executablePath = chrome();
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  try {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: shot.dpr });
    const problems = [];
    page.on("pageerror", (error) => { problems.push(error.message); console.error(error.message); });
    page.on("console", (message) => { if (["error", "warning"].includes(message.type()) && !/GL Driver Message/.test(message.text())) problems.push(message.text()); });
    await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
    const t0 = performance.now();
    const info = await page.evaluate((s) => globalThis.painterly.build(s), shot);
    const built = performance.now() - t0;
    console.log(`built in ${built.toFixed(0)} ms: ${JSON.stringify(info)}`);
    const gpu = await page.evaluate(() => {
      const gl = document.querySelector("canvas")?.getContext("webgl2");
      if (!gl) return "no webgl2";
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
    const result = { shot, frames, load: loadavg(), gpu, builtMs: Math.round(built), variants: {} };
    const stills = [];
    for (const variant of variants) {
      const still = await page.evaluate((v) => globalThis.painterly.still(v), variant);
      stills.push(still);
      writeFileSync(join(out, `${variant}.png`), png(still));
      const timing = await page.evaluate(([v, n]) => globalThis.painterly.time(v, n), [variant, frames]);
      result.variants[variant] = { gpu: timing.gpu.length ? stats(timing.gpu) : null, sync: stats(timing.sync), raf: stats(timing.raf) };
      const { gpu, sync, raf } = result.variants[variant];
      const ms = (s) => (s ? `median ${s.median.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms` : "none");
      console.log(`${variant}: gpu ${ms(gpu)}; sync ${ms(sync)}; raf ${ms(raf)}`);
    }
    let compare = null;
    if (values.compare) {
      const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[extname(values.compare).toLowerCase()] ?? "image/png";
      compare = `data:${type};base64,${readFileSync(values.compare).toString("base64")}`;
    }
    const sheet = await page.evaluate(([s, c, w, h]) => globalThis.painterly.sheet(s, c, w, h), [stills, compare, shot.width, shot.height]);
    writeFileSync(join(out, "sheet.png"), png(sheet));
    result.problems = problems;
    writeFileSync(join(out, "timings.json"), JSON.stringify(result, null, 2));
    console.log(`load ${result.load.map((l) => l.toFixed(2)).join(" ")}; gpu ${gpu}; ${problems.length} problems; wrote ${out}`);
  } finally {
    await browser.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
