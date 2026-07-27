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
  it('edit_info requires new_name and old_name and POSTs /_api/file/edit-info', async () => {
    const c = mockClient();
    await expect(handleFileMeta({ action: 'edit_info' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handleFileMeta({ action: 'edit_info', new_name: 'foo' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleFileMeta(
      { action: 'edit_info', new_name: 'new.jpg', old_name: 'old.jpg' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/file/edit-info', {
      'new-name': 'new.jpg',
      'old-name': 'old.jpg',
      // v2 resolves the file relative to `url`; without it the lookup lands in
      // the wrong directory and fails with a misleading "Permissions denied".
      url: '',
    });
  });

  it('edit_info returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handleFileMeta(
      { action: 'edit_info', new_name: 'new.jpg', old_name: 'old.jpg' },
      c,
      guard,
    );
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('passes the page url through so v2 looks in the right directory', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleFileMeta(
      { action: 'edit_info', url: '/blog/post', new_name: 'new', old_name: 'old.png' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/file/edit-info', {
      'new-name': 'new',
      'old-name': 'old.png',
      url: '/blog/post',
    });
  });
});
