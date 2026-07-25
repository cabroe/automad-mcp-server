#!/usr/bin/env -S node --import tsx
/**
 * Regenerate the auto-generated sections of README.md/CLAUDE.md from the
 * current source of truth (src/capabilities/registry.ts, src/write-guard.ts,
 * and — with --tests — a live vitest run). Idempotent: re-running produces
 * the same files.
 *
 * Usage:
 *   npm run docs:sync              # tool table + fast, pure number markers
 *   npm run docs:sync -- --check   # same, but exit 1 if anything was stale
 *   npm run docs:sync:tests        # also refreshes the TESTCOUNT marker
 *                                  # (spawns a full `vitest run`; slower)
 *
 * Design: never throws on a benign mismatch (e.g. a file lacks a given
 * marker). Every region is fenced with `<!-- AUTOGEN:NAME -->...<!-- /AUTOGEN:NAME -->`
 * per the repo convention ("auto-generated docs are fenced, not free-form") —
 * this script never regexes loose prose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { CAPABILITY_REGISTRY, callableActions } from "../src/capabilities/registry.js";
import { READ_ACTIONS, DESTRUCTIVE_ACTIONS } from "../src/write-guard.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const README = resolve(ROOT, "README.md");
const CLAUDE_MD = resolve(ROOT, "CLAUDE.md");
/** GitHub Pages landing page (served from /docs on main). */
const HOMEPAGE = resolve(ROOT, "docs", "index.html");

const START = "<!-- AUTOGEN:TOOLS:START -->";
const END = "<!-- AUTOGEN:TOOLS:END -->";

const HTML_START = "<!-- AUTOGEN:TOOLS_HTML:START -->";
const HTML_END = "<!-- AUTOGEN:TOOLS_HTML:END -->";

/** Build the auto-generated tool table from the capability registry. */
export function buildToolsTable(): string {
  const header = [
    "| Tool | Actions | What it does |",
    "|---|---|---|",
  ];
  const rows: string[] = [];
  for (const cap of CAPABILITY_REGISTRY) {
    // Internal, guard-only actions aren't callable, so they aren't documented.
    const actions = callableActions(cap).map(([action]) => `\`${action}\``).join(" ");
    const desc = humanize(cap.summary);
    rows.push(`| \`${cap.name}\` | ${actions} | ${desc} |`);
  }
  return [header.join("\n"), ...rows].join("\n");
}

/** Build the `<tr>` rows of the homepage's tool table from the same registry. */
export function buildToolsTableHtml(): string {
  const rows: string[] = [];
  for (const cap of CAPABILITY_REGISTRY) {
    const actions = callableActions(cap).map(([action]) => `<code>${escapeHtml(action)}</code>`).join(" ");
    const desc = escapeHtml(humanize(cap.summary));
    rows.push(`<tr><td><code>${escapeHtml(cap.name)}</code></td><td class="actions">${actions}</td><td>${desc}</td></tr>`);
  }
  return rows.join("\n");
}

/**
 * One-liner per tool. Strips a trailing period; the markdown table cell
 * is added by the caller, so the description ends without a dot.
 */
function humanize(description: string): string {
  return description.replace(/\.\s*$/, "");
}

/** Registry text is authored in this repo, but the page is HTML — escape anyway. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

/**
 * Replace the homepage's tool rows. Simpler than the README case: everything
 * between the markers is generated, there is no prose to preserve.
 */
export function syncHomepage(): { changed: boolean; reason: string } {
  const original = readFileSync(HOMEPAGE, "utf-8");
  const startIdx = original.indexOf(HTML_START);
  const endIdx = original.indexOf(HTML_END);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    return { changed: false, reason: "AUTOGEN markers not found in docs/index.html" };
  }
  const newBlock = `${HTML_START}\n${buildToolsTableHtml()}\n${HTML_END}`;
  if (original.includes(newBlock)) {
    return { changed: false, reason: "already in sync" };
  }
  const next = original.slice(0, startIdx) + newBlock + original.slice(endIdx + HTML_END.length);
  writeFileSync(HOMEPAGE, next, "utf-8");
  return { changed: true, reason: "homepage tool table regenerated" };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Replace every `<!-- AUTOGEN:NAME -->...<!-- /AUTOGEN:NAME -->` region in
 * `content` whose NAME is a key of `values` with that value. Regions whose
 * NAME isn't in `values`, or that don't appear in `content`, are left alone.
 */
function replaceMarkedRegions(content: string, values: Readonly<Record<string, string>>): { content: string; changedNames: string[] } {
  let result = content;
  const changedNames: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const start = `<!-- AUTOGEN:${name} -->`;
    const end = `<!-- /AUTOGEN:${name} -->`;
    const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, "g");
    if (!pattern.test(result)) continue;
    const replacement = `${start}${value}${end}`;
    const next = result.replace(pattern, replacement);
    if (next !== result) changedNames.push(name);
    result = next;
  }
  return { content: result, changedNames };
}

function syncMarkedNumbers(file: string, values: Readonly<Record<string, string>>): { changed: boolean; names: string[] } {
  const original = readFileSync(file, "utf-8");
  const { content, changedNames } = replaceMarkedRegions(original, values);
  if (content === original) return { changed: false, names: [] };
  writeFileSync(file, content, "utf-8");
  return { changed: true, names: changedNames };
}

/** Fast, pure values derived directly from the capability registry / write-guard — no subprocess. */
function computeStaticValues(): Record<string, string> {
  const toolCount = CAPABILITY_REGISTRY.length;
  const destructiveCount = DESTRUCTIVE_ACTIONS.size;
  return {
    TOOLCOUNT: String(toolCount),
    TOOLCOUNT_WORD: capitalize(numberWord(toolCount)),
    READCOUNT: String(READ_ACTIONS.size),
    DESTRUCTIVECOUNT: String(destructiveCount),
    DESTRUCTIVECOUNT_WORD: numberWord(destructiveCount),
  };
}

interface VitestTotals {
  tests: number;
  files: number;
}

/** Spawn a full `vitest run` with the JSON reporter and read back pass/file totals. */
function runVitestTotals(): VitestTotals {
  const outFile = resolve(ROOT, ".vitest-sync-report.json");
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vitest", "run", "--reporter=json", `--outputFile=${outFile}`],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
  );
  const report = JSON.parse(readFileSync(outFile, "utf-8")) as {
    numPassedTests: number;
    testResults: unknown[];
  };
  return { tests: report.numPassedTests, files: report.testResults.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isCheck = process.argv.includes("--check");
  const withTests = process.argv.includes("--tests");

  const tableResult = syncReadme();
  const homepageResult = syncHomepage();
  const values = computeStaticValues();
  if (withTests) {
    const totals = runVitestTotals();
    values.TESTCOUNT = `${totals.tests} tests, ${totals.files} files`;
  }

  const numberResults = [README, CLAUDE_MD, HOMEPAGE].map((file) => ({ file, ...syncMarkedNumbers(file, values) }));
  const anyChanged = tableResult.changed || homepageResult.changed || numberResults.some((r) => r.changed);
  const summary = [
    `tools table: ${tableResult.reason}`,
    `homepage table: ${homepageResult.reason}`,
    ...numberResults.map((r) => `${r.file.split("/").pop()}: ${r.changed ? `updated (${r.names.join(", ")})` : "already in sync"}`),
  ].join("; ");

  if (isCheck) {
    if (anyChanged) {
      // eslint-disable-next-line no-console
      console.error(`docs:sync --check: FAILED — docs are out of date (${summary}). Run \`npm run docs:sync\` and commit.`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`docs:sync --check: OK (${summary})`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`docs:sync: ${anyChanged ? "updated" : "no change"} (${summary})`);
  }
}
