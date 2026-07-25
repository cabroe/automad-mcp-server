## [0.5.2]

### Fixed
- **`HttpClient` mis-classified v2's `200 + {code: 200, error: "..."}` envelope
 as `UNKNOWN`** when the server-side validation message was a known pattern
 (e.g. "Title missing!", "Page not found!", "Title required!", "Url required!").
 Added a small heuristic (`looksLikeServerValidation`) that maps these to
 `VALIDATION` so callers can correct the request instead of treating it as
 an unknown server error. Non-validation 200 errors still surface as
 `UNKNOWN`. Live-verified: `pages.duplicate /nonexistent` now returns
 `code: "VALIDATION"`; previously `code: "UNKNOWN"`.
- **`theme.scaffold` with an empty `name` returned a pending confirm token**
 instead of a `VALIDATION` error. The name check ran inside the switch-case,
 after the destructive-action guard had already issued a `confirmToken`.
 Moved the check to run before `guard.check()`; an empty or whitespace-only
 `name` now returns `code: "VALIDATION"` immediately. Live-verified.
- **`ThemeManager.install` had no timeout on `git clone`** - a slow remote
 could block the MCP indefinitely. Switched the git-clone path through
 `runCommand` (which already has a 5-minute hard timeout and 64 KB output
 cap) so all theme-tooling child-process commands share one hardening layer.
- **`ThemeManifest` type was missing the `name` field** that the v2 theme
 format actually requires (and that `scaffold()` writes). Added `name?: string`
 so the type matches the wire format and downstream code that reads
 `theme.json` isn't forced through `any` casts.
- **`mapStatusToCode` did not cover HTTP 410 Gone** (semantically `NOT_FOUND`).
 Now both 404 and 410 map to `NOT_FOUND`.
## [0.5.1]

### Added
- **`automad_media.delete`** — new destructive action that calls
  `/_api/file-collection/list` with `action: "delete"` and a `selected` map
  (v2's standard multi-file-delete convention). Required parameters: `url`
  (parent directory) + `filename` (file within). In `confirm-destructive`
  mode (the default) the call returns a `confirmToken` that must be replayed
  to actually delete the file. Verified live against
  `automad/automad:v2` (beta.51): deleting `apple-touch-icon.png` from
  `/shared` removed it from the subsequent list. Note: v2 has no
  in-place file rename endpoint — the closest is `action: "move"` between
  directories, which is not yet wrapped.


## [0.5.0]

### Added
- **MCP prompts** — five workflow prompts (`create_blog_post`, `scaffold_theme`,
  `analyze_theme`, `check_headless_setup`, `find_docs`) that steer the model
  through the real tool actions.
- **Opt-in live E2E test** (`tests/e2e/live.test.ts`, `npm run test:e2e`) — spawns
  the built server over stdio and exercises the page lifecycle against a real
  Automad v2 instance; skipped unless `AUTOMAD_E2E_*` is set. Verified green
  against `automad/automad:v2` (beta.51).

### Fixed
- **`pages.list` returned `FORBIDDEN` "CSRF token mismatch"** against live v2.
  The body-less POST to `/_api/page-collection/get-recently-edited` omitted the
  `__csrf__` field; it now sends an empty JSON body so the CSRF token is attached
  like every other endpoint. Found via full-tool testing against a real instance.
- **Cold-start login false negative** — the first request against a freshly
  started v2 could 403 the auth probe while the session/CSRF settled, making
  `site.health` (or any first call) report `authenticated:false`. `AuthManager`
  now re-scrapes the CSRF token and retries the probe up to 3× on a transient
  403; genuine failures (bad credentials, anonymous session) still fail fast.
  Verified: first-ever `site.health` against a cold container now returns `ok:true`.
- **Theme path-traversal via the `theme` parameter** — `automad_theme`
  accepted any string for `theme` (e.g. `".."`), and `editor.resolveInTheme`
  only verified that the *file* stayed inside the theme root — not that the
  theme root itself stayed inside `AUTOMAD_THEMES_PATH`. A crafted
  `theme:".."` would let `theme.write` create or overwrite arbitrary files
  the MCP process had write access to. Introduced `assertSafeThemeSlug`
  (`[a-z0-9._-]+`, no `..`, no leading `.`) and now apply it in the domain
  handler, `manager.{install,activate,uninstall}`, and `scaffold`; the
  editor additionally re-validates `themeRoot ⊆ themesPath`. Reproduced live
  (`/tmp/PWNED.txt` outside the themes dir) and verified blocked after fix.
- **`pages.batch_update` / `pages.update` ignored the documented safety model
  for title changes** — in the default `confirm-destructive` mode, a batch of
  9 harmless updates + 1 title-rename would silently perform all 10 on a
  single confirmation (rename happens during publish, which IS destructive).
  Introduced an internal `pages.update_rename` action that is fired only when
  the input carries a `title`; it is in `DESTRUCTIVE_ACTIONS` and outside the
  public registry. Each batch item now checks per-(action, target) and returns
  a per-item `confirmToken` for rename items; safe items run directly.
  Per-item errors preserve the `{code, message, details?}` envelope instead of
  a bare string. Verified live: 1 safe + 1 rename → `requiresConfirmation:true`
  on the rename item only; replay with the token completes the rename.
- **`site.search` with a `replace` value was not classified as destructive** -
 the action was registered as read-only, so in the default
 `confirm-destructive` mode a caller could run a global site-wide search-and-
 replace with a single call and no confirm token. Added an internal
 `site.search_replace` WriteAction, gated behind `guard.check()` in the domain
 handler, and registered it as destructive. Verified live: search-with-replace
 now returns `allowed:"pending"` with a `confirmToken`; bare search still
 runs read-only.
- **`theme.write` was registered as destructive but missing from
 `DESTRUCTIVE_ACTIONS`** - the registry and the write-guard had silently
 drifted. In `confirm-destructive` mode the guard would not have prompted
 for a token before overwriting a theme file. The drift test caught it on
 this pass; added `theme.write` to the destructive set. Verified live:
 `theme.write` now returns `allowed:"pending"`; replay with the token
 completes the write.
- **`media.upload` had no upper bound on the base64 payload** - a caller
 could send a multi-hundred-megabyte base64 string and the server would
 allocate the full decoded buffer before any v2-side check. Added a 12 MB
 base64-string ceiling on the `mediaInput` schema
 (`MAX_BASE64_INPUT = 12 * 1024 * 1024`), with a clear validation error when
 exceeded. Covers images, SVGs, and most PDFs.
- **`pages.batch_update` and `theme.write` had no upper bound on payload size**
 - a caller could send 5,000+ page updates in a single batch (sequential, so
 the MCP held the request open for 20+ seconds) or write a multi-hundred-MB
 theme file (held the request open for 10+ seconds and consumed equivalent
 memory). Added `MAX_BATCH_ITEMS = 200` to `pagesInput.items` and
 `MAX_THEME_FILE_BYTES = 4 * 1024 * 1024` to `themeInput.content`. Both surface
 as Zod `too_big` validation errors before any v2 / FS call. Verified live.
- **`HttpClient` had no per-request timeout** - a hung v2 (high CPU, network
 stall, deadlock) would block the MCP indefinitely. Each call now uses an
 `AbortController` with a default 30s timeout, overridable via the
 `AUTOMAD_REQUEST_TIMEOUT_MS` env var (set to `0` to disable). Verified
 live: `AUTOMAD_REQUEST_TIMEOUT_MS=1` causes an immediate
 `This operation was aborted`.
- **`AuthManager.scrapeCsrf` did not adopt rotated session cookies** - v2
 can rotate the session cookie on `/dashboard` (e.g. when the previous
 session expired or bootstrap completed mid-request). The MCP kept the
 stale cookie, leading to 401/403 on the next call. Now adopts the rotated
 cookie if v2 returns one. `collectCookie` also tolerates Headers objects
 that lack `getSetCookie()` (older runtimes / test mocks).

## [Unreleased]

### Known limitations / future work
- **v2 has no API-token provider.** The MCP authenticates by scraping a
  PHP session cookie and a `<meta name="csrf">` token from `/dashboard`.
  This is fragile by design — v2 only ships session auth (with optional
  TOTP). Upstream issue / feature request: a Bearer-token API for headless
  integrations. The MCP can be hardened around scraping (already done in
  0.5.0: `setSafeThemeSlug`, cold-start probe resilience, cookie-rotation
  adoption) but cannot replace session auth without a v2-side change.
- **`media.rename` not implemented.** v2's `/_api/file-collection/list`
  supports `action: "move"` (file → different directory) but no in-place
  rename. If added: model as download+delete+upload, or push for a v2
  rename endpoint.
- **MCP transport is stdio-only.** Per MCP convention, headless local tool
  servers use stdio. An HTTP transport would be the responsibility of
  the MCP framework (e.g. an orchestrator that wraps the stdio server),
  not of this server itself. Out of scope here.

## [0.4.0]

### Added
- **`automad_docs` tool** — offline, bundled Automad v2 knowledge base with
  `list` / `search` / `get` actions. Ships in `dist/` as embedded content;
  needs no live instance.
- **`automad://docs` and `automad://docs/{slug}` resources** — knowledge-base
  index (JSON) and per-page body (Markdown).
- **`AUTOMAD_MODE`** env var — `full` (default, live instance) or `docs`
  (standalone docs + theme tooling, no instance/credentials required). Live-API
  tools return `UNSUPPORTED` in docs mode.
- **Startup env validation** — `AUTOMAD_URL` is validated as an http(s) URL
  (trailing slash stripped); `LOG_LEVEL` and `AUTOMAD_MODE` are validated
  against their allowed values and fail fast.
- **`automad_site.health`** — checks live-instance reachability/auth and reports
  version, sitename, and latency.
- **`automad_theme.diff`** — previews a `write` as a unified diff without
  touching disk.
- **`automad_theme.generate`** — generates snippet / block / component / nav /
  pagelist / breadcrumbs / i18n templates (returns path + content).
- **`automad_pages.publish`** — explicit draft→live publish.
- **`automad_pages.batch_update`** — sequential multi-page updates with
  per-item results.
- **`publish` flag** on `pages.create` / `pages.update` — set `false` to keep a
  draft (explicit draft→edit→publish workflow).
- **Composer support** — `automad_theme.build` runs `composer install` first
  when a `composer.json` is present.

### Changed
- Packaging: publish-ready `package.json` (repository, keywords, `publishConfig`,
  `prepublishOnly`); installable via `npx @automadcms/mcp-server`.
- README: copy-paste MCP configs for Claude Desktop/Code, Cursor, Cline, and Zed,
  plus a docs-only setup.
- Server version bumped to `0.4.0`.
