import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as nodeFs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTheme } from "../../../src/domains/theme.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { HttpClient } from "../../../src/client.js";
import type { Config } from "../../../src/config.js";

function mockClient(): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() } as unknown as HttpClient;
}

function cfg(): Config {
  return {
    url: "https://x", username: "u", password: "p",
    writeMode: "unrestricted", logLevel: "error",
    themesPath: "/tmp/themes-x", starterKitPath: "/tmp/starter-x",
  };
}

let root: string;
let themes: string;
let starter: string;

beforeEach(async () => {
  root = await nodeFs.mkdtemp(path.join(os.tmpdir(), "mcp-theme-"));
  themes = path.join(root, "themes");
  starter = path.join(root, "starter");
  await nodeFs.mkdir(themes);
  await nodeFs.mkdir(starter);
  await nodeFs.writeFile(path.join(starter, "theme.json"), JSON.stringify({ name: "Starter", description: "d" }));
  await nodeFs.writeFile(path.join(starter, "package.json"), JSON.stringify({ name: "starter", scripts: {} }));
  await nodeFs.writeFile(path.join(starter, "page.php"), "<?php");
});
afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

describe("handleTheme", () => {
  it("list returns discovered themes from local fs", async () => {
    // create two theme dirs
    await nodeFs.mkdir(path.join(themes, "alpha"));
    await nodeFs.writeFile(path.join(themes, "alpha", "theme.json"), JSON.stringify({ name: "Alpha" }));
    await nodeFs.mkdir(path.join(themes, "beta"));
    await nodeFs.writeFile(path.join(themes, "beta", "theme.json"), JSON.stringify({ name: "Beta" }));

    const out = await handleTheme({ action: "list" }, { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter });
    expect(Array.isArray(out)).toBe(true);
    const slugs = (out as Array<{ slug: string }>).map((t) => t.slug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("scaffold requires starter kit; copies into themesPath/<slug>", async () => {
    const out = await handleTheme(
      { action: "scaffold", name: "My Theme", author: "me" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    const r = out as { path: string; name: string; manifest: { name: string; author: string } };
    expect(r.name).toBe("My Theme");
    expect(r.path).toBe(path.join(themes, "my-theme"));
    expect(r.manifest.author).toBe("me");
    expect(await nodeFs.readFile(path.join(r.path, "page.php"), "utf8")).toBe("<?php");
  });

  it("analyzes and validates themes in read-only mode without HTTP calls", async () => {
    await nodeFs.mkdir(path.join(themes, "starter"));
    await nodeFs.writeFile(path.join(themes, "starter", "theme.json"), JSON.stringify({ name: "Starter" }));
    await nodeFs.writeFile(path.join(themes, "starter", "default.php"), "<h1>Starter</h1>");
    const client = mockClient();
    const deps = { client, guard: new WriteGuard({ ...cfg(), writeMode: "read-only" }), themesPath: themes, starterKitPath: starter };
    const analysis = await handleTheme({ action: "analyze", theme: "starter" }, deps);
    expect(analysis).toMatchObject({ theme: "starter" });
    const validation = await handleTheme({ action: "validate", theme: "starter" }, deps);
    expect(validation).toMatchObject({ ok: true });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("builds theme schema in read-only mode without HTTP calls", async () => {
    await nodeFs.mkdir(path.join(themes, "schema-theme"));
    await nodeFs.mkdir(path.join(themes, "schema-theme", "i18n"), { recursive: true });
    await nodeFs.writeFile(path.join(themes, "schema-theme", "i18n", "de.json"), JSON.stringify({ labels: { textIntro: "Einleitung" } }));
    const client = mockClient();
    const deps = { client, guard: new WriteGuard({ ...cfg(), writeMode: "read-only" }), themesPath: themes, starterKitPath: starter };
    const result = await handleTheme({ action: "schema", theme: "schema-theme" }, deps);
    expect(result).toMatchObject({
      theme: "schema-theme",
      locales: ["de"],
      translations: {
        de: {
          locale: "de",
          path: "i18n/de.json",
          fields: expect.any(Object),
        },
      },
    });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
    await expect(handleTheme({ action: "schema" }, deps)).rejects.toMatchObject({ code: "VALIDATION", message: "theme is required for schema" });
  });

  it("scaffold rejects duplicate", async () => {
    await nodeFs.mkdir(path.join(themes, "my-theme"));
    await expect(
      handleTheme(
        { action: "scaffold", name: "My Theme" },
        { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("read / write round-trip via handler", async () => {
    // scaffold first
    await handleTheme(
      { action: "scaffold", name: "Tmp" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    await handleTheme(
      { action: "write", theme: "tmp", path: "page.php", content: "edited" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    const r = await handleTheme(
      { action: "read", theme: "tmp", path: "page.php" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    expect((r as { content: string }).content).toBe("edited");
  });

  it("files returns the theme tree", async () => {
    await handleTheme(
      { action: "scaffold", name: "Listable" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    const out = await handleTheme(
      { action: "files", theme: "listable" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    const rels = (out as Array<{ relPath: string }>).map((e) => e.relPath).sort();
    expect(rels).toContain("theme.json");
    expect(rels).toContain("page.php");
    expect(rels).toContain("package.json");
  });

  it("uninstall removes a theme dir", async () => {
    await nodeFs.mkdir(path.join(themes, "goner"));
    await nodeFs.writeFile(path.join(themes, "goner", "theme.json"), "{}");
    const out = await handleTheme(
      { action: "uninstall", theme: "goner" },
      { client: mockClient(), guard: new WriteGuard(cfg()), themesPath: themes, starterKitPath: starter },
    );
    expect(out).toMatchObject({ removed: path.join(themes, "goner") });
    expect(await nodeFs.access(path.join(themes, "goner")).then(()=>true).catch(()=>false)).toBe(false);
  });

  it("build runs install + build (skipped if no package.json scripts)", async () => {
    // use a tiny custom theme without npm scripts to keep the test fast and offline
    await nodeFs.mkdir(path.join(themes, "no-scripts"));
    await nodeFs.writeFile(path.join(themes, "no-scripts", "theme.json"), "{}");
    await nodeFs.writeFile(path.join(themes, "no-scripts", "package.json"), JSON.stringify({ name: "no-scripts", scripts: { build: "echo built" } }));
    const out = await handleTheme(
      { action: "build", theme: "no-scripts", install: false, confirm_token: "x" },
      { client: mockClient(), guard: new WriteGuard({ ...cfg(), writeMode: "unrestricted" }), themesPath: themes, starterKitPath: starter },
    );
    expect((out as { build: { ok: boolean } }).build.ok).toBe(true);
  });
});
