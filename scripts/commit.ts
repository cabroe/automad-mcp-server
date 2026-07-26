#!/usr/bin/env -S node --import tsx
/**
 * Conventional Commits check + commit helper.
 *
 * Two modes:
 *   --check  : validates `git log -1` format. Used by pre-push hooks and CI.
 *   (no flag): runs `git commit -m <message>` after validating the message.
 *
 * Convention: <type>(<scope>): <subject>
 *   type:    feat | fix | refactor | docs | test | chore | build | perf | ci
 *   scope:   one of an allow-list derived from the source layout
 *            (e.g. domains/pages, theme, capabilities, client, auth,
 *            schemas, scripts, sync, release, ci, docs, deps, server)
 *   subject: lowercase or sentence-case, no trailing period, ≤72 chars.
 *
 * Subject line (with type+scope prefix) ≤ 100 chars total.
 *
 * Why a script and not lint-staged: the format is enforced everywhere
 * (pre-commit, pre-push, CI), and a single source of truth is easier to
 * audit than a regex embedded in each tool.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "chore",
  "build",
  "perf",
  "ci",
]);

const ALLOWED_SCOPES = new Set([
  "domains",
  "domains/pages",
  "domains/media",
  "domains/shared",
  "domains/config",
  "domains/site",
  "domains/theme",
  "domains/docs",
  "domains/discover",
  "theme",
  "capabilities",
  "client",
  "auth",
  "schemas",
  "write-guard",
  "server",
  "config",
  "index",
  "errors",
  "logger",
  "prompts",
  "scripts",
  "sync",
  "release",
  "verify",
  "smoke",
  "commit",
  "ci",
  "docs",
  "deps",
  "release",
  "homepage",
  "kb",
  "index",
]);

const SUBJECT_MAX = 72;
const TOTAL_MAX = 100;

const HEADER_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9._/-]+)\))?(?<bang>!)?: (?<subject>.+)$/;

export interface CommitCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkCommitMessage(message: string): CommitCheckResult {
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine) return { ok: false, reason: "empty commit message" };
  if (firstLine.length > TOTAL_MAX) {
    return {
      ok: false,
      reason: `header exceeds ${TOTAL_MAX} chars (got ${firstLine.length})`,
    };
  }
  const match = HEADER_RE.exec(firstLine);
  if (!match || !match.groups) {
    return {
      ok: false,
      reason:
        'header must match "<type>(<scope>): <subject>" (e.g. "feat(theme): dev action")',
    };
  }
  const { type, scope, subject } = match.groups;
  if (!ALLOWED_TYPES.has(type)) {
    return {
      ok: false,
      reason: `type "${type}" not in allow-list: ${[...ALLOWED_TYPES].join(", ")}`,
    };
  }
  if (scope && !ALLOWED_SCOPES.has(scope)) {
    return {
      ok: false,
      reason: `scope "${scope}" not in allow-list (see scripts/commit.ts)`,
    };
  }
  if (subject.length > SUBJECT_MAX) {
    return {
      ok: false,
      reason: `subject exceeds ${SUBJECT_MAX} chars (got ${subject.length})`,
    };
  }
  if (subject.endsWith(".")) {
    return { ok: false, reason: "subject must not end with a period" };
  }
  return { ok: true };
}

function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function getLastMessage(): string {
  return runGit(["log", "-1", "--pretty=%B"]);
}

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  const message = checkOnly ? getLastMessage() : args[0];

  if (!message) {
    console.error(
      "usage: scripts/commit.ts --check       # validate HEAD\n" +
        "       scripts/commit.ts '<message>'   # validate + commit",
    );
    process.exit(2);
  }

  const result = checkCommitMessage(message);
  if (!result.ok) {
    console.error(`commit: ${result.reason}`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log("commit: header OK");
    return;
  }

  execFileSync("git", ["commit", "-m", message], { cwd: ROOT, stdio: "inherit" });
  console.log("commit: header OK, committed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
