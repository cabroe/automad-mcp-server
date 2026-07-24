import { describe, it, expect, vi } from "vitest";
import { handleTheme } from "../../../src/domains/theme.js";
import type { HttpClient } from "../../../src/client.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
}
function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "info" };
}

describe("handleTheme", () => {
  it("list calls /api/themes", async () => {
    const client = mockClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ themes: [] });
    await handleTheme({ action: "list" }, client, new WriteGuard(cfg()));
    expect(client.get).toHaveBeenCalledWith("/dashboard/api/themes");
  });

  it("install requires source", async () => {
    await expect(
      handleTheme({ action: "install" }, mockClient(), new WriteGuard(cfg())),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("install sets starter-kit bootstrap when source matches", async () => {
    const client = mockClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleTheme(
      {
        action: "install",
        source: "https://github.com/user/automad-theme-starter-kit",
        theme: "starter",
      },
      client,
      new WriteGuard(cfg()),
    );
    expect(client.post).toHaveBeenCalledWith(
      "/dashboard/api/themes/install",
      expect.objectContaining({ theme: "starter" }),
    );
    const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body.bootstrap_starter_kit).toBe(true);
    expect(Array.isArray(body.steps)).toBe(true);
  });

  it("install without starter-kit match omits bootstrap steps", async () => {
    const client = mockClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await handleTheme(
      { action: "install", source: "https://github.com/user/my-theme", theme: "mine" },
      client,
      new WriteGuard(cfg()),
    );
    const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(body.bootstrap_starter_kit).toBe(false);
    expect(body.steps).toBeUndefined();
  });

  it("uninstall requires confirmation in confirm-destructive mode", async () => {
    const r = await handleTheme(
      { action: "uninstall", theme: "starter" },
      mockClient(),
      new WriteGuard({ ...cfg(), writeMode: "confirm-destructive" }),
    );
    expect(r).toMatchObject({ allowed: "pending" });
  });
});
