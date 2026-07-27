import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager, extractCsrfToken } from '../../src/auth.js';
import type { Config } from '../../src/config.js';

function cfg(over: Partial<Config> = {}): Config {
  return {
    url: 'https://blog.example.com',
    username: 'admin',
    password: 'secret',
    writeMode: 'confirm-destructive',
    logLevel: 'info',
    ...over,
  };
}

const META =
  '<meta name="csrf" content="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00">';
const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00';
const COOKIE = 'PHPSESSID=abc; path=/';
/**
 * Probe responses from `/_api/shared/data` (the session-protected endpoint the
 * AuthManager uses to prove the session is real — `/_api/app/bootstrap` is
 * public on 2.0.0-beta.51 and answers anonymous callers identically).
 */
const PROBE_AUTHENTICATED = {
  code: 200,
  data: { fields: { sitename: 'My Site' }, unused: [] },
};
/** What a protected endpoint returns for an anonymous session: 200 + "No session". */
const PROBE_NO_SESSION = { code: 200, data: { message: 'No session' } };
const PROBE_BAD_CREDS = { code: 200, error: 'Invalid username or password.' };
/** v2 rejects a bad password with HTTP 200 + an `error` key on the login call itself. */
const LOGIN_BAD_CREDS = { code: 200, error: 'Invalid username or password.' };

/** Standard 3-step login: login -> dashboard (csrf) -> auth probe (POST __json__={}). */
function mockLoggedIn(fetchMock: ReturnType<typeof vi.fn>, sitename = 'My Site'): void {
  const probe = { ...PROBE_AUTHENTICATED, data: { fields: { sitename }, unused: [] } };
  fetchMock
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
      json: async () => ({ reload: true }),
      text: async () => '{"reload":true}',
    })
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => `<html>${META}</html>`,
    })
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => probe,
      text: async () => JSON.stringify(probe),
    });
}

describe('AuthManager (v2 /_api)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('logs in, scrapes CSRF, and probes authentication', async () => {
    mockLoggedIn(fetchMock);
    const auth = new AuthManager(cfg());
    const cookie = await auth.getCookie();
    expect(cookie).toBe('PHPSESSID=abc');
    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe('https://blog.example.com/_api/session/login');
    expect(loginInit.method).toBe('POST');
    const body = new URLSearchParams(loginInit.body as string);
    expect(body.get('name-or-email')).toBe('admin');
    expect(body.get('password')).toBe('secret');
    const token = await auth.getCsrfToken();
    expect(token).toBe(TOKEN);
    // 3 fetch calls: login, dashboard (csrf), auth probe
    expect(fetchMock.mock.calls.length).toBe(3);
    // Probe is a POST to the session-protected /_api/shared/data with __csrf__ + __json__={}
    const [probeUrl, probeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(probeUrl).toBe('https://blog.example.com/_api/shared/data');
    expect(probeInit.method).toBe('POST');
    expect((probeInit.headers as Record<string, string>).Cookie).toBe('PHPSESSID=abc');
  });

  it('caches the cookie across calls (no second login)', async () => {
    mockLoggedIn(fetchMock);
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('forces a fresh login + CSRF + probe when forced', async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => `s=${i}; path=/`, getSetCookie: () => [`s=${i}; path=/`] },
          json: async () => ({}),
          text: async () => '',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: async () => `<html>${META}</html>`,
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            ...PROBE_AUTHENTICATED,
            data: { fields: { sitename: `s${i}` }, unused: [] },
          }),
          text: async () =>
            JSON.stringify({
              ...PROBE_AUTHENTICATED,
              data: { fields: { sitename: `s${i}` }, unused: [] },
            }),
        });
    }
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('throws AUTH on login HTTP failure (e.g. 401)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
      headers: { getSetCookie: () => [] },
      json: async () => ({ error: 'bad creds' }),
      text: async () => '{"error":"bad creds"}',
    });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('throws AUTH when the login body carries an error (v2 answers bad creds with HTTP 200)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
      json: async () => LOGIN_BAD_CREDS,
      text: async () => JSON.stringify(LOGIN_BAD_CREDS),
    });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({
      code: 'AUTH',
      message: 'Login failed: Invalid username or password.',
    });
    // Rejected before the dashboard scrape — no point spending requests on it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws AUTH when the probe reports "No session" (v2 quirk: anonymous session)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => PROBE_NO_SESSION,
        text: async () => JSON.stringify(PROBE_NO_SESSION),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('throws AUTH when probe returns 200 with error message (bad credentials)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => PROBE_BAD_CREDS,
        text: async () => JSON.stringify(PROBE_BAD_CREDS),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('clears cached cookie+CSRF when probe fails (next call retries login)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => PROBE_BAD_CREDS,
        text: async () => JSON.stringify(PROBE_BAD_CREDS),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: 'AUTH' });
    // Retry should trigger a fresh 3-step login
    mockLoggedIn(fetchMock, 'site-2');
    const cookie2 = await auth.getCookie();
    expect(cookie2).toBe('PHPSESSID=abc');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('retries the probe on a transient 403 (cold container) then succeeds', async () => {
    fetchMock
      // login POST
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      // dashboard CSRF scrape (attempt 1)
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => `<html>${META}</html>` })
      // probe #1 -> transient 403
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: '' }),
        text: async () => 'forbidden',
      })
      // dashboard CSRF scrape (attempt 2)
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => `<html>${META}</html>` })
      // probe #2 -> authenticated
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => PROBE_AUTHENTICATED,
        text: async () => JSON.stringify(PROBE_AUTHENTICATED),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).resolves.toBe('PHPSESSID=abc');
    await expect(auth.getCsrfToken()).resolves.toBe(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('throws AUTH when CSRF token cannot be extracted from dashboard HTML', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({}),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => '<html><head></head><body>no meta here</body></html>',
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCsrfToken()).rejects.toMatchObject({ code: 'AUTH' });
  });
});

describe('extractCsrfToken', () => {
  const token = 'a'.repeat(64);

  it('handles standard double-quoted order', () => {
    expect(extractCsrfToken(`<meta name="csrf" content="${token}">`)).toBe(token);
  });

  it('handles reversed attribute order', () => {
    expect(extractCsrfToken(`<meta content="${token}" name="csrf">`)).toBe(token);
  });

  it('handles single quotes and extra whitespace', () => {
    expect(extractCsrfToken(`<meta  name = 'csrf'   content = '${token}'  />`)).toBe(token);
  });

  it('handles extra attributes', () => {
    expect(
      extractCsrfToken(`<meta http-equiv="x" name="csrf" data-x="1" content="${token}">`),
    ).toBe(token);
  });

  it('rejects wrong length / non-hex', () => {
    expect(extractCsrfToken(`<meta name="csrf" content="abc">`)).toBeUndefined();
  });

  it('returns undefined when missing', () => {
    expect(extractCsrfToken('<html><head></head></html>')).toBeUndefined();
  });
});
