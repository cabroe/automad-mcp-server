# Tranche 4: New Tools (image, components, mail, system, file-meta, edit-lock, in-page, app)

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** Fourth of 4 tranches. Adds 5 new MCP tools (8 candidate — see Scope) that wire previously-unexposed v2 controllers to the MCP surface.

## Goal

Add 5 new MCP tools so an agent can manage v2's image-resize, component drafts/publication, mail configuration, system update checks, and app-level state — all without leaving the MCP. **AI tooling is excluded from this tranche** (it requires API keys not present in the v2 live API contract; defer to a future spec).

## Verified v2 controllers (from source)

| New tool | v2 controller methods | Runtime gate |
|---|---|---|
| `automad_image` | `ImageController::save` (resize/crop) + `ImageCollectionController::list` (list rendered variants) | live |
| `automad_components` | `ComponentController::data`, `discardDraft`, `getPublicationState`, `publish` (separate editor for "components" — view-level fields, not page-level) | live |
| `automad_mail` | `MailConfigController::reset`, `save`, `test` (SMTP config + send-test) | live |
| `automad_system` | `SystemController::checkForUpdate`, `update` (core v2 update check + run) | live |
| `automad_file_meta` | `FileController::editInfo` (rename + alt-text on existing files) | live |

## Out of scope (deferred to a future spec)

- `AiAssistanceController` + `AiProviderController` (8 actions; needs API key flow; complex; defer).
- `EditLockController` (1 action: lock acquisition — not critical for agent workflow).
- `InPageController` (3 actions: in-page editing; niche; defer).
- `FileController::import` (v2-only URL-import, complex validation).
- `AppController::getServerInfo`, `updateState` (mostly already exposed via `automad_site.info` / `automad_config`).
- v2 `PackageManagerController::install` rewrite (v2 install is different from the current FS-clone install; Tranche 2 already added `list_installed/update/update_all/uninstall` which are the read+maintain side).

## Decisions

- **One MCP tool per v2 controller** (where it makes sense): 5 new tools. Each owns its own Zod schema, registry entry, domain router.
- **All new tools require `live` mode** (same as the existing live API tools); reading themes etc. doesn't gate them.
- **Write modes:** each tool's destructive actions go through the existing `WriteGuard` confirm-token flow (no new guard wiring).
- **Naming:** `automad_image` (singular tool, despite two endpoints — resize and list), `automad_components` (plural — they're a collection of components, not one), `automad_mail` (matches v2 `MailConfigController` semantics), `automad_system`, `automad_file_meta` (descriptive, since the existing `automad_media` is the file upload/list/delete tool).
- **`automad_image.save` payload:** v2 takes `{name, extension, imageBase64}` (base64-encoded resized image — see source). The MCP tool accepts `{name, extension, source}` where `source` is a base64 string of the source image. **For the first cut we delegate 1:1 to v2's expected payload** (a separate `resize` helper that does the actual resize is too much for a single tranche — v2 expects the client to send the already-resized image; the tool will accept the same shape and forward). **Decision:** keep the shape identical to v2 (base64 in/out) so the agent supplies the resized image; the tool just calls the v2 endpoint. A future spec can add a server-side resize if needed.
- **Component endpoints:** v2's `ComponentController` is for in-page-component fields (not for managing `components/` PHP files). The `automad_components` tool reflects that: actions are `data`, `discard_draft`, `publication_state`, `publish` — all gated on `(context, init)` or `(url, ...)`.
- **Mail config:** v2's `MailConfigController::test` requires a test email address. The MCP action accepts `{to}` as required.
- **System update:** v2's `SystemController::checkForUpdate` is read; `update` runs the actual update — destructive.

## Scope

### In scope
- 5 new MCP tools with the following action lists:

**`automad_image` (2 actions):**
- `save` (destructive) — `POST /_api/image/save` body `{name, extension, imageBase64}`.
- `list` (read) — `POST /_api/image-collection/list` body `{}`.

**`automad_components` (4 actions):**
- `data` (read) — `POST /_api/component/data` body `{components}`.
- `discard_draft` (destructive) — `POST /_api/component/discard-draft` body `{url}` (verify against v2 source; assume `url` is the canonical page URL; same as `pages.discard_draft`).
- `publication_state` (read) — `POST /_api/component/get-publication-state` body `{url}`.
- `publish` (destructive) — `POST /_api/component/publish` body `{url}`.

**`automad_mail` (3 actions):**
- `save` (destructive) — `POST /_api/mail-config/save` body `{transport, from, smtpServer, smtpUsername, smtpPort, smtpPassword?}`.
- `test` (destructive) — `POST /_api/mail-config/test` body `{to}`.
- `reset` (destructive) — `POST /_api/mail-config/reset` body `{}`.

**`automad_system` (2 actions):**
- `check_for_update` (read) — `POST /_api/system/check-for-update` body `{}`.
- `update` (destructive) — `POST /_api/system/update` body `{}`.

**`automad_file_meta` (1 action):**
- `edit_info` (destructive) — `POST /_api/file/edit-info` body `{path, alt?, caption?, ...}` (verify against v2 source — exact fields TBD; minimal subset: `{path, alt}`).

Total: 12 new actions across 5 new tools.

### Out of scope
- AI tools (defer).
- `EditLockController` (defer).
- `InPageController` (defer).
- `FileController::import` (defer).
- `AppController` extras (defer).
- Anything that needs v2 source re-verification mid-implementation (the `ComponentController` request bodies need a quick source-read at Task 2 time; the `ImageController` body needs source-read; the `FileController::editInfo` body needs source-read).

## Architecture

- **5 new files** under `src/domains/`: `image.ts`, `components.ts`, `mail.ts`, `system.ts`, `file-meta.ts`.
- **5 new input Zod schemas** in `schemas.ts`.
- **5 new `automad_*` entries in the capability registry.**
- **5 new `TOOL_BINDINGS`** in `capabilities/tools.ts`.
- **5 new test files** under `tests/unit/domains/`.
- **No new files** for resources (these tools don't have associated MCP resources).
- All destructive actions go through the existing `WriteGuard` confirm-token flow.

## Data flow

Identical to existing tools. Each new domain follows the pattern of `domains/pages.ts` etc.

## Errors & security

- No new error codes.
- `image.save`, `components.discard_draft`, `components.publish`, `mail.save`, `mail.test`, `mail.reset`, `system.update`, `file_meta.edit_info` are destructive (gated by `WriteGuard`).
- `image.save` accepts large base64; the Zod schema caps payload size to a configurable cap (default 8 MiB; same as the existing media upload cap to be consistent).
- `mail.test` requires a `to:` email; missing/invalid → `VALIDATION`.

## Testing

Per new tool: 1 happy + 1 confirm-token-pending + 1 missing-required per destructive action; 1 happy per read action. ~25 new tests.

## Acceptance criteria

1. Five new tools appear in the MCP tools list, with the action counts above.
2. The autogen tool table in README/CLAUDE/index.html reflects the 5 new tools.
3. `automad_discover.list` reports the new tools and their action flags.
4. All existing 425 tests still pass; new tests pass.
5. `npm run verify` green: build, lint, tests, coverage, `docs:sync --check`.
6. No new runtime dependencies.
7. Source-verification step at Task 1/2 time (component request bodies, image body, file edit_info body) — implementation will verify the exact request shape against the v2 source before writing code.
