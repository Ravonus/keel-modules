#!/usr/bin/env node
// A contact sheet of generated people for judging their clothes: each seed in a T-pose and seated on a chair, from three
// sides, with nothing over the cloth. See "Judging clothes" in modules/keel-web3/generative/people/README.md.
//
//   node scripts/people-sheet/sheet.mjs --seeds 3,8,15 --weather rain --out sheet.png
//   node scripts/people-sheet/sheet.mjs --poses walk,run --time 0.3     (an animation, when that is what is being tested)
//   node scripts/people-sheet/sheet.mjs --score --seeds 1-40 --poses stand,walk,run,sit,crouch,dance,seated --time .1,.35,.6,.85
//     (the clip score: pixels of skin that clothes cover at rest showing in each shot; --out gets the worst, marked red)
//
// Needs keel-engine beside this repo (or KEEL_ENGINE), and Playwright with a browser (ESBUILD, PLAYWRIGHT, CHROME to point at them).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  seeds: { type: "string", default: "3,8,15,63,44" }, poses: { type: "string", default: "rest,seated" },
  views: { type: "string", default: "front,side,back" }, weather: { type: "string", default: "mild" },
  size: { type: "string", default: "260" }, cell: { type: "string", default: "0.02" }, time: { type: "string", default: "0" },
  out: { type: "string", default: "people-sheet.png" }, score: { type: "boolean", default: false }, worst: { type: "string", default: "24" },
} });
const YAW = { front: 0.3, side: 1.5, back: 3.6 };
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

const clipped = (list) => list.reduce((n, s) => n + s.through, 0) / Math.max(1, list.reduce((n, s) => n + s.body, 0));
const percent = (share) => (share * 100).toFixed(3).padStart(8);

/** The score, whole and by what might be behind it, worst first. */
function report(shots) {
  console.log(`clip score ${percent(clipped(shots)).trim()}% of body pixels are covered skin showing, ${shots.filter((s) => s.through > 0).length}/${shots.length} shots`);
  for (const key of ["pose", "top", "bottom"]) {
    const groups = new Map();
    for (const s of shots) groups.set(s[key], [...(groups.get(s[key]) ?? []), s]);
    const rows = [...groups].sort((a, b) => clipped(b[1]) - clipped(a[1]));
    console.log(`\n${key.padEnd(14)}   score%   shots  showing`);
    for (const [name, list] of rows) console.log(`${String(name).padEnd(14)}${percent(clipped(list))}${String(list.length).padStart(8)}${String(list.filter((s) => s.through > 0).length).padStart(9)}`);
  }
  console.log("\nworst shots");
  for (const s of [...shots].sort((a, b) => b.through / b.body - a.through / a.body).slice(0, 12)) {
    console.log(`  seed ${s.seed} ${s.pose} t${s.time} yaw ${s.yaw} ${s.top}/${s.bottom}: ${s.through} px of ${s.body}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "people-sheet-"));
try {
  const bundle = join(work, "page.js");
  execFileSync(esbuild, [join(here, "page.ts"), "--bundle", "--format=iife", `--outfile=${bundle}`, "--log-level=error", `--alias:keel-lit=${join(engine, "packages/lit/src/index.ts")}`], { stdio: ["ignore", "inherit", "inherit"] });
  const { chromium } = await playwright(), executablePath = chrome();
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  page.on("pageerror", (error) => { console.error(error.message); });
  await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
  const seedsOf = (list) => list.split(",").flatMap((item) => {
    const [a, b] = item.split("-").map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
  const sheet = {
    seeds: seedsOf(values.seeds), poses: values.poses.split(","), yaws: values.views.split(",").map((view) => YAW[view] ?? Number(view)),
    size: Number(values.size), cell: Number(values.cell), weather: values.weather, time: Number(values.time),
  };
  const scored = values.score ? await page.evaluate((s) => globalThis.score(s), { ...sheet, times: values.time.split(",").map(Number), worst: Number(values.worst) }) : undefined;
  if (scored) report(scored.shots);
  const png = scored?.png ?? await page.evaluate((s) => globalThis.sheet(s), sheet);
  writeFileSync(values.out, Buffer.from(png.split(",")[1], "base64"));
  await browser.close();
  console.log(values.out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
