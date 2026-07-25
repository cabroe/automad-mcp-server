# @automadcms/mcp-server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for **[Automad v2](https://automad.org/version-2)** — pages, media, shared data, config, site actions, full local-filesystem theme tooling (scaffold / build / generate / edit), and an offline Automad knowledge base — over stdio.

> **Status:** beta — verified against a live `automad/automad:v2` Docker container. Runs in two modes: **full** (live instance) and **docs** (standalone docs + theme tooling, no instance required).

The server bridges to Automad v2's `/_api/{controller}/{method}` JSON dispatch layer via session-cookie + per-POST CSRF token, and (for the theme tool) to the local filesystem where themes live.

## Requirements

- Node.js ≥ 20
- A running Automad v2 installation (e.g. `docker run -dp 8080:80 automad/automad:v2`) with dashboard access
- For the theme tool: `node`, `npm`, and `git` available on the same host as the MCP server, plus read/write access to the themes directory

## Install

Run directly with npx (no clone needed):

```bash
npx @automadcms/mcp-server
```

Or build from source:

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
| `AUTOMAD_MODE` | no | `full` | `full` (live instance) or `docs` (standalone docs + theme tooling, no instance/credentials) |
| `AUTOMAD_URL` | yes (full) | — | Base URL of the Automad v2 site, e.g. `https://blog.example.com` |
| `AUTOMAD_USER` | yes (full) | — | Dashboard username (used as `name-or-email` in `/_api/session/login`) |
| `AUTOMAD_PASS` | yes (full) | — | Dashboard password |
| `AUTOMAD_THEMES_PATH` | yes (if using `automad_theme`) | — | Absolute path to the local themes directory (the same path Automad uses for `packages`) |
| `AUTOMAD_STARTER_KIT_PATH` | no | `AUTOMAD_THEMES_PATH` | Path to the [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit) used by `theme.scaffold` |
| `AUTOMAD_WRITE_MODE` | no | `confirm-destructive` | `read-only` \| `confirm-destructive` \| `unrestricted` |
| `LOG_LEVEL` | no | `info` | Pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent`) |

In `AUTOMAD_MODE=docs` the live-API tools (`automad_pages`, `automad_media`, `automad_shared`, `automad_config`, `automad_site`) return `UNSUPPORTED`; `automad_docs` and (when `AUTOMAD_THEMES_PATH` is set) `automad_theme` still work. `AUTOMAD_URL` is validated as an http(s) URL and an invalid `LOG_LEVEL`/`AUTOMAD_MODE` fails fast at startup.

> **v2 has no bearer-token auth** (the v1-era `AUTOMAD_TOKEN` is gone). All authenticated calls use a PHP session cookie + a CSRF token scraped from the dashboard HTML.

## Authentication & CSRF

The MCP logs in once on first use (`POST /_api/session/login`, urlencoded `name-or-email`+`password`, CSRF-exempt) and stores the `Automad-<md5>` session cookie. Every authenticated `POST` then needs a `__csrf__` form field whose value matches the token in the rendered dashboard HTML. The AuthManager fetches the dashboard (`GET /dashboard` — follows the `Location: /dashboard/setup` redirect on first run) and extracts the token from the `<meta name="csrf" content="…">` tag. A `403 CSRF token mismatch` triggers one automatic rescrape + retry.

## Write protection

Three modes, set via `AUTOMAD_WRITE_MODE`:

- **`read-only`** — only non-mutating actions succeed. Read-only actions (19): `automad_docs.*` (`list`/`search`/`get`); `pages.list`/`pages.get`; `media.list`; `shared.get`; `config.get`; `site.info`/`site.search`/`site.health`; and `theme.list`/`read`/`files`/`analyze`/`validate`/`schema`/`diff`/`generate`. Everything else returns `FORBIDDEN`.
- **`confirm-destructive`** *(default)* — ordinary writes run directly (`pages.create`/`update`/`duplicate`/`publish`/`batch_update`, `media.upload`, `shared.set`, `config.set`). The eight destructive actions — `pages.delete`, `pages.move`, `theme.install`, `theme.activate`, `theme.uninstall`, `theme.scaffold`, `theme.build`, `theme.write` — return a `confirmToken` (5-min TTL, bound to the `(action, target)` pair). Replay the same call with `confirm_token` to execute.
- **`unrestricted`** — everything runs immediately.

## Tools

The server exposes **seven tools**. Each takes an `action` parameter and dispatches to a domain router. Live-API actions map to real, live-verified `/_api` endpoints; `automad_theme` uses the local filesystem; `automad_docs` is a bundled offline knowledge base.

| Tool | Actions | What it does |
|---|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` `publish` `batch_update` | `/_api/page/data` (read + save), `/_api/page/add` (draft; auto-publishes unless `publish:false`), `/_api/page/publish`, `/_api/page/delete`, `/_api/page/move` (sibling reordering, not rename), plus sequential batch updates |
| `automad_media` | `list` `upload` | `/_api/file-collection/list` (page/shared dir), `/_api/file-collection/upload` (single-chunk Dropzone) |
| `automad_shared` | `get` `set` | `/_api/shared/data` (site-wide data: sitename, consent, custom fields) |
| `automad_config` | `get` `set` | `get` reads `/_api/app/bootstrap`; `set` posts to `/_api/config/update` with a `type:` discriminator (`cache`, `feed`, `debug`, `i18n`, etc.) |
| `automad_site` | `info` `search` `health` | `info`/`health` from `/_api/app/bootstrap`; `search` via `/_api/search/search-replace` (read-only when `replace` is omitted) |
| `automad_docs` | `list` `search` `get` | Offline Automad v2 knowledge base (template syntax, control structures, navigation, i18n, blocks, theme.json, headless/REST API, getting started) — works with no live instance |
| `automad_theme` | `list` `install` `activate` `uninstall` `scaffold` `build` `read` `write` `files` `analyze` `validate` `schema` `diff` `generate` | Local-FS theme tooling, Starter-Kit analysis, normalized schema, change preview (`diff`), and snippet/block/component generation — requires `AUTOMAD_THEMES_PATH` |

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

### MCP resources

The server exposes four read-only resources. The list is static for the lifetime of the server process (`listChanged: false`).

| URI | Returns |
|---|---|
| `automad://themes` | JSON list of discovered themes with manifest metadata |
| `automad://themes/{slug}/schema` | JSON normalized theme schema (matches `automad_theme.schema` output) |
| `automad://docs` | JSON index of the bundled knowledge-base pages |
| `automad://docs/{slug}` | Markdown body of one knowledge-base page (e.g. `automad://docs/template-syntax`) |

The `{slug}` variable must match `^[a-z0-9._-]+$`. Invalid slugs return `NOT_FOUND`. Both resources require `AUTOMAD_THEMES_PATH` for meaningful output; otherwise `automad://themes` returns an empty list and `automad://themes/{slug}/schema` returns `NOT_FOUND`.

`automad_theme.schema` returns every locale together with the original base metadata. Locale entries are sparse overrides; missing translations fall back to `theme.json`. Only direct `i18n/<locale>.json` files are parsed. Partial invalid sections or values are reported as `INVALID_I18N_*` warnings, while the remaining valid values are retained. The action performs no build, network, or file mutation and is suitable for reuse as a future MCP Resource.
Each field includes its Automad type (`text`, `checkbox`, `color`, `image`, `icon`, `select`, `url`, `format`, `label`, `filter`, or `block`), scope (`page`, `shared`, or `unmasked`), source files, and available labels, options, tooltips, and field order. Unknown prefixes fall back to `text` with an `UNKNOWN_FIELD_PREFIX` warning. The action performs no build, network request, or mutation and is designed for later reuse by an MCP Resource.

### MCP prompts

Five workflow prompts steer the model through the real tool actions. Prompt arguments are strings (per the MCP prompt contract).

| Prompt | Arguments | Workflow |
|---|---|---|
| `create_blog_post` | `title`, `parent?`, `summary?` | draft → fill → publish a page |
| `scaffold_theme` | `name`, `author?` | scaffold → generate → diff → write → build → activate |
| `analyze_theme` | `theme` | analyze + validate + schema → a prioritized list of fixes |
| `check_headless_setup` | — | `site.health` + config + headless docs |
| `find_docs` | `topic` | search the knowledge base → get → summarize |

### Internal capability registry

The server keeps the public domain-router tools unchanged and maintains a static internal capability registry for their action metadata. The registry records read-only/destructive behavior and validates router/action coverage during server construction (`validateCapabilityRegistry`). It is not exposed as one MCP tool per action and performs no filesystem, network, token, or audit work. Later scoped tokens, audit logging, and HTTP authorization can consume the same metadata without changing the public router contract.

### Supported vs. not exposed (v2 reality)

Supported with real endpoints:

- `pages.duplicate` — `/_api/page/duplicate`
- `pages.move` — `/_api/page/move` (**sibling reordering / reparenting**, not a title rename; a rename happens implicitly during `page/publish` when the title changes)
- `theme.activate` — best-effort via `/_api/package-manager/install`; if v2 rejects it, the theme is still on disk and can be activated from the dashboard (`activated: false` is returned, not an error)

Not exposed, because v2 has no endpoint:

- `media.delete` / `media.rename` — no v2 endpoints (upload + list only)
- `snippets`, `templates` — v1-era tools; in v2 these are components/shared data
- `site.backup` / `site.restore` — no v2 endpoints
- `config.validate` — no v2 endpoint

Known v2-side issue:

- `/_api/public/pagelist` currently 500s (Automad-internal bug, `PublicController.php:107` on 2.0.0-beta.15). `automad_pages.list` therefore uses `/_api/page-collection/get-recently-edited` instead.

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

> `theme.build` runs `composer install` first when a `composer.json` is present, then `npm install` + `npm run build` (the esbuild pipeline). Pass `install: false` to skip the dependency installs and only re-run the build. The Starter Kit's local dev server (`npm run dev`) is a local dev workflow; no `automad_theme` action starts it.

### Example: preview a change, generate a snippet

```jsonc
// Preview an edit before writing it (read-only unified diff)
{ "action": "diff", "theme": "my-theme", "path": "snippets/nav.php", "content": "<@ snippet nav @>...<@ end @>" }
// → { "path": "snippets/nav.php", "changed": true, "added": 12, "removed": 0, "diff": "--- a/... +++ b/..." }

// Generate a recursive navigation snippet (returns path + content; persist it with `write`)
{ "action": "generate", "kind": "nav", "name": "mainNav" }
// → { "kind": "nav", "path": "snippets/mainNav.php", "content": "<@ snippet mainNav @>...", "notes": "..." }
```

Generator kinds: `nav`, `pagelist`, `breadcrumbs`, `component`, `block`, `i18n`, `snippet`.

## Host setup

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`). The zero-install variant uses `npx`:

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
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

To run from a local build instead, use `"command": "node", "args": ["/absolute/path/to/automad-mcp-server/dist/index.js"]` with the same `env`.

**Docs-only mode** (no Automad instance, no credentials — just the knowledge base and, optionally, theme tooling):

```json
{
  "mcpServers": {
    "automad-docs": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": {
        "AUTOMAD_MODE": "docs",
        "AUTOMAD_THEMES_PATH": "/app/packages"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (or per-project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": { "AUTOMAD_URL": "https://blog.example.com", "AUTOMAD_USER": "admin", "AUTOMAD_PASS": "your-password" }
    }
  }
}
```

### Cline (VS Code)

In `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": { "AUTOMAD_URL": "https://blog.example.com", "AUTOMAD_USER": "admin", "AUTOMAD_PASS": "your-password" }
    }
  }
}
```

### Zed

In `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "automad": {
      "command": { "path": "npx", "args": ["-y", "@automadcms/mcp-server"] },
      "settings": {}
    }
  }
}
```

Provide the `AUTOMAD_*` variables via Zed's environment (Zed passes `command.env` when supported by your version).

## Development

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest (unit + domain; live E2E auto-skips)
npm run test:coverage
npm run lint        # eslint
npm run dev         # tsx src/index.ts

# opt-in live E2E against a real Automad v2 instance:
AUTOMAD_E2E_URL=http://localhost:8899 AUTOMAD_E2E_USER=admin \
  AUTOMAD_E2E_PASS=secret npm run test:e2e
```

Project layout:

```
src/
  index.ts          entry: config, stdio transport, graceful shutdown
  server.ts         McpServer + 7 tool + 4 resource + 5 prompt registrations
  config.ts         env loader: mode split, URL/log-level validation, write-mode
  auth.ts           session login + cookie jar + CSRF scrape
  client.ts         HTTP client: /_api envelope unwrap, multipart __csrf__+__json__, retry + re-CSRF
  errors.ts         typed AutomadMcpError
  logger.ts         pino with credential redaction
  schemas.ts        Zod input schemas for all tools
  write-guard.ts    multi-tier write protection + confirm-token flow
  prompts.ts        MCP workflow prompts
  docs/kb.ts        bundled offline knowledge base (automad_docs)
  domains/          one router per tool: pages, media, shared, config, site, theme, docs
  theme/            theme tooling, Starter-Kit analysis, normalized schemas
    schema.ts       pure normalized ThemeSchemaBuilder
    diff.ts         unified-diff preview for theme.diff
    generate.ts     snippet/block/component generator
  resources/        MCP resource backers (themes)
  capabilities/     internal router/action metadata and invariant validation
tests/unit/         Vitest unit and domain tests
tests/e2e/          opt-in live E2E vs. a real Automad instance (npm run test:e2e)
```

## License

[MIT](./LICENSE)
