import { describe, it, expect, vi } from 'vitest';
import { handlePages } from '../../../src/domains/pages.js';
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
  };
}

describe('handlePages (v2 /_api)', () => {
  it('list POSTs /_api/page-collection/get-recently-edited', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/' }]);
    const out = await handlePages({ action: 'list' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page-collection/get-recently-edited', {});
  });

  it('list ignores context and fields_csv (v2 uses authenticated endpoint)', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await handlePages(
      { action: 'list', context: '/blog', fields_csv: 'title,url' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/page-collection/get-recently-edited', {});
  });

  it('get requires url and POSTs /_api/page/data', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'get' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: '/x', fields: {} });
    await handlePages({ action: 'get', url: '/x' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page/data', { url: '/x' });
  });

  it('get retries on 404 (v2 commit-lag) and eventually surfaces NOT_FOUND', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('HTTP 404'), { code: 'NOT_FOUND' }),
    );
    await expect(
      handlePages({ action: 'get', url: '/missing' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((c.post as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('create rejects empty title', async () => {
    await expect(
      handlePages(
        { action: 'create', title: '', target_url: '/' },
        mockClient(),
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('create rejects whitespace-only title', async () => {
    for (const t of ['   ', '\t\t', ' \t  ']) {
      await expect(
        handlePages(
          { action: 'create', title: t, target_url: '/' },
          mockClient(),
          new WriteGuard(cfg()),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('create accepts a normal title', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: 'page?url=%2Fhello' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: '/hello', fields: {} });
    await expect(
      handlePages({ action: 'create', title: 'Hello', target_url: '/' }, c, new WriteGuard(cfg())),
    ).resolves.toMatchObject({ ok: true, url: '/hello' });
  });

  it('create posts to /_api/page/add, publishes, polls until readable', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: 'page?url=%2Fhello' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: '/hello', fields: {} });
    const out = await handlePages(
      { action: 'create', title: 'Hello', target_url: '/blog', template: 'standard-lite/page.php' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenNthCalledWith(1, '/_api/page/add', {
      targetPage: '/blog',
      title: 'Hello',
      theme_template: 'standard-lite/page.php',
    });
    expect(c.post).toHaveBeenNthCalledWith(2, '/_api/page/publish', { url: '/hello' });
    expect(out).toMatchObject({ ok: true, url: '/hello' });
  });

  it('create fallback: if redirect has no url, publish to input.url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: 'no-url-here' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: '/expected', fields: {} });
    await handlePages(
      { action: 'create', title: 'Hi', url: '/expected' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenNthCalledWith(2, '/_api/page/publish', { url: '/expected' });
  });

  it('create tolerates publish failure (best-effort)', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: 'page?url=%2Fhello' })
      .mockRejectedValueOnce(new Error('publish offline'))
      .mockResolvedValue({ url: '/hello', fields: {} });
    const out = await handlePages(
      { action: 'create', title: 'Hello', target_url: '/blog' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toMatchObject({ ok: true, url: '/hello' });
  });

  it('update rejects whitespace-only title', async () => {
    await expect(
      handlePages(
        { action: 'update', url: '/x', title: '   ' },
        mockClient(),
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('update returns a pending confirm_token when title changes in confirm-destructive mode', async () => {
    const c = mockClient();
    const out = await handlePages(
      { action: 'update', url: '/x', title: 'New' },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({
      allowed: 'pending',
      action: 'pages.update_rename',
      target: '/x',
      confirmToken: expect.any(String),
    });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('update runs without confirmation when no title changes (ordinary write)', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 'x' });
    const out = await handlePages(
      { action: 'update', url: '/x', fields: { text: 'body' } },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({ ok: true, url: '/x' });
  });

  it('update publishes via input.url, polls on resulting slug, returns canonical URL', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ updateUI: true, slug: 'renamed' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: '/renamed', fields: {} });
    const out = await handlePages(
      {
        action: 'update',
        url: '/original',
        title: 'renamed',
        private: true,
        tags: ['x', 'y'],
        fields: { main: [] },
      },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenNthCalledWith(1, '/_api/page/data', {
      url: '/original',
      data: { title: 'renamed', private: true, tags: 'x,y', main: [] },
    });
    expect(c.post).toHaveBeenNthCalledWith(2, '/_api/page/publish', { url: '/original' });
    expect(out).toMatchObject({ ok: true, url: '/renamed' });
  });

  it('delete requires url and POSTs to /_api/page/delete', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'delete' }, c, new WriteGuard(cfg()))).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages({ action: 'delete', url: '/x' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page/delete', { url: '/x' });
  });

  it('delete in confirm-destructive mode returns a pending permit', async () => {
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const r = await handlePages({ action: 'delete', url: '/x' }, mockClient(), guard);
    expect(r).toMatchObject({ allowed: 'pending' });
  });

  it('move without target_url throws VALIDATION', async () => {
    await expect(
      handlePages({ action: 'move', url: '/x' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('move with target_url posts to /_api/page/move', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 200,
      data: { url: '/dest/x' },
    });
    await handlePages({ action: 'move', url: '/x', target_url: '/dest' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page/move', { url: '/x', targetPage: '/dest' });
  });

  it('move with target_url and layout posts both', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ code: 200 });
    await handlePages(
      { action: 'move', url: '/a', target_url: '/dest', layout: '["/a","/b"]' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/page/move', {
      url: '/a',
      targetPage: '/dest',
      layout: '["/a","/b"]',
    });
  });

  it('move with non-JSON layout throws VALIDATION', async () => {
    await expect(
      handlePages(
        { action: 'move', url: '/x', target_url: '/d', layout: 'not-json' },
        mockClient(),
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('move with empty array layout throws VALIDATION', async () => {
    await expect(
      handlePages(
        { action: 'move', url: '/x', target_url: '/d', layout: '[]' },
        mockClient(),
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('move with non-string array entries throws VALIDATION', async () => {
    await expect(
      handlePages(
        { action: 'move', url: '/x', target_url: '/d', layout: '[1,2,3]' },
        mockClient(),
        new WriteGuard(cfg()),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('duplicate POSTs to /_api/page/duplicate', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ redirect: 'page?url=%2Fx-copy' });
    await handlePages({ action: 'duplicate', url: '/x' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page/duplicate', { url: '/x' });
  });

  it('duplicate requires url', async () => {
    await expect(
      handlePages({ action: 'duplicate' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('publish posts /_api/page/publish and reports published', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const out = await handlePages({ action: 'publish', url: '/blog' }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({ ok: true, url: '/blog', published: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page/publish', { url: '/blog' });
  });

  it('publish requires url', async () => {
    await expect(
      handlePages({ action: 'publish' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('update with publish:false saves as a draft (no publish call)', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 'blog' });
    await handlePages(
      { action: 'update', url: '/blog', title: 'T', publish: false },
      c,
      new WriteGuard(cfg()),
    );
    const paths = (c.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(paths).toContain('/_api/page/data');
    expect(paths).not.toContain('/_api/page/publish');
  });
  it('update trims tags and normalises trailing slashes from URL', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 'blog' });
    await handlePages(
      { action: 'update', url: '/blog/', tags: [' news ', ' ', 'tech '] },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = (c.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { url: string; data: { tags?: string } }];
    expect(payload.url).toBe('/blog');
    expect(payload.data.tags).toBe('news,tech');
  });

  it('batch_update requires a non-empty items array', async () => {
    await expect(
      handlePages({ action: 'batch_update' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      handlePages({ action: 'batch_update', items: [] }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('batch_update updates each item and reports per-item results', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 's' });
    const out = await handlePages(
      {
        action: 'batch_update',
        items: [
          { url: '/a', title: 'A', publish: false },
          { url: '/b', title: 'B', publish: false },
        ],
      },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toMatchObject({
      ok: true,
      results: [
        { url: '/a', ok: true },
        { url: '/b', ok: true },
      ],
    });
  });

  it('batch_update captures a per-item failure without aborting the batch', async () => {
    const c = mockClient();
    let dataCalls = 0;
    (c.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/_api/page/data') {
        dataCalls += 1;
        if (dataCalls === 1) return Promise.reject(new AutomadMcpError('VALIDATION', 'bad title'));
      }
      return Promise.resolve({ slug: 's' });
    });
    const out = await handlePages(
      {
        action: 'batch_update',
        items: [
          { url: '/a', title: 'A', publish: false },
          { url: '/b', title: 'B', publish: false },
        ],
      },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toMatchObject({
      ok: false,
      results: [
        { url: '/a', ok: false, code: 'VALIDATION', message: expect.stringMatching(/bad title/) },
        { url: '/b', ok: true, resultingUrl: expect.any(String) },
      ],
    });
  });

  it('batch_update requires per-item confirm_token for title-rename in confirm-destructive mode', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 's' });
    const out = await handlePages(
      {
        action: 'batch_update',
        items: [
          { url: '/safe', fields: { text: 'harmless' }, publish: false }, // no rename — runs directly
          { url: '/renamed', title: 'New Name', publish: false }, // rename — needs token
        ],
      },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({
      ok: false,
      results: [
        { url: '/safe', ok: true },
        {
          url: '/renamed',
          ok: false,
          requiresConfirmation: true,
          confirmToken: expect.any(String),
        },
      ],
    });
    // The safe item must have written (1 POST to page/data); the renamed item must NOT have written.
    const dataCalls = (c.post as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === '/_api/page/data',
    );
    expect(dataCalls.length).toBe(1);
  });

  it('batch_update runs renamed items when the per-item confirm_token matches', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ slug: 's' });
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    // First call: returns pending for the renamed item.
    const first = await handlePages(
      {
        action: 'batch_update',
        items: [{ url: '/renamed', title: 'New Name', publish: false }],
      },
      c,
      guard,
    );
    const token = (first as { results: Array<{ confirmToken?: string }> }).results[0]!
      .confirmToken!;
    expect(token).toBeTruthy();
    // Second call: same token + item succeeds.
    const second = await handlePages(
      {
        action: 'batch_update',
        items: [{ url: '/renamed', title: 'New Name', publish: false, confirm_token: token }],
      },
      c,
      guard,
    );
    expect(second).toMatchObject({
      ok: true,
      results: [{ url: '/renamed', ok: true, resultingUrl: expect.any(String) }],
    });
  });

  it('batch_update rejected items return a structured FORBIDDEN envelope', async () => {
    const c = mockClient();
    const out = await handlePages(
      {
        action: 'batch_update',
        items: [{ url: '/renamed', title: 'New Name', publish: false }],
      },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'read-only' }),
    );
    expect(out).toMatchObject({
      ok: false,
      results: [{ url: '/renamed', ok: false, code: 'FORBIDDEN', message: expect.any(String) }],
    });
  });

  it('trash_list POSTs /_api/page-trash/list', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/x' }]);
    const out = await handlePages({ action: 'trash_list' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/x' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/list', {});
  });

  it('trash_restore requires url', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'trash_restore' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('trash_restore POSTs /_api/page-trash/restore with url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: 'trash_restore', url: '/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/restore', { url: '/x' });
  });

  it('trash_restore returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages({ action: 'trash_restore', url: '/x' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('trash_permanently_delete POSTs /_api/page-trash/permanently-delete with url', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: 'trash_permanently_delete', url: '/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/permanently-delete', { url: '/x' });
  });

  it('trash_clear POSTs /_api/page-trash/clear with no body', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages({ action: 'trash_clear' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/clear', {});
  });

  it('breadcrumbs requires url and POSTs /_api/page/breadcrumbs', async () => {
    const c = mockClient();
    await expect(handlePages({ action: 'breadcrumbs' }, c, new WriteGuard(cfg()))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/', title: 'Home' }]);
    const out = await handlePages({ action: 'breadcrumbs', url: '/foo' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/', title: 'Home' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page/breadcrumbs', { url: '/foo' });
  });

  it('publication_state requires url and POSTs /_api/page/get-publication-state', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'publication_state' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hasDraft: true });
    const out = await handlePages(
      { action: 'publication_state', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ hasDraft: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page/get-publication-state', { url: '/foo' });
  });

  it('recent POSTs /_api/page-collection/get-recently-edited', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: '/x' }]);
    const out = await handlePages({ action: 'recent' }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: '/x' }]);
    expect(c.post).toHaveBeenCalledWith('/_api/page-collection/get-recently-edited', {});
  });

  it('discard_draft requires url and POSTs /_api/page/discard-draft', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'discard_draft' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: 'discard_draft', url: '/foo' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(c.post).toHaveBeenCalledWith('/_api/page/discard-draft', { url: '/foo' });
  });

  it('discard_draft returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages({ action: 'discard_draft', url: '/foo' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });
});
