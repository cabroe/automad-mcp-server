# @automadcms/mcp-server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for **[Automad v2](https://automad.org/version-2)** — pages, media, shared data, config, site actions, and full local-filesystem theme tooling (scaffold / build / edit) over stdio.

> **Status:** alpha — functional, verified against a live `automad/automad:v2` Docker container. Not yet published to npm.

The server bridges to Automad v2's `/_api/{controller}/{method}` JSON dispatch layer via session-cookie + per-POST CSRF token, and (for the theme tool) to the local filesystem where themes live.

## Requirements

- Node.js ≥ 20
- A running Automad v2 installation (e.g. `docker run -dp 8080:80 automad/automad:v2`) with dashboard access
- For the theme tool: `node`, `npm`, and `git` available on the same host as the MCP server, plus read/write access to the themes directory

## Install

Not yet published to npm — build from source:

```bash
git clone https://github.com/cabroe/automad-mcp-server.git
cd automad-mcp-server
npm install
npm run build        # outputs dist/index.js
```

Then run with `npm start` (or `node dist/index.js`).

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTOMAD_URL` | yes | — | Base URL of the Automad v2 site, e.g. `https://blog.example.com` |
| `AUTOMAD_USER` | yes | — | Dashboard username (used as `name-or-email` in `/_api/session/login`) |
| `AUTOMAD_PASS` | yes | — | Dashboard password |
| `AUTOMAD_THEMES_PATH` | yes (if using `automad_theme`) | — | Absolute path to the local themes directory (the same path Automad uses for `packages`) |
| `AUTOMAD_STARTER_KIT_PATH` | no | `AUTOMAD_THEMES_PATH` | Path to the [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit) used by `theme.scaffold` |
| `AUTOMAD_WRITE_MODE` | no | `confirm-destructive` | `read-only` \| `confirm-destructive` \| `unrestricted` |
| `LOG_LEVEL` | no | `info` | Pino log level |

> **v2 has no bearer-token auth** (the v1-era `AUTOMAD_TOKEN` is gone). All authenticated calls use a PHP session cookie + a CSRF token scraped from the dashboard HTML.

## Authentication & CSRF

The MCP logs in once on first use (`POST /_api/session/login`, urlencoded `name-or-email`+`password`, CSRF-exempt) and stores the `Automad-<md5>` session cookie. Every authenticated `POST` then needs a `__csrf__` form field whose value matches the token in the rendered dashboard HTML. The AuthManager fetches the dashboard (`GET /dashboard` — follows the `Location: /dashboard/setup` redirect on first run) and extracts the token from the `<meta name="csrf" content="…">` tag. A `403 CSRF token mismatch` triggers one automatic rescrape + retry.

## Write protection

Three modes, set via `AUTOMAD_WRITE_MODE`:

- **`read-only`** — only non-mutating actions (`list`, `get`, `info`, `search`, `validate`, `files`, `read`).
- **`confirm-destructive`** *(default)* — ordinary writes run directly; destructive writes (`delete`, `move`, `install`, `activate`, `uninstall`, `scaffold`, `build`, `write`) return a `confirmToken` (5-min TTL). Replay the same call with `confirm_token` to execute.
- **`unrestricted`** — everything runs immediately.

## Tools

The server exposes **six tools**. Each takes an `action` parameter and dispatches to a domain router. Every action is supported by a real, live-verified `/_api` endpoint (or, for theme tooling, a local filesystem operation).

| Tool | Actions | What it does |
|---|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` | `/_api/public/pagelist`, `/_api/page/data` (read + save), `/_api/page/add` (auto-publishes the draft), `/_api/page/publish`, `/_api/page/delete`, `/_api/page/move` (sibling reordering, not rename) |
| `automad_media` | `list` `upload` | `/_api/file-collection/list` (page/shared dir), `/_api/file-collection/upload` (single-chunk Dropzone) |
| `automad_shared` | `get` `set` | `/_api/shared/data` (site-wide data: sitename, consent, custom fields) |
| `automad_config` | `get` `set` | `get` reads `/_api/app/bootstrap`; `set` posts to `/_api/config/update` with a `type:` discriminator (`cache`, `feed`, `debug`, `i18n`, etc.) |
| `automad_site` | `info` `search` | `info` from bootstrap; `search` via `/_api/search/search-replace` (read-only when `replace` is omitted) |
| `automad_theme` | `list` `install` `activate` `uninstall` `scaffold` `build` `read` `write` `files` `analyze` `validate` `schema` | Local-FS theme tooling, Starter-Kit analysis, and normalized schema inspection — requires `AUTOMAD_THEMES_PATH` |

`automad_theme.analyze` inventories a local theme without executing code or using the network. It reports manifests, root templates, `components/`, `blocks/`, `client/`, `icons/`, `i18n/`, `lib/`, build files, Automad field references, block fields, masks, and recognized Starter-Kit markers:

```json
{ "action": "analyze", "theme": "my-theme" }
```

`automad_theme.validate` runs the same inventory and returns `ok`, ordered `findings`, and severity counts. It checks `theme.json`, optional `package.json`/`composer.json`, root templates, i18n JSON, metadata consistency, field masks, and Starter-Kit build markers:

```json
{ "action": "validate", "theme": "my-theme" }
```

Both actions are explicitly read-only in every write mode. They do not run npm, Composer, Git, PHP, JavaScript, Docker, or browser processes. A missing theme returns `NOT_FOUND`; malformed manifests are returned as validation findings. `AUTOMAD_STARTER_KIT_PATH` is not needed for analysis and remains required only when scaffolding from a local starter-kit checkout.

`automad_theme.schema` builds a normalized, read-only field schema from the existing theme analysis:

```json
{ "action": "schema", "theme": "my-theme" }
```


#### Locale metadata (`theme.json` + `i18n/<locale>.json`)

The Starter Kit translates dashboard field metadata through `i18n/<locale>.json` files using the shape:

```json
{
  "labels": { "brand": "Branding Logo (SVG, HTML oder Text)" },
  "options": { "selectColorTheme": { "light": "Hell", "dark": "Dunkel" } },
  "tooltips": { "+main": "Der Haupt-Inhalt" }
}
```

`automad_theme.schema` returns every locale together with the original base metadata. Locale entries are sparse overrides; missing translations fall back to `theme.json`. Only direct `i18n/<locale>.json` files are parsed. Partial invalid sections or values are reported as `INVALID_I18N_*` warnings, while the remaining valid values are retained. The action performs no build, network, or file mutation and is suitable for reuse as a future MCP Resource.
Each field includes its Automad type (`text`, `checkbox`, `color`, `image`, `icon`, `select`, `url`, `format`, `label`, `filter`, or `block`), scope (`page`, `shared`, or `unmasked`), source files, and available labels, options, tooltips, and field order. Unknown prefixes fall back to `text` with an `UNKNOWN_FIELD_PREFIX` warning. The action performs no build, network request, or mutation and is designed for later reuse by an MCP Resource.

### Internal capability registry

The server keeps the six public domain-router tools unchanged and maintains a static internal capability registry for their action metadata. The registry records read-only/destructive behavior and validates router/action coverage during server construction. It is not exposed as one MCP tool per action and performs no filesystem, network, token, or audit work. Later Resources, scoped tokens, audit logging, and HTTP authorization can consume the same metadata without changing the public router contract.

### What v2 does NOT expose (intentionally omitted)

- `pages.duplicate` — no v2 endpoint, throws `UNSUPPORTED` with a hint (read source + `page/add`)
- `pages.move` (rename) — v2's `page/move` is **sibling reordering**; rename isn't supported, throws `UNSUPPORTED`
- `media.delete/rename` — no v2 endpoints
- `snippets`, `templates`, `theme.activate` (v2 has no `/_api/theme/*`) — old v1 tools, gone
- `site.backup/restore` — no v2 endpoints
- `config.validate` — no v2 endpoint
- `/_api/public/pagelist` — exists in v2 but currently 500s (Automad-internal bug, `PublicController.php:107` on 2.0.0-beta.15)

### Example: confirm-token flow

```jsonc
// 1. destructive call → returns a pending token (nothing deleted yet)
{ "action": "delete", "url": "/blog/old-post" }
// → { "allowed": "pending", "confirmToken": "a1b2…", "expiresAt": "…" }

// 2. replay with the token → executes
{ "action": "delete", "url": "/blog/old-post", "confirm_token": "a1b2…" }
// → { "ok": true }
```

### Setting up the Starter Kit (for `theme.scaffold`)

`theme.scaffold` copies a **local** directory into `AUTOMAD_THEMES_PATH/<slug>` and rewrites `theme.json` + `package.json` with the name/author/license you pass in — it does not fetch the [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit) itself. `AUTOMAD_STARTER_KIT_PATH` has to already point at a local checkout before you call it.

**Option A — clone it anywhere, point at it directly**

```bash
git clone --depth 1 https://github.com/automadcms/automad-theme-starter-kit.git ~/automad-starter-kit
```

```json
"AUTOMAD_STARTER_KIT_PATH": "/Users/you/automad-starter-kit"
```

Simplest option if the MCP host has normal filesystem access outside the themes directory.

**Option B — stage it inside `AUTOMAD_THEMES_PATH` via `theme.install`**

If you'd rather manage everything through the MCP tool, clone the starter kit into a dedicated subfolder under the themes path (prefix with `_` so it's clearly not a real theme), then point `AUTOMAD_STARTER_KIT_PATH` there:

```jsonc
// one-time setup — clones the raw template, does NOT rewrite theme.json/package.json
{ "action": "install", "source": "https://github.com/automadcms/automad-theme-starter-kit", "theme": "_starter-kit-template" }
```

```json
"AUTOMAD_STARTER_KIT_PATH": "/app/packages/_starter-kit-template"
```

Only `theme.scaffold` rewrites the manifest metadata — `theme.install` is a plain clone/copy. Don't activate `_starter-kit-template` itself as a theme; it's just the template source for future `scaffold` calls.

Once `AUTOMAD_STARTER_KIT_PATH` is set (either way), `theme.scaffold` works as shown below.

### Example: theme scaffold + build

```jsonc
// 1. Scaffold a new theme from the starter kit
{ "action": "scaffold", "name": "My Theme", "author": "me" }
// → { "path": "/app/packages/my-theme", "files": 56, "manifest": { "name": "My Theme", ... } }

// 2. Edit a block layout
{ "action": "write", "theme": "my-theme", "path": "blocks/grid.php", "content": "<?php /* edited via MCP */ ?>" }

// 3. Install npm deps + run the esbuild pipeline
{ "action": "build", "theme": "my-theme" }
// → { "install": { "ok": true, "durationMs": 12000, ... }, "build": { "ok": true, "durationMs": 850, ... } }

// 4. Try to activate via v2 (best-effort — v2 may not pick it up automatically on every setup)
{ "action": "activate", "theme": "my-theme" }
// → { "activated": true, "remote": { "code": 200 } }   or   { "activated": false, "remote": {...} }
```

> `theme.build` only runs the npm/esbuild pipeline (`npm install` + `npm run build`). If the theme grows PHP dependencies via `composer.json`, run `composer install` manually on the host — the MCP tool doesn't do that. Likewise, the Starter Kit's local dev server (`npm run dev` — PHP built-in server + esbuild watch, per its own README) is a local dev workflow; no `automad_theme` action starts it.

## Host setup

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "automad": {
      "command": "node",
      "args": ["/absolute/path/to/automad-mcp-server/dist/index.js"],
      "env": {
        "AUTOMAD_URL": "https://blog.example.com",
        "AUTOMAD_USER": "admin",
        "AUTOMAD_PASS": "your-password",
        "AUTOMAD_THEMES_PATH": "/app/packages",
        "AUTOMAD_STARTER_KIT_PATH": "/path/to/automad-theme-starter-kit",
        "AUTOMAD_WRITE_MODE": "confirm-destructive"
      }
    }
  }
}
```

### Cursor / Cline / Zed

Point the MCP server `command` at the built `dist/index.js` (run `npm run build` first) and provide the same environment variables.

## Development

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm run test:coverage
npm run lint        # eslint
npm run dev         # tsx src/index.ts
```

Project layout:

```
src/
  index.ts          entry: config, stdio transport, graceful shutdown
  server.ts         McpServer + 6 tool registrations
  config.ts         env loader + write-mode validation
  auth.ts           session login + cookie jar + CSRF scrape
  client.ts         HTTP client: /_api envelope unwrap, multipart __csrf__+__json__, retry + re-CSRF
  errors.ts         typed AutomadMcpError
  logger.ts         pino with credential redaction
  schemas.ts        Zod input schemas for all tools
  write-guard.ts    multi-tier write protection + confirm-token flow
  domains/          one router per tool: pages, media, shared, config, site, theme
  theme/            theme tooling, Starter-Kit analysis, and normalized schemas
    schema.ts       pure normalized ThemeSchemaBuilder
  capabilities/     internal router/action metadata and invariant validation
tests/unit/         Vitest unit and domain tests

## License

[MIT](./LICENSE)
