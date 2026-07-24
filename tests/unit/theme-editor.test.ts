import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as nodeFs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalThemeFs } from "../../src/theme/fs.js";
import { listFiles, readFile, writeFile } from "../../src/theme/editor.js";

let root: string;
let themePath: string;

beforeEach(async () => {
  root = await nodeFs.mkdtemp(path.join(os.tmpdir(), "mcp-edit-"));
  themePath = path.join(root, "my-theme");
  await nodeFs.mkdir(themePath);
  await nodeFs.writeFile(path.join(themePath, "theme.json"), '{"name":"x"}');
  await nodeFs.writeFile(path.join(themePath, "page.php"), "<html></html>");
  await nodeFs.mkdir(path.join(themePath, "blocks"));
  await nodeFs.writeFile(path.join(themePath, "blocks", "grid.php"), "<?php");
  await nodeFs.writeFile(path.join(themePath, "client.ts"), "console.log('x');");
  await nodeFs.writeFile(path.join(themePath, "ignored.bin"), "x");
});
afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("returns all theme files with sizes and rel paths", async () => {
    const fs = new LocalThemeFs();
    const files = await listFiles("my-theme", { fs, themesPath: root });
    const rel = files.map((f) => f.relPath).sort();
    expect(rel).toEqual([
      "blocks/grid.php",
      "client.ts",
      "page.php",
      "theme.json",
    ]);
    for (const f of files) expect(f.size).toBeGreaterThan(0);
  });

  it("rejects path traversal", async () => {
    const fs = new LocalThemeFs();
    await expect(
      listFiles("my-theme", { fs, themesPath: root }, { path: "../etc" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("scopes to subdirectory", async () => {
    const fs = new LocalThemeFs();
    const files = await listFiles("my-theme", { fs, themesPath: root }, { path: "blocks" });
    expect(files.map((f) => f.relPath)).toEqual(["blocks/grid.php"]);
  });
});

describe("readFile / writeFile", () => {
  it("read returns content + size", async () => {
    const fs = new LocalThemeFs();
    const r = await readFile("my-theme", "theme.json", { fs, themesPath: root });
    expect(r.size).toBe(12);
    expect(r.relPath).toBe("theme.json");
  });

  it("writeFile creates new file and overwrites existing", async () => {
    const fs = new LocalThemeFs();
    const r = await writeFile("my-theme", "new.txt", "abc", { fs, themesPath: root });
    expect(r.relPath).toBe("new.txt");
    expect(await readFile("my-theme", "new.txt", { fs, themesPath: root })).toMatchObject({ content: "abc" });
    // overwrite
    await writeFile("my-theme", "new.txt", "xyz", { fs, themesPath: root });
    expect(await readFile("my-theme", "new.txt", { fs, themesPath: root })).toMatchObject({ content: "xyz" });
  });

  it("readFile rejects path traversal", async () => {
    const fs = new LocalThemeFs();
    await expect(
      readFile("my-theme", "../etc/passwd", { fs, themesPath: root }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
