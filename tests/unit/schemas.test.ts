import { describe, it, expect } from "vitest";
import { pagesInput, mediaInput, writeMode } from "../../src/schemas.js";

describe("schemas", () => {
  it("pagesInput accepts list", () => {
    expect(pagesInput.parse({ action: "list" })).toBeDefined();
  });

  it("pagesInput rejects unknown action", () => {
    expect(() => pagesInput.parse({ action: "bogus" })).toThrow();
  });

  it("mediaInput requires source for upload", () => {
    expect(() => mediaInput.parse({ action: "upload" })).toThrow();
    expect(() =>
      mediaInput.parse({ action: "upload", source: { base64: "AA==", filename: "x.png", mimeType: "image/png" } }),
    ).not.toThrow();
  });

  it("writeMode enum is strict", () => {
    expect(writeMode.parse("read-only")).toBe("read-only");
    expect(writeMode.parse("confirm-destructive")).toBe("confirm-destructive");
    expect(writeMode.parse("unrestricted")).toBe("unrestricted");
    expect(() => writeMode.parse("nope")).toThrow();
  });
});
