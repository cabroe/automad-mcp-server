import { describe, it, expect, vi } from "vitest";
import { handleSite } from "../../../src/domains/site.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

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
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "error" };
}

describe("handleSite (v2 /_api)", () => {
  it("info returns version/languages/fileTypes/reservedFields from bootstrap", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      version: "2.0.0-beta.51",
      sitename: "S",
      languages: { English: "" },
      fileTypes: { image: [] },
      reservedFields: { title: "" },
    });
    const out = await handleSite({ action: "info" }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({
      version: "2.0.0-beta.51",
      sitename: "S",
      languages: { English: "" },
    });
    expect(c.get).toHaveBeenCalledWith("/_api/app/bootstrap");
  });

  it("search requires query", async () => {
    await expect(handleSite({ action: "search" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("search rejects empty query", async () => {
    await expect(handleSite({ action: "search", query: "" }, mockClient(), new WriteGuard(cfg())))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("search rejects whitespace-only query", async () => {
    for (const q of ["   ", "\t\t", " \t  "]) {
      await expect(handleSite({ action: "search", query: q }, mockClient(), new WriteGuard(cfg())))
        .rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("search without replace is read-only (no replaceValue)", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: [] });
    await handleSite({ action: "search", query: "hello" }, c, new WriteGuard(cfg()));
    const [, body] = (c.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ searchValue: "hello", isRegex: false, isCaseSensitive: false });
    expect("replaceValue" in body).toBe(false);
  });

  it("search with replace posts replaceValue", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: [] });
    await handleSite({ action: "search", query: "foo", replace: "bar", is_regex: true }, c, new WriteGuard(cfg()));
    const [, body] = (c.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ searchValue: "foo", isRegex: true, isCaseSensitive: false, replaceValue: "bar" });
  });

  it("health reports ok when bootstrap succeeds", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ version: "2.0.0", sitename: "S" });
    const out = await handleSite({ action: "health" }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({
      ok: true, reachable: true, authenticated: true, version: "2.0.0", sitename: "S", latencyMs: expect.any(Number),
    });
  });

  it("health reports not-ok when bootstrap fails", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    const out = await handleSite({ action: "health" }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({ ok: false, error: { message: expect.stringMatching(/down/) } });
  });
});
