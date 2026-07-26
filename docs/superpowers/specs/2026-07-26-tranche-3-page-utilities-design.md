# Tranche 3: Page Utilities

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** Third of 4 tranches. Adds the remaining v2 `PageController` actions to the existing `automad_pages` tool.

## Goal

Expose four v2 `PageController` actions (verified from source) as MCP actions on the existing `automad_pages` tool:
- `breadcrumbs` (read) — list the breadcrumb trail for a page.
- `discard_draft` (destructive) — revert a page to its last published version.
- `publication_state` (read) — get the current draft/published state of a page.
- `recent` (read) — explicit alias for `pages.list` (which already uses `page-collection/get-recently-edited`).

## Verified v2 endpoints (from source)

| Controller method | URL | Request body | Response |
|---|---|---|---|
| `PageController::breadcrumbs` | `POST /_api/page/breadcrumbs` | `{ url }` | `[{ url, title }, ...]` |
| `PageController::discardDraft` | `POST /_api/page/discard-draft` | `{ url }` | (v2 `setReload(true)` — server returns reload header) |
| `PageController::getPublicationState` | `POST /_api/page/get-publication-state` | `{ url }` | `{ state, hasDraft, hasPublished }` (v2 envelope) |
| `PageCollectionController::getRecentlyEdited` | `POST /_api/page-collection/get-recently-edited` | `{}` | `[{ url, ... }]` (already used by `pages.list`) |

## Decisions

- **Placement:** all 4 actions attach to the existing `automad_pages` tool. `recent` becomes an explicit alias (the existing `pages.list` already hits the same v2 endpoint — making it an alias gives agents a discoverable name).
- **Action names:** `breadcrumbs`, `discard_draft`, `publication_state`, `recent`.
- **Read actions:** `breadcrumbs`, `publication_state`, `recent` are reads.
- **Destructive:** `discard_draft` is destructive (mutates server state).
- **Required field:** all 4 require `url` (the `recent` action ignores it but keeps the schema consistent — actual body is `{}`). Missing `url` → `VALIDATION`.
- **Idempotency / errors:** identical to Tranche 1. `discard_draft` is destructive → goes through `WriteGuard` confirm-token flow.
- **`recent` alias:** the handler for `recent` returns the exact same response as `list`. Internally it can delegate to the same code path. We keep them as **separate action entries** in the registry (not collapsing), so that the docs table and `discover.list` report both names. The schema/handler code is the same, just routed by the action name.
- **No new fields** on `pagesInput`.

## Scope

### In scope
- 4 new actions on `automad_pages`: `breadcrumbs`, `discard_draft`, `publication_state`, `recent`.
- Registry: 4 new entries in `automad_pages.actions`.
- Domain: 4 new `case` arms in `domains/pages.ts`; the `recent` arm reuses the same code as `list`.
- Tests: 1 happy + 1 confirm-token-pending per destructive; 1 happy per read; 1 missing-url per write. ~7 new tests.
- `docs:sync` regen.

### Out of scope
- `pages.add` (create), `pages.duplicate`, `pages.move`, `pages.publish`, `pages.update`, `pages.delete`, `pages.batch_update`, `pages.get` — already implemented.
- `pages.list` — already implemented (will keep alongside the new `recent` alias).
- Tranche-1 additions: `trash_*`, `history`, `history_restore` — already implemented.
- v2 `InPageController` (in-page editing) — Tranche 4 (new tool or extend existing).
- v2 `ComponentController` — Tranche 4 (new tool).

## Architecture

Identical to Tranche 1/2. No new files, no new tools, no new dependencies. The WriteGuard's confirm-token flow is reused for `discard_draft`.

## Data flow

```
client → tools/call(automad_pages, action=discard_draft, url=/foo, confirm_token?)
   → TOOL_BINDINGS.automad_pages.run
   → handlePages(input)
   → guard.check('pages.discard_draft', input.url ?? '/', input.confirm_token)
   → pending: return Permit
   → allowed: client.post('/_api/page/discard-draft', { url: '/foo' }) → v2
   → return v2 response
```

## Errors & security

- No new error codes.
- `discard_draft` is destructive — must require confirm token in `confirm-destructive` mode (proven by tests).
- `breadcrumbs` and `publication_state` and `recent` are reads — always allowed.

## Testing

- 1 happy `breadcrumbs(url)` → asserts `client.post('/_api/page/breadcrumbs', {url})` was called.
- 1 happy `publication_state(url)` → asserts `client.post('/_api/page/get-publication-state', {url})` was called.
- 1 happy `recent()` → asserts `client.post('/_api/page-collection/get-recently-edited', {})` (same as `list`).
- 1 missing-url per write/read: 3 tests.
- 1 happy `discard_draft(url)` → asserts `client.post('/_api/page/discard-draft', {url})`.
- 1 confirm-token-pending `discard_draft(url)` in `confirm-destructive` mode → asserts `allowed: 'pending'`.

Approximately 7 new tests.

## Acceptance criteria

1. `automad_pages` exposes 4 new actions: `breadcrumbs`, `discard_draft`, `publication_state`, `recent`.
2. `automad_pages.list` keeps existing semantics (no behavior change).
3. `automad_discover.list` reports the new actions with the correct `destructive` flag.
4. The autogen tool table in README/CLAUDE/index.html reflects the new actions.
5. All existing 420 tests still pass; new tests pass.
6. `npm run verify` green: build, lint, tests, coverage, `docs:sync --check`.
7. No new runtime dependencies.
8. No code changes to `client.ts`, `auth.ts`, `http.ts`, `server.ts`, `write-guard.ts`, `capabilities/tools.ts`.
