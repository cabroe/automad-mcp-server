import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThemeAnalyzer } from "../../src/theme/analyzer.js";
import { LocalThemeFs } from "../../src/theme/fs.js";

let root: string;
let themes: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-analyzer-"));
  themes = path.join(root, "themes");
  await fs.mkdir(themes);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeTheme(slug: string, files: Record<string, string>): Promise<void> {
  const theme = path.join(themes, slug);
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(theme, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}

function analyzer(): ThemeAnalyzer {
  return new ThemeAnalyzer({ fs: new LocalThemeFs(), themesPath: themes });
}

const validTheme = {
  "theme.json": JSON.stringify({
    name: "Starter",
    description: "Theme",
    author: "Author",
    license: "MIT",
    version: "0.1.0",
    masks: { page: ["brand"], shared: ["+main"] },
    fieldOrder: ["brand"],
  }),
  "package.json": JSON.stringify({
    name: "starter",
    description: "Theme",
    author: "Author",
    license: "MIT",
    version: "0.1.0",
    scripts: { build: "node esbuild.js" },
  }),
  "composer.json": JSON.stringify({
    name: "vendor/starter",
    description: "Theme",
    license: "MIT",
    version: "0.1.0",
  }),
  "default.php": "<@ components/page.php @>\n<h1>@{ brand } @{ brand }</h1>\n@{ +main }\n@{ :title }",
  "components/page.php": "<main>@{ brand }</main>",
  "blocks/pagelist/grid.php": "<div>@{ +grid }</div>",
  "client/index.ts": "console.log('client');",
  "client/styles/index.less": ".page { color: red; }",
  "icons/menu.svg": "<svg />",
  "i18n/de.json": JSON.stringify({ labels: { brand: "Marke" } }),
  "i18n/en.json": JSON.stringify({ labels: { brand: "Brand" } }),
  "i18n/archive/fr.json": JSON.stringify({ labels: { brand: "Marque" } }),
  "lib/functions.php": "<?php",
  "esbuild.js": "export default {};",
};

describe("ThemeAnalyzer", () => {
  it("inventories Starter Kit structure and Automad fields", async () => {
    await writeTheme("starter", validTheme);
    const result = await analyzer().analyze("starter");

    expect(result.files.templates).toEqual(["default.php"]);
    expect(result.files.components).toEqual(["components/page.php"]);
    expect(result.files.blocks).toEqual(["blocks/pagelist/grid.php"]);
    expect(result.files.client).toContain("client/index.ts");
    expect(result.files.i18n).toEqual(["i18n/archive/fr.json", "i18n/de.json", "i18n/en.json"]);
    expect(result.fieldSources).toEqual({
      "+grid": ["blocks/pagelist/grid.php"],
      "+main": ["default.php"],
      brand: ["components/page.php", "default.php"],
    });
    expect(Object.keys(result.translations)).toEqual(["de", "en"]);
    expect(result.translations.de).toEqual({
      locale: "de",
      path: "i18n/de.json",
      data: { labels: { brand: "Marke" } },
    });
    expect(result.translations.fr).toBeUndefined();
    expect(result.fields).toEqual(["+grid", "+main", "brand"]);
    expect(result.blockFields).toEqual(["+grid", "+main"]);
    expect(result.fields).not.toContain(":title");
    expect(result.masks).toEqual({ page: ["brand"], shared: ["+main"] });
    expect(result.starterKit.detected).toBe(true);
    expect(result.starterKit.markers).toEqual([
      "theme.json",
      "package.json",
      "client/index.ts",
      "client/styles",
      "esbuild.js",
    ]);
    expect(result.manifests.theme?.name).toBe("Starter");
  });

  it("does not require block fields to be listed in page or shared masks", async () => {
    await writeTheme("blocks", {
      "theme.json": JSON.stringify({ name: "Blocks", masks: { page: [], shared: [] } }),
      "default.php": "@{ +main }",
    });
    const result = await analyzer().validate("blocks");
    expect(result.findings.some((finding) => finding.code === "FIELD_NOT_MASKED")).toBe(false);
  });

  it("rejects a missing theme with NOT_FOUND", async () => {
    await expect(analyzer().analyze("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns validation findings for malformed and incomplete themes", async () => {
    await writeTheme("broken", {
      "theme.json": "{invalid",
      "package.json": "[]",
      "i18n/de.json": "not-json",
      "components/page.php": "@{ missingField }",
    });

    const result = await analyzer().validate("broken");
    const codes = result.findings.map((finding) => finding.code);

    expect(result.ok).toBe(false);
    expect(codes).toContain("THEME_MANIFEST_INVALID");
    expect(codes).toContain("PACKAGE_JSON_INVALID");
    expect(codes).toContain("I18N_JSON_INVALID");
    expect(codes).toContain("THEME_TEMPLATE_MISSING");
    expect(codes).toContain("FIELD_NOT_MASKED");
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.summary.errors + result.summary.warnings + result.summary.info).toBe(result.findings.length);
  });

  it("omits invalid locale JSON while retaining analyzer issue", async () => {
    await writeTheme("bad-i18n", {
      "theme.json": JSON.stringify({ name: "Bad i18n" }),
      "default.php": "@{ textMain }",
      "i18n/de.json": "not-json",
    });
    const result = await analyzer().analyze("bad-i18n");
    expect(result.translations).toEqual({});
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "I18N_JSON_INVALID", path: "i18n/de.json" }));
  });

  it("reports metadata mismatches and unused masks", async () => {
    await writeTheme("mismatch", {
      "theme.json": JSON.stringify({
        name: "Theme",
        author: "Theme Author",
        masks: { page: ["unused"] },
      }),
      "package.json": JSON.stringify({ name: "mismatch", author: "Package Author" }),
      "default.php": "<h1>@{ titleField }</h1>",
    });

    const result = await analyzer().validate("mismatch");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PACKAGE_METADATA_MISMATCH" }),
      expect.objectContaining({ code: "FIELD_NOT_MASKED" }),
      expect.objectContaining({ code: "MASK_FIELD_UNUSED" }),
    ]));
  });

  it("reports an incomplete Starter Kit build and bounded source reads", async () => {
    const huge = "@{ hugeField }" + "x".repeat(512 * 1024);
    await writeTheme("partial", {
      "theme.json": JSON.stringify({ name: "Partial" }),
      "package.json": JSON.stringify({ scripts: { build: "node esbuild.js" } }),
      "default.php": huge,
      "client/index.ts": "export {};",
    });

    const result = await analyzer().validate("partial");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_TRUNCATED", severity: "warning" }),
      expect.objectContaining({ code: "STARTER_BUILD_INCOMPLETE", severity: "warning" }),
    ]));
  });
  it("emits the page-data template+theme info hint when root templates exist", async () => {
    // B6 from IMPROVEMENT-PROMPT.md: every page's data file must set BOTH `theme`
    // AND `template` to be renderable. Emit an info-level reminder.
    await writeTheme("ok", validTheme);
    const result = await analyzer().validate("ok");
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("PAGE_DATA_TEMPLATE_REQUIRED");
    expect(result.findings.find((finding) => finding.code === "PAGE_DATA_TEMPLATE_REQUIRED")?.severity).toBe("info");
  });

  it("does NOT emit the page-data hint when the theme has no root templates", async () => {
    await writeTheme("bare", {
      "theme.json": JSON.stringify({ name: "Bare" }),
      "components/page.php": "<main>x</main>",
    });
    const result = await analyzer().validate("bare");
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).not.toContain("PAGE_DATA_TEMPLATE_REQUIRED");
  });
});

describe("main snippet detection", () => {
  it("flags MAIN_SNIPPET_UNDEFINED when a template invokes main with no definition", async () => {
    await writeTheme("no-main", {
      "theme.json": JSON.stringify({ name: "No Main", masks: { page: [], shared: [] } }),
      "default.php": "<@ components/page.php @>",
      "components/page.php": "<main><@ main @></main>",
    });
    const result = await analyzer().validate("no-main");
    const finding = result.findings.find((f) => f.code === "MAIN_SNIPPET_UNDEFINED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.path).toBe("components/page.php");
  });

  it("stays silent when a different file defines the main snippet", async () => {
    await writeTheme("has-main", {
      "theme.json": JSON.stringify({ name: "Has Main", masks: { page: [], shared: [] } }),
      "default.php": "<@ components/page.php @>\n<@~ snippet main ~@>\n<h1>Home</h1>\n<@~ end ~@>",
      "components/page.php": "<main><@ main @></main>",
    });
    const result = await analyzer().validate("has-main");
    expect(result.findings.some((f) => f.code === "MAIN_SNIPPET_UNDEFINED")).toBe(false);
  });
});

describe("runtime :lang detection", () => {
  it("flags LANG_WITHOUT_I18N when :lang is used without translations", async () => {
    await writeTheme("no-i18n", {
      "theme.json": JSON.stringify({ name: "No I18n", masks: { page: [], shared: [] } }),
      "default.php": '<html lang="@{ :lang }"></html>',
    });
    const result = await analyzer().validate("no-i18n");
    const finding = result.findings.find((f) => f.code === "LANG_WITHOUT_I18N");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.path).toBe("default.php");
  });

  it("stays silent when :lang is backed by an i18n translation", async () => {
    await writeTheme("with-i18n", {
      "theme.json": JSON.stringify({ name: "With I18n", masks: { page: [], shared: [] } }),
      "default.php": '<html lang="@{ :lang }"></html>',
      "i18n/de.json": JSON.stringify({ "nav.home": "Start" }),
    });
    const result = await analyzer().validate("with-i18n");
    expect(result.findings.some((f) => f.code === "LANG_WITHOUT_I18N")).toBe(false);
  });
});
