# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

`automad-mcp-server` — a Model Context Protocol (MCP) server that lets AI
assistants manage an [Automad v2](https://automad.org/) CMS site
over stdio. Bridges to v2's `/_api/{controller}/{method}` JSON dispatch layer,
authenticated via a PHP session cookie + per-POST CSRF token. The theme tool
also works on the local filesystem (where Automad's theme packages live).

## Commands

```bash
npm run build            # tsc → dist/  (ESM, strict; reads package.json#version at compile time)
npm test                 # vitest run (<!-- AUTOGEN:TESTCOUNT -->410 tests, 35 files<!-- /AUTOGEN:TESTCOUNT -->; live E2E auto-skips)
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
  server.ts         McpServer: registry-driven tool loop + 4 resource + 5 prompt registrations (createAutomadServer)
  config.ts         env loader; exports API_BASE = "/_api"
  auth.ts           AuthManager: POST /_api/session/login + cookie jar + CSRF scrape
  client.ts         HttpClient: multipart __csrf__+__json__ POST, envelope unwrap, retry
  errors.ts         AutomadMcpError + errorToJson (codes: AUTH, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, NETWORK, RATE_LIMITED, UNSUPPORTED, UNKNOWN)
  logger.ts         pino logger, credentials redacted
  schemas.ts        Zod input schemas (one per tool); `action` enums built from the registry + TOOL_INPUT_SCHEMAS
  write-guard.ts    multi-tier write protection + confirm-token flow (READ/DESTRUCTIVE sets derived from the registry)
  prompts.ts        MCP workflow prompts (create_blog_post, scaffold_theme, analyze_theme, check_headless_setup, find_docs)
  page-format.ts    parsePage / serializePage (used by tests/unit/page-format.test.ts; not wired into the live HTTP path)
  docs/
    kb.ts           bundled offline Automad knowledge base (automad_docs source)
  capabilities/
    registry.ts     single source of truth: tool+action metadata (title/summary/description, requires, readOnly/destructive/internal); derives ToolName, WriteAction, the guard sets, the Zod action enums and the docs table; validated at boot via validateCapabilityRegistry()
    tools.ts        wiring layer: one binding per tool (schema + gate + domain dispatch); server.ts loops over TOOL_BINDINGS
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
    discover.ts     discovery facade over capabilities/registry.ts (list/describe; no HTTP, works in docs mode)
  theme/            (theme tool internals — kept separate from domains/)
    fs.ts           ThemeFs interface + LocalThemeFs (swap point for SSH later)
    build.ts        runCommand + npmInstall + npmBuild with timeout
    manager.ts      list / install / activate / uninstall / build
    analyzer.ts     ThemeAnalyzer: theme.json + template scan → structured analysis
    schema.ts       ThemeSchemaBuilder: analysis → normalized theme schema
    diff.ts         unifiedDiff: LCS line diff for theme.diff preview
    generate.ts     snippet/block/component generator (theme.generate)
scripts/                 # build-time helpers, run via `npm run <name>`
  sync.ts                # regenerates the AUTOGEN tool tables + fenced number markers in README/CLAUDE.md/docs/index.html (--tests refreshes TESTCOUNT via a live vitest run)
  release.ts             # version-bump + CHANGELOG skeleton + git tag (`--tag` / `--dry-run`); the skeleton is an *empty* section inserted above the newest one — when the changelog already carries a filled `## [Unreleased]`, rename that heading to the new version instead of running the script
tests/unit/              <!-- AUTOGEN:TESTCOUNT -->410 tests, 35 files<!-- /AUTOGEN:TESTCOUNT --> (drift test pins the registry's runtime derivations: Zod action enums, guard sets, bindings, guard behavior; docs-drift test pins CLAUDE.md/README/CHANGELOG against code reality; server test pins mcp.getServerVersion() ↔ package.json)
tests/e2e/               opt-in live E2E vs. real Automad (skipped unless AUTOMAD_E2E_* set; `npm run test:e2e`)
docs/index.html          GitHub Pages landing page (https://cabroe.github.io/automad-mcp-server/), served from /docs on main.
                         Self-contained by contract — no <script>, no external stylesheet, no remote images (pinned in docs-drift.test.ts).
                         The tool table (`AUTOGEN:TOOLS_HTML`) and the count markers are generated by `npm run docs:sync`; don't hand-edit them.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AUTOMAD_MODE` | no | `full` (default; live instance) or `docs` (standalone docs + theme tooling, no instance/credentials) |
| `AUTOMAD_URL` | full mode | Base URL of the Automad v2 site; validated as http(s), trailing slash stripped |
| `AUTOMAD_USER` | full mode | Dashboard username (sent as `name-or-email`) |
| `AUTOMAD_PASS` | full mode | Dashboard password (no bearer-token support in v2) |
| `AUTOMAD_THEMES_PATH` | no | Absolute path to the local themes directory; defaults to `<cwd>/automad-themes` so `automad_theme` always works |
| `AUTOMAD_STARTER_KIT_PATH` | no | Starter-kit template path for `theme.scaffold`; defaults to the starter kit bundled in `templates/starter-kit` |
| `AUTOMAD_HTTP_PORT` | no | Serve Streamable-HTTP on this port (`src/http.ts`) instead of stdio; unset = stdio default |
| `AUTOMAD_HTTP_HOST` | no | HTTP bind host, default `127.0.0.1` |
| `AUTOMAD_HTTP_TOKEN` | no | Bearer token for the HTTP transport; auto-generated + logged once if unset |
| `AUTOMAD_WRITE_MODE` | no | `read-only` \| `confirm-destructive` (default) \| `unrestricted` |
| `LOG_LEVEL` | no | Pino log level (default `info`); validated in `config.ts` against the static `VALID_LOG_LEVELS` set (`trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent`) |

`config.ts` sets `liveEnabled = (mode === "full")`. In `docs` mode the live-API
tools throw `UNSUPPORTED` (gated in `server.ts` via `liveGate()`); `automad_docs`
and `automad_theme` always work. `AUTOMAD_THEMES_PATH` defaults to
`<cwd>/automad-themes` (resolved in `config.ts`), so `themeDeps` is always wired
and `theme.scaffold` needs no configuration — it copies the bundled starter kit
(`templates/starter-kit`, via `BUNDLED_STARTER_KIT_PATH`).

`index.ts` picks the transport: `AUTOMAD_HTTP_PORT` set → Streamable-HTTP via
`src/http.ts` (stateful, one `WriteGuard` + `McpServer` per session, shared
`HttpClient`); unset → stdio. A constant-time Bearer-token check gates every HTTP
request; bind is loopback with DNS-rebinding protection.

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
- **Auto-generated docs are fenced, not free-form.** The README tool table
 sits between `<!-- AUTOGEN:TOOLS:START/END -->` markers; individual numbers
 that drift with the code (tool count, read/destructive-action counts, test
 count) are each wrapped inline in their own `<!-- AUTOGEN:NAME -->...<!--
 /AUTOGEN:NAME -->` pair in README.md and/or CLAUDE.md. Both are regenerated
 by `npm run docs:sync` (see `scripts/sync.ts`); the TESTCOUNT marker also
 needs `npm run docs:sync:tests` (spawns a full `vitest run`) after the test
 suite changes. Do not edit fenced content by hand — re-running the script
 clobbers it. The drift test (`tests/unit/docs-drift.test.ts`) additionally
 pins the destructive-action count and the beta version by regex, as a
 second, independent check on top of the fenced markers.

## Safety model (write-guard)

Three modes via `AUTOMAD_WRITE_MODE`:

- **`read-only`** — only non-mutating actions succeed. Read-only set (<!-- AUTOGEN:READCOUNT -->24<!-- /AUTOGEN:READCOUNT -->):
  `docs.list/search/get`, `discover.list/describe`, `pages.list/get`,
  `media.list`, `shared.get`, `config.get`, `site.info/search/health`,
  `theme.list/read/files/analyze/validate/schema/diff/generate`.
- **`confirm-destructive`** *(default)* — ordinary writes run directly
  (`pages.create/update/duplicate/publish/batch_update`, `media.upload/delete`,
  `shared.set`, `config.set`). The <!-- AUTOGEN:DESTRUCTIVECOUNT_WORD -->19<!-- /AUTOGEN:DESTRUCTIVECOUNT_WORD --> destructive actions (`pages.delete`,
  `pages.move`, `pages.update_rename` *(internal: title change inside
  `pages.update` / `pages.batch_update`)*, `media.delete`, `site.search_replace`
  *(internal: `site.search` with a `replace` value)*, `theme.install`,
  `theme.activate`, `theme.uninstall`, `theme.scaffold`, `theme.build`,
  `theme.write`) return a `confirmToken` (5-min TTL). The LLM replays the
  same call with `confirm_token` set to execute.
- **`unrestricted`** — everything runs immediately.

A token is bound to its `(action, target)` pair — both are checked on
confirmation. Re-using a token for a different target fails.

`capabilities/registry.ts` is the single source of truth for confirmation:
`READ_ACTIONS` and `DESTRUCTIVE_ACTIONS` in `write-guard.ts` are *derived* from
it (`actionsWhere(...)`), and so is the `WriteAction` union. Marking an action
`destructive(...)` in the registry is the whole change — there is no second list
to update. Internal-only actions that exist for fine-grained confirmation
(`pages.update_rename`, `site.search_replace`) are declared in the registry via
`internal(...)`: they join the guard sets and the `WriteAction` union but stay
out of every advertised surface (Zod `action` enums, `automad_discover`, the
generated docs table).

## Scaling pattern — adding a tool or an action

The registry is the only place a capability is *declared*; everything else is
derived from it, so the compiler drives the rest of the change.

**New action** on an existing tool:
1. Add one line to that tool's `actions` in `capabilities/registry.ts`
   (`read` / `write` / `destructive` / `internal`).
2. `npx tsc --noEmit` — the domain router's `Record<Action, WriteAction>` map
   now fails to compile, and so does its non-exhaustive `switch`. Implement
   both. The Zod enum, the guard classification, `automad_discover` and the
   README table need no edits.
3. `npm run docs:sync` for the count markers.

**New tool**:
1. Registry entry (title, summary, description, `requires`, actions).
2. Zod schema in `schemas.ts` using `actionEnum("automad_<name>")`, added to
   `TOOL_INPUT_SCHEMAS` (the record is total over `ToolName` — a missing entry
   is a compile error).
3. Domain router in `domains/`.
4. One `bind(...)` entry in `capabilities/tools.ts` (also total over
   `ToolName`). `server.ts` picks it up automatically — no edit there.

`validateCapabilityRegistry()` + `validateToolBindings()` run at boot and in
`tests/unit/drift.test.ts`, which pins the runtime derivations TypeScript can't
see (actual Zod enum values, actual guard sets, actual guard behavior per mode).

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
  Automad backend. Assert `tools/list` enumerates all <!-- AUTOGEN:TOOLCOUNT -->8<!-- /AUTOGEN:TOOLCOUNT --> tools and that every
  tool's `inputSchema` exposes an `action.enum`. A separate assertion pins
  `mcp.getServerVersion()` to `package.json#version` to catch version drift.
- **`client.ts`**: `vi.stubGlobal("fetch", ...)`; assert status→error-code
  mapping (including the `looksLikeServerValidation` heuristic for v2's
  200+error envelope).
- **`auth.ts`**: stub `fetch` to return a Set-Cookie + a dashboard HTML with
  the `<meta name="csrf">` tag; assert cookie/CSRF handling. `collectCookie`
  must tolerate Headers objects without `getSetCookie()`.
- **`theme/*`**: use `node:fs.mkdtemp(os.tmpdir(), "mcp-")` for an isolated
  theme sandbox; copy the real starter kit from `/tmp/sk-analysis/...` for
  end-to-end coverage.
- **Drift tests** (`tests/unit/drift.test.ts`): pin the registry's *runtime*
  derivations — each tool's Zod `action` enum equals its advertised registry
  actions, `READ_ACTIONS`/`DESTRUCTIVE_ACTIONS` equal the registry's flagged
  actions exactly, every tool has a binding using its registered schema,
  internal actions stay out of every advertised surface, and a `WriteGuard` in
  each mode really permits/pends what the flags claim.
  `tests/unit/capabilities-tools.test.ts` covers the binding layer's gates
  (`requires: live` in docs mode, `requires: themes` without a themes path).
- **Live e2e**: spawn the built server with `dist/index.js`; pipe
  `initialize` → JSON-RPC calls; assert results. See `/tmp/mcp-live-themes/`
  setup in git history for the full sandbox layout.

| Tool | Actions | Endpoint |
|---|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` `publish` `batch_update` | `/_api/page/*` (create/update auto-publish unless `publish:false`; `batch_update` runs items sequentially) |
| `automad_media` | `list` `upload` `delete` | `/_api/file-collection/list`, `/upload` (single-chunk Dropzone), `delete` (destructive) |
| `automad_shared` | `get` `set` | `/_api/shared/data` |
| `automad_config` | `get` `set` | `/_api/app/bootstrap`, `/_api/config/update` (type discriminator) |
| `automad_site` | `info` `search` `health` | `/_api/app/bootstrap` (info/health), `/_api/search/search-replace` (`search` becomes `site.search_replace` and requires a confirm token when `replace` is set) |
| `automad_docs` | `list` `search` `get` | offline bundled KB (`docs/kb.ts`); no HTTP, works in docs mode |
| `automad_theme` | `list` `install` `activate` `uninstall` `scaffold` `build` `read` `write` `files` `analyze` `validate` `schema` `diff` `generate` | local FS (themes dir, default `<cwd>/automad-themes`); `diff` previews a write, `generate` returns snippet/block content, `build` runs composer (if present) + npm |
| `automad_discover` | `list` `describe` | reads `capabilities/registry.ts` + `TOOL_INPUT_SCHEMAS` in-process (same source the server registers from); no HTTP, works in docs mode |

`automad_theme` always works (themes dir defaults to `<cwd>/automad-themes`).
The five live-API tools are disabled in `AUTOMAD_MODE=docs`. `automad_docs` and
`automad_discover` always work.

### Resources

Four read-only MCP resources (registered in `server.ts`; themes backed by
`resources/themes.ts`, docs served inline from `docs/kb.ts`):

| URI | Contents |
|---|---|
| `automad://themes` | JSON list of discovered themes (slug, name, path, manifest); empty until a theme exists in the themes dir |
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

- **`/_api/public/pagelist` currently 500s on `2.0.0-beta.51`** (Automad
 internal bug: `Cannot use object of type Automad\Models\Page as array`,
 `PublicController.php:107`). The MCP surfaces this as `isError code=NETWORK`.
 `pages.list` works around it by using `/_api/page-collection/get-recently-edited`
 (the same endpoint the dashboard's "Recently edited" list uses) instead.
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
- **`pages.list` endpoint limitation** — Automad v2 currently lacks a native
  `/_api/page-collection/all` endpoint. `pages.list` uses `/_api/page-collection/get-recently-edited`
  as a workaround, which returns recently modified pages.
- **Package manager configurability** — Theme build and dev commands use `npm`
  by default but support `AUTOMAD_PACKAGE_MANAGER=bun|pnpm|npm`. If the binary
  is missing from `PATH`, the MCP surfaces a clear `VALIDATION` error instead
  of crashing with `ENOENT`.

## Out of scope

These are *known* boundaries. Don't try to "fix" them in this repo.

- **HTTP transport.** This server is stdio-only. Per MCP convention, local
  tool servers expose stdio; an HTTP/SSE transport is the responsibility of
  the orchestrator that wraps the stdio server (e.g. an MCP gateway), not
  of this server itself. If you need HTTP, run this server as a subprocess
  of an MCP-aware proxy.
- **API-token auth.** v2 has no Bearer-token / Personal-Access-Token model
  (researched 2026-07-25 against `automad/automad:v2` beta.51 source:
  `src/server/Routes.php` + `src/server/API/RequestHandler.php` only wire
  session-cookie + TOTP, no `Authorization` header listener). The session
  scraping the MCP does is the only option. Upstream feature request would
  be the right path.
- **In-place media rename.** v2's `/_api/file-collection/list` supports
  `action: "move"` (file → different directory) but no in-place rename.
  All three boundaries are also listed in CHANGELOG.md's trailing
  "Known limitations / future work" section (not tied to a release).
