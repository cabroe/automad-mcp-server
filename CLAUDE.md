# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

`@automadcms/mcp-server` — a Model Context Protocol (MCP) server that lets AI
assistants manage an [Automad CMS](https://automad.org) site over stdio.
Automad has no official REST API, so this server is an **HTTP bridge** to the
dashboard's AJAX endpoints, authenticated via a session cookie (or a token).

## Commands

```bash
npm run build            # tsc → dist/  (ESM, strict)
npm test                 # vitest run
npm run test:coverage    # vitest + v8 coverage (gate: 80% stmts / 70% branches)
npm run lint             # eslint src tests
npm run dev              # tsx src/index.ts  (run the server locally)
```

The server reads env vars at startup (`AUTOMAD_URL`, `AUTOMAD_USER`,
`AUTOMAD_PASS` *or* `AUTOMAD_TOKEN`, `AUTOMAD_WRITE_MODE`, `LOG_LEVEL`).

## Architecture — Domain-Router pattern

Each MCP tool takes an `action` enum and dispatches internally. One router per
domain; all routers share the same shape: validate → `guard.check()` → switch on
action → call `HttpClient`.

```
src/
  index.ts          entry: config + stdio transport + graceful shutdown
  server.ts         McpServer + 7 tool registrations (createAutomadServer)
  client.ts         HttpClient: retry, auth, status→AutomadMcpError; safeJson
  auth.ts           AuthManager: dashboard login + session cookie
  config.ts         env loader + write-mode validation
  errors.ts         AutomadMcpError + errorToJson
  logger.ts         pino logger, credentials redacted
  write-guard.ts    multi-tier write protection + confirm-token flow
  schemas.ts        Zod input schemas (one per tool)
  page-format.ts    parse/serialize Automad page format (vars + Editor.js blocks)
  domains/          pages, media, snippets, templates, config, theme, site
```

## Conventions

- **TypeScript strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitReturns`). No `any`.
- **ESM** — imports use explicit `.js` extensions (NodeNext resolution).
- **Conventional Commits**, scoped (`feat(domains/pages): ...`, `fix(client): ...`).
- **Errors carry context** — throw `AutomadMcpError(code, message, details?)`,
  never swallow. The server wraps tool results; `errorToJson` serializes failures.
- **Dependency injection** — handlers take `(input, client, guard)`; the HTTP
  client and auth are injectable so tests mock them.

## Safety model (write-guard)

Three modes via `AUTOMAD_WRITE_MODE`: `read-only`, `confirm-destructive`
(default), `unrestricted`. Destructive actions (delete, move, restore,
uninstall, `config.set`) return a `confirmToken` (5-min TTL); the LLM replays
the call with `confirm_token` to execute. **A token is bound to its
`(action, target)` pair** — both are checked on confirmation.

## Testing patterns

- Domain routers: construct a mock `HttpClient` (`{ get, post, put, delete,
  uploadMultipart }` as `vi.fn`) + a real `WriteGuard` with an unrestricted
  config; assert the handler calls the right endpoint and serializes correctly.
- `server.ts`: use `InMemoryTransport.createLinkedPair()` + the MCP `Client` to
  exercise the full registerTool → handler → result path without a real backend.
- `client.ts`: `vi.stubGlobal("fetch", ...)`; assert status→error-code mapping.
- Global fetch is stubbed per-test in `beforeEach`; do not rely on real HTTP.

## Known limitations (V1)

- The Automad dashboard endpoints are reverse-engineered, not an official API.
  Confirm endpoint shapes against a live Automad instance before relying on them.
- `pages.get` returns the raw API response and does **not** run `parsePage`
  (asymmetric with create/update, which serialize). Tracked as a follow-up.
- Token auth (`AUTOMAD_TOKEN`) is sent in the `Cookie` header; the correct
  header format for Automad is not yet verified.
