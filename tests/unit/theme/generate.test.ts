import { describe, it, expect } from "vitest";
import { generate, listGeneratorKinds } from "../../../src/theme/generate.js";

describe("theme generate", () => {
  it("exposes the supported kinds", () => {
    const kinds = listGeneratorKinds();
    for (const kind of ["nav", "pagelist", "breadcrumbs", "component", "block", "i18n", "snippet"]) {
      expect(kinds).toContain(kind);
    }
  });

  it("every kind produces a non-empty path, content, and notes", () => {
    for (const kind of listGeneratorKinds()) {
      const out = generate({ kind });
      expect(out.kind).toBe(kind);
      expect(out.path.length).toBeGreaterThan(0);
      expect(out.content.trim().length).toBeGreaterThan(0);
      expect(out.notes.length).toBeGreaterThan(0);
    }
  });

  it("generates a recursive nav snippet with the given name", () => {
    const out = generate({ kind: "nav", name: "mainNav" });
    expect(out.path).toBe("snippets/mainNav.php");
    expect(out.content).toContain("<@ snippet mainNav @>");
    expect(out.content).toContain("<@ mainNav @>"); // recursion
    expect(out.notes).toBeTruthy();
  });

  it("generates an i18n dictionary as valid JSON", () => {
    const out = generate({ kind: "i18n", name: "de" });
    expect(out.path).toBe("i18n/de.json");
    expect(() => JSON.parse(out.content)).not.toThrow();
  });

  it("honors a path override", () => {
    const out = generate({ kind: "block", name: "hero", path: "blocks/custom/hero.php" });
    expect(out.path).toBe("blocks/custom/hero.php");
  });

  it("rejects unknown kinds", () => {
    expect(() => generate({ kind: "nope" })).toThrowError(/unknown generator kind/);
  });

  it("rejects names with traversal or invalid characters", () => {
    expect(() => generate({ kind: "snippet", name: "../evil" })).toThrowError(/invalid name/);
    expect(() => generate({ kind: "snippet", name: "bad name!" })).toThrowError(/invalid name/);
  });

  it("rejects path override with traversal", () => {
    expect(() => generate({ kind: "block", name: "x", path: "../out.php" })).toThrowError(/must not contain/);
  });
});
