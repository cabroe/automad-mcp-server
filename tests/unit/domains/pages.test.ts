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
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: "/x", fields: {} });
    await expect(handlePages({ action: "get" }, c, new WriteGuard(cfg()))).rejects.toMatchObject({ code: "VALIDATION" });
    await handlePages({ action: "get", url: "/x" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/page/data", { url: "/x" });
  });

  it("create posts title+targetPage to /_api/page/add", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: "create", title: "Hello", target_url: "/blog", template: "standard-lite/page.php" },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith("/_api/page/add", {
      targetPage: "/blog",
      title: "Hello",
      theme_template: "standard-lite/page.php",
    });
  });

  it("update flattens title/private/tags/fields into data block", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      {
        action: "update",
        url: "/blog/hello",
        title: "Hello v2",
        private: true,
        tags: ["x", "y"],
        fields: { main: [] },
      },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith("/_api/page/data", {
      url: "/blog/hello",
      data: { title: "Hello v2", private: true, tags: "x,y", main: [] },
    });
  });

  it("delete in confirm-destructive mode returns a pending permit", async () => {
    const guard = new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" });
    const r = await handlePages({ action: "delete", url: "/x" }, mockClient(), guard);
    expect(r).toMatchObject({ allowed: "pending" });
  });

  it("duplicate throws UNSUPPORTED (no v2 endpoint)", async () => {
    await expect(
      handlePages({ action: "duplicate", url: "/x", target_url: "/y" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});
