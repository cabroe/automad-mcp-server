import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as nodeFs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleTheme } from '../../../src/domains/theme.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { HttpClient } from '../../../src/client.js';
import type { Config } from '../../../src/config.js';
import type * as ThemeDevModule from '../../../src/theme/dev.js';

vi.mock('../../../src/theme/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ThemeDevModule>();
  return {
    ...actual,
    startDev: vi.fn(),
    stopDev: vi.fn(),
    getDevStatus: vi.fn(),
  };
});

import { startDev, stopDev, getDevStatus } from '../../../src/theme/dev.js';
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
  return {
    url: 'https://x',
    username: 'u',
    password: 'p',
    writeMode: 'unrestricted',
    logLevel: 'error',
    themesPath: '/tmp/themes-x',
    starterKitPath: '/tmp/starter-x',
  };
}

let root: string;
let themes: string;
let starter: string;

beforeEach(async () => {
  root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'mcp-theme-'));
  themes = path.join(root, 'themes');
  starter = path.join(root, 'starter');
  await nodeFs.mkdir(themes);
  await nodeFs.mkdir(starter);
  await nodeFs.writeFile(
    path.join(starter, 'theme.json'),
    JSON.stringify({ name: 'Starter', description: 'd' }),
  );
  await nodeFs.writeFile(
    path.join(starter, 'package.json'),
    JSON.stringify({ name: 'starter', scripts: {} }),
  );
  await nodeFs.mkdir(path.join(starter, 'components'));
  await nodeFs.mkdir(path.join(starter, 'blocks'));
  await nodeFs.mkdir(path.join(starter, 'client'));
  await nodeFs.writeFile(path.join(starter, 'client', 'index.ts'), '');
  await nodeFs.writeFile(path.join(starter, 'esbuild.js'), '');
  await nodeFs.writeFile(path.join(starter, 'page.php'), '<?php');
  await nodeFs.writeFile(path.join(starter, 'default.php'), '<@ components/page.php @>');
  await nodeFs.mkdir(path.join(starter, 'bin'));
  await nodeFs.writeFile(path.join(starter, 'bin', 'dev.sh'), '#!/bin/bash');
  await nodeFs.writeFile(path.join(starter, 'bin', 'server.sh'), '#!/bin/bash');
});
afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

describe('handleTheme', () => {
  beforeEach(() => {
    vi.mocked(startDev).mockReset();
    vi.mocked(stopDev).mockReset();
    vi.mocked(getDevStatus).mockReset();
  });

  it('list returns discovered themes from local fs', async () => {
    // create two theme dirs
    await nodeFs.mkdir(path.join(themes, 'alpha'));
    await nodeFs.writeFile(
      path.join(themes, 'alpha', 'theme.json'),
      JSON.stringify({ name: 'Alpha' }),
    );
    await nodeFs.mkdir(path.join(themes, 'beta'));
    await nodeFs.writeFile(
      path.join(themes, 'beta', 'theme.json'),
      JSON.stringify({ name: 'Beta' }),
    );

    const out = await handleTheme(
      { action: 'list' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect(Array.isArray(out)).toBe(true);
    const slugs = (out as Array<{ slug: string }>).map((t) => t.slug).sort();
    expect(slugs).toEqual(['alpha', 'beta']);
  });

  it('scaffold requires starter kit; copies into themesPath/<slug>', async () => {
    const out = await handleTheme(
      { action: 'scaffold', name: 'My Theme', author: 'me' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    const r = out as { path: string; name: string; manifest: { name: string; author: string } };
    expect(r.name).toBe('My Theme');
    expect(r.path).toBe(path.join(themes, 'my-theme'));
    expect(r.manifest.author).toBe('me');
    expect(await nodeFs.readFile(path.join(r.path, 'page.php'), 'utf8')).toBe('<?php');
  });

  it('scaffold rejects empty or whitespace-only name with VALIDATION', async () => {
    await expect(
      handleTheme(
        { action: 'scaffold', name: '' },
        {
          client: mockClient(),
          guard: new WriteGuard(cfg()),
          themesPath: themes,
          starterKitPath: starter,
        },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/name is required/),
    });
    await expect(
      handleTheme(
        { action: 'scaffold', name: '   ' },
        {
          client: mockClient(),
          guard: new WriteGuard(cfg()),
          themesPath: themes,
          starterKitPath: starter,
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('analyzes and validates themes in read-only mode without HTTP calls', async () => {
    await nodeFs.mkdir(path.join(themes, 'starter'));
    await nodeFs.writeFile(
      path.join(themes, 'starter', 'theme.json'),
      JSON.stringify({ name: 'Starter' }),
    );
    await nodeFs.writeFile(path.join(themes, 'starter', 'default.php'), '<h1>Starter</h1>');
    const client = mockClient();
    const deps = {
      client,
      guard: new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
      themesPath: themes,
      starterKitPath: starter,
    };
    const analysis = await handleTheme({ action: 'analyze', theme: 'starter' }, deps);
    expect(analysis).toMatchObject({ theme: 'starter' });
    const validation = await handleTheme({ action: 'validate', theme: 'starter' }, deps);
    expect(validation).toMatchObject({ ok: true });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('builds theme schema in read-only mode without HTTP calls', async () => {
    await nodeFs.mkdir(path.join(themes, 'schema-theme'));
    await nodeFs.mkdir(path.join(themes, 'schema-theme', 'i18n'), { recursive: true });
    await nodeFs.writeFile(
      path.join(themes, 'schema-theme', 'i18n', 'de.json'),
      JSON.stringify({ labels: { textIntro: 'Einleitung' } }),
    );
    const client = mockClient();
    const deps = {
      client,
      guard: new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
      themesPath: themes,
      starterKitPath: starter,
    };
    const result = await handleTheme({ action: 'schema', theme: 'schema-theme' }, deps);
    expect(result).toMatchObject({
      theme: 'schema-theme',
      locales: ['de'],
      translations: {
        de: {
          locale: 'de',
          path: 'i18n/de.json',
          fields: expect.any(Object),
        },
      },
    });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
    await expect(handleTheme({ action: 'schema' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'theme is required for schema',
    });
  });

  it('scaffold rejects duplicate', async () => {
    await nodeFs.mkdir(path.join(themes, 'my-theme'));
    await expect(
      handleTheme(
        { action: 'scaffold', name: 'My Theme' },
        {
          client: mockClient(),
          guard: new WriteGuard(cfg()),
          themesPath: themes,
          starterKitPath: starter,
        },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('read / write round-trip via handler', async () => {
    // scaffold first
    await handleTheme(
      { action: 'scaffold', name: 'Tmp' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    await handleTheme(
      { action: 'write', theme: 'tmp', path: 'page.php', content: 'edited' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    const r = await handleTheme(
      { action: 'read', theme: 'tmp', path: 'page.php' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect((r as { content: string }).content).toBe('edited');
  });

  it('files returns the theme tree', async () => {
    await handleTheme(
      { action: 'scaffold', name: 'Listable' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    const out = await handleTheme(
      { action: 'files', theme: 'listable' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    const rels = (out as Array<{ relPath: string }>).map((e) => e.relPath).sort();
    expect(rels).toContain('theme.json');
    expect(rels).toContain('page.php');
    expect(rels).toContain('package.json');
  });

  it('uninstall removes a theme dir', async () => {
    await nodeFs.mkdir(path.join(themes, 'goner'));
    await nodeFs.writeFile(path.join(themes, 'goner', 'theme.json'), '{}');
    const out = await handleTheme(
      { action: 'uninstall', theme: 'goner' },
      {
        client: mockClient(),
        guard: new WriteGuard(cfg()),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect(out).toMatchObject({ removed: path.join(themes, 'goner') });
    expect(
      await nodeFs
        .access(path.join(themes, 'goner'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('build runs install + build (skipped if no package.json scripts)', async () => {
    // use a tiny custom theme without npm scripts to keep the test fast and offline
    await nodeFs.mkdir(path.join(themes, 'no-scripts'));
    await nodeFs.writeFile(path.join(themes, 'no-scripts', 'theme.json'), '{}');
    await nodeFs.writeFile(
      path.join(themes, 'no-scripts', 'package.json'),
      JSON.stringify({ name: 'no-scripts', scripts: { build: 'echo built' } }),
    );
    const out = await handleTheme(
      { action: 'build', theme: 'no-scripts', install: false, confirm_token: 'x' },
      {
        client: mockClient(),
        guard: new WriteGuard({ ...cfg(), writeMode: 'unrestricted' }),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect((out as { build: { ok: boolean } }).build.ok).toBe(true);
  });

  it('diff previews a change against an existing file without writing', async () => {
    await nodeFs.mkdir(path.join(themes, 'diffable'));
    await nodeFs.writeFile(path.join(themes, 'diffable', 'theme.json'), '{}');
    await nodeFs.writeFile(path.join(themes, 'diffable', 'page.php'), 'old\n');
    const out = await handleTheme(
      { action: 'diff', theme: 'diffable', path: 'page.php', content: 'new\n' },
      {
        client: mockClient(),
        guard: new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect(out).toMatchObject({ path: 'page.php', changed: true, added: 1, removed: 1 });
    // nothing written: file still holds the original
    expect(await nodeFs.readFile(path.join(themes, 'diffable', 'page.php'), 'utf8')).toBe('old\n');
  });

  it('diff treats a missing file as a new file', async () => {
    await nodeFs.mkdir(path.join(themes, 'diffnew'));
    await nodeFs.writeFile(path.join(themes, 'diffnew', 'theme.json'), '{}');
    const out = await handleTheme(
      { action: 'diff', theme: 'diffnew', path: 'fresh.php', content: 'a\nb\n' },
      {
        client: mockClient(),
        guard: new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect(out).toMatchObject({ changed: true, added: 2, removed: 0 });
  });

  it('generate returns snippet content in read-only mode', async () => {
    const client = mockClient();
    const out = await handleTheme(
      { action: 'generate', kind: 'nav', name: 'mainNav' },
      {
        client,
        guard: new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
        themesPath: themes,
        starterKitPath: starter,
      },
    );
    expect(out).toMatchObject({ kind: 'nav', path: 'snippets/mainNav.php' });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('generate requires a kind', async () => {
    await expect(
      handleTheme(
        { action: 'generate' },
        {
          client: mockClient(),
          guard: new WriteGuard(cfg()),
          themesPath: themes,
          starterKitPath: starter,
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('dispatches dev actions to their lifecycle helpers', async () => {
    const deps = {
      client: mockClient(),
      guard: new WriteGuard(cfg()),
      themesPath: themes,
      starterKitPath: starter,
    };
    const started = {
      running: true,
      pid: 42,
      port: 4321,
      url: 'http://localhost:4321',
      startedAt: 'now',
      logPath: '/tmp/dev.log',
    };
    const stopped = { stopped: true, signalUsed: 'SIGTERM', wasLive: true };
    const status = { ...started };
    vi.mocked(startDev).mockResolvedValue(started);
    vi.mocked(stopDev).mockResolvedValue(stopped);
    vi.mocked(getDevStatus).mockResolvedValue(status);

    await expect(handleTheme({ action: 'dev', theme: 'demo', port: 4321 }, deps)).resolves.toEqual(
      started,
    );
    expect(startDev).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: path.join(themes, 'demo'),
        fs: expect.any(Object),
        portHint: 4321,
        portTimeoutMs: 20_000,
        runInstall: expect.any(Function),
      }),
    );

    await expect(handleTheme({ action: 'dev_stop', theme: 'demo' }, deps)).resolves.toEqual(
      stopped,
    );
    expect(stopDev).toHaveBeenCalledWith(path.join(themes, 'demo'), expect.any(Object));

    await expect(handleTheme({ action: 'dev_status', theme: 'demo' }, deps)).resolves.toEqual(
      status,
    );
    expect(getDevStatus).toHaveBeenCalledWith(path.join(themes, 'demo'), expect.any(Object));
  });

  it('requires theme for every dev action', async () => {
    const deps = {
      client: mockClient(),
      guard: new WriteGuard(cfg()),
      themesPath: themes,
      starterKitPath: starter,
    };
    for (const action of ['dev', 'dev_stop', 'dev_status'] as const) {
      await expect(handleTheme({ action }, deps)).rejects.toMatchObject({
        code: 'VALIDATION',
        message: `theme is required for ${action}`,
      });
    }
  });

  describe('v2 PackageManager', () => {
    let themesPath: string;
    let starterPath: string;
    beforeEach(() => {
      themesPath = path.join(os.tmpdir(), `mcp-theme-${Date.now()}-${Math.random()}`);
      starterPath = path.join(os.tmpdir(), `mcp-starter-${Date.now()}-${Math.random()}`);
    });
    afterEach(async () => {
      await nodeFs.rm(themesPath, { recursive: true, force: true });
      await nodeFs.rm(starterPath, { recursive: true, force: true });
    });

    it('list_installed POSTs /_api/package-manager/get-package-collection', async () => {
      const c = mockClient();
      (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ packages: [{ name: 'vendor/foo' }] });
      const out = await handleTheme(
        { action: 'list_installed' },
        { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: starterPath },
      );
      expect(out).toEqual({ packages: [{ name: 'vendor/foo' }] });
      expect(c.post).toHaveBeenCalledWith('/_api/package-manager/get-package-collection', {});
    });

    it('outdated POSTs /_api/package-manager/get-outdated', async () => {
      const c = mockClient();
      (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ outdated: [] });
      const out = await handleTheme(
        { action: 'outdated' },
        { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: starterPath },
      );
      expect(out).toEqual({ outdated: [] });
      expect(c.post).toHaveBeenCalledWith('/_api/package-manager/get-outdated', {});
    });
    it('update requires package', async () => {
      const c = mockClient();
      await expect(
        handleTheme({ action: 'update' }, { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: starterPath }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('update POSTs /_api/package-manager/update with package', async () => {
      const c = mockClient();
      (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: 'ok' });
      const out = await handleTheme(
        { action: 'update', package: 'vendor/foo' },
        { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: starterPath },
      );
      expect(out).toEqual({ success: 'ok' });
      expect(c.post).toHaveBeenCalledWith('/_api/package-manager/update', { package: 'vendor/foo' });
    });

    it('update returns pending confirm token in confirm-destructive mode', async () => {
      const c = mockClient();
      const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
      const out = await handleTheme(
        { action: 'update', package: 'vendor/foo' },
        { client: c, guard, themesPath, starterKitPath: starterPath },
      );
      expect(out).toMatchObject({ allowed: 'pending' });
      expect(c.post).not.toHaveBeenCalled();
    });

    it('update_all POSTs /_api/package-manager/update-all', async () => {
      const c = mockClient();
      (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: 'ok' });
      const out = await handleTheme(
        { action: 'update_all' },
        { client: c, guard: new WriteGuard(cfg()), themesPath, starterKitPath: starterPath },
      );
      expect(out).toEqual({ success: 'ok' });
      expect(c.post).toHaveBeenCalledWith('/_api/package-manager/update-all', {});
    });

    it('update_all returns pending confirm token in confirm-destructive mode', async () => {
      const c = mockClient();
      const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
      const out = await handleTheme(
        { action: 'update_all' },
        { client: c, guard, themesPath, starterKitPath: starterPath },
      );
      expect(out).toMatchObject({ allowed: 'pending' });
      expect(c.post).not.toHaveBeenCalled();
    });

  });
});
