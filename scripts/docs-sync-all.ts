#!/usr/bin/env -S node --import tsx
/**
 * One-shot docs refresh: run `docs:sync` (static markers, fast) and
 * `docs:sync:tests` (TESTCOUNT, spawns vitest) back-to-back. Use after the
 * test suite or capability registry changes.
 *
 *   npm run docs:sync:all
 *
 * Equivalent to:
 *   npm run docs:sync && npm run docs:sync:tests
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

const STEPS = [
  { label: "docs:sync", args: ["run", "docs:sync"] },
  { label: "docs:sync:tests", args: ["run", "docs:sync:tests"] },
];

for (const step of STEPS) {
  console.log(`\n=== ${step.label} ===`);
  execFileSync("npm", step.args, { cwd: ROOT, stdio: "inherit" });
}

console.log("\ndocs:sync:all: done.");
