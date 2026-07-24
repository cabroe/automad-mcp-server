# Automad Starter-Kit Theme Analysis and Validation

**Date:** 2026-07-24
**Status:** Draft for user review

## Goal

Extend the Automad MCP server so its existing local theme tooling understands the structure and conventions of `automadcms/automad-theme-starter-kit`. The server will continue to scaffold, read, write, list, install, uninstall, activate, and build themes, and will additionally provide explicit offline analysis and validation actions.

## Scope

In scope:

- Add `analyze` and `validate` actions to `automad_theme`.
- Analyze an existing local theme under `AUTOMAD_THEMES_PATH`.
- Parse `theme.json`, optional `package.json`, optional `composer.json`, and `i18n/*.json`.
- Discover root templates, `components/`, `blocks/`, `client/`, `icons/`, `lib/`, build files, and generated assets.
- Extract Automad field references and distinguish block fields prefixed with `+`.
- Compare referenced fields with `theme.json` masks and metadata.
- Check metadata consistency across `theme.json`, `package.json`, and `composer.json`.
- Report deterministic findings without network access, mutation, or implicit builds.
- Keep existing theme actions and their behavior unchanged.

Out of scope:

- Embedding or cloning the upstream Starter Kit at runtime.
- A complete Automad template-language parser.
- Browser preview, Docker orchestration, or dev-server lifecycle management.
- Automatic analysis during `list`, `scaffold`, or `build`.
- Automatic fixes or rewriting theme files.

## Upstream Starter-Kit Conventions

The implementation is based on the current upstream repository structure and metadata:

- Root templates such as `default.php`, `pagelist.php`, and `page_not_found.php`.
- `components/` for reusable Automad template components.
- `blocks/` and `blocks/pagelist/` for block templates.
- `client/index.ts` and `client/styles/` for TypeScript/LESS sources.
- `icons/`, `i18n/`, and `lib/` directories.
- `theme.json` with `masks`, `fieldOrder`, `labels`, `options`, and `tooltips`.
- `package.json` with `build: node esbuild.js` and optional `dev: bash bin/dev.sh`.
- `esbuild.js` as the TypeScript/LESS/PostCSS build entry point.
- Optional `composer.json` metadata for package distribution.

The local `AUTOMAD_STARTER_KIT_PATH` remains the source for `scaffold`; analysis does not require that path.

## MCP API

Extend `themeInput.action` with:

```text
analyze | validate
```

Example:

```json
{
  "action": "validate",
  "theme": "my-theme"
}
```

Both actions require `theme` and are read-only under all write modes. They do not accept or require a confirmation token.

### Analyze result

`analyze` returns an inventory containing:

- theme slug and absolute path
- parsed manifests when valid
- discovered file groups and relative paths
- referenced Automad fields
- referenced block fields
- declared mask fields
- detected Starter-Kit markers
- non-fatal parsing or inventory issues

### Validate result

`validate` returns:

```json
{
  "ok": false,
  "theme": "my-theme",
  "findings": [
    {
      "severity": "error",
      "code": "THEME_MANIFEST_MISSING",
      "message": "theme.json is missing",
      "path": "theme.json"
    }
  ],
  "summary": {
    "errors": 1,
    "warnings": 0,
    "info": 0
  }
}
```

Finding severities are `error`, `warning`, and `info`. Findings may include `path` and a one-based `line` when the source location is available.

## Validation Rules

Errors:

- `THEME_MANIFEST_MISSING`: `theme.json` is absent.
- `THEME_MANIFEST_INVALID`: `theme.json` is not valid JSON or is not an object.
- `THEME_NAME_MISSING`: valid `theme.json` has no non-empty `name`.
- `THEME_TEMPLATE_MISSING`: no root-level `.php` template exists.
- `PACKAGE_JSON_INVALID`: present `package.json` is invalid JSON.
- `COMPOSER_JSON_INVALID`: present `composer.json` is invalid JSON.
- `I18N_JSON_INVALID`: an `i18n/*.json` file is invalid JSON.

Warnings:

- `PACKAGE_METADATA_MISMATCH`: package name, description, author, license, or version conflicts with `theme.json` where both values exist.
- `COMPOSER_METADATA_MISMATCH`: composer package metadata conflicts with `theme.json` where both values exist.
- `FIELD_NOT_MASKED`: a referenced editable field is absent from both `masks.page` and `masks.shared`.
- `MASK_FIELD_UNUSED`: a mask field is not referenced by discovered templates or declared as a known theme field.
- `STARTER_BUILD_INCOMPLETE`: one or more expected Starter-Kit build markers are absent from an otherwise Starter-Kit-like theme.
- `I18N_DIRECTORY_EMPTY`: `i18n/` exists but contains no JSON translations.

Informational findings:

- `STARTER_KIT_STRUCTURE_DETECTED`: recognized Starter-Kit directories/files are present.
- `BLOCK_FIELD_DETECTED`: a `+field` block area was found.
- `BUILD_SCRIPT_DETECTED`: a compatible `npm run build` script and `esbuild.js` were found.

The exact set of known Automad system fields is kept small and local to the analyzer so ordinary system variables such as `:title` are not reported as editable-field references. The analyzer must never interpret raw PHP as Automad field syntax or execute theme code.

## Architecture

Add `src/theme/analyzer.ts` with a focused `ThemeAnalyzer` or equivalent functional API. It receives a `ThemeFs` and `themesPath`, reuses `assertWithinRoot`, and returns typed inventory/report structures. It must not depend on `HttpClient` or network state.

Update:

- `src/schemas.ts`: add `analyze` and `validate` actions.
- `src/write-guard.ts`: add `theme.analyze` and `theme.validate` to read actions.
- `src/domains/theme.ts`: validate the theme argument and dispatch to the analyzer.
- `src/theme/manager.ts`: only if a small shared manifest type or path helper is needed; avoid broad refactoring.
- `tests/unit/theme-analyzer.test.ts`: analyzer behavior and rule coverage.
- `tests/unit/domains/theme.test.ts`: MCP-domain dispatch and read-only behavior.
- `README.md`: document actions, output shape, scope, and known limitations.

Use existing error classes and `ThemeFs` abstractions. Missing theme remains a `NOT_FOUND` tool error; malformed manifests are validation findings rather than thrown errors so a user can receive a complete report.

## Data Flow

```text
MCP automad_theme(analyze|validate)
  -> Zod input validation
  -> WriteGuard read permission
  -> ThemeAnalyzer local filesystem inventory
  -> typed inventory or finding report
  -> MCP JSON text result
```

No analysis action invokes `npm`, `composer`, Git, Automad HTTP APIs, or arbitrary PHP/JavaScript execution.

## Testing and Acceptance Criteria

- Existing tests remain green.
- Analyzer tests cover a valid Starter-Kit-shaped theme, missing/invalid manifests, missing templates, field and block extraction, masks, metadata mismatches, i18n JSON errors, and build markers.
- Domain tests prove `analyze` and `validate` work in `read-only` mode and do not produce confirmation tokens.
- `npm run build`, `npm test`, and `npm run lint` pass.
- A Docker-backed smoke test confirms a scaffolded or prepared theme can be analyzed through the real MCP stdio transport.
- No network access occurs during analysis/validation.
- Existing `automad_theme` actions remain backward compatible.

## Risks and Mitigations

- Automad syntax evolves: report only conservative, documented patterns and expose findings rather than rejecting unknown syntax.
- Theme files can be large: cap individual source reads and report truncation as a warning rather than allocating unbounded memory.
- Symlinks/path traversal: retain `ThemeFs` root checks for every requested theme and relative path.
- Metadata conventions vary: only report mismatches when both sides provide comparable non-empty values.
