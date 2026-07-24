import { describe, it, expect, vi } from "vitest";
import { handleTemplates } from "../../../src/domains/templates.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleTemplates", () => {
  it("list calls /api/templates", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ templates: [] });
    await handleTemplates({ action: "list" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/templates");
  });

  it("get requires path", async () => {
    await expect(
      handleTemplates({ action: "get" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("validate runs balance check on <@ ... @> tags", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      path: "/x",
      content: "<@ foreach @><@ end @>",
    });
    const out = await handleTemplates({ action: "validate", path: "/x" }, client, new WriteGuard(cfg()));
    expect(out).toEqual({ path: "/x", valid: true });

    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      path: "/y",
      content: "<@ foreach @>",
    });
    const out2 = await handleTemplates({ action: "validate", path: "/y" }, client, new WriteGuard(cfg()));
    expect(out2).toEqual({ path: "/y", valid: false, error: expect.stringMatching(/unbalanced/i) });
  });

  it("set requires content", async () => {
    await expect(
      handleTemplates(
        { action: "set", path: "/x" },
        mockClient(),
        new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
