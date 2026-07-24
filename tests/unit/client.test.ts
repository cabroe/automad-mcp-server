import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "../../src/client.js";
import type { AuthProvider } from "../../src/auth.js";

function mockAuth(cookie: string | undefined): AuthProvider {
  return { getCookie: vi.fn().mockResolvedValue(cookie) };
}

describe("HttpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("performs GET with session cookie", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Map(),
      json: async () => ({ ok: 1 }),
      text: async () => '{"ok":1}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("sid=abc"));
    const res = await client.get<{ ok: number }>("/dashboard/api/pages");
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/dashboard/api/pages");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Cookie).toBe("sid=abc");
  });

  it("throws Auth error on 401 without retry", async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({ error: "no auth" }),
      text: async () => '{"error":"no auth"}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("sid=abc"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "AUTH" });
  });

  it("retries once on 401 after re-auth, then gives up", async () => {
    const auth = mockAuth("sid=new");
    fetchMock.mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, auth, { maxRetries: 1 });
    await expect(client.get("/x")).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 404 to NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps 403 to FORBIDDEN", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 403,
      ok: false,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps 5xx to NETWORK with retry", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        headers: new Map(),
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Map(),
        json: async () => ({ ok: 1 }),
        text: async () => '{"ok":1}',
      });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth("c"), {
      maxRetries: 2,
      retryDelayMs: 1,
    });
    const res = await client.get("/x");
    expect(res).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
