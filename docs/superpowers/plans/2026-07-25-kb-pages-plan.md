# KB Pages Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 829-LOC `src/docs/kb.ts` into per-page modules under `src/docs/kb/pages/`, delete the unused `page-format.ts`, and apply three small search/snippet simplifications while the file is being touched — with zero public API change.

**Architecture:** One new file per KB page (`src/docs/kb/pages/<slug>.ts`) exporting a `DocPage` constant. A central `pages/index.ts` registers them in a `readonly DocPage[]` array. `src/docs/kb.ts` shrinks to types + `listDocs`/`searchDocs`/`getDoc` reading from the array. The `BY_SLUG` Map and the `countOccurrences` helper are inlined; magic numbers become named constants.

**Tech Stack:** TypeScript ESM strict, Zod 3, vitest, NodeNext module resolution, no new dependencies.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. No `any`. ESM imports with explicit `.js` extensions.
- Static imports only — no `await import()`, no `import.meta.glob`, no bundler magic.
- Public API of `src/docs/kb.ts` is byte-identical: `DocPage`/`DocSummary`/`DocSearchHit` types, `listDocs()`/`getDoc(slug)`/`searchDocs(query, limit?)` signatures, error codes (`NOT_FOUND`/`VALIDATION`) and messages, `searchDocs` output ordering (`score DESC, slug ASC`), default limit `5`, minimum results `1`, snippet geometry 60/140 chars.
- `KB_PAGES` order in `pages/index.ts` must match the current `DOC_PAGES` order in `src/docs/kb.ts:672-764` exactly.
- All 13 page files export a `DocPage` with literal `slug` field equal to the filename stem.
- One task per logical step, ending in a testable deliverable. One commit per task.
- No new dependencies. No edits outside the file list below.

---

## Task 1: Capture pre-refactor behaviour as a smoke probe

**Files:**
- Create: `/tmp/kb-refactor-smoke.sh` (off-repo; not committed)

**Why first:** We need a baseline to compare against after the move. This is the only safety net for "did the move preserve byte-identical output?"

- [ ] **Step 1: Build the current state**

Run: `npm run build`
Expected: `dist/` contains `docs/kb.js`.

- [ ] **Step 2: Capture the baseline output**

Run:
```bash
node --input-type=module -e '
import { listDocs, getDoc, searchDocs } from "./dist/docs/kb.js";
const out = {
  count: listDocs().length,
  first: listDocs()[0].slug,
  slugs: listDocs().map(d => d.slug),
  getTemplateSyntax: getDoc("template-syntax").tags,
  getUnknown: (() => { try { getDoc("does-not-exist"); return "NO_THROW"; } catch (e) { return { code: e.code, msg: e.message, available: e.details?.available }; } })(),
  searchSnippet: searchDocs("snippet").map(h => h.slug),
  searchI18n: searchDocs("i18n").map(h => h.slug),
  searchEmpty: (() => { try { searchDocs(""); return "NO_THROW"; } catch (e) { return e.code; } })(),
};
console.log(JSON.stringify(out, null, 2));
' | tee /tmp/kb-baseline.json
```

Expected: JSON containing `count: 13`, `first: "template-syntax"`, `slugs: ["template-syntax", "control-structures", "navigation", "i18n", "blocks", "theme-json", "headless", "getting-started", "common-pitfalls", "include-path-resolution", "custom-functions", "runtime-lang", "snippet-inheritance"]`, `getUnknown.code: "NOT_FOUND"`, `searchEmpty: "VALIDATION"`.

- [ ] **Step 3: Commit a stub noting the baseline exists**

Skip — the file is in `/tmp/`, not in the repo. The `/tmp/kb-baseline.json` is the deliverable for this task; nothing to commit.

---

## Task 2: Add the `KB_PAGES` registration test pin

**Files:**
- Modify: `tests/unit/docs-kb.test.ts`

**Why first:** The test pins the order and count BEFORE we touch any production code. If a later task breaks order/count, the failure is here, not deep in search-results assertions.

- [ ] **Step 1: Read the current test file**

Run: `cat tests/unit/docs-kb.test.ts`
Expected: existing assertions on `listDocs()`, `getDoc("template-syntax")`, `searchDocs("snippet")`, etc.

- [ ] **Step 2: Add the registration pin**

Append at the end of the test file:

```ts
import { KB_PAGES } from "../../src/docs/kb/pages/index.js";

describe("KB_PAGES registration", () => {
  it("contains exactly 13 pages in the canonical order", () => {
    expect(KB_PAGES.map((p) => p.slug)).toEqual([
      "template-syntax",
      "control-structures",
      "navigation",
      "i18n",
      "blocks",
      "theme-json",
      "headless",
      "getting-started",
      "common-pitfalls",
      "include-path-resolution",
      "custom-functions",
      "runtime-lang",
      "snippet-inheritance",
    ]);
  });

  it("each page's slug matches its filename stem (no typos in the registration)", () => {
    // The page modules are created in Task 3; before that this import resolves to
    // a stub. The assertion runs at test time once Task 3 is in.
    for (const page of KB_PAGES) {
      expect(page.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.tags.length).toBeGreaterThan(0);
      expect(page.body.length).toBeGreaterThan(100);
    }
  });
});
```

- [ ] **Step 3: Run the new test, watch it fail (KB_PAGES not yet exported)**

Run: `npx vitest run tests/unit/docs-kb.test.ts`
Expected: FAIL — `KB_PAGES` is not exported from `src/docs/kb/pages/index.js` (file does not exist).

- [ ] **Step 4: Commit the failing test as the plan's safety net**

```bash
git add tests/unit/docs-kb.test.ts
git commit -m "test(docs-kb): pin KB_PAGES order and shape (failing until split lands)"
```

Expected: commit lands; the test fails until Task 3 completes.

---

## Task 3: Create the 13 page modules + registration index

**Files:**
- Create: `src/docs/kb/pages/template-syntax.ts`
- Create: `src/docs/kb/pages/control-structures.ts`
- Create: `src/docs/kb/pages/navigation.ts`
- Create: `src/docs/kb/pages/i18n.ts`
- Create: `src/docs/kb/pages/blocks.ts`
- Create: `src/docs/kb/pages/theme-json.ts`
- Create: `src/docs/kb/pages/headless-api.ts`
- Create: `src/docs/kb/pages/getting-started.ts`
- Create: `src/docs/kb/pages/common-pitfalls.ts`
- Create: `src/docs/kb/pages/include-path-resolution.ts`
- Create: `src/docs/kb/pages/custom-functions.ts`
- Create: `src/docs/kb/pages/runtime-lang.ts`
- Create: `src/docs/kb/pages/snippet-inheritance.ts`
- Create: `src/docs/kb/pages/index.ts`

**Why this size:** One page per file = mechanical, reviewable, and isolated. The index file ties them together.

**Interfaces:**
- Consumes: `DocPage` type (imported via `import type { DocPage } from "../../kb.js"`, which doesn't exist yet but will after Task 4. The type-only import compiles before `kb.ts` is changed, because TypeScript resolves the file lazily; see Risks below.)
- Produces: `KB_PAGES: readonly DocPage[]` exported from `pages/index.ts`.

**Page module shape (one of 13; bodies are copied verbatim from `src/docs/kb.ts:35-671`):**

```ts
// src/docs/kb/pages/template-syntax.ts
import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "template-syntax",
  title: "Template syntax",
  tags: ["template", "syntax", "statements", "variables", "blocks", "pipe"],
  reference: "https://automad.org/developer-guide/building-themes/template-language",
  body: `<<<copy the literal contents of TEMPLATE_SYNTAX from src/docs/kb.ts:35-78 here>>>`,
};
```

For each of the 13 pages:

| File | Slug | Source lines in `src/docs/kb.ts` |
|---|---|---|
| `pages/template-syntax.ts` | `template-syntax` | `TEMPLATE_SYNTAX` constant at lines 35-78 |
| `pages/control-structures.ts` | `control-structures` | `CONTROL_STRUCTURES` at lines 80-127 |
| `pages/navigation.ts` | `navigation` | `NAVIGATION` at lines 129-170 |
| `pages/i18n.ts` | `i18n` | `I18N` at lines 172-198 |
| `pages/blocks.ts` | `blocks` | `BLOCKS` at lines 200-276 |
| `pages/theme-json.ts` | `theme-json` | `THEME_JSON` at lines 278-310 |
| `pages/headless-api.ts` | `headless` | `HEADLESS_API` at lines 312-342 |
| `pages/getting-started.ts` | `getting-started` | `GETTING_STARTED` at lines 344-375 |
| `pages/common-pitfalls.ts` | `common-pitfalls` | `COMMON_PITFALLS` at lines 377-429 |
| `pages/include-path-resolution.ts` | `include-path-resolution` | `INCLUDE_PATH_RESOLUTION` at lines 431-498 |
| `pages/custom-functions.ts` | `custom-functions` | `CUSTOM_FUNCTIONS` at lines 500-549 |
| `pages/runtime-lang.ts` | `runtime-lang` | `RUNTIME_LANG` at lines 551-600 |
| `pages/snippet-inheritance.ts` | `snippet-inheritance` | `SNIPPET_INHERITANCE` at lines 602-671 |

The `slug`, `title`, `tags`, `reference` values for each page are taken from the corresponding object literal in `DOC_PAGES` at `src/docs/kb.ts:672-764` (use `Object.fromEntries` mentally — the object literals there are the source of truth).

- [ ] **Step 1: Create the 13 page files**

For each row in the table, create the file with the shape above. Use a here-doc / multiline template literal. Preserve every byte of the body — including trailing newlines and backticks.

If you have a script, the mechanical transformation is:

```bash
# pseudo-shell, do not run as-is:
for SLUG in template-syntax control-structures navigation i18n blocks theme-json headless-api getting-started common-pitfalls include-path-resolution custom-functions runtime-lang snippet-inheritance; do
  # create file with `body: \`...verbatim body...\`,\n`
done
```

- [ ] **Step 2: Create the index**

```ts
// src/docs/kb/pages/index.ts
import { page as templateSyntax } from "./template-syntax.js";
import { page as controlStructures } from "./control-structures.js";
import { page as navigation } from "./navigation.js";
import { page as i18n } from "./i18n.js";
import { page as blocks } from "./blocks.js";
import { page as themeJson } from "./theme-json.js";
import { page as headlessApi } from "./headless-api.js";
import { page as gettingStarted } from "./getting-started.js";
import { page as commonPitfalls } from "./common-pitfalls.js";
import { page as includePathResolution } from "./include-path-resolution.js";
import { page as customFunctions } from "./custom-functions.js";
import { page as runtimeLang } from "./runtime-lang.js";
import { page as snippetInheritance } from "./snippet-inheritance.js";

export const KB_PAGES: readonly DocPage[] = [
  templateSyntax,
  controlStructures,
  navigation,
  i18n,
  blocks,
  themeJson,
  headlessApi,
  gettingStarted,
  commonPitfalls,
  includePathResolution,
  customFunctions,
  runtimeLang,
  snippetInheritance,
] as const;
```

- [ ] **Step 3: Run the registration test, watch it fail (DocPage not yet exported from kb.ts)**

Run: `npx vitest run tests/unit/docs-kb.test.ts`
Expected: still fails because `import type { DocPage } from "../../kb.js"` doesn't resolve. **This is expected** — the import resolves once Task 4 lands. The 14 new files exist; the type comes next.

If `tsc` complains about unresolved types here, that's the cycle: skip; Task 4 fixes it by re-exporting `DocPage` from `kb.ts`.

- [ ] **Step 4: Commit the page modules**

```bash
git add src/docs/kb/pages/
git commit -m "refactor(docs): extract 13 KB pages into per-page modules"
```

Expected: 14 new files committed; the test from Task 2 still fails; nothing else is broken.

---

## Task 4: Rewire `src/docs/kb.ts` to read from `KB_PAGES`

**Files:**
- Modify: `src/docs/kb.ts` (full rewrite, 829 → ~110 LOC)

**Why:** The current `kb.ts` is a self-contained module; once the pages live elsewhere, it has only one job left: be the public API.

**Interfaces:**
- Consumes: `KB_PAGES` from `pages/index.ts`.
- Produces: same public types and functions as before.

- [ ] **Step 1: Replace the contents of `src/docs/kb.ts`**

```ts
import { AutomadMcpError } from "../errors.js";
import { KB_PAGES } from "./kb/pages/index.js";

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly reference: string;
  readonly body: string;
}

export interface DocSummary {
  slug: string;
  title: string;
  tags: readonly string[];
  reference: string;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  score: number;
  snippet: string;
}

export function listDocs(): DocSummary[] {
  return KB_PAGES.map(({ slug, title, tags, reference }) => ({ slug, title, tags, reference }));
}

export function getDoc(slug: string): DocPage {
  const page = KB_PAGES.find((p) => p.slug === slug);
  if (!page) {
    throw new AutomadMcpError("NOT_FOUND", `unknown doc page '${slug}'`, { available: KB_PAGES.map((p) => p.slug) });
  }
  return page;
}

const DEFAULT_LIMIT = 5;
const SNIPPET_PADDING = 60;
const SNIPPET_TAIL = 140;
const SCORE_TITLE = 5;
const SCORE_TAG = 3;

export function searchDocs(query: string, limit = DEFAULT_LIMIT): DocSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    throw new AutomadMcpError("VALIDATION", "query must not be empty");
  }
  const hits: DocSearchHit[] = [];
  for (const page of KB_PAGES) {
    const titleLc = page.title.toLowerCase();
    const tagsLc = page.tags.join(" ").toLowerCase();
    const bodyLc = page.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      if (titleLc.includes(term)) score += SCORE_TITLE;
      if (tagsLc.includes(term)) score += SCORE_TAG;
      score += bodyLc.split(term).length - 1;
    }
    if (score > 0) {
      hits.push({ slug: page.slug, title: page.title, score, snippet: buildSnippet(page.body, terms) });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return hits.slice(0, Math.max(1, limit));
}

function buildSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - SNIPPET_PADDING);
  const end = Math.min(body.length, at + SNIPPET_TAIL);
  const raw = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${raw}${end < body.length ? "…" : ""}`;
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all 323 tests green, including the new `KB_PAGES registration` block from Task 2.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke-compare against the baseline**

Run:
```bash
npm run build
node --input-type=module -e '
import { listDocs, getDoc, searchDocs } from "./dist/docs/kb.js";
const out = {
  count: listDocs().length,
  first: listDocs()[0].slug,
  slugs: listDocs().map(d => d.slug),
  getTemplateSyntax: getDoc("template-syntax").tags,
  getUnknown: (() => { try { getDoc("does-not-exist"); return "NO_THROW"; } catch (e) { return { code: e.code, msg: e.message, available: e.details?.available }; } })(),
  searchSnippet: searchDocs("snippet").map(h => h.slug),
  searchI18n: searchDocs("i18n").map(h => h.slug),
  searchEmpty: (() => { try { searchDocs(""); return "NO_THROW"; } catch (e) { return e.code; } })(),
};
console.log(JSON.stringify(out, null, 2));
' > /tmp/kb-after.json
diff /tmp/kb-baseline.json /tmp/kb-after.json
```

Expected: `diff` produces no output (byte-identical). If it shows differences, STOP and investigate before committing.

- [ ] **Step 5: Commit**

```bash
git add src/docs/kb.ts
git commit -m "refactor(docs): shrink kb.ts to public API, read from KB_PAGES"
```

---

## Task 5: Delete `src/page-format.ts`

**Files:**
- Delete: `src/page-format.ts`
- Delete: `tests/unit/page-format.test.ts`

**Why separate task:** The deletions are independent of the KB move. If something here breaks (unexpected consumer), it doesn't take down Tasks 3-4.

- [ ] **Step 1: Verify no live consumer exists**

Run: `grep -rE 'parsePage|serializePage|EditorJsBlock|NamedBlock|ParsedPage|VAR_RE|BLOCK_RE' src/`
Expected: only `src/page-format.ts` itself (and `src/page-format.ts` matches the pattern but won't appear because grep on `src/` returns files in `src/`).

- [ ] **Step 2: Delete the files**

Run: `git rm src/page-format.ts tests/unit/page-format.test.ts`
Expected: both staged for deletion.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: same count minus the deleted test file's tests (was 4 tests; new total ~319, exact number depends on Task 2's pin and any tests added). All other tests green.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove unused page-format.ts (no live consumer)"
```

---

## Task 6: Final verification + drift sync

**Files:**
- Possibly modify: `README.md`, `CLAUDE.md`, `CHANGELOG.md` (only if autogenerated count markers changed)

**Why last:** A guard rail. If any drift sneaks in (test count moved, file list comments stale), this catches it before merge.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: all tests green.

- [ ] **Step 2: Run the docs sync**

Run: `npm run docs:sync`
Expected: regenerates `AUTOGEN` markers. If `KB_PAGES` count is not surfaced in README/CLAUDE.md, the script will not touch it. If `TESTCOUNT` changed (it did — page-format.test.ts is gone), the script updates the marker.

- [ ] **Step 3: If the sync changed anything, commit it**

Run: `git status`
Expected: either clean, or `README.md`/`CLAUDE.md`/`CHANGELOG.md` modified.

If modified:
```bash
git add README.md CLAUDE.md CHANGELOG.md
git commit -m "chore(docs): refresh autogenerated markers after KB refactor"
```

- [ ] **Step 4: Smoke-probe the production binary once more**

Run:
```bash
npm run build
node --input-type=module -e '
import { listDocs, getDoc, searchDocs } from "./dist/docs/kb.js";
console.log("count:", listDocs().length, "first:", listDocs()[0].slug);
console.log("search \"snippet\" slugs:", searchDocs("snippet").map(h => h.slug).join(","));
console.log("search \"i18n\" slugs:", searchDocs("i18n").map(h => h.slug).join(","));
console.log("unknown slug throws:", (() => { try { getDoc("nope"); } catch (e) { return e.code; } })());
'
```

Expected: `count: 13`, `first: template-syntax`, search-results list identical to the baseline.

---

## Self-Review Notes

**Spec coverage:**
- "Move every Markdown constant" → Tasks 3 + 4.
- "KB_PAGES in current DOC_PAGES order" → Task 2 pin + Task 3 index.
- "Public types unchanged" → Task 4 (full re-derivation, but fields and order identical to original `kb.ts:13-33`).
- "Public function signatures unchanged" → Task 4 (signatures copied verbatim from original).
- "`BY_SLUG → find`" → Task 4.
- "`countOccurrences → inline split`" → Task 4.
- "Magic numbers → constants" → Task 4.
- "Delete `page-format.ts` + its test" → Task 5.
- "Tests: docs-kb test green, KB_PAGES.length pin added" → Task 2.
- "Smoke check matches pre-refactor output" → Task 1 baseline + Task 4 step 4.
- "All other refactors out of scope" → no task touches them.

**Placeholder scan:** No `TBD`/`TODO`/`similar to Task N`. Every code block is complete. Every shell command is the actual command.

**Type consistency:** `DocPage`, `DocSummary`, `DocSearchHit` are defined once in Task 4 and used consistently in Task 2's test import (note: Task 2 imports `DocPage` indirectly via `KB_PAGES: readonly DocPage[]` — the test only references `page.slug`/`page.title`/`page.tags`/`page.body`, all of which exist on `DocPage` as defined in Task 4). No type drift between tasks.

**Risks explicitly called out:**
- TypeScript cycle (`pages/*.ts` import type from `kb.ts` while `kb.ts` imports from `pages/index.ts`): resolved by `import type` in page modules. Task 4 makes the type resolvable, so Task 3's intermediate state (page files committed but `kb.ts` not yet rewired) is fine.
- Order drift: Task 2's test pin catches re-ordering.
- Body byte loss: Task 1 baseline + Task 4 smoke diff catches.

**Out of scope confirmation:** Tasks 1-6 do not touch `registry.ts`, `client.ts`, `domains/pages.ts`, `theme/schema.ts`, `theme/diff.ts`, `src/domains/site.ts`, `src/domains/config.ts`, or any other file not in the task's `Files:` list.
