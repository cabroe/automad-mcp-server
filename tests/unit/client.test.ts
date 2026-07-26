import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, looksLikeServerValidation } from '../../src/client.js';
import type { AuthProvider } from '../../src/client.js';

function mockAuth(opts: { cookie?: string; csrf?: string } = {}): AuthProvider {
  return {
    getCookie: vi.fn().mockResolvedValue(opts.cookie ?? 'sid=abc'),
    getCsrfToken: vi
      .fn()
      .mockResolvedValue(opts.csrf ?? 'tok-csrf-64-chars-abcdef0123456789abcdef0123456789abcd00'),
  };
}

describe('HttpClient (v2 /_api)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('GET sends the session cookie and unwraps data envelope', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    const res = await client.get<{ ok: number }>('/_api/app/bootstrap');
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x/_api/app/bootstrap');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Cookie).toBe('sid=abc');
    expect(init.body).toBeUndefined();
  });

  it('POST sends multipart with __csrf__ and __json__', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    const res = await client.post('/_api/page/data', { url: '/blog' });
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x/_api/page/data');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const f = init.body as FormData;
    expect(f.get('__csrf__')).toMatch(/[0-9a-f]/);
    expect(JSON.parse(f.get('__json__') as string)).toEqual({ url: '/blog' });
  });

  it('upload() uses plain `url` field and Dropzone chunk meta, NO __json__', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    await client.upload('/_api/file-collection/upload', {
      base64: 'AA==',
      filename: 'x.png',
      mimeType: 'image/png',
      url: '/shared/images',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const f = init.body as FormData;
    expect(f.get('__csrf__')).toBeTruthy();
    expect(f.get('url')).toBe('/shared/images');
    expect(f.get('__json__')).toBeNull();
    expect(f.get('dzuuid')).toBeTruthy();
    expect(f.get('dzchunkindex')).toBe('0');
    expect(f.get('dztotalchunkcount')).toBe('1');
    expect(f.get('dzchunkbyteoffset')).toBe('0');
    expect(f.get('dzchunksize')).toBe('1');
  });

  it('throws on error envelope (403 with non-CSRF error)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 403,
      ok: false,
      json: async () => ({ error: 'Forbidden by policy' }),
      text: async () => '{"error":"Forbidden by policy"}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    await expect(client.post('/_api/page/data', { url: '/' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Forbidden by policy',
    });
  });

  it('maps 404 to NOT_FOUND', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ error: 'Not Found' }),
      text: async () => '',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    await expect(client.get('/_api/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps v2 server-side validation errors (200 + error text) to VALIDATION', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ code: 200, error: 'Title missing!', reload: true }),
      text: async () => '{"code":200,"error":"Title missing!","reload":true}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    await expect(client.post('/_api/page/data', { url: '/' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it("maps v2 'Page not found!' server errors to VALIDATION", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ code: 200, error: 'Page not found!' }),
      text: async () => '{"code":200,"error":"Page not found!"}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    await expect(client.post('/_api/page/duplicate', { url: '/nope' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('keeps 200 responses with no error text as success', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ code: 200, data: { ok: 1 } }),
      text: async () => '{"code":200,"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    expect(await client.get('/_api/x')).toEqual({ ok: 1 });
  });

  it('unwraps 200 envelopes without `data` to the bare payload', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ reload: true }),
      text: async () => '{"reload":true}',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    const res = await client.get('/_api/session/validate');
    expect(res).toEqual({ reload: true });
  });

  it('CSRF mismatch -> rescrape + retry once', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: 'https://x' }, auth);
    const res = await client.post('/_api/page/data', { url: '/' });
    expect(res).toEqual({ ok: 1 });
    expect(auth.getCsrfToken).toHaveBeenCalledTimes(2);
    expect((auth.getCsrfToken as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(true);
  });

  it('upload() CSRF mismatch -> in-body token refreshed, retry once', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const csrfResponses = ['old-token', 'new-token'];
    const auth: AuthProvider = {
      getCookie: vi.fn().mockResolvedValue('sid=abc'),
      getCsrfToken: vi.fn().mockImplementation(async (force?: boolean) => {
        if (force) return csrfResponses[1]!;
        return csrfResponses[0]!;
      }),
    };
    const client = new HttpClient({ baseUrl: 'https://x' }, auth);
    await client.upload('/_api/file-collection/upload', {
      base64: 'AA==',
      filename: 'x.png',
      mimeType: 'image/png',
    });
    // The second request body should carry the rescrape'd csrf token.
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    const f2 = init2.body as FormData;
    expect(f2.get('__csrf__')).toBe('new-token');
  });

  it('401 -> re-auth + retry once, then surface AUTH', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'unauthenticated' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'still unauth' }),
        text: async () => '',
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: 'https://x' }, auth, { maxRetries: 1 });
    await expect(client.get('/_api/page/data')).rejects.toMatchObject({ code: 'AUTH' });
    expect(auth.getCookie).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        json: async () => ({ error: 'busy' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth());
    const res = await client.get('/_api/page/data');
    expect(res).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repeated 5xx gives up after one retry (no hammering)', async () => {
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ error: 'down' }),
      text: async () => '',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth(), { maxRetries: 5 });
    await expect(client.get('/_api/x')).rejects.toMatchObject({ code: 'NETWORK' });
    // 1 initial + at most 1 retry (status didn't change -> no further retry)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('exhausted 5xx -> NETWORK', async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      ok: false,
      json: async () => ({ error: 'down' }),
      text: async () => '',
    });
    const client = new HttpClient({ baseUrl: 'https://x' }, mockAuth(), { maxRetries: 1 });
    await expect(client.get('/_api/x')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('CSRF-mismatch loop after session timeout -> force re-auth then surface AUTH', async () => {
    // Scenario: the session cookie is dead (e.g. server restart, long idle).
    // v2 returns 403 + "CSRF token mismatch" because the old session is invalid.
    // Rescraping the CSRF token with the dead session cannot recover — the
    // request must force re-auth, get a fresh session, and try again.
    fetchMock
      // 1st: initial request, 403 + CSRF mismatch (dead session)
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      // 2nd: CSRF rescrape with dead session, still 403 + CSRF mismatch
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      // 3rd: re-authenticated request succeeds
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const auth: AuthProvider = {
      getCookie: vi.fn().mockResolvedValue('sid=stale'),
      getCsrfToken: vi.fn().mockResolvedValue('tok-csrf'),
    };
    const client = new HttpClient({ baseUrl: 'https://x' }, auth, { maxRetries: 2 });
    const result = await client.get('/_api/page/data');
    expect(result).toEqual({ ok: 1 });
    // The cookie getter must have been called with force=true after the
    // CSRF-loop was detected, triggering a re-login.
    expect((auth.getCookie as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === true)).toBe(
      true,
    );
  });

  it('CSRF-mismatch loop with dead session AND dead re-auth -> AUTH (not 403)', async () => {
    // Even re-auth can't recover (e.g. creds rotated, user disabled). The
    // client must surface this as AUTH so the caller can react, not as a
    // confusing 403 / FORBIDDEN that suggests transient CSRF trouble.
    fetchMock
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: 'CSRF token mismatch' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: 'unauthenticated' }),
        text: async () => '',
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: 'https://x' }, auth, { maxRetries: 2 });
    await expect(client.get('/_api/page/data')).rejects.toMatchObject({ code: 'AUTH' });
  });

  it("v2 'No session' marker (HTTP 200 + body) -> force re-auth and recover", async () => {
    // v2's friendly dead-session response: HTTP 200 with
    // `{data: {message: "No session"}}`. Without detection we'd return the
    // misleading message payload as success. With detection we force re-auth.
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { message: 'No session' } }),
        text: async () => '{"data":{"message":"No session"}}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { url: '/', template: 'page.php' } }),
        text: async () => '{"data":{"url":"/","template":"page.php"}}',
      });
    const auth: AuthProvider = {
      getCookie: vi.fn().mockResolvedValue('sid=stale'),
      getCsrfToken: vi.fn().mockResolvedValue('tok-csrf'),
    };
    const client = new HttpClient({ baseUrl: 'https://x' }, auth, { maxRetries: 2 });
    const result = await client.get('/_api/page/data');
    expect(result).toEqual({ url: '/', template: 'page.php' });
    expect((auth.getCookie as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === true)).toBe(
      true,
    );
  });

  it("v2 'No session' after re-auth -> AUTH", async () => {
    // Re-auth itself fails to recover (e.g. credentials rotated). The client
    // must surface this as AUTH so the caller doesn't see the stale payload.
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { message: 'No session' } }),
        text: async () => '{"data":{"message":"No session"}}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { message: 'No session' } }),
        text: async () => '{"data":{"message":"No session"}}',
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: 'https://x' }, auth, { maxRetries: 1 });
    await expect(client.get('/_api/page/data')).rejects.toMatchObject({ code: 'AUTH' });
  });
});

describe('looksLikeServerValidation', () => {
  // Real v2 server-side validation strings harvested from
  // /app/automad/lang/english.json on automad/automad:v2.
  const validationMessages = [
    'Title missing!',
    'Name is required.',
    'Page not found!',
    'Please enter a valid URL!',
    'Please enter a valid email address',
    'Invalid email address!',
    'Invalid field',
    'Invalid image provided.',
    'Incomplete or incorrect data!<br />All fields are required and have to be completed as described!',
    'Please select a page as destination!',
    'A username must start and end with a letter or number and can only contain the characters "a-z", "0-9", "_" or "-".',
    'Title is required.',
    'URL is invalid.',
    'Email is required.',
    'Field is required.',
    'Unsupported file type "foo"',
    'Url required!',
    'Url invalid!',
  ];

  // Strings that MUST NOT be misclassified as validation.
  // These are real v2 error messages for other failure modes.
  const nonValidationMessages = [
    'Invalid username or password.',
    'Sign-in temporarily blocked due to too many failed attempts. Please try again later.',
    'CSRF token mismatch',
    'No session',
    'The request to the AI provider failed. This may be caused by an invalid API key, an unsupported model, or a network issue. Please review your AI provider configuration and try again.',
    'Error fetching data from API!',
    'Error while uploading the image.',
    'Download of update failed!',
    'Update failed! Please restore your installation from a backup.',
    'The cache directory could not be purged!',
    'The file import has failed!',
    'The package is required by another package.',
    'A similar repository or package already exists in your configuration',
    'An error occurred while sending mail.',
    'Permissions denied',
    'Could not save the changes',
    'Error getting list of supported AI models.',
    'The API key for the currently selected AI provider is invalid.',
    'The configured AI model is not supported by the selected provider.',
    'Sign-in temporarily blocked due to too many failed attempts.',
  ];

  for (const msg of validationMessages) {
    it(`flags VALIDATION: ${msg.slice(0, 60)}`, () => {
      expect(looksLikeServerValidation(msg)).toBe(true);
    });
  }

  for (const msg of nonValidationMessages) {
    it(`does NOT flag as VALIDATION: ${msg.slice(0, 60)}`, () => {
      expect(looksLikeServerValidation(msg)).toBe(false);
    });
  }

  it('rejects too-short input', () => {
    expect(looksLikeServerValidation('')).toBe(false);
    expect(looksLikeServerValidation('ab')).toBe(false);
  });

  it('rejects too-long input', () => {
    expect(looksLikeServerValidation('a'.repeat(501))).toBe(false);
  });
});
