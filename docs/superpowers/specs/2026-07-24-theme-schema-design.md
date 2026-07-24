# Theme Schema Blueprint Equivalent

**Date:** 2026-07-24
**Status:** Draft for user review

## Goal

Add a normalized, read-only theme schema contract and expose it through `automad_theme` action `schema`. The schema projects existing `ThemeAnalysis` data into a stable field model suitable for later MCP Resources, scoped permissions, code generation, and theme tooling.

## Scope

In scope:

- Add `automad_theme.schema` as a read-only action.
- Add an internal `ThemeSchemaBuilder` that consumes `ThemeAnalysis` rather than rescanning the filesystem.
- Normalize fields, types, scope, labels, options, tooltips, order, and source files.
- Preserve analyzer warnings and add schema-specific warnings.
- Extend the capability registry with `theme.schema` metadata.
- Add focused unit/domain/registry tests and documentation.

Out of scope:

- MCP Resources or Prompts.
- Writing or generating `theme.json`.
- TypeScript/PHP type generation.
- Automatic fixes.
- Build, Docker, browser, Git, npm, Composer, PHP, or JavaScript execution.
- New authentication, tokens, audit logs, HTTP transport, or rate limiting.

## Architecture

Use the existing analyzer as the only file and field inventory source:

```text
automad_theme.schema
  -> ThemeAnalyzer.analyze(theme)
  -> ThemeSchemaBuilder.build(analysis)
  -> normalized ThemeSchema
```

`ThemeSchemaBuilder` is pure and performs no I/O. It may parse metadata already present in `analysis.manifests.theme`, but it must not access the filesystem, environment, network, or process APIs.

Create `src/theme/schema.ts`. Keep schema normalization separate from `src/theme/analyzer.ts` so the analyzer remains responsible for discovery/validation and later consumers can build schemas from cached analyses.

## Public MCP Contract

Extend `themeInput.action` with `schema`.

Example:

```json
{
  "action": "schema",
  "theme": "my-theme"
}
```

The action requires `theme`, is read-only in every write mode, never requires a confirmation token, and returns a JSON-serializable `ThemeSchema`.

## Types

```ts
export type ThemeFieldType =
  | "text"
  | "checkbox"
  | "color"
  | "image"
  | "icon"
  | "select"
  | "url"
  | "format"
  | "label"
  | "filter"
  | "block";

export type ThemeFieldScope = "page" | "shared" | "unmasked";

export interface ThemeSchemaWarning {
  code: string;
  message: string;
  field?: string;
}

export interface ThemeSchemaField {
  name: string;
  type: ThemeFieldType;
  scope: ThemeFieldScope;
  source: string[];
  label?: string;
  options?: Record<string, string>;
  tooltip?: string;
  order?: number;
}

export interface ThemeSchema {
  theme: string;
  path: string;
  fields: ThemeSchemaField[];
  masks: { page: string[]; shared: string[] };
  templates: string[];
  blocks: string[];
  warnings: ThemeSchemaWarning[];
}

export class ThemeSchemaBuilder {
  build(analysis: ThemeAnalysis): ThemeSchema;
}
```

## Field Type Rules

Map exact prefixes in this order:

```text
+        -> block
checkbox -> checkbox
color    -> color
image    -> image
icon     -> icon
select   -> select
text     -> text
url      -> url
format   -> format
label    -> label
filter   -> filter
```

A prefix only matches when the field contains additional characters after it, except `+`, which requires at least one character after the plus sign.

Fields without a recognized prefix are classified as `text` and add:

```json
{
  "code": "UNKNOWN_FIELD_PREFIX",
  "message": "Field 'brand' has no recognized Automad field prefix; defaulting to text",
  "field": "brand"
}
```

Do not warn for Automad system variables because the analyzer excludes them.

## Field Sources

The existing analyzer currently returns unique field names but not source locations. Extend `ThemeAnalysis` with:

```ts
fieldSources: Record<string, string[]>;
```

During analyzer scanning, record each normalized relative path containing a field. A field appearing more than once in the same file is listed once. Sources are sorted alphabetically.

`fields` and `blockFields` remain for backward compatibility.

## Scope Rules

Determine scope in this order:

1. field in `masks.shared` -> `shared`;
2. field in `masks.page` -> `page`;
3. otherwise -> `unmasked`.

If a field appears in both masks, prefer `shared` and add:

```text
FIELD_SCOPE_CONFLICT
```

Block fields follow the same scope rules; an unmasked block remains `unmasked` and is not treated as an error.

## Manifest Metadata

Read metadata from the parsed `theme.json` object already held in `analysis.manifests.theme`:

- `labels[field]` -> `label` when a string;
- `options[field]` -> `options` when it is an object whose values are strings;
- `tooltips[field]` -> `tooltip` when a string;
- `fieldOrder` index -> zero-based `order`.

Malformed metadata does not throw. It produces one warning per affected field or metadata section:

```text
INVALID_FIELD_LABEL
INVALID_FIELD_OPTIONS
INVALID_FIELD_TOOLTIP
INVALID_FIELD_ORDER
```

## Ordering

Sort schema fields by:

1. valid `fieldOrder` index ascending;
2. fields without an order alphabetically by name.

If `fieldOrder` repeats a field, use its first index and add `DUPLICATE_FIELD_ORDER`.

## Warning Projection

Project analyzer issues into schema warnings using their existing `code` and `message`. Preserve `field` only for schema-specific field warnings. Do not expose analyzer severity in `ThemeSchemaWarning`; schema consumers need actionable warnings, while full severity remains available through `validate`.

Warnings must have stable ordering by `code`, then `field`, then `message`.

## Capability Registry and WriteGuard

Add `schema` to:

- `themeInput.action`;
- `WriteAction` as `theme.schema`;
- `READ_ACTIONS`;
- `CAPABILITY_REGISTRY.automad_theme.actions` with `readOnly: true`, `destructive: false`;
- the registry expected action map.

Existing action behavior remains unchanged.

## Domain Integration

In `handleTheme`, instantiate `ThemeSchemaBuilder` and add:

```ts
case "schema": {
  if (!input.theme) {
    throw new AutomadMcpError("VALIDATION", "theme is required for schema");
  }
  const analysis = await analyzer.analyze(input.theme);
  return schemaBuilder.build(analysis);
}
```

No additional HTTP client call is allowed.

## Error Behavior

- missing theme -> existing `NOT_FOUND` from `ThemeAnalyzer`;
- missing `theme` argument -> `VALIDATION`;
- invalid `theme.json` -> return available schema data and projected warning;
- no recognized fields -> return an empty `fields` array;
- no build, network, or mutation side effects.

## Testing

Create `tests/unit/theme-schema.test.ts` covering:

- all recognized prefix mappings;
- unknown prefix defaults to `text` with warning;
- page/shared/unmasked scopes;
- shared wins mask conflict and emits warning;
- labels/options/tooltips/order projection;
- invalid metadata warnings;
- duplicate `fieldOrder` handling;
- stable field and warning ordering;
- analyzer field-source collection and deduplication.

Update:

- analyzer tests for `fieldSources`;
- schema tests for `schema` action parsing;
- write-guard tests proving `theme.schema` is read-only;
- capability registry tests for exact action coverage;
- domain tests proving `schema` uses local analysis and no HTTP client method.

Run:

```bash
npm run build
npm test -- tests/unit/theme-schema.test.ts tests/unit/theme-analyzer.test.ts tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

No Docker, Automad instance, credentials, or network is required.

## Future Resource Reuse

A later Resource phase can expose:

```text
automad://theme/{theme}/schema
```

by calling the same `ThemeAnalyzer` and `ThemeSchemaBuilder`. That Resource is explicitly not implemented in this phase.
