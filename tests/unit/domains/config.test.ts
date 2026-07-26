import { describe, it, expect, vi } from 'vitest';
import { handleConfig } from '../../../src/domains/config.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

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
  };
}

describe('handleConfig (v2 /_api)', () => {
  it('get returns version+sitename+envKeys from /_api/app/bootstrap', async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      version: '2.0.0-beta.51',
      sitename: 'My Site',
      envKeys: { cache: '1' },
      dashboard: '/dashboard',
    });
    const out = await handleConfig({ action: 'get' }, c, new WriteGuard(cfg()));
    expect(out).toEqual({
      version: '2.0.0-beta.51',
      sitename: 'My Site',
      envKeys: { cache: '1' },
      dashboard: '/dashboard',
    });
    expect(c.get).toHaveBeenCalledWith('/_api/app/bootstrap');
  });

  it('set posts {type, ...payload} to /_api/config/update', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleConfig(
      { action: 'set', type: 'cache', payload: { cacheEnabled: true, cacheLifetime: 600 } },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/config/update', {
      type: 'cache',
      cacheEnabled: true,
      cacheLifetime: 600,
    });
  });

  it('set without type throws VALIDATION', async () => {
    await expect(
      handleConfig({ action: 'set' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('set without payload throws VALIDATION', async () => {
    await expect(
      handleConfig({ action: 'set', type: 'cache' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
