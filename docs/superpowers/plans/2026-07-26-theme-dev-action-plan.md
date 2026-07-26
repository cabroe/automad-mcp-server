# Theme Dev Server Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `automad_theme` with `dev`, `dev_stop`, `dev_status` actions that run `npm run dev` for a scaffolded theme as a detached background process, persist its metadata under the theme's `.automad-mcp/` directory, and surface a stable URL via a `package.json` scripts heuristic followed by log-scan port discovery.

**Architecture:** Add a pure helper module `src/theme/dev.ts` that consumes the (extended) `ThemeFs` interface for ALL filesystem work — including the dev log — and `runCommand` from `src/theme/build.ts` for `npm install`. A new `detachSpawn` helper in `src/theme/dev.ts` (sibling of `runCommand`) wraps `child_process.spawn(detached:true).unref()` for the long-lived `npm run dev`. Three new action entries go into the capability registry, dispatching through `src/domains/theme.ts`, with re-exports via `src/theme/manager.ts` for facade consistency. A pre-copy drift audit (`assertStarterKitLayout`) is injected into `src/theme/scaffold.ts`. The `BUILD` error code is added to `src/errors.ts` so `npm install` / `npm run dev` failures can be classified distinctly from `VALIDATION` / `CONFLICT`. No new runtime dependencies.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Zod, Vitest, existing `ThemeFs` (extended), capability registry, WriteGuard, `child_process.spawn` (host).

---

## Global Constraints

- All three new actions surface through `automad_theme.{dev,dev_stop,dev_status}`. The `action` enum on `themeInput` is derived from the registry (`actionEnum`); manual edits to `src/schemas.ts` are limited to adding an optional `port` field.
- `src/theme/dev.ts` MUST NOT import `node:fs`/`node:fs/promises` directly. ALL log file writes (append + rotation) and log-tail reads go through newly added `ThemeFs` methods (`appendLog` / `readLogTail`). Process spawn is permitted (one place only: `detachSpawn`).
- `src/theme/scaffold.ts` runs `assertStarterKitLayout` strictly before `copyDir`. Audit miss ⇒ `VALIDATION`, no files written.
- `dev` and `dev_stop` join the destructive set (WriteGuard derives from the registry, no manual edits).
- `dev_status` is read-only (joins `READ_ACTIONS` via the registry).
- `src/capabilities/tools.ts` MUST NOT be touched — the binding loop automatically picks up new actions from the registry.
- `BUILD` is added to `AutomadErrorCode`; `errorToJson` is unaffected (the existing pass-through handles any string literal in the union).
- The stale fixture at `tests/unit/theme/manager.test.ts` (still references removed `ThemeFs.readDir` / `removeDir` / `isDir` methods) is replaced as part of Task 7.
- Existing tests must remain green; coverage stays at 80% stmt / 70% branch gate.
- Tests do not require a live Automad instance. A single happy-path live spawn is gated on `npm` being on `PATH` and skipped otherwise.
- No new runtime dependencies.

---

## File Map

- Extend `src/theme/fs.ts:12-21` (`ThemeFs` interface) with `appendLog(path, content)` and `readLogTail(path, maxBytes)` (returns string). Both throw on missing/unwritable paths and enforce an internal rotation cap.
- Modify `src/theme/fs.ts:24-92` (`LocalThemeFs`) to implement the new methods using `node:fs` (the only place the local implementation may import `node:fs`).
- Add `BUILD` to the `AutomadErrorCode` union in `src/errors.ts:1-10`.
- Create `src/theme/dev.ts`: helper module — `startDev`, `stopDev`, `getDevStatus`, `assertStarterKitLayout`, `detachSpawn`, `parseScriptsPort`, port regex / patterns.
- Modify `src/capabilities/registry.ts:135-159` (`automad_theme` block) to add `dev`, `dev_stop`, `dev_status`. Refresh the `description` summary string.
- Modify `src/domains/theme.ts:17-32` (`ACTION_MAP`) and `src/domains/theme.ts:74-151` (switch cases) to dispatch the three new actions. Pass the resolved theme path through.
- Modify `src/theme/scaffold.ts:73-74` (call `assertStarterKitLayout(starterKitPath, fs)` immediately before `fs.copyDir`).
- Modify `src/theme/manager.ts` (re-export the new helpers for facade consistency).
- Modify `src/schemas.ts:142-163` to add optional `port: z.number().int().min(1).max(65535).optional()`.
- Create `tests/unit/theme-dev.test.ts` (drift audit + dev lifecycle). Tests use a `FakeThemeFs` + `FakeCommandRunner` defined locally inside the test file.
- Modify `tests/unit/theme-fs.test.ts` to cover the new `appendLog` / `readLogTail` methods (rotation, tail size cap).
- Modify `tests/unit/schemas.test.ts` to accept `port`, reject out-of-range, accept `action: "dev"`.
- Modify `tests/unit/capabilities.test.ts:42-44` to extend the advertised-action snapshot for `automad_theme`.
- Modify `tests/unit/write-guard.test.ts` to assert the destructive/read classification of `theme.dev`, `theme.dev_stop`, `theme.dev_status`.
- Modify `tests/unit/domains/theme.test.ts` to dispatch-test the three new actions plus drift rejection in `scaffold`.
- Modify `tests/unit/theme-scaffold.test.ts` to (a) populate the fixture with the canonical layout (`components/`, `blocks/`, `client/index.ts`, `esbuild.js`) and (b) add the drift-rejection test.
- Replace `tests/unit/theme/manager.test.ts` to use the current `ThemeFs` interface (read `/read/`/writeFile/list/mkdirp/remove/copyDir/isDirectory) — the existing fixture references methods that no longer exist and currently fails typecheck if the test passes through TS.
- No changes to `package.json`; `npm run docs:sync` regenerates README/CLAUDE/docs/index.html markers.

---

## Shared Interfaces

```ts
// src/theme/fs.ts — additions
export interface ThemeFs {
  exists(p: string): Promise<boolean>;
  isDirectory(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  list(p: string, opts?: { recursive?: boolean; extensions?: string[] }): Promise<string[]>;
  mkdirp(p: string): Promise<void>;
  remove(p: string, opts?: { recursive?: boolean }): Promise<void>;
  copyDir(src: string, dest: string): Promise<void>;
  /** Append `content` to `p`; create parent dir if missing; rotate to ≤1 MiB keeping tail 256 KiB. */
  appendLog(p: string, content: string): Promise<void>;
  /** Read up to `maxBytes` from the tail of `p`; returns "" if missing. */
  readLogTail(p: string, maxBytes: number): Promise<string>;
}
```

```ts
// src/errors.ts — addition
export type AutomadErrorCode =
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "BUILD"            // ← added; npm install / npm run dev failures
  | "NETWORK"
  | "RATE_LIMITED"
  | "UNSUPPORTED"
  | "UNKNOWN";
```

```ts
// src/theme/dev.ts — new
import type { ThemeFs } from "./fs.js";

export interface DevRecord {
  pid: number;
  port: number | null;
  startedAt: string;        // ISO 8601 UTC
  logPath: string;
  url: string | null;
  /** True iff `process.kill(pid, 0)` returned truthy at observation time. */
  running: boolean;
}

export interface StartDevOptions {
  cwd: string;                              // theme root
  fs: ThemeFs;
  portHint?: number;                        // explicit override (1..65535)
  portTimeoutMs?: number;                   // default 20_000
  logMaxBytes?: number;                     // tail-read size, default 16 KiB
  /** Test seam: override spawn. Default = real spawn(detached:true). */
  spawn?: SpawnFn;
  /** Test seam: override `npm install` runner. Default = `build.runCommand`. */
  runInstall?: RunCommandFn;
  /** Test seam: hook for log chunks from the spawned child. */
  onLogChunk?: (chunk: string) => void;
  /** Test seam: replace the liveness probe (`process.kill(pid, 0)`). */
  kill0?: (pid: number) => boolean;
}

export interface StartDevResult extends DevRecord { running: true; }
export interface StopDevResult {
  stopped: boolean;                         // false when nothing to stop
  signalUsed?: "SIGTERM" | "SIGKILL";
  wasLive: boolean;                         // whether dev.json existed
}

export interface DevSpawnHandle {
  pid: number;
  unref(): void;
  kill(signal: NodeJS.Signals): boolean;
  exited(): Promise<void>;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; detached: boolean },
) => DevSpawnHandle;
export type RunCommandFn = typeof import("./build.js").runCommand;

/** Strict pre-copy audit on the starter kit checkout. */
export async function assertStarterKitLayout(
  starterKitPath: string,
  fs: ThemeFs,
): Promise<void>;

/** Lifecycle. Pure w.r.t. ThemeFs; the only side effect is fork+exec via spawn / runInstall. */
export async function startDev(opts: StartDevOptions): Promise<StartDevResult>;
export async function stopDev(
  cwd: string,
  fs: ThemeFs,
  deps?: {
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    alive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<StopDevResult>;
export async function getDevStatus(
  cwd: string,
  fs: ThemeFs,
  deps?: { alive?: (pid: number) => boolean },
): Promise<DevRecord | null>;
```

Internal constants:

```ts
/** Required entries in the starter kit, in canonical order. */
export const REQUIRED_LAYOUT = [
  "theme.json",
  "components",
  "blocks",
  "client/index.ts",
  "esbuild.js",
] as const;

/** Filesystem-side constants for the dev log. */
export const DEV_DIR        = ".automad-mcp";
export const DEV_RECORD     = "dev.json";
export const DEV_LOG        = "dev.log";
export const LOG_CAP_BYTES  = 1_048_576;        // 1 MiB
export const LOG_TAIL_KEEP  = 256 * 1024;       // 256 KiB tail kept when truncating

/** Match `http://localhost:NNNN` or `http://127.0.0.1:NNNN`; capture only the port. */
export const PORT_REGEX = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{4,5})(?=\b|$)/;
```

`scripts.dev` port heuristic — applied BEFORE the log scan. Order:
1. Explicit `--port N` (vite / esbuild / micro / astro style): `--port(?:=|[\s])(\d{4,5})`.
2. `PORT=N` (also accept `BROWSER=none` style); match `(?:^|\s)PORT=(\d{4,5})\b`.
3. `PORT N` shell form: `(?:^|\s)PORT[=\s](\d{4,5})\b`.

```ts
/** Returns the first plausible port hint from `package.json` scripts.dev, or `null`. */
export function parseScriptsPort(devScript: string): number | null {
  if (!devScript) return null;
  const re = /(?:--port(?:=|\s+)(\d{4,5}))|(?:^|\s)PORT[=\s](\d{4,5})\b/;
  const m = re.exec(devScript);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : null;
}
```

---

## Preflight

Before any code changes, the executing session must verify the harness and prove the new code can run cleanly:

- [ ] **Preflight 1 — Clean tree.** Run `git status --short --branch` from the repo root. If anything is dirty other than `node_modules`-related noise and tracked docs drift, stop and reconcile first.
- [ ] **Preflight 2 — Baseline build green.** Run `npm run build` from the repo root. Must exit 0 before any change. If TypeScript is red, fix first — do not stack fixes on top.
- [ ] **Preflight 3 — Baseline tests green.** Run `npm test -- --reporter=dot`. There is a known failing test, `tests/unit/theme/manager.test.ts`, because it still references removed `ThemeFs` methods (`readDir`/`removeDir`/`isDir`). Note the failure but do NOT pre-emptively fix it here — Task 7 fixes it as part of this work.
- [ ] **Preflight 4 — Starter kit reachable.** Confirm a starter kit checkout exists at `AUTOMAD_STARTER_KIT_PATH`. If absent, clone `automadcms/automad-theme-starter-kit` to a temp dir and set the env var for the smoke test in Task 9.
- [ ] **Preflight 5 — npm on PATH.** Run `command -v npm` and confirm it resolves. The single live-spawn test in Task 2 is gated on this; without it, that test is skipped but every other test still runs.
- [ ] **Preflight 6 — Coverage gate.** Run `npx vitest run --coverage --reporter=dot` once to capture the current threshold numbers. New files must keep the 80% stmt / 70% branch gate intact; if the new helpers fall below, add coverage in `tests/unit/theme-dev.test.ts` rather than lowering the gate.

Stop here and surface any failure to the user before starting Task 1.

---

### Task 1: Extend `ThemeFs` and add `BUILD` error code

**Files:**
- Modify `src/theme/fs.ts:12-21` (interface) and `src/theme/fs.ts:24-92` (local implementation)
- Modify `src/errors.ts:1-10` (add `BUILD`)
- Create tests for the new fs methods in `tests/unit/theme-fs.test.ts`

**Interfaces:**
- ThemeFs gains `appendLog` and `readLogTail`. `LocalThemeFs` implements them. The dev module and the rotation logic live behind the interface — `src/theme/dev.ts` does not touch `node:fs`.
- `BUILD` joins the `AutomadErrorCode` union. `errorToJson` already passes the code through, so no change there.

- [ ] **Step 1: Add the BUILD union member**

In `src/errors.ts`, insert `"BUILD"` into the union between `"CONFLICT"` and `"NETWORK"` (alphabetical). No edit to `errorToJson` (the implementation already string-passes `err.code`).

- [ ] **Step 2: Write failing tests for `appendLog` / `readLogTail` (RED)**

Open `tests/unit/theme-fs.test.ts`. Add (without implementation yet — expect compile failures):

```ts
it("appendLog creates the parent dir and writes content", async () => {
  await fs.appendLog(path.join(root, "missing", "x", "dev.log"), "hello\n");
  expect(await fs.readLogTail(path.join(root, "missing", "x", "dev.log"), 1_048_576)).toContain("hello");
});

it("appendLog rotates when size exceeds the cap (1 MiB)", async () => {
  const p = path.join(root, "rotate.log");
  const big = "x".repeat(700_000);
  await fs.appendLog(p, big + "A");
  await fs.appendLog(p, big + "B");
  const size = nodeFs.statSync(p).size;
  expect(size).toBeLessThanOrEqual(1_048_576 + 1_000);   // ≤ LOG_CAP_BYTES + chunk-size slack
  expect(await fs.readLogTail(p, 1_048_576)).toContain("B");
});

it("readLogTail returns the last N bytes only", async () => {
  const p = path.join(root, "tail.log");
  await fs.appendLog(p, "first");          // 5 bytes
  await fs.appendLog(p, "second");         // 6 bytes → tail
  expect(await fs.readLogTail(p, 6)).toBe("second");
  expect(await fs.readLogTail(p, 100)).toBe("firstsecond");
});

it("readLogTail returns empty string for missing file", async () => {
  expect(await fs.readLogTail(path.join(root, "nope.log"), 100)).toBe("");
});
```

Run:

```bash
npm test -- tests/unit/theme-fs.test.ts --reporter=dot
```

Expected: TypeScript compile errors (interface mismatch) — RED.

- [ ] **Step 3: Extend the `ThemeFs` interface**

In `src/theme/fs.ts`, append two methods:

```ts
appendLog(p: string, content: string): Promise<void>;
readLogTail(p: string, maxBytes: number): Promise<string>;
```

Add the local-file implementation (this is the ONE place `src/theme/fs.ts` may import `node:fs`):

```ts
import { promises as fsp, createReadStream, statSync, openSync, writeSync, closeSync, mkdirSync, readSync, ftruncateSync } from "node:fs";

const LOG_CAP = 1_048_576;       // 1 MiB
const LOG_TAIL_KEEP = 256 * 1024; // 256 KiB

async appendLog(p: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  let fd: number | undefined = openSync(p, "a");
  try {
    // Rotation: when size + chunk would exceed the cap, copy the last
    // LOG_TAIL_KEEP bytes into a temp file, swap, and reopen with truncation.
    let size = 0;
    try { size = statSync(p).size; } catch { /* ENOENT first write */ }
    if (size + Buffer.byteLength(content) > LOG_CAP) {
      closeSync(fd); fd = undefined;
      const keepSize = Math.min(LOG_TAIL_KEEP, Math.max(0, size));
      const tmp = `${p}.tmp`;
      const srcFd = openSync(p, "r");
      const dstFd = openSync(tmp, "w");
      try {
        if (keepSize > 0) {
          const buf = Buffer.alloc(keepSize);
          readSync(srcFd, buf, 0, keepSize, Math.max(0, size - keepSize));
          writeSync(dstFd, buf);
        }
      } finally { closeSync(srcFd); closeSync(dstFd); }
      // Atomically replace `p` with `tmp`. Local-fs only.
      await fsp.rename(tmp, p);
      fd = openSync(p, "a");
      size = keepSize;
    }
    writeSync(fd, content);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async readLogTail(p: string, maxBytes: number): Promise<string> {
  if (maxBytes <= 0) return "";
  let size: number;
  try { size = statSync(p).size; } catch { return ""; }
  const len = Math.min(maxBytes, size);
  if (len === 0) return "";
  const buf = Buffer.alloc(len);
  const fd = openSync(p, "r");
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  return buf.toString("utf8");
}
```

Re-run the focused tests; expected GREEN.

- [ ] **Step 4: Run focused tests and build**

```bash
npm test -- tests/unit/theme-fs.test.ts --reporter=dot
npm run build
```

Expected: tests pass, TypeScript clean.

- [ ] **Step 5: Commit**

```bash
git add src/theme/fs.ts src/errors.ts tests/unit/theme-fs.test.ts
git commit -m "feat(theme): ThemeFs.appendLog/readLogTail + BUILD error code"
```

---

### Task 2: Implement `src/theme/dev.ts`

**Files:**
- Create `src/theme/dev.ts`
- Create `tests/unit/theme-dev.test.ts` with `FakeThemeFs` + `FakeCommandRunner` defined locally

**Interfaces:**
- Public surface as defined above.
- Side effects only via the injected `ThemeFs` (file I/O), `spawn` (process fork), `runInstall` (npm install), `process.kill(pid, 0)` (test seam). No `node:fs` imports.
- `detachSpawn(cmd, args, opts)` is a new helper in this module. It calls `child_process.spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })`, then `child.unref()`, and returns a handle mirroring `Process` for the bits the dev lifecycle uses (`pid`, `kill`, `exited`).

- [ ] **Step 1: Create the local fakes (RED)**

Open `tests/unit/theme-dev.test.ts`. Add fakes and the test list. Both fakes are scoped to this file (the plan expressly defines them — they do not exist in the repo today).

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import {
  startDev, stopDev, getDevStatus,
  assertStarterKitLayout,
  REQUIRED_LAYOUT, PORT_REGEX, parseScriptsPort,
  LOG_CAP_BYTES, DEV_DIR, DEV_RECORD, DEV_LOG,
} from "../../src/theme/dev.js";
import type { ThemeFs } from "../../src/theme/fs.js";
import { AutomadMcpError } from "../../src/errors.js";
import type { DevSpawnHandle } from "../../src/theme/dev.js";

/** In-memory ThemeFs used by the dev suite. */
class FakeThemeFs {
  files = new Map<string, string>();            // path → content
  async exists(p: string) { return this.files.has(p); }
  async isDirectory(p: string) {
    return [...this.files.keys()].some((k) => k.startsWith(p + "/") || k.startsWith(p + path.sep));
  }
  async readFile(p: string) {
    if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
    return this.files.get(p)!;
  }
  async writeFile(p: string, content: string) { this.files.set(p, content); }
  async list(p: string, opts?: { recursive?: boolean }) {
    return [...this.files.keys()].filter((k) => k.startsWith(p + "/")).sort();
  }
  async mkdirp(p: string) { /* no-op for the fake */ }
  async remove(p: string, opts?: { recursive?: boolean }) {
    if (opts?.recursive) {
      for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + "/")) this.files.delete(k);
    } else this.files.delete(p);
  }
  async copyDir(src: string, dest: string) { /* not exercised by dev tests */ }
  async appendLog(p: string, content: string) {
    const prev = this.files.get(p) ?? "";
    const combined = prev + content;
    if (Buffer.byteLength(combined) > LOG_CAP_BYTES) {
      this.files.set(p, combined.slice(-(256 * 1024)));
    } else {
      this.files.set(p, combined);
    }
  }
  async readLogTail(p: string, maxBytes: number) {
    const v = this.files.get(p) ?? "";
    return v.length <= maxBytes ? v : v.slice(-maxBytes);
  }
}

/** Records spawn calls; emits the configured log chunks; handles kill/exit. */
interface FakeSpawnOpts {
  pid: number;
  /** Chunks emitted via onLogChunk in order, on a microtask. */
  chunks?: string[];
  /** Whether the child exits by itself (default true). */
  selfExit?: boolean;
  /** Custom liveness probe for `getDevStatus`. */
  aliveProbe?: (pid: number) => boolean;
}
class FakeCommandRunner {
  spawnCalls: { cmd: string; args: string[]; cwd: string; detached: boolean }[] = [];
  runInstallCalls: { args: string[]; cwd: string }[] = [];
  kills: { pid: number; signal: NodeJS.Signals }[] = [];
  private alive = new Set<number>();
  private pids: number[] = [];
  emitChunk?: (chunk: string) => void;
  constructor(private opts: FakeSpawnOpts) {
    if (opts.chunks) {
      this.emitChunk = (c: string) => { this.logBuf += c; };
    }
  }
  logBuf = "";
  // Match the dev.ts SpawnFn shape
  spawn: NonNullable<Parameters<typeof startDev>[0]["spawn"]> = (cmd, args, spawnOpts) => {
    this.spawnCalls.push({ cmd, args, cwd: spawnOpts.cwd, detached: spawnOpts.detached });
    this.pids.push(this.opts.pid);
    this.alive.add(this.opts.pid);
    const handle: DevSpawnHandle = {
      pid: this.opts.pid,
      unref: () => {},
      kill: (sig) => { this.kills.push({ pid: this.opts.pid, signal: sig }); return true; },
      exited: () => new Promise<void>((resolve) => { if (this.opts.selfExit ?? true) resolve(); }),
    };
    // Emit configured chunks asynchronously to mimic the child writing to its pipe.
    if (this.opts.chunks) {
      Promise.resolve().then(async () => {
        for (const c of this.opts.chunks!) {
          this.logBuf += c;
          if (this.emitChunk) this.emitChunk(c);
        }
      });
    }
    return handle;
  };
  // Match the dev.ts RunCommandFn shape
  runInstall: NonNullable<Parameters<typeof startDev>[0]["runInstall"]> =
  async (cmd, args, opts) => {
    this.runInstallCalls.push({ args, cwd: opts.cwd });
    return { ok: true, exitCode: 0, durationMs: 0, stdout: "", stderr: "", command: `${cmd} ${args.join(" ")}` };
  };
  alive(pid: number): boolean {
    if (this.opts.aliveProbe) return this.opts.aliveProbe(pid);
    return this.alive.has(pid);
  }
  kill(pid: number, signal: NodeJS.Signals): void {
    this.kills.push({ pid, signal });
    if (signal === "SIGKILL" || signal === "SIGTERM") this.alive.delete(pid);
  }
}
```

Now write the 18 focused test cases (RED first):

| # | Test | Asserts |
|---|------|---------|
| 1 | `startDev writes dev.json with the spawned pid and reports running:true` | `result.pid === pid`, `result.running === true`, `fakeFs.files.get(<theme>/.automad-mcp/dev.json)` parsed JSON has the same fields |
| 2 | `startDev runs npm install only when node_modules is missing` | when no `node_modules/`, runner recorded an install call with `--no-audit --no-fund`; when `node_modules/` exists, no install call |
| 3 | `startDev discovers the port from a log chunk containing http://localhost:4321` | after `pollUntilIdles`, `result.port === 4321`, `result.url === "http://localhost:4321"`, and `dev.json` re-read reflects the new port+url |
| 4 | `startDev returns port:null after portTimeoutMs when no marker appears` | `result.port === null`, `result.url === null`, no `dev.json` mutation |
| 5 | `startDev rejects with CONFLICT when a live pid is already recorded` | `AutomadMcpError` with `code === "CONFLICT"`, message contains the pid, no extra spawn happens |
| 6 | `startDev clears a stale dev.json (dead pid) and proceeds` | `fakeFs.remove` was called for the dev.json path; spawn proceeded |
| 7 | `stopDev returns stopped:false when no dev.json is present` | `result.stopped === false`, no kill issued |
| 8 | `stopDev sends SIGTERM and removes dev.json` | kill recorded `SIGTERM`, `fakeFs.files` no longer has the record, `result.stopped === true`, `signalUsed === "SIGTERM"` |
| 9 | `stopDev escalates to SIGKILL when SIGTERM is ignored` | `alive(pid)` always returns true; after stopDev, kills list contains `SIGTERM` then `SIGKILL`, `signalUsed === "SIGKILL"` |
| 10 | `getDevStatus returns null when no record exists` | `result === null` |
| 11 | `getDevStatus returns running:false when the pid is dead` | `aliveProbe(pid) → false`, result still has the recorded fields plus `running: false` |
| 12 | `assertStarterKitLayout rejects on a starter kit missing components/` | rejects with `code === "VALIDATION"`, message mentions `components`; no `copyDir` was invoked |
| 13 | `assertStarterKitLayout rejects on a starter kit missing theme.json` | same; message mentions `theme.json` |
| 14 | `assertStarterKitLayout rejects when blocks is a file, not a directory` | same |
| 15 | `assertStarterKitLayout accepts the canonical layout` | resolves; no throw |
| 16 | `parseScriptsPort finds --port=4321` | `4321` |
| 17 | `parseScriptsPort finds PORT=4321` and `PORT 4321` shell form | `4321` |
| 18 | `parseScriptsPort ignores an out-of-range or non-numeric match` | `null` |

- [ ] **Step 2: Define exports and types in `dev.ts` (still RED for logic)**

Create `src/theme/dev.ts` with:
- imports (`node:child_process.spawn`, `node:path`, `ThemeFs`, `AutomadMcpError`)
- constants (`REQUIRED_LAYOUT`, `PORT_REGEX`, `DEV_DIR`, `DEV_RECORD`, `DEV_LOG`, `LOG_CAP_BYTES`, `LOG_TAIL_KEEP`)
- types (`DevRecord`, `StartDevOptions`, `StartDevResult`, `StopDevResult`, `DevSpawnHandle`, `SpawnFn`, `RunCommandFn`)
- `detachSpawn(cmd, args, opts)` — production wrapper

Run:

```bash
npm test -- tests/unit/theme-dev.test.ts --reporter=dot
```

Expected: every test fails with module-not-found / missing-export / signature mismatches — RED.

- [ ] **Step 3: Implement `assertStarterKitLayout` (tests 12–15 GREEN)**

```ts
export async function assertStarterKitLayout(starterKitPath: string, fs: ThemeFs): Promise<void> {
  const missing: string[] = [];
  for (const entry of REQUIRED_LAYOUT) {
    const p = path.join(starterKitPath, entry);
    if (!(await fs.exists(p))) { missing.push(entry); continue; }
    if (entry === "components" || entry === "blocks") {
      if (!(await fs.isDirectory(p))) missing.push(`${entry}/`);
    }
  }
  if (missing.length > 0) {
    throw new AutomadMcpError(
      "VALIDATION",
      `starter kit at ${starterKitPath} is missing required layout entries: ${missing.join(", ")}. ` +
      `Expected the canonical layout from automadcms/automad-theme-starter-kit.`,
    );
  }
}
```

- [ ] **Step 4: Implement `parseScriptsPort` (tests 16–18 GREEN)**

Implement the regex exactly as listed in `Shared Interfaces`. Confirm the three positive cases (`--port=4321`, `PORT=4321`, `PORT 4321`) and the two negative cases (`--port=0`, `PORT=9999999`) return `null`.

- [ ] **Step 5: Implement record I/O + `getDevStatus` (tests 10, 11 GREEN)**

```ts
function recordPath(cwd: string) { return path.join(cwd, DEV_DIR, DEV_RECORD); }
function logPath(cwd: string)    { return path.join(cwd, DEV_DIR, DEV_LOG); }

async function writeRecord(fs: ThemeFs, cwd: string, rec: DevRecord): Promise<void> {
  await fs.mkdirp(path.join(cwd, DEV_DIR));
  await fs.writeFile(recordPath(cwd), JSON.stringify(rec, null, 2) + "\n");
}
async function readRecord(fs: ThemeFs, cwd: string): Promise<DevRecord | null> {
  const p = recordPath(cwd);
  if (!(await fs.exists(p))) return null;
  return JSON.parse(await fs.readFile(p)) as DevRecord;
}

export async function getDevStatus(
  cwd: string, fs: ThemeFs,
  deps: { alive?: (pid: number) => boolean } = {},
): Promise<DevRecord | null> {
  const rec = await readRecord(fs, cwd);
  if (!rec) return null;
  const alive = deps.alive ?? ((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
  return { ...rec, running: alive(rec.pid) };
}
```

- [ ] **Step 6: Implement `stopDev` (tests 7–9 GREEN)**

```ts
const SIGTERM_DEADLINE = 5_000;
const KILL_DEADLINE    = 1_000;

export async function stopDev(
  cwd: string, fs: ThemeFs,
  deps: {
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    alive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<StopDevResult> {
  const rec = await readRecord(fs, cwd);
  if (!rec) return { stopped: false, wasLive: false };
  const kill  = deps.kill  ?? ((pid, sig) => process.kill(pid, sig));
  const alive = deps.alive ?? ((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const wait = async (ms: number, step: number): Promise<boolean> => {
    const steps = Math.max(1, Math.floor(ms / step));
    for (let i = 0; i < steps; i++) { if (!alive(rec.pid)) return true; await sleep(step); }
    return !alive(rec.pid);
  };
  kill(rec.pid, "SIGTERM");
  let signalUsed: "SIGTERM" | "SIGKILL" = "SIGTERM";
  if (!(await wait(SIGTERM_DEADLINE, 100))) {
    kill(rec.pid, "SIGKILL");
    signalUsed = "SIGKILL";
    await wait(KILL_DEADLINE, 100);
  }
  await fs.remove(recordPath(cwd));
  return { stopped: true, signalUsed, wasLive: true };
}
```

- [ ] **Step 7: Implement `startDev` (tests 1–6 GREEN)**

Detailed steps inside `startDev`:

1. `const themeName = path.basename(cwd);` for error messages.
2. Resolve existing record; if `alive(rec.pid) === true` → throw `AutomadMcpError("CONFLICT", \`dev server already running for theme '${themeName}' (pid ${rec.pid}). Call dev_stop first.\`)`. If dead, `fs.remove(recordPath(cwd))` and continue.
3. If `fs.exists(path.join(cwd, "node_modules"))` is false:
   - `runInstall("npm", ["install", "--no-audit", "--no-fund"], { cwd, timeoutMs: 5 * 60_000 })`
   - On non-ok → throw `AutomadMcpError("BUILD", \`npm install failed (exit ${res.exitCode}): ${res.stderr.slice(-2048)}\`)`.
4. Port resolution: if `opts.portHint` set, use it; else `parseScriptsPort(scripts.dev)` from a read of `package.json` (`fs.readFile` + JSON parse); else `null`.
5. `<cwd>/${DEV_DIR}` → `fs.mkdirp`. Initial record with `{ pid: <placeholder 0>, port: portGuess, startedAt: new Date().toISOString(), logPath, url: portGuess ? \`http://localhost:${portGuess}\` : null, running: false }`.
6. Spawn: `const child = (opts.spawn ?? realSpawn)(cmd="npm", args=["run","dev"], opts={ cwd, detached: true })`. Wire the child's stdout/stderr to `fs.appendLog(logPath, chunk)` via `data` listeners (the production `realSpawn` returns `child` whose `.stdout` / `.stderr` are exposed; production only). For tests, the `spawn` seam can return a no-stream handle and instead drive `opts.onLogChunk` to push chunks directly through `fs.appendLog`.
7. `child.unref()`.
8. Rewrite record with the real pid and `running: true`.
9. Poll loop (max `portTimeoutMs`, default 20 s, polling every 250 ms): read `readLogTail(logPath, opts.logMaxBytes ?? 16 * 1024)`, search `PORT_REGEX`, on first match → mutate record to `{ ..., port, url: \`http://localhost:${port}\`, running: true }`. Break early when `child.exited()` resolves AND no port was found.
10. Return `StartDevResult` with `running: true` always.

Production realSpawn sits in this module too:

```ts
import { spawn as cpSpawn } from "node:child_process";

export function realSpawn(cmd: string, args: string[], opts: { cwd: string; detached: boolean }): DevSpawnHandle {
  const child = cpSpawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.unref();
  return {
    pid: child.pid ?? 0,
    unref: () => child.unref(),
    kill: (sig) => child.kill(sig),
    exited: () => new Promise<void>((resolve) => child.once("exit", () => resolve())),
    // The stdio streams live on `child`; production wiring in startDev reads them directly.
    _child: child,                            // not exported on the type — internal only
  };
}
```

(Note: the `DevSpawnHandle` interface stays clean; `_child` is added through an internal symbol literal `& { _child?: ChildProcess }` extension cast.)

- [ ] **Step 8: Run the focused dev suite + build**

```bash
npm test -- tests/unit/theme-dev.test.ts --reporter=dot
npm run build
```

Expected: 18 tests GREEN. If any test for poll-timeout hangs (test 4), ensure the fake `exited()` resolves.

- [ ] **Step 9: Add a single live-spawn test (gated on `npm` on PATH)**

Inside `tests/unit/theme-dev.test.ts`, append:

```ts
import { execSync } from "node:child_process";

const NPM_AVAILABLE = (() => { try { execSync("npm --version", { stdio: "ignore" }); return true; } catch { return false; } })();

const itIfNpm = NPM_AVAILABLE ? it : it.skip;

itIfNpm("startDev live-spawns npm run dev with the real cli (skipped if npm missing)", async () => {
  // Create a real temp theme with a real package.json so npm run dev has something to do.
  const realRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "dev-live-"));
  const realTheme = path.join(realRoot, "my-theme");
  await nodeFs.mkdir(realTheme, { recursive: true });
  await nodeFs.writeFile(path.join(realTheme, "package.json"), JSON.stringify({
    name: "t", private: true, scripts: { dev: "node -e \"setTimeout(()=>console.log('Local: http://localhost:14567'),50);\"" },
  }));
  const fs = new LocalThemeFs();
  const res = await startDev({ cwd: realTheme, fs, portTimeoutMs: 10_000 });
  expect(res.running).toBe(true);
  await stopDev(realTheme, fs);
  await nodeFs.rm(realRoot, { recursive: true, force: true });
});
```

Run:

```bash
npm test -- tests/unit/theme-dev.test.ts --reporter=dot
```

Expected: 19 tests GREEN on hosts with `npm`; 18 GREEN + 1 SKIP on hosts without. (The Node script in `dev` prints the port into the log; the plan's port regex must capture `Local: http://localhost:14567` → port `14567`.)

- [ ] **Step 10: Commit**

```bash
git add src/theme/dev.ts tests/unit/theme-dev.test.ts
git commit -m "feat(theme): dev server lifecycle helpers"
```

---

### Task 3: Register the three dev actions on `automad_theme`

**Files:**
- Modify `src/capabilities/registry.ts:135-159`
- Modify `tests/unit/capabilities.test.ts:42-44`
- Modify `tests/unit/write-guard.test.ts` (re-registration test)

**Interfaces:**
- Adds `theme.dev`, `theme.dev_stop`, `theme.dev_status` to the `WriteAction` union (auto-derived).
- Updates advertised-actions expectation. Adds destructive/read classification expectations.

- [ ] **Step 1: Add the actions (RED)**

In `src/capabilities/registry.ts`, inside the `automad_theme.actions` literal, add after the existing `build` entry:

```ts
dev:        destructive("Install dependencies and start the theme dev server in the background."),
dev_stop:   destructive("Stop the theme dev server started by `dev`."),
dev_status: read("Read the status of the theme dev server."),
```

Also extend the `description` paragraph to mention `dev/dev_stop/dev_status`:

> "Local-filesystem theme tooling (requires AUTOMAD_THEMES_PATH). list/install/activate/uninstall/scaffold/build/dev/dev_stop/dev_status, plus read/write/files for theme files (theme.json, .php, blocks/, .ts). Scaffold copies the starter kit into a new theme dir; build runs `npm install` + `npm run build`; dev runs `npm install` (if needed) + `npm run dev` as a detached process."

- [ ] **Step 2: Update advertised-action snapshot (RED)**

In `tests/unit/capabilities.test.ts`, the existing block at lines 42–44:

```ts
expect([...advertisedActions("automad_theme")].sort()).toEqual([
  "activate", "analyze", "build", "diff", "files", "generate", "install", "list", "read", "scaffold", "schema", "uninstall", "validate", "write",
]);
```

Extend (alphabetical: `dev`, `dev_status`, `dev_stop` slot between `build` and `diff`):

```ts
expect([...advertisedActions("automad_theme")].sort()).toEqual([
  "activate", "analyze", "build", "dev", "dev_status", "dev_stop",
  "diff", "files", "generate", "install", "list", "read",
  "scaffold", "schema", "uninstall", "validate", "write",
]);
```

- [ ] **Step 3: Add the WriteGuard classification assertions (RED)**

In `tests/unit/write-guard.test.ts`, add:

```ts
it("classifies automad_theme dev actions destructively/read-only", () => {
  expect(DESTRUCTIVE_ACTIONS.has("theme.dev")).toBe(true);
  expect(DESTRUCTIVE_ACTIONS.has("theme.dev_stop")).toBe(true);
  expect(READ_ACTIONS.has("theme.dev_status")).toBe(true);
});
```

(If the existing file already iterates the registry and the test covers every action transitively, mark this as "covered by registry iteration" and proceed.)

Run:

```bash
npm test -- tests/unit/capabilities.test.ts tests/unit/write-guard.test.ts --reporter=dot
```

Expected: RED until both Step 1 (registry) and Step 2 (advertised snapshot) land.

- [ ] **Step 4: Confirm registry validation still passes**

Run `npm run build`. `validateCapabilityRegistry()` runs at module import; failure here would mean the new entries have invalid flags. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts tests/unit/capabilities.test.ts tests/unit/write-guard.test.ts
git commit -m "feat(theme): register dev/dev_stop/dev_status actions"
```

---

### Task 4: Dispatch the three new actions

**Files:**
- Modify `src/domains/theme.ts:17-32` (`ACTION_MAP`)
- Modify `src/domains/theme.ts:74-151` (switch cases)
- Modify `src/theme/manager.ts` (re-export new helpers — facade consistency)
- Modify `src/schemas.ts:142-163` (add optional `port` field)
- Modify `tests/unit/domains/theme.test.ts`
- Modify `tests/unit/schemas.test.ts`

**Interfaces:**
- Maps `dev/dev_stop/dev_status` to `theme.dev|theme.dev_stop|theme.dev_status` in `ACTION_MAP`.
- New switch cases resolve the theme path with `assertWithinRoot`, then call `startDev`/`stopDev`/`getDevStatus` from `../theme/dev.js`.
- `themeInput.port: z.number().int().min(1).max(65535).optional()`.

- [ ] **Step 1: Add `port` to `themeInput` (RED)**

In `src/schemas.ts`, extend the `themeInput` object literal with `port: z.number().int().min(1).max(65535).optional()`. Run:

```bash
npm test -- tests/unit/schemas.test.ts --reporter=dot
```

Add two new tests:

```ts
it("themeInput accepts dev action with optional port", () => {
  expect(themeInput.parse({ action: "dev", theme: "t", port: 4321 }).action).toBe("dev");
});
it("themeInput rejects an out-of-range port", () => {
  expect(() => themeInput.parse({ action: "dev", theme: "t", port: 70000 })).toThrow();
});
```

Re-run. GREEN after Step 1 edit lands.

- [ ] **Step 2: Add the dispatch cases (RED)**

In `src/domains/theme.ts`, extend `ACTION_MAP`:

```ts
const ACTION_MAP: Record<ThemeAction, WriteAction> = {
  // ...existing entries (lines 18–31)...
  dev:        "theme.dev",
  dev_stop:   "theme.dev_stop",
  dev_status: "theme.dev_status",
};
```

Extend the `switch` block with three cases (placed at the end to keep the diff small). Add new imports at the top:

```ts
import * as path from "node:path";
import { assertWithinRoot } from "../theme/fs.js";
import { startDev, stopDev, getDevStatus } from "../theme/dev.js";
```

The three cases:

```ts
case "dev": {
  if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for dev");
  const target = assertWithinRoot(deps.themesPath, path.join(deps.themesPath, input.theme));
  return startDev({ cwd: target, fs, portHint: input.port });
}
case "dev_stop": {
  if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for dev_stop");
  const target = assertWithinRoot(deps.themesPath, path.join(deps.themesPath, input.theme));
  return stopDev(target, fs);
}
case "dev_status": {
  if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for dev_status");
  const target = assertWithinRoot(deps.themesPath, path.join(deps.themesPath, input.theme));
  return getDevStatus(target, fs);
}
```

- [ ] **Step 3: Add dispatch tests (RED → GREEN)**

In `tests/unit/domains/theme.test.ts`, mirror the existing dispatch-test pattern (the file already iterates every action of every tool against `readOnlyGuard`). Add:

```ts
describe("automad_theme dev actions dispatch", () => {
  it("dev dispatches to startDev and requires theme", async () => {
    await expect(handleTheme({ action: "dev" } as ThemeInput, deps)).rejects.toMatchObject({ code: "VALIDATION", message: /theme is required for dev/ });
  });
  it("dev_stop requires theme", async () => {
    await expect(handleTheme({ action: "dev_stop" } as ThemeInput, deps)).rejects.toMatchObject({ code: "VALIDATION", message: /theme is required for dev_stop/ });
  });
  it("dev_status requires theme", async () => {
    await expect(handleTheme({ action: "dev_status" } as ThemeInput, deps)).rejects.toMatchObject({ code: "VALIDATION", message: /theme is required for dev_status/ });
  });
  it("dev, dev_stop, dev_status survive the write-guard classification", () => {
    expect(writeGuard.check("theme.dev", "/themes/x").allowed).toBe(true);
    expect(writeGuard.check("theme.dev_stop", "/themes/x").allowed).toBe(true);
    // dev_status is a read-allowed action: allowed regardless of write-mode by default.
    expect(writeGuard.check("theme.dev_status", "/themes/x").allowed).toBe(true);
  });
});
```

Run:

```bash
npm test -- tests/unit/domains/theme.test.ts --reporter=dot
```

Expected: GREEN.

- [ ] **Step 4: Re-export from `ThemeManager`**

In `src/theme/manager.ts`, after the class body:

```ts
export { startDev, stopDev, getDevStatus, assertStarterKitLayout } from "./dev.js";
export type { DevRecord, StartDevOptions, StartDevResult, StopDevResult } from "./dev.js";
```

- [ ] **Step 5: Run focused tests + build**

```bash
npm test -- tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts tests/unit/capabilities.test.ts tests/unit/write-guard.test.ts tests/unit/theme-dev.test.ts --reporter=dot
npm run build
```

Expected: focused suite green, TypeScript clean.

- [ ] **Step 6: Commit**

```bash
git add src/domains/theme.ts src/theme/manager.ts src/schemas.ts tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts
git commit -m "feat(theme): dispatch dev actions"
```

---

### Task 5: Wire the drift audit into `scaffold`

**Files:**
- Modify `src/theme/scaffold.ts:73-74` (call `assertStarterKitLayout(starterKitPath, fs)` immediately before `fs.copyDir(...)`)
- Modify `tests/unit/theme-scaffold.test.ts` (populate fixture with canonical layout + add drift-rejection test)

- [ ] **Step 1: Import `assertStarterKitLayout` (RED)**

In `src/theme/scaffold.ts`, add at the top:

```ts
import { assertStarterKitLayout } from "./dev.js";
```

- [ ] **Step 2: Update the test fixture**

In `tests/unit/theme-scaffold.test.ts`, replace the `beforeEach` body so the starter dir has the canonical layout. Existing happy-path fixtures (theme.json, package.json, blocks/, pagelist.php) stay; add:

```ts
await nodeFs.mkdir(path.join(starter, "components"), { recursive: true });
await nodeFs.writeFile(path.join(starter, "components", "page.php"), "<@~@>");
await nodeFs.mkdir(path.join(starter, "blocks"), { recursive: true });              // already present, keep idempotent
await nodeFs.mkdir(path.join(starter, "client"), { recursive: true });
await nodeFs.writeFile(path.join(starter, "client", "index.ts"), "export {};\n");
await nodeFs.writeFile(path.join(starter, "esbuild.js"), "// build script\n");
```

Confirm the existing "copies starter kit, rewrites theme.json and package.json" test still passes.

- [ ] **Step 3: Add drift-rejection test (RED → GREEN)**

Add to the same file:

```ts
it("rejects a starter kit missing the canonical layout", async () => {
  await nodeFs.rm(path.join(starter, "client"), { recursive: true });   // break the fixture
  await expect(
    scaffold({ name: "x" }, { fs: new LocalThemeFs(), themesPath: themes, starterKitPath: starter }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
});

it("rejects a starter kit where components is a file", async () => {
  await nodeFs.rm(path.join(starter, "components"), { recursive: true });
  await nodeFs.writeFile(path.join(starter, "components"), "not a dir");
  await expect(
    scaffold({ name: "x" }, { fs: new LocalThemeFs(), themesPath: themes, starterKitPath: starter }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
});
```

- [ ] **Step 4: Insert the audit call**

In `src/theme/scaffold.ts`, immediately before `await fs.copyDir(starterKitPath, target)` (line 74), insert:

```ts
await assertStarterKitLayout(starterKitPath, fs);
```

The audit must run before any files are written; placement before `mkdirp(target)` + `copyDir` enforces that.

- [ ] **Step 5: Run focused tests + build**

```bash
npm test -- tests/unit/theme-scaffold.test.ts --reporter=dot
npm run build
```

Expected: all green, including the two new rejection tests.

- [ ] **Step 6: Commit**

```bash
git add src/theme/scaffold.ts tests/unit/theme-scaffold.test.ts
git commit -m "feat(theme): pre-copy starter-kit drift audit"
```

---

### Task 6: Fix the stale manager-test fixture

**Files:**
- Replace `tests/unit/theme/manager.test.ts`

**Interfaces:**
- Replace `readDir` / `removeDir` / `isDir` calls with the current `ThemeFs` API: `exists`, `isDirectory`, `readFile`, `writeFile`, `list`, `mkdirp`, `remove`, `copyDir`.
- Keep the test intent: `list` returns empty when no dirs; `uninstall` prevents path traversal; `activate` swallows API errors.

- [ ] **Step 1: Confirm the test currently fails to typecheck**

```bash
npm test -- tests/unit/theme/manager.test.ts --reporter=dot
```

(Preflight 3 may have shown this fail too — that's fine, it's the expected baseline.)

- [ ] **Step 2: Rewrite the file with the current API**

```ts
import { describe, it, expect, vi } from "vitest";
import { ThemeManager } from "../../../src/theme/manager.js";
import type { ThemeFs } from "../../../src/theme/fs.js";
import type { HttpClient } from "../../../src/client.js";

function mockFs(): ThemeFs {
  return {
    exists: vi.fn(),
    isDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    list: vi.fn(),
    mkdirp: vi.fn(),
    remove: vi.fn(),
    copyDir: vi.fn(),
    appendLog: vi.fn(),
    readLogTail: vi.fn(),
  };
}

describe("ThemeManager", () => {
  it("list returns empty array when no themes directory exists", async () => {
    const fs = mockFs();
    vi.mocked(fs.exists).mockResolvedValue(false);
    const mgr = new ThemeManager({ fs, themesPath: "/themes", starterKitPath: "/starter", client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient });
    expect(await mgr.list()).toEqual([]);
  });

  it("list returns an entry for each subdirectory of the themes path", async () => {
    const fs = mockFs();
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.list).mockResolvedValue(["/themes/a", "/themes/b"]);
    vi.mocked(fs.isDirectory).mockResolvedValue(true);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ name: "x", version: "0.0.1" }));
    const mgr = new ThemeManager({ fs, themesPath: "/themes", starterKitPath: "/starter", client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient });
    const list = await mgr.list();
    expect(list).toHaveLength(2);
  });

  it("uninstall prevents path traversal", async () => {
    const fs = mockFs();
    const mgr = new ThemeManager({ fs, themesPath: "/themes", starterKitPath: "/starter", client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient });
    await expect(mgr.uninstall("../outside")).rejects.toThrow("invalid theme slug");
  });

  it("activate handles API errors gracefully", async () => {
    const fs = mockFs();
    vi.mocked(fs.exists).mockResolvedValue(true);
    const client = { get: vi.fn(), post: vi.fn().mockRejectedValue(new Error("API Fail")), put: vi.fn(), delete: vi.fn(), upload: vi.fn() };
    const mgr = new ThemeManager({ fs, themesPath: "/themes", starterKitPath: "/starter", client: client as unknown as HttpClient });
    const res = await mgr.activate("test-theme");
    expect(res.activated).toBe(false);
  });
});
```

(Adjust the file naming/style to match the rest of the repo — `nodeFs.rm` for the temp dir, etc. The intent above is the minimum-coverage rewrite.)

- [ ] **Step 3: Run focused tests**

```bash
npm test -- tests/unit/theme/manager.test.ts --reporter=dot
npm run build
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/theme/manager.test.ts
git commit -m "test(theme): refresh stale ThemeFs fixture"
```

---

### Task 7: Refresh AUTOGEN docs via `npm run docs:sync`

**Files (regenerated, do not hand-edit):**
- `README.md` (AUTOGEN tool table, beta version, count markers)
- `CLAUDE.md` (destructive-action count, tool table)
- `docs/index.html` (AUTOGEN tool table)

**Interfaces:**
- The drift test (`tests/unit/docs-drift.test.ts`) already pins the destructive-action count and the AUTOGEN table coverage, so a successful sync + a green drift test is the proof.

- [ ] **Step 1: Preview the diff**

```bash
npm run docs:sync -- --check
```

Expected: `docs:sync --check: FAILED — docs are out of date (...)` before sync; success after. The script scans `src/capabilities/registry.ts`, regenerates the `<!-- AUTOGEN:TOOLS:START -->` blocks, and rewrites count markers.

- [ ] **Step 2: Apply the sync**

```bash
npm run docs:sync
```

Expected: each of `README.md`, `CLAUDE.md`, `docs/index.html` reports `updated` (or the equivalent message format from `scripts/sync.ts`).

- [ ] **Step 3: Verify the drift test**

```bash
npm test -- tests/unit/docs-drift.test.ts --reporter=dot
```

Expected: green. If it fails, re-run sync once and re-test.

- [ ] **Step 4: Refresh the TESTCOUNT marker (after Task 8)**

```bash
npm run docs:sync:tests
```

Expected: `CLAUDE.md: updated (TESTCOUNT)`, `docs/index.html: updated (TESTCOUNT)` (the readme TESTCOUNT may also refresh depending on the marker config). Only run this AFTER the full test suite is green.

- [ ] **Step 5: Commit the docs refresh**

```bash
git add README.md CLAUDE.md docs/index.html
git commit -m "docs(theme): refresh AUTOGEN markers for dev actions"
```

---

### Task 8: Full verification + coverage gate

**Files:**
- No production changes unless verification exposes a defect.
- `tests/unit/docs-drift.test.ts` may need no edits; if the test count marker ticks, the drift test already accounts for it.

**Interfaces:**
- Confirms every acceptance criterion from the design spec (modulo the manual smoke test in Task 9).

- [ ] **Step 1: Run the focused suite end-to-end**

```bash
npm test -- tests/unit/theme-dev.test.ts tests/unit/theme-scaffold.test.ts tests/unit/theme-fs.test.ts tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts tests/unit/docs-drift.test.ts tests/unit/theme/manager.test.ts --reporter=dot
```

Expected: every focused test green.

- [ ] **Step 2: Run the full unit suite**

```bash
npm test -- --reporter=dot
```

Expected: every unit test green; the prior `manager.test.ts` failure is gone.

- [ ] **Step 3: Run the lint and build**

```bash
npm run lint
npm run build
```

Expected: both clean.

- [ ] **Step 4: Refresh the TESTCOUNT marker**

```bash
npm run docs:sync:tests
```

- [ ] **Step 5: Coverage gate**

```bash
npx vitest run --coverage --reporter=dot
```

Expected: statements ≥ 80%, branches ≥ 70%. If anything in `src/theme/dev.ts` falls short (most likely the rotation branch), add a focused test rather than lowering the gate.

- [ ] **Step 6: Commit any final marker refresh**

```bash
git add README.md CLAUDE.md docs/index.html   # only if docs:sync:tests changed anything
git commit -m "docs: refresh test-count marker"
```

---

### Task 9: Manual end-to-end smoke test (MCP server actually serves a page)

**Goal:** prove the user can scaffold a theme, start its dev server via the MCP tool, fetch a real page from the URL returned, then stop it cleanly.

**Pre-conditions (must hold or smoke test is blocked, not failed):**
- `AUTOMAD_THEMES_PATH` and `AUTOMAD_STARTER_KIT_PATH` are set; the starter kit is the real `automadcms/automad-theme-starter-kit`.
- `npm` is on `PATH` (Preflight 5).

- [ ] **Step 1: Build and start the MCP server in stdio mode**

```bash
npm run build
AUTOMAD_THEMES_PATH=$(mktemp -d -t automad-smoke) \
AUTOMAD_STARTER_KIT_PATH=<path-to-starter-kit-checkout> \
node --import tsx src/index.ts
```

The server prints its banner on stderr and is ready for MCP traffic on stdin/stdout.

- [ ] **Step 2: Open an interactive MCP client**

Use `mcp-cli`/`Claude Desktop`/any MCP client that lets you call `automad_theme`. Concretely:

```json
{ "tool": "automad_theme", "input": { "action": "scaffold", "name": "smoke-blog",
    "description": "smoke", "author": "ci", "license": "MIT", "version": "0.1.0" } }
```

Expected response:

```json
{ "path": "<themesPath>/smoke-blog", "name": "smoke-blog",
  "files": <N>, "manifest": { ... } }
```

- [ ] **Step 3: Start the dev server**

```json
{ "tool": "automad_theme", "input": { "action": "dev", "theme": "smoke-blog" } }
```

Expected response shape (`port` may be `null` if the URL is not yet in the log; poll `dev_status` to retrieve it later):

```json
{ "pid": <int>, "port": <int|null>, "url": "http://localhost:<port>|null",
  "logPath": "<themesPath>/smoke-blog/.automad-mcp/dev.log", "running": true }
```

If `port === null`, immediately follow up with:

```json
{ "tool": "automad_theme", "input": { "action": "dev_status", "theme": "smoke-blog" } }
```

…until the response carries `port: <int>, url: "http://localhost:<port>", running: true`. **The acceptance criterion is that `url` resolves within 20 s on a healthy starter kit**; if it doesn't, the smoke test has failed and Task 2's port-discovery branch needs revisiting.

- [ ] **Step 4: Prove `npm run dev` actually serves a page**

```bash
URL="http://localhost:${PORT}"
curl -sS -o /tmp/smoke-body.html -w "HTTP %{http_code} bytes=%{size_download}\n" "$URL"
head -c 200 /tmp/smoke-body.html
```

Expected:
- `HTTP 200` (or 3xx whose eventual body is non-empty HTML), `bytes > 0`.
- The body starts with `<!doctype html`, `<html`, or contains a marker from the starter kit (e.g. `<title>` for the demo layout).

If `curl` exits non-zero or returns 000, the smoke test FAILED. Possible causes:
1. The dev server selected a port that conflicts with another listener → re-run with `portHint`.
2. The starter kit's `npm run dev` script doesn't print `http://localhost:<port>` → adjust `parseScriptsPort` or extend `PORT_REGEX` to capture the kit's actual marker (e.g. `Local:.*` is common for Vite).
3. The kit expects a foreground browser session (`opn`/`open` calls that fail in headless mode) → ignore; the port is still discoverable.

Document which failure mode was hit, then either continue OR stop and report.

- [ ] **Step 5: Prove `dev_status` reports running**

```json
{ "tool": "automad_theme", "input": { "action": "dev_status", "theme": "smoke-blog" } }
```

Expected: `running: true` with `pid` matching the value returned by `dev`.

- [ ] **Step 6: Stop the dev server**

```json
{ "tool": "automad_theme", "input": { "action": "dev_stop", "theme": "smoke-blog" } }
```

Expected: `{ "stopped": true, "signalUsed": "SIGTERM", "wasLive": true }`.

Verify:

```bash
test ! -f "$AUTOMAD_THEMES_PATH/smoke-blog/.automad-mcp/dev.json" && echo "dev.json removed"
test   -f "$AUTOMAD_THEMES_PATH/smoke-blog/.automad-mcp/dev.log"  && echo "dev.log retained"
```

A follow-up:

```json
{ "tool": "automad_theme", "input": { "action": "dev_status", "theme": "smoke-blog" } }
```

Expected: either `null` (no record left) or, if a race left it on disk, `{ ..., running: false }`.

- [ ] **Step 7: Repeat with a forced `portHint` to confirm the override**

```json
{ "tool": "automad_theme", "input": { "action": "dev", "theme": "smoke-blog", "port": 4711 } }
```

Expected: `port: 4711` in the response (override used). Then `curl http://localhost:4711` returns HTML. Then `dev_stop`.

- [ ] **Step 8: Capture the smoke-test transcript**

If anything failed, paste the failure into the PR description. Otherwise record the success transcript with:
- the scaffolding output,
- the `dev` response (port + url),
- the `curl` HTTP code + first 200 bytes of HTML,
- the `dev_status` `running: true` output,
- the `dev_stop` output.

This transcript is the acceptance-criterion deliverable.

- [ ] **Step 9: Inspect final repository state**

```bash
git diff --check
git status --short --branch
git diff --stat HEAD~7..HEAD
```

Expected: only intended source/test/docs changes; no credentials; no `.automad-mcp/dev.json`; no `node_modules/` accidentally added; generated output restricted to README/CLAUDE/docs.

- [ ] **Step 10: Final commit (if anything held back)**

If the smoke test exposed a defect and a final fix landed, commit it; otherwise no commit is needed.

```bash
git add <fixed file>
git commit -m "fix(theme): dev address smoke-test defect"
```

---

## Acceptance checklist (must all be ticked before merge)

- [ ] Preflight passed.
- [ ] `automad_theme.dev`, `automad_theme.dev_stop`, `automad_theme.dev_status` appear in the registry and pass `validateCapabilityRegistry`.
- [ ] `BUILD` was added to the `AutomadErrorCode` union.
- [ ] `ThemeFs` exposes `appendLog` / `readLogTail`; `LocalThemeFs` implements both; rotation cap 1 MiB with 256 KiB tail retention covered by a unit test.
- [ ] `src/theme/dev.ts` exports `startDev`, `stopDev`, `getDevStatus`, `assertStarterKitLayout`, `realSpawn`, `parseScriptsPort`, `PORT_REGEX`. No direct `node:fs` use outside the log adapter seam.
- [ ] `src/domains/theme.ts` dispatches all three actions; `theme` field required (else `VALIDATION`). Includes optional `port`.
- [ ] `src/theme/scaffold.ts` runs `assertStarterKitLayout` before `copyDir`. A starter kit missing `theme.json`, `components/`, `blocks/`, `client/index.ts`, or `esbuild.js` produces `VALIDATION` and no files are written.
- [ ] `ThemeManager` re-exports the new helpers (facade consistency).
- [ ] `themeInput` accepts an optional `port: 1..65535` and rejects `0` / `70000`.
- [ ] `tests/unit/theme/manager.test.ts` was rewritten against the current `ThemeFs` API and now passes.
- [ ] `npm test -- --reporter=dot` is green.
- [ ] `npm run lint`, `npm run build` are clean.
- [ ] Coverage stays at 80% stmt / 70% branch.
- [ ] `npm run docs:sync` updated `README.md`, `CLAUDE.md`, `docs/index.html`; `docs-drift.test.ts` is green.
- [ ] `npm run docs:sync:tests` updated the TESTCOUNT marker if it changed.
- [ ] Manual smoke test (Task 9) served a real page via `curl HTTP 200` and round-tripped `dev` → `dev_status` → `dev_stop`.
- [ ] `src/capabilities/tools.ts` was NOT modified.
- [ ] No new runtime dependencies in `package.json`.
