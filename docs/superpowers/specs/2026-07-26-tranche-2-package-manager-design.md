# Tranche 2: PackageManager Extension

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** Second of 4 tranches. Adds v2 `PackageManagerController` actions to the existing `automad_theme` tool.

## Goal

Expose the v2 live **PackageManager** API surface (installed packages, updates, uninstall) as MCP actions on the existing `automad_theme` tool, in addition to the existing filesystem-based operations. This lets an agent query what is actually installed, check for outdated packages, and trigger updates through the same v2 pipeline Automad's own dashboard uses.

## Verified v2 endpoints (from source)

| Controller method | URL | Request body | Response |
|---|---|---|---|
| `getPackageCollection` | `POST /_api/package-manager/get-package-collection` | `{}` | `{ packages: [...] }` (each with `name`, `installed`, `version`, `latest`, etc.) |
| `getOutdated` | `POST /_api/package-manager/get-outdated` | `{}` | `{ outdated: [...] }` |
| `update` | `POST /_api/package-manager/update` | `{ package: "<name>" }` | success or v2 error |
| `updateAll` | `POST /_api/package-manager/update-all` | `{}` | success or v2 error |
| `remove` | `POST /_api/package-manager/remove` | `{ package: "<name>" }` | success or v2 error |

(Other methods on the controller — `addRepository`, `getRepositoryCollection`, `getSafeAuth`, `resetAuth`, `saveAuth`, `updateRepository`, `removeRepository`, `install` — are **not** in this tranche. Tranche 4 may add `install` properly; the rest is repository/auth surface that's out of scope for now.)

## Decisions

- **Placement:** all new actions attach to the existing `automad_theme` tool (per the user's "alle in bestehende Tools" choice from Tranche 1).
- **Action names:**
  - `list_installed` (read) — replaces neither `list` nor `files`; `list` stays FS-based (local themes on disk), `list_installed` calls the v2 registry and returns the canonical installed-package state.
  - `outdated` (read) — returns v2 `getOutdated`.
  - `update` (destructive) — `package` is required; refuses if the v2 response says the package is unknown.
  - `update_all` (destructive) — no body.
  - `uninstall` (destructive) — `theme` (slug) is required; POSTs `package` to v2's `remove`.
- **Naming:** `update` collides with the existing filesystem-based `update_rename` internal action? No — that's a `pages` internal, not `theme`. `theme.update` is new and unambiguous. `uninstall` is also new (the existing `automad_theme.uninstall` does FS removal only — we'll repurpose it to call v2's `remove`, mirroring how `activate` already uses v2).
- **Field on the schema:** add `package?: string` (vendor/name). Used by `update` and `uninstall`. The existing `theme` (slug) field is kept for the FS-based actions.
- **Idempotency / errors:** mirror Tranche 1: every destructive action goes through the existing `WriteGuard` confirm-token flow; non-pending responses are forwarded unchanged. `update` and `uninstall` with `package` missing → `VALIDATION`.
- **`uninstall` semantic shift:** the existing FS-only `uninstall` is **replaced** with a v2-first flow: try v2's `remove` first; on success, also remove the on-disk dir. If v2 is unreachable or errors with NOT_FOUND, fall back to FS removal (matching the resilience pattern in `activate`). The slug is still required (from `input.theme`).

## Scope

### In scope
- 5 new actions on `automad_theme`: `list_installed`, `outdated`, `update`, `update_all`, `uninstall` (the last is replaced, not new).
- Schema: add `package?: string` to `themeInput`.
- Registry: 5 new entries in `automad_theme.actions`. **Remove** the existing `uninstall: destructive(...)` registry entry (kept as a new `uninstall` entry — same key, new description).
- Domain: 5 new `case` arms in `domains/theme.ts`; rewrite the existing `case 'uninstall':` to call v2's `remove` then fs.remove (with fallback).
- `manager.ts`: add `manager.uninstallViaV2(package, theme)` helper.
- Tests: 1 happy + 1 confirm-token-pending + 1 missing-required per write action; 1 happy per read action. ~12 new tests.
- `docs:sync` regen.

### Out of scope
- `install` rewriting to use v2's `install` endpoint (it does more — bootstrap_starter_kit, etc.). Defer to Tranche 4 or a future spec.
- Repository/auth management (8 other PackageManagerController methods).
- Theme schema discovery or `composer.json` editing.
- Backfilling tests for the **existing** actions in the file (defer to whichever tranche touches them).

## Architecture

Identical to Tranche 1: no new files, no new tools, no new dependencies. The WriteGuard's `confirm-token` flow is reused. The new `uninstall` action's two-step (v2 remove + fs.remove) keeps the existing `manager.uninstall(slug)` capability (fs-only) as a fallback when v2 errors with NOT_FOUND.

## Data flow

```
client → tools/call(automad_theme, action=update, package=vendor/foo, confirm_token?)
   → TOOL_BINDINGS.automad_theme.run
   → handleTheme(input)
   → guard.check('theme.update', input.package ?? '/', input.confirm_token)
   → pending: return Permit
   → allowed: client.post('/_api/package-manager/update', {package: 'vendor/foo'}) → v2
   → return v2 response
```

`list_installed` and `outdated` are reads; they go straight to v2 with the existing guard bypass (reads are always allowed in any write mode).

## Errors & security

- No new error codes. Existing `FORBIDDEN`/`VALIDATION`/`AUTH`/`UNKNOWN` paths cover the new surface.
- `update`/`update_all`/`uninstall` are destructive — must require confirm token in `confirm-destructive` mode. Proven by tests.
- `uninstall` removal of the on-disk dir is gated behind v2 success OR v2 NOT_FOUND (in case the package was already removed from v2's view but the dir lingered).

## Testing

For each write action (`update`, `update_all`, `uninstall`): 1 happy + 1 confirm-token-pending + 1 missing-required-field. For each read (`list_installed`, `outdated`): 1 happy. Plus an existing `theme.uninstall` regression test (it now does v2 + fs).

## Acceptance criteria

1. `automad_theme` exposes 5 new actions: `list_installed`, `outdated`, `update`, `update_all`, `uninstall` (the last replaces the FS-only one).
2. `automad_discover.list` reports the new actions with the correct `destructive` flag.
3. The autogen tool table in README/CLAUDE/index.html reflects the new actions.
4. All existing 410 tests still pass; new tests pass.
5. `npm run verify` green: build, lint, tests, coverage, `docs:sync --check`.
6. No new runtime dependencies.
7. No code changes to `client.ts`, `auth.ts`, `http.ts`, `server.ts`, `write-guard.ts`, `capabilities/tools.ts`.
