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
npm test                 # vitest run — offline unit suite only (<!-- AUTOGEN:TESTCOUNT -->464 tests, 39 files<!-- /AUTOGEN:TESTCOUNT -->)
npm run test:coverage    # vitest + v8 coverage (gate: 80% stmts / 70% branches)
npm run lint             # eslint src tests
npm run dev              # tsx src/index.ts  (run the server locally)
```

Live E2E against a real Automad v2 container (see [Test environment](#test-environment)):

```bash
npm run e2e              # build + start the container + run the live suite
npm run e2e:up           # start docker-compose.e2e.yml, create the admin, write .env.e2e
npm run e2e:run          # vitest run --config vitest.e2e.config.ts (needs a built dist/)
npm run e2e:status       # container state + HTTP probe + login probe
npm run e2e:logs         # tail the Automad container log
npm run e2e:serve        # run the MCP server (full mode, stdio) against the container
npm run e2e:down         # docker compose down -v + remove .env.e2e
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
  testenv.ts             # local E2E environment: docker compose up/down/status/logs + deterministic admin + .env.e2e
  release.ts             # version-bump + CHANGELOG skeleton + git tag (`--tag` / `--dry-run`); the skeleton is an *empty* section inserted above the newest one — when the changelog already carries a filled `## [Unreleased]`, rename that heading to the new version instead of running the script
tests/unit/              <!-- AUTOGEN:TESTCOUNT -->464 tests, 39 files<!-- /AUTOGEN:TESTCOUNT --> (drift test pins the registry's runtime derivations: Zod action enums, guard sets, bindings, guard behavior; docs-drift test pins CLAUDE.md/README/CHANGELOG against code reality; server test pins mcp.getServerVersion() ↔ package.json)
tests/e2e/               opt-in live E2E vs. a real Automad v2 container (skipped unless AUTOMAD_E2E_* set; `npm run e2e`)
  harness.ts             spawns dist/index.js over stdio per test file; call/callOk helpers, Cleanup, temp themes dir
  env.ts                 vitest setup: loads .env.e2e (real env vars win) so the suite opts itself in
  auth / pages / media / shared-config / theme / write-modes  one file per scenario
  render.e2e.test.ts     the actual job: scaffold a theme → bind a page → assert the *public* HTML renders
docker-compose.e2e.yml   throwaway Automad v2 stack (named volume, curl healthcheck); managed by scripts/testenv.ts
vitest.e2e.config.ts     E2E runner: setup file, no parallelism (v2 races on concurrent writes), long timeouts
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

- **`read-only`** — only non-mutating actions succeed. Read-only set (<!-- AUTOGEN:READCOUNT -->33<!-- /AUTOGEN:READCOUNT -->):
  `docs.list/search/get`, `discover.list/describe`, `pages.list/get`,
  `media.list`, `shared.get`, `config.get`, `site.info/search/health`,
  `theme.list/read/files/analyze/validate/schema/diff/generate`.
- **`confirm-destructive`** *(default)* — ordinary writes run directly
  (`pages.create/update/duplicate/publish/batch_update`, `media.upload/delete`,
  `shared.set`, `config.set`). The <!-- AUTOGEN:DESTRUCTIVECOUNT_WORD -->30<!-- /AUTOGEN:DESTRUCTIVECOUNT_WORD --> destructive actions (`pages.delete`,
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

- **Drafts are readable, just not published** — `page/add` and `page/data`
  (save) produce drafts, and on 2.0.0-beta.51 `page/data` (read) serves them
  fine; what differs is `page/get-publication-state` (`isPublished: false`).
  The MCP auto-publishes after create/update via `page/publish` + polls
  `page/data` (up to 3s) (`publishAndWait`) — **unless `publish:false`**, which
  keeps the page a draft (explicit draft→edit→publish; use `pages.publish`
  later). Pinned by `tests/e2e/pages.e2e.test.ts`.
- **A save without `theme_template` unbinds the page's theme.** `page/data`
  replaces the template selection just like the fields: omit it and v2 falls
  back to the site default *with an empty template name*, after which the
  public URL answers **HTTP 500 "Template missing!"**. Every page an update
  touched would be dead. `updateOnePage` therefore reads the current selection
  and sends it back unless the caller passes `template`. v2 reports the
  template as an absolute path (`/app/packages/mcp/cafe/home.php`) but expects
  the id form (`mcp/cafe/home`) — `templateIdFromPath()` converts, and returns
  undefined for the empty-basename "nothing selected" shape so it is never
  echoed back as a selection. Pinned end-to-end by
  `tests/e2e/render.e2e.test.ts`, which fetches the *public* page.
- **Templates are addressed `<vendor>/<theme>/<template>`**, not
  `<theme>/<template>`: v2 splits at the last slash and resolves against
  `packages/`. A theme in `packages/mcp/cafe/` with `home.php` is
  `mcp/cafe/home`.
- **`page/data` (save) is a full replace and always needs a `title`.** Posting
  a partial `data` map drops every field it omits, and posting one without
  `title` fails outright with `{"error":"Title missing!"}`. `updateOnePage`
  therefore *reads* the page first and merges the caller's changes onto the
  stored record (declared `fields` + the `unused` map v2 keeps for keys the
  active template doesn't declare). `pages.update` costs one extra GET as a
  result — that is the price of not silently deleting content.
- **`/_api/app/bootstrap` is public.** It answers anonymous callers with the
  full payload, `sitename` included, so it cannot prove a session is
  authenticated. `AuthManager.probeAuthenticated` uses the session-protected
  `/_api/shared/data` instead and rejects the `{data: {message: "No session"}}`
  shape v2 returns (HTTP 200, not 401) for anonymous callers. The login
  response body is checked too: a wrong password is `{code: 200, error:
  "Invalid username or password."}`.
- **A save is not a publication, and `page/data` cannot tell you otherwise.**
  `page/data` (read) serves drafts as happily as published pages, so polling it
  after a publish proves nothing. `publishAndWait` confirms via
  `page/get-publication-state` (`isPublished`) instead, returns a
  `PublishOutcome`, and every page write reports `published: boolean` plus
  `warnings[]` when something did not take effect. A failing `page/publish` is
  no longer swallowed — the save stands (`ok: true`) while `published: false`
  and a warning say the page is still a draft.
- **Writes clear the page cache.** Automad serves cached HTML and re-checks for
  changes only every `AM_CACHE_MONITOR_DELAY` seconds (120 by default), so
  without clearing it a visitor keeps seeing the old page for up to two minutes
  after the tool reported success. `create`/`update`/`publish` clear it after a
  confirmed publish, `delete` clears it too. Clearing is best effort: a failure
  becomes a warning, never a failed write. (The E2E instance additionally runs
  with `AM_CACHE_ENABLED=0` so rendered-page assertions are not races.)
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
  Automad backend. Assert `tools/list` enumerates all <!-- AUTOGEN:TOOLCOUNT -->13<!-- /AUTOGEN:TOOLCOUNT --> tools and that every
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
- **Live e2e** (`tests/e2e/**`, own vitest config): `npm run e2e:up` starts
  `docker-compose.e2e.yml`, waits for the instance, creates a deterministic
  admin via `php /app/automad/console user:create`, and writes `.env.e2e`;
  `tests/e2e/env.ts` loads that file so the suite opts itself in. Each file
  spawns the built server (`dist/index.js`) over stdio through the MCP SDK
  client (`harness.ts`) — no mocks anywhere. Fixtures are removed through a
  `Cleanup` registry in `afterAll`, which reports failures without failing the
  run. Files run sequentially in a single fork: v2 races on concurrent writes
  to the same page tree.

| Tool | Actions | Endpoint |
|---|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` `publish` `batch_update` | `/_api/page/*` (create/update auto-publish unless `publish:false`; `batch_update` runs items sequentially) |
| `automad_media` | `list` `upload` `import` `delete` | `/_api/file-collection/list`, `/upload` (single-chunk Dropzone), `/_api/file/import` (server-side fetch by URL), `delete` (destructive) |
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

## Test environment

`docker-compose.e2e.yml` + `scripts/testenv.ts` bring up a disposable Automad
v2 instance so the E2E suite runs against the real backend instead of mocks.
Everything is local: the container binds `127.0.0.1` only, and nothing about it
is meant to survive.

```bash
npm run e2e:up      # compose up -d → wait for /_api/session/validate → ensure admin → write .env.e2e
npm run e2e:run     # the live suite (needs a built dist/)
npm run e2e:down    # compose down -v (volume included) + remove .env.e2e
```

Load-bearing details:

- **Deterministic admin.** The image generates a random user + password on
  first boot and prints them (ANSI-coloured) to its log. `testenv.ts` ignores
  that and runs `php /app/automad/console user:create --username … --password …`
  instead, so credentials are stable across rebuilds. The command is additive
  (v2 has no "user exists" check), so a login probe guards it — that is what
  makes `e2e:up` idempotent.
- **Login probes read the body, not the status.** v2 answers a rejected login
  with HTTP 200 + `{"error": …}`; `canLogIn()` keys off the body.
- **`.env.e2e` is generated and gitignored.** It carries `AUTOMAD_E2E_*` (the
  opt-in switch the suite checks) and the plain `AUTOMAD_*` equivalents, so
  `set -a && source .env.e2e && npm run dev` points a real server at the
  container.
- **Readiness comes from the host.** `up` polls `/_api/session/validate` (200
  even for anonymous callers) rather than trusting the compose healthcheck, so
  the script works the same whether or not compose reports `healthy` yet.
- **The themes directory is mounted into the container.** `automad-themes/`
  (the `AUTOMAD_THEMES_PATH` default) is bind-mounted to `/app/packages/mcp`,
  so a theme scaffolded through `automad_theme` is immediately usable by the
  running site: bind a page to `mcp/<slug>/<template>`. Automad's own
  `packages/automad/*` sits untouched beside it. `testenv.ts` creates the
  directory before compose starts — otherwise Docker creates it root-owned and
  theme writes fail — and `down` deliberately keeps it (it can hold real
  customer work).
- **CI runs the same commands.** `.github/workflows/e2e.yml` calls `e2e:up` /
  `e2e:run` / `e2e:logs` / `e2e:down` — no separate docker invocation to drift.

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
