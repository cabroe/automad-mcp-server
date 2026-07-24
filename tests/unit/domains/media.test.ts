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
    uploadMultipart: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleMedia", () => {
  it("list calls /api/media", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    const out = await handleMedia({ action: "list" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ files: [] });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/media");
  });

  it("upload requires source", async () => {
    await expect(
      handleMedia({ action: "upload" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("upload calls uploadMultipart", async () => {
    const client = mockClient();
    (client.uploadMultipart as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const out = await handleMedia(
      {
        action: "upload",
        path: "/shared/images",
        source: { base64: "AA==", filename: "x.png", mimeType: "image/png" },
      },
      client,
      new WriteGuard(cfg()),
    );
    expect(out).toEqual({ ok: true });
    expect(client.uploadMultipart).toHaveBeenCalledWith(
      "/dashboard/api/media",
      expect.objectContaining({ filename: "x.png" }),
    );
  });

  it("delete requires confirmation in confirm-destructive mode", async () => {
    const guard = new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" });
    const r = await handleMedia({ action: "delete", path: "/x" }, mockClient(), guard);
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
