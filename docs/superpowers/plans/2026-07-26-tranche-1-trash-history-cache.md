# Tranche 1: Trash + History + Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new actions across `automad_pages` (6) and `automad_config` (2), wiring v2's `PageTrashController`, `HistoryController`, and `CacheController` to the MCP API surface.

**Architecture:** No new files, no new tools, no new dependencies. Extend existing `pagesInput`/`configInput` Zod schemas, the `domains/{pages,config}.ts` action switch, and the capability registry's `actions` map. Tests follow the existing per-domain mock-client pattern.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Vitest, existing `client.post` wrapper. v2 wire format `__csrf__` + `__json__` already injected by `client.ts`.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. No `any` (use `unknown` + narrowing). No non-null `!` assertions.
- ESM imports: explicit `.js` extensions.
- No new runtime dependencies.
- All new destructive actions go through `WriteGuard` (target string for trash actions: `input.url`; for cache actions: `'/'` — same synthetic target as `config.set`).
- Commit after each task. Do NOT run project-wide `npm run verify`/lint until the final task; run only the specific test file per task.
- Action names (MCP-side, camelCase) and v2 URLs (kebab-case) are pinned in the design spec and must be reproduced verbatim.
- The 8 new actions, exact action names, exact v2 URLs, and HTTP methods:
  - `automad_pages.trash_list`            → `POST /_api/page-trash/list` (read)
  - `automad_pages.trash_restore`         → `POST /_api/page-trash/restore` (destructive)
  - `automad_pages.trash_permanently_delete` → `POST /_api/page-trash/permanently-delete` (destructive)
  - `automad_pages.trash_clear`           → `POST /_api/page-trash/clear` (destructive)
  - `automad_pages.history`               → `POST /_api/history/log` (read)
  - `automad_pages.history_restore`       → `POST /_api/history/restore` (destructive)
  - `automad_config.cache_clear`          → `POST /_api/cache/clear` (destructive)
  - `automad_config.cache_purge`          → `POST /_api/cache/purge` (destructive)

---

### Task 1: Trash actions in `automad_pages` (4 actions)

**Files:**
- Modify: `src/schemas.ts` (`pagesInput` — new actions need no new fields beyond existing `url`).
- Modify: `src/capabilities/registry.ts` (`automad_pages.actions` — add 4 entries).
- Modify: `src/domains/pages.ts` (`ACTION_MAP` + 4 new `case` arms + a new `trash_*` sub-switch helper).
- Test: `tests/unit/domains/pages.test.ts` (extend the existing `describe`).

**Interfaces:**
- Consumes: existing `pagesInput` (Zod) + `WriteAction` + `HttpClient` + `WriteGuard`.
- Produces: 4 new action arms under the existing `switch (input.action) { ... }` in `handlePages`. Each returns whatever the v2 response is. Missing `url` for `trash_restore` and `trash_permanently_delete` → `VALIDATION`.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/pages.test.ts` (inside the same `describe('handlePages (v2 /_api)', ...)`):

```ts
  it('trash_list POSTs /_api/page-trash/list', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/x' }]);
    const out = await handlePages({ action: 'trash_list' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/x' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/list', {});
  });

  it('trash_restore requires url', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'trash_restore' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('trash_restore POSTs /_api/page-trash/restore with url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: 'trash_restore', url: '/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/restore', { url: '/x' });
  });

  it('trash_restore returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages({ action: 'trash_restore', url: '/x' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('trash_permanently_delete POSTs /_api/page-trash/permanently-delete with url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: 'trash_permanently_delete', url: '/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/permanently-delete', { url: '/x' });
  });

  it('trash_clear POSTs /_api/page-trash/clear with no body', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages({ action: 'trash_clear' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/clear', {});
  });
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: 6 new tests FAIL (action not in enum / not in switch).

- [ ] **Step 3: Extend the schema, registry, and domain handler**

In `src/schemas.ts`, find `export const pagesInput = z.object({` (around line 69) — the `action: actionEnum('automad_pages')` line uses the Zod `actionEnum` helper that derives its literal list from the registry. **No schema change is needed for adding actions** — the enum is derived at build time. Verify by reading the helper:

```bash
grep -n "actionEnum" src/capabilities/registry.ts
```

If `actionEnum` reads from `CAPABILITY_REGISTRY`, the schema picks up the new actions automatically once the registry is updated. (If for any reason it does not, fall back to adding the literals by hand — but this is the existing pattern in the codebase.)

In `src/capabilities/registry.ts`, inside the `automad_pages` `actions` object, add these 4 entries (after the existing `publish: write(...)` line, around line 70):

```ts
      trash_list: read('List pages currently in trash.'),
      trash_restore: destructive('Restore a trashed page by URL.'),
      trash_permanently_delete: destructive('Permanently delete a single trashed page.'),
      trash_clear: destructive('Empty the trash (deletes all trashed pages permanently).'),
```

In `src/domains/pages.ts`, the `ACTION_MAP` (around line 24) covers typed actions; the new destructive ones get their own writeAction strings. Extend `ACTION_MAP`:

```ts
const ACTION_MAP: Record<PagesAction, WriteAction> = {
  list: 'pages.list',
  get: 'pages.get',
  create: 'pages.create',
  update: 'pages.update',
  delete: 'pages.delete',
  move: 'pages.move',
  duplicate: 'pages.duplicate',
  publish: 'pages.publish',
  batch_update: 'pages.batch_update',
  trash_list: 'pages.trash_list',
  trash_restore: 'pages.trash_restore',
  trash_permanently_delete: 'pages.trash_permanently_delete',
  trash_clear: 'pages.trash_clear',
  history: 'pages.history',
  history_restore: 'pages.history_restore',
};
```

(Task 2 will add `history` and `history_restore` to the same map.)

In the same file, inside the `switch (input.action) { ... }` block (find the closing `}` of the existing switch, before the function's outer closing `}`), add the 4 new arms:

```ts
    case 'trash_list':
      return client.post(`${API_BASE}/page-trash/list`, {});
    case 'trash_restore': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for trash_restore');
      return client.post(`${API_BASE}/page-trash/restore`, { url: input.url });
    }
    case 'trash_permanently_delete': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for trash_permanently_delete');
      }
      return client.post(`${API_BASE}/page-trash/permanently-delete`, { url: input.url });
    }
    case 'trash_clear':
      return client.post(`${API_BASE}/page-trash/clear`, {});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: all 6 new tests PASS; the previous pages tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/domains/pages.ts tests/unit/domains/pages.test.ts
git commit -m "feat(pages): add trash_list/restore/permanently_delete/clear actions"
```

---

### Task 2: History actions in `automad_pages` (2 actions)

**Files:**
- Modify: `src/schemas.ts` (`pagesInput` — add optional `history_id: z.string().max(MAX_SHORT).optional()`).
- Modify: `src/capabilities/registry.ts` (`automad_pages.actions` — add 2 entries; also add `history` and `history_restore` to the schema's allowed action union via the same `actionEnum` derivation, if necessary).
- Modify: `src/domains/pages.ts` (extend `ACTION_MAP` with `history`/`history_restore`; add 2 new `case` arms; gate the `input.action === 'update'` rename-detection logic to keep working since the new actions will be checked first).
- Test: `tests/unit/domains/pages.test.ts`.

**Interfaces:**
- `automad_pages.history(url)` → reads v2 history log for the page → returns v2 response.
- `automad_pages.history_restore(url, history_id)` → restores a specific history entry.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/pages.test.ts`:

```ts
  it('history requires url', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'history' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('history POSTs /_api/history/log with url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'h1', time: 1 }]);
    const out = await handlePages({ action: 'history', url: '/x' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ id: 'h1', time: 1 }]);
    expect(c.post).toHaveBeenCalledWith('/_api/history/log', { url: '/x' });
  });

  it('history_restore requires url and history_id', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'history_restore', url: '/x' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handlePages({ action: 'history_restore', history_id: 'h1' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('history_restore POSTs /_api/history/restore with url + logId', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: 'history_restore', url: '/x', history_id: 'h1' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/history/restore', { url: '/x', logId: 'h1' });
  });

  it('history_restore returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages(
      { action: 'history_restore', url: '/x', history_id: 'h1' },
      c,
      guard,
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx vitest run tests/unit/domains/pages.test.ts -t history`
Expected: 5 new tests FAIL (no `history`/`history_restore` in enum/switch yet).

- [ ] **Step 3: Extend schema, registry, and domain handler**

In `src/schemas.ts`, inside the `pagesInput` object (after the `confirm_token` line, around line 95), add:

```ts
  /** For `history_restore`: the history log entry id. */
  history_id: z.string().max(MAX_SHORT).optional(),
```

In `src/capabilities/registry.ts`, inside `automad_pages.actions`, add (after the 4 new `trash_*` entries from Task 1):

```ts
      history: read('List the change history for a page (v2 history log).'),
      history_restore: destructive('Restore a page to a prior history entry (by logId).'),
```

In `src/domains/pages.ts`, add to `ACTION_MAP` (already partially extended in Task 1):

```ts
  history: 'pages.history',
  history_restore: 'pages.history_restore',
```

In the same file, inside the `switch (input.action) { ... }` block, add the 2 new arms (at the end):

```ts
    case 'history': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for history');
      return client.post(`${API_BASE}/history/log`, { url: input.url });
    }
    case 'history_restore': {
      if (!input.url) {
        throw new AutomadMcpError('VALIDATION', 'url is required for history_restore');
      }
      if (!input.history_id) {
        throw new AutomadMcpError('VALIDATION', 'history_id is required for history_restore');
      }
      return client.post(`${API_BASE}/history/restore`, { url: input.url, logId: input.history_id });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/pages.test.ts`
Expected: all new history tests PASS; trash tests from Task 1 still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/domains/pages.ts tests/unit/domains/pages.test.ts
git commit -m "feat(pages): add history + history_restore actions"
```

---

### Task 3: Cache actions in `automad_config` (2 actions)

**Files:**
- Modify: `src/capabilities/registry.ts` (`automad_config.actions` — add 2 entries).
- Modify: `src/domains/config.ts` (`ACTION_MAP` + 2 new `case` arms in the switch).
- Test: `tests/unit/domains/config.test.ts`.

**Interfaces:**
- `automad_config.cache_clear` → POST `/_api/cache/clear` → destructive.
- `automad_config.cache_purge` → POST `/_api/cache/purge` → destructive.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/config.test.ts`:

```ts
  it('cache_clear POSTs /_api/cache/clear', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleConfig({ action: 'cache_clear' }, c, new WriteGuard(cfg()));
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/cache/clear', {});
  });

  it('cache_clear returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleConfig({ action: 'cache_clear' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('cache_purge POSTs /_api/cache/purge', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleConfig({ action: 'cache_purge' }, c, new WriteGuard(cfg()));
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/cache/purge', {});
  });
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx vitest run tests/unit/domains/config.test.ts`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Extend the registry and domain handler**

In `src/capabilities/registry.ts`, inside `automad_config.actions`, add:

```ts
      cache_clear: destructive('Clear the v2 cache (PageCache + ResponseCache).'),
      cache_purge: destructive('Purge the v2 cache (more aggressive than clear).'),
```

In `src/domains/config.ts`, extend the `ConfigAction` union and `ACTION_MAP`:

```ts
type ConfigAction = 'get' | 'set' | 'cache_clear' | 'cache_purge';
const ACTION_MAP: Record<ConfigAction, WriteAction> = {
  get: 'config.get',
  set: 'config.set',
  cache_clear: 'config.cache_clear',
  cache_purge: 'config.cache_purge',
};
```

In the same file, add to the existing `switch (action) { ... }` (the `get` and `set` cases stay as-is, add the new cases at the end):

```ts
    case 'cache_clear':
      return client.post(`${API_BASE}/cache/clear`, {});
    case 'cache_purge':
      return client.post(`${API_BASE}/cache/purge`, {});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/config.test.ts`
Expected: all config tests PASS (existing 2 + 3 new = 5).

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts src/domains/config.ts tests/unit/domains/config.test.ts
git commit -m "feat(config): add cache_clear and cache_purge actions"
```

---

### Task 4: Docs + full verification

**Files:**
- Modify: `README.md` + `CLAUDE.md` if needed for the new actions (autogen handles the tool table; the prose is hand-written).
- Then regenerate autogen tables and run the full gate.

**Interfaces:**
- No new code; the new actions surface via autogen.

- [ ] **Step 1: Add a short release note**

In `CHANGELOG.md`, under the `## [Unreleased]` section (or create one if missing), add a bullet:

```md
- New `automad_pages` actions: `trash_list`, `trash_restore`, `trash_permanently_delete`, `trash_clear`, `history`, `history_restore` (v2 `PageTrashController` + `HistoryController`).
- New `automad_config` actions: `cache_clear`, `cache_purge` (v2 `CacheController`).
```

If the file already has a versioned top entry (not Unreleased), insert an `## [Unreleased]` block above the latest version per the `release.ts` convention. Do not bump the version — that happens via the `release` script.

- [ ] **Step 2: Regenerate autogen tables + run the full gate**

Run: `npm run docs:sync:all && npm run verify`
Expected: autogen tool table updates with the 8 new actions; `verify: all gates passed`; new test count higher than 401 (probably ~414).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md CLAUDE.md docs/index.html
git commit -m "docs: changelog for tranche 1 (trash/history/cache actions)"
```

---

## Self-Review

**1. Spec coverage:**
- 8 new actions across 2 existing tools — covered by Tasks 1, 2, 3. ✅
- Confirmed v2 URLs (kebab-case) — Step 3 in each task pins them verbatim. ✅
- WriteGuard integration (destructive actions require confirm token) — proven by `trash_restore` + `history_restore` + `cache_clear` "pending" tests. ✅
- `docs:sync` + `npm run verify` green — Task 4. ✅
- No new files, no new deps, no changes to `client.ts`/`http.ts`/`write-guard.ts` — Global Constraints. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✅

**3. Type consistency:** `ACTION_MAP` keys are the literal action strings; tests use those exact strings; v2 URLs are kebab-case everywhere. The schema's `pagesInput` enum is derived from the registry (no manual update needed). `history_id` field appears in both schema (Task 2 Step 3) and tests (Task 2 Step 1) with the same name and type. ✅
