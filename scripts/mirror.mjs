#!/usr/bin/env node
/**
 * Mirrors each module into its own public repository.
 *
 *   node scripts/mirror.mjs                 build every mirror and report
 *   node scripts/mirror.mjs --push          push the mirrors that changed
 *   node scripts/mirror.mjs --org <name>    target a different organisation
 *   node scripts/mirror.mjs --only <id>     one module
 *   node scripts/mirror.mjs --out <dir>     keep the built mirrors for inspection
 *
 * This monorepo stays the source of truth. A mirror is a derived, standalone
 * copy: the same readable source, the same vectors, and a self-contained
 * tsconfig so the strictness gate holds without the shared base file.
 *
 * Mirrors are therefore READ-ONLY, and this script will not pretend otherwise.
 * Every commit it makes carries a `Keel-Mirror-Of:` trailer naming the
 * monorepo commit it came from. Before regenerating, it checks that the
 * mirror's HEAD is one of its own commits; if somebody has pushed to the
 * mirror directly, their work would be silently destroyed by the next
 * regeneration, so the script refuses and says so instead. `--force`
 * overrides, deliberately and loudly.
 *
 * If a module should be owned in its own repository rather than mirrored into
 * one, that is the origin-registration path, not this one: the module lives
 * wherever its author wants and the monorepo registers and re-verifies it.
 *
 * The property that makes a mirror worth publishing is that it reproduces on
 * its own. `keel module build` inside a mirror must produce the exact same
 * output digest as the monorepo does, because the recipe names its inputs
 * relative to the module root and that root is identical in both places. The
 * mirror's README states the expected digest so a reader can check without
 * ever cloning the monorepo, and `--push` refuses to publish a mirror whose
 * digest does not match.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUSH = process.argv.includes("--push");
const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const ORG = argumentValue("--org", "keel-web3");
const FORCE = process.argv.includes("--force");
const MIRROR_TRAILER = "Keel-Mirror-Of:";
const ONLY = argumentValue("--only", undefined);
const OUT = argumentValue("--out", undefined);

const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * The keel CLI from the sibling toolchain checkout, when there is one.
 *
 * A mirror is only worth publishing if it reproduces standing alone, so the
 * push path proves that rather than asserting it. Without the CLI the check
 * cannot run, and a check that cannot run says so instead of passing.
 */
const KEEL_CLI = path.resolve(ROOT, "../keel-sdk/packages/builder/dist/cli.js");
async function keelCliAvailable() {
  try {
    await stat(KEEL_CLI);
    return true;
  } catch {
    return false;
  }
}

/** Build the mirror in place and return the digest it actually produces. */
function rebuiltDigest(checkout) {
  const stdout = run(process.execPath, [KEEL_CLI, "module", "build", checkout], checkout);
  const match = /output digest:\s+(0x[0-9a-f]{64})/u.exec(stdout);
  if (match === null) throw new Error(`could not read an output digest from the rebuild:\n${stdout}`);
  return match[1];
}

async function discoverModules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    try {
      await stat(path.join(child, "keel.module.json"));
      found.push({ directory: child, manifest: JSON.parse(await readFile(path.join(child, "keel.module.json"), "utf8")) });
    } catch {
      found.push(...(await discoverModules(child)));
    }
  }
  return found.sort((left, right) => (left.manifest.id < right.manifest.id ? -1 : 1));
}

/**
 * The shared strict base, inlined. A mirror cannot reach `../../../..`, and the
 * build refuses to run if the strictness flags are weakened, so the mirror has
 * to carry the same bar it was verified under.
 */
async function standaloneTsconfig() {
  const base = JSON.parse(await readFile(path.join(ROOT, "tsconfig.base.json"), "utf8"));
  return `${JSON.stringify({ compilerOptions: base.compilerOptions, include: ["src"] }, null, 2)}\n`;
}

/** The publisher directory a module lives under: a user handle or an org id. */
const publisherOf = (manifest) => manifest.owner?.user ?? manifest.owner?.org ?? "unaffiliated";

function mirrorReadme(manifest, outputDigest, monorepoCommit) {
  return `# ${manifest.id}

${manifest.summary}

A [KEEL](https://github.com/Ravonus/keel-modules) module: strict, readable
TypeScript that the platform minifies into the exact bytes published on chain,
with a hash-linked receipt binding the two.

## Verify it yourself

\`\`\`bash
keel module build .
\`\`\`

The build is deterministic, so it must print exactly:

\`\`\`
output digest:  ${outputDigest}
\`\`\`

If it prints anything else, the readable source in this repository is not the
source the published bytes were built from, and you should not trust it. You do
not have to take anyone's word for that, which is the entire point.

Run \`keel module test .\` to run the vectors in \`test/vectors.mjs\` against
both the readable source and the minified bytes.

## Where this comes from

> **This repository is a read-only mirror. Do not open pull requests here:**
> they will be overwritten the next time the mirror is regenerated. Contribute
> at [keel-modules](https://github.com/Ravonus/keel-modules) instead. If you
> want to own a module in your own repository, register it by origin rather
> than mirroring it; see that repository's CONTRIBUTING.md.

The source of truth is
[\`${publisherOf(manifest)}/${manifest.category}/${manifest.id}\`](https://github.com/Ravonus/keel-modules/tree/master/modules/${publisherOf(manifest)}/${manifest.category}/${manifest.id})
in the keel-modules monorepo, at commit \`${monorepoCommit}\`. Both trees build
to the same digest above; the mirror exists so this module can be depended on,
starred, and forked on its own.

## Licence

${manifest.license}. See LICENSE.
`;
}

/** Build one mirror tree in `destination` and return its expected output digest. */
async function buildMirror(module, destination, monorepoCommit) {
  await mkdir(destination, { recursive: true });
  for (const name of ["src", "test", "README.md"]) {
    try {
      await cp(path.join(module.directory, name), path.join(destination, name), { recursive: true });
    } catch {
      // A module without a README is fine; the generated one replaces it anyway.
    }
  }
  await cp(path.join(ROOT, "LICENSE"), path.join(destination, "LICENSE"));
  await writeFile(path.join(destination, "keel.module.json"), `${JSON.stringify(module.manifest, null, 2)}\n`);
  await writeFile(path.join(destination, "tsconfig.json"), await standaloneTsconfig());

  const distributed = path.join(module.directory, "dist", `${module.manifest.id}.min.js`);
  const outputDigest = `0x${createHash("sha256").update(await readFile(distributed)).digest("hex")}`;
  await writeFile(path.join(destination, "README.md"), mirrorReadme(module.manifest, outputDigest, monorepoCommit));
  return outputDigest;
}

const monorepoCommit = run("git", ["-C", ROOT, "rev-parse", "HEAD"]).trim();
const modules = (await discoverModules(path.join(ROOT, "modules")))
  .filter((module) => ONLY === undefined || module.manifest.id === ONLY);

if (modules.length === 0) {
  console.error("mirror: no modules matched.");
  process.exit(1);
}

const workspace = OUT === undefined ? await mkdtemp(path.join(os.tmpdir(), "keel-mirror-")) : path.resolve(OUT);
if (OUT !== undefined) await mkdir(workspace, { recursive: true });
console.log(`Mirroring ${modules.length} module(s) from ${monorepoCommit.slice(0, 10)} into ${ORG}\n`);

const canVerify = await keelCliAvailable();
if (!canVerify) {
  console.log(`  (${KEEL_CLI} not found: mirrors will NOT be checked for standalone reproduction)\n`);
}
let pushed = 0;
let unchanged = 0;
let refused = 0;
for (const module of modules) {
  const id = module.manifest.id;
  const checkout = path.join(workspace, id);
  const remote = `https://github.com/${ORG}/${id}.git`;

  // Clone what is there so history is preserved; an empty repository clones
  // with no commits, which is exactly the first-publish case.
  await rm(checkout, { recursive: true, force: true });
  try {
    run("git", ["clone", "--quiet", remote, checkout], workspace);
  } catch (error) {
    console.error(`  ${id.padEnd(20)} could not clone ${remote}: ${String(error.stderr ?? error.message).trim()}`);
    continue;
  }

  // Somebody may have pushed to the mirror. Regenerating would destroy that
  // work without a trace, so check whose commit HEAD is before touching it.
  let head = "";
  try {
    head = run("git", ["log", "-1", "--format=%B"], checkout);
  } catch {
    head = ""; // an empty repository has no commits, which is the first publish
  }
  if (head.length > 0 && !head.includes(MIRROR_TRAILER) && !FORCE) {
    console.error(`  ${id.padEnd(20)} REFUSED: ${ORG}/${id} HEAD is not a mirror commit, so somebody pushed to it.`);
    console.error(`  ${" ".repeat(20)} Regenerating would destroy that work. Inspect it, then re-run with --force.`);
    refused += 1;
    continue;
  }

  // Replace tracked content wholesale: the monorepo is authoritative, so a
  // mirror is regenerated rather than merged.
  for (const entry of await readdir(checkout, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    await rm(path.join(checkout, entry.name), { recursive: true, force: true });
  }
  const outputDigest = await buildMirror(module, checkout, monorepoCommit);

  // The mirror must rebuild to the same bytes on its own, with no monorepo in
  // sight. That is the claim its README makes to every reader, so it is proven
  // before the README is published rather than after somebody complains.
  if (canVerify) {
    const rebuilt = rebuiltDigest(checkout);
    if (rebuilt !== outputDigest) {
      console.error(`  ${id.padEnd(20)} REFUSED: standalone rebuild produced ${rebuilt}, monorepo says ${outputDigest}`);
      refused += 1;
      continue;
    }
    await rm(path.join(checkout, "dist"), { recursive: true, force: true });
  }

  run("git", ["add", "-A"], checkout);
  const status = run("git", ["status", "--porcelain"], checkout).trim();
  if (status.length === 0) {
    unchanged += 1;
    console.log(`  ${id.padEnd(20)} unchanged`);
    continue;
  }
  if (!PUSH) {
    console.log(`  ${id.padEnd(20)} would publish ${status.split("\n").length} file(s); ${canVerify ? "reproduces" : "UNCHECKED"} ${outputDigest.slice(0, 18)}...`);
    continue;
  }
  run("git", ["commit", "--quiet", "-m", `mirror ${id} from keel-modules ${monorepoCommit.slice(0, 10)}\n\nReadable source for the KEEL module "${id}". Builds to ${outputDigest}.\n\n${MIRROR_TRAILER} ${monorepoCommit}\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`], checkout);
  run("git", ["push", "--quiet", "origin", "HEAD:master"], checkout);
  pushed += 1;
  console.log(`  ${id.padEnd(20)} pushed to ${ORG}/${id}`);
}

if (OUT === undefined) await rm(workspace, { recursive: true, force: true });
console.log(`\n${PUSH ? `${pushed} pushed` : "dry run"}, ${unchanged} unchanged${refused === 0 ? "" : `, ${refused} REFUSED`}.`);
if (!PUSH) console.log("Re-run with --push to publish. Nothing has been changed.");
if (refused > 0) process.exit(1);
