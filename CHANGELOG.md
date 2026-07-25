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
