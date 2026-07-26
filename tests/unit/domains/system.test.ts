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
