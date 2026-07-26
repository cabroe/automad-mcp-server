# Tranche 2: PackageManager Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose v2's `PackageManagerController` (`getPackageCollection`, `getOutdated`, `update`, `updateAll`, `remove`) as 5 new MCP actions on the existing `automad_theme` tool, replacing the FS-only `uninstall` with a v2-first + FS-fallback flow.

**Architecture:** No new files, no new tools, no new dependencies. Extend the existing `themeInput` Zod schema (add `package?`), the capability registry (5 new entries; replace the existing `uninstall` entry's description), the `domains/theme.ts` switch (5 new cases; rewrite `case 'uninstall':`), and add one helper to `theme/manager.ts` for the v2-then-fs uninstall flow. Tests follow the existing mock-client + WriteGuard pattern.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Vitest, existing `client.post`. v2 wire format `__csrf__`+`__json__` injected by `client.ts`.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. No `any`. No non-null `!` assertions.
- ESM imports: explicit `.js` extensions.
- No new runtime dependencies.
- All new destructive actions go through `WriteGuard` (target string: `input.package ?? '/'` for `update`/`uninstall`; `'/'` for `update_all`).
- Commit after each task. Do NOT run project-wide `npm run verify` until the final task; run only the specific test file per task.
- The 5 new actions, exact action names, exact v2 URLs, and HTTP methods:
  - `automad_theme.list_installed` (read)    → `POST /_api/package-manager/get-package-collection` body `{}`
  - `automad_theme.outdated`       (read)    → `POST /_api/package-manager/get-outdated` body `{}`
  - `automad_theme.update`         (destructive) → `POST /_api/package-manager/update` body `{ package }`
  - `automad_theme.update_all`     (destructive) → `POST /_api/package-manager/update-all` body `{}`
  - `automad_theme.uninstall`      (destructive) → `POST /_api/package-manager/remove` body `{ package }` then fs.remove (fallback when v2 returns NOT_FOUND)

---

### Task 1: `list_installed` + `outdated` (read actions)

**Files:**
- Modify: `src/schemas.ts` (`themeInput` — add `package?: z.string().max(MAX_SHORT).optional()` for use by later actions).
- Modify: `src/capabilities/registry.ts` (`automad_theme.actions` — add `list_installed` + `outdated`).
- Modify: `src/domains/theme.ts` (`ACTION_MAP` + 2 new `case` arms).
- Test: `tests/unit/domains/theme.test.ts` (extend; if the file doesn't exist, create it with the same mock-client + WriteGuard fixture as the other domain tests).

**Interfaces:**
- `list_installed()` → `client.post('/_api/package-manager/get-package-collection', {})` → v2 response.
- `outdated()` → `client.post('/_api/package-manager/get-outdated', {})` → v2 response.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/theme.test.ts` (create the file if missing; base it on `tests/unit/domains/config.test.ts`'s `mockClient`/`cfg` fixture):

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleTheme } from '../../../src/domains/theme.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';
import { LocalThemeFs } from '../../../src/theme/fs.js';
import * as path from 'node:path';
import * as os from 'node:os';

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}
const themeDeps = (themesPath: string, starterKitPath: string) => ({
  client: mockClient(),
  guard: new WriteGuard(cfg()),
  themesPath,
  starterKitPath,
  fs: new LocalThemeFs(),
});

describe('handleTheme (v2 /_api PackageManager)', () => {
  it('list_installed POSTs /_api/package-manager/get-package-collection', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ packages: [{ name: 'vendor/foo' }] });
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const out = await handleTheme({ action: 'list_installed' }, { ...themeDeps(themesPath, themesPath), client: c });
    expect(out).toEqual({ packages: [{ name: 'vendor/foo' }] });
    expect(c.post).toHaveBeenCalledWith('/_api/package-manager/get-package-collection', {});
  });

  it('outdated POSTs /_api/package-manager/get-outdated', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ outdated: [] });
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const out = await handleTheme({ action: 'outdated' }, { ...themeDeps(themesPath, themesPath), client: c });
    expect(out).toEqual({ outdated: [] });
    expect(c.post).toHaveBeenCalledWith('/_api/package-manager/get-outdated', {});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: 2 tests FAIL (action not in enum/switch).

- [ ] **Step 3: Extend schema, registry, and domain**

In `src/schemas.ts`, inside the `themeInput` object (before the `confirm_token` line), add:

```ts
  /** Package name (`vendor/name`) for `update`/`uninstall` via v2 PackageManager. */
  package: z.string().max(MAX_SHORT).optional(),
```

In `src/capabilities/registry.ts`, inside `automad_theme.actions` (alphabetical position varies; insert near the existing `uninstall` entry to keep related items close), add:

```ts
      list_installed: read('List installed packages via v2 PackageManager (get-package-collection).'),
      outdated: read('List packages that have updates available (v2 get-outdated).'),
```

In `src/domains/theme.ts`, extend `ACTION_MAP` (around line 20):

```ts
  list_installed: 'theme.list_installed',
  outdated: 'theme.outdated',
  update: 'theme.update',
  update_all: 'theme.update_all',
```

In the same file, find the existing `case 'uninstall':` (around line 114). Add the new cases in the switch — exact position depends on the file; group the new ones just before the `case 'uninstall':`:

```ts
    case 'list_installed':
      return client.post(`${API_BASE}/package-manager/get-package-collection`, {});
    case 'outdated':
      return client.post(`${API_BASE}/package-manager/get-outdated`, {});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: 2 new tests PASS; other theme tests (if any) still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/domains/theme.ts tests/unit/domains/theme.test.ts
git commit -m "feat(theme): add list_installed + outdated actions (v2 PackageManager)"
```

---

### Task 2: `update` + `update_all` (destructive actions)

**Files:**
- Modify: `src/capabilities/registry.ts` (add `update` + `update_all` entries).
- Modify: `src/domains/theme.ts` (`ACTION_MAP` already has them from Task 1; add 2 new `case` arms + missing `uninstall` map entry).
- Test: `tests/unit/domains/theme.test.ts`.

**Interfaces:**
- `update(package)` → guard target `input.package`; POST `/_api/package-manager/update` with `{ package }`.
- `update_all()` → guard target `'/'`; POST `/_api/package-manager/update-all` with `{}`.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/theme.test.ts`:

```ts
  it('update requires package', async () => {
    const c = mockClient();
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    await expect(
      handleTheme({ action: 'update' }, { ...themeDeps(themesPath, themesPath), client: c }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('update POSTs /_api/package-manager/update with package', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: 'ok' });
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const out = await handleTheme(
      { action: 'update', package: 'vendor/foo' },
      { ...themeDeps(themesPath, themesPath), client: c },
    );
    expect(out).toEqual({ success: 'ok' });
    expect(c.post).toHaveBeenCalledWith('/_api/package-manager/update', { package: 'vendor/foo' });
  });

  it('update returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleTheme(
      { action: 'update', package: 'vendor/foo' },
      { ...themeDeps(themesPath, themesPath), client: c, guard },
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('update_all POSTs /_api/package-manager/update-all', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: 'ok' });
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const out = await handleTheme(
      { action: 'update_all' },
      { ...themeDeps(themesPath, themesPath), client: c },
    );
    expect(out).toEqual({ success: 'ok' });
    expect(c.post).toHaveBeenCalledWith('/_api/package-manager/update-all', {});
  });

  it('update_all returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleTheme(
      { action: 'update_all' },
      { ...themeDeps(themesPath, themesPath), client: c, guard },
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/theme.test.ts -t update`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Extend the registry and domain**

In `src/capabilities/registry.ts`, inside `automad_theme.actions` (after `uninstall` to keep related items together):

```ts
      update: destructive('Update a single installed package (v2 update).'),
      update_all: destructive('Update all installed packages (v2 update-all).'),
```

In `src/domains/theme.ts`, add the missing `uninstall` entry to `ACTION_MAP` (Task 1 left this out — needed now):

```ts
  uninstall: 'theme.uninstall',
```

In the same file, add to the switch (before `case 'uninstall':`):

```ts
    case 'update': {
      if (!input.package) {
        throw new AutomadMcpError('VALIDATION', 'package is required for update');
      }
      return client.post(`${API_BASE}/package-manager/update`, { package: input.package });
    }
    case 'update_all':
      return client.post(`${API_BASE}/package-manager/update-all`, {});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: all theme tests PASS (2 read + 5 update/update_all = 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts src/domains/theme.ts tests/unit/domains/theme.test.ts
git commit -m "feat(theme): add update + update_all actions (v2 PackageManager)"
```

---

### Task 3: `uninstall` rewrite (v2 remove + fs fallback)

**Files:**
- Modify: `src/capabilities/registry.ts` — already has `uninstall: destructive(...)`; just update the description to reflect v2-first semantics.
- Modify: `src/theme/manager.ts` — add a `removeViaV2(package)` helper that calls v2's `remove` and falls back to fs.remove when v2 returns NOT_FOUND.
- Modify: `src/domains/theme.ts` — rewrite the existing `case 'uninstall':` to call the new helper.
- Test: `tests/unit/domains/theme.test.ts` (3 tests: happy v2-then-fs, missing-theme, NOT_FOUND fallback).

**Interfaces:**
- `uninstall(theme)` → guard target `input.theme ?? '/'`; calls `manager.removeViaV2(input.theme)` which:
  1. POSTs `/_api/package-manager/remove` with `{ package: <theme> }`.
  2. On v2 success: removes the on-disk dir.
  3. On v2 NOT_FOUND: removes the on-disk dir (idempotent recovery) and returns the v2 response shape (`{ success: ... }` with a note that it was already gone).
  4. On v2 error: rethrows.
- Missing `theme` → `VALIDATION`.

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/domains/theme.test.ts`:

```ts
  it('uninstall requires theme', async () => {
    const c = mockClient();
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now());
    await expect(
      handleTheme({ action: 'uninstall' }, { ...themeDeps(themesPath, themesPath), client: c }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('uninstall calls v2 remove then fs.remove on success', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: 'ok' });
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now() + '-uninstall');
    const fs = new LocalThemeFs();
    await fs.mkdir(path.join(themesPath, 'foo'), { recursive: true });
    await fs.writeFile(path.join(themesPath, 'foo', 'theme.json'), '{}');
    await handleTheme(
      { action: 'uninstall', theme: 'foo' },
      { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: themesPath, fs },
    );
    expect(c.post).toHaveBeenCalledWith('/_api/package-manager/remove', { package: 'foo' });
    expect(await fs.exists(path.join(themesPath, 'foo'))).toBe(false);
  });

  it('uninstall falls back to fs.remove when v2 returns NOT_FOUND', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Package not found in the package collection'), { code: 'NOT_FOUND' }),
    );
    const themesPath = path.join(os.tmpdir(), 'mcp-theme-test-' + Date.now() + '-uninstall-fb');
    const fs = new LocalThemeFs();
    await fs.mkdir(path.join(themesPath, 'ghost'), { recursive: true });
    const out = await handleTheme(
      { action: 'uninstall', theme: 'ghost' },
      { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: themesPath, fs },
    );
    expect(out).toMatchObject({ removedFromDisk: true, v2: 'not_found' });
    expect(await fs.exists(path.join(themesPath, 'ghost'))).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/theme.test.ts -t uninstall`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement the v2-first uninstall**

In `src/theme/manager.ts`, append the new helper (after the existing `uninstall` method):

```ts
  /**
   * Uninstall a theme via v2's PackageManager.remove, then remove the local
   * on-disk dir. If v2 returns NOT_FOUND (the package was already removed
   * from the live registry but the dir lingered), fall through to fs.remove
   * and report `removedFromDisk: true, v2: 'not_found'`.
   */
  async removeViaV2(theme: string): Promise<unknown> {
    const { fs, themesPath, client } = this.deps;
    assertSafeThemeSlug(theme);
    const target = assertWithinRoot(themesPath, path.join(themesPath, theme));
    let v2Response: unknown;
    let v2NotFound = false;
    try {
      v2Response = await client.post(`${API_BASE}/package-manager/remove`, { package: theme });
    } catch (err) {
      if (err instanceof AutomadMcpError && err.code === 'NOT_FOUND') {
        v2NotFound = true;
      } else {
        throw err;
      }
    }
    if (await fs.exists(target)) {
      await fs.remove(target, { recursive: true });
    }
    return v2NotFound ? { removedFromDisk: true, v2: 'not_found' } : v2Response;
  }
```

In `src/capabilities/registry.ts`, update the existing `uninstall` description (keep the key, change the description to reflect v2-first):

```ts
      uninstall: destructive('Uninstall via v2 PackageManager.remove, then remove the on-disk dir (fs fallback if v2 returns NOT_FOUND).'),
```

In `src/domains/theme.ts`, find the existing `case 'uninstall':` and replace it with:

```ts
    case 'uninstall': {
      if (!input.theme) {
        throw new AutomadMcpError('VALIDATION', 'theme is required for uninstall');
      }
      return manager.removeViaV2(input.theme);
    }
```

The existing `case 'uninstall':` calls `manager.uninstall(input.theme)` (the old fs-only method). That method is still useful for fallbacks and existing tests, so do **not** remove it — only the case arm changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/domains/theme.test.ts`
Expected: all 10 theme tests PASS (2 read + 5 update/update_all + 3 uninstall).

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/registry.ts src/theme/manager.ts src/domains/theme.ts tests/unit/domains/theme.test.ts
git commit -m "feat(theme): uninstall via v2 PackageManager.remove + fs fallback"
```

---

### Task 4: Docs + full verification

**Files:**
- Modify: `CHANGELOG.md` (add bullet under `## [Unreleased]`).
- Then regenerate autogen tables and run the full gate.

**Interfaces:** No new code; the new actions surface via autogen.

- [ ] **Step 1: Add changelog bullet**

In `CHANGELOG.md`, inside the existing `## [Unreleased]` block (created in Tranche 1), append a bullet:

```md
- New `automad_theme` actions: `list_installed`, `outdated`, `update`, `update_all`, `uninstall` (rewritten: v2 PackageManager.remove first, fs fallback).
```

- [ ] **Step 2: Regenerate autogen tables + run the full gate**

Run: `npm run docs:sync:all && npm run verify`
Expected: autogen tool table updates with the 5 new theme actions; `verify: all gates passed`; new test count higher than 410 (probably ~420).

- [ ] **Step 3: Commit + push**

```bash
git add CHANGELOG.md README.md CLAUDE.md docs/index.html
git commit -m "docs: changelog for tranche 2 (package manager actions)"
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- 5 new actions across 1 existing tool — covered by Tasks 1, 2, 3. ✅
- v2 URLs (kebab-case) verified against source — pinned verbatim. ✅
- `uninstall` rewrite: v2 remove + fs fallback on NOT_FOUND — Task 3 + 3 tests. ✅
- WriteGuard integration (destructive actions require confirm token) — proven by `update` + `update_all` "pending" tests. ✅
- `docs:sync` + `npm run verify` green — Task 4. ✅
- No new files, no new deps, no changes to `client.ts`/`http.ts`/`write-guard.ts`/`capabilities/tools.ts` — Global Constraints. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✅

**3. Type consistency:** `ACTION_MAP` keys are the literal action strings; tests use those exact strings; v2 URLs are kebab-case everywhere. `package` schema field appears in both the schema (Task 1 Step 3) and tests (Task 2 Step 1, Task 3 Step 1) with the same name and type. ✅
