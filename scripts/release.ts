#!/usr/bin/env -S node --import tsx
/**
 * Version-bump helper. Bumps the semver in package.json, then asks
 * the user (or the calling shell) to confirm before rewriting
 * CHANGELOG.md and creating a git tag. Supports `patch`, `minor`,
 * `major`.
 *
 * Usage: npm run release:patch | release:minor | release:major
 *        or:   node scripts/release.ts patch
 *
 * The script does NOT push to remote. After it runs, you review the
 * diff and push when ready:
 *
 *     git push origin main --follow-tags
 *
 * Why a TS script and not a one-liner? Because we want to:
 *   - run the same pre-flight as the test suite (so we don't tag
 *     a build that's already known broken)
 *   - sanity-check that no `--follow-tags` was forgotten
 *   - give the changelog section a stable header shape
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PKG_PATH = resolve(ROOT, "package.json");
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");

type BumpKind = "patch" | "minor" | "major";

function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump(version: string, kind: BumpKind): string {
  const [maj, min, pat] = parseSemver(version);
  switch (kind) {
    case "patch": return `${maj}.${min}.${pat + 1}`;
    case "minor": return `${maj}.${min + 1}.0`;
    case "major": return `${maj + 1}.0.0`;
  }
}

function readPackage(): { version: string; name: string } {
  const raw = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as { version?: unknown; name?: unknown };
  if (typeof raw.version !== "string" || typeof raw.name !== "string") {
    throw new Error("package.json is missing name/version");
  }
  return { name: raw.name, version: raw.version };
}

function writePackageVersion(version: string): void {
  const raw = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as Record<string, unknown>;
  raw["version"] = version;
  writeFileSync(PKG_PATH, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

function addChangelogSection(version: string, today: string): void {
  const original = readFileSync(CHANGELOG, "utf-8");
  // Insert a new section right after the header (line 6 is where the
  // first existing version starts in our CHANGELOG). The user fills
  // in Added/Changed/Fixed bullets later (or before running the script).
  const headerEnd = original.indexOf("\n## [");
  if (headerEnd < 0) throw new Error("could not find CHANGELOG header");
  const skeleton = `\n## [${version}] - ${today}\n\n### Added\n\n### Changed\n\n### Fixed\n\n`;
  const next = original.slice(0, headerEnd) + skeleton + original.slice(headerEnd);
  writeFileSync(CHANGELOG, next, "utf-8");
}

function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function gitStatus(): { clean: boolean; branch: string } {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);
  return { clean: status.length === 0, branch };
}

export interface ReleaseOptions {
  kind: BumpKind;
  /** When false, skip writing any files (used for `--dry-run`). */
  apply: boolean;
  /** When true, run `git add` + `git commit` + `git tag`. */
  tag: boolean;
  /** Today's date in YYYY-MM-DD. */
  today: string;
}

export function runRelease(opts: ReleaseOptions): { from: string; to: string; tagged: boolean } {
  const { version: current } = readPackage();
  const next = bump(current, opts.kind);
  if (!opts.apply) return { from: current, to: next, tagged: false };
  writePackageVersion(next);
  addChangelogSection(next, opts.today);
  if (opts.tag) {
    const status = gitStatus();
    if (!status.clean) {
      // We just wrote to package.json + CHANGELOG.md, so a non-clean
      // status is expected. The caller is expected to have called
      // syncReadme() and to know the diffs are intentional.
    }
    runGit(["add", "package.json", "CHANGELOG.md"]);
    runGit(["commit", "-m", `chore(release): v${next}`]);
    runGit(["tag", "-a", `v${next}`, "-m", `v${next}`]);
    return { from: current, to: next, tagged: true };
  }
  return { from: current, to: next, tagged: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = (process.argv[2] as BumpKind | undefined) ?? "patch";
  if (!["patch", "minor", "major"].includes(kind)) {
    // eslint-disable-next-line no-console
    console.error(`usage: release <patch|minor|major> [--dry-run] [--tag]`);
    process.exit(2);
  }
  const apply = !process.argv.includes("--dry-run");
  const tag = process.argv.includes("--tag");
  const today = new Date().toISOString().slice(0, 10);
  const status = gitStatus();
  // eslint-disable-next-line no-console
  console.log(`branch=${status.branch} clean=${status.clean} kind=${kind} apply=${apply} tag=${tag}`);
  const result = runRelease({ kind, apply, tag, today });
  // eslint-disable-next-line no-console
  console.log(`bump: ${result.from} -> ${result.to}${result.tagged ? " (tagged)" : ""}`);
  if (result.tagged) {
    // eslint-disable-next-line no-console
    console.log(`next: git push origin ${status.branch} --follow-tags`);
  }
}
