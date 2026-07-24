# @automadcms/mcp-server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants manage an [Automad CMS](https://automad.org) site — pages, media, snippets, templates, config, themes, and site-level actions — over stdio.

> **Status:** alpha — functional but not yet published to npm. Automad has no official API, so dashboard endpoints are reverse-engineered; verify against your instance.

Automad has no official REST API, so this server acts as an **HTTP bridge** to the Automad dashboard's AJAX endpoints, authenticating with a dashboard username and password (session cookie).

## Requirements

- Node.js ≥ 20
- A running Automad installation with dashboard access

## Install

Not yet published to npm — build from source:

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
| `AUTOMAD_URL` | yes | — | Base URL of the Automad site, e.g. `https://blog.example.com` |
| `AUTOMAD_USER` | yes | — | Dashboard username |
| `AUTOMAD_PASS` | one of PASS/TOKEN | — | Dashboard password |
| `AUTOMAD_TOKEN` | one of PASS/TOKEN | — | Experimental static token; header format not yet verified against Automad — prefer `AUTOMAD_PASS` |
| `AUTOMAD_WRITE_MODE` | no | `confirm-destructive` | `read-only` \| `confirm-destructive` \| `unrestricted` |
| `LOG_LEVEL` | no | `info` | Pino log level |

## Write protection

Three modes, set via `AUTOMAD_WRITE_MODE`:

- **`read-only`** — only non-mutating actions (`list`, `get`, `info`, `search`, `validate`).
- **`confirm-destructive`** *(default)* — ordinary writes run directly; destructive writes (delete, move, restore, uninstall, `config.set`) return a `confirmToken` (5-min TTL). Replay the same call with `confirm_token` to execute.
- **`unrestricted`** — everything runs immediately.

## Tools

The server exposes seven tools. Each takes an `action` parameter and dispatches internally (domain-router pattern).

| Tool | Actions |
|---|---|
| `automad_pages` | `list` `get` `create` `update` `delete` `move` `duplicate` |
| `automad_media` | `list` `get` `upload` `delete` `rename` |
| `automad_snippets` | `list` `get` `set` `delete` |
| `automad_templates` | `list` `get` `set` `delete` `validate` |
| `automad_config` | `get` `set` `validate` |
| `automad_theme` | `list` `install` `activate` `uninstall` |
| `automad_site` | `info` `search` `backup` `restore` |

### Example: confirm-token flow

```jsonc
// 1. destructive call → returns a pending token (nothing deleted yet)
{ "action": "delete", "path": "/blog/old-post" }
// → { "allowed": "pending", "confirmToken": "a1b2…", "expiresAt": "…" }

// 2. replay with the token → executes
{ "action": "delete", "path": "/blog/old-post", "confirm_token": "a1b2…" }
// → { "ok": true }
```

## Host setup

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "automad": {
      "command": "node",
      "args": ["/absolute/path/to/automad-mcp-server/dist/index.js"],
      "env": {
        "AUTOMAD_URL": "https://blog.example.com",
        "AUTOMAD_USER": "admin",
        "AUTOMAD_PASS": "your-password",
        "AUTOMAD_WRITE_MODE": "confirm-destructive"
      }
    }
  }
}
```

### Cursor / Cline / Zed

Point the MCP server `command` at the built `dist/index.js` (run `npm run build` first) and provide the same environment variables.

## Development

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm run test:coverage
npm run dev         # tsx src/index.ts
```

Project layout:

```
src/
  index.ts          entry point — config, stdio transport, graceful shutdown
  server.ts         McpServer + 7 tool registrations
  config.ts         env loader + write-mode validation
  auth.ts           dashboard login + session-cookie manager
  client.ts         HTTP client: retry, auth, status→error mapping
  errors.ts         typed AutomadMcpError
  logger.ts         pino logger with credential redaction
  write-guard.ts    multi-tier write protection + confirm-token flow
  schemas.ts        Zod input schemas for all tools
  page-format.ts    parse/serialize Automad page format (vars + Editor.js blocks)
  domains/          one router per domain (pages, media, snippets, ...)
```

## License

[MIT](./LICENSE)
