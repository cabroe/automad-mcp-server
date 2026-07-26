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
    await handleMail(
      { action: 'save', transport: 'smtp', from: 'a@example.com' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/mail-config/save', { transport: 'smtp', from: 'a@example.com' });
  });

  it('save requires transport and from', async () => {
    const c = mockClient();
    await expect(handleMail({ action: 'save' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handleMail({ action: 'save', transport: 'smtp' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
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
