import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthManager } from "../../src/auth.js";
import type { Config } from "../../src/config.js";

function cfg(over: Partial<Config> = {}): Config {
  return { url: "https://blog.example.com", username: "admin", password: "secret", writeMode: "confirm-destructive", logLevel: "info", ...over };
}

const META = '<meta name="csrf" content="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00">';
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00";
const COOKIE = "PHPSESSID=abc; path=/";
const BOOTSTRAP_LOGGED_IN = { code: 200, data: { version: "2.0.0-beta.51", sitename: "My Site", dashboard: "/dashboard" } };
const BOOTSTRAP_ANONYMOUS = { code: 200, data: {} };
const BOOTSTRAP_BAD_CREDS = { code: 200, error: "Invalid username or password." };

/** Standard 3-step login: login -> dashboard (csrf) -> bootstrap probe (POST __json__={}). */
function mockLoggedIn(fetchMock: ReturnType<typeof vi.fn>, sitename = "My Site"): void {
  fetchMock
    .mockResolvedValueOnce({
      status: 200, ok: true,
      headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
      json: async () => ({ reload: true }),
      text: async () => '{"reload":true}',
    })
    .mockResolvedValueOnce({
      status: 200, ok: true,
      text: async () => `<html>${META}</html>`,
    })
    .mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ ...BOOTSTRAP_LOGGED_IN, data: { ...BOOTSTRAP_LOGGED_IN.data, sitename } }),
      text: async () => JSON.stringify({ ...BOOTSTRAP_LOGGED_IN, data: { ...BOOTSTRAP_LOGGED_IN.data, sitename } }),
    });
}

describe("AuthManager (v2 /_api)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });

  it("logs in, scrapes CSRF, and probes authentication", async () => {
    mockLoggedIn(fetchMock);
    const auth = new AuthManager(cfg());
    const cookie = await auth.getCookie();
    expect(cookie).toBe("PHPSESSID=abc");
    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe("https://blog.example.com/_api/session/login");
    expect(loginInit.method).toBe("POST");
    const body = new URLSearchParams(loginInit.body as string);
    expect(body.get("name-or-email")).toBe("admin");
    expect(body.get("password")).toBe("secret");
    const token = await auth.getCsrfToken();
    expect(token).toBe(TOKEN);
    // 3 fetch calls: login, dashboard (csrf), bootstrap probe
    expect(fetchMock.mock.calls.length).toBe(3);
    // Probe is a POST to /_api/app/bootstrap with __csrf__ + __json__={}
    const [probeUrl, probeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(probeUrl).toBe("https://blog.example.com/_api/app/bootstrap");
    expect(probeInit.method).toBe("POST");
    expect((probeInit.headers as Record<string, string>).Cookie).toBe("PHPSESSID=abc");
  });

  it("caches the cookie across calls (no second login)", async () => {
    mockLoggedIn(fetchMock);
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("forces a fresh login + CSRF + probe when forced", async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock
        .mockResolvedValueOnce({
          status: 200, ok: true,
          headers: { get: () => `s=${i}; path=/`, getSetCookie: () => [`s=${i}; path=/`] },
          json: async () => ({}),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          status: 200, ok: true,
          text: async () => `<html>${META}</html>`,
        })
        .mockResolvedValueOnce({
          status: 200, ok: true,
          json: async () => ({ ...BOOTSTRAP_LOGGED_IN, data: { ...BOOTSTRAP_LOGGED_IN.data, sitename: `s${i}` } }),
          text: async () => JSON.stringify({ ...BOOTSTRAP_LOGGED_IN, data: { ...BOOTSTRAP_LOGGED_IN.data, sitename: `s${i}` } }),
        });
    }
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("throws AUTH on login HTTP failure (e.g. 401)", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401, ok: false,
      headers: { getSetCookie: () => [] },
      json: async () => ({ error: "bad creds" }),
      text: async () => '{"error":"bad creds"}',
    });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when probe returns 200 with empty data (v2 quirk: anonymous session)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200, ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: async () => BOOTSTRAP_ANONYMOUS,
        text: async () => JSON.stringify(BOOTSTRAP_ANONYMOUS),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when probe returns 200 with error message (bad credentials)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200, ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: async () => BOOTSTRAP_BAD_CREDS,
        text: async () => JSON.stringify(BOOTSTRAP_BAD_CREDS),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("clears cached cookie+CSRF when probe fails (next call retries login)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200, ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        text: async () => `<html>${META}</html>`,
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: async () => BOOTSTRAP_BAD_CREDS,
        text: async () => JSON.stringify(BOOTSTRAP_BAD_CREDS),
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
    // Retry should trigger a fresh 3-step login
    mockLoggedIn(fetchMock, "site-2");
    const cookie2 = await auth.getCookie();
    expect(cookie2).toBe("PHPSESSID=abc");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("throws AUTH when CSRF token cannot be extracted from dashboard HTML", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200, ok: true,
        headers: { get: () => COOKIE, getSetCookie: () => [COOKIE] },
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200, ok: true,
        text: async () => "<html><head></head><body>no meta here</body></html>",
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCsrfToken()).rejects.toMatchObject({ code: "AUTH" });
  });
});
