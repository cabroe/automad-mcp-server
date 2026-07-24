# Automad MCP Server — Design Spec

**Date:** 2026-07-24
**Status:** Draft (pending review)
**Author:** Brainstorming session

## Goal

Build a comprehensive Model Context Protocol (MCP) server for the [Automad CMS](https://automad.org) that enables AI assistants to perform full site management and theme/template development via natural language — covering Pages, Media, Snippets, Templates, Themes, and Config.

The server follows established patterns from existing CMS-MCP implementations (WordPress, Craft, Statamic) while accounting for Automad's unique flat-file, PHP-based architecture.

## Non-Goals (V1)

- Real-time collaborative editing
- Direct database-style queries (Automad has no DB)
- Image processing / transformation
- Plugin/extension system
- Multi-tenant hosting layer
- Frontend rendering concerns

## Decisions (from brainstorming)

| Topic | Decision |
|-------|----------|
| Primary use case | Full site management + theme/template development |
| Tech stack | TypeScript + Node.js (≥20) |
| Access strategy | HTTP bridge to Automad dashboard |
| Authentication | Username + password (with optional token) |
| Distribution | NPM package |
| Scope | Pages (full), Media (full), Snippets, Templates/Themes/Config |
| Reference | Best practices from [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit) |
| Safety model | Multi-tier write protection (`read-only` / `confirm-destructive` / `unrestricted`) |
| Architecture | Domain-Router pattern (one tool per domain, action as parameter) |

## Architecture

```
┌──────────────────────┐
│ MCP Host (Claude)    │
└──────────┬───────────┘
           │ stdio (NPM)
┌──────────▼─────────────────────────┐
│ Automad MCP Server (Node.js)       │
│  • TypeScript SDK                  │
│  • Zod Input-Validierung           │
│  • Multi-Tier Write-Protection     │
│  • Session-Manager                 │
│  • Domain-Router                   │
└──────────┬──────────────────────────┘
           │ HTTPS + Session-Cookie
┌──────────▼─────────────────────────┐
│ Automad Dashboard (PHP, ≥8.3)      │
│  • /dashboard Login (POST)         │
│  • AJAX-Endpoints für CRUD         │
└──────────┬──────────────────────────┘
           │ Filesystem
┌──────────▼─────────────────────────┐
│ Automad Site (pages/, shared/, …)  │
└────────────────────────────────────┘
```

### Components

| Module | Responsibility |
|--------|----------------|
| `src/index.ts` | Entry point, MCP server bootstrap |
| `src/server.ts` | Server setup, tool registration |
| `src/config.ts` | Env loading, write-mode configuration |
| `src/auth.ts` | Dashboard login, session-cookie management |
| `src/client.ts` | HTTP client wrapper with retry/auth |
| `src/errors.ts` | Typed errors (Auth, Forbidden, NotFound, Validation, etc.) |
| `src/logger.ts` | Structured logging (pino) |
| `src/write-guard.ts` | Multi-tier write protection with confirm-token flow |
| `src/schemas.ts` | Zod schemas for action parameters |
| `src/page-format.ts` | Parse/serialize Automad page format (YAML-vars + Editor.js blocks) |
| `src/domains/pages.ts` | `automad_pages` domain router |
| `src/domains/media.ts` | `automad_media` domain router |
| `src/domains/snippets.ts` | `automad_snippets` domain router |
| `src/domains/templates.ts` | `automad_templates` domain router |
| `src/domains/config.ts` | `automad_config` domain router |
| `src/domains/theme.ts` | `automad_theme` domain router |
| `src/domains/site.ts` | `automad_site` domain router |

## Tools (Domain-Router)

Each tool takes an `action` enum parameter and dispatches internally.

### `automad_pages`

Actions: `list`, `get`, `create`, `update`, `delete`, `move`, `duplicate`

```typescript
{
  action: "list" | "get" | "create" | "update" | "delete" | "move" | "duplicate",
  path?: string,                    // e.g. "/blog/2026/post"
  data?: {
    title?: string,
    variables?: Record<string, unknown>,
    blocks?: EditorJsBlock[],       // Editor.js JSON blocks
  },
  target_path?: string,             // for move/duplicate
  recursive?: boolean,              // for delete
}
```

### `automad_media`

Actions: `list`, `get`, `upload`, `delete`, `rename`

```typescript
{
  action: "list" | "get" | "upload" | "delete" | "rename",
  path?: string,                    // e.g. "/shared/images/hero.jpg"
  source?: string | { base64: string, mimeType: string, filename: string },
  new_name?: string,
}
```

### `automad_snippets`

Actions: `list`, `get`, `set`, `delete`

```typescript
{
  action: "list" | "get" | "set" | "delete",
  name?: string,                    // e.g. "footer-cta"
  scope?: "global" | "local",       // /shared/ vs /pages/snippets/
  data?: { variables?: ..., blocks?: ... },
}
```

### `automad_templates`

Actions: `list`, `get`, `set`, `delete`, `validate`

```typescript
{
  action: "list" | "get" | "set" | "delete" | "validate",
  path?: string,                    // e.g. "/packages/starter/template.php"
  content?: string,                 // for set
}
```

### `automad_config`

Actions: `get`, `set`, `validate`

```typescript
{
  action: "get" | "set" | "validate",
  key?: string,                     // nested key with dot-notation
  value?: unknown,
}
```

### `automad_theme`

Actions: `list`, `install`, `activate`, `uninstall`

```typescript
{
  action: "list" | "install" | "activate" | "uninstall",
  source?: string,                  // for install: Git URL or local path
  theme?: string,                   // theme package name
}
```

### `automad_site`

Actions: `info`, `search`, `backup`, `restore`

```typescript
{
  action: "info" | "search" | "backup" | "restore",
  query?: string,                   // for search
  backup_path?: string,
}
```

## Page-Format

Automad pages combine three sections:

1. **Variables** (YAML) — `title: Home`, `theme: starter`, `tags: [a, b]`
2. **Markers** — `-` separates sections, `+name:` opens a block
3. **Blocks** (Editor.js JSON) — `+hero: { type: "hero", data: {...} }`

`src/page-format.ts` parses this format into structured objects and serializes back. The LLM works only with structured data; it never sees raw page-file syntax.

## Auth & HTTP Bridge

### Auth Flow

```
1. Server-Start liest ENV:
   AUTOMAD_URL=https://blog.example.com
   AUTOMAD_USER=admin
   AUTOMAD_PASS=•••••••
   AUTOMAD_WRITE_MODE=confirm-destructive (default)

2. Bei erstem Request:
   POST {URL}/dashboard → Login → Session-Cookie
   Cookie in Memory (kein Disk-Storage)

3. Pro Request:
   Cookie wird mitgesendet
   Bei 401 → automatischer Re-Login (1× Retry)
   Bei erneutem 401 → AuthError

4. Optional: Token statt Passwort
   ENV AUTOMAD_TOKEN=•••• (AM_AUTH_TOKEN)
   Wird im Header statt Login gesendet (wenn unterstützt)
```

### HTTP-Bridge Strategy

Since Automad has no official REST API, we reverse-engineer the dashboard AJAX endpoints:

1. **Discovery Phase** (one-time, documented): Scan Automad GitHub source → document endpoints
2. **Mapping Table** in `src/client.ts`:
   ```
   pages.list      → GET    /dashboard/api/pages
   pages.get       → GET    /dashboard/api/pages/{path}
   pages.create    → POST   /dashboard/api/pages
   pages.update    → PUT    /dashboard/api/pages/{path}
   pages.delete    → DELETE /dashboard/api/pages/{path}
   media.upload    → POST   /dashboard/api/media
   config.get      → GET    /dashboard/api/config
   ...
   ```
3. **Fallback**: When an endpoint is missing → use headless endpoint (read) or PHP CLI helper (write)

## Safety Model — Multi-Tier Write Protection

Three modes, configurable via `AUTOMAD_WRITE_MODE`:

- `read-only` — only non-mutating actions allowed
- `confirm-destructive` (default) — non-destructive writes allowed directly; destructive writes require user confirmation
- `unrestricted` — all actions allowed

### Confirm-Token Flow

```typescript
type Permit =
  | { allowed: true }
  | { allowed: "pending"; confirmToken: string; preview: unknown; expiresAt: string }
  | { allowed: false; reason: string };
```

1. LLM calls destructive action (e.g. `pages.delete`)
2. Server returns `pending` + `confirmToken` (UUID, 5 min TTL)
3. LLM presents confirmation to user
4. User confirms → LLM re-calls with `confirmToken` → write executes

### Action → Mode Mapping

| Action | read-only | confirm-destructive | unrestricted |
|--------|-----------|---------------------|--------------|
| `pages.list` / `.get` | ✓ | ✓ | ✓ |
| `pages.create` / `.update` | ✗ | ✓ | ✓ |
| `pages.delete` / `.move` | ✗ | pending → confirm | ✓ |
| `media.upload` / `.delete` | ✗ | pending → confirm | ✓ |
| `config.set` | ✗ | pending → confirm | ✓ |
| `theme.activate` / `.uninstall` | ✗ | pending → confirm | ✓ |

## Error Handling

```typescript
class AutomadMcpError extends Error {
  constructor(
    public code:
      | "AUTH" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"
      | "CONFLICT" | "NETWORK" | "RATE_LIMITED" | "UNKNOWN",
    message: string,
    public details?: unknown,
  );
}
```

- Structured errors in MCP response (no silent failures)
- Retry with exponential backoff for transient errors (5xx, timeout)
- Circuit breaker for repeated auth failures (prevents lockout)
- All errors logged with context (request id, action, params)

## Testing Strategy

Three layers:

### Unit Tests (Vitest)

- Domain router with mocked HTTP client
- Page-format parser/serializer (round-trip)
- Write-guard state machine
- Zod schema validation
- Error-mapping logic

### Integration Tests

- Docker Compose: Automad + MCP server
- End-to-end for each tool
- Snapshot tests for page generation
- Confirm-token flow

### Smoke Tests (CI)

- Server starts
- `automad_site.info` responds
- All tools registered

**Coverage target:** ≥80% statements, ≥70% branches.

## Distribution

### NPM Package

```json
{
  "name": "@automadcms/mcp-server",
  "bin": { "automad-mcp": "./dist/index.js" },
  "main": "./dist/index.js",
  "type": "module",
  "engines": { "node": ">=20" },
  "files": ["dist", "README.md", "LICENSE"]
}
```

### Setup Examples in README

- Claude Desktop
- Cursor
- Cline
- Zed

### Sample Configuration

```json
{
  "mcpServers": {
    "automad": {
      "command": "npx",
      "args": ["-y", "@automadcms/mcp-server"],
      "env": {
        "AUTOMAD_URL": "https://blog.example.com",
        "AUTOMAD_USER": "admin",
        "AUTOMAD_PASS": "•••",
        "AUTOMAD_WRITE_MODE": "confirm-destructive"
      }
    }
  }
}
```

## Project Bootstrap (from starter-kit)

When the MCP server's `automad_theme.install` action is called with a "create-new-theme" flag, or when a new Automad project is being set up locally, the following workflow applies (per [automad-theme-starter-kit](https://github.com/automadcms/automad-theme-starter-kit)):

1. **Use the GitHub template**: Click "Use this template" on the starter-kit repo to create a new theme repo.
2. **Install Automad via Composer**:
   ```bash
   composer global require automad/automad
   # or local: composer require automad/automad
   ```
3. **Clone the theme into Automad packages directory**:
   ```bash
   git clone <your-theme-repo> /path/to/automad/packages/<namespace>/<theme>
   ```
4. **Create `.env`** from template and set `AUTOMAD_BASE`:
   ```bash
   cp .env.example .env
   # Edit .env: AUTOMAD_BASE=/path/to/automad
   ```
5. **Install npm dependencies**:
   ```bash
   npm install
   ```
6. **Start dev server**:
   ```bash
   npm run dev
   ```
   Automad opens automatically in the default browser.
7. **Update package metadata** in `composer.json` and `theme.json` (name, description, vendor info) so the theme is installable.
8. **Inside Automad**: create a new page and apply one of the included templates.

The MCP server wraps this workflow in a guided sequence of `automad_theme` + shell commands, prompting the user at each decision point.

## Code-Quality Conventions (from starter-kit best practices)

- **TypeScript strict mode** — no `any`, `strict: true`
- **ESLint + Prettier** — standard configs
- **Zod** for runtime validation (inputs + API responses)
- **Pino** for structured logging
- **Vitest** for tests
- **Conventional Commits** + semantic versioning
- Pure functions where possible; explicit dependency injection
- Errors carry context; no swallowed exceptions

## Roadmap

### V1 (MVP, 2–3 weeks)

- Pages CRUD (no move/duplicate)
- Media list + upload
- Snippets CRUD
- Templates read
- Config read
- Multi-tier write protection
- NPM distribution
- README + setup examples

### V1.1

- Page move/duplicate
- Media rename/delete
- Templates write
- Config write
- Theme operations
- Bootstrap-from-starter-kit workflow

### V2

- Bulk operations (create-many, update-many)
- Site search (full-text)
- Backup/restore
- Observability hooks (stats, audit log)
- Plugin system for custom domains

## Open Questions

- Rate limiting: Automad dashboard has its own limits; we just proxy
- Streaming for large pages (>1MB): consider resource streams in V2
- i18n / multilingual pages: Automad handles locale natively via per-page locale directories; full mapping deferred to V2+
- Multi-site support: configurable in V1.1+
- Confirm token storage: in-memory only (single instance) vs. file-backed

## References

- [Automad CMS](https://automad.org)
- [Automad on GitHub](https://github.com/marcantondahmen/automad)
- [Automad Headless Mode](https://automad.org/headless-mode/)
- [Automad Theme Starter Kit](https://github.com/automadcms/automad-theme-starter-kit)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [WordPress MCP Adapter](https://github.com/wordpress/mcp-adapter)
- [Craft CMS MCP](https://github.com/craftcms/mcp)
- [Statamic MCP](https://github.com/cboxdk/statamic-mcp) — domain-router pattern reference