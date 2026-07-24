import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthManager } from "../../src/auth.js";
import type { Config } from "../../src/config.js";

function cfg(over: Partial<Config> = {}): Config {
  return {
    url: "https://blog.example.com",
    username: "admin",
    password: "secret",
    writeMode: "confirm-destructive",
    logLevel: "info",
    ...over,
  };
}

const META = '<meta name="csrf" content="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00">';
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd00";

describe("AuthManager (v2 /_api)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("logs in to /_api/session/login with name-or-email+password and scrapes CSRF", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => "PHPSESSID=abc; path=/", getSetCookie: () => ["PHPSESSID=abc; path=/"] },
        json: async () => ({ reload: true }),
        text: async () => '{"reload":true}',
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      });
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
  });

  it("caches the cookie across calls (no second login)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => "s=1; path=/", getSetCookie: () => ["s=1; path=/"] },
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      });
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forces a fresh login + CSRF when forced", async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => `s=${i}; path=/`, getSetCookie: () => [`s=${i}; path=/`] },
        json: async () => ({}),
        text: async () => "",
      });
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => `<html>${META}</html>`,
      });
    }
    const auth = new AuthManager(cfg());
    await auth.getCookie();
    await auth.getCookie(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws AUTH on login failure", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
      headers: { getSetCookie: () => [] },
      json: async () => ({ error: "bad creds" }),
      text: async () => '{"error":"bad creds"}',
    });
    const auth = new AuthManager(cfg());
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when CSRF token cannot be extracted from dashboard HTML", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => "s=1; path=/", getSetCookie: () => ["s=1; path=/"] },
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => "<html><head></head><body>no meta here</body></html>",
      });
    const auth = new AuthManager(cfg());
    await expect(auth.getCsrfToken()).rejects.toMatchObject({ code: "AUTH" });
  });
});
