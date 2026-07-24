# Starter-Kit Theme i18n Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `automad_theme.schema` with all Starter-Kit-style dashboard metadata translations from `i18n/<locale>.json`, preserving sparse fallback semantics and partial valid data.

**Architecture:** `ThemeAnalyzer` remains the sole filesystem reader and stores valid locale source objects in `ThemeAnalysis.translations`. The pure `ThemeSchemaBuilder` normalizes labels, options, and tooltips into sorted locale overrides and appends stable warnings. No new MCP action is added.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Vitest, existing `ThemeAnalyzer`, `ThemeSchemaBuilder`, `ThemeFs`, and `automad_theme.schema` action.

## Global Constraints

- i18n files translate dashboard field metadata only, not page content.
- Parse only direct `i18n/*.json` locale files; nested JSON remains inventory but is not a locale source.
- All locales are returned in one schema response; no locale request parameter.
- `theme.json` remains the base fallback; locale responses contain sparse overrides only.
- Valid partial values are retained when siblings or other sections are invalid.
- Unknown translated fields are retained with `UNKNOWN_TRANSLATION_FIELD`.
- `ThemeSchemaBuilder` remains pure and performs no I/O, environment, network, process, build, or mutation work.
- No new MCP action, Resource, Prompt, page-content localization, file generation, automatic fixes, auth, audit, HTTP, Docker, browser, Git, npm, Composer, PHP, or JavaScript execution.
- Existing schema, analyze, validate, and all other theme actions remain backward compatible.
- Tests require no Automad instance, Docker, network, credentials, or environment variables.

---

## File Map

- Modify `src/theme/analyzer.ts`: add translation source type/property and direct locale parsing.
- Modify `tests/unit/theme-analyzer.test.ts`: locale source, invalid/nested JSON, ordering tests.
- Modify `src/theme/schema.ts`: add translation output types and partial normalization.
- Modify `tests/unit/theme-schema.test.ts`: Starter-Kit de.json, fallback, partial invalid data, unknown fields, ordering, immutability.
- Modify `tests/unit/domains/theme.test.ts`: verify schema returns translations and no HTTP calls.
- Modify `README.md`: document Starter-Kit i18n shape and fallback semantics.

## Shared Interfaces

```ts
export interface ThemeTranslationSource {
  locale: string;
  path: string;
  data: Record<string, unknown>;
}

export interface ThemeAnalysis {
  // existing properties
  translations: Record<string, ThemeTranslationSource>;
}

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

---

### Task 1: Parse direct i18n locale sources in ThemeAnalyzer

**Files:**
- Modify `src/theme/analyzer.ts:7-75,104-139`
- Modify `tests/unit/theme-analyzer.test.ts:34-126`

**Interfaces:**
- Produces `ThemeTranslationSource` and `ThemeAnalysis.translations`.
- Preserves existing `files.i18n` and `I18N_JSON_INVALID` behavior.

- [ ] **Step 1: Write failing locale source tests**

Extend a valid theme fixture with:

```text
i18n/de.json

i18n/en.json

i18n/archive/fr.json
```

Use valid object contents for direct de/en files and nested fr. Assert:

```ts
expect(Object.keys(result.translations)).toEqual(["de", "en"]);
expect(result.translations.de).toEqual({
  locale: "de",
  path: "i18n/de.json",
  data: expect.objectContaining({ labels: expect.any(Object) }),
});
expect(result.translations.fr).toBeUndefined();
```

Add a theme with malformed `i18n/de.json` and assert it is omitted while `I18N_JSON_INVALID` remains in `issues`.

- [ ] **Step 2: Run focused analyzer tests and verify RED**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: failure because `translations` is absent.

- [ ] **Step 3: Implement analyzer translation storage**

Add the shared interface and `translations` property. Filter locale candidates with a direct-path expression equivalent to:

```ts
/^i18n\/[^/]+\.json$/
```

For each sorted path:

1. derive locale from the filename without `.json`;
2. parse via the existing JSON object reader;
3. skip invalid results after the reader emits `I18N_JSON_INVALID`;
4. store `{ locale, path, data }` in insertion-sorted object order;
5. if locale already exists, retain the first path and add `DUPLICATE_I18N_LOCALE`.

Avoid parsing direct locale files twice. Replace the current validation-only i18n loop with the storage loop.

- [ ] **Step 4: Run analyzer tests and build**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
npm run build
```

Expected: analyzer tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): retain i18n translation sources"
```

---

### Task 2: Normalize i18n overrides in ThemeSchemaBuilder

**Files:**
- Modify `src/theme/schema.ts:1-128`
- Modify `tests/unit/theme-schema.test.ts:1-150`

**Interfaces:**
- Consumes `analysis.translations`.
- Produces `ThemeSchema.locales` and `ThemeSchema.translations`.

- [ ] **Step 1: Write failing Starter-Kit German translation test**

Add `translations.de` matching the official Starter Kit shape:

```ts
{
  locale: "de",
  path: "i18n/de.json",
  data: {
    labels: {
      brand: "Branding Logo (SVG, HTML oder Text)",
      selectColorTheme: "Farbthema (hell/dunkel)",
    },
    options: {
      selectColorTheme: { switcher: "Theme-Switcher anzeigen", light: "Hell", dark: "Dunkel" },
    },
    tooltips: { "+main": "Der Haupt-Inhalt" },
  },
}
```

Assert exact sparse overrides, `locales: ["de"]`, locale/path preservation, and that missing translations do not duplicate base schema metadata.

- [ ] **Step 2: Run focused schema tests and verify RED**

Run:

```bash
npm test -- tests/unit/theme-schema.test.ts --reporter=dot
```

Expected: failure because locale properties are absent.

- [ ] **Step 3: Add i18n schema types and normalization**

Implement the shared types and a pure normalization helper. Build a known-field set from:

```text
analysis.fields
base fieldOrder string entries
base labels keys
base options keys
base tooltips keys
```

For each locale in sorted order:

- normalize valid labels/tooltips strings;
- normalize valid option strings individually;
- merge the three sections into one per-field translation object;
- sort field keys alphabetically;
- preserve unknown fields but append one `UNKNOWN_TRANSLATION_FIELD` warning per locale+field.

- [ ] **Step 4: Write failing partial-invalid tests**

Cover:

- labels section not an object -> `INVALID_I18N_LABEL`;
- one invalid label while another remains valid;
- options field not an object -> `INVALID_I18N_OPTIONS`;
- one invalid option value while valid siblings remain;
- tooltip invalid while labels/options remain;
- runtime invalid `data` root through a type cast -> `INVALID_I18N_ROOT`;
- all locales returned in alphabetical order;
- translated field keys alphabetical;
- input data remains unchanged after mutating output.

- [ ] **Step 5: Implement partial validation and stable warnings**

Use warning messages including locale context. Do not discard valid siblings. Omit empty per-field translation objects and empty `options` objects. Append i18n warnings to existing warnings, then run the existing stable sort by code, field, message.

- [ ] **Step 6: Run schema/analyzer tests and build**

Run:

```bash
npm test -- tests/unit/theme-schema.test.ts tests/unit/theme-analyzer.test.ts --reporter=dot
npm run build
```

Expected: all focused tests and TypeScript build pass.

- [ ] **Step 7: Commit**

```bash
git add src/theme/schema.ts tests/unit/theme-schema.test.ts
git commit -m "feat(theme): normalize starter-kit i18n metadata"
```

---

### Task 3: Verify domain output, document, and run full suite

**Files:**
- Modify `tests/unit/domains/theme.test.ts:80-105`
- Modify `README.md:69-100,225-230`
- No production changes unless verification exposes a defect.

**Interfaces:**
- Public action remains `automad_theme.schema`.
- No new capability registry action or WriteGuard action.

- [ ] **Step 1: Extend schema domain test**

Add `i18n/de.json` to the local schema-theme fixture and assert:

```ts
expect(result).toMatchObject({
  locales: ["de"],
  translations: {
    de: {
      locale: "de",
      path: "i18n/de.json",
      fields: expect.any(Object),
    },
  },
});
```

Keep the existing no-HTTP assertions.

- [ ] **Step 2: Update README**

Document:

- Starter-Kit `i18n/<locale>.json` structure;
- supported sections: labels/options/tooltips;
- all locales returned together;
- sparse override and `theme.json` fallback semantics;
- partial-invalid warnings;
- dashboard metadata only, not page-content translations;
- no new MCP action.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
npm run build
npm test -- tests/unit/theme-analyzer.test.ts tests/unit/theme-schema.test.ts tests/unit/domains/theme.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

Expected: build succeeds, focused tests pass, full suite passes, lint exits zero.

- [ ] **Step 4: Verify MCP contract and repository state**

Run:

```bash
npm test -- tests/unit/server.test.ts --reporter=dot
git diff --check
git status --short --branch
```

Expected: six public tools remain, no new action/tool appears, no generated files or credentials.

- [ ] **Step 5: Commit docs and domain test**

```bash
git add README.md tests/unit/domains/theme.test.ts
git commit -m "docs(theme): document starter-kit i18n schema"
```
