#!/usr/bin/env node
// No source file over the lines its kind allows (size-limits.mjs). ESLint counts a long file as one violation however
// long it gets, so this check stands beside it and fails the build outright.
//
//   node scripts/check-size.mjs
import { globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "./size-limits.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  ...globSync("modules/*/*/*/src/**/*.ts", { cwd: root }),
  ...globSync("template/src/**/*.ts", { cwd: root }),
  ...globSync("scripts/**/*.{mjs,ts}", { cwd: root }),
];
const limitOf = (file) => LIMITS.find(({ files }) => files.some((glob) => matchesGlob(file, glob)));
const lines = (file) => readFileSync(join(root, file), "utf8").split("\n").length;
const over = sources
  .map((file) => [relative(root, join(root, file)), lines(file)])
  .filter(([file, n]) => n > limitOf(file).lines)
  .sort();

for (const [file, n] of over) {
  console.error(`${file}: ${n} lines, the most for a ${limitOf(file).kind} file is ${limitOf(file).lines}. Split it.`);
}
process.exitCode = over.length > 0 ? 1 : 0;
