# Tranche 3: Page Utilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new MCP actions on `automad_pages` (`breadcrumbs`, `discard_draft`, `publication_state`, `recent`) wiring v2's `PageController::breadcrumbs`, `PageController::discardDraft`, `PageController::getPublicationState`, and the existing `PageCollectionController::getRecentlyEdited` (which `pages.list` already uses).

**Architecture:** No new files, no new tools, no new dependencies. Extend the capability registry (4 new entries) and `domains/pages.ts` (4 new `case` arms; `recent` reuses the `list` body). Tests follow the existing mock-client + WriteGuard pattern.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Vitest, existing `client.post`. v2 wire format `__csrf__`+`__json__` injected by `client.ts`.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. No `any`. No non-null `!` assertions.
- ESM imports: explicit `.js` extensions.
- No new runtime dependencies.
- All new destructive actions go through `WriteGuard` (target string: `input.url ?? '/'`).
- Commit after each task. Do NOT run project-wide `npm run verify` until the final task; run only the specific test file per task.
- The 4 new actions, exact action names, exact v2 URLs, and HTTP methods:
  - `automad_pages.breadcrumbs`       (read)        → `POST /_api/page/breadcrumbs`             body `{ url }`
  - `automad_pages.publication_state` (read)        → `POST /_api/page/get-publication-state`   body `{ url }`
  - `automad_pages.recent`            (read)        → `POST /_api/page-collection/get-recently-edited` body `{}`  (same as `list`)
  - `automad_pages.discard_draft`     (destructive) → `POST /_api/page/discard-draft`           body `{ url }`

---

### Task 1: Read actions — `breadcrumbs`, `publication_state`, `recent`

**Files:**
- Modify: `src/capabilities/registry.ts` (add 3 new entries to `automad_pages.actions`).
- Modify: `src/domains/pages.ts` (`ACTION_MAP` + 3 new `case` arms).
- Test: `tests/unit/domains/pages.test.ts` (5 tests: 3 happy + 2 missing-url).

**Interfaces:**
- `breadcrumbs(url)` → `client.post('/_api/page/breadcrumbs', { url })` → v2 response.
- `publication_state(url)` → `client.post('/_api/page/get-publication-state', { url })` → v2 response.
- `recent()` → `client.post('/_api/page-collection/get-recently-edited', {})` → v2 response (same as `list`).

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/pages.test.ts` (inside the existing `describe('handlePages (v2 /_api)', ...)`):

```ts
  it('breadcrumbs requires url and POSTs /_api/page/breadcrumbs', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'breadcrumbs' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/', title: 'Home' }]);
    const out = await handlePages({ action: 'breadcrumbs', url: '/foo' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/', title: 'Home' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page/breadcrumbs', { url: '/foo' });
  });

  it('publication_state requires url and POSTs /_api/page/get-publication-state', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'publication_state' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hasDraft: true });
    const out = await handlePages(
      { action: 'publication_state', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ hasDraft: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page/get-publication-state', { url: '/foo' });
  });

  it('recent POSTs /_api/page-collection/get-recently-edited', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/x' }]);
    const out = await handlePages({ action: 'recent' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/x' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page-collection/get-recently-edited', {});
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/pages.test.ts -t "breadcrumbs\|publication_state\|recent"`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Extend registry and domain**

In `src/capabilities/registry.ts`, inside `automad_pages.actions` (after the existing `history_restore` line, before the `update_rename` internal), add:

```ts
      breadcrumbs: read('Get the breadcrumb trail for a page.'),
      publication_state: read('Get the publication state (draft / published) for a page.'),
      recent: read('List recently edited pages (v2 page-collection/get-recently-edited, alias of list).'),
```

In `src/domains/pages.ts`, extend `ACTION_MAP`:

```ts
  breadcrumbs: 'pages.breadcrumbs',
  publication_state: 'pages.publication_state',
  recent: 'pages.recent',
  discard_draft: 'pages.discard_draft',
```

In the same file, add to the switch (after the existing `history_restore` arm, before the closing `}` of the switch):

```ts
    case 'breadcrumbs': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for breadcrumbs');
      return client.post(`${API_BASE}/page/breadcrumbs`, { url: input.url });
    }
    case 'publication_state': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for publication_state');
      }
      return client.post(`${API_BASE}/page/get-publication-state`, { url: input.url });
    }
    case 'recent':
      return client.post(`${API_BASE}/page-collection/get-recently-edited`, {});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: 3 new tests PASS; previous pages tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts src/domains/pages.ts tests/unit/domains/pages.test.ts
git commit -m "feat(pages): add breadcrumbs + publication_state + recent actions"
```

---

### Task 2: `discard_draft` (destructive action)

**Files:**
- Modify: `src/capabilities/registry.ts` (add `discard_draft` entry — already done in Task 1 alongside the read actions? No — Task 1 only added reads. Add `discard_draft` here).
- Modify: `src/domains/pages.ts` (`ACTION_MAP` already has `discard_draft` from Task 1; add the `case` arm).
- Test: `tests/unit/domains/pages.test.ts` (2 tests: happy + confirm-token-pending + 1 missing-url).

**Interfaces:**
- `discard_draft(url)` → `client.post('/_api/page/discard-draft', { url })` → v2 response.
- Missing `url` → `VALIDATION`.
- Destructive → WriteGuard confirm-token flow.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/pages.test.ts`:

```ts
  it('discard_draft requires url and POSTs /_api/page/discard-draft', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'discard_draft' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: 'discard_draft', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page/discard-draft', { url: '/foo' });
  });

  it('discard_draft returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages({ action: 'discard_draft', url: '/foo' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/pages.test.ts -t "discard_draft"`
Expected: 2 new tests FAIL.

- [ ] **Step 3: Extend registry and domain**

In `src/capabilities/registry.ts`, inside `automad_pages.actions` (after `recent`, before the `update_rename` internal), add:

```ts
      discard_draft: destructive('Discard a page draft and revert to the last published version.'),
```

In `src/domains/pages.ts`, add to the switch (after `recent`):

```ts
    case 'discard_draft': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for discard_draft');
      }
      return client.post(`${API_BASE}/page/discard-draft`, { url: input.url });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: 2 new tests PASS; Task 1 tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts src/domains/pages.ts tests/unit/domains/pages.test.ts
git commit -m "feat(pages): add discard_draft action (v2 PageController::discardDraft)"
```

---

### Task 3: Docs + full verification

**Files:**
- Modify: `CHANGELOG.md` (add bullet).
- Then regenerate autogen tables and run the full gate.

**Interfaces:** No new code; the new actions surface via autogen.

- [ ] **Step 1: Add changelog bullet**

In `CHANGELOG.md`, inside the existing `## [Unreleased]` block, append:

```md
- New `automad_pages` actions: `breadcrumbs`, `publication_state`, `recent` (alias of `list`), `discard_draft` (v2 `PageController`).
```

- [ ] **Step 2: Regenerate autogen tables + run the full gate**

Run: `npm run docs:sync:all && npm run verify`
Expected: autogen tool table updates with the 4 new page actions; `verify: all gates passed`; new test count higher than 420 (probably ~427).

- [ ] **Step 3: Commit + push**

```bash
git add CHANGELOG.md README.md CLAUDE.md docs/index.html
git commit -m "docs: changelog for tranche 3 (page utilities)"
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- 4 new actions across 1 existing tool — covered by Tasks 1, 2. ✅
- v2 URLs (kebab-case) verified against source — pinned verbatim. ✅
- `recent` is an explicit alias of `list`; both share the same v2 endpoint and the same code path. ✅
- WriteGuard integration (destructive action requires confirm token) — proven by `discard_draft` "pending" test. ✅
- `docs:sync` + `npm run verify` green — Task 3. ✅
- No new files, no new deps, no changes to `client.ts`/`http.ts`/`write-guard.ts`/`capabilities/tools.ts` — Global Constraints. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✅

**3. Type consistency:** `ACTION_MAP` keys are the literal action strings; tests use those exact strings; v2 URLs are kebab-case everywhere. ✅
