# Theme Schema Blueprint Equivalent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a normalized, read-only theme schema contract and expose it through `automad_theme.schema` without rescanning files or introducing Resources.

**Architecture:** Extend `ThemeAnalysis` with field source paths, then add a pure `ThemeSchemaBuilder` in `src/theme/schema.ts`. The domain `schema` action calls the existing analyzer once and projects its result into stable field types, scopes, metadata, ordering, and warnings. Capability registry and WriteGuard metadata are extended while all existing actions remain unchanged.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Zod, Vitest, existing `ThemeAnalyzer`, `ThemeFs`, capability registry, and WriteGuard.

## Global Constraints

- `automad_theme.schema` is read-only in every write mode and never requires confirmation.
- `ThemeSchemaBuilder` is pure and performs no filesystem, network, environment, process, build, or mutation work.
- The analyzer remains the only source of file and field inventory; the schema builder does not rescan files.
- Existing `analyze`, `validate`, and all other theme actions remain backward compatible.
- `fields` and `blockFields` stay in `ThemeAnalysis`; add `fieldSources` without removing existing properties.
- Unknown field prefixes default to `text` and produce `UNKNOWN_FIELD_PREFIX` warnings.
- The phase does not add MCP Resources, Prompts, type generation, automatic fixes, authentication, audit logging, HTTP transport, rate limiting, Docker, browser, npm, Composer, Git, PHP, or JavaScript execution.
- Tests require no Automad instance, Docker, network, credentials, or environment variables.

---

## File Map

- Modify `src/theme/analyzer.ts`: collect `fieldSources` while scanning.
- Modify `tests/unit/theme-analyzer.test.ts`: verify source collection and deduplication.
- Create `src/theme/schema.ts`: normalized schema types and pure builder.
- Create `tests/unit/theme-schema.test.ts`: prefix, scope, metadata, ordering, warning tests.
- Modify `src/schemas.ts`: add `schema` action.
- Modify `src/write-guard.ts`: add read-only `theme.schema`.
- Modify `src/capabilities/registry.ts`: register `schema` action.
- Modify `src/domains/theme.ts`: dispatch `schema` through analyzer + builder.
- Modify focused schema, guard, capability, and domain tests.
- Modify `README.md`: document the public action and internal schema contract.

## Shared Interfaces

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

---

### Task 1: Record field source paths in ThemeAnalysis

**Files:**
- Modify `src/theme/analyzer.ts:7-60`
- Modify `tests/unit/theme-analyzer.test.ts:69-101`

**Interfaces:**
- Produces `ThemeAnalysis.fieldSources: Record<string, string[]>`.
- Keeps `fields` and `blockFields` unchanged.

- [ ] **Step 1: Write failing analyzer source tests**

Extend the Starter-Kit inventory fixture so `brand` appears multiple times in `default.php` and once in `components/page.php`, while `+grid` appears only in `blocks/pagelist/grid.php`.

Assert:

```ts
expect(result.fieldSources).toEqual({
  "+grid": ["blocks/pagelist/grid.php"],
  "+main": ["default.php"],
  brand: ["components/page.php", "default.php"],
});
```

This proves per-file deduplication and stable alphabetical source order.

- [ ] **Step 2: Run focused analyzer test and verify RED**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: failure because `fieldSources` is absent.

- [ ] **Step 3: Implement field source collection**

Extend `ThemeAnalysis`:

```ts
fieldSources: Record<string, string[]>;
```

During the existing source-file loop, collect file paths in a `Map<string, Set<string>>`. Keep the existing field extraction and ignored-field behavior. Convert the map into a plain object with sorted keys and sorted source arrays before returning analysis:

```ts
const fieldSources = Object.fromEntries(
  [...sources.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, paths]) => [field, [...paths].sort()]),
);
```

- [ ] **Step 4: Run focused tests and build**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
npm run build
```

Expected: analyzer tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): record analyzed field sources"
```

---

### Task 2: Implement the pure ThemeSchemaBuilder

**Files:**
- Create `src/theme/schema.ts`
- Create `tests/unit/theme-schema.test.ts`

**Interfaces:**
- Consumes `ThemeAnalysis` including `fieldSources`.
- Produces the shared interfaces and `ThemeSchemaBuilder.build` defined above.

- [ ] **Step 1: Write failing prefix and scope tests**

Create a `ThemeAnalysis` fixture containing:

```ts
fields: [
  "+main", "checkboxVisible", "colorAccent", "imageHero", "iconMenu",
  "selectLayout", "textIntro", "urlContact", "formatDate", "labelSection",
  "filterItems", "brand",
],
masks: {
  page: ["textIntro", "selectLayout", "brand"],
  shared: ["+main", "colorAccent"],
},
```

Assert exact type mapping, scope mapping, source arrays, and that `brand` becomes `text` plus one `UNKNOWN_FIELD_PREFIX` warning.

- [ ] **Step 2: Run focused schema tests and verify RED**

Run:

```bash
npm test -- tests/unit/theme-schema.test.ts --reporter=dot
```

Expected: module-not-found or missing-builder failures.

- [ ] **Step 3: Implement field types and scopes**

Implement prefix matching in the exact spec order. A named prefix matches only when the field is longer than the prefix. `+` requires at least one trailing character. Implement scope priority `shared` -> `page` -> `unmasked` and add `FIELD_SCOPE_CONFLICT` when a field appears in both masks.

Return copies of masks, templates, blocks, and sorted field source arrays so callers cannot mutate the analysis input.

- [ ] **Step 4: Write failing metadata and ordering tests**

Add a manifest fixture with:

```ts
labels: { textIntro: "Introduction" },
options: { selectLayout: { grid: "Grid", list: "List" } },
tooltips: { imageHero: "Hero image" },
fieldOrder: ["selectLayout", "textIntro", "selectLayout", 42],
```

Assert:

- `selectLayout.order === 0`;
- `textIntro.order === 1`;
- ordered fields appear first, remaining fields alphabetically;
- duplicate order emits `DUPLICATE_FIELD_ORDER`;
- non-string order entry emits `INVALID_FIELD_ORDER`;
- valid label/options/tooltip are copied.

Add invalid label/options/tooltip value tests for the exact warning codes.

- [ ] **Step 5: Implement manifest projection and stable warnings**

Read only from `analysis.manifests.theme`. Never mutate the manifest or analysis. Valid `options[field]` must be a non-array object whose values are all strings. Include optional properties only when valid. Project analyzer issues into schema warnings using `code` and `message`.

Sort warnings by:

```ts
code -> field (empty string when absent) -> message
```

Sort fields by valid order, then alphabetically.

- [ ] **Step 6: Run focused schema tests and build**

Run:

```bash
npm test -- tests/unit/theme-schema.test.ts --reporter=dot
npm run build
```

Expected: all schema tests and TypeScript build pass.

- [ ] **Step 7: Commit**

```bash
git add src/theme/schema.ts tests/unit/theme-schema.test.ts
git commit -m "feat(theme): build normalized theme schemas"
```

---

### Task 3: Expose automad_theme.schema as read-only action

**Files:**
- Modify `src/schemas.ts:87-117`
- Modify `src/write-guard.ts:4-67`
- Modify `src/capabilities/registry.ts:18-98`
- Modify `src/domains/theme.ts:1-115`
- Modify `tests/unit/schemas.test.ts`
- Modify `tests/unit/write-guard.test.ts`
- Modify `tests/unit/capabilities.test.ts`
- Modify `tests/unit/domains/theme.test.ts`

**Interfaces:**
- Consumes `ThemeSchemaBuilder` and `ThemeAnalyzer`.
- Produces MCP call `automad_theme({ action: "schema", theme })`.

- [ ] **Step 1: Write failing contract tests**

Add assertions:

```ts
expect(themeInput.parse({ action: "schema", theme: "starter" }).action).toBe("schema");
expect(readOnlyGuard.check("theme.schema", "/starter")).toEqual({ allowed: true });
expect(Object.keys(getCapability("automad_theme").actions)).toContain("schema");
```

Update exact registry action coverage to include `schema`.

- [ ] **Step 2: Run focused contract tests and verify RED**

Run:

```bash
npm test -- tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts --reporter=dot
```

Expected: failures because the new action is absent.

- [ ] **Step 3: Implement schema/guard/registry metadata**

Add `schema` to the Zod enum, `theme.schema` to `WriteAction` and `READ_ACTIONS`, and registry action metadata:

```ts
schema: read("Build a normalized theme schema."),
```

Add `schema` to the static expected action map. Do not change any existing action flags.

- [ ] **Step 4: Write failing domain test**

Create a local theme fixture with `theme.json` and `default.php`, call `handleTheme({ action: "schema", theme: "starter" }, readOnlyDeps)`, and assert:

```ts
expect(result).toMatchObject({
  theme: "starter",
  fields: expect.any(Array),
  warnings: expect.any(Array),
});
expect(client.get).not.toHaveBeenCalled();
expect(client.post).not.toHaveBeenCalled();
```

Also assert missing `theme` returns `VALIDATION` with message `theme is required for schema`.

- [ ] **Step 5: Implement domain dispatch**

Import and instantiate `ThemeSchemaBuilder`. Add `schema: "theme.schema"` to `ACTION_MAP` and a switch case that validates the argument, calls `analyzer.analyze` exactly once, and returns `schemaBuilder.build(analysis)`.

- [ ] **Step 6: Run focused integration tests and build**

Run:

```bash
npm test -- tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts tests/unit/server.test.ts --reporter=dot
npm run build
```

Expected: all focused tests pass, server still exposes exactly six tools, TypeScript succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/schemas.ts src/write-guard.ts src/capabilities/registry.ts src/domains/theme.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts tests/unit/domains/theme.test.ts
git commit -m "feat(theme): expose normalized schema action"
```

---

### Task 4: Document and fully verify Theme Schema

**Files:**
- Modify `README.md:56-90,192-220`
- No production changes unless verification exposes a defect.

**Interfaces:**
- Documents `automad_theme.schema` and the normalized field contract.

- [ ] **Step 1: Update README**

Document:

- `schema` in the `automad_theme` action list;
- required `theme` argument;
- read-only behavior;
- field types, scopes, sources, labels/options/tooltips/order;
- unknown-prefix fallback;
- no I/O beyond analyzer reads and no build/network/mutation;
- future Resource reuse is planned but not implemented.

Include a compact example call and result shape.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
npm run build
npm test -- tests/unit/theme-schema.test.ts tests/unit/theme-analyzer.test.ts tests/unit/domains/theme.test.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts tests/unit/capabilities.test.ts --reporter=dot
npm test -- --reporter=dot
npm run lint
```

Expected: build succeeds, focused tests pass, full suite passes, lint exits zero.

- [ ] **Step 3: Verify public MCP contract**

Run `tests/unit/server.test.ts` and confirm there are still exactly six public tools. No `automad_theme_schema` tool may appear; `schema` remains an action under `automad_theme`.

- [ ] **Step 4: Inspect final repository state**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat HEAD~3..HEAD
```

Expected: only intended source/test/docs changes, no credentials, generated output, or temporary files.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs(theme): document normalized theme schema"
```
