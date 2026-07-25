#!/usr/bin/env -S node --import tsx
/**
 * Regenerate the auto-generated sections of README.md from the current
 * source of truth (src/capabilities/registry.ts). Idempotent: re-running
 * produces the same README.
 *
 * Usage: npm run docs:sync
 *
 * Design: the script never throws on a benign mismatch (e.g. the README
 * does not yet contain the AUTOGEN markers). It only edits the file if
 * the auto-generated block is actually out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITY_REGISTRY } from "../src/capabilities/registry.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const README = resolve(ROOT, "README.md");

const START = "<!-- AUTOGEN:TOOLS:START -->";
const END = "<!-- AUTOGEN:TOOLS:END -->";

/** Build the auto-generated tool table from the capability registry. */
export function buildToolsTable(): string {
  const header = [
    "| Tool | Actions | What it does |",
    "|---|---|---|",
  ];
  const rows: string[] = [];
  for (const cap of CAPABILITY_REGISTRY) {
    const actionNames = Object.keys(cap.actions);
    const actions = actionNames.map((a) => `\`${a}\``).join(" ");
    const desc = humanize(cap.description);
    rows.push(`| \`${cap.name}\` | ${actions} | ${desc} |`);
  }
  return [header.join("\n"), ...rows].join("\n");
}

/**
 * One-liner per tool. Strips a trailing period; the markdown table cell
 * is added by the caller, so the description ends without a dot.
 */
function humanize(description: string): string {
  return description.replace(/\.\s*$/, "");
}

export function syncReadme(): { changed: boolean; reason: string } {
  const original = readFileSync(README, "utf-8");
  const startIdx = original.indexOf(START);
  const endIdx = original.indexOf(END);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    return { changed: false, reason: "AUTOGEN markers not found in README" };
  }
  // Slice the region between the markers. Drop any markdown-table lines
  // (so an existing stale table is removed) and keep everything else
  // (the comment block, blank lines, etc).
  const between = original.slice(startIdx + START.length, endIdx);
  const keepLines: string[] = [];
  let inTable = false;
  for (const line of between.split("\n")) {
    if (/^\s*\|/.test(line)) { inTable = true; continue; }
    if (inTable && line.trim() === "") { inTable = false; continue; }
    if (inTable) continue;
    keepLines.push(line);
  }
  const prelude = keepLines.join("\n").replace(/^\n+|\n+$/g, "");
  const newBlock = `${START}\n${prelude}\n${buildToolsTable()}\n${END}`;
  if (original.includes(newBlock)) {
    return { changed: false, reason: "already in sync" };
  }
  const next = original.slice(0, startIdx) + newBlock + original.slice(endIdx + END.length);
  writeFileSync(README, next, "utf-8");
  return { changed: true, reason: "tool table regenerated" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isCheck = process.argv.includes("--check");
  const { changed, reason } = syncReadme();
  if (isCheck) {
    if (changed) {
      // eslint-disable-next-line no-console
      console.error(`docs:sync --check: FAILED — README is out of date (${reason}). Run \`npm run docs:sync\` and commit.`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`docs:sync --check: OK (${reason})`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`docs:sync: ${changed ? "updated" : "no change"} (${reason})`);
  }
}
