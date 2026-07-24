import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthManager } from "../../src/auth.js";
import type { Config } from "../../src/config.js";

describe("AuthManager", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  const cfg: Config = {
    url: "https://blog.example.com",
    username: "admin",
    password: "secret",
    writeMode: "confirm-destructive",
    logLevel: "info",
  };

  it("logs in and stores cookie on first getCookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map([["set-cookie", "PHPSESSID=abc123; path=/"]]),
      json: async () => ({ success: true }),
      text: async () => '{"success":true}',
    });
    const auth = new AuthManager(cfg);
    const cookie = await auth.getCookie();
    expect(cookie).toContain("abc123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://blog.example.com/dashboard");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      username: "admin",
      password: "secret",
    });
  });

  it("reuses cached cookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map([["set-cookie", "PHPSESSID=zzz; path=/"]]),
      json: async () => ({}),
      text: async () => "",
    });
    const auth = new AuthManager(cfg);
    await auth.getCookie();
    await auth.getCookie();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses token instead of login when provided", async () => {
    const tokenCfg: Config = { ...cfg, token: "AUTH-TOKEN-1", password: undefined };
    const auth = new AuthManager(tokenCfg);
    const cookie = await auth.getCookie();
    expect(cookie).toBe("AUTH-TOKEN-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces re-login when forced", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map([["set-cookie", "a=1; path=/"]]),
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map([["set-cookie", "b=2; path=/"]]),
        json: async () => ({}),
        text: async () => "",
      });
    const auth = new AuthManager(cfg);
    await auth.getCookie();
    await auth.getCookie(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws AUTH on login failure", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({ error: "bad creds" }),
      text: async () => "",
    });
    const auth = new AuthManager(cfg);
    await expect(auth.getCookie(true)).rejects.toMatchObject({ code: "AUTH" });
  });
});
