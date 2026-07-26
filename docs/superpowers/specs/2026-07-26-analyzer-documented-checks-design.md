# Analyzer: Implement the Two Documented Checks

**Date:** 2026-07-26
**Status:** Draft for user review

## Problem

Two bundled knowledge-base pages describe `automad_theme.analyze` behaviour
that does not exist in the code.

`src/docs/kb/pages/snippet-inheritance.ts` ("## Lint check"):

> `automad_theme.analyze` walks the call graph from `default.php` (and any
> other root templates) and reports any `<@ main @>` invocation that has no
> reachable `<@~ snippet main ~@>` definition.

`src/docs/kb/pages/runtime-lang.ts` ("## Analyzer warning"):

> `automad_theme.analyze` warns when a template uses `@{ :lang }` but the
> theme has no `i18n/` directory (likely forgotten step 3), or vice versa.

`ThemeAnalyzer` emits a fixed set of finding codes, and neither documented
check is among them:

- `analyze()`: `THEME_MANIFEST_MISSING`, `I18N_JSON_INVALID`,
  `DUPLICATE_I18N_LOCALE`, `I18N_DIRECTORY_EMPTY`, `THEME_MASKS_INVALID`,
  `SOURCE_TRUNCATED`, `STARTER_KIT_STRUCTURE_DETECTED`,
  `BLOCK_FIELD_DETECTED`, `BUILD_SCRIPT_DETECTED`
- `validate()` adds: `THEME_NAME_MISSING`, `THEME_TEMPLATE_MISSING`,
  `PACKAGE_METADATA_MISMATCH`, `COMPOSER_METADATA_MISMATCH`,
  `FIELD_NOT_MASKED`, `MASK_FIELD_UNUSED`, `STARTER_BUILD_INCOMPLETE`,
  `PAGE_DATA_TEMPLATE_REQUIRED`

`I18N_DIRECTORY_EMPTY` is *not* the documented lang check: it fires when an
`i18n/` directory exists but holds no JSON, never on `@{ :lang }` usage.

**Why this matters more than a missing feature.** An agent reads
`automad_docs.get('snippet-inheritance')`, believes `theme.analyze` catches
the empty-`<main>` bug, runs `theme.validate`, receives a clean report, and
ships a theme that renders an empty `<main>` with HTTP 200. A false all-clear
is worse than silence. This is the exact one-hour failure recorded as A5 in
the field bug report.

## Goal

Implement both checks and reword both pages so every documented claim is
backed by shipped code. Add a narrow regression guard so this class of drift
fails a test instead of reaching a user.

## Scope

In scope:

- Collect three new signals during the analyzer's existing source pass.
- Emit `MAIN_SNIPPET_UNDEFINED` and `LANG_WITHOUT_I18N` from
  `ThemeAnalyzer.validate()`.
- Expose the collected signals on `ThemeAnalysis` (additive fields).
- Reword `snippet-inheritance.ts` and `runtime-lang.ts` to match shipped
  behaviour exactly.
- Pin both codes in `tests/unit/docs-drift.test.ts`.
- Cover both checks (firing and not-firing) in
  `tests/unit/theme-analyzer.test.ts`.

Out of scope:

- Include-path resolution linting (the A3 lint rule). It is a prerequisite
  for true call-graph reachability and gets its own spec.
- `live_render` / rendered-page fetching (A9).
- A "start here" KB orientation page (B7).
- A `validate_page({ pageData })` tool (B6 tooling; the *rule* is already
  documented and already emitted as `PAGE_DATA_TEMPLATE_REQUIRED`).
- A theme-guardrails MCP prompt.
- Anything in the separate `automad_docs` MCP server — `find_theme_issues`,
  `validate_theme`, `check_broken_links`, `get_snippets`,
  `get_template_syntax`, `generate_i_n`, `get_starter_kit_file` and
  `live_preview` are that server's tools, not this repository's. In
  particular the `def()` nested-quote false positive (bug report A1/B3)
  cannot be fixed here: this analyzer has no `def()` check at all.

## Current behaviour the design builds on

`ThemeAnalyzer.analyze()` (`src/theme/analyzer.ts:60-74`) already reads every
`templates + components + blocks` source exactly once, scans it with
`FIELD_RE`, and then **discards the text**. Adding regex scans to that loop
costs no extra I/O.

`FIELD_RE` is `/@\{\s*([+A-Za-z][A-Za-z0-9_-]*)\b/g`. The first character
class requires `+` or a letter, so colon-prefixed runtime variables such as
`@{ :lang }` are never captured and never appear in `analysis.fields`. The
lang check therefore needs its own pattern; it cannot reuse the field list.

The analyzer already splits responsibilities: `analyze()` emits structural
and parse issues, `validate()` emits semantic lint findings derived from the
collected data (`addFieldFindings` is the model — fields are gathered in
`analyze()`, findings raised in `validate()`). Both new checks follow that
split.

Precedent for implementing a bug-report item as a finding already exists at
`src/theme/analyzer.ts:103-114` (`PAGE_DATA_TEMPLATE_REQUIRED`), including
the convention of pointing the message at `automad_docs.get('<slug>')`.

## Design

### Collected signals

Three additions to `ThemeAnalysis`, populated inside the existing loop:

```ts
export interface ThemeAnalysis {
  // ... existing fields unchanged ...
  /** Files that define and that invoke the canonical `main` snippet. */
  mainSnippet: { definedIn: string[]; invokedIn: string[] };
  /** Files referencing the runtime variable `@{ :lang }`. */
  runtimeLangFiles: string[];
}
```

Patterns, applied to the same file set the field scan already covers
(`templates`, `components`, `blocks`):

| Signal | Pattern |
|---|---|
| definition | `/<@~?\s*snippet\s+main\s*~?@>/` |
| invocation | `/<@~?\s*main\s*~?@>/` |
| runtime lang | `/@\{\s*:lang\b/` |

The two `main` patterns cannot collide: in `<@~ snippet main ~@>` the text
following `<@~` is `snippet`, not `main`, so the invocation pattern finds no
match at that position. `<@ mainNav @>` does not match either, because the
character after `main` must be whitespace, `~`, or `@`.

Array order is insertion order, which is deterministic: `discoverFiles()`
sorts its input and buckets it in order, and the loop walks
`templates → components → blocks`. Tests can rely on it.

These fields are exposed rather than kept private because an agent
diagnosing the finding needs to know *which* files invoke `main`, mirroring
how `fieldSources` is already surfaced.

### Check 1 — `MAIN_SNIPPET_UNDEFINED`

Raised in `validate()` when
`mainSnippet.invokedIn.length > 0 && mainSnippet.definedIn.length === 0`.

- severity: `warning`
- path: `mainSnippet.invokedIn[0]`
- message: `template invokes <@ main @> but no <@~ snippet main ~@> is defined in this theme — the rendered <main> will be empty; see automad_docs.get('snippet-inheritance')`

**Theme-wide, not call-graph — deliberately.** Correct reachability requires
resolving `<@ include @>` paths, including the rule that includes inside a
snippet body resolve against the *defining* file's directory. That resolver
does not exist yet and is a separate work item. A half-correct resolver would
emit false positives at precisely the users who trust the tool. The
theme-wide rule does carry false-positive risk: the original plan scoped
the definition scan to `templates`, `components` and `blocks`, which
false-positived on snippets written by this repo's own `theme.generate`
into `snippets/${name}.php`. A user ruling on 2026-07-26 widened the
definition scan to `lib/` and `snippets/`, and the shipped check now
walks those directories too. The original report's case (a custom theme
that inlined its HTML in `page.php` and never defined `main`) is still
caught verbatim.

The code is named `MAIN_SNIPPET_UNDEFINED`, not `MAIN_SNIPPET_UNREACHABLE`:
"unreachable" would assert graph analysis this check does not perform, which
is the very defect being fixed. `MAIN_SNIPPET_UNREACHABLE` remains free for
the stronger check once include resolution lands.

### Check 2 — `LANG_WITHOUT_I18N`

Raised in `validate()` when
`runtimeLangFiles.length > 0 && Object.keys(analysis.translations).length === 0`.

- severity: `warning`
- path: `runtimeLangFiles[0]`
- message: `template uses @{ :lang } but the theme ships no i18n/*.json translations — see automad_docs.get('runtime-lang')`

**One direction only.** The documented "or vice versa" (translations present,
`@{ :lang }` absent) is deleted from the docs rather than implemented: a
theme may legitimately ship `i18n/*.json` and route every string through
`<@ t { key: '...' } @>` without ever writing `@{ :lang }`. Warning on that
would be a false positive.

**Explicit `def(...)` fallback — no warning.** A reference of the form
`@{ :lang | def('en') }` deliberately does not trigger `LANG_WITHOUT_I18N`.
`src/theme/generate.ts:119` emits exactly that form for the generated
`<html lang="...">` attribute, and the KB page documents it as the canonical
single-language choice. Warning on it would fire on the documented happy
path, which is the same false-positive class the check is designed to avoid.

`translations` is used as the i18n signal rather than `files.i18n` because
`translations` only contains locales that parsed successfully — a theme whose
only `i18n/de.json` is malformed has no usable translations and should still
be warned.

### Strict-mode constraint on `path`

`tsconfig.json` enables both `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, and `ThemeFinding.path` is optional
(`path?: string`). A `length > 0` guard does not narrow `invokedIn[0]` to
`string`, so writing `path: mainSnippet.invokedIn[0]` fails to compile —
`string | undefined` is not assignable to an `exactOptionalPropertyTypes`
optional. Both checks must bind the first entry to a local and branch on it,
e.g. `const [first] = mainSnippet.invokedIn; if (first) { ... path: first }`.
CLAUDE.md forbids inline casts as the workaround.

### Documentation changes

`src/docs/kb/pages/snippet-inheritance.ts`, "## Lint check" — replace the
call-graph claim with the shipped behaviour, naming the code:

> `automad_theme.validate` reports `MAIN_SNIPPET_UNDEFINED` when a template
> invokes `<@ main @>` but no file in the theme defines
> `<@~ snippet main ~@>`. The check is theme-wide; it does not yet follow
> the include graph, so a definition that exists but is unreachable from a
> given root template is not detected.

`src/docs/kb/pages/runtime-lang.ts`, "## Analyzer warning" — name the code
and drop "or vice versa":

> `automad_theme.validate` reports `LANG_WITHOUT_I18N` when a template uses
> `@{ :lang }` but the theme ships no parsable `i18n/*.json` translations.

Both pages currently attribute the checks to `automad_theme.analyze`. The
findings are raised by `validate()`, so the rewritten text says
`automad_theme.validate`. (`analyze` returns the underlying signals on
`mainSnippet` / `runtimeLangFiles`, but the pages do not document those
fields — they attribute the warning to `validate` and say nothing else.)

### Regression guard

`tests/unit/docs-drift.test.ts` exists to stop documentation drifting from
code reality, and pins facts by reading artifacts as text (beta-version
regex, count markers). A new `describe("KB pages ↔ analyzer drift")` block
follows the same style: for each of the two pages, assert that the finding
code it names is present in `src/theme/analyzer.ts` source text.

This is a text-level pin, not a behavioural one — the behavioural coverage
lives in `theme-analyzer.test.ts`. Its job is narrowly to fail when a KB page
names a code the analyzer cannot emit, which is exactly the defect that
produced this task.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| `main` check scope | Theme-wide | Zero false positives; call-graph needs the include resolver (separate spec) |
| Severity | `warning` for both | `error` flips `validate.ok` to `false`, a contract change for existing consumers |
| "or vice versa" lang warning | Dropped from docs, not implemented | Legitimate themes would be falsely flagged |
| Code name | `MAIN_SNIPPET_UNDEFINED` | `…UNREACHABLE` would claim analysis the check does not do |
| Finding location | `validate()`, data in `analyze()` | Matches the existing `addFieldFindings` split |

## Tests

`tests/unit/theme-analyzer.test.ts`, using the file's existing
`writeTheme(slug, files)` helper and `analyzer()` factory:

1. Template invokes `<@ main @>`, nothing defines it → `MAIN_SNIPPET_UNDEFINED`
   present, severity `warning`.
2. `default.php` invokes `<@ main @>` and a *different* file
   (`components/page.php`) defines `<@~ snippet main ~@>` → code absent.
   This is the case that pins "theme-wide", not "same-file".
3. Template uses `@{ :lang }`, no `i18n/*.json` → `LANG_WITHOUT_I18N` present.
4. Template uses `@{ :lang }` with a valid `i18n/de.json` → code absent.

`tests/unit/docs-drift.test.ts`: both codes named in their KB pages appear in
`analyzer.ts`.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test` — all tests green, including the four new analyzer cases and
   the two new drift assertions.
3. `npm run lint` — clean.
4. Behavioural smoke: build a scratch theme that invokes `<@ main @>` without
   defining it and uses `@{ :lang }` with no `i18n/`, run
   `automad_theme.validate` against it, and confirm both codes appear in
   `findings` with severity `warning`.
5. Re-read both KB pages and confirm every sentence describing analyzer
   behaviour matches an assertion in `theme-analyzer.test.ts`.

## Risks

- **Syntax coverage.** The patterns assume `<@ … @>` with optional `~`
  trim markers. If a theme writes the snippet tag in a form not covered
  (unusual internal whitespace, a form Automad accepts that these regexes
  miss), `definedIn` stays empty and `MAIN_SNIPPET_UNDEFINED` fires as a
  false positive. Mitigated by accepting arbitrary `\s+` between `snippet`
  and `main` and optional `~` on both sides; the test suite pins the
  `<@~ … ~@>` and `<@ … @>` forms.
- **`ThemeAnalysis` shape change.** Additive only. `ThemeSchemaBuilder`
  reads named fields, so it is unaffected; `theme.analyze` output gains two
  keys, which is a superset of the previous contract.
- **Message text in docs.** The KB pages now quote finding codes. If a code
  is later renamed without updating the pages, the drift test fails — which
  is the intended behaviour.

## Out of scope (explicit)

Include-path resolution lint; `live_render`; the "start here" KB page; a
`validate_page` tool; a theme-guardrails prompt; all `automad_docs` server
issues including the `def()` nested-quote false positive.

## Amendments

**2026-07-26.** The user ruling on this date deliberately overrode the
plan's "no new file I/O" constraint. Check 1's definition scan was widened
to include `lib/` and `snippets/` after the original templates/components/blocks
scope false-positived on snippets written by this repo's own
`theme.generate` (`snippets/${name}.php`). That change added directory reads
to the analyzer pass, which the original plan had ruled out. The KB page
for `snippet-inheritance` was rewritten to match. The drift test
(`tests/unit/docs-drift.test.ts`) now pins both finding codes against the
analyzer source.
