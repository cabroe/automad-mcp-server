# Changelog

All notable changes to `@automadcms/mcp-server` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
