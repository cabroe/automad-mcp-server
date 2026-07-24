# Automad Starter-Kit Theme Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit offline `analyze` and `validate` actions to `automad_theme`, covering the Automad Theme Starter Kit structure and metadata conventions without changing existing theme actions.

**Architecture:** Add a pure local `ThemeAnalyzer` over the existing `ThemeFs` abstraction. The theme domain dispatches two read-only actions to it; the analyzer inventories files/manifests and produces deterministic findings, while it never executes theme code or accesses the network. Existing manager/editor/scaffold behavior remains intact.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Zod, Vitest, existing `ThemeFs`, `AutomadMcpError`, MCP SDK, ESLint, Prettier.

## Global Constraints

- Analysis is explicit only through `automad_theme` actions `analyze` and `validate`.
- Both analysis actions are read-only under every `AUTOMAD_WRITE_MODE` and never require confirmation tokens.
- Analysis is offline: no HTTP, Git, npm, Composer, PHP, JavaScript execution, or implicit build.
- Reuse `ThemeFs` and `assertWithinRoot`; preserve path-traversal protection.
- Missing theme throws `AutomadMcpError` with `NOT_FOUND`; malformed manifests become validation findings.
- Do not implement a complete Automad template parser; extract only conservative documented field patterns.
- Existing `automad_theme` actions remain backward compatible.
- Keep source reads bounded and report truncation as a warning instead of allocating unbounded memory.
- Use TDD: each behavior gets a failing test before production implementation.

---

## File Map

- Create `src/theme/analyzer.ts`: typed inventory, manifest parsing, conservative field extraction, Starter-Kit detection, validation rules.
- Modify `src/schemas.ts`: add `analyze` and `validate` to `themeInput.action`.
- Modify `src/write-guard.ts`: add `theme.analyze` and `theme.validate`; classify both as read actions.
- Modify `src/domains/theme.ts`: construct analyzer and dispatch the two actions after requiring `theme`.
- Create `tests/unit/theme-analyzer.test.ts`: focused analyzer tests for valid and invalid themes.
- Modify `tests/unit/domains/theme.test.ts`: MCP-domain dispatch and read-only tests.
- Modify `README.md`: document actions, output shapes, rules, and limitations.
- Modify `docs/superpowers/plans/2026-07-24-automad-theme-analysis-plan.md` only as task checkboxes are completed if plan execution requires it.

## Shared Interfaces

The analyzer should expose these named types and functions:

```ts
export type FindingSeverity = "error" | "warning" | "info";

export interface ThemeFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
  path?: string;
  line?: number;
}

export interface ThemeAnalysis {
  theme: string;
  path: string;
  manifests: {
    theme?: Record<string, unknown>;
    package?: Record<string, unknown>;
    composer?: Record<string, unknown>;
  };
  files: {
    templates: string[];
    components: string[];
    blocks: string[];
    client: string[];
    icons: string[];
    i18n: string[];
    lib: string[];
    build: string[];
    other: string[];
  };
  fields: string[];
  blockFields: string[];
  masks: { page: string[]; shared: string[] };
  starterKit: {
    detected: boolean;
    markers: string[];
  };
  issues: ThemeFinding[];
}

export interface ThemeValidation extends ThemeAnalysis {
  ok: boolean;
  findings: ThemeFinding[];
  summary: { errors: number; warnings: number; info: number };
}

export class ThemeAnalyzer {
  constructor(deps: { fs: ThemeFs; themesPath: string });
  analyze(theme: string): Promise<ThemeAnalysis>;
  validate(theme: string): Promise<ThemeValidation>;
}
```

`ThemeFs.list` returns relative paths when rooted at the theme directory; use `path.posix` normalization in result paths. The analyzer may use a bounded `readFile` helper and must preserve parser issues in `issues`.

---

### Task 1: Extend the read-only MCP contract

**Files:**
- Modify `src/schemas.ts:92-115`
- Modify `src/write-guard.ts:4-28,41-52`
- Modify `tests/unit/schemas.test.ts`
- Modify `tests/unit/write-guard.test.ts`

**Interfaces:**
- Produces `ThemeInput["action"]` values `"analyze" | "validate"`.
- Produces read permissions for `theme.analyze` and `theme.validate`.

- [ ] **Step 1: Add failing schema and guard tests**

Add tests asserting:

```ts
expect(themeInput.parse({ action: "analyze", theme: "starter" }).action).toBe("analyze");
expect(themeInput.parse({ action: "validate", theme: "starter" }).action).toBe("validate");
expect(new WriteGuard(readOnlyConfig).check("theme.analyze", "/")).toEqual({ allowed: true });
expect(new WriteGuard(readOnlyConfig).check("theme.validate", "/")).toEqual({ allowed: true });
```

- [ ] **Step 2: Run tests and verify the contract fails**

Run:

```bash
npm test -- tests/unit/schemas.test.ts tests/unit/write-guard.test.ts --reporter=dot
```

Expected: failures because the action enum and `WriteAction` union do not include the new values.

- [ ] **Step 3: Implement the minimal schema and guard changes**

Add `analyze` and `validate` to the theme action enum, add both strings to `WriteAction`, and add both to `READ_ACTIONS`. Do not alter destructive-action membership.

- [ ] **Step 4: Run focused tests**

Run the same command. Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/write-guard.ts tests/unit/schemas.test.ts tests/unit/write-guard.test.ts
git commit -m "feat(theme): add read-only analysis actions"
```

---

### Task 2: Build the local ThemeAnalyzer inventory

**Files:**
- Create `src/theme/analyzer.ts`
- Create `tests/unit/theme-analyzer.test.ts`

**Interfaces:**
- Consumes `ThemeFs` and `themesPath`.
- Produces `ThemeAnalyzer.analyze(theme): Promise<ThemeAnalysis>`.

- [ ] **Step 1: Write failing inventory tests**

Create a temporary theme fixture with:

```text
starter/
  theme.json
  package.json
  composer.json
  default.php
  components/page.php
  blocks/pagelist/grid.php
  client/index.ts
  client/styles/index.less
  icons/menu.svg
  i18n/de.json
  lib/functions.php
  esbuild.js
```

Use template content containing `@{ brand }`, `@{ :title }`, `@{ +main }`, and `<@ components/page.php @>`. Assert that `analyze("starter")` returns:

- all file paths grouped into the expected categories;
- `fields` containing `brand` and `+main`, but not `:title`;
- `blockFields` containing `+main`;
- parsed manifests and `masks.page`/`masks.shared` arrays;
- `starterKit.detected === true` and markers containing `theme.json`, `client/index.ts`, `client/styles`, and `esbuild.js`.

Add a missing-theme test expecting `NOT_FOUND`.

- [ ] **Step 2: Run analyzer tests and verify failure**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: module/import or missing-method failures.

- [ ] **Step 3: Implement inventory and conservative extraction**

Implement:

1. Resolve `themesPath/<theme>` with `assertWithinRoot`; throw `NOT_FOUND` if absent.
2. Recursively list files once and normalize relative POSIX paths.
3. Categorize by prefix/directories: root `.php` templates, `components/`, `blocks/`, `client/`, `icons/`, `i18n/`, `lib/`, build markers (`package.json`, `composer.json`, `esbuild.js`, `postcss.config.js`, `tsconfig.json`, `bin/`), and `other`.
4. Parse manifests defensively; place valid objects in `manifests`; add parser findings to `issues` for malformed optional files.
5. Read bounded `.php` source files and extract only `@{ identifier }` and `@{ +identifier }` patterns. Ignore identifiers beginning with `:` and control/internals from a small constant set. Keep first source line for findings where available.
6. Read `theme.json.masks.page` and `.shared` only when arrays of strings; otherwise leave arrays empty and add an issue.
7. Detect Starter-Kit markers by exact relative paths and set `detected` when at least three recognized markers exist.

Do not execute or evaluate PHP, JavaScript, TypeScript, LESS, Composer, npm, or Git files.

- [ ] **Step 4: Run focused analyzer tests**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: all inventory tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): inventory starter-kit themes"
```

---

### Task 3: Add validation findings and metadata checks

**Files:**
- Modify `src/theme/analyzer.ts`
- Modify `tests/unit/theme-analyzer.test.ts`

**Interfaces:**
- Extends `ThemeAnalyzer.validate(theme): Promise<ThemeValidation>`.
- `ThemeValidation.ok` is false only when at least one `error` finding exists.

- [ ] **Step 1: Write failing validation tests**

Add fixtures/assertions for:

1. Missing `theme.json` → `THEME_MANIFEST_MISSING` error.
2. Invalid `theme.json`, `package.json`, `composer.json`, or `i18n/de.json` → corresponding invalid-JSON error finding, not a thrown parser error.
3. Valid manifest without `name` → `THEME_NAME_MISSING`.
4. Theme with no root `.php` → `THEME_TEMPLATE_MISSING`.
5. Differing non-empty package/composer metadata → mismatch warnings.
6. Referenced `brand` absent from `masks.page` and `masks.shared` → `FIELD_NOT_MASKED`.
7. A mask field not referenced or known → `MASK_FIELD_UNUSED`.
8. Partial Starter-Kit markers → `STARTER_BUILD_INCOMPLETE` warning.
9. `+main` reference → `BLOCK_FIELD_DETECTED` info.
10. Compatible `package.json` build script plus `esbuild.js` → `BUILD_SCRIPT_DETECTED` info.
11. `i18n/` with no JSON files → `I18N_DIRECTORY_EMPTY` warning.
12. Summary counts and `ok` reflect findings.

- [ ] **Step 2: Run validation tests and verify failure**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: failures for missing `validate` or absent rule findings.

- [ ] **Step 3: Implement validation rules**

Add deterministic rule evaluation over the analysis inventory:

- Required-file and required-metadata errors.
- Optional manifest/i18n parse errors.
- Comparable non-empty metadata mismatch warnings only.
- Editable-field mask comparison using exact field names, with `+` preserved.
- Starter-Kit build marker warning only when the theme has enough recognized Starter-Kit markers to make the convention applicable.
- Informational findings for detected blocks, build script, and recognized structure.
- Stable ordering: errors, warnings, infos; within each severity sort by code then path.
- `summary` counts each severity and `ok` equals `errors === 0`.

- [ ] **Step 4: Run analyzer tests**

Run:

```bash
npm test -- tests/unit/theme-analyzer.test.ts --reporter=dot
```

Expected: all inventory and validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): validate starter-kit conventions"
```

---

### Task 4: Wire analyzer actions through the MCP domain

**Files:**
- Modify `src/domains/theme.ts:10-22,33-103`
- Modify `tests/unit/domains/theme.test.ts`
- Modify `tests/unit/server.test.ts` only if tool action schema assertions need explicit coverage

**Interfaces:**
- Consumes `ThemeAnalyzer` from Task 2/3.
- Produces MCP calls `automad_theme({ action: "analyze", theme })` and `automad_theme({ action: "validate", theme })`.

- [ ] **Step 1: Write failing domain tests**

Add tests that:

```ts
const analysis = await handleTheme(
  { action: "analyze", theme: "starter" },
  { client: mockClient(), guard: new WriteGuard(readOnlyConfig), themesPath, starterKitPath },
);
expect(analysis).toMatchObject({ theme: "starter" });

const validation = await handleTheme(
  { action: "validate", theme: "starter" },
  { client: mockClient(), guard: new WriteGuard(readOnlyConfig), themesPath, starterKitPath },
);
expect(validation).toMatchObject({ ok: true });
```

Also assert that `client` methods are not called and read-only mode permits both actions.

- [ ] **Step 2: Run domain tests and verify failure**

Run:

```bash
npm test -- tests/unit/domains/theme.test.ts --reporter=dot
```

Expected: TypeScript/switch failures because the handler does not dispatch the new actions.

- [ ] **Step 3: Wire the analyzer**

Import `ThemeAnalyzer`, construct it from `fs` and `themesPath`, and add switch cases:

```ts
case "analyze":
  if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for analyze");
  return analyzer.analyze(input.theme);
case "validate":
  if (!input.theme) throw new AutomadMcpError("VALIDATION", "theme is required for validate");
  return analyzer.validate(input.theme);
```

Add `theme.analyze` and `theme.validate` to the action map. Keep the existing `themeDeps` guard and disabled-theme error unchanged.

- [ ] **Step 4: Run domain and server tests**

Run:

```bash
npm test -- tests/unit/domains/theme.test.ts tests/unit/server.test.ts --reporter=dot
```

Expected: all focused tests pass and the six-tool registration remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/domains/theme.ts tests/unit/domains/theme.test.ts tests/unit/server.test.ts
 git commit -m "feat(theme): expose analyzer through MCP"
```

---

### Task 5: Document and perform full verification

**Files:**
- Modify `README.md:56-78,174-205`
- Add or modify no production files unless verification exposes a defect.

**Interfaces:**
- Documents the public MCP action contract and limitations from Tasks 1–4.

- [ ] **Step 1: Update documentation**

Document under `automad_theme`:

- `analyze` and `validate` are explicit read-only actions.
- Required `theme` argument.
- Example JSON calls and compact output shape.
- Checks for manifests, templates, fields, masks, i18n, metadata, and Starter-Kit build markers.
- No network, code execution, automatic build, Docker preview, or automatic fixes.
- `AUTOMAD_THEMES_PATH` remains required and `AUTOMAD_STARTER_KIT_PATH` is only needed for scaffold.

Update the documented test count only after running the suite; do not hardcode a guessed count.

- [ ] **Step 2: Run formatting/type/tests/lint**

Run:

```bash
npm run build
npm test -- --reporter=dot
npm run lint
```

Expected: TypeScript build succeeds, all tests pass, ESLint exits zero.

- [ ] **Step 3: Run Docker-backed MCP smoke test**

Start a disposable `automad/automad:v2` container, prepare a local Starter-Kit-shaped theme under a temporary `AUTOMAD_THEMES_PATH`, and invoke through the real `StdioClientTransport`:

```json
{ "name": "automad_theme", "arguments": { "action": "analyze", "theme": "starter" } }
{ "name": "automad_theme", "arguments": { "action": "validate", "theme": "starter" } }
```

Assert the first call returns inventory groups and the second returns `ok`, `findings`, and `summary`; assert the Docker/HTTP client is not needed by analyzer calls. Remove the container after the test and confirm no matching container remains.

- [ ] **Step 4: Inspect final diff and repository state**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; only intended source, test, documentation, and plan/spec files are present.

- [ ] **Step 5: Commit documentation and verification updates**

```bash
git add README.md docs/superpowers/plans/2026-07-24-automad-theme-analysis-plan.md
git commit -m "docs(theme): document starter-kit analysis"
```

