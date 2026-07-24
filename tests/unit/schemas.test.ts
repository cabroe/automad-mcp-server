import { describe, it, expect } from "vitest";
import { pagesInput, mediaInput, writeMode } from "../../src/schemas.js";

describe("schemas", () => {
  it("pagesInput accepts list", () => {
    expect(pagesInput.parse({ action: "list" })).toBeDefined();
  });

  it("pagesInput rejects unknown action", () => {
    expect(() => pagesInput.parse({ action: "bogus" })).toThrow();
  });

  it("mediaInput accepts list", () => {
    expect(mediaInput.parse({ action: "list" })).toBeDefined();
  });

  it("mediaInput rejects unknown action", () => {
    expect(() => mediaInput.parse({ action: "bogus" })).toThrow();
  });

  it("writeMode enum is strict", () => {
    expect(writeMode.parse("read-only")).toBe("read-only");
    expect(writeMode.parse("confirm-destructive")).toBe("confirm-destructive");
    expect(writeMode.parse("unrestricted")).toBe("unrestricted");
    expect(() => writeMode.parse("nope")).toThrow();
  });
});
