#!/usr/bin/env node
// Serves the surfaces demo: node modules/keel-web3/generative/surfaces/tools/serve.mjs [port]
// Sources are transpiled per request, so an edit shows on reload: `/modules/<category>/<id>/<path>.js` from that
// module's `src/<path>.ts`. keel/lit is bundled once from a sibling keel-engine checkout (KEEL_ENGINE to point
// elsewhere; KEEL_ESBUILD to name the esbuild binary that does it).

import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const here = import.meta.dirname;
const publisher = path.resolve(here, "../../..");
const engine = process.env.KEEL_ENGINE ?? path.resolve(publisher, "../../../keel-engine");
const esbuild = process.env.KEEL_ESBUILD ?? path.join(engine, "node_modules/.bin/esbuild");
const port = Number(process.argv[2] ?? 4199);
const lit = path.join(tmpdir(), `keel-lit-surfaces-${process.pid}.mjs`);
execFileSync(esbuild, [path.join(engine, "packages/lit/src/index.ts"), "--bundle", "--format=esm", "--target=es2022",
  "--platform=browser", `--outfile=${lit}`, "--log-level=warning"]);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => rm(lit, { force: true }).finally(() => process.exit(0)));

const script = "text/javascript; charset=utf-8";
const pages = {
  "/": [path.join(here, "demo.html"), "text/html; charset=utf-8"],
  "/demo.js": [path.join(here, "demo.js"), script],
  "/lit.mjs": [lit, script],
};
// A path inside a module's src: folders and a file name, dots allowed only inside a name (so never `..`).
const MODULE_FILE = /^\/modules\/(\w+)\/([\w-]+)\/((?:[\w-]+\/)*[\w-]+(?:\.[\w-]+)*)\.js$/u;

async function transpiled(category, id, relative) {
  const file = path.join(publisher, category, id, "src", `${relative}.ts`);
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true };
  return ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: options, fileName: path.basename(file) }).outputText;
}

createServer(async (request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  try {
    const module = MODULE_FILE.exec(route);
    if (module) {
      const body = await transpiled(module[1], module[2], module[3]);
      response.writeHead(200, { "content-type": script, "cache-control": "no-store" }).end(body);
      return;
    }
    const page = pages[route];
    if (!page) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": page[1], "cache-control": "no-store" }).end(await readFile(page[0]));
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end(String(error));
  }
}).listen(port, "127.0.0.1", () => process.stdout.write(`surfaces demo on http://127.0.0.1:${port}\n`));
