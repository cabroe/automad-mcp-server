# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

`@automadcms/mcp-server` — a Model Context Protocol (MCP) server that lets AI
assistants manage an [Automad v2](https://automad.org/version-2) CMS site
over stdio. Bridges to v2's `/_api/{controller}/{method}` JSON dispatch layer,
authenticated via a PHP session cookie + per-POST CSRF token. The theme tool
also works on the local filesystem (where Automad's theme packages live).

## Commands

```bash
npm run build            # tsc → dist/  (ESM, strict)
npm test                 # vitest run
npm run test:coverage    # vitest + v8 coverage (gate: 80% stmts / 70% branches)
npm run lint             # eslint src tests
npm run dev              # tsx src/index.ts  (run the server locally)
```

The server reads env vars at startup. See [Configuration](#configuration) below.

## Architecture — Domain-Router pattern

Each MCP tool takes an `action` enum and dispatches internally. One router per
domain; all routers share the same shape: `guard.check()` → switch on action →
call `HttpClient`. The server is one process: `index.ts` boots config + auth +
client + guard + McpServer over stdio.

```
src/
  index.ts          entry: config + stdio transport + graceful shutdown
  server.ts         McpServer + 7 tool + 4 resource + 5 prompt registrations (createAutomadServer)
  config.ts         env loader; exports API_BASE = "/_api"
  auth.ts           AuthManager: POST /_api/session/login + cookie jar + CSRF scrape
  client.ts         HttpClient: multipart __csrf__+__json__ POST, envelope unwrap, retry
  errors.ts         AutomadMcpError + errorToJson (codes: AUTH, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, NETWORK, RATE_LIMITED, UNSUPPORTED, UNKNOWN)
  logger.ts         pino logger, credentials redacted
  schemas.ts        Zod input schemas (one per tool)
  write-guard.ts    multi-tier write protection + confirm-token flow
  prompts.ts        MCP workflow prompts (create_blog_post, scaffold_theme, analyze_theme, check_headless_setup, find_docs)
  page-format.ts    legacy — currently unused; consider removing
  docs/
    kb.ts           bundled offline Automad knowledge base (automad_docs source)
  capabilities/
    registry.ts     single source of truth: tool+action metadata (readOnly/destructive), validated at boot via validateCapabilityRegistry()
  resources/
    themes.ts       theme MCP resources (docs resources are served inline from docs/kb.ts)
  domains/
    pages.ts        /_api/page/* and /_api/public/pagelist
    media.ts        /_api/file-collection/list + /upload (single-chunk Dropzone)
    shared.ts       /_api/shared/data (site-wide data; replaces v1 snippets)
    config.ts       /_api/app/bootstrap (get) + /_api/config/update (set)
    site.ts         /_api/app/bootstrap (info) + /_api/search/search-replace
    theme.ts        local-FS theme tooling (delegates to src/theme/*)
    docs.ts         offline knowledge base (list/search/get; no HTTP, works in docs mode)
  theme/            (theme tool internals — kept separate from domains/)
    fs.ts           ThemeFs interface + LocalThemeFs (swap point for SSH later)
    build.ts        runCommand + npmInstall + npmBuild with timeout
    manager.ts      list / install / activate / uninstall / build
    analyzer.ts     ThemeAnalyzer: theme.json + template scan → structured analysis
    schema.ts       ThemeSchemaBuilder: analysis → normalized theme schema
    diff.ts         unifiedDiff: LCS line diff for theme.diff preview
    generate.ts     snippet/block/component generator (theme.generate)
    scaffold.ts     copy starter kit + rewrite theme.json + package.json
    editor.ts       readFile / writeFile / listFiles with path-traversal guard
tests/unit/         207 vitest tests, 27 files
tests/e2e/          opt-in live E2E vs. real Automad (skipped unless AUTOMAD_E2E_* set; `npm run test:e2e`)
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AUTOMAD_MODE` | no | `full` (default; live instance) or `docs` (standalone docs + theme tooling, no instance/credentials) |
| `AUTOMAD_URL` | full mode | Base URL of the Automad v2 site; validated as http(s), trailing slash stripped |
| `AUTOMAD_USER` | full mode | Dashboard username (sent as `name-or-email`) |
| `AUTOMAD_PASS` | full mode | Dashboard password (no bearer-token support in v2) |
| `AUTOMAD_THEMES_PATH` | optional | Absolute path to the local themes directory (enables `automad_theme`) |
| `AUTOMAD_STARTER_KIT_PATH` | optional | Starter-kit template path for `theme.scaffold` (defaults to `AUTOMAD_THEMES_PATH`) |
| `AUTOMAD_WRITE_MODE` | no | `read-only` \| `confirm-destructive` (default) \| `unrestricted` |
| `LOG_LEVEL` | no | Pino log level (default `info`); validated against pino levels |

`config.ts` sets `liveEnabled = (mode === "full")`. In `docs` mode the live-API
tools throw `UNSUPPORTED` (gated in `server.ts` via `liveGate()`); `automad_docs`
always works and `automad_theme` works when `AUTOMAD_THEMES_PATH` is set.
If `AUTOMAD_THEMES_PATH` is unset, the server still starts; the `automad_theme`
tool returns `isError code=UNSUPPORTED` for every action with a clear message.

## Authentication model (v2 only)

v2 has **no bearer-token auth**. The MCP does a two-step handshake:

1. **Login (once)**: `POST /_api/session/login` with urlencoded
   `name-or-email`+`password`. This call is CSRF-exempt. v2 sets a session
   cookie `Automad-<md5>=<id>` and creates a CSRF token in the session.
2. **Every authenticated POST** must include the CSRF token as a `__csrf__`
   form field. The MCP scrapes the token from the rendered dashboard HTML:
   `GET /dashboard` (follow the `Location: /dashboard/setup` redirect on first
   run) → regex `<meta\s+name="csrf"\s+content="([0-9a-f]{64})">`.

If a POST returns 403 with `error: "CSRF token mismatch"`, the client
automatically re-scrapes the dashboard and retries **once** (single retry to
avoid hammering a stuck token). All POSTs are `multipart/form-data` with
exactly `__csrf__` and `__json__` fields — the canonical v2 wire format
(from `client/admin/core/request.ts`).

## Conventions

- **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitReturns`, `noUncheckedIndexedAccess`). No `any`. Use
  `import type` for type-only imports.
- **ESM** — imports use explicit `.js` extensions (NodeNext resolution).
- **Static imports** for known modules; no `await import()`.
- **No redundant guards**: don't wrap `clearTimeout`/`clearInterval` in
  truthy checks (they're no-ops on null/undefined).
- **No inline casts on member access** — use `in`/`typeof` narrowing or a
  declared type, not `as Record<string, unknown>)["key"]`.
- **Static, finite lookup tables** → `Record<K, V>`. Runtime collections
  (add/remove) → `Set`/`Map`.
- **No 1-line function wrappers** unless they encode a stable contract.
- **Conventional Commits**, scoped: `feat(domains/pages): ...`,
  `fix(client): ...`, `test(theme): ...`.
- **Errors carry context** — throw `AutomadMcpError(code, message, details?)`,
  never swallow. The server wraps tool results; `errorToJson` serializes failures
  to `{code, message, details?}` JSON in the result's `text` field.
- **Dependency injection** — handlers take `(input, client, guard, ...deps)`;
  the HTTP client, auth, and ThemeFs are injectable so tests mock them.

## Safety model (write-guard)

Three modes via `AUTOMAD_WRITE_MODE`:

- **`read-only`** — only non-mutating actions succeed. Read-only set (19):
  `docs.list/search/get`, `pages.list/get`, `media.list`, `shared.get`,
  `config.get`, `site.info/search/health`, `theme.list/read/files/analyze/
  validate/schema/diff/generate`.
- **`confirm-destructive`** *(default)* — ordinary writes run directly
  (`pages.create/update/duplicate/publish/batch_update`, `media.upload`,
  `shared.set`, `config.set`). The eight destructive actions (`pages.delete`,
  `pages.move`, `theme.install`, `theme.activate`, `theme.uninstall`,
  `theme.scaffold`, `theme.build`, `theme.write`) return a `confirmToken`
  (5-min TTL). The LLM replays the same call with `confirm_token` set to execute.
- **`unrestricted`** — everything runs immediately.

A token is bound to its `(action, target)` pair — both are checked on
confirmation. Re-using a token for a different target fails.

The DESTRUCTIVE_ACTIONS whitelist in `write-guard.ts` is the single source of
truth for confirmation. Adding a new destructive action = adding to the
`WriteAction` union, the DESTRUCTIVE_ACTIONS set, **and** the matching
`destructive(...)` entry in `capabilities/registry.ts` (validated at boot by
`validateCapabilityRegistry()`, which also cross-checks every tool's action list).

## v2 contract notes (live-verified, not reverse-engineered)

The MCP integrates the *real* v2 `/_api` contract. These things bit us during
implementation; treat them as load-bearing constraints:

- **Drafts aren't readable** — `page/add` and `page/data` (save) produce drafts.
  `page/data` (read) only returns published pages. The MCP auto-publishes
  after create/update via `page/publish` + polls `page/data` (up to 3s) until
  the page is queryable (`publishAndWait`) — **unless `publish:false`**, which
  keeps the page as a draft (explicit draft→edit→publish; use `pages.publish`
  to publish later).
- **Renames happen during `page/publish`**, not during `page/data` (save).
  The save response carries `slug: "<new>"` — the MCP uses that to compute
  the canonical URL. Publish is sent to `input.url` (where the directory
  currently lives); v2 does the rename, then publish.
- **`page/move` is sibling-reordering / reparenting, not rename.** Requires
  `target_url` (destination parent); optionally takes a `layout` (JSON-encoded
  array of sibling URLs). The MCP throws `VALIDATION` when `target_url` is
  missing or `layout` is malformed. No v2 endpoint renames a page (a rename
  happens implicitly during `page/publish` when the title changes).
- **POST body is `multipart/form-data`** with exactly `__csrf__` and `__json__`
  fields (the canonical v2 wire format). An exception: `file-collection/upload`
  uses the `__json__` path *differently* — see `client.ts` for the multipart
  Dropzone build. A `__json__` field on the upload endpoint breaks v2
  (the endpoint skips `RequestHandler::convertJsonPost`), so the upload
  uses a plain `url` form field instead.
- **No bearer-token auth** anywhere in v2. Sessions are PHP session cookies.
- **Errors return as plain text** in some SDK validation paths (unknown enum
  value, missing required arg). These come through as `MCP error -32602`
  in the `text` field, not in our `{code, message}` envelope. Documented
  behavior — leave it.

## Testing patterns

- **Domain routers**: construct a mock `HttpClient` (`{ get, post, put, delete,
  upload }` as `vi.fn`) + a real `WriteGuard` with an unrestricted config.
  Use `mockResolvedValueOnce` for sequential calls, `mockResolvedValue` for
  catch-all defaults. Assert the handler calls the right endpoint and that
  error codes come back as `AutomadMcpError` with the expected `code`.
- **`server.ts`**: use `InMemoryTransport.createLinkedPair()` + the MCP `Client`
  to exercise the full `registerTool → handler → result` path without a real
  Automad backend. Assert `tools/list` enumerates all 6 tools and that every
  tool's `inputSchema` exposes an `action.enum`.
- **`client.ts`**: `vi.stubGlobal("fetch", ...)`; assert status→error-code mapping.
- **`auth.ts`**: stub `fetch` to return a Set-Cookie + a dashboard HTML with
  the `<meta name="csrf">` tag; assert cookie/CSRF handling.
- **`theme/*`**: use `node:fs.mkdtemp(os.tmpdir(), "mcp-")` for an isolated
  theme sandbox; copy the real starter kit from `/tmp/sk-analysis/...` for
  end-to-end coverage.
- **Live e2e**: spawn the built server with `dist/index.js`; pipe
  `initialize` → JSON-RPC calls; assert results. See `/tmp/mcp-live-themes/`
  setup in git history for the full sandbox layout.

## Tool behavior summary

| Tool | Actions | Endpoint |
|---|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` `publish` `batch_update` | `/_api/page/*` (create/update auto-publish unless `publish:false`; `batch_update` runs items sequentially) |
| `automad_media` | `list` `upload` | `/_api/file-collection/list`, `/upload` (single-chunk Dropzone) |
| `automad_shared` | `get` `set` | `/_api/shared/data` |
| `automad_config` | `get` `set` | `/_api/app/bootstrap`, `/_api/config/update` (type discriminator) |
| `automad_site` | `info` `search` `health` | `/_api/app/bootstrap` (info/health), `/_api/search/search-replace` |
| `automad_docs` | `list` `search` `get` | offline bundled KB (`docs/kb.ts`); no HTTP, works in docs mode |
| `automad_theme` | `list` `install` `activate` `uninstall` `scaffold` `build` `read` `write` `files` `analyze` `validate` `schema` `diff` `generate` | local FS (`AUTOMAD_THEMES_PATH`); `diff` previews a write, `generate` returns snippet/block content, `build` runs composer (if present) + npm |

`automad_theme` is **disabled** (returns `isError code=UNSUPPORTED`) when
`AUTOMAD_THEMES_PATH` is unset. The five live-API tools are disabled in
`AUTOMAD_MODE=docs`. `automad_docs` always works.

### Resources

Four read-only MCP resources (registered in `server.ts`; themes backed by
`resources/themes.ts`, docs served inline from `docs/kb.ts`):

| URI | Contents |
|---|---|
| `automad://themes` | JSON list of discovered themes (slug, name, path, manifest); empty when `AUTOMAD_THEMES_PATH` unset |
| `automad://themes/{slug}/schema` | Normalized theme schema (via `ThemeAnalyzer` → `ThemeSchemaBuilder`) |
| `automad://docs` | JSON index of bundled knowledge-base pages |
| `automad://docs/{slug}` | Markdown body of one knowledge-base page |

### Prompts

Five workflow prompts (`src/prompts.ts`, registered in `server.ts`). Arguments
are strings (MCP prompt contract); each renders one user message steering the
model through real tool actions:

| Prompt | Args | Workflow |
|---|---|---|
| `create_blog_post` | `title`, `parent?`, `summary?` | draft → fill → publish a page |
| `scaffold_theme` | `name`, `author?` | scaffold → generate → diff → write → build → activate |
| `analyze_theme` | `theme` | analyze + validate + schema → prioritized fixes |
| `check_headless_setup` | — | site.health + config + headless docs |
| `find_docs` | `topic` | docs search → get → summarize |

## Live-verified known issues (v2-side, not us)

These are v2 quirks we work around but didn't fix:

- **`/_api/public/pagelist` is currently 500 in `2.0.0-beta.15`** (Automad
  internal bug: `Cannot use object of type Automad\Models\Page as array`,
  `PublicController.php:107`). The MCP surfaces this as `isError code=NETWORK`.
  Pages still work via `/_api/page/data` (post+slug).
- **`/_api/config/update` with unknown `type` → v2 500** (no input validation
  on v2's side). The MCP uses a Zod-enum for `type`, so callers shouldn't
  hit this, but raw HTTP callers might.
- **Parallel `pages.update` with title-rename** races on v2's filesystem:
  if two updates rename the same page simultaneously, one wins, the other
  404s on follow-up `page/publish`. v2 doesn't serialize concurrent updates.
  Callers should not issue overlapping updates to the same page.
- **Very large titles** (e.g. 50KB) — v2 accepts them and creates a directory
  with that name. Not validated by the MCP. The LLM should keep titles sane.
- **`/dashboard/setup` redirect** on first run — the AuthManager follows the
  `Location` header. If your v2 instance has a different first-run URL,
  CSRF scraping may fail.
