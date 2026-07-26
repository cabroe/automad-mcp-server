# HTTP Transport + Bearer-Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Streamable-HTTP transport guarded by a static Bearer token so the Automad MCP server can serve multiple local MCP clients concurrently, without changing the default stdio behavior.

**Architecture:** `index.ts` selects the transport by env — `AUTOMAD_HTTP_PORT` set → HTTP (`src/http.ts`), else stdio (unchanged). Shared `HttpClient`/`AuthManager`/`Config` built once; each HTTP session gets a fresh `WriteGuard` + `McpServer` via a `makeServer` factory, isolating confirm-token state per client. The HTTP layer uses `node:http` + the SDK's `StreamableHTTPServerTransport` in stateful mode.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), `@modelcontextprotocol/sdk` 1.29 (`server/streamableHttp.js`, `client/streamableHttp.js`), `node:http`, `node:crypto`, vitest.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. No `any` (use `unknown` + narrowing). No non-null `!` assertions — narrow explicitly.
- ESM: all local imports use explicit `.js` extensions (NodeNext).
- Static imports only; no `await import()`.
- **No new runtime dependencies** in `package.json`.
- Node `>=20`.
- Default bind host `127.0.0.1`; endpoint path `/mcp`.
- Auto-generated token: `randomBytes(32).toString('hex')` (64 hex chars); logged once at startup only when `AUTOMAD_HTTP_TOKEN` is unset; never echoed per request or in error bodies.
- JSON-RPC error body for HTTP-level failures: `{ jsonrpc: '2.0', error: { code: -32001, message }, id: null }`.
- Commit after each task. Do NOT run project-wide `npm run verify`/lint until the final task; run only the specific test file per task.

---

### Task 1: HTTP config parsing

**Files:**
- Modify: `src/config.ts` (add import, `HttpConfig` interface, `Config.http` field, parsing block in `loadConfig`)
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `export interface HttpConfig { port: number; host: string; token: string }` and `Config.http?: HttpConfig | undefined`. `loadConfig()` returns `http` populated only when `AUTOMAD_HTTP_PORT` is a valid port (1–65535); otherwise `undefined`.

- [ ] **Step 1: Extend the config-test env cleanup and write failing tests**

In `tests/unit/config.test.ts`, add the three new keys to the `beforeEach` cleanup array (after `'AUTOMAD_MODE'`):

```ts
      'AUTOMAD_MODE',
      'AUTOMAD_HTTP_PORT',
      'AUTOMAD_HTTP_HOST',
      'AUTOMAD_HTTP_TOKEN',
```

Then add this block inside the top-level `describe('loadConfig', ...)`:

```ts
  describe('http transport config', () => {
    beforeEach(() => {
      process.env['AUTOMAD_URL'] = 'https://x';
      process.env['AUTOMAD_USER'] = 'u';
      process.env['AUTOMAD_PASS'] = 'p';
    });

    it('leaves http undefined when AUTOMAD_HTTP_PORT is unset', () => {
      expect(loadConfig().http).toBeUndefined();
    });

    it('parses a provided port, host, and token', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '7823';
      process.env['AUTOMAD_HTTP_HOST'] = '0.0.0.0';
      process.env['AUTOMAD_HTTP_TOKEN'] = 'secret-token';
      expect(loadConfig().http).toEqual({ port: 7823, host: '0.0.0.0', token: 'secret-token' });
    });

    it('defaults host to 127.0.0.1 and auto-generates a 64-hex-char token', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '7823';
      const http = loadConfig().http;
      expect(http?.host).toBe('127.0.0.1');
      expect(http?.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an invalid AUTOMAD_HTTP_PORT', () => {
      process.env['AUTOMAD_HTTP_PORT'] = 'notaport';
      expect(() => loadConfig()).toThrow(/AUTOMAD_HTTP_PORT/);
    });

    it('rejects an out-of-range AUTOMAD_HTTP_PORT', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '70000';
      expect(() => loadConfig()).toThrow(/AUTOMAD_HTTP_PORT/);
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/config.test.ts -t "http transport config"`
Expected: FAIL (`http` is `undefined`/property missing; no port validation yet).

- [ ] **Step 3: Implement the config parsing**

In `src/config.ts`, add the crypto import at the top (below the existing imports):

```ts
import { randomBytes } from 'node:crypto';
```

Add the interface just above `export interface Config {`:

```ts
export interface HttpConfig {
  /** TCP port for the Streamable-HTTP endpoint. */
  port: number;
  /** Bind host; defaults to loopback. */
  host: string;
  /** Static Bearer token required on every HTTP request. */
  token: string;
}
```

Add the field inside `Config` (after `starterKitPath`, before `requestTimeoutMs`):

```ts
  /**
   * Streamable-HTTP transport settings. Present only when `AUTOMAD_HTTP_PORT`
   * is set; otherwise the server runs on stdio (the zero-config default).
   */
  http?: HttpConfig | undefined;
```

In `loadConfig()`, add this block just before the `return {` statement:

```ts
  const httpPortRaw = process.env['AUTOMAD_HTTP_PORT'];
  let http: HttpConfig | undefined;
  if (httpPortRaw !== undefined && httpPortRaw.trim() !== '') {
    const port = Number.parseInt(httpPortRaw, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new AutomadMcpError(
        'VALIDATION',
        `AUTOMAD_HTTP_PORT must be a TCP port 1-65535: ${httpPortRaw}`,
      );
    }
    const hostRaw = process.env['AUTOMAD_HTTP_HOST']?.trim();
    const host = hostRaw && hostRaw.length > 0 ? hostRaw : '127.0.0.1';
    const tokenRaw = process.env['AUTOMAD_HTTP_TOKEN']?.trim();
    const token = tokenRaw && tokenRaw.length > 0 ? tokenRaw : randomBytes(32).toString('hex');
    http = { port, host, token };
  }
```

Add `http,` to the returned object literal (after `starterKitPath,`):

```ts
    starterKitPath,
    http,
    requestTimeoutMs: parsePositiveInt(process.env['AUTOMAD_REQUEST_TIMEOUT_MS'], 30_000),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS (all existing config tests + the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): parse AUTOMAD_HTTP_PORT/HOST/TOKEN into Config.http"
```

---

### Task 2: Streamable-HTTP transport module

**Files:**
- Create: `src/http.ts`
- Test: `tests/unit/http.test.ts`

**Interfaces:**
- Consumes: `Config.http` fields (`host`, `port`, `token`) from Task 1; `createAutomadServer`, `WriteGuard`, `Config` for building the per-session factory in tests.
- Produces:
  - `export interface HttpTransportOptions { host: string; port: number; token: string; makeServer: () => McpServer }`
  - `export interface HttpHandle { close(): Promise<void> }`
  - `export async function startHttp(opts: HttpTransportOptions): Promise<HttpHandle>` — listens on `host:port`, serves `POST/GET/DELETE /mcp`, rejects requests without a valid Bearer token, and creates one stateful session (fresh `makeServer()`) per `initialize`.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/http.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp, type HttpHandle } from '../../src/http.js';
import { createAutomadServer } from '../../src/server.js';
import { WriteGuard } from '../../src/write-guard.js';
import type { HttpClient } from '../../src/client.js';
import type { Config } from '../../src/config.js';

const TOKEN = 'test-token-abc';

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(writeMode: Config['writeMode'] = 'unrestricted'): Config {
  return {
    mode: 'full',
    url: 'https://x',
    username: 'u',
    password: 'p',
    writeMode,
    logLevel: 'error',
    liveEnabled: true,
    themesPath: '/tmp/themes-x',
    starterKitPath: '/tmp/starter-x',
  };
}

let handle: HttpHandle | undefined;

async function serve(writeMode: Config['writeMode'] = 'unrestricted'): Promise<number> {
  handle = await startHttp({
    host: '127.0.0.1',
    port: 0, // ephemeral; see note in implementation
    token: TOKEN,
    makeServer: () =>
      createAutomadServer({ client: mockClient(), guard: new WriteGuard(cfg(writeMode)), config: cfg(writeMode) }),
  });
  return (handle as HttpHandle & { port: number }).port;
}

async function connect(port: number, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('startHttp (Streamable-HTTP + Bearer auth)', () => {
  it('rejects a connection with a missing or wrong token', async () => {
    const port = await serve();
    await expect(connect(port, 'wrong-token')).rejects.toThrow();
  });

  it('completes initialize with a valid token and lists all eight tools', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [
        'automad_config',
        'automad_discover',
        'automad_docs',
        'automad_media',
        'automad_pages',
        'automad_shared',
        'automad_site',
        'automad_theme',
      ].sort(),
    );
    await client.close();
  });

  it('round-trips a tool call over HTTP', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    const res = (await client.callTool({ name: 'automad_discover', arguments: { action: 'list' } })) as {
      content: { type: string; text: string }[];
    };
    expect(res.content[0]?.text).toContain('automad_theme');
    await client.close();
  });

  it('isolates confirm tokens per session', async () => {
    const port = await serve('confirm-destructive');
    const a = await connect(port, TOKEN);
    const b = await connect(port, TOKEN);

    const resA = (await a.callTool({
      name: 'automad_pages',
      arguments: { action: 'delete', url: '/foo' },
    })) as { content: { text: string }[] };
    const permitA = JSON.parse(resA.content[0]!.text) as { allowed: string; confirmToken?: string };
    expect(permitA.allowed).toBe('pending');
    expect(permitA.confirmToken).toBeTruthy();

    // Replaying A's token in session B must NOT execute — B's guard never minted it.
    const resB = (await b.callTool({
      name: 'automad_pages',
      arguments: { action: 'delete', url: '/foo', confirm_token: permitA.confirmToken },
    })) as { content: { text: string }[] };
    const permitB = JSON.parse(resB.content[0]!.text) as { allowed: string; confirmToken?: string };
    expect(permitB.allowed).toBe('pending');
    expect(permitB.confirmToken).not.toBe(permitA.confirmToken);

    await a.close();
    await b.close();
  });

  it('tears a session down on client close / DELETE', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    await expect(client.close()).resolves.toBeUndefined();
    // Server still accepts a fresh session afterwards.
    const client2 = await connect(port, TOKEN);
    const list = await client2.listTools();
    expect(list.tools.length).toBe(8);
    await client2.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: FAIL with "Cannot find module '../../src/http.js'".

- [ ] **Step 3: Implement `src/http.ts`**

Create `src/http.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from './logger.js';

const MCP_PATH = '/mcp';

export interface HttpTransportOptions {
  host: string;
  port: number;
  token: string;
  /** Build a fresh server (with its own WriteGuard) for each new session. */
  makeServer: () => McpServer;
}

export interface HttpHandle {
  /** Actual bound port (useful when the caller passed 0 for an ephemeral port). */
  readonly port: number;
  close(): Promise<void>;
}

/** Constant-time `Authorization: Bearer <token>` check. */
function tokenMatches(expected: string, header: string | undefined): boolean {
  if (header === undefined) return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw === '' ? undefined : JSON.parse(raw);
}

export async function startHttp(opts: HttpTransportOptions): Promise<HttpHandle> {
  const { host, port, token, makeServer } = opts;
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const allowedHosts = [
    host,
    'localhost',
    '127.0.0.1',
    `${host}:${port}`,
    `localhost:${port}`,
    `127.0.0.1:${port}`,
  ];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== MCP_PATH) {
      sendError(res, 404, 'Not found');
      return;
    }
    const authHeader = req.headers['authorization'];
    if (!tokenMatches(token, Array.isArray(authHeader) ? authHeader[0] : authHeader)) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    const raw = req.headers['mcp-session-id'];
    const sid = Array.isArray(raw) ? raw[0] : raw;

    const existing = sid !== undefined ? transports.get(sid) : undefined;
    if (existing !== undefined) {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      await existing.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'POST' && sid === undefined) {
      const body = await readJsonBody(req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts,
        onsessioninitialized: (newId) => {
          transports.set(newId, transport);
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id !== undefined) transports.delete(id);
      };
      const server = makeServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendError(res, 400, 'Missing or invalid session');
  }

  const httpServer = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'http request failed',
      );
      if (!res.headersSent) sendError(res, 500, 'Internal error');
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  logger.info({ host, port: boundPort, path: MCP_PATH }, 'Automad MCP server listening on http');

  return {
    port: boundPort,
    async close() {
      for (const transport of [...transports.values()]) await transport.close();
      transports.clear();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
```

Note on the test's `port: 0`: `startHttp` binds an ephemeral port and returns the real one on `HttpHandle.port`; the test casts the handle to read `.port`. This keeps tests parallel-safe (no fixed port).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: PASS (all six cases). If the DNS-rebinding check rejects the client, confirm `allowedHosts` includes the `127.0.0.1:<port>` form (it does).

- [ ] **Step 5: Commit**

```bash
git add src/http.ts tests/unit/http.test.ts
git commit -m "feat(http): stateful Streamable-HTTP transport with Bearer-token auth"
```

---

### Task 3: Wire transport selection into the entrypoint

**Files:**
- Modify: `src/index.ts` (whole `main()` body)

**Interfaces:**
- Consumes: `startHttp` / `HttpHandle` (Task 2); `Config.http` (Task 1).
- Produces: a `main()` that runs HTTP when `cfg.http` is set (fresh guard+server per session via `makeServer`) and stdio otherwise; both paths shut down cleanly on SIGINT/SIGTERM.

- [ ] **Step 1: Rewrite `src/index.ts`**

Replace the file contents with:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AuthManager } from './auth.js';
import { HttpClient } from './client.js';
import { WriteGuard } from './write-guard.js';
import { logger } from './logger.js';
import { createAutomadServer } from './server.js';
import { startHttp } from './http.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  const auth = new AuthManager(cfg);
  const client = new HttpClient({ baseUrl: cfg.url, timeoutMs: cfg.requestTimeoutMs }, auth, {
    maxRetries: 2,
    retryDelayMs: 250,
  });

  const makeServer = () =>
    createAutomadServer({ client, guard: new WriteGuard(cfg), config: cfg });

  let close: () => Promise<void>;

  if (cfg.http) {
    if (!process.env['AUTOMAD_HTTP_TOKEN']?.trim()) {
      logger.warn(
        { token: cfg.http.token },
        'AUTOMAD_HTTP_TOKEN not set — generated a token for this run; pass it as "Authorization: Bearer <token>"',
      );
    }
    const handle = await startHttp({ ...cfg.http, makeServer });
    logger.info({ mode: cfg.writeMode, host: cfg.http.host, port: handle.port }, 'Automad MCP server ready (http)');
    close = () => handle.close();
  } else {
    const server = makeServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info({ mode: cfg.writeMode }, 'Automad MCP server listening on stdio');
    close = () => server.close();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'fatal startup error');
  process.exit(1);
});
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Smoke-test the HTTP path end-to-end**

Run:

```bash
node -e '
const { spawn } = require("node:child_process");
const p = spawn("node", ["dist/index.js"], { env: { ...process.env, AUTOMAD_MODE: "docs", AUTOMAD_HTTP_PORT: "8791", AUTOMAD_HTTP_TOKEN: "smoke" }, stdio: ["ignore","pipe","pipe"] });
setTimeout(async () => {
  const bad = await fetch("http://127.0.0.1:8791/mcp", { method: "POST", headers: { "content-type":"application/json" }, body: "{}" });
  console.log("no-token status:", bad.status);            // expect 401
  const init = await fetch("http://127.0.0.1:8791/mcp", {
    method: "POST",
    headers: { "content-type":"application/json", "accept":"application/json, text/event-stream", "authorization":"Bearer smoke" },
    body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2025-06-18", capabilities:{}, clientInfo:{ name:"smoke", version:"0" } } }),
  });
  console.log("init status:", init.status, "session:", init.headers.get("mcp-session-id") ? "yes" : "no"); // expect 200 + session
  p.kill("SIGTERM");
}, 800);
p.on("exit", (c) => console.log("server exited", c));
'
```
Expected: `no-token status: 401`, `init status: 200 session: yes`, `server exited 0`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(http): select HTTP vs stdio transport by AUTOMAD_HTTP_PORT"
```

---

### Task 4: Docs + full verification

**Files:**
- Modify: `README.md` (env table + a docs-mode/HTTP example), `CLAUDE.md` (env table + transport note)
- Then regenerate autogen tables and run the full gate.

**Interfaces:**
- Consumes: everything above. No new code.

- [ ] **Step 1: Update the README env table**

In `README.md`, in the environment-variable table (the row block that lists `AUTOMAD_WRITE_MODE` / `LOG_LEVEL`), add these rows immediately after the `AUTOMAD_STARTER_KIT_PATH` row:

```md
| `AUTOMAD_HTTP_PORT` | no | — | Serve over **Streamable-HTTP** on this port instead of stdio. Unset = stdio (default). |
| `AUTOMAD_HTTP_HOST` | no | `127.0.0.1` | Bind host for the HTTP transport (loopback by default). |
| `AUTOMAD_HTTP_TOKEN` | no | auto-generated | Static Bearer token required on every HTTP request (`Authorization: Bearer <token>`). Auto-generated + logged once at startup if unset. |
```

Then, right after the "In **`docs` mode** …" paragraph, add:

```md
**HTTP transport (multiple local clients).** Set `AUTOMAD_HTTP_PORT` to serve
Streamable-HTTP on `127.0.0.1` instead of stdio. Every request must carry
`Authorization: Bearer <AUTOMAD_HTTP_TOKEN>`; if the token is unset the server
generates one and logs it once at startup. Each client connection is an isolated
session with its own confirm-token state. The endpoint path is `/mcp`.
```

- [ ] **Step 2: Update the CLAUDE.md env table**

In `CLAUDE.md`, in the config env table, add after the `AUTOMAD_STARTER_KIT_PATH` row:

```md
| `AUTOMAD_HTTP_PORT` | no | Serve Streamable-HTTP on this port (`src/http.ts`) instead of stdio; unset = stdio default |
| `AUTOMAD_HTTP_HOST` | no | HTTP bind host, default `127.0.0.1` |
| `AUTOMAD_HTTP_TOKEN` | no | Bearer token for the HTTP transport; auto-generated + logged once if unset |
```

Then, after the `config.ts sets liveEnabled …` paragraph, add:

```md
`index.ts` picks the transport: `AUTOMAD_HTTP_PORT` set → Streamable-HTTP via
`src/http.ts` (stateful, one `WriteGuard` + `McpServer` per session, shared
`HttpClient`); unset → stdio. A constant-time Bearer-token check gates every HTTP
request; bind is loopback with DNS-rebinding protection.
```

- [ ] **Step 3: Regenerate autogen tables + run the full gate**

Run: `npm run docs:sync:all && npm run verify`
Expected: `docs:sync --check: OK`, then `verify: all gates passed.` (build, lint, all tests incl. `config.test.ts` + `http.test.ts`, coverage, docs-sync check).

If `docs:sync` reports drift it cannot auto-fix, inspect and reconcile, then re-run. Do not hand-edit AUTOGEN-fenced regions.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/index.html
git commit -m "docs: document HTTP transport + Bearer-token auth env vars"
```

---

## Self-Review

**1. Spec coverage:**
- Opt-in HTTP, stdio default → Task 1 (`Config.http` only when port set) + Task 3 (branch). ✅
- `node:http` + `StreamableHTTPServerTransport`, no new deps → Task 2. ✅
- Bearer-token middleware, constant-time → Task 2 (`tokenMatches` via `timingSafeEqual`). ✅
- Per-session fresh guard+server (confirm-token isolation) → Task 2 (`makeServer` per init) + isolation test; wired in Task 3. ✅
- Token auto-gen + logged once → Task 1 (gen) + Task 3 (log only when env unset). ✅
- Loopback default + DNS-rebinding protection → Task 2 (`allowedHosts`, `enableDnsRebindingProtection`). ✅
- Error codes 401/400/404/405 → Task 2 (`sendError`; 404 wrong path, 401 bad token, 400 bad session). Note: the SDK transport itself returns 405 for disallowed methods on a valid session; our layer covers 401/400/404. ✅
- Tests: config parsing, 401, initialize+tools/list, tool round-trip, confirm-token isolation, teardown → Tasks 1–2. ✅
- Docs → Task 4. ✅
- `npm run verify` green, no new deps → Task 4 + Global Constraints. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✅

**3. Type consistency:** `HttpConfig`/`Config.http` (Task 1) consumed verbatim in Task 3 (`startHttp({ ...cfg.http, makeServer })`). `HttpTransportOptions`/`HttpHandle`/`startHttp` (Task 2) match their use in Task 3 and the test. `makeServer: () => McpServer` consistent across Task 2 signature, Task 3 wiring, and the test. `HttpHandle.port` added in Task 2 and read by the test + Task 3 log. ✅
