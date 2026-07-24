import { describe, it, expect, vi } from "vitest";
import { handleSite } from "../../../src/domains/site.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleSite", () => {
  it("info calls /api/system", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ version: "2.0" });
    const out = await handleSite({ action: "info" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ version: "2.0" });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/system");
  });

  it("search requires query", async () => {
    await expect(
      handleSite({ action: "search" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("search encodes query into /api/search", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ results: [] });
    await handleSite({ action: "search", query: "hello world" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/search?q=hello%20world");
  });

  it("backup posts to /api/backup", async () => {
    const client = mockClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ path: "/backup.zip" });
    const out = await handleSite({ action: "backup" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ path: "/backup.zip" });
    expect(client.post).toHaveBeenCalledWith("/dashboard/api/backup");
  });

  it("restore requires backup_path", async () => {
    await expect(
      handleSite({ action: "restore" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("restore requires confirmation in confirm-destructive mode", async () => {
    const r = await handleSite(
      { action: "restore", backup_path: "/b.zip" },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });

  it("restore with confirm_token posts path", async () => {
    const client = mockClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const guard = new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" });
    const pending = await handleSite(
      { action: "restore", backup_path: "/b.zip" },
      client,
      guard,
    );
    if (!pending || typeof pending !== "object" || !("confirmToken" in pending)) {
      throw new Error("expected pending");
    }
    const out = await handleSite(
      { action: "restore", backup_path: "/b.zip", confirm_token: pending.confirmToken as string },
      client,
      guard,
    );
    expect(out).toEqual({ ok: true });
    expect(client.post).toHaveBeenCalledWith("/dashboard/api/backup/restore", {
      path: "/b.zip",
    });
  });
});
