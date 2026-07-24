import { describe, it, expect, vi } from "vitest";
import { handleConfig } from "../../../src/domains/config.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleConfig", () => {
  it("get fetches /api/config", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ config: {} });
    const out = await handleConfig({ action: "get" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ config: {} });
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/config");
  });

  it("get with key does dot-path lookup", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ config: { a: { b: 1 } } });
    const out = await handleConfig({ action: "get", key: "a.b" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ value: 1 });
  });

  it("set requires value", async () => {
    await expect(
      handleConfig({ action: "set", key: "x" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("set requires confirmation in confirm-destructive", async () => {
    const r = await handleConfig(
      { action: "set", key: "x", value: 1 },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
