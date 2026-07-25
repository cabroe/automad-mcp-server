# KB Pages Split + Local Simplifications

**Date:** 2026-07-25
**Status:** Draft for user review

## Goal

Split the monolithic `src/docs/kb.ts` (829 LOC) into per-page modules under
`src/docs/kb/pages/`, leaving only the public API (types + `listDocs` /
`searchDocs` / `getDoc`) in `kb.ts`. While the file is being broken apart,
remove dead code (`src/page-format.ts` and its test) and apply small,
behaviour-preserving simplifications to the search/snippet helpers. The public
API of the KB module — and the search output the user sees — must not change.

## Scope

In scope:

- Move every Markdown constant in `src/docs/kb.ts` into its own module under
  `src/docs/kb/pages/<slug>.ts`. Each module exports a single `DocPage`
  constant.
- A new `src/docs/kb/pages/index.ts` imports every page and exports
  `KB_PAGES: readonly DocPage[]` in the current `DOC_PAGES` order.
- `src/docs/kb.ts` keeps the type definitions (`DocPage`, `DocSummary`,
  `DocSearchHit`) and the three exported functions; it now reads from
  `KB_PAGES` instead of inlined constants.
- Replace the internal `BY_SLUG: ReadonlyMap<string, DocPage>` with a linear
  `.find()` lookup on `KB_PAGES` (≤20 entries — O(n) is fine, and one source
  of truth is clearer than two).
- Inline the `countOccurrences` helper into the one call site, using the
  standard `haystack.split(term).length - 1` idiom. The empty-term guard stays.
- Promote the four tuning literals (60, 140, 5, 3) to named module-local
  constants.
- Delete `src/page-format.ts` and `tests/unit/page-format.test.ts`. Neither
  has a live consumer (verified by grep on the public symbols
  `parsePage | serializePage | EditorJsBlock | NamedBlock | ParsedPage |
  VAR_RE | BLOCK_RE`).

Out of scope:

- Any change to the Markdown bodies themselves.
- Any change to the search scoring or the snippet geometry (values stay the
  same; only the names change).
- Any change to `src/domains/docs.ts`, `src/server.ts`, or
  `src/resources/themes.ts` (consumers of the public API).
- All other refactors called out in the prior list
  (`registry.ts`, `client.ts`, `domains/pages.ts`, `theme/schema.ts`,
  `theme/diff.ts`, `site.ts`/`config.ts` `BootstrapData` duplication,
  `pages.ts` split). Each gets its own spec.

## New structure

```
src/docs/
  kb.ts                          (types + listDocs/searchDocs/getDoc; ~70 LOC)
  kb/
    pages/
      index.ts                   (KB_PAGES — the registration)
      template-syntax.ts
      control-structures.ts
      navigation.ts
      i18n.ts
      blocks.ts
      theme-json.ts
      headless-api.ts
      getting-started.ts
      common-pitfalls.ts
      include-path-resolution.ts
      custom-functions.ts
      runtime-lang.ts
      snippet-inheritance.ts
```

The directory `src/docs/kb/` is the new home for page modules; `kb.ts` stays
where it is because it is the public entry point used by
`src/domains/docs.ts`, `src/server.ts`, and the tests. Consumers do not move.

## Page module shape

```ts
// src/docs/kb/pages/template-syntax.ts
import type { DocPage } from "../../kb.js";

export const page: DocPage = {
  slug: "template-syntax",
  title: "Template syntax",
  tags: ["template", "syntax", "statements", "variables", "blocks", "pipe"],
  reference: "https://automad.org/developer-guide/building-themes/template-language",
  body: `# Template syntax\n\nAutomad v2 templates mix three distinct constructs...`,
};
```

The `import type` is a TypeScript-only import — it does not create a runtime
cycle between `pages/*.ts` and `kb.ts`. (Runtime imports go one way:
`kb.ts → pages/index.ts`.)

## Registration

```ts
// src/docs/kb/pages/index.ts
import { page as templateSyntax } from "./template-syntax.js";
import { page as controlStructures } from "./control-structures.js";
// ... eleven more
export const KB_PAGES: readonly DocPage[] = [
  templateSyntax,
  controlStructures,
  // ... eleven more — order matches the current DOC_PAGES order in kb.ts
] as const;
```

The array order is the search/list order. Adding a new page is two lines
(import + array entry). No bundler magic, no `import.meta.glob`, no
auto-discovery — that is consistent with the rest of the repo's "static
imports only" rule.

## `src/docs/kb.ts` after the move

The file shrinks from 829 LOC to ~70 LOC. Structure:

```ts
import { AutomadMcpError } from "../errors.js";
import { KB_PAGES } from "./kb/pages/index.js";

export interface DocPage { /* unchanged */ }
export interface DocSummary { /* unchanged */ }
export interface DocSearchHit { /* unchanged */ }

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
  if (terms.length === 0) throw new AutomadMcpError("VALIDATION", "query must not be empty");

  const hits: DocSearchHit[] = [];
  for (const page of KB_PAGES) {
    const titleLc = page.title.toLowerCase();
    const tagsLc = page.tags.join(" ").toLowerCase();
    const bodyLc = page.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (term) {
        if (titleLc.includes(term)) score += SCORE_TITLE;
        if (tagsLc.includes(term)) score += SCORE_TAG;
        score += bodyLc.split(term).length - 1;
      }
    }
    if (score > 0) hits.push({ slug: page.slug, title: page.title, score, snippet: buildSnippet(page.body, terms) });
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

## Simplifications

| What | Why | Risk |
|---|---|---|
| `BY_SLUG: ReadonlyMap` → `KB_PAGES.find(...)` | One source of truth, no parallel index to keep in sync | None — ≤20 entries, O(n) is fine |
| `countOccurrences(haystack, needle)` → inline `haystack.split(term).length - 1` | Standard idiom, one less helper | Identical output, with the empty-term guard kept as `if (term) ...` |
| `60` / `140` / `5` / `3` → named constants | Tuning values are reviewable in one place | None — values unchanged |

These are local, mechanical changes to the `kb.ts` body that survive the
move. They are bundled into this spec because they ride on the same diff as
the move and are obvious wins, not because they are interesting in
isolation.

## Deletions

- `src/page-format.ts` — not imported by any non-test file
  (`grep -rE 'parsePage|serializePage|EditorJsBlock|NamedBlock|ParsedPage|VAR_RE|BLOCK_RE' src`
  returns only the file itself and its test).
- `tests/unit/page-format.test.ts` — its only subject is the file above.

## What does not change

- All public types: `DocPage`, `DocSummary`, `DocSearchHit`.
- All public function signatures: `listDocs()`, `getDoc(slug)`,
  `searchDocs(query, limit?)`.
- `AutomadMcpError` codes and messages: `NOT_FOUND` for unknown slug,
  `VALIDATION` for empty query.
- Search output: score formula, hit ordering (`score DESC, slug ASC`),
  default limit (`5`), minimum results (`1`).
- Snippet geometry: 60 chars before the first match, 140 after, ellipses
  added only when truncated.
- `KB_PAGES` order: byte-identical to the current `DOC_PAGES` order.

### Drift watchpoint (not a behaviour change)

The `getDoc` `NOT_FOUND` error's `details.available` is still `string[]` in
the same order as before (the order comes from `KB_PAGES` in
`pages/index.ts`, which mirrors the current `DOC_PAGES` order). The shape
moves from `[...BY_SLUG.keys()]` to `KB_PAGES.map((p) => p.slug)` —
semantically identical, no consumer should be parsing it. Implementation
plan adds an explicit assertion on the order to make this visible at
review time.

## Tests

Existing assertions in `tests/unit/docs-kb.test.ts` continue to pass
unchanged — the public surface is identical.

Add one new assertion to pin the registration: `KB_PAGES.length === 13` (or
whatever the final count is). A new page file without a registration entry
fails this test at boot, which is the safety net for "static array of
imports" registration.

A diff-comparison smoke check after the move:

```bash
# before:
node -e 'import("./dist/docs/kb.js").then(m => { console.log(m.searchDocs("snippet").map(h => h.slug)); })'
# after: must print the same list of slugs
```

This guards against an accidental re-ordering during the move.

## Risks

- **TypeScript cycle**: `pages/*.ts` import `DocPage` from `kb.ts`, and
  `kb.ts` imports `KB_PAGES` from `pages/index.ts`. The `import type` in
  the page modules is a TypeScript-only construct — it disappears at compile
  time, so there is no runtime cycle. Type-only cycles are legal in TS and
  the compiler accepts them silently. Verified by inspection; covered
  indirectly by `npx tsc --noEmit`.
- **Order drift during the move**: the `KB_PAGES` array must be authored in
  the same order as the current `DOC_PAGES` array. The smoke-check above
  catches it; the existing `docs-kb.test.ts` assertions on the
  `template-syntax` page (which is the first entry) also catch a reorder
  of the head.
- **Body trimming on move**: mechanical refactors occasionally lose a
  trailing newline or a backtick. Caught by `git diff -w` review and by
  `tests/unit/docs-kb.test.ts` if any of its assertions reference body
  content (they currently do not; the smoke-check above is the strongest
  guard).

## Out of scope (explicit)

- Any change to the Markdown bodies.
- Any change to `src/domains/docs.ts`, `src/server.ts`,
  `src/resources/themes.ts`.
- Any change to the public types' field order.
- All other refactors on the original list
  (`registry.ts`, `client.ts`, `domains/pages.ts`, `theme/schema.ts`,
  `theme/diff.ts`, `BootstrapData` duplication, `pages.ts` split). Each
  gets its own design spec.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test` — all 323 tests green; `tests/unit/docs-kb.test.ts` includes
   the new `KB_PAGES.length` pin.
3. `npm run lint` — clean.
4. Smoke probe: `npm run build && node -e '...'  ` matches the
   pre-refactor output for `listDocs().length`, `listDocs()[0].slug`, and
   `searchDocs("snippet")`.
5. `git diff src/docs/kb.ts` shows only:
   - the new import from `./kb/pages/index.js`,
   - removal of the inlined Markdown constants and the `DOC_PAGES`
     literal,
   - the `BY_SLUG → .find` change,
   - the `countOccurrences → split` change,
   - the magic-number-to-constant renames.
   No logic changes elsewhere.
