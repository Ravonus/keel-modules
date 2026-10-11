// Compile and exercise the actual approved Studio parser, not a schema copy.
// Requires sibling keel-sdk (built) and keel-site checkouts and Site's Zod.
// No browser, wallet, network request or publication is performed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const sdk = path.resolve(root, "../keel-sdk");
const site = path.resolve(root, "../keel-site");
const zodVersion = createRequire(path.join(site, "apps/studio/package.json"))("zod/package.json").version;
assert.equal(zodVersion, "4.4.3", "Use the approved Studio lockfile's Zod version.");
const { build } = await import(pathToFileURL(path.join(sdk, "node_modules/esbuild/lib/main.js")));
const { prepareKeelModuleRuntime } = await import(pathToFileURL(path.join(sdk, "packages/sdk/dist/module-runtime.js")));
const { canonicalJson } = await import(pathToFileURL(path.join(sdk, "packages/protocol/dist/index.js")));
const source = path.join(site, "apps/studio/src/lib/verified-module-catalog.ts");
const result = await build({
  entryPoints: [source], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "actual-keel-protocol", setup(builder) {
    builder.onResolve({ filter: /^@keel\/protocol$/ }, () => ({ path: path.join(sdk, "packages/protocol/dist/index.js") }));
  } }],
});
const { parseVerifiedModuleCatalogDocument } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
const bytes = await readFile(path.join(root, "catalog/catalog.json"));
const catalog = JSON.parse(bytes);
const parsed = parseVerifiedModuleCatalogDocument(catalog);
assert.ok(catalog.modules.length > 0);
assert.deepEqual(parsed.modules.map(module => module.id), catalog.modules.map(module => module.id));
const sha = data => `0x${createHash("sha256").update(data).digest("hex")}`;
for (const [index, module] of parsed.modules.entries()) {
  assert.equal(module.runtime.encoding, "base64");
  assert.equal(sha(Buffer.from(module.runtime.data, "base64")), module.outputDigest);
  assert.equal(sha(canonicalJson(module.types.files)), module.types.integrity.digest);
  assert.deepEqual(module.deployments, catalog.modules[index].deployments);
  assert.equal(module.deployed, catalog.modules[index].deployed);
}
// Demonstrate the incompatible alternative against this same real parser.
const dense = { ...catalog, modules: await Promise.all(catalog.modules.map(async module => ({
  ...module, runtime: await prepareKeelModuleRuntime(Buffer.from(module.runtime.data, "base64"), {
    format: module.runtime.format, entry: module.runtime.entry,
  }),
}))) };
assert.equal(parseVerifiedModuleCatalogDocument(dense).modules.length, 0);
const commit = directory => execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = directory => execFileSync("git", ["-C", directory, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim().length > 0;
console.log(JSON.stringify({
  schema: "keel-studio-catalog-compatibility@1", siteCommit: commit(site), sdkCommit: commit(sdk),
  catalogCommit: commit(root), catalogSHA256: sha(bytes), studioParserSHA256: sha(await readFile(source)),
  catalogSourceDirty: dirty(root), sdkSourceDirty: dirty(sdk), zodVersion,
  acceptedModules: parsed.modules.length, authenticatedRuntimeAndDeclarationDigests: true,
  base90DescriptorsRejected: dense.modules.length, deploymentRecordsPreserved: true,
  browserTested: false, liveRpcTested: false, signatures: 0, transactions: 0, publicationVerified: false,
}, null, 2));
