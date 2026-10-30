#!/usr/bin/env node
// Serves the ocean preview: node modules/keel-web3/render/ocean-render/tools/serve.mjs [port]
// Sources are transpiled per request, so an edit shows on reload. keel/lit is
// bundled once from a sibling keel-engine checkout (KEEL_ENGINE to point elsewhere).

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const here = import.meta.dirname;
const publisher = path.resolve(here, "../../..");
const engine = process.env.KEEL_ENGINE ?? path.resolve(publisher, "../../../keel-engine");
const extras = process.env.KEEL_EXTRA_MODULES ?? publisher;
const port = Number(process.argv[2] ?? 4197);
const lit = path.join(tmpdir(), `keel-lit-preview-${process.pid}.mjs`);
execFileSync(path.join(engine, "node_modules/.bin/esbuild"), [path.join(engine, "packages/lit/src/index.ts"), "--bundle", "--format=esm", "--target=es2022", "--platform=browser", `--outfile=${lit}`, "--log-level=warning"]);

const script = "text/javascript; charset=utf-8";
const pages = { "/": [path.join(here, "preview.html"), "text/html; charset=utf-8"], "/preview.js": [path.join(here, "preview.js"), script], "/lit.mjs": [lit, script] };

createServer(async (request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  try {
    const module = /^\/modules\/(\w+)\/([\w-]+)\.mjs$/u.exec(route);
    if (module) {
      const file = path.join(module[1], module[2], "src/index.ts");
      const source = await readFile(path.join(publisher, file), "utf8").catch(() => readFile(path.join(extras, file), "utf8"));
      const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: "index.ts" });
      response.writeHead(200, { "content-type": script, "cache-control": "no-store" }).end(outputText);
      return;
    }
    const page = pages[route];
    if (!page) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": page[1], "cache-control": "no-store" }).end(await readFile(page[0]));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
}).listen(port, () => process.stdout.write(`ocean preview on http://localhost:${port}\n`));
