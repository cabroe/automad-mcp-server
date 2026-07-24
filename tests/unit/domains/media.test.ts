import { describe, it, expect, vi } from "vitest";
import { handleMedia } from "../../../src/domains/media.js";
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

describe("handleMedia (v2 /_api)", () => {
  it("list POSTs url to /_api/file-collection/list", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    const out = await handleMedia({ action: "list", url: "/shared/images" }, c, new WriteGuard(cfg()));
    expect(out).toEqual({ files: [] });
    expect(c.post).toHaveBeenCalledWith("/_api/file-collection/list", { url: "/shared/images" });
  });

  it("list with no url defaults to shared ('')", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    await handleMedia({ action: "list" }, c, new WriteGuard(cfg()));
    expect(c.post).toHaveBeenCalledWith("/_api/file-collection/list", { url: "" });
  });

  it("upload requires source", async () => {
    await expect(
      handleMedia({ action: "upload", url: "/x" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("upload delegates to client.upload with url+source", async () => {
    const c = mockClient();
    (c.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const src = { base64: "AA==", filename: "x.png", mimeType: "image/png" };
    await handleMedia({ action: "upload", url: "/shared/images", source: src }, c, new WriteGuard(cfg()));
    expect(c.upload).toHaveBeenCalledWith(
      "/_api/file-collection/upload",
      expect.objectContaining({ ...src, url: "/shared/images" }),
    );
  });
});
