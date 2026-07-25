import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPABILITY_REGISTRY, callableActions, writeActionOf } from "../../src/capabilities/registry.js";
import { DESTRUCTIVE_ACTIONS, READ_ACTIONS } from "../../src/write-guard.js";

/**
 * Regression guard: prevent CLAUDE.md from quietly drifting away from the
 * code reality. The checks are deliberately narrow — they only pin the
 * numbers that have historically drifted (test count, destructive-action
 * count, beta version reference).
 */

const ROOT = resolve(__dirname, "..", "..");
const CLAUDE_MD = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf-8");
const README = readFileSync(resolve(ROOT, "README.md"), "utf-8");
const CHANGELOG = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf-8");

/** Count non-overlapping matches of a regex in a string. */
function countMatches(pattern: RegExp, source: string): number {
  const re = new RegExp(pattern.source, pattern.flags + "g");
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of source.matchAll(re)) n++;
  return n;
}

function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return words[n] ?? String(n);
}

describe("CLAUDE.md ↔ code drift", () => {
  it("README and CLAUDE.md mention a recent v2 beta (sanity-pinned to beta.5x)", () => {
    // Pinned to a "beta.5x" range: 50-59. If you upgrade the docker tag,
    // update both README and CLAUDE.md (and this test) in the same commit.
    expect(README).toMatch(/beta\.5\d/);
    expect(CLAUDE_MD).toMatch(/beta\.5\d/);
  });

  it("destructive-action count in CLAUDE.md matches DESTRUCTIVE_ACTIONS set", () => {
    const n = DESTRUCTIVE_ACTIONS.size;
    // Accept the digit or the spelled-out word; both forms appear in prose.
    // Tolerate an AUTOGEN end-marker comment between the number/word and
    // "destructive" (scripts/sync.ts wraps it in <!-- AUTOGEN:... --> tags).
    const expected = new RegExp(`\\b(${n}|${numberWord(n)})\\b(?:<!--[^>]*-->)?\\s+destructive`, "i");
    expect(CLAUDE_MD).toMatch(expected);
  });

  it("every registry action classifies into the guard sets the docs describe", () => {
    // Ordinary writes (create, update, …) are intentionally in neither set:
    // they run directly in `confirm-destructive` mode.
    for (const cap of CAPABILITY_REGISTRY) {
      for (const [actionName, meta] of Object.entries(cap.actions)) {
        const full = writeActionOf(cap.name, actionName);
        expect(READ_ACTIONS.has(full), full).toBe(meta.readOnly);
        expect(DESTRUCTIVE_ACTIONS.has(full), full).toBe(meta.destructive);
      }
    }
  });
});

describe("README ↔ code drift", () => {
  it("the AUTOGEN tools table lists every registry tool exactly once", () => {
    const startMarker = "<!-- AUTOGEN:TOOLS:START -->";
    const endMarker = "<!-- AUTOGEN:TOOLS:END -->";
    const start = README.indexOf(startMarker);
    const end = README.indexOf(endMarker);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = README.slice(start, end);
    for (const cap of CAPABILITY_REGISTRY) {
      expect(block, `missing tool ${cap.name} in AUTOGEN block`).toContain(`\`${cap.name}\``);
      for (const [action] of callableActions(cap)) {
        expect(block, `missing action ${cap.name}.${action} in AUTOGEN block`).toContain(`\`${action}\``);
      }
      for (const [action, meta] of Object.entries(cap.actions)) {
        // Internal, guard-only actions must never leak into the generated table.
        if (meta.internal) expect(block, `internal ${action} leaked into AUTOGEN block`).not.toContain(`\`${action}\``);
      }
    }
  });
});

describe("CHANGELOG ↔ code drift", () => {
  it("has at least 3 version sections (0.5.x is the 5th release line)", () => {
    expect(countMatches(/^## \[/m, CHANGELOG)).toBeGreaterThanOrEqual(3);
  });
});
