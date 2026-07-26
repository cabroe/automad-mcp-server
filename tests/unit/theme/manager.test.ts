import { describe, it, expect, vi } from 'vitest';
import { ThemeManager } from '../../../src/theme/manager.js';
import type { ThemeFs } from '../../../src/theme/fs.js';
import type { HttpClient } from '../../../src/client.js';

function mockDeps() {
  const fs: ThemeFs = {
    exists: vi.fn(),
    isDirectory: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    list: vi.fn(),
    mkdirp: vi.fn(),
    remove: vi.fn(),
    copyDir: vi.fn(),
    appendLog: vi.fn(),
    readLogTail: vi.fn(),
  };
  const client: HttpClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
  return {
    fs,
    client,
    themesPath: '/themes',
    starterKitPath: '/starter',
  };
}

describe('ThemeManager', () => {
  it('list returns empty array if no directories exist', async () => {
    const deps = mockDeps();
    vi.mocked(deps.fs.exists).mockResolvedValue(true);
    vi.mocked(deps.fs.list).mockResolvedValue([]);
    const mgr = new ThemeManager(deps);
    const list = await mgr.list();
    expect(list).toEqual([]);
  });

  it('install derives clean slug from local Windows or Posix paths', async () => {
    const deps = mockDeps();
    vi.mocked(deps.fs.exists).mockImplementation(async (p: string) => p === '/themes' || p === 'C:\\path\\to\\my-theme');
    vi.mocked(deps.fs.copyDir).mockResolvedValue(undefined);
    const mgr = new ThemeManager(deps);
    const info = await mgr.install('C:\\path\\to\\my-theme');
    expect(info.slug).toBe('my-theme');
  });
  it('uninstall prevents path traversal', async () => {
    const deps = mockDeps();
    const mgr = new ThemeManager(deps);
    await expect(mgr.uninstall('../outside')).rejects.toThrow('invalid theme slug');
  });

  it('activate handles API errors gracefully', async () => {
    const deps = mockDeps();
    vi.mocked(deps.fs.exists).mockResolvedValue(true);
    vi.mocked(deps.client.post).mockRejectedValue(new Error('API Fail'));
    const mgr = new ThemeManager(deps);
    const res = await mgr.activate('test-theme');
    expect(res.activated).toBe(false);
  });
});
