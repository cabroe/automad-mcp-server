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
