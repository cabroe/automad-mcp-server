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

/**
 * v2's `page/data` endpoint is both the read and the write: `{url}` reads,
 * `{url, data}` saves. Since a save is a full replace that requires a title,
 * `updateOnePage` reads the current record first — so update tests have to
 * answer both shapes.
 */
function mockPageData(
  c: HttpClient,
  opts: {
    fields?: Record<string, unknown>;
    save?: Record<string, unknown>;
    /** Absolute template path, the shape v2 reports on read. */
    template?: string;
    /** What the publication-state poll reports. Defaults to published. */
    published?: boolean;
  } = {},
): void {
  const fields = opts.fields ?? { title: 'Existing Title' };
  const save = opts.save ?? { slug: 's' };
  const isPublished = opts.published ?? true;
  (c.post as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string, body?: Record<string, unknown>) => {
      if (path === '/_api/page/data' && body && !('data' in body)) {
        return Promise.resolve({
          url: body['url'],
          fields,
          unused: {},
          ...(opts.template !== undefined ? { template: opts.template } : {}),
        });
      }
      // Answer the post-save publish handshake, otherwise every publishing test
      // spends the full confirmation timeout polling a mock that never says yes.
      if (path === '/_api/page/get-publication-state') return Promise.resolve({ isPublished });
      return Promise.resolve(save);
    },
  );
}

/**
 * Answer the publish handshake: `page/publish`, then the publication-state poll
 * `updateOnePage`/`publish` use to confirm the page really went live, then the
 * cache clear. `published` controls what the state endpoint reports.
 */
function mockPublish(c: HttpClient, opts: { published?: boolean } = {}): void {
  const isPublished = opts.published ?? true;
  (c.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/_api/page/get-publication-state') return Promise.resolve({ isPublished });
    return Promise.resolve({});
  });
}

/** The `page/data` calls that actually wrote (as opposed to the pre-read). */
function saveCalls(c: HttpClient): unknown[][] {
  return (c.post as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => call[0] === '/_api/page/data' && call[1] && 'data' in (call[1] as object),
  );
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
      .mockResolvedValue({ url: '/hello', fields: {}, isPublished: true });
    await expect(
      handlePages({ action: 'create', title: 'Hello', target_url: '/' }, c, new WriteGuard(cfg())),
    ).resolves.toMatchObject({ ok: true, url: '/hello' });
  });

  it('create posts to /_api/page/add, publishes, polls until readable', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: 'page?url=%2Fhello' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: '/hello', fields: {}, isPublished: true });
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
      .mockResolvedValue({ url: '/expected', fields: {}, isPublished: true });
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
      .mockResolvedValue({ url: '/hello', fields: {}, isPublished: true });
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
    mockPageData(c, { save: { slug: 'x' } });
    const out = await handlePages(
      { action: 'update', url: '/x', fields: { text: 'body' } },
      c,
      new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' }),
    );
    expect(out).toMatchObject({ ok: true, url: '/x' });
  });

  it('update carries the stored title and untouched fields into a fields-only save', async () => {
    // Live-verified on v2 2.0.0-beta.51: `page/data` saves are a full replace
    // and reject a payload without `title` ("Title missing!"). A fields-only
    // update must therefore merge onto what is stored, not post the delta.
    const c = mockClient();
    mockPageData(c, {
      fields: { title: 'Stored Title', intro: 'keep me', text: 'old' },
      save: { slug: 'page' },
    });
    await handlePages(
      { action: 'update', url: '/page', fields: { text: 'new' }, publish: false },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = saveCalls(c)[0] as [string, { data: Record<string, unknown> }];
    expect(payload.data).toEqual({ title: 'Stored Title', intro: 'keep me', text: 'new' });
  });

  it('update fails with VALIDATION when neither the caller nor the page has a title', async () => {
    const c = mockClient();
    mockPageData(c, { fields: {} });
    await expect(
      handlePages({ action: 'update', url: '/page', fields: { text: 'x' } }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(saveCalls(c).length).toBe(0);
  });

  it('update carries the stored template forward so v2 cannot reset it', async () => {
    // Live-verified: a `page/data` save without `theme_template` resets the
    // page to the site default with an *empty* template name, after which v2
    // answers the public URL with "Template missing!" (HTTP 500).
    const c = mockClient();
    mockPageData(c, {
      fields: { title: 'Home' },
      template: '/app/packages/mcp/cafe-sonnenschein/home.php',
    });
    await handlePages(
      { action: 'update', url: '/home', fields: { text: 'x' }, publish: false },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = saveCalls(c)[0] as [string, { theme_template?: string }];
    expect(payload.theme_template).toBe('mcp/cafe-sonnenschein/home');
  });

  it('update lets an explicit template override the stored one', async () => {
    const c = mockClient();
    mockPageData(c, {
      fields: { title: 'Home' },
      template: '/app/packages/mcp/cafe-sonnenschein/home.php',
    });
    await handlePages(
      { action: 'update', url: '/home', template: 'mcp/cafe-sonnenschein/landing', publish: false },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = saveCalls(c)[0] as [string, { theme_template?: string }];
    expect(payload.theme_template).toBe('mcp/cafe-sonnenschein/landing');
  });

  it('update sends no template when the page has none selected', async () => {
    // v2 stores "no template" as a path with an empty basename; echoing that
    // back would look like a deliberate (broken) selection.
    const c = mockClient();
    mockPageData(c, {
      fields: { title: 'Home' },
      template: '/app/packages/automad/standard-lite/.php',
    });
    await handlePages(
      { action: 'update', url: '/home', fields: { text: 'x' }, publish: false },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = saveCalls(c)[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty('theme_template');
  });

  it('update publishes via input.url, polls on resulting slug, returns canonical URL', async () => {
    const c = mockClient();
    mockPageData(c, {
      fields: { title: 'original', keepMe: 'untouched' },
      save: { updateUI: true, slug: 'renamed' },
    });
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
    // Call 1 reads the current record, call 2 writes it back merged: the
    // caller's changes on top, `keepMe` preserved rather than dropped.
    expect(c.post).toHaveBeenNthCalledWith(1, '/_api/page/data', { url: '/original' });
    expect(c.post).toHaveBeenNthCalledWith(2, '/_api/page/data', {
      url: '/original',
      data: { title: 'renamed', keepMe: 'untouched', private: true, tags: 'x,y', main: [] },
    });
    expect(c.post).toHaveBeenNthCalledWith(3, '/_api/page/publish', { url: '/original' });
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

  it('publish posts /_api/page/publish, confirms the state, and clears the cache', async () => {
    const c = mockClient();
    mockPublish(c);
    const out = await handlePages({ action: 'publish', url: '/blog' }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({ ok: true, url: '/blog', published: true });
    expect(out).not.toHaveProperty('warnings');
    const paths = (c.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(paths).toContain('/_api/page/publish');
    // Confirmation must come from the endpoint that distinguishes draft from
    // published — `page/data` serves drafts too and would prove nothing.
    expect(paths).toContain('/_api/page/get-publication-state');
    // Without this a visitor keeps getting the cached previous version.
    expect(paths).toContain('/_api/cache/clear');
  });

  it('publish reports the failure instead of claiming success', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path === '/_api/page/publish'
        ? Promise.reject(new AutomadMcpError('NETWORK', 'connection reset'))
        : Promise.resolve({}),
    );
    const out = (await handlePages(
      { action: 'publish', url: '/blog' },
      c,
      new WriteGuard(cfg()),
    )) as { ok: boolean; published: boolean; warnings: string[] };
    expect(out.ok).toBe(false);
    expect(out.published).toBe(false);
    expect(out.warnings[0]).toMatch(/publishing failed/i);
  });

  it('publish warns when the page never reports itself published', async () => {
    const c = mockClient();
    mockPublish(c, { published: false });
    const out = (await handlePages(
      { action: 'publish', url: '/blog' },
      c,
      new WriteGuard(cfg()),
    )) as { published: boolean; warnings: string[] };
    expect(out.published).toBe(false);
    expect(out.warnings[0]).toMatch(/still not reported as published/i);
  });

  it('update reports published and carries a publish failure to the caller', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, body?: Record<string, unknown>) => {
        if (path === '/_api/page/data' && body && !('data' in body)) {
          return Promise.resolve({ url: body['url'], fields: { title: 'T' }, unused: {} });
        }
        if (path === '/_api/page/publish') {
          return Promise.reject(new AutomadMcpError('FORBIDDEN', 'nope'));
        }
        return Promise.resolve({ slug: 'blog' });
      },
    );
    const out = (await handlePages(
      { action: 'update', url: '/blog', fields: { text: 'x' } },
      c,
      new WriteGuard(cfg()),
    )) as { ok: boolean; published: boolean; warnings: string[] };
    // The save itself succeeded — that is not undone by a failed publish.
    expect(out.ok).toBe(true);
    expect(out.published).toBe(false);
    expect(out.warnings[0]).toMatch(/still a draft/i);
  });

  it('create with publish:false reports a draft without warning about it', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({ redirect: 'page?url=%2Fdraft' });
    const out = (await handlePages(
      { action: 'create', title: 'Draft', target_url: '/', publish: false },
      c,
      new WriteGuard(cfg()),
    )) as { published: boolean; warnings?: string[] };
    expect(out.published).toBe(false);
    expect(out.warnings).toBeUndefined();
    const paths = (c.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(paths).not.toContain('/_api/page/publish');
  });

  it('delete clears the cache so the removed page stops being served', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await handlePages({ action: 'delete', url: '/gone' }, c, new WriteGuard(cfg()));
    const paths = (c.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(paths).toEqual(['/_api/page/delete', '/_api/cache/clear']);
  });

  it('a cache clear that fails becomes a warning, not a failed write', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/_api/cache/clear') {
        return Promise.reject(new AutomadMcpError('NETWORK', 'timeout'));
      }
      if (path === '/_api/page/get-publication-state') return Promise.resolve({ isPublished: true });
      return Promise.resolve({});
    });
    const out = (await handlePages(
      { action: 'publish', url: '/blog' },
      c,
      new WriteGuard(cfg()),
    )) as { ok: boolean; published: boolean; warnings: string[] };
    expect(out.ok).toBe(true);
    expect(out.published).toBe(true);
    expect(out.warnings[0]).toMatch(/cache could not be cleared/i);
  });

  it('publish requires url', async () => {
    await expect(
      handlePages({ action: 'publish' }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('update with publish:false saves as a draft (no publish call)', async () => {
    const c = mockClient();
    mockPageData(c, { save: { slug: 'blog' } });
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
    mockPageData(c, { save: { slug: 'blog' } });
    await handlePages(
      { action: 'update', url: '/blog/', tags: [' news ', ' ', 'tech '] },
      c,
      new WriteGuard(cfg()),
    );
    const [, payload] = saveCalls(c)[0] as [string, { url: string; data: { tags?: string } }];
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
    mockPageData(c);
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
    mockPageData(c);
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
    // The safe item must have written once; the renamed item must NOT have written.
    expect(saveCalls(c).length).toBe(1);
  });

  it('batch_update runs renamed items when the per-item confirm_token matches', async () => {
    const c = mockClient();
    mockPageData(c);
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

  it('trash_restore refuses a former page URL and names the right value', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'trash_restore', url: '/x' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('trash_permanently_delete refuses a former page URL', async () => {
    const c = mockClient();
    await expect(
      handlePages({ action: 'trash_permanently_delete', url: '/x' }, c, new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('trash_restore POSTs /_api/page-trash/restore with the trash path', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: 'trash_restore', url: '/.trash/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    // v2 reads `path`, not `url` — sending `url` made it restore nothing while
    // still answering 200.
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/restore', { path: '/.trash/x' });
  });

  it('trash_restore returns pending confirm token in confirm-destructive mode', async () => {
    const c = mockClient();
    const guard = new WriteGuard({ ...cfg(), writeMode: 'confirm-destructive' });
    const out = await handlePages({ action: 'trash_restore', url: '/x' }, c, guard);
    expect(out).toMatchObject({ allowed: 'pending' });
    expect(c.post).not.toHaveBeenCalled();
  });

  it('trash_permanently_delete POSTs the trash path', async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: 'trash_permanently_delete', url: '/.trash/x' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith('/_api/page-trash/permanently-delete', {
      path: '/.trash/x',
    });
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
