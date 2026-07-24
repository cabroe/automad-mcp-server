# Starter-Kit Theme i18n Schema

**Date:** 2026-07-24
**Status:** Draft for user review

## Goal

Extend the normalized theme schema with all dashboard metadata translations found in Starter-Kit-style `i18n/<locale>.json` files, while preserving `theme.json` as the fallback source and keeping `ThemeSchemaBuilder` pure.

## Starter-Kit Contract

The official Starter Kit stores dashboard field metadata translations in files such as `i18n/de.json`:

```json
{
  "labels": {
    "brand": "Branding Logo (SVG, HTML oder Text)"
  },
  "options": {
    "selectColorTheme": {
      "light": "Hell",
      "dark": "Dunkel"
    }
  },
  "tooltips": {
    "+main": "Der Haupt-Inhalt"
  }
}
```

These files translate dashboard labels, select options, and tooltips. They do not translate page content. Missing translated entries fall back to their corresponding values in `theme.json`; a missing locale file means the dashboard uses `theme.json` entirely.

## Scope

In scope:

- Parse all valid `i18n/*.json` files during `ThemeAnalyzer.analyze`.
- Preserve their normalized relative paths and locale names.
- Extend `ThemeSchema` with sorted locales and per-field translation overrides.
- Normalize valid partial data even when another value in the same locale is invalid.
- Add stable warnings for invalid sections/values and unknown translated fields.
- Add analyzer, builder, schema-action, and documentation tests.

Out of scope:

- Page-content translation, per-tree/per-field content localization, or `:language` routing.
- Choosing one locale at server runtime.
- Duplicating fallback values from `theme.json` into each locale override.
- Writing, generating, or fixing i18n files.
- A separate MCP action or Resource.
- Build, Docker, browser, Git, npm, Composer, PHP, JavaScript, network, authentication, audit, or HTTP changes.

## Architecture

Keep filesystem access in the analyzer and normalization in the pure builder:

```text
ThemeAnalyzer
  -> discover i18n/*.json
  -> parse JSON objects
  -> ThemeAnalysis.translations

ThemeSchemaBuilder
  -> normalize translations
  -> validate sections and field values
  -> ThemeSchema.locales + ThemeSchema.translations
```

The schema builder must not read files or environment state.

## Analysis Contract

Extend `ThemeAnalysis`:

```ts
export interface ThemeTranslationSource {
  locale: string;
  path: string;
  data: Record<string, unknown>;
}

export interface ThemeAnalysis {
  // existing fields
  translations: Record<string, ThemeTranslationSource>;
}
```

Analyzer rules:

- consider only files directly matching `i18n/*.json`; nested paths such as `i18n/archive/de.json` remain inventory files but are not locale sources;
- locale is the basename without `.json`, preserved exactly (`de`, `de-DE`, `pt_BR`);
- locale and path keys are sorted deterministically;
- valid JSON objects are stored in `translations`;
- malformed JSON or a non-object root emits the existing `I18N_JSON_INVALID` issue and is omitted from `translations`;
- duplicate locale names are impossible on a case-sensitive filesystem but can occur across case-insensitive aliases or injected `ThemeFs`; retain the lexicographically first path and emit `DUPLICATE_I18N_LOCALE` for later duplicates.

## Schema Types

Extend `src/theme/schema.ts`:

```ts
export interface ThemeFieldTranslation {
  label?: string;
  options?: Record<string, string>;
  tooltip?: string;
}

export interface ThemeSchemaTranslation {
  locale: string;
  path: string;
  fields: Record<string, ThemeFieldTranslation>;
}

export interface ThemeSchema {
  // existing properties
  locales: string[];
  translations: Record<string, ThemeSchemaTranslation>;
}
```

Example:

```json
{
  "locales": ["de"],
  "translations": {
    "de": {
      "locale": "de",
      "path": "i18n/de.json",
      "fields": {
        "brand": {
          "label": "Branding Logo (SVG, HTML oder Text)"
        },
        "selectColorTheme": {
          "label": "Farbthema (hell/dunkel)",
          "options": {
            "light": "Hell",
            "dark": "Dunkel"
          }
        },
        "+main": {
          "tooltip": "Der Haupt-Inhalt"
        }
      }
    }
  }
}
```

## Normalization Rules

Only root sections `labels`, `options`, and `tooltips` are consumed. Unknown root sections are ignored without warnings to preserve forward compatibility.

### Labels

- valid shape: `labels[field]` is a string;
- valid values become `fields[field].label`;
- invalid values emit `INVALID_I18N_LABEL` with locale and field.

### Options

- valid shape: `options[field]` is a non-array object;
- each string option value is retained;
- invalid individual option values emit `INVALID_I18N_OPTIONS` but valid siblings remain;
- if no valid option remains, omit `options` for that field.

### Tooltips

- valid shape: `tooltips[field]` is a string;
- valid values become `fields[field].tooltip`;
- invalid values emit `INVALID_I18N_TOOLTIP` with locale and field.

### Invalid sections/root

- if `labels`, `options`, or `tooltips` exists but is not an object, emit the corresponding invalid warning without discarding other valid sections;
- a non-object JSON root is rejected by the analyzer as `I18N_JSON_INVALID` and never reaches the builder;
- `INVALID_I18N_ROOT` is reserved for manually supplied `ThemeAnalysis` data where `translations[locale].data` violates its declared object contract at runtime.

## Known Fields

A translated field is known when it appears in at least one of:

- `analysis.fields`;
- `theme.json.fieldOrder` string entries;
- base `theme.json.labels` keys;
- base `theme.json.options` keys;
- base `theme.json.tooltips` keys.

Unknown translated fields are preserved and emit `UNKNOWN_TRANSLATION_FIELD`. This allows the schema to represent metadata for fields not found by conservative template extraction.

## Fallback Semantics

Locale entries are sparse overrides. `ThemeSchema.fields` continues to hold base metadata from `theme.json`; `translations[locale].fields` contains only translated values present in the locale file.

A consumer resolves a locale by overlaying:

```text
theme.json base field metadata
  <- locale field overrides
```

The server does not duplicate or pre-resolve fallback values per locale.

## Ordering

- `locales` sorted by locale string;
- `translations` object inserted in locale sort order;
- field keys within each locale sorted alphabetically;
- option keys preserve their source object order;
- i18n warnings join existing schema warnings and use the existing stable sort: code, field, message.

Warning messages include locale context because `ThemeSchemaWarning` has no separate locale property, for example:

```text
Locale 'de': label for 'brand' must be a string
```

## Warning Codes

```text
I18N_JSON_INVALID          analyzer issue for invalid JSON/non-object root
DUPLICATE_I18N_LOCALE     analyzer issue for duplicate normalized locale
INVALID_I18N_ROOT         builder runtime guard
INVALID_I18N_LABEL        invalid labels section or field value
INVALID_I18N_OPTIONS      invalid options section, field object, or option value
INVALID_I18N_TOOLTIP      invalid tooltips section or field value
UNKNOWN_TRANSLATION_FIELD valid translated field absent from known-field sources
```

## Public MCP Contract

No new MCP action is added. Existing:

```json
{
  "action": "schema",
  "theme": "my-theme"
}
```

returns the extended i18n properties. `schema` remains read-only and uses no HTTP client call.

## Testing

Update analyzer tests to cover:

- valid `i18n/de.json` stored as translation source;
- locale/path extraction;
- invalid JSON omitted with `I18N_JSON_INVALID`;
- nested i18n JSON ignored as locale source;
- deterministic locale ordering.

Update schema tests to cover:

- Starter-Kit German labels/options/tooltips;
- sparse fallback representation;
- all locales returned and sorted;
- partial retention for invalid values;
- unknown translated fields preserved with warning;
- invalid sections and runtime root guard;
- stable field/warning ordering;
- builder input immutability.

Update domain test to assert `automad_theme.schema` returns locales/translations and still invokes no HTTP client method.

Run:

```bash
npm run build
npm test -- tests/unit/theme-analyzer.test.ts tests/unit/theme-schema.test.ts tests/unit/domains/theme.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

No Docker, Automad instance, credentials, or network is required.
