import { describe, it, expect, vi } from "vitest";
import { handlePages } from "../../../src/domains/pages.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "error" };
}

describe("handlePages (v2 /_api)", () => {
  it("list hits GET /_api/public/pagelist", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: "/" }]);
    const out = await handlePages({ action: "list" }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: "/" }]);
    expect(c.get).toHaveBeenCalledWith("/_api/public/pagelist");
  });

  it("list with context+fields_csv passes query params", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await handlePages({ action: "list", context: "/blog", fields_csv: "title,url" }, c, new WriteGuard(cfg()));
    expect(c.get).toHaveBeenCalledWith("/_api/public/pagelist?context=%2Fblog&fields=title%2Curl");
  });

  it("get requires url and POSTs /_api/page/data", async () => {
    const c = mockClient();
    await expect(handlePages({ action: "get" }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: "/x", fields: {} });
    await handlePages({ action: "get", url: "/x" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/page/data", { url: "/x" });
  });

  it("get retries on 404 (v2 commit-lag) and eventually surfaces NOT_FOUND", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("HTTP 404"), { code: "NOT_FOUND" }));
    await expect(handlePages({ action: "get", url: "/missing" }, c, new WriteGuard(cfg())))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((c.post as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it("create posts to /_api/page/add, publishes, polls until readable", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: "page?url=%2Fhello" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: "/hello", fields: {} });
    const out = await handlePages({ action: "create", title: "Hello", target_url: "/blog", template: "standard-lite/page.php" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenNthCalledWith(1, "/_api/page/add", { targetPage: "/blog", title: "Hello", theme_template: "standard-lite/page.php" });
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/hello" });
    expect(out).toMatchObject({ ok: true, url: "/hello" });
  });

  it("create fallback: if redirect has no url, publish to input.url", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: "no-url-here" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: "/expected", fields: {} });
    await handlePages({ action: "create", title: "Hi", url: "/expected" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/expected" });
  });

  it("create tolerates publish failure (best-effort)", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: "page?url=%2Fhello" })
      .mockRejectedValueOnce(new Error("publish offline"))
      .mockResolvedValue({ url: "/hello", fields: {} });
    const out = await handlePages({ action: "create", title: "Hello", target_url: "/blog" }, c, new WriteGuard(cfg()));
    expect(out).toMatchObject({ ok: true, url: "/hello" });
  });

  it("update publishes via input.url, polls on resulting slug, returns canonical URL", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ updateUI: true, slug: "renamed" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ url: "/renamed", fields: {} });
    const out = await handlePages({ action: "update", url: "/original", title: "renamed", private: true, tags: ["x","y"], fields: { main: [] } }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenNthCalledWith(1, "/_api/page/data", { url: "/original", data: { title: "renamed", private: true, tags: "x,y", main: [] } });
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/original" });
    expect(out).toMatchObject({ ok: true, url: "/renamed" });
  });

  it("delete requires url and POSTs to /_api/page/delete", async () => {
    const c = mockClient();
    await expect(handlePages({ action: "delete" }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages({ action: "delete", url: "/x" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/page/delete", { url: "/x" });
  });

  it("delete in confirm-destructive mode returns a pending permit", async () => {
    const guard = new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" });
    const r = await handlePages({ action: "delete", url: "/x" }, mockClient(), guard);
    expect(r).toMatchObject({ allowed: "pending" });
  });

  it("move without layout throws UNSUPPORTED", async () => {
    await expect(handlePages({ action: "move", url: "/x" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("move with non-JSON layout throws VALIDATION", async () => {
    await expect(handlePages({ action: "move", url: "/x", layout: "not-json" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("move with empty array layout throws VALIDATION", async () => {
    await expect(handlePages({ action: "move", url: "/x", layout: "[]" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("move with non-string array entries throws VALIDATION", async () => {
    await expect(handlePages({ action: "move", url: "/x", layout: "[1,2,3]" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("move with valid array posts to /_api/page/move", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages({ action: "move", url: "/a", layout: '["/a","/b","/c"]' }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/page/move", { url: "/a", layout: '["/a","/b","/c"]' });
  });

  it("duplicate throws UNSUPPORTED", async () => {
    await expect(handlePages({ action: "duplicate", url: "/x", target_url: "/y" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});
