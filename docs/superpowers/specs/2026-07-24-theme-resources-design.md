# Theme Resources

**Date:** 2026-07-24
**Status:** Draft for user review

## Goal

Expose read-only theme information through MCP Resources so clients can list themes and read normalized theme schemas without calling `automad_theme` actions. Resources reuse `ThemeAnalyzer` and `ThemeSchemaBuilder` directly and never write files or perform network requests.

## Scope

In scope:

- Add a `ResourceTemplate` for `automad://themes/{slug}/schema`.
- Add a `ResourceTemplate` for `automad://themes`.
- Register both templates with `McpServer.registerResource` after `validateCapabilityRegistry()` and after existing tool registrations.
- Enable `resources: { listChanged: false }` on the `McpServer` capabilities.
- Reject invalid slugs with `NOT_FOUND`; never raise validation errors directly from resources.
- Document the resources in `README.md` and add tests for handler, listing, and server capabilities.

Out of scope:

- New MCP tools, prompts, authentication, audit logging, HTTP transport, rate limiting.
- File writing, scaffolding, building, or fixing themes.
- Mutating `themesPath` configuration.
- Site, config, page, or media resources; future phases may add them.
- Browser, Docker, npm, Composer, Git, PHP, JavaScript, network, or environment changes.

## Architecture

Resources remain thin wrappers around existing analyzers and builders:

```text
MCP client
  -> resources/read
  -> ResourceTemplate dispatcher
  -> ThemeManager.list() or ThemeAnalyzer.analyze() + ThemeSchemaBuilder.build()
  -> JSON response
```

The resource dispatcher performs no I/O of its own, no HTTP calls, no writes, and no caching beyond the existing analyzer and builder outputs.

## URI Scheme

Use the stable `automad://` scheme. The two template URIs are:

```text
automad://themes
automad://themes/{slug}/schema
```

`{slug}` must match `^[a-z0-9._-]+$`. Any other value, including empty or with `..` or `/`, is rejected with `NOT_FOUND`. `automad://themes` is independent of slug validation and never rejects the request shape.

## Resource Payloads

`automad://themes` returns:

```json
{
  "themesPath": "/themes",
  "themes": [
    {
      "slug": "starter",
      "name": "Starter",
      "path": "/themes/starter",
      "manifest": { "name": "Starter", "version": "0.1.0", "author": "Marc" }
    }
  ]
}
```

When `AUTOMAD_THEMES_PATH` is unset, `themes` is `[]` and `themesPath` is `null`.

`automad://themes/{slug}/schema` returns the existing `ThemeSchema` JSON, exactly as the `automad_theme.schema` action would. The result is never reduced or transformed.

`MIME` is `application/json` for both templates.

## Error Behavior

- missing theme -> `NOT_FOUND`;
- invalid slug -> `NOT_FOUND` (no leak of validator errors);
- `AUTOMAD_THEMES_PATH` unset for `themes/{slug}/schema` -> `NOT_FOUND`;
- `AUTOMAD_THEMES_PATH` unset for `themes` -> empty list with `themesPath: null`;
- invalid `theme.json` for `themes/{slug}/schema` -> `ThemeSchema` with available fields plus projected warnings;
- no other errors are user-visible.

## Capability Flag

Switch the `McpServer` capabilities to:

```ts
{ capabilities: { resources: { listChanged: false }, tools: { listChanged: false } } }
```

Resource listing is therefore static for the lifetime of the server process. No notifications, no `sendResourceListChanged` calls, no caching beyond the analyzer.

## Capability Registry

No new action is added. `resources` is not part of the action registry. Document the absence explicitly in the registry spec test to prevent regressions.

## Testing

Add `tests/unit/resources.test.ts` covering:

- `automad://themes` payload shape and empty result when unset;
- `automad://themes/{slug}/schema` returns the schema from `ThemeSchemaBuilder`;
- `automad://themes/{slug}/schema` with `..` or `/` rejects with `NOT_FOUND`;
- `automad://themes/missing/schema` rejects with `NOT_FOUND`;
- server `capabilities` include `resources: { listChanged: false }`;
- existing six-tool registration remains intact.

Update `tests/unit/server.test.ts` to assert `resources: { listChanged: false }` and the unchanged tool set.

Run:

```bash
npm run build
npm test -- tests/unit/resources.test.ts tests/unit/server.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

No Docker, Automad instance, credentials, or network is required.

## Documentation

Update `README.md` with:

- list of MCP resources;
- URI scheme `automad://`;
- read-only guarantee;
- reuse of `automad_theme.schema` output;
- no new MCP tool or auth/audit/HTTP changes.

## Future Extension Points

Additional resources can be added without breaking this contract:

```text
automad://site/info
automad://site/config
automad://themes/{slug}/analysis
automad://themes/{slug}/validation
```

Each must be backed by an existing pure function. None are part of this phase.
