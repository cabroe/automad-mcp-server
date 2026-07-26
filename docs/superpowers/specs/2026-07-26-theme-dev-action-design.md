# Automad Theme Dev Server Action

**Date:** 2026-07-26
**Status:** Draft for user review

## Goal

Extend the `automad_theme` MCP tool so that, after a theme is scaffolded from
`automadcms/automad-theme-starter-kit`, the same tool can install dependencies
and start the theme's bundled dev server as a long-lived background process.
The user receives the local URL from the tool response and can open the theme
preview in a browser immediately. The copied directory layout must continue
to match the upstream starter kit exactly.

The scope is intentionally narrow: a thin wrapper around the starter kit's
own `npm run dev` script, nothing more. No browser automation, no container
orchestration, no live log streaming.

## Scope

In scope:

- Add three new actions to `automad_theme`: `dev`, `dev_stop`, `dev_status`.
- `dev` runs `npm install` (only when `node_modules` is missing) and then
  `npm run dev` as a detached process group rooted in the theme directory.
- Persist process metadata in `<theme>/.automad-mcp/dev.json` via the
  existing `ThemeFs` abstraction.
- Capture stdout/stderr in `<theme>/.automad-mcp/dev.log` (append, 1 MiB
  cap with rotation by truncation).
- Discover the listening port by parsing `package.json` scripts first, then
  scanning the log for an `http://localhost:<port>` or `http://127.0.0.1:<port>`
  marker (up to 20 s).
- Drift audit: when `scaffold` runs, verify that the starter kit root
  contains the known canonical layout (theme.json, components/, blocks/,
  client/index.ts, esbuild.js). Mismatch returns `VALIDATION` with a
  concrete diff list against the upstream contract.
- `dev_stop` sends SIGTERM to the recorded pid, escalates to SIGKILL after
  5 s, removes `dev.json`, and leaves `dev.log` in place.
- `dev_status` returns the recorded metadata and a live `running` flag
  (process.kill(pid, 0) === false ⇒ not running).
- Write-mode integration: `dev` and `dev_stop` are classified as
  destructive (they spawn/kill processes and write files); `dev_status`
  is read-only.

Out of scope:

- Browser auto-open (the user opens the URL themselves).
- Live log streaming via MCP notifications (logs stay on disk).
- Docker, systemd, launchd, or any host process manager.
- Theme build orchestration beyond `dev` (the existing `build` action
  is unchanged).
- Modifications to the contents of `scaffold()` itself — it already
  copies the starter kit 1:1; the drift audit only adds a check before
  the copy.
- i18n, schema, analyzer, or generator changes.

## Architecture

The theme subsystem already follows the same shape as every other domain:
a registry entry in `src/capabilities/registry.ts`, a binding in
`src/capabilities/tools.ts`, a domain dispatcher in `src/domains/theme.ts`,
and the underlying implementation in `src/theme/*`. The new actions slot
into that shape without touching the registry schema.

New files:

- `src/theme/dev.ts` — pure logic: `startDev()`, `stopDev()`, `getDevStatus()`.
  Each takes a `ThemeFs` and a theme path. Returns structured results.
- `tests/unit/theme-dev.test.ts` — covers happy path, missing
  `node_modules`, port discovery from log, stale pid, drift audit.

Touched files:

- `src/domains/theme.ts` — dispatch the three new actions.
- `src/theme/scaffold.ts` — add a pre-copy drift audit
  (`assertStarterKitLayout`).
- `src/capabilities/registry.ts` — add `dev`, `dev_stop`, `dev_status`
  entries with `requires: "themes"`, the correct read/write/destructive
  classification, and refreshed descriptive text.
- `src/capabilities/tools.ts` — none expected (the existing binding loop
  picks up new actions via the registry).
- `src/schemas.ts` — `themeInput` action enum is derived from the
  registry; no manual edit needed (verified by the existing
  `action-enum-match` test).
- `src/theme/manager.ts` — re-export the new helpers if `dev_status` is
  surfaced through the manager facade.
- `package.json` — no new dependencies. `cross-spawn` is not needed;
  `child_process.spawn` with `detached: true` is sufficient on the
  supported Node ≥ 20 baseline.

## Component design

### `src/theme/dev.ts`

```ts
export interface DevRecord {
  pid: number;
  port: number | null;
  startedAt: string; // ISO 8601
  logPath: string;
  url: string | null;
}

export interface StartDevOptions {
  cwd: string; // theme root
  fs: ThemeFs;
  /** Optional port hint; if not provided, taken from scripts or log. */
  portHint?: number;
  /** Max time to wait for a port to appear in the log. */
  portTimeoutMs?: number; // default 20_000
}

export interface StartDevResult {
  pid: number;
  port: number | null;
  url: string | null;
  logPath: string;
  running: true;
}

export async function startDev(opts: StartDevOptions): Promise<StartDevResult>;
export async function stopDev(themePath: string, fs: ThemeFs): Promise<{ stopped: boolean }>;
export async function getDevStatus(themePath: string, fs: ThemeFs): Promise<DevRecord | null>;
```

`startDev` flow:

1. Reject if `dev.json` already exists and the recorded pid is still live
   (`process.kill(pid, 0)`). If the pid is dead, remove the stale record
   and proceed.
2. Run `npm install` only when `node_modules` is absent. Use
   `runCommand("npm", ["install", "--no-audit", "--no-fund"], { cwd })`
   with a 5-minute timeout. Surface errors as `AutomadMcpError("BUILD", …)`.
3. Ensure `<theme>/.automad-mcp` exists (`fs.mkdirp`).
4. Open `dev.log` for append, then `spawn("npm", ["run", "dev"], { cwd, detached: true, stdio: ["ignore", logFd, logFd] })`.
5. `child.unref()` so the parent (MCP server) can exit independently.
6. Write `dev.json` with `{ pid, port: null, startedAt, logPath, url: null }`.
7. Spawn a short-lived poll loop that reads the log tail and matches
   `/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{4,5})/`. On first
   match, update `dev.json` with `{ port, url }`. The poll loop runs for
   at most `portTimeoutMs` and is awaited before `startDev` returns, so
   the tool response can include the URL when the dev server starts fast.
   If the timeout fires first, the response still returns `{ pid, port: null, url: null, … }` and the user can poll `dev_status`.

`stopDev` flow:

1. Read `dev.json`. If absent, return `{ stopped: false }`.
2. Send `SIGTERM` to the pid. Wait up to 5 s for `process.kill(pid, 0)`
   to return false.
3. If still alive, send `SIGKILL`. Wait up to 1 s.
4. Remove `dev.json`. Leave `dev.log` intact.

`getDevStatus` flow:

1. Read `dev.json`. If absent, return `null`.
2. If `process.kill(pid, 0)` throws, treat the record as stale and
   return it with `running: false` (the caller downstream surfaces this).
3. Return the record with `running: true`.

### Drift audit in `src/theme/scaffold.ts`

Add `assertStarterKitLayout(starterKitPath, fs)` called before `copyDir`:

```ts
const REQUIRED = [
  "theme.json",
  "components",
  "blocks",
  "client/index.ts",
  "esbuild.js",
] as const;
```

Missing entries ⇒ `AutomadMcpError("VALIDATION", `starter kit missing required paths: ${missing.join(", ")}`)`. The audit is strict: any missing required path fails. This protects future drift if someone points `AUTOMAD_STARTER_KIT_PATH` at a stale checkout.

### `src/domains/theme.ts` dispatch

Add three cases in the existing switch:

```ts
case "dev":      return startDev({ cwd: themePath, fs: deps.fs, portHint: input.port });
case "dev_stop": return stopDev(themePath, deps.fs);
case "dev_status": return getDevStatus(themePath, deps.fs);
```

`themeInput` gains an optional `port` field (z.number().int().min(1).max(65535).optional()) for the rare case the user wants to force a port explicitly.

### Capability registry entries

```ts
dev:        destructive("Install dependencies and start the theme dev server in the background."),
dev_stop:   destructive("Stop the theme dev server started by `dev`."),
dev_status: read("Read the status of the theme dev server."),
```

`dev` and `dev_stop` join the destructive set in `write-guard.ts` (auto-derived from `DESTRUCTIVE`), `dev_status` joins the read set.

## Data flow

User says "create a new theme called `my-blog` and start the dev server":

1. MCP client posts `tool call: automad_theme { action: "scaffold", name: "my-blog", … }`.
2. `scaffold` runs the drift audit on `AUTOMAD_STARTER_KIT_PATH`, copies
   the layout, rewrites `theme.json` and `package.json`, returns the
   theme path.
3. MCP client posts `tool call: automad_theme { action: "dev", theme: "my-blog" }`.
4. `startDev` runs `npm install` (if needed), spawns `npm run dev`
   detached, writes `dev.json`, polls the log for the port, returns
   `{ pid, port, url, logPath }`.
5. The client opens the URL. To hot-reload after edits, the user keeps
   `dev` running and reruns `theme.write` / `theme.generate`; the dev
   server picks up file changes via its own watcher.
6. When done, the client posts `tool call: automad_theme { action: "dev_stop", theme: "my-blog" }`. `stopDev` terminates the process and removes the record.

Failure modes:

- `scaffold` is called with a starter kit path missing required layout
  ⇒ `VALIDATION`, no files written.
- `dev` is called while a previous instance is still running ⇒
  `CONFLICT("dev server already running for theme 'my-blog' (pid N)")`.
  User must call `dev_stop` first.
- `npm install` fails (network, bad package.json) ⇒ `BUILD` error
  with the captured stderr tail.
- `npm run dev` exits immediately (bad script) ⇒ `BUILD` error after
  the port timeout; the log captures the failure for diagnosis.
- `dev_stop` is called with no record ⇒ `{ stopped: false }`, no error.

## Error handling

Errors use the existing `AutomadMcpError` codes:

- `NOT_FOUND` — theme dir does not exist; `dev.log` is missing on
  `dev_status` only when the path argument is wrong.
- `CONFLICT` — `dev` called while a live record exists.
- `BUILD` — `npm install` or `npm run dev` failure (stderr tail
  attached).
- `VALIDATION` — drift audit failure on `scaffold`.
- `NETWORK` — used by `HttpClient`; not relevant here.

`dev_status` never throws; it returns `null` or the record with
`running: false` if the pid is dead. The discard path is intentional: a
crashed dev server should be easy to detect, not a tool error.

## Testing

Unit tests in `tests/unit/theme-dev.test.ts`:

1. `startDev` writes `dev.json` with the spawned pid and returns the
   port discovered from a log line containing `http://localhost:4321`.
2. `startDev` runs `npm install` when `node_modules` is missing and
   skips it when present.
3. `startDev` returns `port: null` after the timeout when the log
   never contains a port marker.
4. `startDev` rejects with `CONFLICT` when a live pid is already
   recorded.
5. `stopDev` sends SIGTERM and removes `dev.json`.
6. `stopDev` escalates to SIGKILL when SIGTERM is ignored (mock
   `process.kill`).
7. `getDevStatus` returns `null` when no record exists.
8. `getDevStatus` returns `running: false` when the pid is dead.
9. Drift audit rejects a starter kit missing `components/`.
10. Drift audit accepts a starter kit with all required entries.

Tests use a `FakeThemeFs` (in-memory) and a `FakeCommandRunner` (records
spawned commands; later expanded to actually run them in one happy-path
test gated on `npm` being on PATH). The live-spawn test is the only one
that touches the real filesystem; it is skipped if `npm` is unavailable.

The existing `docs-drift` test will need a refresh: the registry gains
three actions, so the AUTOGEN tool table in `README.md`, `CLAUDE.md`,
and `docs/index.html` updates on next `npm run docs:sync`. Same for the
`action-enum-match` test, which is the pin that catches drift between
the registry and the Zod schema.

## Acceptance criteria

- A user can scaffold a theme and start its dev server with two
  consecutive `automad_theme` tool calls.
- The `dev` action returns the local URL within 20 s on a healthy
  starter kit on macOS/Linux.
- A second `dev` call for the same theme returns `CONFLICT` until
  `dev_stop` is called.
- `dev_stop` reliably terminates the process; `dev_status` reports
  `running: false` after.
- The drift audit rejects a starter kit that no longer matches the
  canonical layout.
- The unit test suite covers every branch above; existing tests stay
  green; `npm run docs:sync` regenerates the tool tables without
  manual edits.
- No new runtime dependencies.
