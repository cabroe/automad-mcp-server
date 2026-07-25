import { describe, it, expect, vi } from "vitest";
import { ThemeManager } from "../../../src/theme/manager.js";
import type { ThemeFs } from "../../../src/theme/fs.js";
import type { HttpClient } from "../../../src/client.js";

function mockDeps() {
  const fs: ThemeFs = {
    exists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDir: vi.fn(),
    removeDir: vi.fn(),
    copyDir: vi.fn(),
    isDir: vi.fn(),
  };
  const client: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
  return {
    fs,
    client,
    themesPath: "/themes",
    starterKitPath: "/starter",
  };
}

describe("ThemeManager", () => {
  it("list returns empty array if no directories exist", async () => {
    const deps = mockDeps();
    vi.mocked(deps.fs.exists).mockResolvedValue(true);
    vi.mocked(deps.fs.readDir).mockResolvedValue([]);
    const mgr = new ThemeManager(deps);
    const list = await mgr.list();
    expect(list).toEqual([]);
  });

  it("uninstall prevents path traversal", async () => {
    const deps = mockDeps();
    const mgr = new ThemeManager(deps);
    await expect(mgr.uninstall("../outside")).rejects.toThrow("escapes allowed root");
  });

  it("activate handles API errors gracefully", async () => {
    const deps = mockDeps();
    vi.mocked(deps.fs.exists).mockResolvedValue(true);
    vi.mocked(deps.client.post).mockRejectedValue(new Error("API Fail"));
    const mgr = new ThemeManager(deps);
    const res = await mgr.activate("test-theme");
    expect(res.activated).toBe(false);
  });
});
