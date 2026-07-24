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
  server.ts         McpServer + 6 tool registrations (createAutomadServer)
  config.ts         env loader; exports API_BASE = "/_api"
  auth.ts           AuthManager: POST /_api/session/login + cookie jar + CSRF scrape
  client.ts         HttpClient: multipart __csrf__+__json__ POST, envelope unwrap, retry
  errors.ts         AutomadMcpError + errorToJson (codes: AUTH, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, NETWORK, RATE_LIMITED, UNSUPPORTED, UNKNOWN)
  logger.ts         pino logger, credentials redacted
  schemas.ts        Zod input schemas (one per tool)
  write-guard.ts    multi-tier write protection + confirm-token flow
  page-format.ts    legacy — currently unused; consider removing
  domains/
    pages.ts        /_api/page/* and /_api/public/pagelist
    media.ts        /_api/file-collection/list + /upload (single-chunk Dropzone)
    shared.ts       /_api/shared/data (site-wide data; replaces v1 snippets)
    config.ts       /_api/app/bootstrap (get) + /_api/config/update (set)
    site.ts         /_api/app/bootstrap (info) + /_api/search/search-replace
    theme.ts        local-FS theme tooling (delegates to src/theme/*)
  theme/            (theme tool internals — kept separate from domains/)
    fs.ts           ThemeFs interface + LocalThemeFs (swap point for SSH later)
    build.ts        runCommand + npmInstall + npmBuild with timeout
    manager.ts      list / install / activate / uninstall / build
    scaffold.ts     copy starter kit + rewrite theme.json + package.json
    editor.ts       readFile / writeFile / listFiles with path-traversal guard
tests/unit/         112 vitest tests, 18 files
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AUTOMAD_URL` | yes | Base URL of the Automad v2 site, e.g. `https://blog.example.com` |
| `AUTOMAD_USER` | yes | Dashboard username (sent as `name-or-email`) |
| `AUTOMAD_PASS` | yes | Dashboard password (no bearer-token support in v2) |
| `AUTOMAD_THEMES_PATH` | optional | Absolute path to the local themes directory (enables `automad_theme`) |
| `AUTOMAD_STARTER_KIT_PATH` | optional | Starter-kit template path for `theme.scaffold` (defaults to `AUTOMAD_THEMES_PATH`) |
| `AUTOMAD_WRITE_MODE` | no | `read-only` \| `confirm-destructive` (default) \| `unrestricted` |
| `LOG_LEVEL` | no | Pino log level (default `info`) |

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

- **`read-only`** — only non-mutating actions succeed.
- **`confirm-destructive`** *(default)* — non-destructive writes run directly.
  Destructive actions (`pages.delete`, `pages.move`, `theme.install`,
  `theme.activate`, `theme.uninstall`, `theme.scaffold`, `theme.build`,
  `theme.write`) return a `confirmToken` (5-min TTL). The LLM replays the
  same call with `confirm_token` set to execute.
- **`unrestricted`** — everything runs immediately.

A token is bound to its `(action, target)` pair — both are checked on
confirmation. Re-using a token for a different target fails.

The DESTRUCTIVE_ACTIONS whitelist in `write-guard.ts` is the single source of
truth. Adding a new destructive action = adding to both `WriteAction` union
**and** DESTRUCTIVE_ACTIONS set.

## v2 contract notes (live-verified, not reverse-engineered)

The MCP integrates the *real* v2 `/_api` contract. These things bit us during
implementation; treat them as load-bearing constraints:

- **Drafts aren't readable** — `page/add` and `page/data` (save) produce drafts.
  `page/data` (read) only returns published pages. The MCP auto-publishes
  after every create/update via `page/publish` + polls `page/data` (up to
  3s) until the page is queryable (`publishAndWait`).
- **Renames happen during `page/publish`**, not during `page/data` (save).
  The save response carries `slug: "<new>"` — the MCP uses that to compute
  the canonical URL. Publish is sent to `input.url` (where the directory
  currently lives); v2 does the rename, then publish.
- **`page/move` is sibling-reordering, not rename.** Takes a `layout`
  array of sibling URLs. The MCP validates this shape (non-empty array of
  URL strings) and throws `UNSUPPORTED` if absent, `VALIDATION` if malformed.
  No v2 endpoint renames a page.
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
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` | `/_api/public/pagelist`, `/_api/page/*` |
| `automad_media` | `list` `upload` | `/_api/file-collection/list`, `/upload` (single-chunk Dropzone) |
| `automad_shared` | `get` `set` | `/_api/shared/data` |
| `automad_config` | `get` `set` | `/_api/app/bootstrap`, `/_api/config/update` (type discriminator) |
| `automad_site` | `info` `search` | `/_api/app/bootstrap`, `/_api/search/search-replace` |
| `automad_theme` | `list` `install` `activate` `uninstall` `scaffold` `build` `read` `write` `files` | local FS (`AUTOMAD_THEMES_PATH`) |

`automad_theme` is **disabled** (returns `isError code=UNSUPPORTED`) when
`AUTOMAD_THEMES_PATH` is unset. Every other tool works regardless.

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
