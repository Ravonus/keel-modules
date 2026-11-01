#!/usr/bin/env node
// Runs every modules/<org>/<category>/<id>/test/vectors.mjs against the readable
// TypeScript source. Every file under src/ is transpiled with the workspace's
// TypeScript compiler into a scratch directory, file for file, and src/index.ts
// imported from there, so the runner needs no build step, no bundler and no
// dependencies beyond the repo's own devDependencies.
//
// Vector contract (shared with `keel module test` in the SDK):
//   export default [{ name, run(moduleExports), expect }]
// A case passes when run() returns a value deeply equal to expect. A case
// may omit expect and instead throw from run() to fail.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { deepStrictEqual } from "node:assert";
import path from "node:path";
import ts from "typescript";

const root = path.dirname(new URL(".", import.meta.url).pathname);
const modulesDir = path.join(root, "modules");
const scratch = await mkdtemp(path.join(tmpdir(), "keel-vectors-"));
process.on("exit", () => { rm(scratch, { recursive: true, force: true }).catch(() => undefined); });

async function importModuleSource(moduleDir, id) {
  const srcDir = path.join(moduleDir, "src");
  const outDir = path.join(scratch, id);
  for (const file of (await readdir(srcDir, { recursive: true })).filter((name) => name.endsWith(".ts"))) {
    const source = await readFile(path.join(srcDir, file), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true },
      fileName: file,
    });
    const target = path.join(outDir, file.replace(/\.ts$/u, ".js"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, outputText);
  }
  return import(pathToFileURL(path.join(outDir, "index.js")).href);
}

let totalCases = 0;
let failedCases = 0;
/** Every module directory under modules/<org>/<category>/<id>, sorted by id. */
async function discoverModules(directory, depth = 0) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (depth === 2) found.push({ id: entry.name, directory: child });
    else found.push(...(await discoverModules(child, depth + 1)));
  }
  return found.sort((left, right) => (left.id < right.id ? -1 : 1));
}

const discovered = await discoverModules(modulesDir);

for (const { id, directory: moduleDir } of discovered) {
  const vectorsPath = path.join(moduleDir, "test", "vectors.mjs");
  let vectors;
  try {
    ({ default: vectors } = await import(pathToFileURL(vectorsPath).href));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      failedCases += 1;
      console.error(`${id}: missing test/vectors.mjs`);
      continue;
    }
    throw error;
  }
  const moduleExports = await importModuleSource(moduleDir, id);
  for (const vector of vectors) {
    totalCases += 1;
    try {
      const actual = await vector.run(moduleExports);
      if ("expect" in vector) deepStrictEqual(actual, vector.expect);
      console.log(`ok   ${id} :: ${vector.name}`);
    } catch (error) {
      failedCases += 1;
      console.error(`FAIL ${id} :: ${vector.name}`);
      console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(`\n${totalCases - failedCases}/${totalCases} vector cases passed across ${discovered.length} modules.`);
if (failedCases > 0) process.exit(1);
