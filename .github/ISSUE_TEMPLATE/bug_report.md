---
name: Bug report
about: Something in the MCP server does not do what the docs say it does
title: "bug: <one-line summary>"
labels: ["bug"]
---

## What happened

<!-- A factual description, not a theory. -->

## What I expected

<!-- The behavior the docs / schema / your reading of the code predicted. -->

## Reproduction

```ts
// The tool call that triggered it (input only — redact secrets).
{ "tool": "automad_pages", "action": "update", "url": "...", ... }
```

## Environment

- `automad-mcp-server` version: <!-- `npm list -g automad-mcp-server` -->
- Automad version: <!-- `2.0.0-beta.51` or whatever -->
- Mode: `full` or `docs`
- Node.js: <!-- `node --version` -->
- OS:

## Logs

```text
<!-- Pino output, paste the relevant lines (the logger redacts credentials). -->
```

## Notes

<!-- Anything else: minimal theme, a public URL we can hit, a branch that demonstrates it. -->
