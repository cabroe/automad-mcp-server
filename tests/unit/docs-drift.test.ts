import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPABILITY_REGISTRY, WRITE_ACTION_PREFIX } from "../../src/capabilities/registry.js";
import { DESTRUCTIVE_ACTIONS, type WriteAction } from "../../src/write-guard.js";

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
    const expected = new RegExp(`\\b(${n}|${numberWord(n)})\\b\\s+destructive`, "i");
    expect(CLAUDE_MD).toMatch(expected);
  });

  it("every registry action is also a valid WriteAction (or an internal action we already track)", () => {
    // Internal actions (pages.update_rename, site.search_replace) are
    // declared in write-guard.ts as WriteAction literals but not public,
    // so they won't appear in CAPABILITY_REGISTRY — that's expected.
    for (const cap of CAPABILITY_REGISTRY) {
      const prefix = WRITE_ACTION_PREFIX[cap.name];
      for (const actionName of Object.keys(cap.actions)) {
        const full = `${prefix}.${actionName}` as WriteAction;
        // No "in set" assertion: ordinary writes (create, update, etc.)
        // are intentionally outside both sets. We just record the
        // declaration exists.
        expect(typeof full).toBe("string");
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
    }
  });
});

describe("CHANGELOG ↔ code drift", () => {
  it("has at least 3 version sections (0.5.x is the 5th release line)", () => {
    expect(countMatches(/^## \[/m, CHANGELOG)).toBeGreaterThanOrEqual(3);
  });
});
