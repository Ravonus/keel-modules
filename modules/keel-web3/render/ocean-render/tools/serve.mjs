#!/usr/bin/env node
// Serves the ocean preview: node modules/keel-web3/render/ocean-render/tools/serve.mjs [port]
// Sources are transpiled per request, so an edit shows on reload. A module is served as its whole
// src tree, `/modules/<category>/<id>/<path>.js` from `src/<path>.ts`, so the `.js` specifiers in the
// sources resolve against it. keel/lit is bundled once from a sibling keel-engine checkout
// (KEEL_ENGINE to point elsewhere; KEEL_ESBUILD to name the esbuild binary that does it).

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const here = import.meta.dirname;
const publisher = path.resolve(here, "../../..");
const engine = process.env.KEEL_ENGINE ?? path.resolve(publisher, "../../../keel-engine");
const esbuild = process.env.KEEL_ESBUILD ?? path.join(engine, "node_modules/.bin/esbuild");
const extras = process.env.KEEL_EXTRA_MODULES ?? publisher;
const port = Number(process.argv[2] ?? 4197);
const lit = path.join(tmpdir(), `keel-lit-preview-${process.pid}.mjs`);
execFileSync(esbuild, [path.join(engine, "packages/lit/src/index.ts"), "--bundle", "--format=esm", "--target=es2022", "--platform=browser", `--outfile=${lit}`, "--log-level=warning"]);

const script = "text/javascript; charset=utf-8";
const pages = { "/": [path.join(here, "preview.html"), "text/html; charset=utf-8"], "/preview.js": [path.join(here, "preview.js"), script], "/lit.mjs": [lit, script] };
// A path inside a module's src: folders and a file name, dots allowed only inside a name (so never `..`).
const MODULE_FILE = /^\/modules\/(\w+)\/([\w-]+)\/((?:[\w-]+\/)*[\w-]+(?:\.[\w-]+)*)\.js$/u;

/** Transpiles one source file of a module, found in the publisher's tree or the extras'. */
async function transpiled(category, id, relative) {
  const file = path.join(category, id, "src", `${relative}.ts`);
  const source = await readFile(path.join(publisher, file), "utf8").catch(() => readFile(path.join(extras, file), "utf8"));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true }, fileName: path.basename(file) });
  return outputText;
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
}).listen(port, () => process.stdout.write(`ocean preview on http://localhost:${port}\n`));
