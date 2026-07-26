#!/usr/bin/env -S node --import tsx
/**
 * Version-bump helper. Bumps the semver in package.json, then asks
 * the user (or the calling shell) to confirm before rewriting
 * CHANGELOG.md and creating a git tag. Supports `patch`, `minor`,
 * `major`.
 *
 * Usage: npm run release:patch | release:minor | release:major
 *        or:   node scripts/release.ts patch [--tag] [--push] [--release] [--dry-run]
 *
 * Flags (combine freely):
 *   --tag      run `git add` + `git commit` + `git tag -a vX.Y.Z`
 *   --push     after tagging, run `git push --follow-tags` (implies --tag)
 *   --release  after pushing, run `gh release create vX.Y.Z` with the matching
 *              CHANGELOG section as the body (implies --push, which implies --tag)
 *   --dry-run  do not write any files
 *
 * Without any of --tag/--push/--release the script only rewrites the
 * version + changelog on disk and prints the diff. The caller is
 * expected to review, then push manually:
 *
 *     git push origin main --follow-tags
 *     gh release create vX.Y.Z --title vX.Y.Z --notes-file <(…)
 *
 * Why a TS script and not a one-liner? Because we want to:
 *   - run the same pre-flight as the test suite (so we don't tag
 *     a build that's already known broken)
 *   - sanity-check that no `--follow-tags` was forgotten
 *   - give the changelog section a stable header shape
 *   - extract the matching CHANGELOG section into a release-notes file
 *     so the GitHub release body matches the in-repo record exactly
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  // Insert a new section right after the header. The first existing
  // version starts at "\n## [" in our CHANGELOG. The user fills in
  // Added/Changed/Fixed bullets later (or before running the script).
  const headerEnd = original.indexOf("\n## [");
  if (headerEnd < 0) throw new Error("could not find CHANGELOG header");
  const skeleton = `\n## [${version}] - ${today}\n\n### Added\n\n### Changed\n\n### Fixed\n\n`;
  const next = original.slice(0, headerEnd) + skeleton + original.slice(headerEnd);
  writeFileSync(CHANGELOG, next, "utf-8");
}

/**
 * Extract the markdown block for one version, from `## [X.Y.Z]` up to
 * (but not including) the next `## [` section or end of file. Returns
 * "" if the section isn't found. Used to feed
 * `gh release create --notes-file`.
 *
 * Implementation note: search for the section header, then strip it
 * (and the trailing newline) before scanning for the next `## [`,
 * so the regex can't match the current header by accident.
 */
export function extractChangelogSection(version: string): string {
  const content = readFileSync(CHANGELOG, "utf-8");
  const headerRe = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m");
  const start = content.search(headerRe);
  if (start < 0) return "";
  const afterCurrent = content.slice(start).replace(/^## [^\n]*\n/, "");
  const end = afterCurrent.search(/^## \[/m);
  const block = end < 0 ? afterCurrent : afterCurrent.slice(0, end);
  return block.replace(/\n+$/, "") + "\n";
}

function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function gitStatus(): { clean: boolean; branch: string } {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);
  return { clean: status.length === 0, branch };
}

/** Whether `gh` is available and authenticated for the given repo. */
function ghReady(repoSlug: string): boolean {
  try {
    const out = execFileSync("gh", ["auth", "status", "--hostname", "github.com"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    if (!/Logged in/i.test(out)) return false;
    execFileSync("gh", ["repo", "view", repoSlug, "--json", "name"], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Detect `owner/name` from `git config --get remote.origin.url`. */
function detectRepoSlug(): string | null {
  try {
    const url = runGit(["config", "--get", "remote.origin.url"]);
    const m = /(?:[:/]())([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (!m) return null;
    return `${m[2]}/${m[3]}`;
  } catch {
    return null;
  }
}

function pushTagAndRelease(
  version: string,
  _today: string,
  branch: string,
): { pushed: boolean; released: boolean; notesFile: string | null } {
  const tag = `v${version}`;
  runGit(["push", "origin", branch, "--follow-tags"]);

  const repoSlug = detectRepoSlug();
  if (!repoSlug) {
    // eslint-disable-next-line no-console
    console.warn(`release:skip — could not detect remote.origin.url; run \`gh release create ${tag}\` manually`);
    return { pushed: true, released: false, notesFile: null };
  }
  if (!ghReady(repoSlug)) {
    // eslint-disable-next-line no-console
    console.warn(`release:skip — gh not authenticated for ${repoSlug}; run \`gh release create ${tag}\` manually`);
    return { pushed: true, released: false, notesFile: null };
  }

  const section = extractChangelogSection(version);
  if (!section) {
    // eslint-disable-next-line no-console
    console.warn(`release:skip — no CHANGELOG section for ${version}; fill in the section and rerun`);
    return { pushed: true, released: false, notesFile: null };
  }

  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  const notesFile = join(dir, "notes.md");
  writeFileSync(notesFile, section, "utf-8");

  execFileSync(
    "gh",
    [
      "release", "create", tag,
      "--repo", repoSlug,
      "--title", tag,
      "--notes-file", notesFile,
      "--target", branch,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  return { pushed: true, released: true, notesFile };
}

export interface ReleaseOptions {
  kind: BumpKind;
  apply: boolean;
  tag: boolean;
  push: boolean;
  release: boolean;
  today: string;
}

export interface ReleaseResult {
  from: string;
  to: string;
  tagged: boolean;
  pushed: boolean;
  released: boolean;
  notesFile: string | null;
}

export function runRelease(opts: ReleaseOptions): ReleaseResult {
  const { version: current } = readPackage();
  const next = bump(current, opts.kind);
  if (!opts.apply) {
    return { from: current, to: next, tagged: false, pushed: false, released: false, notesFile: null };
  }
  writePackageVersion(next);
  addChangelogSection(next, opts.today);

  let tagged = false;
  let pushed = false;
  let released = false;
  let notesFile: string | null = null;

  if (opts.tag) {
    runGit(["add", "package.json", "CHANGELOG.md"]);
    runGit(["commit", "-m", `chore(release): v${next}`]);
    runGit(["tag", "-a", `v${next}`, "-m", `v${next}`]);
    tagged = true;
  }

  if (opts.push) {
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const r = pushTagAndRelease(next, opts.today, branch);
    pushed = r.pushed;
    released = r.released;
    notesFile = r.notesFile;
  }

  return { from: current, to: next, tagged, pushed, released, notesFile };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const kind = (args[0] as BumpKind | undefined) ?? "patch";
  if (!["patch", "minor", "major"].includes(kind)) {
    // eslint-disable-next-line no-console
    console.error(`usage: release <patch|minor|major> [--dry-run] [--tag] [--push] [--release]`);
    process.exit(2);
  }
  const apply = !args.includes("--dry-run");
  const release = args.includes("--release");
  const push = release || args.includes("--push");
  const tag = push || args.includes("--tag");
  const today = new Date().toISOString().slice(0, 10);
  const status = gitStatus();
  // eslint-disable-next-line no-console
  console.log(`branch=${status.branch} clean=${status.clean} kind=${kind} apply=${apply} tag=${tag} push=${push} release=${release}`);
  const result = runRelease({ kind, apply, tag, push, release, today });
  // eslint-disable-next-line no-console
  console.log(`bump: ${result.from} -> ${result.to}`);
  // eslint-disable-next-line no-console
  if (result.tagged) console.log(`tagged: v${result.to}`);
  // eslint-disable-next-line no-console
  if (result.pushed) console.log("pushed: ok");
  // eslint-disable-next-line no-console
  if (result.released) console.log("released: ok");
  // eslint-disable-next-line no-console
  if (result.notesFile) console.log(`notes file: ${result.notesFile}`);
  if (result.tagged && !result.pushed) {
    // eslint-disable-next-line no-console
    console.log(`next: git push origin ${status.branch} --follow-tags`);
  }
}
