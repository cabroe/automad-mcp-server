# HTTP Transport + Bearer-Token Auth

**Date:** 2026-07-26
**Status:** Approved for planning

## Goal

Add an opt-in **Streamable-HTTP transport** guarded by a **static Bearer token** so
the Automad MCP server can serve **multiple local MCP clients** (Claude Desktop,
Cursor, Zed) concurrently over HTTP — without breaking the existing zero-config
stdio path and without adding runtime dependencies.

This closes the biggest gap versus the Statamic/Craft/WordPress MCP servers, which
all offer an HTTP transport. Scope is deliberately limited to transport + a single
shared token (P1). Per-tool scoped permissions and OAuth 2.1 are explicitly **out
of scope** (that is P2/P3).

## Decisions (from brainstorming)

- **Deployment target:** local, multiple clients. A single static Bearer token
  suffices; no OAuth, no dynamic client registration.
- **Transport coexistence:** both, HTTP opt-in. stdio stays the default; HTTP
  starts only when `AUTOMAD_HTTP_PORT` is set. One process runs exactly one mode,
  chosen by env.
- **Token model:** one token from `AUTOMAD_HTTP_TOKEN`; if unset, the server
  generates one at startup and logs it **once**, never again.
- **Session model:** stateful Streamable-HTTP. A fresh `WriteGuard` +
  `McpServer` per session; shared `HttpClient`/`AuthManager`/`Config`. Rationale:
  isolates each client's confirm-token pending-map (a stateless per-request model
  would break the confirm-token replay flow entirely).

## Scope

### In scope
- New transport module `src/http.ts` using `node:http` + the SDK's
  `StreamableHTTPServerTransport`.
- HTTP config parsing in `config.ts` (`AUTOMAD_HTTP_PORT`, `AUTOMAD_HTTP_HOST`,
  `AUTOMAD_HTTP_TOKEN`).
- Bearer-token middleware (constant-time compare).
- Per-session server factory wired in `index.ts`.
- Loopback default bind + DNS-rebinding protection.
- Tests for config parsing and the HTTP transport (incl. confirm-token isolation).
- README/CLAUDE docs update + `docs:sync`.

### Out of scope
- OAuth 2.1 / PKCE / dynamic client registration.
- Per-tool / per-domain scoped permission tokens (P2).
- Multiple tokens / token revocation store.
- Remote/public/multi-tenant hardening beyond loopback + token + DNS-rebinding.
- Simultaneous stdio + HTTP in one process.
- New runtime dependencies (no express).

## Architecture

`index.ts` selects the transport by env: `AUTOMAD_HTTP_PORT` set → HTTP; otherwise
stdio (unchanged default). `HttpClient`, `AuthManager`, and `Config` are built once
in `main`. In HTTP mode, each MCP session gets a fresh `WriteGuard` and a fresh
`McpServer` (via a `makeServer` factory); the live-API client and config are shared.

```
index.ts main
 ├─ AUTOMAD_HTTP_PORT unset → StdioServerTransport → one McpServer   (unchanged)
 └─ AUTOMAD_HTTP_PORT set   → src/http.ts (node:http on 127.0.0.1)
       → Bearer-token middleware
       → session map: sessionId → StreamableHTTPServerTransport
       → makeServer(): new WriteGuard + createAutomadServer per session
       → same domain handlers as stdio
```

## Components

### `config.ts`
- Parse `AUTOMAD_HTTP_PORT` (via existing `parsePositiveInt`; unset ⇒ stdio mode;
  invalid ⇒ fail fast with `VALIDATION`).
- Parse `AUTOMAD_HTTP_HOST` (default `127.0.0.1`).
- Resolve `AUTOMAD_HTTP_TOKEN`; if unset, generate `randomBytes(32).toString('hex')`.
- Extend `Config` with `http?: { port: number; host: string; token: string }`.
  Present only when a port is configured.

### `src/http.ts`
`export async function startHttp(opts: { host: string; port: number; token: string; makeServer: () => McpServer }): Promise<{ close(): Promise<void> }>`
- A `node:http` server exposing one endpoint path (`/mcp`) for `POST`/`GET`/`DELETE`.
- **Token middleware first:** verify `Authorization: Bearer <token>` with
  `crypto.timingSafeEqual`. Missing/wrong ⇒ `401` with a JSON-RPC error body
  `{ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }`.
- **Stateful sessions:**
  - `POST` without `mcp-session-id` carrying an `initialize` request → new
    `StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: true, allowedHosts: [host, 'localhost',
    '127.0.0.1'] })`; `makeServer()`; `server.connect(transport)`; store transport
    in a `Map` on session init; `transport.onclose` removes it and calls
    `server.close()`.
  - Known `mcp-session-id` → reuse the stored transport
    (`transport.handleRequest(req, res, body)`).
  - `GET` (SSE stream) / `DELETE` (teardown) → look up by session id; unknown ⇒
    `400`/`404`.
- JSON body parsing for `POST` before `handleRequest`.
- Returns a `close()` that tears down every session transport + the http server.

### `index.ts`
- Build `AuthManager`/`HttpClient`/`Config` once.
- If `cfg.http` set → `startHttp({ ...cfg.http, makeServer: () =>
  createAutomadServer({ client, guard: new WriteGuard(cfg), config: cfg }) })`.
- Else → existing stdio path, unchanged.
- Shutdown (SIGINT/SIGTERM): in HTTP mode, `await httpHandle.close()` before exit.

### `server.ts`
No signature change. `createAutomadServer` is simply called once per session; its
`validateCapabilityRegistry()` / `validateToolBindings()` calls are idempotent.

## Data flow

Client → `POST /mcp` (+ `Authorization: Bearer`) → token middleware →
session lookup/create → `StreamableHTTPServerTransport.handleRequest` →
`McpServer` → tool dispatch → **identical domain handlers as the stdio path**.
Write-mode, confirm-token, and runtime gates apply unchanged downstream.

## Errors & security

- Default bind `127.0.0.1` (no accidentally public port); override via
  `AUTOMAD_HTTP_HOST`.
- DNS-rebinding protection enabled (`allowedHosts`/`allowedOrigins` = localhost).
- `401` on missing/invalid token (constant-time); `400` on missing/bad session id;
  `405` on wrong method.
- Auto-generated token logged **once** at warn level; never echoed per request;
  never included in error bodies.
- Strictly P1: no per-tool scopes.

## Testing (no new runtime deps)

- **`config.test.ts`**: HTTP env parsing — port set/unset, host default, token
  provided vs auto-generated, invalid port fails fast.
- **`http.test.ts`** (new): real `node:http` listen on `127.0.0.1:0`; client via the
  SDK `StreamableHTTPClientTransport` with an `Authorization` header:
  1. `401` without / with a wrong token.
  2. `initialize` with the token → session id returned; `tools/list` enumerates all
     8 tools.
  3. One tool round-trip over HTTP (e.g. `automad_discover.list`).
  4. **Confirm-token isolation:** session A mints a destructive confirm token;
     session B cannot redeem it.
  5. `DELETE` tears the session down.
- stdio path tests remain unchanged (regression guard).

## Docs

README + CLAUDE env tables and "Editor setup" gain `AUTOMAD_HTTP_PORT` /
`AUTOMAD_HTTP_HOST` / `AUTOMAD_HTTP_TOKEN` with a loopback + token note and one
HTTP client-config example; then run `docs:sync`.

## Acceptance criteria

1. With no `AUTOMAD_HTTP_PORT`, the server behaves exactly as today (stdio, zero
   config).
2. With `AUTOMAD_HTTP_PORT` set, the server listens on `127.0.0.1:<port>` and:
   - rejects requests without a valid Bearer token (`401`);
   - completes the MCP `initialize` handshake and returns a session id;
   - serves all existing tools/resources/prompts identically to stdio;
   - keeps each client's confirm-token pending-map isolated per session.
3. Auto-generated token is printed once at startup when `AUTOMAD_HTTP_TOKEN` is
   unset.
4. `npm run verify` passes (build, lint, tests incl. the new HTTP tests, coverage,
   docs-sync `--check`).
5. No new runtime dependencies added to `package.json`.
