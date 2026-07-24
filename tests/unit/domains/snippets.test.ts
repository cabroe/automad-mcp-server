import { describe, it, expect, vi } from "vitest";
import { handleSnippets } from "../../../src/domains/snippets.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleSnippets", () => {
  it("list with scope=global hits /api/shared/snippets", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ snippets: [] });
    await handleSnippets({ action: "list", scope: "global" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/shared/snippets");
  });

  it("set requires data", async () => {
    await expect(
      handleSnippets({ action: "set", name: "footer" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("set calls PUT with serialized body", async () => {
    const client = mockClient();
    (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleSnippets(
      {
        action: "set",
        name: "footer",
        scope: "global",
        data: { variables: { cta: "Sign up" } },
      },
      client,
      new WriteGuard(cfg()),
    );
    expect(client.put).toHaveBeenCalledWith(
      "/dashboard/api/shared/snippets/footer",
      expect.objectContaining({ raw: expect.stringContaining("cta: Sign up") }),
    );
  });
});
