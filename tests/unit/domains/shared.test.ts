import { describe, it, expect, vi } from "vitest";
import { handleShared } from "../../../src/domains/shared.js";
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

describe("handleShared (v2 /_api)", () => {
  it("get POSTs {} to /_api/shared/data (read mode)", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ fields: { sitename: "Hi" }, unused: {} });
    const out = await handleShared({ action: "get" }, c, new WriteGuard(cfg()));
    expect(out).toEqual({ fields: { sitename: "Hi" }, unused: {} });
    expect(c.post).toHaveBeenCalledWith("/_api/shared/data", {});
  });

  it("set POSTs {data:fields} to /_api/shared/data", async () => {
    const c = mockClient();
    (c.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleShared(
      { action: "set", fields: { sitename: "Hello" } },
      c,
      new WriteGuard(cfg()),
    );
    expect(c.post).toHaveBeenCalledWith("/_api/shared/data", { data: { sitename: "Hello" } });
  });

  it("set requires fields", async () => {
    await expect(handleShared({ action: "set" }, mockClient(), new WriteGuard(cfg()))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
