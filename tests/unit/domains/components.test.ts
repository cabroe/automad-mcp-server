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
  it('data POSTs /_api/component/data', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ components: [] });
    await handleComponents({ action: 'data' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/component/data', { components: [] });
  });

  it('discard_draft requires url and POSTs /_api/component/discard-draft', async () => {
    const c = mockClient();
    await expect(
      handleComponents({ action: 'discard_draft' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
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
    await expect(
      handleComponents({ action: 'publication_state' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hasDraft: true });
    await handleComponents(
      { action: 'publication_state', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/component/get-publication-state', { url: '/foo' });
  });

  it('publish requires url and POSTs /_api/component/publish', async () => {
    const c = mockClient();
    await expect(
      handleComponents({ action: 'publish' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
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
