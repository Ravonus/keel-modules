#!/usr/bin/env node
// Points git at .githooks, so a fresh clone runs the pre-commit bar from its first `pnpm install`. Outside a
// checkout (a tarball, a vendored copy) there is nothing to point, and it says nothing.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

try {
  if (git("rev-parse", "--is-inside-work-tree") !== "true") process.exit(0);
} catch {
  process.exit(0);
}
let current = "";
try {
  current = git("config", "--get", "core.hooksPath");
} catch {
  // Unset: git exits 1, and we set it below.
}
if (current !== ".githooks") {
  git("config", "core.hooksPath", ".githooks");
  console.log("git hooks: core.hooksPath set to .githooks");
}
