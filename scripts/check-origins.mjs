#!/usr/bin/env node
/**
 * Checks that every registered origin is still there and still serving the
 * same tree.
 *
 *   node scripts/check-origins.mjs
 *
 * This is the scheduled watchdog. A registration pins a foreign repository at
 * a commit and records the sha256 of the exact archive that was built. Those
 * facts can stop being true without anybody touching this repository: the
 * repository can be deleted or made private, the commit can be force-pushed
 * away and garbage collected, or the forge can start serving different bytes.
 * Nothing here would notice on its own, which is why this runs on a timer.
 *
 * ## What it can and cannot conclude
 *
 * It fetches each archive and hashes it. That needs nothing but Node, so it can
 * run in this repository's CI today, unlike a full rebuild.
 *
 * Three outcomes, and the third one matters:
 *
 *   OK          the archive is byte-identical to the one that was verified.
 *               The recipe pins the toolchain, so an identical archive rebuilds
 *               to identical bytes; nothing has moved.
 *   UNREACHABLE the archive could not be fetched. Deleted, private, or the
 *               commit is gone. The recorded digests are still true about
 *               bytes nobody can get any more, which is worth knowing.
 *   CHANGED     the archive hashed differently.
 *
 * CHANGED is deliberately NOT reported as "the source was tampered with".
 * Forges regenerate archives, and GitHub has changed its tarball compression
 * before, which moved checksums for every repository at once without a single
 * line of anybody's source changing. Concluding "compromised" from that would
 * cry wolf across the whole catalog. So CHANGED says what is actually known,
 * which is that the bytes differ and only a rebuild can say whether the SOURCE
 * differs. That rebuild is `keel module verify --all`.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TIMEOUT_MS = 30_000;

async function discoverRegistrations(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    const registrationPath = path.join(child, "keel.registration.json");
    try {
      await stat(registrationPath);
      found.push(JSON.parse(await readFile(registrationPath, "utf8")));
    } catch {
      found.push(...(await discoverRegistrations(child)));
    }
  }
  return found.sort((left, right) => (left.id < right.id ? -1 : 1));
}

function archiveUrl(origin) {
  if (origin.provider !== "github") throw new Error(`no archive resolver for provider "${origin.provider}"`);
  return `https://codeload.github.com/${origin.owner}/${origin.repo}/tar.gz/${origin.commit}`;
}

const registrations = await discoverRegistrations(path.join(ROOT, "modules"));

if (registrations.length === 0) {
  console.log("origin check: no registered origins in this workspace.");
  process.exit(0);
}

console.log(`origin check: ${registrations.length} registered origin(s)\n`);

let unreachable = 0;
let changed = 0;

for (const registration of registrations) {
  const { id, origin, expect } = registration;
  const label = `${origin.owner}/${origin.repo}@${origin.commit.slice(0, 10)}`;
  let response;
  try {
    response = await fetch(archiveUrl(origin), { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    unreachable += 1;
    console.error(`  UNREACHABLE  ${id.padEnd(20)} ${label}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  if (!response.ok) {
    unreachable += 1;
    console.error(`  UNREACHABLE  ${id.padEnd(20)} ${label}: HTTP ${response.status} (deleted, private, or the commit is gone)`);
    continue;
  }
  const digest = `0x${createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex")}`;
  if (digest === expect.archiveDigest) {
    console.log(`  OK           ${id.padEnd(20)} ${label}`);
    continue;
  }
  changed += 1;
  console.error(`  CHANGED      ${id.padEnd(20)} ${label}`);
  console.error(`  ${" ".repeat(13)}registered ${expect.archiveDigest}`);
  console.error(`  ${" ".repeat(13)}serving    ${digest}`);
}

const problems = unreachable + changed;
if (problems === 0) {
  console.log(`\nEvery registered origin is reachable and byte-identical.`);
  process.exit(0);
}
console.error(`\n${unreachable} unreachable, ${changed} changed.`);
if (changed > 0) {
  console.error(
    "A changed archive does NOT by itself mean the source changed: forges regenerate\n" +
    "archives and have altered tarball compression before, moving every checksum at\n" +
    "once. Run `keel module verify --all` to rebuild and find out which it is.",
  );
}
process.exit(1);
