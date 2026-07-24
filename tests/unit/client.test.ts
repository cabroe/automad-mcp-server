import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "../../src/client.js";
import type { AuthProvider } from "../../src/client.js";

function mockAuth(opts: { cookie?: string; csrf?: string } = {}): AuthProvider {
  return {
    getCookie: vi.fn().mockResolvedValue(opts.cookie ?? "sid=abc"),
    getCsrfToken: vi.fn().mockResolvedValue(opts.csrf ?? "tok-csrf-64-chars-abcdef0123456789abcdef0123456789abcd00"),
  };
}

describe("HttpClient (v2 /_api)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("GET sends the session cookie and unwraps data envelope", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    const res = await client.get<{ ok: number }>("/_api/app/bootstrap");
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/_api/app/bootstrap");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Cookie).toBe("sid=abc");
    expect(init.body).toBeUndefined();
  });

  it("POST sends multipart with __csrf__ and __json__", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    const res = await client.post("/_api/page/data", { url: "/blog" });
    expect(res).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/_api/page/data");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const f = init.body as FormData;
    expect(f.get("__csrf__")).toMatch(/[0-9a-f]/);
    expect(JSON.parse(f.get("__json__") as string)).toEqual({ url: "/blog" });
  });

  it("upload() builds Dropzone single-chunk multipart", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ data: { ok: 1 } }),
      text: async () => '{"data":{"ok":1}}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    await client.upload("/_api/file-collection/upload", {
      base64: "AA==",
      filename: "x.png",
      mimeType: "image/png",
      url: "/shared/images",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const f = init.body as FormData;
    expect(f.get("__csrf__")).toBeTruthy();
    expect(JSON.parse(f.get("__json__") as string)).toMatchObject({ url: "/shared/images" });
    expect(f.get("dzuuid")).toBeTruthy();
    expect(f.get("dzchunkindex")).toBe("0");
    expect(f.get("dztotalchunkcount")).toBe("1");
    expect(f.get("dzchunkbyteoffset")).toBe("0");
    expect(f.get("dzchunksize")).toBe("1");
  });

  it("throws on error envelope (403 with non-CSRF error)", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 403,
      ok: false,
      json: async () => ({ error: "Forbidden by policy" }),
      text: async () => '{"error":"Forbidden by policy"}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    await expect(client.post("/_api/page/data", { url: "/" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Forbidden by policy",
    });
  });

  it("maps 404 to NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ error: "Not Found" }),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    await expect(client.get("/_api/missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unwraps 200 envelopes without `data` to the bare payload", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ reload: true }),
      text: async () => '{"reload":true}',
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    const res = await client.get("/_api/session/validate");
    expect(res).toEqual({ reload: true });
  });

  it("CSRF mismatch -> rescrape + retry once", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: async () => ({ error: "CSRF token mismatch" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: "https://x" }, auth);
    const res = await client.post("/_api/page/data", { url: "/" });
    expect(res).toEqual({ ok: 1 });
    expect(auth.getCsrfToken).toHaveBeenCalledTimes(2);
    expect((auth.getCsrfToken as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(true);
  });

  it("401 -> re-auth + retry once, then surface FORBIDDEN", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: "unauthenticated" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        json: async () => ({ error: "still unauth" }),
        text: async () => "",
      });
    const auth = mockAuth();
    const client = new HttpClient({ baseUrl: "https://x" }, auth, { maxRetries: 1 });
    await expect(client.get("/_api/page/data")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(auth.getCookie).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        json: async () => ({ error: "busy" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ data: { ok: 1 } }),
        text: async () => '{"data":{"ok":1}}',
      });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth());
    const res = await client.get("/_api/page/data");
    expect(res).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausted 5xx -> NETWORK", async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      ok: false,
      json: async () => ({ error: "down" }),
      text: async () => "",
    });
    const client = new HttpClient({ baseUrl: "https://x" }, mockAuth(), { maxRetries: 1 });
    await expect(client.get("/_api/x")).rejects.toMatchObject({ code: "NETWORK" });
  });
});
