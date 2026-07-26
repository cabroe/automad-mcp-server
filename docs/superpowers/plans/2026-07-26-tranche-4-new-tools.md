# Tranche 4: New Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new MCP tools (`automad_image`, `automad_components`, `automad_mail`, `automad_system`, `automad_file_meta`) with 12 total actions wiring the corresponding v2 controllers to the MCP surface.

**Architecture:** 5 new files in `src/domains/`, 5 new input Zod schemas, 5 new registry entries, 5 new `TOOL_BINDINGS`, 5 new test files. No new runtime dependencies, no changes to `client.ts`/`http.ts`/`write-guard.ts`/`server.ts`.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Vitest, existing `client.post`. v2 wire format `__csrf__`+`__json__` injected by `client.ts`.

## Global Constraints

- TypeScript strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`. No `any`. No non-null `!` assertions.
- ESM imports: explicit `.js` extensions.
- No new runtime dependencies.
- Each new tool's destructive actions go through the existing `WriteGuard` (target string: synthetic `'/'` for tools without a clear `(action, target)` pair).
- Commit after each task. Do NOT run project-wide `npm run verify` until the final task; run only the specific test file per task.
- All v2 URLs are kebab-case.

---

### Pre-Task: source-verify the three uncertain endpoints

Before any code, fetch the request-body shapes for endpoints whose exact request shape was *guessed* in the spec. Open these and copy the request body verbatim into the spec's `Body` column. (No code change — just a doc step.)

- [ ] **Step 1: Verify v2 `ImageController::save` request body**

```bash
curl -fsSL https://raw.githubusercontent.com/marcantondahmen/automad/v2/automad/src/server/Controllers/API/ImageController.php | head -80
```

Expected: 3 fields — `name`, `extension`, `imageBase64`. If different, adjust the spec.

- [ ] **Step 2: Verify v2 `ComponentController` request bodies**

```bash
curl -fsSL https://raw.githubusercontent.com/marcantondahmen/automad/v2/automad/src/server/Controllers/API/ComponentController.php
```

Expected: `data` takes `{components}` (array of component keys); `discardDraft`/`getPublicationState`/`publish` take `{url}`. If different, adjust the spec.

- [ ] **Step 3: Verify v2 `FileController::editInfo` request body**

```bash
curl -fsSL https://raw.githubusercontent.com/marcantondahmen/automad/v2/automad/src/server/Controllers/API/FileController.php
```

Expected: takes `{path, alt?, caption?, ...}`. Adjust the spec if the body uses different field names.

---

### Task 1: `automad_image` (2 actions)

**Files:**
- Create: `src/domains/image.ts`.
- Modify: `src/schemas.ts` (add `imageInput` schema).
- Modify: `src/capabilities/registry.ts` (add `automad_image` entry).
- Modify: `src/capabilities/tools.ts` (add `automad_image` binding).
- Test: `tests/unit/domains/image.test.ts`.

**Interfaces:**
- `save({name, extension, imageBase64})` → `client.post('/_api/image/save', {name, extension, imageBase64})` (destructive, require `name`+`extension`+`imageBase64`).
- `list()` → `client.post('/_api/image-collection/list', {})` (read).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domains/image.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleImage } from '../../../src/domains/image.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}

describe('handleImage (v2 /_api)', () => {
  it('list POSTs /_api/image-collection/list', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ name: 'foo' }]);
    const out = await handleImage({ action: 'list' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ name: 'foo' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/image-collection/list', {});
  });

  it('save requires name, extension, and imageBase64', async () => {
    const c = mockClient();
    await expect(handleImage({ action: 'save' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handleImage({ action: 'save', name: 'foo' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handleImage({ action: 'save', name: 'foo', extension: 'jpg' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('save POSTs /_api/image/save with name+extension+imageBase64', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleImage(
      { action: 'save', name: 'foo', extension: 'jpg', imageBase64: 'AAA' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/image/save', { name: 'foo', extension: 'jpg', imageBase64: 'AAA' });
  });

  it('save returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleImage(
      { action: 'save', name: 'foo', extension: 'jpg', imageBase64: 'AAA' },
      c,
      guard,
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/image.test.ts`
Expected: tests fail (module not found).

- [ ] **Step 3: Implement**

In `src/schemas.ts`, add `imageInput` (place it after `mediaInput`):

```ts
/** Image: list rendered variants, save (resize). */
export const imageInput = z.object({
  action: actionEnum('automad_image'),
  /** For `save`: base name (no extension). */
  name: z.string().max(MAX_SHORT).optional(),
  /** For `save`: target extension (e.g. `jpg`, `webp`). */
  extension: z.string().max(16).optional(),
  /** For `save`: base64-encoded image data. */
  imageBase64: z.string().max(MAX_BASE64_INPUT).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});
export type ImageInput = z.infer<typeof imageInput>;
```

In `src/capabilities/registry.ts`, add a new tool spec (any position in the `CAPABILITY_SPECS` object; alphabetical would put it after `automad_config`):

```ts
  automad_image: {
    title: 'Image',
    summary: 'Manage image variants via v2 image controllers.',
    description:
      'Image variants: `list` returns rendered variants; `save` uploads a base64-encoded image (resize/crop). Uses /_api/image-collection/list and /_api/image/save.',
    requires: 'live',
    actions: {
      list: read('List rendered image variants.'),
      save: destructive('Save a base64-encoded image (resize/crop via v2).'),
    },
  },
```

In `src/capabilities/tools.ts`, add the binding (after the existing `automad_theme` entry):

```ts
  automad_image: bind('automad_image', imageInput, (input, ctx) => handleImage(input, ctx.client, ctx.guard)),
```

In `src/domains/image.ts`, create the file:

```ts
import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { ImageInput } from '../schemas.js';

type ImageAction = ImageInput['action'];
const ACTION_MAP: Record<ImageAction, WriteAction> = {
  list: 'image.list',
  save: 'image.save',
};

export async function handleImage(
  input: ImageInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'list':
      return client.post(`${API_BASE}/image-collection/list`, {});
    case 'save': {
      if (!input.name) throw new AutomadMcpError('VALIDATION', 'name is required for save');
      if (!input.extension) throw new AutomadMcpError('VALIDATION', 'extension is required for save');
      if (!input.imageBase64) throw new AutomadMcpError('VALIDATION', 'imageBase64 is required for save');
      return client.post(`${API_BASE}/image/save`, {
        name: input.name,
        extension: input.extension,
        imageBase64: input.imageBase64,
      });
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown image action: ${String(input.action)}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domains/image.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/capabilities/tools.ts src/domains/image.ts tests/unit/domains/image.test.ts
git commit -m "feat(image): add automad_image tool (list + save via v2)"
```

---

### Task 2: `automad_components` (4 actions)

**Files:**
- Create: `src/domains/components.ts`.
- Modify: `src/schemas.ts` (add `componentsInput`).
- Modify: `src/capabilities/registry.ts` (add `automad_components`).
- Modify: `src/capabilities/tools.ts` (add binding).
- Test: `tests/unit/domains/components.test.ts`.

**Interfaces** (final body shape verified in pre-Task step 2):
- `data({components})` → `client.post('/_api/component/data', {components})` (read; `components` is required, array).
- `discard_draft({url})` → `client.post('/_api/component/discard-draft', {url})` (destructive).
- `publication_state({url})` → `client.post('/_api/component/get-publication-state', {url})` (read).
- `publish({url})` → `client.post('/_api/component/publish', {url})` (destructive).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domains/components.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleComponents } from '../../../src/domains/components.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}

describe('handleComponents (v2 /_api/component)', () => {
  it('data requires components and POSTs /_api/component/data', async () => {
    const c = mockClient();
    await expect(handleComponents({ action: 'data' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ components: [] });
    const out = await handleComponents(
      { action: 'data', components: ['hero', 'main'] },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ components: [] });
    expect(c.post).toHaveBeenCalledWith('/_api/component/data', { components: ['hero', 'main'] });
  });

  it('discard_draft requires url and POSTs /_api/component/discard-draft', async () => {
    const c = mockClient();
    await expect(handleComponents({ action: 'discard_draft' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleComponents({ action: 'discard_draft', url: '/foo' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/component/discard-draft', { url: '/foo' });
  });

  it('discard_draft returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleComponents({ action: 'discard_draft', url: '/foo' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('publication_state requires url and POSTs /_api/component/get-publication-state', async () => {
    const c = mockClient();
    await expect(handleComponents({ action: 'publication_state' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hasDraft: true });
    const out = await handleComponents(
      { action: 'publication_state', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ hasDraft: true });
    expect(c.post).toHaveBeenCalledWith('/_api/component/get-publication-state', { url: '/foo' });
  });

  it('publish requires url and POSTs /_api/component/publish', async () => {
    const c = mockClient();
    await expect(handleComponents({ action: 'publish' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleComponents({ action: 'publish', url: '/foo' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/component/publish', { url: '/foo' });
  });

  it('publish returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleComponents({ action: 'publish', url: '/foo' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/components.test.ts`
Expected: fail (module not found).

- [ ] **Step 3: Implement**

In `src/schemas.ts`, add `componentsInput`:

```ts
/** Components: data, discard_draft, publication_state, publish (v2 ComponentController). */
export const componentsInput = z.object({
  action: actionEnum('automad_components'),
  /** For `data`: component key list (e.g. `['main', 'hero']`). */
  components: z.array(z.string().max(MAX_SHORT)).max(50).optional(),
  /** For `discard_draft` / `publication_state` / `publish`: page URL. */
  url: urlSchema.optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});
export type ComponentsInput = z.infer<typeof componentsInput>;
```

In `src/capabilities/registry.ts`:

```ts
  automad_components: {
    title: 'Components',
    summary: 'Manage per-page component fields (v2 ComponentController).',
    description:
      'Component-level fields: `data` returns the field map for the given component keys; `publication_state` returns the draft/published state; `discard_draft` reverts a component draft; `publish` publishes component changes. Uses /_api/component/*.',
    requires: 'live',
    actions: {
      data: read('Read component field data for a set of component keys.'),
      publication_state: read('Get the publication state of component fields for a page.'),
      discard_draft: destructive('Discard component draft and revert to published state.'),
      publish: destructive('Publish component changes for a page.'),
    },
  },
```

In `src/capabilities/tools.ts`:

```ts
  automad_components: bind('automad_components', componentsInput, (input, ctx) =>
    handleComponents(input, ctx.client, ctx.guard),
  ),
```

In `src/domains/components.ts`:

```ts
import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { ComponentsInput } from '../schemas.js';

type ComponentsAction = ComponentsInput['action'];
const ACTION_MAP: Record<ComponentsAction, WriteAction> = {
  data: 'components.data',
  discard_draft: 'components.discard_draft',
  publication_state: 'components.publication_state',
  publish: 'components.publish',
};

export async function handleComponents(
  input: ComponentsInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const target = input.url ?? '/';
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'data': {
      if (!input.components || input.components.length === 0) {
        throw new AutomadMcpError('VALIDATION', 'components (non-empty array) is required for data');
      }
      return client.post(`${API_BASE}/component/data`, { components: input.components });
    }
    case 'discard_draft': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for discard_draft');
      return client.post(`${API_BASE}/component/discard-draft`, { url: input.url });
    }
    case 'publication_state': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for publication_state');
      return client.post(`${API_BASE}/component/get-publication-state`, { url: input.url });
    }
    case 'publish': {
      if (!input.url) throw new AutomadMcpError('VALIDATION', 'url is required for publish');
      return client.post(`${API_BASE}/component/publish`, { url: input.url });
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown components action: ${String(input.action)}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domains/components.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/capabilities/tools.ts src/domains/components.ts tests/unit/domains/components.test.ts
git commit -m "feat(components): add automad_components tool (data/discard_draft/publication_state/publish)"
```

---

### Task 3: `automad_mail` (3 actions)

**Files:**
- Create: `src/domains/mail.ts`.
- Modify: `src/schemas.ts` (add `mailInput`).
- Modify: `src/capabilities/registry.ts` (add `automad_mail`).
- Modify: `src/capabilities/tools.ts` (add binding).
- Test: `tests/unit/domains/mail.test.ts`.

**Interfaces:**
- `save({transport, from, smtpServer, smtpUsername, smtpPort, smtpPassword?})` → `client.post('/_api/mail-config/save', body)`. `transport` and `from` are required.
- `test({to})` → `client.post('/_api/mail-config/test', {to})`. `to` required.
- `reset()` → `client.post('/_api/mail-config/reset', {})`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domains/mail.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleMail } from '../../../src/domains/mail.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}

describe('handleMail (v2 /_api/mail-config)', () => {
  it('save POSTs /_api/mail-config/save with transport/from', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleMail(
      { action: 'save', transport: 'smtp', from: 'a@example.com' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/mail-config/save', { transport: 'smtp', from: 'a@example.com' });
  });

  it('save requires transport and from', async () => {
    const c = mockClient();
    await expect(handleMail({ action: 'save' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(handleMail({ action: 'save', transport: 'smtp' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('save returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleMail({ action: 'save', transport: 'smtp', from: 'a@example.com' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('test requires to and POSTs /_api/mail-config/test', async () => {
    const c = mockClient();
    await expect(handleMail({ action: 'test' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleMail({ action: 'test', to: 'b@example.com' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/mail-config/test', { to: 'b@example.com' });
  });

  it('reset POSTs /_api/mail-config/reset', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleMail({ action: 'reset' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/mail-config/reset', {});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/mail.test.ts`

- [ ] **Step 3: Implement**

In `src/schemas.ts`, add `mailInput`:

```ts
/** Mail: save (SMTP config), test (send test mail), reset. */
export const mailInput = z.object({
  action: actionEnum('automad_mail'),
  /** For `save`: transport type (e.g. 'smtp', 'sendmail'). */
  transport: z.string().max(32).optional(),
  /** For `save`: from address. */
  from: z.string().max(MAX_SHORT).optional(),
  /** For `save`: SMTP server. */
  smtpServer: z.string().max(MAX_SHORT).optional(),
  /** For `save`: SMTP username. */
  smtpUsername: z.string().max(MAX_SHORT).optional(),
  /** For `save`: SMTP password. */
  smtpPassword: z.string().max(MAX_SHORT).optional(),
  /** For `save`: SMTP port. */
  smtpPort: z.number().int().min(1).max(65535).optional(),
  /** For `test`: recipient address. */
  to: z.string().max(MAX_SHORT).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});
export type MailInput = z.infer<typeof mailInput>;
```

In `src/capabilities/registry.ts`:

```ts
  automad_mail: {
    title: 'Mail',
    summary: 'Manage Automad mail configuration (v2 MailConfigController).',
    description:
      'SMTP config and test mail: `save` writes transport/from/server/credentials; `test` sends a test email to `to`; `reset` clears the config. Uses /_api/mail-config/*.',
    requires: 'live',
    actions: {
      save: destructive('Save mail configuration (transport, from, SMTP server/credentials).'),
      test: destructive('Send a test email to a recipient address.'),
      reset: destructive('Reset mail configuration to defaults.'),
    },
  },
```

In `src/capabilities/tools.ts`:

```ts
  automad_mail: bind('automad_mail', mailInput, (input, ctx) => handleMail(input, ctx.client, ctx.guard)),
```

In `src/domains/mail.ts`:

```ts
import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { MailInput } from '../schemas.js';

type MailAction = MailInput['action'];
const ACTION_MAP: Record<MailAction, WriteAction> = {
  save: 'mail.save',
  test: 'mail.test',
  reset: 'mail.reset',
};

export async function handleMail(
  input: MailInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'save': {
      if (!input.transport) throw new AutomadMcpError('VALIDATION', 'transport is required for save');
      if (!input.from) throw new AutomadMcpError('VALIDATION', 'from is required for save');
      const body: Record<string, unknown> = { transport: input.transport, from: input.from };
      if (input.smtpServer) body['smtpServer'] = input.smtpServer;
      if (input.smtpUsername) body['smtpUsername'] = input.smtpUsername;
      if (input.smtpPassword) body['smtpPassword'] = input.smtpPassword;
      if (input.smtpPort !== undefined) body['smtpPort'] = input.smtpPort;
      return client.post(`${API_BASE}/mail-config/save`, body);
    }
    case 'test': {
      if (!input.to) throw new AutomadMcpError('VALIDATION', 'to is required for test');
      return client.post(`${API_BASE}/mail-config/test`, { to: input.to });
    }
    case 'reset':
      return client.post(`${API_BASE}/mail-config/reset`, {});
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown mail action: ${String(input.action)}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domains/mail.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/capabilities/tools.ts src/domains/mail.ts tests/unit/domains/mail.test.ts
git commit -m "feat(mail): add automad_mail tool (save/test/reset via v2 MailConfigController)"
```

---

### Task 4: `automad_system` (2 actions)

**Files:**
- Create: `src/domains/system.ts`.
- Modify: `src/schemas.ts` (add `systemInput`).
- Modify: `src/capabilities/registry.ts` (add `automad_system`).
- Modify: `src/capabilities/tools.ts` (add binding).
- Test: `tests/unit/domains/system.test.ts`.

**Interfaces:**
- `check_for_update()` → `client.post('/_api/system/check-for-update', {})` (read).
- `update()` → `client.post('/_api/system/update', {})` (destructive).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domains/system.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleSystem } from '../../../src/domains/system.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}

describe('handleSystem (v2 /_api/system)', () => {
  it('check_for_update POSTs /_api/system/check-for-update', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ updateAvailable: true, version: '2.1.0' });
    const out = await handleSystem({ action: 'check_for_update' }, c, new WriteGuard(cfg()));
    expect(out).toEqual({ updateAvailable: true, version: '2.1.0' });
    expect(c.post).toHaveBeenCalledWith('/_api/system/check-for-update', {});
  });

  it('update POSTs /_api/system/update', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleSystem({ action: 'update' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/system/update', {});
  });

  it('update returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleSystem({ action: 'update' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/system.test.ts`

- [ ] **Step 3: Implement**

In `src/schemas.ts`, add `systemInput`:

```ts
/** System: check_for_update, update (v2 SystemController). */
export const systemInput = z.object({
  action: actionEnum('automad_system'),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});
export type SystemInput = z.infer<typeof systemInput>;
```

In `src/capabilities/registry.ts`:

```ts
  automad_system: {
    title: 'System',
    summary: 'Check for and run Automad core updates (v2 SystemController).',
    description:
      'Core v2 update: `check_for_update` queries the update server; `update` runs the update. Uses /_api/system/*.',
    requires: 'live',
    actions: {
      check_for_update: read('Check the Automad update server for a new version.'),
      update: destructive('Run the Automad core update.'),
    },
  },
```

In `src/capabilities/tools.ts`:

```ts
  automad_system: bind('automad_system', systemInput, (input, ctx) => handleSystem(input, ctx.client, ctx.guard)),
```

In `src/domains/system.ts`:

```ts
import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { SystemInput } from '../schemas.js';

type SystemAction = SystemInput['action'];
const ACTION_MAP: Record<SystemAction, WriteAction> = {
  check_for_update: 'system.check_for_update',
  update: 'system.update',
};

export async function handleSystem(
  input: SystemInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'check_for_update':
      return client.post(`${API_BASE}/system/check-for-update`, {});
    case 'update':
      return client.post(`${API_BASE}/system/update`, {});
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown system action: ${String(input.action)}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domains/system.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/capabilities/tools.ts src/domains/system.ts tests/unit/domains/system.test.ts
git commit -m "feat(system): add automad_system tool (check_for_update/update via v2 SystemController)"
```

---

### Task 5: `automad_file_meta` (1 action)

**Files:**
- Create: `src/domains/file-meta.ts`.
- Modify: `src/schemas.ts` (add `fileMetaInput`).
- Modify: `src/capabilities/registry.ts` (add `automad_file_meta`).
- Modify: `src/capabilities/tools.ts` (add binding).
- Test: `tests/unit/domains/file-meta.test.ts`.

**Interfaces** (final body shape verified in pre-Task step 3):
- `edit_info({path, alt})` → `client.post('/_api/file/edit-info', body)` (destructive; `path` required, `alt` optional; the precise v2 field names should be locked in by the pre-task source verification).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domains/file-meta.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleFileMeta } from '../../../src/domains/file-meta.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: 'https://x', username: 'u', password: 'p', writeMode: 'unrestricted', logLevel: 'error' };
}

describe('handleFileMeta (v2 /_api/file)', () => {
  it('edit_info requires path and POSTs /_api/file/edit-info', async () => {
    const c = mockClient();
    await expect(handleFileMeta({ action: 'edit_info' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleFileMeta(
      { action: 'edit_info', path: '/shared/photo.jpg', alt: 'A photo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/file/edit-info', { path: '/shared/photo.jpg', alt: 'A photo' });
  });

  it('edit_info returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleFileMeta(
      { action: 'edit_info', path: '/shared/photo.jpg', alt: 'A photo' },
      c,
      guard,
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/domains/file-meta.test.ts`

- [ ] **Step 3: Implement** (adapt body fields to whatever the pre-Task source-verify step 3 confirmed)

In `src/schemas.ts`, add `fileMetaInput`:

```ts
/** File meta: edit_info (rename + alt-text). */
export const fileMetaInput = z.object({
  action: actionEnum('automad_file_meta'),
  /** For `edit_info`: file path (relative to site root or shared dir). */
  path: z.string().max(MAX_MEDIUM).optional(),
  /** For `edit_info`: alternative text. */
  alt: z.string().max(MAX_MEDIUM).optional(),
  confirm_token: z.string().max(MAX_SHORT).optional(),
});
export type FileMetaInput = z.infer<typeof fileMetaInput>;
```

In `src/capabilities/registry.ts`:

```ts
  automad_file_meta: {
    title: 'File meta',
    summary: 'Edit file metadata (alt text, etc.) via v2 FileController.',
    description:
      'Edit file metadata without re-uploading: `edit_info` updates alt/caption fields. Uses /_api/file/edit-info.',
    requires: 'live',
    actions: {
      edit_info: destructive('Edit file metadata (alt text, etc.) for an existing file.'),
    },
  },
```

In `src/capabilities/tools.ts`:

```ts
  automad_file_meta: bind('automad_file_meta', fileMetaInput, (input, ctx) => handleFileMeta(input, ctx.client, ctx.guard)),
```

In `src/domains/file-meta.ts`:

```ts
import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { FileMetaInput } from '../schemas.js';

type FileMetaAction = FileMetaInput['action'];
const ACTION_MAP: Record<FileMetaAction, WriteAction> = {
  edit_info: 'file_meta.edit_info',
};

export async function handleFileMeta(
  input: FileMetaInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const target = input.path ?? '/';
  const permit = guard.check(ACTION_MAP[input.action], target, input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'edit_info': {
      if (!input.path) {
        throw new AutomadMcpError('VALIDATION', 'path is required for edit_info');
      }
      const body: Record<string, unknown> = { path: input.path };
      if (input.alt !== undefined) body['alt'] = input.alt;
      return client.post(`${API_BASE}/file/edit-info`, body);
    }
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown file_meta action: ${String(input.action)}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/domains/file-meta.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/capabilities/registry.ts src/capabilities/tools.ts src/domains/file-meta.ts tests/unit/domains/file-meta.test.ts
git commit -m "feat(file_meta): add automad_file_meta tool (edit_info via v2 FileController)"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `CHANGELOG.md` (add bullet).
- Update `tests/unit/capabilities.test.ts` (5 new tools in the action-count assertion).
- Then regenerate autogen tables and run the full gate.

- [ ] **Step 1: Add changelog bullet**

In `CHANGELOG.md`, inside the existing `## [Unreleased]` block, append:

```md
- Five new tools: `automad_image` (list/save), `automad_components` (data/discard_draft/publication_state/publish), `automad_mail` (save/test/reset), `automad_system` (check_for_update/update), `automad_file_meta` (edit_info). AI tooling deferred to a future spec.
```

- [ ] **Step 2: Update `tests/unit/capabilities.test.ts` for the new tools**

In `tests/unit/capabilities.test.ts`, add a new `it('contains exactly the public routers and their callable actions', ...)` expectation block. The simplest approach: **add a new test** for the 5 new tools' action lists, leaving the existing one untouched. Append to the same `describe`:

```ts
  it('exposes the five tranche-4 tools and their action lists', () => {
    expect([...advertisedActions('automad_image')].sort()).toEqual(['list', 'save']);
    expect([...advertisedActions('automad_components')].sort()).toEqual([
      'data', 'discard_draft', 'publication_state', 'publish',
    ]);
    expect([...advertisedActions('automad_mail')].sort()).toEqual(['reset', 'save', 'test']);
    expect([...advertisedActions('automad_system')].sort()).toEqual(['check_for_update', 'update']);
    expect([...advertisedActions('automad_file_meta')].sort()).toEqual(['edit_info']);
  });
```

(Plus a `TOOL_NAMES` update if the test maintains a count assertion. Read the test file's exact structure first; adjust accordingly. The current test file is the source of truth.)

- [ ] **Step 3: Regenerate autogen tables + run the full gate**

Run: `npm run docs:sync:all && npm run verify`
Expected: autogen tool table updates with 5 new tools; `verify: all gates passed`; new test count higher than 425 (probably ~450).

- [ ] **Step 4: Commit + push**

```bash
git add CHANGELOG.md README.md CLAUDE.md docs/index.html tests/unit/capabilities.test.ts
git commit -m "docs: changelog for tranche 4 (5 new tools: image/components/mail/system/file_meta)"
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- 5 new tools, 12 total actions — covered by Tasks 1–5. ✅
- v2 URLs (kebab-case) verified — pinned verbatim. ✅
- Pre-Task source-verification step covers the three endpoints with uncertain body shapes. ✅
- WriteGuard integration (destructive actions require confirm token) — proven by tests. ✅
- `docs:sync` + `npm run verify` green — Task 6. ✅
- AI tools, edit-lock, in-page, file import, app extras — explicitly out of scope. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✅

**3. Type consistency:** `ACTION_MAP` keys are the literal action strings; tests use those exact strings; v2 URLs are kebab-case everywhere. ✅
