#!/usr/bin/env node
/**
 * Reconciles the per-module public repositories with what exists on GitHub.
 *
 *   node scripts/repos.mjs                report each module's repository state
 *   node scripts/repos.mjs --create       create the repositories that are missing
 *   node scripts/repos.mjs --org <name>   target a different organisation
 *
 * Reporting is the default and touches nothing. `--create` is the only mode
 * that writes, it only ever creates repositories that do not exist, and it
 * never pushes: filling a repository with module content is a separate,
 * deliberate step, because an empty repository is harmless and a wrongly
 * populated public one is not.
 *
 * The counterpart for the contract modules is keel-sdk's tools/keel/repos.mjs.
 * Same idea, same `gh` dependency, same read-only default.
 */
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CREATE = process.argv.includes("--create");
const ORG = (() => {
  const index = process.argv.indexOf("--org");
  return index === -1 ? "keel-web3" : process.argv[index + 1];
})();

/** Every module manifest, wherever it is filed under modules/. */
async function discoverModules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    const manifestPath = path.join(child, "keel.module.json");
    try {
      await stat(manifestPath);
      found.push({ directory: child, manifest: JSON.parse(await readFile(manifestPath, "utf8")) });
    } catch {
      found.push(...(await discoverModules(child)));
    }
  }
  return found.sort((left, right) => (left.manifest.id < right.manifest.id ? -1 : 1));
}

const modules = await discoverModules(path.join(ROOT, "modules"));

let remote;
try {
  const raw = execFileSync("gh", ["repo", "list", ORG, "--limit", "200", "--json", "name,visibility,isEmpty,pushedAt"], { encoding: "utf8" });
  remote = new Map(JSON.parse(raw).map((repository) => [repository.name, repository]));
} catch {
  console.error(`repos: could not reach GitHub for ${ORG} (is gh authenticated?)`);
  process.exit(1);
}

console.log(`${ORG}: ${remote.size} repository(ies) on GitHub, ${modules.length} module(s) in this workspace\n`);

const missing = [];
for (const { manifest } of modules) {
  const expected = `https://github.com/${ORG}/${manifest.id}`;
  const repository = remote.get(manifest.id);
  if (repository === undefined) {
    missing.push(manifest);
    console.log(`  MISSING   ${manifest.id.padEnd(20)} ${manifest.category.padEnd(12)} not created yet`);
    continue;
  }
  const visibility = repository.visibility.toLowerCase();
  const state = repository.isEmpty ? "empty" : `pushed ${repository.pushedAt.slice(0, 10)}`;
  const notes = [];
  // The manifest's `repository` is what the catalog publishes and what the
  // site links, so a mismatch is a broken link waiting to happen.
  if (manifest.repository !== expected) notes.push(`manifest says ${String(manifest.repository)}`);
  if (visibility !== "public") notes.push(`visibility is ${visibility}, expected public`);
  console.log(`  ${notes.length === 0 ? "OK      " : "CHECK   "}  ${manifest.id.padEnd(20)} ${manifest.category.padEnd(12)} ${state}${notes.length === 0 ? "" : ` (${notes.join("; ")})`}`);
}

if (missing.length === 0) {
  console.log(`\nEvery module has a repository in ${ORG}.`);
  process.exit(0);
}

if (!CREATE) {
  console.log(`\n${missing.length} repository(ies) would be created in ${ORG}:`);
  for (const manifest of missing) console.log(`  gh repo create ${ORG}/${manifest.id} --public`);
  console.log("\nRe-run with --create to create them. Nothing has been changed.");
  process.exit(0);
}

for (const manifest of missing) {
  const topics = ["keel", "keel-module", manifest.category, manifest.owner.group].filter(Boolean);
  execFileSync("gh", [
    "repo", "create", `${ORG}/${manifest.id}`,
    "--public",
    "--description", `${manifest.summary} Verified readable source for the KEEL module "${manifest.id}".`,
  ], { stdio: "inherit" });
  try {
    execFileSync("gh", ["repo", "edit", `${ORG}/${manifest.id}`, ...topics.flatMap((topic) => ["--add-topic", topic])], { stdio: "inherit" });
  } catch {
    console.error(`  (could not set topics on ${manifest.id}; the repository exists)`);
  }
  console.log(`  created ${ORG}/${manifest.id}`);
}
console.log(`\nCreated ${missing.length} repository(ies). They are empty: pushing module content is a separate step.`);
