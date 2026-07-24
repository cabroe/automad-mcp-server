import { describe, expect, it } from "vitest";
import { ThemeSchemaBuilder } from "../../src/theme/schema.js";
import type { ThemeAnalysis } from "../../src/theme/analyzer.js";

function analysis(overrides: Partial<ThemeAnalysis> = {}): ThemeAnalysis {
  const fields = [
    "+main", "checkboxVisible", "colorAccent", "filterItems", "formatDate", "iconMenu",
    "imageHero", "labelSection", "selectLayout", "textIntro", "urlContact", "brand",
  ];
  return {
    theme: "starter",
    path: "/themes/starter",
    manifests: { theme: {} },
    files: { templates: ["default.php"], components: [], blocks: ["blocks/grid.php"], client: [], icons: [], i18n: [], lib: [], build: [], other: [] },
    fields,
    fieldSources: Object.fromEntries(fields.map((field) => [field, ["default.php"]])),
    blockFields: ["+main"],
    masks: { page: ["textIntro", "selectLayout", "brand"], shared: ["+main", "colorAccent"] },
    starterKit: { detected: false, markers: [] },
    issues: [],
    ...overrides,
  };
}

describe("ThemeSchemaBuilder", () => {
  it("maps Automad field prefixes, scopes, and sources", () => {
    const result = new ThemeSchemaBuilder().build(analysis());
    const byName = Object.fromEntries(result.fields.map((field) => [field.name, field]));
    expect(byName["+main"]).toMatchObject({ type: "block", scope: "shared", source: ["default.php"] });
    expect(byName.checkboxVisible?.type).toBe("checkbox");
    expect(byName.colorAccent?.type).toBe("color");
    expect(byName.filterItems?.type).toBe("filter");
    expect(byName.formatDate?.type).toBe("format");
    expect(byName.iconMenu?.type).toBe("icon");
    expect(byName.imageHero?.type).toBe("image");
    expect(byName.labelSection?.type).toBe("label");
    expect(byName.selectLayout).toMatchObject({ type: "select", scope: "page" });
    expect(byName.textIntro?.type).toBe("text");
    expect(byName.urlContact?.type).toBe("url");
    expect(byName.brand).toMatchObject({ type: "text", scope: "page" });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD_PREFIX", field: "brand" }));
  });

  it("prefers shared scope and reports mask conflicts", () => {
    const input = analysis({ fields: ["textIntro"], fieldSources: { textIntro: [] }, masks: { page: ["textIntro"], shared: ["textIntro"] } });
    const result = new ThemeSchemaBuilder().build(input);
    expect(result.fields[0]?.scope).toBe("shared");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "FIELD_SCOPE_CONFLICT", field: "textIntro" }));
  });

  it("projects metadata and sorts ordered fields first", () => {
    const input = analysis({
      manifests: { theme: {
        labels: { textIntro: "Introduction" },
        options: { selectLayout: { grid: "Grid", list: "List" } },
        tooltips: { imageHero: "Hero image" },
        fieldOrder: ["selectLayout", "textIntro", "selectLayout", 42],
      } },
    });
    const result = new ThemeSchemaBuilder().build(input);
    expect(result.fields.slice(0, 2).map((field) => field.name)).toEqual(["selectLayout", "textIntro"]);
    expect(result.fields.find((field) => field.name === "selectLayout")).toMatchObject({ order: 0, options: { grid: "Grid", list: "List" } });
    expect(result.fields.find((field) => field.name === "textIntro")?.label).toBe("Introduction");
    expect(result.fields.find((field) => field.name === "imageHero")?.tooltip).toBe("Hero image");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_FIELD_ORDER", field: "selectLayout" }),
      expect.objectContaining({ code: "INVALID_FIELD_ORDER" }),
    ]));
  });

  it("warns for invalid field metadata and projects analyzer issues", () => {
    const input = analysis({
      fields: ["textIntro"], fieldSources: { textIntro: [] },
      manifests: { theme: { labels: { textIntro: 42 }, options: { textIntro: ["bad"] }, tooltips: { textIntro: false } } },
      issues: [{ severity: "warning", code: "SOURCE_TRUNCATED", message: "truncated" }],
    });
    const result = new ThemeSchemaBuilder().build(input);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "INVALID_FIELD_LABEL", "INVALID_FIELD_OPTIONS", "INVALID_FIELD_TOOLTIP", "SOURCE_TRUNCATED",
    ]);
  });

  it("returns copies instead of mutating analysis arrays", () => {
    const input = analysis();
    const result = new ThemeSchemaBuilder().build(input);
    result.masks.page.push("mutated");
    result.templates.push("mutated.php");
    expect(input.masks.page).not.toContain("mutated");
    expect(input.files.templates).not.toContain("mutated.php");
  });
});
