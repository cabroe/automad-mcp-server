#!/usr/bin/env -S node --import tsx
/**
 * Pre-PR verification gate. Runs:
 *   1. build            (tsc, strict)
 *   2. lint             (eslint)
 *   3. test             (vitest run, full suite)
 *   4. test:coverage    (vitest + v8; thresholds in vitest.config.ts enforce 80% stmt / 70% branch)
 *   5. docs:sync --check  (fail if AUTOGEN markers drift)
 *
 * Exits non-zero on the first failure with a clear message naming the failing
 * step. The coverage gate is enforced by vitest's own `coverage.thresholds`
 * (single source of truth) — this script just surfaces the failure.
 *
 * Usage: npm run verify
 *        or:  node scripts/verify.ts
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

interface Step {
  name: string;
  run: () => void;
}

function npm(script: string): void {
  execFileSync("npm", ["run", script], { cwd: ROOT, stdio: "inherit" });
}

function verifyDocsCheck(): void {
  execFileSync("node", ["--import", "tsx", "scripts/sync.ts", "--check"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

const STEPS: Step[] = [
  { name: "build", run: () => npm("build") },
  { name: "lint", run: () => npm("lint") },
  { name: "test", run: () => npm("test") },
  { name: "test:coverage (thresholds gate)", run: () => npm("test:coverage") },
  { name: "docs:sync --check", run: () => verifyDocsCheck() },
];

function main(): void {
  for (const step of STEPS) {
    console.log(`\n=== ${step.name} ===`);
    try {
      step.run();
    } catch {
      console.error(`\nverify: step "${step.name}" failed.`);
      process.exit(1);
    }
  }
  console.log("\nverify: all gates passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
