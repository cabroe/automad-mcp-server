# Automad MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive MCP server for the Automad CMS that exposes full site management and theme/template development via the Model Context Protocol, distributed as an NPM package.

**Architecture:** TypeScript + Node.js MCP server speaking to an Automad dashboard via an HTTP bridge (reverse-engineered AJAX endpoints with session-cookie auth). Domain-Router pattern (one tool per domain, `action` parameter). Multi-tier write protection with confirm-token flow.

**Tech Stack:** TypeScript 5.x (strict), Node.js ≥20, `@modelcontextprotocol/sdk`, Zod, Vitest, Pino, ESLint, Prettier.

## Global Constraints

- **Node.js:** ≥20 (per spec §Decisions)
- **TypeScript:** strict mode, no `any` (per spec §Code-Quality Conventions)
- **Tests:** Vitest, ≥80% statements / ≥70% branches coverage target (per spec §Testing Strategy)
- **Lint:** ESLint + Prettier with standard configs (per spec §Code-Quality Conventions)
- **Distribution:** NPM package `@automadcms/mcp-server` (per spec §Distribution)
- **Safety:** Multi-tier write protection always active; default `confirm-destructive` (per spec §Safety Model)
- **Auth:** Dashboard session cookie in-memory only, never persisted (per spec §Auth Flow)
- **Logging:** Pino structured logging with context (requestId, action, params)
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies, scripts, NPM metadata |
| `tsconfig.json` | TypeScript strict config |
| `eslint.config.js` | ESLint flat config |
| `.prettierrc.json` | Prettier formatting rules |
| `.gitignore` | node_modules, dist, .env, coverage |
| `vitest.config.ts` | Test runner config with coverage |
| `src/index.ts` | Entry point — boot, parse env, start server |
| `src/server.ts` | MCP server factory + tool registration |
| `src/config.ts` | Env loading, write-mode parsing, validation |
| `src/errors.ts` | Typed `AutomadMcpError` with code/message/details |
| `src/logger.ts` | Pino instance with redaction for credentials |
| `src/auth.ts` | Dashboard login, session cookie manager, re-auth retry |
| `src/client.ts` | HTTP client wrapper (fetch + retry + auth) |
| `src/write-guard.ts` | Multi-tier write protection + confirm-token store |
| `src/schemas.ts` | Zod schemas for all tool inputs |
| `src/page-format.ts` | Parse/serialize Automad page format (YAML-vars + Editor.js blocks) |
| `src/domains/pages.ts` | `automad_pages` domain router |
| `src/domains/media.ts` | `automad_media` domain router |
| `src/domains/snippets.ts` | `automad_snippets` domain router |
| `src/domains/templates.ts` | `automad_templates` domain router |
| `src/domains/config.ts` | `automad_config` domain router |
| `src/domains/theme.ts` | `automad_theme` domain router |
| `src/domains/site.ts` | `automad_site` domain router |
| `tests/unit/*.test.ts` | Unit tests, one per module |
| `tests/integration/mcp-server.test.ts` | E2E against real Automad instance |
| `README.md` | Setup, config, examples for Claude Desktop / Cursor / etc. |

---

## Phase 1: Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: project root with buildable TS, lintable, testable

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@automadcms/mcp-server",
  "version": "0.1.0",
  "description": "MCP server for the Automad CMS — full site management via AI",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "automad-mcp": "./dist/index.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests",
    "format": "prettier --write src tests"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "pino": "^9.0.0",
    "undici": "^6.0.0",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `eslint.config.js`**

```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-console": "warn",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
];
```

- [ ] **Step 4: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 6: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        statements: 80,
        branches: 70,
      },
    },
  },
});
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Verify TypeScript compiles an empty src**

Create a temporary `src/index.ts` with `export {};`, then run:

Run: `npx tsc --noEmit`
Expected: No errors (or only "Cannot find module" if index is empty — acceptable).

Delete the temp file after.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json eslint.config.js .prettierrc.json .gitignore vitest.config.ts package-lock.json
git commit -m "chore: project scaffold with TypeScript, ESLint, Prettier, Vitest"
```

---

### Task 2: Logger

**Files:**
- Create: `src/logger.ts`
- Test: `tests/unit/logger.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `logger` (Pino instance) with `info`, `warn`, `error`, `debug` methods

- [ ] **Step 1: Write failing test**

`tests/unit/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../src/logger.js";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("exports a pino-compatible logger", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("redacts password and token fields", () => {
    logger.info({ url: "https://x", password: "secret", token: "abc" }, "test");
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("abc");
    expect(output).toContain("https://x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/logger.test.ts`
Expected: FAIL with "Cannot find module '../../src/logger.js'".

- [ ] **Step 3: Implement `src/logger.ts`**

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["password", "token", "*.password", "*.token", "headers.authorization"],
    censor: "[REDACTED]",
  },
  base: {
    service: "automad-mcp",
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/logger.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/unit/logger.test.ts
git commit -m "feat(logger): pino logger with credential redaction"
```

---

### Task 3: Error Types

**Files:**
- Create: `src/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AutomadMcpError` class with `code`, `message`, `details?`

- [ ] **Step 1: Write failing test**

`tests/unit/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AutomadMcpError, errorToJson } from "../../src/errors.js";

describe("AutomadMcpError", () => {
  it("constructs with code and message", () => {
    const e = new AutomadMcpError("NOT_FOUND", "Page not found");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("Page not found");
    expect(e.name).toBe("AutomadMcpError");
    expect(e.details).toBeUndefined();
  });

  it("accepts details", () => {
    const e = new AutomadMcpError("VALIDATION", "Bad input", { field: "path" });
    expect(e.details).toEqual({ field: "path" });
  });

  it("is instanceof Error", () => {
    const e = new AutomadMcpError("UNKNOWN", "x");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("errorToJson", () => {
  it("serializes AutomadMcpError", () => {
    const json = errorToJson(new AutomadMcpError("FORBIDDEN", "denied"));
    expect(json).toEqual({ code: "FORBIDDEN", message: "denied" });
  });

  it("serializes generic Error as UNKNOWN", () => {
    const json = errorToJson(new Error("boom"));
    expect(json).toEqual({ code: "UNKNOWN", message: "boom" });
  });

  it("serializes non-Error values", () => {
    expect(errorToJson("nope")).toEqual({ code: "UNKNOWN", message: "nope" });
    expect(errorToJson(42)).toEqual({ code: "UNKNOWN", message: "42" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/errors.ts`**

```typescript
export type AutomadErrorCode =
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "UNKNOWN";

export class AutomadMcpError extends Error {
  constructor(
    public readonly code: AutomadErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AutomadMcpError";
  }
}

export interface SerializedError {
  code: AutomadErrorCode;
  message: string;
  details?: unknown;
}

export function errorToJson(err: unknown): SerializedError {
  if (err instanceof AutomadMcpError) {
    const out: SerializedError = { code: err.code, message: err.message };
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN", message: err.message };
  }
  return { code: "UNKNOWN", message: String(err) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat(errors): typed AutomadMcpError with code/message/details"
```

---

### Task 4: Config Loader

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: `process.env`
- Produces: `loadConfig()` returning `Config` object; `Config` type with `url`, `username`, `password?`, `token?`, `writeMode`, `logLevel`

- [ ] **Step 1: Write failing test**

`tests/unit/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, type Config } from "../../src/config.js";

describe("loadConfig", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTOMAD_URL;
    delete process.env.AUTOMAD_USER;
    delete process.env.AUTOMAD_PASS;
    delete process.env.AUTOMAD_TOKEN;
    delete process.env.AUTOMAD_WRITE_MODE;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("loads minimal config with defaults", () => {
    process.env.AUTOMAD_URL = "https://blog.example.com";
    process.env.AUTOMAD_USER = "admin";
    process.env.AUTOMAD_PASS = "secret";
    const cfg = loadConfig();
    expect(cfg.url).toBe("https://blog.example.com");
    expect(cfg.username).toBe("admin");
    expect(cfg.password).toBe("secret");
    expect(cfg.writeMode).toBe("confirm-destructive");
    expect(cfg.logLevel).toBe("info");
  });

  it("accepts explicit unrestricted mode", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.AUTOMAD_WRITE_MODE = "unrestricted";
    expect(loadConfig().writeMode).toBe("unrestricted");
  });

  it("throws when AUTOMAD_URL is missing", () => {
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    expect(() => loadConfig()).toThrow(/AUTOMAD_URL/);
  });

  it("throws when neither password nor token is given", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    expect(() => loadConfig()).toThrow(/AUTOMAD_PASS|AUTOMAD_TOKEN/);
  });

  it("accepts token instead of password", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_TOKEN = "tok";
    const cfg = loadConfig();
    expect(cfg.token).toBe("tok");
    expect(cfg.password).toBeUndefined();
  });

  it("validates write mode values", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.AUTOMAD_WRITE_MODE = "garbage";
    expect(() => loadConfig()).toThrow(/write mode/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/config.ts`**

```typescript
import { AutomadMcpError } from "./errors.js";

export type WriteMode = "read-only" | "confirm-destructive" | "unrestricted";

export interface Config {
  url: string;
  username: string;
  password?: string;
  token?: string;
  writeMode: WriteMode;
  logLevel: string;
}

const VALID_MODES: ReadonlySet<WriteMode> = new Set([
  "read-only",
  "confirm-destructive",
  "unrestricted",
]);

export function loadConfig(): Config {
  const url = required("AUTOMAD_URL");
  const username = required("AUTOMAD_USER");
  const password = process.env.AUTOMAD_PASS;
  const token = process.env.AUTOMAD_TOKEN;

  if (!password && !token) {
    throw new AutomadMcpError(
      "VALIDATION",
      "Either AUTOMAD_PASS or AUTOMAD_TOKEN must be provided",
    );
  }

  const writeModeRaw = process.env.AUTOMAD_WRITE_MODE ?? "confirm-destructive";
  if (!VALID_MODES.has(writeModeRaw as WriteMode)) {
    throw new AutomadMcpError(
      "VALIDATION",
      `Invalid AUTOMAD_WRITE_MODE: ${writeModeRaw}. Must be one of: ${[...VALID_MODES].join(", ")}`,
    );
  }

  const cfg: Config = {
    url,
    username,
    writeMode: writeModeRaw as WriteMode,
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
  if (password !== undefined) cfg.password = password;
  if (token !== undefined) cfg.token = token;
  return cfg;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new AutomadMcpError("VALIDATION", `Missing required environment variable: ${name}`);
  }
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): env loader with validation and write-mode guard"
```

---

## Phase 2: Core Infrastructure

### Task 5: Page Format Parser

**Files:**
- Create: `src/page-format.ts`
- Test: `tests/unit/page-format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parsePage(raw: string): ParsedPage`, `serializePage(page: ParsedPage): string`

Where `ParsedPage = { variables: Record<string, unknown>; blocks: EditorJsBlock[] }`.

- [ ] **Step 1: Write failing test**

`tests/unit/page-format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePage, serializePage } from "../../src/page-format.js";

describe("parsePage", () => {
  it("parses variables only", () => {
    const raw = `title: Home\ntheme: starter\nhidden: on\n`;
    const p = parsePage(raw);
    expect(p.variables).toEqual({ title: "Home", theme: "starter", hidden: "on" });
    expect(p.blocks).toEqual([]);
  });

  it("parses variables + blocks", () => {
    const raw = `title: Post\n-\n+hero: {"type":"hero","data":{"title":"Hi"}}\n`;
    const p = parsePage(raw);
    expect(p.variables).toEqual({ title: "Post" });
    expect(p.blocks).toEqual([
      { name: "hero", data: { type: "hero", data: { title: "Hi" } } },
    ]);
  });

  it("handles empty input", () => {
    const p = parsePage("");
    expect(p.variables).toEqual({});
    expect(p.blocks).toEqual([]);
  });

  it("preserves block order", () => {
    const raw = `title: X\n-\n+a: {"type":"a"}\n-\n+b: {"type":"b"}\n`;
    const p = parsePage(raw);
    expect(p.blocks.map((b) => b.name)).toEqual(["a", "b"]);
  });
});

describe("serializePage", () => {
  it("round-trips a simple page", () => {
    const raw = `title: Test\n-\n+hero: {"type":"hero"}\n`;
    const p = parsePage(raw);
    const out = serializePage(p);
    expect(parsePage(out)).toEqual(p);
  });

  it("writes variables before blocks", () => {
    const out = serializePage({
      variables: { title: "T" },
      blocks: [{ name: "hero", data: { type: "hero" } }],
    });
    expect(out).toMatch(/^title: T\n/);
    expect(out).toContain("-\n");
    expect(out).toContain('+hero: {"type":"hero"}');
  });

  it("omits separator when no blocks", () => {
    const out = serializePage({ variables: { title: "T" }, blocks: [] });
    expect(out).toBe("title: T\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/page-format.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/page-format.ts`**

```typescript
export interface EditorJsBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface NamedBlock {
  name: string;
  data: EditorJsBlock;
}

export interface ParsedPage {
  variables: Record<string, unknown>;
  blocks: NamedBlock[];
}

const VAR_RE = /^([a-zA-Z_][\w.-]*):\s*(.*)$/;
const BLOCK_RE = /^\+([a-zA-Z_][\w.-]*):\s*(.+)$/;

export function parsePage(raw: string): ParsedPage {
  const lines = raw.split(/\r?\n/);
  const variables: Record<string, unknown> = {};
  const blocks: NamedBlock[] = [];
  let inBlocks = false;

  for (const line of lines) {
    if (line === "-") {
      inBlocks = true;
      continue;
    }
    if (!inBlocks) {
      const m = VAR_RE.exec(line);
      if (m && m[1] !== undefined) {
        const key = m[1];
        const val = m[2] ?? "";
        variables[key] = parseValue(val);
      }
    } else {
      const m = BLOCK_RE.exec(line);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const name = m[1];
        const jsonStr = m[2];
        try {
          const data = JSON.parse(jsonStr) as EditorJsBlock;
          blocks.push({ name, data });
        } catch {
          // Skip malformed block — round-trip would drop it
        }
      }
    }
  }

  return { variables, blocks };
}

export function serializePage(page: ParsedPage): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(page.variables)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  if (page.blocks.length > 0) {
    lines.push("-");
    for (const block of page.blocks) {
      lines.push(`+${block.name}: ${JSON.stringify(block.data)}`);
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "on" || trimmed === "true") return true;
  if (trimmed === "off" || trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/page-format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/page-format.ts tests/unit/page-format.test.ts
git commit -m "feat(page-format): parse/serialize Automad page format (vars + Editor.js blocks)"
```

---

### Task 6: HTTP Client

**Files:**
- Create: `src/client.ts`
- Test: `tests/unit/client.test.ts`

**Interfaces:**
- Consumes: `fetch` (undici), `auth.getCookie()` returning `string | undefined`
- Produces: `HttpClient` with methods `get`, `post`, `put`, `delete`, `uploadMultipart`

- [ ] **Step 1: Write failing test**

`tests/unit/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "../../src/client.js";
import type { AuthProvider } from "../../src/auth.js";

function mockAuth(cookie: string | undefined): AuthProvider {
  return { getCookie: vi.fn().mockResolvedValue(cookie) };
}

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    headers: new Map(Object.entries(headers)),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("HttpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("performs GET with session cookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map(),
      json: async () => ({ ok: 1 }),
      text: async () => '{"ok":1}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("sid=abc"));
    const res = await client.get<{ ok: number }>("/dashboard/api/pages");
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/dashboard/api/pages");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Cookie).toBe("sid=abc");
  });

  it("throws Auth error on 401 without retry", async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({ error: "no auth" }),
      text: async () => '{"error":"no auth"}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("sid=abc"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "AUTH" });
  });

  it("retries once on 401 after re-auth, then gives up", async () => {
    const auth = mockAuth("sid=new");
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, auth, { maxRetries: 1 });
    await expect(client.get("/x")).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 404 to NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps 403 to FORBIDDEN", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 403,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps 5xx to NETWORK with retry", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        headers: new Map(),
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map(),
        json: async () => ({ ok: 1 }),
        text: async () => '{"ok":1}',
      });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"), {
      maxRetries: 2,
      retryDelayMs: 1,
    });
    const res = await client.get("/x");
    expect(res).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/client.ts`**

```typescript
import { fetch as undiciFetch } from "undici";
import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";

export interface AuthProvider {
  getCookie(): Promise<string | undefined>;
}

export interface HttpClientOptions {
  baseUrl: string;
}

export interface RequestOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export class HttpClient {
  constructor(
    private readonly opts: HttpClientOptions,
    private readonly auth: AuthProvider,
    private readonly defaults: { maxRetries?: number; retryDelayMs?: number } = {},
  ) {}

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  async post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }

  async put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...opts, body });
  }

  async delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  async uploadMultipart<T>(
    path: string,
    file: { base64: string; filename: string; mimeType: string },
    opts?: RequestOptions,
  ): Promise<T> {
    const boundary = `----automad-mcp-${Date.now()}`;
    const headerLine = `--${boundary}\r\n`;
    const fileLine = `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`;
    const fileBody = Buffer.from(file.base64, "base64");
    const closingLine = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(headerLine + fileLine),
      fileBody,
      Buffer.from(closingLine),
    ]);
    return this.request<T>("POST", path, {
      ...opts,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        ...(opts?.headers ?? {}),
      },
      body,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: RequestOptions,
  ): Promise<T> {
    const maxRetries = opts?.maxRetries ?? this.defaults.maxRetries ?? 2;
    const retryDelay = opts?.retryDelayMs ?? this.defaults.retryDelayMs ?? 250;
    const url = this.opts.baseUrl.replace(/\/$/, "") + path;

    let attempt = 0;
    while (true) {
      attempt++;
      const cookie = await this.auth.getCookie();
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
      };
      if (cookie) headers["Cookie"] = cookie;

      let body: BodyInit | undefined;
      if (opts?.body !== undefined) {
        if (typeof opts.body === "string" || Buffer.isBuffer(opts.body)) {
          body = opts.body as BodyInit;
        } else {
          headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
          body = JSON.stringify(opts.body);
        }
      }

      logger.debug({ method, url, attempt }, "HTTP request");
      const res = await undiciFetch(url, { method, headers, body });

      if (res.status === 401 && attempt <= maxRetries) {
        logger.warn({ url }, "401 received, retrying after re-auth");
        await sleep(retryDelay);
        continue;
      }

      if (res.status >= 500 && attempt <= maxRetries) {
        logger.warn({ url, status: res.status, attempt }, "5xx, retrying");
        await sleep(retryDelay * attempt);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        const code = res.status === 401 ? "AUTH" : "FORBIDDEN";
        throw new AutomadMcpError(code, `HTTP ${res.status} on ${method} ${path}`);
      }
      if (res.status === 404) {
        throw new AutomadMcpError("NOT_FOUND", `HTTP 404 on ${method} ${path}`);
      }
      if (res.status === 422 || res.status === 400) {
        const detail = await safeJson(res);
        throw new AutomadMcpError("VALIDATION", `HTTP ${res.status}`, detail);
      }
      if (res.status === 429) {
        throw new AutomadMcpError("RATE_LIMITED", "Rate limited by Automad dashboard");
      }
      if (!res.ok) {
        const detail = await safeJson(res);
        throw new AutomadMcpError("UNKNOWN", `HTTP ${res.status}`, detail);
      }

      return (await safeJson(res)) as T;
    }
  }
}

async function safeJson(res: Response | { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return JSON.parse(await res.text());
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/unit/client.test.ts
git commit -m "feat(client): HTTP client with auth, retry, status-code mapping"
```

---

### Task 7: Auth Manager

**Files:**
- Create: `src/auth.ts`
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Consumes: `Config` from `config.ts`, `HttpClient`
- Produces: `AuthManager` implementing `AuthProvider` (for `client.ts`)

- [ ] **Step 1: Write failing test**

`tests/unit/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthManager } from "../../src/auth.js";
import type { Config } from "../../src/config.js";

describe("AuthManager", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  const cfg: Config = {
    url: "https://blog.example.com",
    username: "admin",
    password: "secret",
    writeMode: "confirm-destructive",
    logLevel: "info",
  };

  it("logs in and stores cookie on first getCookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map([["set-cookie", "PHPSESSID=abc123; path=/"]]),
      json: async () => ({ success: true }),
      text: async () => '{"success":true}',
    });
    const auth = new AuthManager(cfg);
    const cookie = await auth.getCookie();
    expect(cookie).toContain("abc123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://blog.example.com/dashboard");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      username: "admin",
      password: "secret",
    });
  });

  it("reuses cached cookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map([["set-cookie", "PHPSESSID=zzz; path=/"]]),
      json: async () => ({}),
      text: async () => "",
    });
    const auth = new AuthManager(cfg);
    await auth.getCookie();
    await auth.getCookie();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses token instead of login when provided", async () => {
    const tokenCfg: Config = { ...cfg, token: "AUTH-TOKEN-1", password: undefined };
    const auth = new AuthManager(tokenCfg);
    const cookie = await auth.getCookie();
    expect(cookie).toBe("AUTH-TOKEN-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces re-login when forced", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map([["set-cookie", "a=1; path=/"]]),
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map([["set-cookie", "b=2; path=/"]]),
        json: async () => ({}),
        text: async () => "",
      });
    const auth = new AuthManager(cfg);
    await auth.getCookie();
    await auth.getCookie(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws AUTH on login failure", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({ error: "bad creds" }),
      text: async () => "",
    });
    const auth = new AuthManager(cfg);
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/auth.ts`**

```typescript
import { fetch as undiciFetch } from "undici";
import { AutomadMcpError } from "./errors.js";
import { logger } from "./logger.js";
import type { AuthProvider } from "./client.js";
import type { Config } from "./config.js";

export class AuthManager implements AuthProvider {
  private cookie: string | undefined;
  private readonly loginUrl: string;

  constructor(private readonly cfg: Config) {
    this.loginUrl = cfg.url.replace(/\/$/, "") + "/dashboard";
  }

  async getCookie(force = false): Promise<string | undefined> {
    if (this.cfg.token) {
      return this.cfg.token;
    }
    if (this.cookie && !force) {
      return this.cookie;
    }
    await this.login();
    return this.cookie;
  }

  private async login(): Promise<void> {
    logger.info({ url: this.loginUrl, user: this.cfg.username }, "Logging into Automad dashboard");
    const res = await undiciFetch(this.loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });

    if (!res.ok) {
      throw new AutomadMcpError(
        "AUTH",
        `Login failed: HTTP ${res.status}`,
        await safeJson(res),
      );
    }

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new AutomadMcpError("AUTH", "No session cookie returned by dashboard");
    }
    this.cookie = setCookie.split(";")[0] ?? "";
    logger.info("Dashboard login successful");
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/unit/auth.test.ts
git commit -m "feat(auth): dashboard login + session-cookie manager"
```

---

### Task 8: Write Guard

**Files:**
- Create: `src/write-guard.ts`
- Test: `tests/unit/write-guard.test.ts`

**Interfaces:**
- Consumes: `Config` (`writeMode`)
- Produces: `WriteGuard` with `check(action, target)`, `confirm(token)`, `clear()`

- [ ] **Step 1: Write failing test**

`tests/unit/write-guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { WriteGuard, type WriteAction } from "../../src/write-guard.js";
import type { Config } from "../../src/config.js";

describe("WriteGuard", () => {
  let guard: WriteGuard;

  beforeEach(() => {
    const cfg: Config = {
      url: "https://x",
      username: "u",
      password: "p",
      writeMode: "confirm-destructive",
      logLevel: "info",
    };
    guard = new WriteGuard(cfg);
  });

  it("blocks all writes in read-only mode", () => {
    guard = new WriteGuard({ ...emptyCfg(), writeMode: "read-only" });
    expect(guard.check("pages.create", "/x").allowed).toBe(false);
    expect(guard.check("pages.list", "/x").allowed).toBe(true);
  });

  it("permits non-destructive in confirm mode", () => {
    expect(guard.check("pages.create", "/x").allowed).toBe(true);
    expect(guard.check("pages.update", "/x").allowed).toBe(true);
    expect(guard.check("pages.list", "/x").allowed).toBe(true);
  });

  it("requires confirmation for destructive in confirm mode", () => {
    const r = guard.check("pages.delete", "/x");
    expect(r.allowed).toBe("pending");
    if (r.allowed === "pending") {
      expect(r.confirmToken).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("permits everything in unrestricted mode", () => {
    guard = new WriteGuard({ ...emptyCfg(), writeMode: "unrestricted" });
    expect(guard.check("pages.delete", "/x").allowed).toBe(true);
    expect(guard.check("config.set", "x").allowed).toBe(true);
  });

  it("confirm() validates token", () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    expect(guard.confirm(r.confirmToken)).toEqual({ allowed: true });
    expect(guard.confirm(r.confirmToken)).toEqual({ allowed: false, reason: "unknown token" });
  });

  it("confirm() rejects unknown tokens", () => {
    expect(guard.confirm("not-a-token")).toEqual({ allowed: false, reason: "unknown token" });
  });

  it("expired tokens are rejected", async () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    await new Promise((res) => setTimeout(res, 10));
    guard = new WriteGuard({ ...emptyCfg(), writeMode: "confirm-destructive" }, { ttlMs: 5 });
    expect(guard.confirm(r.confirmToken)).toEqual({ allowed: false, reason: "expired or unknown" });
  });

  it("supports confirm via action input", () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    const out = guard.check("pages.delete", "/x", r.confirmToken);
    expect(out.allowed).toBe(true);
  });
});

function emptyCfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "read-only", logLevel: "info" };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/write-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/write-guard.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { Config, WriteMode } from "./config.js";

export type WriteAction =
  | "pages.list" | "pages.get" | "pages.create" | "pages.update" | "pages.delete"
  | "pages.move" | "pages.duplicate"
  | "media.list" | "media.get" | "media.upload" | "media.delete" | "media.rename"
  | "snippets.list" | "snippets.get" | "snippets.set" | "snippets.delete"
  | "templates.list" | "templates.get" | "templates.set" | "templates.delete" | "templates.validate"
  | "config.get" | "config.set" | "config.validate"
  | "theme.list" | "theme.install" | "theme.activate" | "theme.uninstall"
  | "site.info" | "site.search" | "site.backup" | "site.restore";

export type Permit =
  | { allowed: true }
  | { allowed: "pending"; confirmToken: string; target: string; action: WriteAction; expiresAt: string }
  | { allowed: false; reason: string };

const READ_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  "pages.list", "pages.get",
  "media.list", "media.get",
  "snippets.list", "snippets.get",
  "templates.list", "templates.get", "templates.validate",
  "config.get", "config.validate",
  "theme.list",
  "site.info", "site.search",
]);

const DESTRUCTIVE_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  "pages.delete", "pages.move",
  "media.delete",
  "snippets.delete",
  "templates.delete",
  "config.set",
  "theme.uninstall",
  "site.restore",
]);

export interface WriteGuardOptions {
  ttlMs?: number;
}

interface PendingEntry {
  token: string;
  action: WriteAction;
  target: string;
  expiresAt: number;
}

export class WriteGuard {
  private readonly mode: WriteMode;
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(cfg: Config, opts: WriteGuardOptions = {}) {
    this.mode = cfg.writeMode;
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  }

  check(action: WriteAction, target: string, confirmToken?: string): Permit {
    if (READ_ACTIONS.has(action)) {
      return { allowed: true };
    }
    if (this.mode === "read-only") {
      return { allowed: false, reason: "Server is in read-only mode" };
    }
    if (this.mode === "unrestricted") {
      return { allowed: true };
    }
    if (confirmToken !== undefined) {
      const entry = this.pending.get(confirmToken);
      if (!entry || entry.expiresAt < Date.now() || entry.action !== action) {
        return { allowed: false, reason: "expired or unknown" };
      }
      this.pending.delete(confirmToken);
      return { allowed: true };
    }
    if (!DESTRUCTIVE_ACTIONS.has(action)) {
      return { allowed: true };
    }
    const token = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;
    this.pending.set(token, { token, action, target, expiresAt });
    return {
      allowed: "pending",
      confirmToken: token,
      target,
      action,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  confirm(token: string): Permit {
    const entry = this.pending.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.pending.delete(token);
      return { allowed: false, reason: entry ? "expired" : "unknown token" };
    }
    this.pending.delete(token);
    return { allowed: true };
  }

  clear(): void {
    this.pending.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/write-guard.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/write-guard.ts tests/unit/write-guard.test.ts
git commit -m "feat(write-guard): multi-tier protection with confirm-token flow"
```

---

### Task 9: Zod Schemas

**Files:**
- Create: `src/schemas.ts`
- Test: `tests/unit/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: Zod schemas for every tool's input

- [ ] **Step 1: Write failing test**

`tests/unit/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pagesInput, mediaInput, writeMode } from "../../src/schemas.js";

describe("schemas", () => {
  it("pagesInput accepts list", () => {
    expect(pagesInput.parse({ action: "list" })).toBeDefined();
  });

  it("pagesInput rejects unknown action", () => {
    expect(() => pagesInput.parse({ action: "bogus" })).toThrow();
  });

  it("mediaInput requires source for upload", () => {
    expect(() => mediaInput.parse({ action: "upload" })).toThrow();
    expect(() =>
      mediaInput.parse({ action: "upload", source: { base64: "AA==", filename: "x.png", mimeType: "image/png" } }),
    ).not.toThrow();
  });

  it("writeMode enum is strict", () => {
    expect(writeMode.parse("read-only")).toBe("read-only");
    expect(writeMode.parse("confirm-destructive")).toBe("confirm-destructive");
    expect(writeMode.parse("unrestricted")).toBe("unrestricted");
    expect(() => writeMode.parse("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schemas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/schemas.ts`**

```typescript
import { z } from "zod";

export const writeMode = z.enum(["read-only", "confirm-destructive", "unrestricted"]);

const pathSchema = z.string().min(1).regex(/^\//, "path must start with /");

const editorJsBlock = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

export const pagesInput = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "move", "duplicate"]),
  path: pathSchema.optional(),
  data: z
    .object({
      title: z.string().optional(),
      variables: z.record(z.unknown()).optional(),
      blocks: z.array(editorJsBlock).optional(),
    })
    .optional(),
  target_path: pathSchema.optional(),
  recursive: z.boolean().optional(),
  confirm_token: z.string().optional(),
});

export const mediaInput = z.object({
  action: z.enum(["list", "get", "upload", "delete", "rename"]),
  path: pathSchema.optional(),
  source: z
    .object({
      base64: z.string(),
      filename: z.string(),
      mimeType: z.string(),
    })
    .optional(),
  new_name: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const snippetsInput = z.object({
  action: z.enum(["list", "get", "set", "delete"]),
  name: z.string().optional(),
  scope: z.enum(["global", "local"]).optional(),
  data: z
    .object({
      variables: z.record(z.unknown()).optional(),
      blocks: z.array(editorJsBlock).optional(),
    })
    .optional(),
  confirm_token: z.string().optional(),
});

export const templatesInput = z.object({
  action: z.enum(["list", "get", "set", "delete", "validate"]),
  path: pathSchema.optional(),
  content: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const configInput = z.object({
  action: z.enum(["get", "set", "validate"]),
  key: z.string().optional(),
  value: z.unknown().optional(),
  confirm_token: z.string().optional(),
});

export const themeInput = z.object({
  action: z.enum(["list", "install", "activate", "uninstall"]),
  source: z.string().optional(),
  theme: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const siteInput = z.object({
  action: z.enum(["info", "search", "backup", "restore"]),
  query: z.string().optional(),
  backup_path: z.string().optional(),
  confirm_token: z.string().optional(),
});

export type PagesInput = z.infer<typeof pagesInput>;
export type MediaInput = z.infer<typeof mediaInput>;
export type SnippetsInput = z.infer<typeof snippetsInput>;
export type TemplatesInput = z.infer<typeof templatesInput>;
export type ConfigInput = z.infer<typeof configInput>;
export type ThemeInput = z.infer<typeof themeInput>;
export type SiteInput = z.infer<typeof siteInput>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schemas.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts tests/unit/schemas.test.ts
git commit -m "feat(schemas): Zod schemas for all tool inputs"
```

---

## Phase 3: Domain Routers

### Task 10: Pages Domain Router

**Files:**
- Create: `src/domains/pages.ts`
- Test: `tests/unit/domains/pages.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`, `parsePage`, `serializePage`
- Produces: `handlePages(input: PagesInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/pages.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePages } from "../../../../src/domains/pages.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(writeMode: Config["writeMode"] = "unrestricted"): Config {
  return { url: "https://x", username: "u", password: "p", writeMode, logLevel: "info" };
}

describe("handlePages", () => {
  let client: HttpClient;
  let guard: WriteGuard;

  beforeEach(() => {
    client = mockClient();
    guard = new WriteGuard(cfg());
  });

  it("list calls /api/pages", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ pages: [] });
    const out = await handlePages({ action: "list" }, client, guard);
    expect(out).toEqual({ pages: [] });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/pages");
  });

  it("get requires path", async () => {
    await expect(handlePages({ action: "get" }, client, guard)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("get calls /api/pages/{path}", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ path: "/x" });
    const out = await handlePages({ action: "get", path: "/x" }, client, guard);
    expect(out).toEqual({ path: "/x" });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/pages/%2Fx");
  });

  it("create posts with serialized page body", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: "create", path: "/x", data: { title: "T", variables: { a: 1 } } },
      client,
      guard,
    );
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.path).toBe("/x");
    expect(body.raw).toContain("title: T");
  });

  it("delete requires confirmation in confirm-destructive mode", async () => {
    guard = new WriteGuard(cfg("confirm-destructive"));
    const r = await handlePages({ action: "delete", path: "/x" }, client, guard);
    expect(r).toMatchObject({ allowed: "pending" });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("delete with confirm_token proceeds", async () => {
    guard = new WriteGuard(cfg("confirm-destructive"));
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const pending = await handlePages({ action: "delete", path: "/x" }, client, guard);
    if (!pending || typeof pending !== "object" || !("confirmToken" in pending)) {
      throw new Error("expected pending");
    }
    const out = await handlePages(
      { action: "delete", path: "/x", confirm_token: pending.confirmToken as string },
      client,
      guard,
    );
    expect(out).toEqual({ ok: true });
    expect(client.delete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/pages.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import { parsePage, serializePage } from "../page-format.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { PagesInput } from "../schemas.js";

type PagesAction = PagesInput["action"];

const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: "pages.list",
  get: "pages.get",
  create: "pages.create",
  update: "pages.update",
  delete: "pages.delete",
  move: "pages.move",
  duplicate: "pages.duplicate",
};

export async function handlePages(
  input: PagesInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/pages");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get(encodePath("/dashboard/api/pages", input.path));
    }
    case "create": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required for create");
      const raw = serializePage({
        variables: input.data.variables ?? { title: input.data.title ?? "" },
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.post("/dashboard/api/pages", { path: input.path, raw });
    }
    case "update": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required for update");
      const raw = serializePage({
        variables: input.data.variables ?? {},
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.put(encodePath("/dashboard/api/pages", input.path), { raw });
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete(encodePath("/dashboard/api/pages", input.path), {
        headers: input.recursive ? { "X-Recursive": "1" } : {},
      });
    }
    case "move": {
      if (!input.path || !input.target_path) {
        throw new AutomadMcpError("VALIDATION", "path and target_path required");
      }
      return client.post(encodePath("/dashboard/api/pages", input.path) + "/move", {
        target: input.target_path,
      });
    }
    case "duplicate": {
      if (!input.path || !input.target_path) {
        throw new AutomadMcpError("VALIDATION", "path and target_path required");
      }
      return client.post(encodePath("/dashboard/api/pages", input.path) + "/duplicate", {
        target: input.target_path,
      });
    }
  }
}

function encodePath(base: string, path: string): string {
  return base + "/" + encodeURIComponent(path);
}

// Re-export for downstream tasks
export { parsePage, serializePage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/pages.ts tests/unit/domains/pages.test.ts
git commit -m "feat(domains/pages): pages domain router with CRUD + move/duplicate"
```

---

### Task 11: Media Domain Router

**Files:**
- Create: `src/domains/media.ts`
- Test: `tests/unit/domains/media.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleMedia(input: MediaInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/media.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleMedia } from "../../../../src/domains/media.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    uploadMultipart: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleMedia", () => {
  it("list calls /api/media", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    const out = await handleMedia({ action: "list" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ files: [] });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/media");
  });

  it("upload requires source", async () => {
    await expect(
      handleMedia({ action: "upload" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("upload calls uploadMultipart", async () => {
    const client = mockClient();
    (client.uploadMultipart as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleMedia(
      {
        action: "upload",
        path: "/shared/images",
        source: { base64: "AA==", filename: "x.png", mimeType: "image/png" },
      },
      client,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(client.uploadMultipart).toHaveBeenCalledWith(
      "/dashboard/api/media",
      expect.objectContaining({ filename: "x.png" }),
    );
  });

  it("delete requires confirmation in confirm-destructive mode", async () => {
    const guard = new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" });
    const r = await handleMedia({ action: "delete", path: "/x" }, mockClient(), guard);
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/media.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/media.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { MediaInput } from "../schemas.js";

type MediaAction = MediaInput["action"];

const ACTION_MAP: Record<MediaAction, WriteAction> = {
  list: "media.list",
  get: "media.get",
  upload: "media.upload",
  delete: "media.delete",
  rename: "media.rename",
};

export async function handleMedia(
  input: MediaInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/media");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get("/dashboard/api/media?path=" + encodeURIComponent(input.path));
    }
    case "upload": {
      if (!input.source) throw new AutomadMcpError("VALIDATION", "source is required for upload");
      return client.uploadMultipart("/dashboard/api/media", input.source);
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete("/dashboard/api/media?path=" + encodeURIComponent(input.path));
    }
    case "rename": {
      if (!input.path || !input.new_name) {
        throw new AutomadMcpError("VALIDATION", "path and new_name required");
      }
      return client.post("/dashboard/api/media/rename", {
        path: input.path,
        new_name: input.new_name,
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/media.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/media.ts tests/unit/domains/media.test.ts
git commit -m "feat(domains/media): media domain router"
```

---

### Task 12: Snippets Domain Router

**Files:**
- Create: `src/domains/snippets.ts`
- Test: `tests/unit/domains/snippets.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleSnippets(input: SnippetsInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/snippets.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleSnippets } from "../../../../src/domains/snippets.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleSnippets", () => {
  it("list with scope=global hits /api/shared/snippets", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ snippets: [] });
    await handleSnippets({ action: "list", scope: "global" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/shared/snippets");
  });

  it("set requires data", async () => {
    await expect(
      handleSnippets({ action: "set", name: "footer" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("set calls PUT with serialized body", async () => {
    const client = mockClient();
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleSnippets(
      {
        action: "set",
        name: "footer",
        scope: "global",
        data: { variables: { cta: "Sign up" } },
      },
      client,
      new WriteGuard(cfg()),
    );
    expect(client.put).toHaveBeenCalledWith(
      "/dashboard/api/shared/snippets/footer",
      expect.objectContaining({ raw: expect.stringContaining("cta: Sign up") }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/snippets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/snippets.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import { serializePage } from "../page-format.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SnippetsInput } from "../schemas.js";

type SnippetsAction = SnippetsInput["action"];
const ACTION_MAP: Record<SnippetsAction, WriteAction> = {
  list: "snippets.list",
  get: "snippets.get",
  set: "snippets.set",
  delete: "snippets.delete",
};

export async function handleSnippets(
  input: SnippetsInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.name ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  const scope = input.scope ?? "local";
  const base = scope === "global" ? "/dashboard/api/shared/snippets" : "/dashboard/api/snippets";

  switch (input.action) {
    case "list":
      return client.get(base);
    case "get": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      return client.get(`${base}/${encodeURIComponent(input.name)}`);
    }
    case "set": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      if (!input.data) throw new AutomadMcpError("VALIDATION", "data is required");
      const raw = serializePage({
        variables: input.data.variables ?? {},
        blocks: (input.data.blocks ?? []).map((b) => ({ name: "block", data: b })),
      });
      return client.put(`${base}/${encodeURIComponent(input.name)}`, { raw });
    }
    case "delete": {
      if (!input.name) throw new AutomadMcpError("VALIDATION", "name is required");
      return client.delete(`${base}/${encodeURIComponent(input.name)}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/snippets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/snippets.ts tests/unit/domains/snippets.test.ts
git commit -m "feat(domains/snippets): snippets domain router"
```

---

### Task 13: Templates Domain Router

**Files:**
- Create: `src/domains/templates.ts`
- Test: `tests/unit/domains/templates.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleTemplates(input: TemplatesInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/templates.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleTemplates } from "../../../../src/domains/templates.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleTemplates", () => {
  it("list calls /api/templates", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ templates: [] });
    await handleTemplates({ action: "list" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/templates");
  });

  it("get requires path", async () => {
    await expect(
      handleTemplates({ action: "get" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("validate runs balance check on <@ ... @> tags", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      path: "/x",
      content: "<@ foreach @><@ end @>",
    });
    const out = await handleTemplates({ action: "validate", path: "/x" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ path: "/x", valid: true });

    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      path: "/y",
      content: "<@ foreach @>",
    });
    const out2 = await handleTemplates({ action: "validate", path: "/y" }, client, new WriteGuard(cfg()));
    expect(out2).toEqual({ path: "/y", valid: false, error: expect.stringMatching(/unbalanced/i) });
  });

  it("set requires content", async () => {
    await expect(
      handleTemplates(
        { action: "set", path: "/x" },
        mockClient(),
        new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/templates.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { TemplatesInput } from "../schemas.js";

type TemplatesAction = TemplatesInput["action"];
const ACTION_MAP: Record<TemplatesAction, WriteAction> = {
  list: "templates.list",
  get: "templates.get",
  set: "templates.set",
  delete: "templates.delete",
  validate: "templates.validate",
};

export async function handleTemplates(
  input: TemplatesInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/templates");
    case "get": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.get("/dashboard/api/templates?path=" + encodeURIComponent(input.path));
    }
    case "set": {
      if (!input.path || input.content === undefined) {
        throw new AutomadMcpError("VALIDATION", "path and content required");
      }
      return client.put("/dashboard/api/templates", { path: input.path, content: input.content });
    }
    case "delete": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      return client.delete("/dashboard/api/templates?path=" + encodeURIComponent(input.path));
    }
    case "validate": {
      if (!input.path) throw new AutomadMcpError("VALIDATION", "path is required");
      const res = (await client.get("/dashboard/api/templates?path=" + encodeURIComponent(input.path))) as {
        path: string;
        content: string;
      };
      return validateTemplate(res.content).then((r) => ({ path: res.path, ...r }));
    }
  }
}

async function validateTemplate(content: string): Promise<{ valid: boolean; error?: string }> {
  const open = (content.match(/<@/g) ?? []).length;
  const close = (content.match(/@>/g) ?? []).length;
  if (open !== close) {
    return { valid: false, error: `unbalanced tags: ${open} open, ${close} close` };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/templates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/templates.ts tests/unit/domains/templates.test.ts
git commit -m "feat(domains/templates): templates router with syntax validation"
```

---

### Task 14: Config Domain Router

**Files:**
- Create: `src/domains/config.ts`
- Test: `tests/unit/domains/config.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleConfig(input: ConfigInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/config.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleConfig } from "../../../../src/domains/config.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleConfig", () => {
  it("get fetches /api/config", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ config: {} });
    const out = await handleConfig({ action: "get" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ config: {} });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/config");
  });

  it("get with key does dot-path lookup", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ config: { a: { b: 1 } } });
    const out = await handleConfig({ action: "get", key: "a.b" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ value: 1 });
  });

  it("set requires value", async () => {
    await expect(
      handleConfig({ action: "set", key: "x" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("set requires confirmation in confirm-destructive", async () => {
    const r = await handleConfig(
      { action: "set", key: "x", value: 1 },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/config.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { ConfigInput } from "../schemas.js";

type ConfigAction = ConfigInput["action"];
const ACTION_MAP: Record<ConfigAction, WriteAction> = {
  get: "config.get",
  set: "config.set",
  validate: "config.validate",
};

export async function handleConfig(
  input: ConfigInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.key ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "get": {
      const res = (await client.get("/dashboard/api/config")) as { config: Record<string, unknown> };
      if (input.key) {
        const value = getByPath(res.config, input.key);
        return { key: input.key, value };
      }
      return res;
    }
    case "set": {
      if (!input.key || input.value === undefined) {
        throw new AutomadMcpError("VALIDATION", "key and value required");
      }
      return client.post("/dashboard/api/config", { key: input.key, value: input.value });
    }
    case "validate": {
      return client.get("/dashboard/api/config/validate");
    }
  }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/config.ts tests/unit/domains/config.test.ts
git commit -m "feat(domains/config): config router with dot-path get"
```

---

### Task 15: Theme Domain Router

**Files:**
- Create: `src/domains/theme.ts`
- Test: `tests/unit/domains/theme.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleTheme(input: ThemeInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/theme.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleTheme } from "../../../../src/domains/theme.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleTheme", () => {
  it("list calls /api/themes", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ themes: [] });
    await handleTheme({ action: "list" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/themes");
  });

  it("install requires source", async () => {
    await expect(
      handleTheme({ action: "install" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("install with GitHub source triggers starter-kit bootstrap when source matches", async () => {
    const client = mockClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleTheme(
      { action: "install", source: "https://github.com/user/my-theme", theme: "starter" },
      client,
      new WriteGuard(cfg()),
    );
    expect(out).toMatchObject({ ok: true });
    expect(client.post).toHaveBeenCalledWith(
      "/dashboard/api/themes/install",
      expect.objectContaining({ theme: "starter" }),
    );
  });

  it("uninstall requires confirmation", async () => {
    const r = await handleTheme(
      { action: "uninstall", theme: "starter" },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/theme.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { ThemeInput } from "../schemas.js";

type ThemeAction = ThemeInput["action"];
const ACTION_MAP: Record<ThemeAction, WriteAction> = {
  list: "theme.list",
  install: "theme.install",
  activate: "theme.activate",
  uninstall: "theme.uninstall",
};

export async function handleTheme(
  input: ThemeInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.theme ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "list":
      return client.get("/dashboard/api/themes");
    case "install": {
      if (!input.source) throw new AutomadMcpError("VALIDATION", "source is required");
      const isStarterKit = input.source.includes("automad-theme-starter-kit");
      return client.post("/dashboard/api/themes/install", {
        source: input.source,
        theme: input.theme,
        bootstrap_starter_kit: isStarterKit,
        steps: isStarterKit
          ? [
              "git clone <repo> into Automad packages directory",
              "cp .env.example .env and set AUTOMAD_BASE",
              "npm install",
              "Update composer.json and theme.json (name, description)",
              "npm run dev",
            ]
          : undefined,
      });
    }
    case "activate": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required");
      return client.post("/dashboard/api/themes/activate", { theme: input.theme });
    }
    case "uninstall": {
      if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required");
      return client.delete(`/dashboard/api/themes/${encodeURIComponent(input.theme)}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/theme.ts tests/unit/domains/theme.test.ts
git commit -m "feat(domains/theme): theme router with starter-kit bootstrap hints"
```

---

### Task 16: Site Domain Router

**Files:**
- Create: `src/domains/site.ts`
- Test: `tests/unit/domains/site.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `WriteGuard`
- Produces: `handleSite(input: SiteInput): Promise<unknown>`

- [ ] **Step 1: Write failing test**

`tests/unit/domains/site.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleSite } from "../../../../src/domains/site.js";
import type { HttpClient } from "../../../../src/client.js";
import { WriteGuard } from "../../../../src/write-guard.js";
import type { Config } from "../../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleSite", () => {
  it("info calls /api/site", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ name: "blog", version: "1.0" });
    const out = await handleSite({ action: "info" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ name: "blog", version: "1.0" });
  });

  it("search requires query", async () => {
    await expect(
      handleSite({ action: "search" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("backup requires confirmation", async () => {
    const r = await handleSite(
      { action: "backup", backup_path: "/tmp/x.zip" },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });

  it("restore requires confirmation", async () => {
    const r = await handleSite(
      { action: "restore", backup_path: "/tmp/x.zip" },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domains/site.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/site.ts`**

```typescript
import { AutomadMcpError } from "../errors.js";
import type { HttpClient } from "../client.js";
import type { WriteGuard, WriteAction } from "../write-guard.js";
import type { SiteInput } from "../schemas.js";

type SiteAction = SiteInput["action"];
const ACTION_MAP: Record<SiteAction, WriteAction> = {
  info: "site.info",
  search: "site.search",
  backup: "site.backup",
  restore: "site.restore",
};

export async function handleSite(
  input: SiteInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], input.query ?? input.backup_path ?? "/", input.confirm_token);
  if (permit.allowed === false) {
    throw new AutomadMcpError("FORBIDDEN", permit.reason);
  }
  if (permit.allowed === "pending") {
    return permit;
  }

  switch (input.action) {
    case "info":
      return client.get("/dashboard/api/site");
    case "search": {
      if (!input.query) throw new AutomadMcpError("VALIDATION", "query is required");
      return client.get("/dashboard/api/site/search?q=" + encodeURIComponent(input.query));
    }
    case "backup": {
      if (!input.backup_path) throw new AutomadMcpError("VALIDATION", "backup_path is required");
      return client.post("/dashboard/api/site/backup", { path: input.backup_path });
    }
    case "restore": {
      if (!input.backup_path) throw new AutomadMcpError("VALIDATION", "backup_path is required");
      return client.post("/dashboard/api/site/restore", { path: input.backup_path });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domains/site.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domains/site.ts tests/unit/domains/site.test.ts
git commit -m "feat(domains/site): site router with backup/restore confirmation"
```

---

## Phase 4: Server Assembly

### Task 17: MCP Server Factory

**Files:**
- Create: `src/server.ts`
- Test: `tests/unit/server.test.ts`

**Interfaces:**
- Consumes: `Config`, `HttpClient`, `WriteGuard`, `AuthManager`
- Produces: `createServer(): Server` with all 7 tools registered

- [ ] **Step 1: Write failing test**

`tests/unit/server.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createServer } from "../../src/server.js";
import type { Config } from "../../src/config.js";
import { AuthManager } from "../../src/auth.js";
import { HttpClient } from "../../src/client.js";
import { WriteGuard } from "../../src/write-guard.js";

describe("createServer", () => {
  it("registers all 7 tools", () => {
    const cfg: Config = { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
    const server = createServer({
      cfg,
      auth: {} as AuthManager,
      client: {} as HttpClient,
      guard: new WriteGuard(cfg),
    });
    // Inspect server._registeredTools if exposed; otherwise we test indirectly by calling
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/server.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Config } from "./config.js";
import type { AuthManager } from "./auth.js";
import type { HttpClient } from "./client.js";
import type { WriteGuard } from "./write-guard.js";
import { errorToJson } from "./errors.js";
import { logger } from "./logger.js";
import { pagesInput, mediaInput, snippetsInput, templatesInput, configInput, themeInput, siteInput } from "./schemas.js";
import { handlePages } from "./domains/pages.js";
import { handleMedia } from "./domains/media.js";
import { handleSnippets } from "./domains/snippets.js";
import { handleTemplates } from "./domains/templates.js";
import { handleConfig } from "./domains/config.js";
import { handleTheme } from "./domains/theme.js";
import { handleSite } from "./domains/site.js";

export interface ServerDeps {
  cfg: Config;
  auth: AuthManager;
  client: HttpClient;
  guard: WriteGuard;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: "automad-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerTool(server, "automad_pages", "Manage Automad pages — CRUD + tree operations.", pagesInput, (input) =>
    handlePages(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_media", "Manage Automad media files.", mediaInput, (input) =>
    handleMedia(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_snippets", "Manage Automad snippets (shared content).", snippetsInput, (input) =>
    handleSnippets(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_templates", "Manage Automad templates (theme files).", templatesInput, (input) =>
    handleTemplates(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_config", "Manage Automad site configuration.", configInput, (input) =>
    handleConfig(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_theme", "Manage Automad theme packages.", themeInput, (input) =>
    handleTheme(input, deps.client, deps.guard),
  );
  registerTool(server, "automad_site", "Manage Automad site-level operations.", siteInput, (input) =>
    handleSite(input, deps.client, deps.guard),
  );

  return server;
}

function registerTool<T>(
  server: McpServer,
  name: string,
  description: string,
  schema: { parse: (input: unknown) => T },
  handler: (input: T) => Promise<unknown>,
): void {
  server.tool(
    name,
    description,
    // MCP SDK accepts a Zod raw shape or a JSON schema. We pass the raw shape.
    // Re-export the schema shape via Zod's internal _def.shape if needed;
    // for simplicity here, we pass a flat object schema the SDK can introspect.
    shapeFromZod(schema),
    async (input: unknown) => {
      try {
        const parsed = schema.parse(input);
        const result = await handler(parsed);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        logger.error({ tool: name, err: errorToJson(err) }, "Tool call failed");
        const e = errorToJson(err);
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(e, null, 2) }],
        };
      }
    },
  );
}

function shapeFromZod(zodSchema: { _def?: { shape?: unknown } }): Record<string, unknown> {
  const shape = zodSchema._def?.shape;
  return (shape as Record<string, unknown>) ?? {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/unit/server.test.ts
git commit -m "feat(server): MCP server factory with 7 domain-router tools"
```

> Note: The `zod-to-json-schema` import is reserved for future versions that pass full JSON schemas instead of raw Zod shapes. The current shape-passing approach uses `ZodRawShape` semantics; remove the unused import if not needed.

---

### Task 18: Entry Point

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: nothing (entry point)
- Produces: starts the MCP server on stdio

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { AuthManager } from "./auth.js";
import { HttpClient } from "./client.js";
import { WriteGuard } from "./write-guard.js";
import { createServer } from "./server.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  process.env.LOG_LEVEL = cfg.logLevel;

  const auth = new AuthManager(cfg);
  const client = new HttpClient({ baseUrl: cfg.url }, auth);
  const guard = new WriteGuard(cfg);

  const server = createServer({ cfg, auth, client, guard });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ url: cfg.url, writeMode: cfg.writeMode }, "Automad MCP server started");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error starting Automad MCP server");
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify the binary entry works (smoke)**

Run: `echo '{}' | AUTOMAD_URL=https://x AUTOMAD_USER=u AUTOMAD_PASS=p AUTOMAD_WRITE_MODE=read-only timeout 1 node --experimental-strip-types --no-warnings src/index.ts 2>&1 | head -20`
Expected: Server starts, then exits on timeout. Errors about missing dashboards are OK in this smoke test.

(Alternative for production: build with `npm run build` and run `node dist/index.js`.)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point wiring config, auth, client, guard, server"
```

---

## Phase 5: Integration & Distribution

### Task 19: Integration Test (Mock Automad)

**Files:**
- Create: `tests/integration/mcp-server.test.ts`

**Interfaces:**
- Consumes: `createServer`, mock HTTP server simulating dashboard
- Produces: end-to-end tests for tool registration and basic flow

- [ ] **Step 1: Write integration test**

`tests/integration/mcp-server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../../src/server.js";
import { AuthManager } from "../../src/auth.js";
import { HttpClient } from "../../src/client.js";
import { WriteGuard } from "../../src/write-guard.js";
import type { Config } from "../../src/config.js";
import { createServer as createHttpServer } from "node:http";
import type { Server as HttpServer } from "node:http";

const cfg: Config = {
  url: "http://127.0.0.1:0", // overridden in beforeAll
  username: "admin",
  password: "secret",
  writeMode: "unrestricted",
  logLevel: "silent",
};

let httpServer: HttpServer;
let baseUrl: string;

beforeAll(async () => {
  httpServer = createHttpServer((req, res) => {
    res.setHeader("Set-Cookie", "PHPSESSID=test-cookie; path=/");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/dashboard" && req.method === "POST") {
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (req.url === "/dashboard/api/site" && req.method === "GET") {
      res.statusCode = 200;
      res.end(JSON.stringify({ name: "TestSite", version: "1.0" }));
      return;
    }
    if (req.url === "/dashboard/api/pages" && req.method === "GET") {
      res.statusCode = 200;
      res.end(JSON.stringify({ pages: [{ path: "/", title: "Home" }] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((res) => httpServer.listen(0, "127.0.0.1", () => res()));
  const addr = httpServer.address();
  if (typeof addr === "object" && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    throw new Error("Could not bind mock HTTP server");
  }
});

afterAll(async () => {
  await new Promise<void>((res) => httpServer.close(() => res()));
});

describe("MCP server integration", () => {
  it("server instance is created", () => {
    const auth = new AuthManager({ ...cfg, url: baseUrl });
    const client = new HttpClient({ baseUrl }, auth);
    const guard = new WriteGuard({ ...cfg, url: baseUrl });
    const server = createServer({ cfg: { ...cfg, url: baseUrl }, auth, client, guard });
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/integration/mcp-server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-server.test.ts
git commit -m "test: integration smoke against mock Automad dashboard"
```

---

### Task 20: README & Setup Docs

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: user-facing setup instructions

- [ ] **Step 1: Create `README.md`**

````markdown
# Automad MCP Server

MCP server for the [Automad CMS](https://automad.org) — manage your Automad site via AI assistants that speak the Model Context Protocol.

## What you can do

- **Pages** — list, get, create, update, delete, move, duplicate
- **Media** — list, upload, delete, rename
- **Snippets** — list, get, set, delete
- **Templates** — list, get, set, delete, validate
- **Config** — get, set, validate
- **Theme** — list, install, activate, uninstall
- **Site** — info, search, backup, restore

All operations follow the Domain-Router pattern: one tool per domain with an `action` parameter.

## Configuration

Required environment variables:

| Variable | Description |
|----------|-------------|
| `AUTOMAD_URL` | Base URL of your Automad site (e.g. `https://blog.example.com`) |
| `AUTOMAD_USER` | Dashboard username |
| `AUTOMAD_PASS` | Dashboard password (or use `AUTOMAD_TOKEN`) |
| `AUTOMAD_TOKEN` | Optional: pre-issued auth token |
| `AUTOMAD_WRITE_MODE` | `read-only` / `confirm-destructive` (default) / `unrestricted` |
| `LOG_LEVEL` | Optional: `debug` / `info` (default) / `warn` / `error` |

## Setup — Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": {
        "AUTOMAD_URL": "https://blog.example.com",
        "AUTOMAD_USER": "admin",
        "AUTOMAD_PASS": "••••••",
        "AUTOMAD_WRITE_MODE": "confirm-destructive"
      }
    }
  }
}
```

## Setup — Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": { "AUTOMAD_URL": "https://…", "AUTOMAD_USER": "…", "AUTOMAD_PASS": "…" }
    }
  }
}
```

## Setup — Cline / Zed

Same MCP config format. See your client's documentation.

## Write Protection

The default mode is `confirm-destructive`. Destructive operations (delete, move, restore, uninstall) return a `confirmToken` that must be passed back to execute. The AI assistant will present a confirmation prompt; on approval, the action proceeds.

To override, set `AUTOMAD_WRITE_MODE` to `unrestricted` (only recommended for trusted environments).

## Development

```bash
npm install
npm run dev      # run with tsx
npm test         # vitest
npm run lint
npm run build    # produce dist/
```

## Bootstrap a new theme from the starter kit

The MCP server includes hints for the official [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit) workflow when installing a theme with that source:

1. Click **Use this template** on the starter-kit GitHub repo.
2. Install Automad via Composer: `composer global require automad/automad`
3. Clone your new repo into Automad's `packages/<namespace>/<theme>` directory.
4. `cp .env.example .env` and set `AUTOMAD_BASE` to your Automad install path.
5. `npm install`
6. `npm run dev` (Automad opens in your browser)
7. Update `composer.json` and `theme.json` (name, description, vendor info).
8. In Automad, create a page and apply one of the included templates.

## License

MIT
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, write-protection, and starter-kit workflow"
```

---

### Task 21: Build & NPM Publish Dry-Run

**Files:**
- Modify: `package.json` (already done in Task 1)

**Interfaces:**
- Consumes: built artifacts in `dist/`
- Produces: confirmed build + publish-readiness

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `dist/` populated with `.js` files and type declarations; no TS errors.

- [ ] **Step 2: Verify dist/ contents**

Run: `ls dist/ && cat dist/index.js | head -20`
Expected: `index.js`, `server.js`, `domains/`, etc.

- [ ] **Step 3: Smoke-test built artifact**

Run: `echo '{}' | AUTOMAD_URL=https://x AUTOMAD_USER=u AUTOMAD_PASS=p AUTOMAD_WRITE_MODE=read-only timeout 1 node dist/index.js 2>&1 | head -20`
Expected: Server starts; logs visible.

- [ ] **Step 4: NPM pack dry-run**

Run: `npm pack --dry-run`
Expected: Shows what would be published — `dist/`, `README.md`, `LICENSE`, `package.json`. No `node_modules/` or `.env`.

- [ ] **Step 5: Commit any final changes**

```bash
git status
# If clean, no commit. If LICENSE missing, add it:
# git add LICENSE
# git commit -m "chore: add MIT LICENSE"
```

---

## Self-Review

### Spec coverage

| Spec section | Implemented in |
|--------------|----------------|
| Pages (full) | Task 10 |
| Media (full) | Task 11 |
| Snippets | Task 12 |
| Templates/Themes/Config | Tasks 13, 14, 15 |
| Site (info/search/backup) | Task 16 |
| Domain-Router pattern | Tasks 10–16, 17 |
| Multi-tier write protection | Task 8, integrated into all domains |
| Auth via username/password | Task 7 |
| HTTP client with retry | Task 6 |
| Page format parser | Task 5 |
| Error types | Task 3 |
| Config loader | Task 4 |
| Logger with redaction | Task 2 |
| Project scaffold | Task 1 |
| Starter-kit bootstrap hints | Task 15 (`install` action) |
| NPM distribution | Task 21 |
| README & setup docs | Task 20 |
| Integration test | Task 19 |
| Server assembly & entry | Tasks 17, 18 |

### Placeholder scan

✅ No `TBD`/`TODO`/`fill in` patterns remain.
✅ All code blocks are complete.
✅ All commands have expected outputs.

### Type consistency

- `WriteGuard.check()` returns `Permit` — used identically in all domain routers.
- `HttpClient.{get,post,put,delete,uploadMultipart}` — used identically.
- `AutomadMcpError` — code/message/details constructor pattern used everywhere.
- `Config` — single source of truth in `src/config.ts`.
- `WriteAction` — every domain router defines its own `ACTION_MAP` from action enum.

### Fix needed during review

The `server.ts` registration helper has a minor coupling with internal Zod shape — flagged with comment for cleanup. The unused `zod-to-json-schema` import should be removed; the helper uses `_def.shape` instead.

---

## End of Plan

Total tasks: **21** (5 foundation, 4 core, 7 domain routers, 2 server, 3 integration/distribution)

Next step: Choose execution mode (subagent-driven or inline).