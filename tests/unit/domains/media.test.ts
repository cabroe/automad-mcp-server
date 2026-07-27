import { describe, it, expect, vi } from 'vitest';
import { handleMedia } from '../../../src/domains/media.js';
import type { HttpClient } from '../../../src/client.js';
import { WriteGuard } from '../../../src/write-guard.js';
import { AutomadMcpError } from '../../../src/errors.js';
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
    requestTimeoutMs: 30_000,
  };
}

describe('handleMedia (v2 /_api)', () => {
  it('list POSTs url to /_api/file-collection/list', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    const out = await handleMedia(
      { action: 'list', url: '/shared/images' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ files: [] });
    expect(c.post).toHaveBeenCalledWith('/_api/file-collection/list', { url: '/shared/images' });
  });

  it("list with no url defaults to shared ('')", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    await handleMedia({ action: 'list' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/file-collection/list', { url: '' });
  });

  it('upload requires source', async () => {
    await expect(
      handleMedia({ action: 'upload', url: '/x' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('upload delegates to client.upload with url+source', async () => {
    const c = mockClient();
    (c.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const src = { base64: 'AA==', filename: 'x.png', mimeType: 'image/png' };
    await handleMedia(
      { action: 'upload', url: '/shared/images', source: src },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.upload).toHaveBeenCalledWith(
      '/_api/file-collection/upload',
      expect.objectContaining({ ...src, url: '/shared/images' }),
    );
  });

  it('delete requires url and filename', async () => {
    await expect(
      handleMedia({ action: 'delete' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handleMedia({ action: 'delete', url: '/shared/images' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/filename/) });
  });
  it('upload and delete reject filename containing path separators', async () => {
    const c = mockClient();
    await expect(
      handleMedia(
        {
          action: 'upload',
          url: '/shared',
          source: { base64: 'aGVsbG8=', filename: '../evil.png', mimeType: 'image/png' },
        },
        c,
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      handleMedia(
        { action: 'delete', url: '/shared', filename: 'sub/file.png' },
        c,
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('delete requires a confirm_token in confirm-destructive mode', async () => {
    const c = mockClient();
    const out = await handleMedia(
      { action: 'delete', url: '/shared/images', filename: 'old.png' },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({ allowed: 'pending', action: 'media.delete' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('import posts file/import with the source URL and target directory', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    const out = await handleMedia(
      { action: 'import', url: '/blog/post', import_url: 'https://example.com/photo.jpg' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/file/import', {
      importUrl: 'https://example.com/photo.jpg',
      url: '/blog/post',
    });
    // v2 answers with an empty envelope on success — the handler reports the
    // request instead of echoing nothing back to the model.
    expect(out).toEqual({
      ok: true,
      importUrl: 'https://example.com/photo.jpg',
      url: '/blog/post',
    });
  });

  it('import targets the shared directory when no url is given', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    await handleMedia(
      { action: 'import', import_url: 'https://example.com/photo.jpg' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/file/import', {
      importUrl: 'https://example.com/photo.jpg',
      url: '',
    });
  });

  it('import rejects a missing, blank, malformed or non-http URL before calling v2', async () => {
    for (const import_url of [undefined, '   ', 'not-a-url', 'file:///etc/passwd', 'ftp://x/y.png']) {
      const c = mockClient();
      await expect(
        handleMedia(
          { action: 'import', url: '/blog', ...(import_url === undefined ? {} : { import_url }) },
          c,
          new WriteGuard(cfg()),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(c.post).not.toHaveBeenCalled();
    }
  });

  it('maps v2 import failures onto codes a caller can act on', async () => {
    // v2 answers every import failure with HTTP 200 + a terse error string,
    // which the generic envelope mapping can only call UNKNOWN. Live-verified
    // strings on 2.0.0-beta.51.
    const cases: Array<[string, string]> = [
      ['Unsupported file type', 'VALIDATION'],
      ['The file import has failed!', 'NETWORK'],
    ];
    for (const [v2Message, expected] of cases) {
      const c = mockClient();
      (c.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new AutomadMcpError('UNKNOWN', v2Message),
      );
      await expect(
        handleMedia(
          { action: 'import', url: '/blog', import_url: 'https://example.com/a.png' },
          c,
          new WriteGuard(cfg()),
        ),
      ).rejects.toMatchObject({ code: expected, details: { importUrl: 'https://example.com/a.png' } });
    }
  });

  it('passes an unrecognised import failure through unchanged', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AutomadMcpError('FORBIDDEN', 'Disk quota exceeded'),
    );
    await expect(
      handleMedia(
        { action: 'import', url: '/blog', import_url: 'https://example.com/a.png' },
        c,
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('import is an ordinary write: it runs directly in confirm-destructive mode', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    const out = await handleMedia(
      { action: 'import', url: '/blog', import_url: 'https://example.com/a.png' },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({ ok: true });
    expect(c.post).toHaveBeenCalledTimes(1);
  });

  it('import is refused in read-only mode', async () => {
    const c = mockClient();
    await expect(
      handleMedia(
        { action: 'import', url: '/blog', import_url: 'https://example.com/a.png' },
        c,
        new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('delete posts the file-collection/list endpoint with action=delete and selected map', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    await handleMedia(
      { action: 'delete', url: '/shared/images', filename: 'old.png' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/file-collection/list', {
      url: '/shared/images',
      action: 'delete',
      selected: { 'old.png': true },
    });
  });
});
