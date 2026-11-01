#!/usr/bin/env node
// No source file over MOST lines. ESLint counts a long file as one violation however long it gets, so its suppressions
// cannot hold one back: those already over are listed in size-baseline.json, and may only shrink.
//
//   node scripts/check-size.mjs            fail on a new long file, or a listed one that grew
//   node scripts/check-size.mjs --update   write the baseline, which may only tighten it
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MOST = 500;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/size-baseline.json");
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};

const sources = [...globSync("modules/*/*/*/src/**/*.ts", { cwd: root }), ...globSync("template/src/**/*.ts", { cwd: root }), ...globSync("scripts/**/*.{mjs,ts}", { cwd: root })];
const lines = (file) => readFileSync(join(root, file), "utf8").split("\n").length;
const over = Object.fromEntries(sources.map((file) => [relative(root, join(root, file)), lines(file)]).filter(([, n]) => n > MOST).sort());

if (process.argv.includes("--update")) {
  const grown = Object.entries(over).filter(([file, n]) => baseline[file] !== undefined && n > baseline[file]);
  const kept = Object.fromEntries(Object.entries(over).map(([file, n]) => [file, Math.min(n, baseline[file] ?? n)]));
  writeFileSync(baselinePath, `${JSON.stringify(kept, null, 2)}\n`);
  if (grown.length > 0) console.error(`kept the old limit for: ${grown.map(([file]) => file).join(", ")}`);
} else {
  const wrong = Object.entries(over).flatMap(([file, n]) => {
    if (baseline[file] === undefined) return [`${file}: ${n} lines, the most is ${MOST}. Split it.`];
    return n > baseline[file] ? [`${file}: ${n} lines, was ${baseline[file]}. It may only shrink: move something out of it.`] : [];
  });
  for (const line of wrong) console.error(line);
  process.exitCode = wrong.length > 0 ? 1 : 0;
}
