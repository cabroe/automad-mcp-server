# Analyzer Documented Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two analyzer checks that `src/docs/kb/pages/snippet-inheritance.ts` and `src/docs/kb/pages/runtime-lang.ts` already claim exist, then reword both pages so every documented claim is backed by shipped code.

**Architecture:** `ThemeAnalyzer.analyze()` already reads every template/component/block source exactly once. Three regex probes are added to that existing loop, their results land on `ThemeAnalysis` as additive fields, and `ThemeAnalyzer.validate()` turns them into two `warning` findings. This mirrors the existing `fields` → `addFieldFindings` split: data gathered in `analyze()`, semantic lint raised in `validate()`.

**Tech Stack:** TypeScript strict ESM, vitest, no new dependencies.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitAny`. No `any`.
- `ThemeFinding.path` is `path?: string`. Under `exactOptionalPropertyTypes`, `string | undefined` is **not** assignable to it. A `length > 0` guard does **not** narrow `arr[0]`. Bind with destructuring and branch on truthiness: `const [first] = arr; if (first) { ... path: first }`.
- CLAUDE.md forbids inline casts as a narrowing workaround.
- ESM imports carry explicit `.js` extensions. Static imports only.
- Finding severity is `warning` for both new checks. Never `error` — `error` flips `validate.ok` to `false` and changes the tool contract.
- Exact finding codes: `MAIN_SNIPPET_UNDEFINED`, `LANG_WITHOUT_I18N`. No other spelling.
- Exact message strings are given verbatim in each task. Copy them character for character; the KB pages and the drift test refer to these codes.
- Detection regexes are declared **without** the `g` flag and used with `.test()`. A `/g` regex used with `.test()` is stateful via `lastIndex` and returns alternating results across calls.
- No new dependencies. No changes outside the files each task lists.

---

## Task 1: `MAIN_SNIPPET_UNDEFINED`

**Files:**
- Modify: `src/theme/analyzer.ts`
- Test: `tests/unit/theme-analyzer.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ThemeAnalysis.mainSnippet: { definedIn: string[]; invokedIn: string[] }` and the finding code `MAIN_SNIPPET_UNDEFINED`. Task 3 documents this code.

- [ ] **Step 1: Write the two failing tests**

Append to the end of `tests/unit/theme-analyzer.test.ts`. The file already provides `writeTheme(slug, files)` and `analyzer()`.

```ts
describe("main snippet detection", () => {
  it("flags MAIN_SNIPPET_UNDEFINED when a template invokes main with no definition", async () => {
    await writeTheme("no-main", {
      "theme.json": JSON.stringify({ name: "No Main", masks: { page: [], shared: [] } }),
      "default.php": "<@ components/page.php @>",
      "components/page.php": "<main><@ main @></main>",
    });
    const result = await analyzer().validate("no-main");
    const finding = result.findings.find((f) => f.code === "MAIN_SNIPPET_UNDEFINED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.path).toBe("components/page.php");
  });

  it("stays silent when a different file defines the main snippet", async () => {
    await writeTheme("has-main", {
      "theme.json": JSON.stringify({ name: "Has Main", masks: { page: [], shared: [] } }),
      "default.php": "<@ components/page.php @>\n<@~ snippet main ~@>\n<h1>Home</h1>\n<@~ end ~@>",
      "components/page.php": "<main><@ main @></main>",
    });
    const result = await analyzer().validate("has-main");
    expect(result.findings.some((f) => f.code === "MAIN_SNIPPET_UNDEFINED")).toBe(false);
  });
});
```

The second test is the one that pins "theme-wide": the definition and the invocation live in different files.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/theme-analyzer.test.ts -t "main snippet detection"`
Expected: FAIL — the first test fails because no finding with that code is produced (`finding` is `undefined`).

- [ ] **Step 3: Add the interface field and the two regexes**

In `src/theme/analyzer.ts`, add to the `ThemeAnalysis` interface immediately after the `blockFields: string[];` line:

```ts
  /** Files that define and that invoke the canonical `main` snippet. */
  mainSnippet: { definedIn: string[]; invokedIn: string[] };
```

Add beside the existing `FIELD_RE` / `IGNORED_FIELDS` / `STARTER_MARKERS` module constants:

```ts
const MAIN_SNIPPET_DEFINE_RE = /<@~?\s*snippet\s+main\s*~?@>/;
const MAIN_SNIPPET_INVOKE_RE = /<@~?\s*main\s*~?@>/;
```

These cannot collide. In `<@~ snippet main ~@>` the text after `<@~` is `snippet`, so the invoke pattern finds no match there. `<@ mainNav @>` does not match either, because the character after `main` must be whitespace, `~`, or `@`.

- [ ] **Step 4: Collect the signal in the existing source loop**

In `analyze()`, immediately before the line `const fields = new Set<string>();`, declare the accumulators:

```ts
    const mainSnippetDefinedIn: string[] = [];
    const mainSnippetInvokedIn: string[] = [];
```

Inside the existing `for (const relPath of [...files.templates, ...files.components, ...files.blocks])` loop, after the `for (const match of source.matchAll(FIELD_RE)) { ... }` block closes and before the loop's closing brace, add:

```ts
      if (MAIN_SNIPPET_DEFINE_RE.test(source)) mainSnippetDefinedIn.push(relPath);
      if (MAIN_SNIPPET_INVOKE_RE.test(source)) mainSnippetInvokedIn.push(relPath);
```

Order is deterministic: `discoverFiles()` sorts its input and buckets it in order, and the loop walks templates, then components, then blocks.

- [ ] **Step 5: Return the new field**

In the `return { ... }` statement at the end of `analyze()`, add `mainSnippet` after `blockFields`:

```ts
    return { theme, path: themePath, manifests, files, fields: fieldList, fieldSources, blockFields, mainSnippet: { definedIn: mainSnippetDefinedIn, invokedIn: mainSnippetInvokedIn }, masks, starterKit, translations, issues };
```

- [ ] **Step 6: Emit the finding in `validate()`**

In `validate()`, immediately after the line `this.addFieldFindings(analysis, findings);`, add:

```ts
    const [firstMainInvoker] = analysis.mainSnippet.invokedIn;
    if (firstMainInvoker && analysis.mainSnippet.definedIn.length === 0) {
      findings.push({
        severity: "warning",
        code: "MAIN_SNIPPET_UNDEFINED",
        message:
          "template invokes <@ main @> but no <@~ snippet main ~@> is defined in this theme — the rendered <main> will be empty; see automad_docs.get('snippet-inheritance')",
        path: firstMainInvoker,
      });
    }
```

The destructure plus truthiness check is what satisfies `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` at once: `firstMainInvoker` narrows to `string`, and its truthiness also proves the array is non-empty. Do not replace it with `invokedIn.length > 0` plus an index access — that does not compile.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/theme-analyzer.test.ts`
Expected: PASS, including both new tests and every pre-existing test in the file.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): add MAIN_SNIPPET_UNDEFINED analyzer finding"
```

---

## Task 2: `LANG_WITHOUT_I18N`

**Files:**
- Modify: `src/theme/analyzer.ts`
- Test: `tests/unit/theme-analyzer.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1. The two checks are independent; only their edit locations are adjacent.
- Produces: `ThemeAnalysis.runtimeLangFiles: string[]` and the finding code `LANG_WITHOUT_I18N`. Task 3 documents this code.

**Background the implementer needs:** `FIELD_RE` is `/@\{\s*([+A-Za-z][A-Za-z0-9_-]*)\b/g`. Its first character class requires `+` or a letter, so `@{ :lang }` is never captured and never reaches `analysis.fields`. This check therefore needs its own pattern and cannot reuse the field list.

- [ ] **Step 1: Write the two failing tests**

Append to the end of `tests/unit/theme-analyzer.test.ts`:

```ts
describe("runtime :lang detection", () => {
  it("flags LANG_WITHOUT_I18N when :lang is used without translations", async () => {
    await writeTheme("no-i18n", {
      "theme.json": JSON.stringify({ name: "No I18n", masks: { page: [], shared: [] } }),
      "default.php": '<html lang="@{ :lang }"></html>',
    });
    const result = await analyzer().validate("no-i18n");
    const finding = result.findings.find((f) => f.code === "LANG_WITHOUT_I18N");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.path).toBe("default.php");
  });

  it("stays silent when :lang is backed by an i18n translation", async () => {
    await writeTheme("with-i18n", {
      "theme.json": JSON.stringify({ name: "With I18n", masks: { page: [], shared: [] } }),
      "default.php": '<html lang="@{ :lang }"></html>',
      "i18n/de.json": JSON.stringify({ "nav.home": "Start" }),
    });
    const result = await analyzer().validate("with-i18n");
    expect(result.findings.some((f) => f.code === "LANG_WITHOUT_I18N")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/theme-analyzer.test.ts -t "runtime :lang detection"`
Expected: FAIL — no finding with that code exists yet.

- [ ] **Step 3: Add the interface field and the regex**

In `src/theme/analyzer.ts`, add to the `ThemeAnalysis` interface immediately after the `mainSnippet` field added in Task 1 (or after `blockFields` if Task 1 has not landed):

```ts
  /** Files referencing the runtime variable `@{ :lang }`. */
  runtimeLangFiles: string[];
```

Add beside the other module constants:

```ts
const RUNTIME_LANG_RE = /@\{\s*:lang\b/;
```

- [ ] **Step 4: Collect the signal in the existing source loop**

Declare the accumulator next to the other pre-loop accumulators in `analyze()`:

```ts
    const runtimeLangFiles: string[] = [];
```

Inside the same `for (const relPath of [...files.templates, ...files.components, ...files.blocks])` loop, alongside the other `.test(source)` probes:

```ts
      if (RUNTIME_LANG_RE.test(source)) runtimeLangFiles.push(relPath);
```

- [ ] **Step 5: Return the new field**

Add `runtimeLangFiles` to the object returned by `analyze()`, after `mainSnippet`:

```ts
    return { theme, path: themePath, manifests, files, fields: fieldList, fieldSources, blockFields, mainSnippet: { definedIn: mainSnippetDefinedIn, invokedIn: mainSnippetInvokedIn }, runtimeLangFiles, masks, starterKit, translations, issues };
```

- [ ] **Step 6: Emit the finding in `validate()`**

Immediately after the `MAIN_SNIPPET_UNDEFINED` block from Task 1:

```ts
    const [firstLangFile] = analysis.runtimeLangFiles;
    if (firstLangFile && Object.keys(analysis.translations).length === 0) {
      findings.push({
        severity: "warning",
        code: "LANG_WITHOUT_I18N",
        message:
          "template uses @{ :lang } but the theme ships no i18n/*.json translations — see automad_docs.get('runtime-lang')",
        path: firstLangFile,
      });
    }
```

`analysis.translations` is the i18n signal, **not** `analysis.files.i18n`: `translations` holds only locales that parsed successfully, so a theme whose sole `i18n/de.json` is malformed still gets warned.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/theme-analyzer.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/theme/analyzer.ts tests/unit/theme-analyzer.test.ts
git commit -m "feat(theme): add LANG_WITHOUT_I18N analyzer finding"
```

---

## Task 3: Reword the two KB pages and pin them against the analyzer

**Files:**
- Modify: `src/docs/kb/pages/snippet-inheritance.ts`
- Modify: `src/docs/kb/pages/runtime-lang.ts`
- Modify: `tests/unit/docs-drift.test.ts`

**Interfaces:**
- Consumes: the finding codes `MAIN_SNIPPET_UNDEFINED` (Task 1) and `LANG_WITHOUT_I18N` (Task 2). Both must be committed before this task runs, or the drift test fails.
- Produces: nothing downstream.

**Why the attribution changes:** both pages currently credit `automad_theme.analyze`. The findings are raised by `validate()`, so the rewritten text says `automad_theme.validate`.

- [ ] **Step 1: Reword the snippet-inheritance lint section**

In `src/docs/kb/pages/snippet-inheritance.ts`, inside the `body` template literal, replace this block:

```
## Lint check

`automad_theme.analyze` walks the call graph from `default.php` (and any
other root templates) and reports any `<@ main @>` invocation that has no
reachable `<@~ snippet main ~@>` definition.
```

with:

```
## Lint check

`automad_theme.validate` reports `MAIN_SNIPPET_UNDEFINED` when a template
invokes `<@ main @>` but no file in the theme defines
`<@~ snippet main ~@>`. The check is theme-wide: it does not follow the
include graph, so a definition that exists but is unreachable from a given
root template is not detected.
```

Note the backticks inside the body are escaped as `` \` `` in the source file. Preserve that escaping.

- [ ] **Step 2: Reword the runtime-lang analyzer section**

In `src/docs/kb/pages/runtime-lang.ts`, inside the `body` template literal, replace this block:

```
## Analyzer warning

`automad_theme.analyze` warns when a template uses `@{ :lang }` but the
theme has no `i18n/` directory (likely forgotten step 3), or vice versa.
```

with:

```
## Analyzer warning

`automad_theme.validate` reports `LANG_WITHOUT_I18N` when a template uses
`@{ :lang }` but the theme ships no parsable `i18n/*.json` translations.
```

The "or vice versa" clause is deleted, not implemented: a theme may legitimately ship translations and route every string through `<@ t { key: '...' } @>` without ever writing `@{ :lang }`.

- [ ] **Step 3: Write the drift assertions**

Append to `tests/unit/docs-drift.test.ts`. The file already defines `ROOT` and imports `readFileSync` and `resolve`.

```ts
describe("KB pages ↔ analyzer drift", () => {
  const ANALYZER = readFileSync(resolve(ROOT, "src", "theme", "analyzer.ts"), "utf-8");

  function kbPage(slug: string): string {
    return readFileSync(resolve(ROOT, "src", "docs", "kb", "pages", `${slug}.ts`), "utf-8");
  }

  it("snippet-inheritance names a finding code the analyzer can emit", () => {
    expect(kbPage("snippet-inheritance")).toContain("MAIN_SNIPPET_UNDEFINED");
    expect(ANALYZER).toContain('"MAIN_SNIPPET_UNDEFINED"');
  });

  it("runtime-lang names a finding code the analyzer can emit", () => {
    expect(kbPage("runtime-lang")).toContain("LANG_WITHOUT_I18N");
    expect(ANALYZER).toContain('"LANG_WITHOUT_I18N"');
  });
});
```

This is a text-level pin, matching the style already used in this file for the beta-version and count checks. Behavioural coverage lives in `theme-analyzer.test.ts`; this guard exists solely to fail when a KB page names a code the analyzer cannot emit.

- [ ] **Step 4: Run the drift and KB tests**

Run: `npx vitest run tests/unit/docs-drift.test.ts tests/unit/docs-kb.test.ts`
Expected: PASS. `docs-kb.test.ts` must stay green — the reworded pages still satisfy its shape assertions (`body.length > 100`, non-empty title/tags).

- [ ] **Step 5: Commit**

```bash
git add src/docs/kb/pages/snippet-inheritance.ts src/docs/kb/pages/runtime-lang.ts tests/unit/docs-drift.test.ts
git commit -m "docs(kb): describe the analyzer checks that actually ship"
```

---

## Task 4: Final verification, behavioural smoke, TESTCOUNT sync

**Files:**
- Possibly modify: `CLAUDE.md`, `docs/index.html` (autogenerated TESTCOUNT markers only)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Full suite, lint, type-check**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all green. Test count rises by 6 from the pre-plan baseline of 317 (four analyzer tests, two drift tests) to 323.

- [ ] **Step 2: Behavioural smoke against a scratch theme**

This is the proof that the docs are now true. Build a theme that trips both checks and confirm both codes come back.

```bash
mkdir -p /tmp/kb-smoke/themes/broken/components
cat > /tmp/kb-smoke/themes/broken/theme.json <<'JSON'
{ "name": "Broken", "masks": { "page": [], "shared": [] } }
JSON
printf '<@ components/page.php @>\n' > /tmp/kb-smoke/themes/broken/default.php
printf '<html lang="@{ :lang }"><main><@ main @></main></html>\n' > /tmp/kb-smoke/themes/broken/components/page.php

npm run build
node --input-type=module -e '
import { ThemeAnalyzer } from "./dist/theme/analyzer.js";
import { LocalThemeFs } from "./dist/theme/fs.js";
const a = new ThemeAnalyzer({ fs: new LocalThemeFs(), themesPath: "/tmp/kb-smoke/themes" });
const r = await a.validate("broken");
const codes = r.findings.filter((f) => ["MAIN_SNIPPET_UNDEFINED", "LANG_WITHOUT_I18N"].includes(f.code));
console.log(JSON.stringify(codes, null, 2));
'
```

Expected: both findings present, each with `"severity": "warning"`, `MAIN_SNIPPET_UNDEFINED` at path `components/page.php` and `LANG_WITHOUT_I18N` at path `components/page.php`.

- [ ] **Step 3: Refresh the TESTCOUNT markers**

The plain `npm run docs:sync` does **not** recompute the test count; it needs the `--tests` variant, which spawns a real vitest run.

Run: `npm run docs:sync:tests`
Expected: reports `CLAUDE.md: updated (TESTCOUNT)` and `index.html: updated (TESTCOUNT)`, landing on `323 tests, 31 files`.

- [ ] **Step 4: Commit the marker refresh**

```bash
git add CLAUDE.md docs/index.html
git commit -m "chore(docs): refresh TESTCOUNT markers after analyzer checks"
```

If `git status` shows nothing to commit, the markers were already correct — skip this step.

- [ ] **Step 5: Confirm every documented claim is backed**

Re-read the two reworded KB sections and confirm each sentence maps to an assertion in `tests/unit/theme-analyzer.test.ts`:

- "reports `MAIN_SNIPPET_UNDEFINED` when a template invokes `<@ main @>` but no file in the theme defines `<@~ snippet main ~@>`" → Task 1, test 1
- "theme-wide: it does not follow the include graph" → Task 1, test 2 (definition in a different file is accepted)
- "reports `LANG_WITHOUT_I18N` when a template uses `@{ :lang }` but the theme ships no parsable `i18n/*.json`" → Task 2, tests 1 and 2

Expected: three-for-three. If any sentence has no backing assertion, either delete the sentence or add the test.

---

## Self-Review Notes

**Spec coverage:**
- Collect three signals in the existing pass → Task 1 steps 3-4, Task 2 steps 3-4.
- `MAIN_SNIPPET_UNDEFINED` from `validate()` → Task 1 step 6.
- `LANG_WITHOUT_I18N` from `validate()` → Task 2 step 6.
- Additive `ThemeAnalysis` fields → Task 1 step 3, Task 2 step 3.
- Reword both pages → Task 3 steps 1-2.
- Pin both codes in `docs-drift.test.ts` → Task 3 step 3.
- Four analyzer tests → Task 1 step 1, Task 2 step 1.
- Behavioural smoke → Task 4 step 2.
- Strict-mode `path` constraint → Global Constraints, restated at Task 1 step 6.
- Non-global regex requirement → Global Constraints, applied in Task 1 step 3 and Task 2 step 3.

**Placeholder scan:** No `TBD`, no `TODO`, no "similar to Task N". Every code step carries the literal code. Every run step carries the literal command and its expected result.

**Type consistency:** `mainSnippet: { definedIn: string[]; invokedIn: string[] }` is declared once (Task 1 step 3) and read with exactly those property names in Task 1 step 6. `runtimeLangFiles: string[]` is declared in Task 2 step 3 and read in Task 2 step 6. The finding codes are spelled identically in the analyzer (Tasks 1-2), the KB pages (Task 3 steps 1-2), and the drift test (Task 3 step 3). The `return` statement is restated in full in Task 2 step 5 including Task 1's `mainSnippet` field, so an implementer working Task 2 after Task 1 sees the combined shape rather than guessing.

**Ordering:** Tasks 1 and 2 are mutually independent and may run in either order; Task 2 step 3 says where to put the field in both cases. Task 3 requires both codes to exist. Task 4 requires all three.
