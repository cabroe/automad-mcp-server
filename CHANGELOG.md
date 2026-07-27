## [Unreleased]

### Added
- **Reproducible local test environment.** `docker-compose.e2e.yml` +
 `scripts/testenv.ts` bring up a throwaway `automad/automad:v2` instance on
 `127.0.0.1:8899` (named volume, curl healthcheck) and wire it to the MCP
 server end to end: `npm run e2e:up` starts the stack, waits until
 `/_api/session/validate` answers, creates a **deterministic** dashboard admin
 (the image otherwise prints a random user + password to its log) via
 `php /app/automad/console user:create`, and writes a gitignored `.env.e2e`.
 `e2e:down` destroys container, volume and env file. Every subcommand is
 idempotent — `up` on a healthy stack just re-verifies the login. Also
 `e2e:status`, `e2e:logs`, and `e2e:serve` (runs the MCP server in full mode
 against the container for MCP Inspector / manual JSON-RPC).
- **Rebuilt live E2E suite** (`tests/e2e/**`, 47 tests across 6 files, own
 `vitest.e2e.config.ts`). Everything runs against the real backend — no mocks:
 - `auth` — login, CSRF reuse across read → write → read, the advertised tool
   surface (asserted against the capability registry, not a hard-coded list),
   resources, prompts, and bad-credential handling.
 - `pages` — create → get → update → rename → publish → duplicate →
   breadcrumbs → delete, plus the draft path and the trash.
 - `media` — upload → list → delete against the real single-chunk Dropzone
   endpoint.
 - `shared-config` — shared `fields`/`unused` split, config get/set, cache
   clear, site search.
 - `theme` — scaffold from the bundled starter kit into a temp directory,
   files/read/analyze/validate/schema/diff/write/generate, path-escape refusal.
 - `write-modes` — read-only refusals, the full confirm-token flow
   (pending → replay → executed), token/target binding, unknown tokens,
   rename-as-destructive, and confirm-token isolation between server processes.
 `tests/e2e/harness.ts` spawns the built server over stdio through the MCP SDK
 client and drains a cleanup registry in `afterAll`, so a failed test still
 removes its fixtures. Files run sequentially in a single fork (v2 races on
 concurrent writes to the same page tree).
- TBD: deferred work (AI tooling, edit-lock, in-page editing, file import).

### Fixed
- **Bad credentials were accepted.** `AuthManager.probeAuthenticated` treated a
 populated `data.sitename` from `/_api/app/bootstrap` as proof of a valid
 session — but that endpoint is **public** on 2.0.0-beta.51 and returns the
 same payload, `sitename` included, to anonymous callers. Any password
 therefore "logged in", and `site.health` reported `ok: true,
 authenticated: true` until the first genuinely protected call failed. The
 probe now targets the session-protected `/_api/shared/data` and rejects the
 `{data: {message: "No session"}}` shape v2 returns (HTTP 200, not 401) for
 anonymous sessions. The login response body is checked too — v2 answers a
 rejected login with HTTP 200 + `{"error": "Invalid username or password."}` —
 so bad credentials now fail immediately, before the dashboard scrape.
- **`pages.update` with only `fields` failed, and partial updates lost data.**
 v2's `page/data` save is a full replace that rejects any payload without a
 `title`, so a field-only update came back as
 `VALIDATION: Title missing!`, and an update that did carry a title silently
 dropped every field it didn't mention. `updateOnePage` now reads the current
 record first (declared `fields` plus the `unused` map v2 keeps for keys the
 active template doesn't declare) and merges the caller's changes on top. Same
 fix applies to `pages.batch_update`, which shares the code path. Cost: one
 extra read per update.

### Changed
- **`npm test` is now the offline unit suite only.** `vitest.config.ts` matches
 `tests/unit/**` and the live E2E tests moved to `vitest.e2e.config.ts`
 (sequential, long timeouts, `.env.e2e` auto-loaded via `tests/e2e/env.ts`).
 `npm run test:e2e` still works — it delegates to `npm run e2e:run`. No change
 to the MCP tool surface.
- **The nightly E2E workflow uses the same commands as a local run.**
 `.github/workflows/e2e.yml` calls `e2e:up` / `e2e:run` / `e2e:logs` /
 `e2e:down` instead of a hand-rolled `docker run` plus scraping credentials out
 of the container log with `grep`, so CI and local runs cannot drift apart.
 The old workflow also pinned a stale seven-tool list and had been failing
 against the current thirteen-tool surface.

## [0.7.5] - 2026-07-26

### Fixed
- **npm bin path** — the `bin.automad-mcp` entry used `./dist/index.js` (with
 the leading `./`), which npm's publish-time validator rejected and **silently
 removed** the entry. 0.7.5 on npm therefore shipped **without** the
 `automad-mcp` binary link, breaking `npx` and direct command use for
 consumers. The fix rewrites the path to `dist/index.js` (the form npm
 accepts). No code changes; this is a release-engineering fix.

### Notes
- **0.7.5 bundles all the work landed since 0.7.1** — theme dev server, KB
 pages split, GitHub Pages landing page, verify/smoke/commit scripts, the
 `@automadcms/mcp-server` → `automad-mcp-server` rename, HTTP transport,
 zero-config defaults, bundled starter kit, the 4 v2-controller tranches
 (trash/history/cache, package manager, page utilities, image/components/
 mail/system/file_meta), and the docs-drift tests. The per-feature notes
 live in the **0.7.4 / 0.7.1** sections below; the 0.7.5 release entry is
 intentionally narrow.


## [0.6.0] - 2026-07-25

### Changed
- **The capability registry is now the actual single source of truth, and the
 discovery facade scales with it.** `src/capabilities/registry.ts` declares each
 tool once (title, summary, description, runtime requirement, actions with
 `readOnly`/`destructive`/`internal` flags); everything else is derived from it:
 - `WriteAction` is a type-level derivation of the registry (no hand-written
   union), and `READ_ACTIONS`/`DESTRUCTIVE_ACTIONS` in `write-guard.ts` are
   built with `actionsWhere(...)` instead of being maintained by hand.
 - Each tool's Zod `action` enum comes from `actionEnum("automad_<tool>")`, so
   a registry action is callable without touching `schemas.ts`, and the literal
   union makes every domain router's `Record<Action, WriteAction>` map fail to
   compile until the new action is handled.
 - `server.ts` no longer spells out eight `registerTool` calls: it loops over
   `TOOL_BINDINGS` (`src/capabilities/tools.ts`), taking title, description and
   the runtime gate (`requires: live | themes | none`) from the registry.
 - The two internal, guard-only actions (`pages.update_rename`,
   `site.search_replace`) are declared in the registry via `internal(...)`
   instead of living only in `write-guard.ts` plus a test-side allowlist. They
   stay out of the Zod enums, `automad_discover` and the generated docs table.
 - `EXPECTED_ACTIONS` and `WRITE_ACTION_PREFIX` are gone — both duplicated data
   the registry already carries (the prefix is derived from the `automad_` tool
   name, validated at boot).
- **`automad_discover` describes every tool, including itself.** `describe`
 reads `TOOL_INPUT_SCHEMAS` (the same schemas the server registers), so
 `automad_discover` is no longer a `NOT_FOUND` hole in its own output. `list`
 and `describe` additionally report `writeAction` and `requires`, and
 `describe` returns the tool's `title`/`summary` alongside the full description.

### Added
- `validateToolBindings()` — boot-time check that every registry tool has a
 binding under its own name using its registered input schema.
- `tests/unit/capabilities-tools.test.ts` — covers the binding layer's gates
 (`requires: live` in docs mode, `requires: themes` without a themes path),
 schema validation before dispatch, and dispatch into the domain routers.
- `tests/unit/drift.test.ts` rewritten around the derivations: Zod enum values
 vs. advertised actions, guard sets vs. registry flags, internal actions hidden
 
## [0.7.1] - 2026-07-26
### Added
- **Theme dev server** — `automad_theme` gains `dev` / `dev_stop` / `dev_status`
 actions. `dev` runs `npm run dev` as a **detached background process**, writes
 `<theme>/.automad-mcp/{dev.json,dev.log}`, and returns the local URL (port
 discovered in this order: explicit `port` arg → `package.json` `scripts.dev`
 (`--port=N` / `PORT=N`) → the first `http://localhost:<port>` marker in the
 log, up to 20 s). `dev_stop` sends SIGTERM, escalates to SIGKILL after 5 s,
 and removes the record. `dev_status` reports the running state without
 blocking. A second `dev` call for the same theme returns `CONFLICT` until
 `dev_stop` is called. Live-verified end-to-end against
 `automad/automad:v2`: the dev server's PHP+esbuild pipeline starts and
 `curl http://localhost:8000` returns the expected content.
- **Two new theme analyzer findings** — `LANG_WITHOUT_I18N` (locale masks
 declared in `theme.json` but no `i18n/<locale>.json` file on disk) and
 `MAIN_SNIPPET_UNDEFINED` (a page mask of the form `+snippetName` whose
 snippet doesn't exist). Both are severity `info`, ordered alongside the
 existing `define`/`use` checks.
- **KB pages split** — `docs/kb.ts` (the bundled knowledge base) is now a
 thin re-exporter over 13 per-page modules in `docs/kb/pages/`. The split is
 invisible at runtime but makes adding / auditing individual KB pages
 tractable. A drift test pins `KB_PAGES` order and shape.
- **GitHub Pages landing page** — `docs/index.html` is now a self-contained
 single-file landing page (no script, no remote stylesheet, no remote
 image; pinned by `docs-drift.test.ts`). The tool table is generated from
 the capability registry via `npm run docs:sync`, so it cannot drift from
 the code. Counts (tool count, read/destructive, test count) are
 fenced markers that regenerate alongside the README.
- **`scripts/verify.ts`** — single-command pre-PR gate: runs
 `build` → `lint` → `vitest run` → `vitest run --coverage` (with the
 `vitest.config.ts` thresholds enforcing 80% stmt / 70% branch) →
 `docs:sync --check`. Fails fast on the first broken step.
- **`scripts/smoke.ts`** — end-to-end driver that spawns the built server
 over stdio, runs `theme.scaffold` → `theme.dev` (polls until running) →
 `curl` (HTTP 2xx/3xx) → `theme.dev_stop`. Lives in `npm run smoke`; no
 live Automad instance required (`AUTOMAD_MODE=docs` + a starter kit path
 is enough).
- **`scripts/commit.ts`** — Conventional-Commits validator. `npm run
 commit:check` validates HEAD (for CI / pre-push); `node scripts/commit.ts
 '<msg>'` validates + commits. Type- and scope-allow-lists are a single
 source of truth.
- **`scripts/docs-sync-all.ts`** — one-shot: runs `docs:sync` (static
 markers) and `docs:sync:tests` (TESTCOUNT via vitest) back-to-back.
 Available as `npm run docs:sync:all`.
- **`scripts/release.ts` `--push` / `--release` flags** — after tagging,
 `--push` runs `git push --follow-tags`; `--release` additionally runs
 `gh release create vX.Y.Z` with the matching CHANGELOG section as the
 release body (extracted via a new `extractChangelogSection` export).
 Convenience scripts `npm run release:full:{patch,minor,major}` wrap
 all three steps.

### Changed
- **`pages.create` now accepts a `template` field as `"{theme}/{template}"`
 (no `.php`)** — v2 splits on `/` and appends `.php`, so
 `my-theme/page` resolves to `packages/my-theme/page.php`. Lets a page
 bind to a theme that isn't the site default (the site default itself
 is not exposed via the API; it is set in the dashboard). Documented
 in `schemas.ts` JSDoc and in the README.
- **`theme.scaffold` now verifies the starter-kit layout** before copying
 (canonical layout: `theme.json`, `components/`, `blocks/`,
 `client/index.ts`, `esbuild.js`). A stale or wrong starter-kit
 directory now returns `VALIDATION` with a concrete missing-list
 instead of silently producing a broken theme.
- **Knowledge-base size unchanged at runtime** — splitting the KB into
 per-page modules does not affect the embedded content; the public
 surface (`automad://docs`, `automad://docs/{slug}`) is identical.
- **ThemeFs abstraction** — `ThemeFs` interface gained
 `appendLog(path, content)` and `readLogTail(path, maxBytes)` with a
 1 MiB cap and 256 KiB tail retention in the `LocalThemeFs`
 implementation. The dev server uses these exclusively; no direct
 `node:fs` calls in new code.
- **Documented the `template` field's `"{theme}/{template}"` convention**
 in `schemas.ts` JSDoc and the README. A new README section ("Bind a
 page to a specific theme/template") walks through it with a worked
 example.
- **README + GitHub Pages homepage** — both now describe the theme dev
 server, the `verify` / `smoke` / `commit-check` scripts, the
 `release:full:*` flow, and the page-template convention. The
 homepage's "Theme tooling" card mentions the dev server; the tools
 table shows `dev` / `dev_stop` / `dev_status` for `automad_theme`.

### Fixed
- **Two analyzer findings double-fired on generated output** — both
 `LANG_WITHOUT_I18N` and `MAIN_SNIPPET_UNDEFINED` previously reported
 against `<stubs>`/`<output>` directories that ship with the starter
 kit. The scan is now scoped to `snippets/` and `components/` for the
 relevant lookups and skips generated paths, so live reports contain
 only findings the user can act on.
- **`MAIN_SNIPPET_UNDEFINED` had a brittle fixture** — the test
 referenced a `mainSnippet` field on the analyzer's output that the
 code didn't actually return. Added the missing field to the
 `ThemeAnalysis` fixture literal so the test exercises the production
 code path.
- **`page-format.ts` was dead code** — the file existed for an old
 page-format reader, but nothing in the live HTTP path uses it. The
 tests that referenced it still passed because they imported the
 module directly. Removed the file; tests now use the real
 v2 `/_api/page/data` response path. No live consumer was affected.
- **`docs/kb` `headless.ts` was renamed to `headless-api.ts`** to
 match the spec/plan wording and to avoid colliding with any future
 "headless" UI module. Pure rename; no behavior change.
- **`release.ts` extraction off-by-one** — `extractChangelogSection`
 originally searched the slice for the next `## [` header **before**
 stripping the current one, so `end` was always 0 and the function
 returned a single newline. The function now strips the current
 header first; returns the full section block up to the next `## [`
 (or end of file).
- **Length-cap user-facing Zod string fields** — introduced `MAX_SHORT` (255), `MAX_MEDIUM` (1024), `MAX_LONG` (4096), `MAX_SLUG` (96) across tool Zod schemas to reject unconstrained payloads early.
- **`theme.dev` pre-flight check** — checks for `package.json` presence before running `npm` and returns a clear `VALIDATION` error instead of a cryptic `ENOENT` / child process error.
- **Split confirm-token error reasons** — `WriteGuard` now distinguishes between `"unknown token"`, `"expired token"`, and target/action mismatch.
- **`LOG_LEVEL` pre-flight validation** — validates `LOG_LEVEL` in `logger.ts` before Pino instantiation to produce clean error messages instead of raw Pino stacktraces.
- **Updated dependencies** — bumped `@modelcontextprotocol/sdk` and transitive packages via `npm audit fix`.


## [0.5.4] – [0.5.14]

_Reconstructed from git history: these were tagged per commit without their own
changelog sections (and without a `package.json` bump — the manifest stayed on
0.5.3 until 0.6.0). One line per tag, from the tagged commit._

- **0.5.14** — `automad_docs`: 5 v2-theme knowledge-base pages from a real-build bug report.
- **0.5.13** — `automad_docs`: BLOCKS entry expanded with all 26 v2 block types + properties.
- **0.5.12** — Dead `/version-2/*` doc URLs replaced with real automad.org URLs; CI matrix (Node 20/22), `docs:sync --check`, periodic live-E2E cron.
- **0.5.11** — README: LLM-friendly install section; broken `npx` snippets dropped.
- **0.5.10** — `client.ts`: `looksLikeServerValidation` split into targeted patterns.
- **0.5.9** — `auth.ts`: robust CSRF extraction via per-tag scan + fallbacks.
- **0.5.8** — `auth.ts`: session expiry recovered without a caller-visible 403.
- **0.5.7** — README + CLAUDE.md brought up to date with 0.5.6.
- **0.5.6** — `scripts/`: automated README + CHANGELOG + version bump (`docs:sync`, `release`).
- **0.5.5** — CLAUDE.md up to date with 0.5.x.
- **0.5.4** — README up to date with 0.5.x; repo description/topics.

## [0.5.3]

### Fixed
- **`SERVER_VERSION` in `server.ts` had drifted from `package.json`** (0.5.0 vs
 0.5.2). The MCP `initialize` handshake reported the wrong version to clients.
 Now reads the version directly from `package.json` at compile time (one
 source of truth). Added a regression test that pins `mcp.getServerVersion()`
 to `package.json#version` so future drift is caught by `npm test`.

### Changed
- Audited MCP resources (`automad://themes`, `automad://themes/{slug}/schema`,
 `automad://docs`, `automad://docs/{slug}`) and prompts against edge cases:
 unknown slugs, traversal slugs (`..`, URL-encoded), empty/long args. All
 resource errors surface as proper JSON-RPC errors (`-32603`); the MCP SDK
- propagates `AutomadMcpError` cleanly. No runtime fixes needed for resources
  or prompts in this pass; documented for future audits.

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

## Known limitations / future work

_Not tied to a release — long-standing constraints, mirrored in CLAUDE.md's "Out of scope"._

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
