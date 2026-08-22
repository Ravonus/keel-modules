#!/usr/bin/env node
// Runs every modules/<id>/test/vectors.mjs against the module's readable
// TypeScript source. The source is transpiled in memory with the workspace's
// TypeScript compiler and imported as a data: URL, so the runner needs no
// build step and no dependencies beyond the repo's own devDependencies.
//
// Vector contract (shared with `keel module test` in the SDK):
//   export default [{ name, run(moduleExports), expect }]
// A case passes when run() returns a value deeply equal to expect. A case
// may omit expect and instead throw from run() to fail.

import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { deepStrictEqual } from "node:assert";
import path from "node:path";
import ts from "typescript";

const root = path.dirname(new URL(".", import.meta.url).pathname);
const modulesDir = path.join(root, "modules");

async function importModuleSource(moduleDir) {
  const source = await readFile(path.join(moduleDir, "src", "index.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: "index.ts",
  });
  const encoded = Buffer.from(outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

let totalCases = 0;
let failedCases = 0;
const moduleIds = (await readdir(modulesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const id of moduleIds) {
  const moduleDir = path.join(modulesDir, id);
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
  const moduleExports = await importModuleSource(moduleDir);
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

console.log(`\n${totalCases - failedCases}/${totalCases} vector cases passed across ${moduleIds.length} modules.`);
if (failedCases > 0) process.exit(1);
