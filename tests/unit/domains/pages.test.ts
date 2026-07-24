import { describe, it, expect, vi, beforeEach } from "vitest";
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
  } as unknown as HttpClient;
}

function cfg(writeMode: Config["writeMode"] = "unrestricted"): Config {
  return { url: "https://x", username: "u", password: "p", writeMode, logLevel: "info" };
}

describe("handlePages", () => {
  let client: HttpClient;
  let guard: WriteGuard;

  beforeEach(() => {
    client = mockClient();
    guard = new WriteGuard(cfg());
  });

  it("list calls /api/pages", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ pages: [] });
    const out = await handlePages({ action: "list" }, client, guard);
    expect(out).toEqual({ pages: [] });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/pages");
  });

  it("get requires path", async () => {
    await expect(handlePages({ action: "get" }, client, guard)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("get calls /api/pages/{path}", async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ path: "/x" });
    const out = await handlePages({ action: "get", path: "/x" }, client, guard);
    expect(out).toEqual({ path: "/x" });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/pages/%2Fx");
  });

  it("create posts with serialized page body", async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handlePages(
      { action: "create", path: "/x", data: { title: "T", variables: { a: 1 } } },
      client,
      guard,
    );
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.path).toBe("/x");
    expect(body.raw).toContain("title: T");
  });

  it("delete requires confirmation in confirm-destructive mode", async () => {
    guard = new WriteGuard(cfg("confirm-destructive"));
    const r = await handlePages({ action: "delete", path: "/x" }, client, guard);
    expect(r).toMatchObject({ allowed: "pending" });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("delete with confirm_token proceeds", async () => {
    guard = new WriteGuard(cfg("confirm-destructive"));
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const pending = await handlePages({ action: "delete", path: "/x" }, client, guard);
    if (!pending || typeof pending !== "object" || !("confirmToken" in pending)) {
      throw new Error("expected pending");
    }
    const out = await handlePages(
      { action: "delete", path: "/x", confirm_token: pending.confirmToken as string },
      client,
      guard,
    );
    expect(out).toEqual({ ok: true });
    expect(client.delete).toHaveBeenCalled();
  });
});
