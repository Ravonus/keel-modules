#!/usr/bin/env node
/**
 * Checks the committed catalog against the committed sources.
 *
 *   node scripts/check-catalog.mjs
 *
 * This is the gate that needs no toolchain: pure Node, no network, no keel
 * CLI. It cannot prove a build reproduces (only `keel module build` can do
 * that), but it catches the failure that a pull request is actually likely to
 * introduce, which is editing a module without regenerating the catalog, so
 * that catalog.json keeps vouching for source that no longer exists.
 *
 * What it enforces:
 *
 *   - every sourceFiles digest is the sha256 of the file at that path;
 *   - every module in the tree is in the catalog and the reverse;
 *   - every owner path resolves to a real org, group, and member;
 *   - category matches the directory the module is filed in;
 *   - `verified` is only ever set by a byte-proof disposition;
 *   - a deployment record names the module it sits under and pins an address.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BYTE_PROOF = new Set(["exact-source-output", "reproducible-build"]);
const problems = [];
const fail = (message) => problems.push(message);

async function discoverModules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    try {
      await stat(path.join(child, "keel.module.json"));
      found.push({
        directory: child,
        workspacePath: path.relative(ROOT, child).split(path.sep).join("/"),
        manifest: JSON.parse(await readFile(path.join(child, "keel.module.json"), "utf8")),
      });
    } catch {
      found.push(...(await discoverModules(child)));
    }
  }
  return found.sort((left, right) => (left.manifest.id < right.manifest.id ? -1 : 1));
}

const catalog = JSON.parse(await readFile(path.join(ROOT, "catalog/catalog.json"), "utf8"));
if (catalog.schema !== "keel-module-catalog@2") fail(`catalog schema is ${String(catalog.schema)}, expected keel-module-catalog@2`);

const modules = await discoverModules(path.join(ROOT, "modules"));
const orgs = new Map(catalog.organizations.map((org) => [org.id, org]));
const catalogued = new Map(catalog.modules.map((entry) => [entry.id, entry]));

for (const id of catalogued.keys()) {
  if (!modules.some((module) => module.manifest.id === id)) fail(`${id}: in the catalog but not in the tree`);
}

for (const module of modules) {
  const { id } = module.manifest;
  const entry = catalogued.get(id);
  if (entry === undefined) {
    fail(`${id}: in the tree but not in the catalog. Run "keel module build --all" then "keel module index".`);
    continue;
  }

  // The digests are the whole point: they are what the site shows next to the
  // word "verified", so a stale one is a false claim, not a stale cache.
  for (const file of entry.sourceFiles) {
    let bytes;
    try {
      bytes = await readFile(path.join(ROOT, file.path));
    } catch {
      fail(`${id}: catalog names ${file.path}, which does not exist`);
      continue;
    }
    const digest = `0x${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== file.sha256) fail(`${id}: ${file.path} is ${digest}, catalog says ${file.sha256}. Rebuild and re-index.`);
  }

  const expectedCategory = module.workspacePath.split("/").at(-2);
  if (module.manifest.category !== expectedCategory) {
    fail(`${id}: manifest category "${String(module.manifest.category)}" but it is filed under "${String(expectedCategory)}"`);
  }
  if (entry.category !== module.manifest.category) fail(`${id}: catalog category disagrees with the manifest`);

  const owner = module.manifest.owner;
  const org = orgs.get(owner?.org);
  if (org === undefined) {
    fail(`${id}: owner.org "${String(owner?.org)}" is not an organisation in the catalog`);
  } else {
    if (owner.group !== undefined && !org.groups.some((group) => group.id === owner.group)) {
      fail(`${id}: owner.group "${owner.group}" is not a group of ${org.id}`);
    }
    if (owner.member !== undefined && !org.members.some((member) => member.id === owner.member)) {
      fail(`${id}: owner.member "${owner.member}" is not a member of ${org.id}`);
    }
    if (owner.member !== undefined && owner.group === undefined) {
      fail(`${id}: owner.member without owner.group; a member is reached through a group`);
    }
  }

  if (entry.verified && !BYTE_PROOF.has(entry.disposition)) {
    fail(`${id}: verified is true but the disposition is "${entry.disposition}", which is not a byte proof`);
  }
  if (entry.deployed !== (entry.deployments.length > 0)) {
    fail(`${id}: deployed says ${String(entry.deployed)} but there are ${entry.deployments.length} deployment(s)`);
  }
  for (const deployment of entry.deployments) {
    if (!/^0x[0-9a-f]{40}$/u.test(deployment.hold.address)) fail(`${id}: deployment on chain ${deployment.chainId} has no valid KeelHold address`);
    if (deployment.outputDigest !== entry.outputDigest && deployment.status === "current") {
      fail(`${id}: the current deployment's outputDigest does not match the catalog's`);
    }
  }
}

// Group membership that leads nowhere renders as a dead name on the site.
for (const org of catalog.organizations) {
  const known = new Set(org.members.map((member) => member.id));
  for (const group of org.groups) {
    for (const member of group.members) {
      if (!known.has(member)) fail(`${org.id}: group "${group.id}" names unknown member "${member}"`);
    }
  }
}

if (problems.length === 0) {
  console.log(`catalog check: ${modules.length} module(s), ${catalog.organizations.length} organisation(s), no problems.`);
  process.exit(0);
}
console.error(`catalog check: ${problems.length} problem(s)\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
