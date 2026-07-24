import { describe, it, expect, vi } from "vitest";
import { handlePages } from "../../../src/domains/pages.js";
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

describe("handlePages (v2 /_api)", () => {
  it("list hits GET /_api/public/pagelist (public, no auth path)", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: "/" }]);
    const out = await handlePages({ action: "list" }, c, new WriteGuard(cfg()));
    expect(out).toEqual([{ url: "/" }]);
    expect(c.get).toHaveBeenCalledWith("/_api/public/pagelist");
  });

  it("list with context+fields_csv passes query params", async () => {
    const c = mockClient();
    (c.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await handlePages(
      { action: "list", context: "/blog", fields_csv: "title,url" },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.get).toHaveBeenCalledWith("/_api/public/pagelist?context=%2Fblog&fields=title%2Curl");
  });

  it("get requires url and POSTs /_api/page/data with {url}", async () => {
    const c = mockClient();
    await expect(handlePages({ action: "get" }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: "/x", fields: {} });
    await handlePages({ action: "get", url: "/x" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/page/data", { url: "/x" });
  });

  it("create posts title+targetPage to /_api/page/add then auto-publishes via redirect slug", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: "page?url=%2Fhello" })
      .mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      { action: "create", title: "Hello", target_url: "/blog", template: "standard-lite/page.php" },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledTimes(2);
    expect(c.post).toHaveBeenNthCalledWith(1, "/_api/page/add", {
      targetPage: "/blog",
      title: "Hello",
      theme_template: "standard-lite/page.php",
    });
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/hello" });
    expect(out).toMatchObject({ ok: true, url: "/hello" });
  });

  it("create fallback: if redirect has no url, publish to input.url", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ redirect: "no-url-here" })
      .mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: "create", title: "Hi", url: "/expected" },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/expected" });
  });

  it("update publishes via the directory URL (input.url), not the resulting draft slug", async () => {
    const c = mockClient();
    // v2's page/data response includes the resulting slug (it changes when the title changes),
    // but page/publish must use the directory URL (input.url), not the draft slug.
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ updateUI: true, slug: "mcp-test-renamed" })
      .mockResolvedValueOnce({ ok: true });
    const out = await handlePages(
      {
        action: "update",
        url: "/mcp-test",
        title: "mcp-test-renamed",
        private: true,
        tags: ["x", "y"],
        fields: { main: [] },
      },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenNthCalledWith(1, "/_api/page/data", {
      url: "/mcp-test",
      data: { title: "mcp-test-renamed", private: true, tags: "x,y", main: [] },
    });
    expect(c.post).toHaveBeenNthCalledWith(2, "/_api/page/publish", { url: "/mcp-test" });
    expect(out).toMatchObject({ url: "/mcp-test" });
  });

  it("update does not fail when publish itself fails (best-effort)", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ updateUI: true, slug: "x" })
      .mockRejectedValueOnce(new Error("publish offline"));
    const out = await handlePages(
      { action: "update", url: "/x", title: "T" },
      c,
      new WriteGuard(cfg()),
    );
    expect(out).toMatchObject({ updateUI: true });
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

  it("move without layout throws UNSUPPORTED (v2 move is reordering, not rename)", async () => {
    await expect(
      handlePages({ action: "move", url: "/x" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("move with layout posts to /_api/page/move with layout", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: "move", url: "/a", layout: '["/a","/b","/c"]' },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith("/_api/page/move", {
      url: "/a",
      layout: '["/a","/b","/c"]',
    });
  });

  it("duplicate throws UNSUPPORTED (no v2 endpoint)", async () => {
    await expect(
      handlePages({ action: "duplicate", url: "/x", target_url: "/y" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});
