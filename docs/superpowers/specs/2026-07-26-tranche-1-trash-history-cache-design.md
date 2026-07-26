# Tranche 1: Trash + History + Cache

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** First of 4 tranches covering the 17 real v2 API gaps surfaced in the source-level inventory.

## Goal

Add three previously-missing v2 controller surfaces — `PageTrashController`,
`HistoryController`, `CacheController` — as **new actions on existing MCP tools**
(`automad_pages`, `automad_config`). No new tools in this tranche.

## Verified v2 endpoints (from source)

| Controller | Methods | URL | Method | Auth |
|---|---|---|---|---|
| `PageTrashController` | `list` | `/_api/page-trash/list` | POST | session+CSRF |
| `PageTrashController` | `restore` | `/_api/page-trash/restore` | POST | session+CSRF |
| `PageTrashController` | `permanentlyDelete` | `/_api/page-trash/permanently-delete` | POST | session+CSRF |
| `PageTrashController` | `clear` | `/_api/page-trash/clear` | POST | session+CSRF |
| `HistoryController` | `log` | `/_api/history/log` | POST | session+CSRF |
| `HistoryController` | `restore` | `/_api/history/restore` | POST | session+CSRF |
| `CacheController` | `clear` | `/_api/cache/clear` | POST | session+CSRF |
| `CacheController` | `purge` | `/_api/cache/purge` | POST | session+CSRF |

All endpoints accept `__csrf__` + `__json__` (v2 wire format, already wired in `client.ts`).

## Decisions

- **Placement:** all 8 new actions attach to existing tools (`automad_pages` × 6, `automad_config` × 2). No new tools in this tranche. Tool count stays at 8.
- **URL/kebab-case vs camelCase:** v2 uses kebab-case in URLs (`get-recently-edited`, `permanently-delete`) — follow that. Action names are camelCase MCP-side (`trash_list`, `permanently_delete`).
- **Destructive classification:** all write-side actions are destructive (require confirm token in `confirm-destructive` mode). `trash_list` and `history` are reads.
- **Action names:** `trash_list`, `trash_restore`, `trash_permanently_delete`, `trash_clear` (all `automad_pages`); `history`, `history_restore` (all `automad_pages`); `cache_clear`, `cache_purge` (both `automad_config`). For `history_restore` we keep the prefix to avoid colliding with potential future page-level restore (and to keep the v2 URL `history/restore` semantic clear).
- **Idempotency:** `trash_clear` and `cache_clear`/`cache_purge` always succeed even if the target is already empty (v2 does this; the v2 implementation just calls `Cache::clear()` regardless). Tests assert the v2 success-shape response is returned.
- **`history.log` request body:** v2's `HistoryController::log` accepts the `url` of the page whose history to read. We forward `input.url`. No pagination params in v2 source — single call returns full log.
- **`history.restore` request body:** v2's `HistoryController::restore` accepts a `logId` (string id of the history entry) and the `url`. We accept a new `history_id` field on the input. Treat empty/missing as `VALIDATION` error.
- **Error shape:** all actions return whatever the v2 response envelope is. Failures already surface as `FORBIDDEN` (guard), `VALIDATION` (missing field), or v2's HTTP error → `client.ts` maps to `UNKNOWN` or `AUTH`. No new error code.

## Scope

### In scope
- 8 new actions across 2 existing tools.
- Schema extensions on `pagesInput` and `configInput` (Zod).
- WriteAction mapping additions to `pagesInput['action']` ACTION_MAP and `configInput['action']` ACTION_MAP.
- One new domain case per action in `domains/pages.ts` and `domains/config.ts`.
- Registry description update for `automad_pages` and `automad_config` to mention the new actions.
- New test cases: 1 happy-path + 1 confirm-token-pending per destructive action, 1 happy-path per read action, 1 missing-required-field per write action. Approximately 16 new test cases.
- `docs:sync` regeneration (autogen tables pick up the new actions automatically).

### Out of scope
- New MCP tools (`automad_image`, `automad_components`, `automad_mail`, `automad_system`, `automad_ai` — tranche 4).
- PackageManager extension (tranche 2).
- Other page utilities (`recent`, `breadcrumbs`, `discard_draft`, `publication_state` — tranche 3; `recent` is already implemented as `pages.list`; the rest deferred).
- A11y/UX changes (none — internal MCP API only).

## Architecture

**No new files.** All changes in:
- `src/schemas.ts` (extend `pagesInput` + `configInput`).
- `src/capabilities/registry.ts` (add actions to existing tool specs).
- `src/domains/pages.ts` (add cases for `trash_*`, `history`, `history_restore`).
- `src/domains/config.ts` (add cases for `cache_clear`, `cache_purge`).
- `tests/unit/domains/pages.test.ts` (extend).
- `tests/unit/domains/config.test.ts` (extend).
- `README.md` + `CLAUDE.md` (env-var table unchanged; new actions surface via the autogen table; small "new in this release" note in CHANGELOG).

The WriteGuard's pending-token flow already covers destructive actions uniformly — no changes needed there. The new actions will produce `confirmToken` pending responses in `confirm-destructive` mode automatically (same path as `delete`).

## Data flow

Identical to the existing `pages.delete` flow:

```
client → tools/call(automad_pages, action=trash_restore, url=..., confirm_token?)
   → TOOL_BINDINGS.automad_pages.run
   → bind() gate (live-mode check + assertScope if implemented)
   → handlePages(input)
   → guard.check('pages.trash_restore', input.url, input.confirm_token)
   → permit.allowed === 'pending' → return {allowed: 'pending', confirmToken, ...}
   → permit.allowed === 'allowed'   → client.post('/_api/page-trash/restore', {url}) → v2
   → permit.allowed === 'false'      → throw FORBIDDEN(permit.reason)
```

`cache_clear` follows the existing `config.set` pattern (no `url` target — the guard uses `'/'` as the synthetic target string, matching today's behavior).

## Errors & security

- No new error codes. Failures surface through existing `FORBIDDEN`/`VALIDATION`/`AUTH`/`UNKNOWN` paths.
- `trash_clear` is **destructive** (deletes all trashed pages) — must require confirm token in `confirm-destructive` mode.
- `cache_purge` is **destructive** (likely more aggressive than `clear` — v2's `CacheController::purge` is a separate method) — must require confirm token.
- No new input fields beyond `url` (already on the schema) and a new `history_id` (string, validated by Zod).

## Testing

For each new action:
1. **Happy path (no confirm token in `unrestricted` mode):** mock `client.post` → call action → assert v2 URL was hit, assert response shape.
2. **Confirm-token pending (in `confirm-destructive` mode):** assert `allowed === 'pending'` and a `confirmToken` is returned, assert v2 was NOT called.
3. **Forbidden (unknown token replayed):** assert `FORBIDDEN` with reason `'unknown token'` (proves guard wiring).
4. **Missing required field:** for `trash_*`/`history`/`history_restore` → `VALIDATION` when `url` missing. For `history_restore` → `VALIDATION` when `history_id` missing.

Approximately 6 new test cases for the 6 destructive page actions and 2 for the 2 cache actions, plus 2 for the 2 read actions (trash_list, history).

## Acceptance criteria

1. `automad_pages` exposes 6 new actions: `trash_list`, `trash_restore`, `trash_permanently_delete`, `trash_clear`, `history`, `history_restore`.
2. `automad_config` exposes 2 new actions: `cache_clear`, `cache_purge`.
3. `automad_discover.list` reports the new actions with the correct `destructive` flag.
4. The autogen tool table in README/CLAUDE/index.html reflects the new actions.
5. All existing 401 tests still pass; new tests pass.
6. `npm run verify` green: build, lint, tests, coverage (80% stmt / 70% branch gate), `docs:sync --check`.
7. No new runtime dependencies.
8. No code changes to `client.ts`, `auth.ts`, `http.ts`, `server.ts`, `write-guard.ts`, `capabilities/tools.ts` (the gate pipeline is unchanged).
