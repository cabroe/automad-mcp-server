import { describe, it, expect } from "vitest";
import {
  pagesInput,
  mediaInput,
  sharedInput,
  configInput,
  siteInput,
  writeMode,
} from "../../src/schemas.js";

describe("schemas", () => {
  it("writeMode enum is strict", () => {
    expect(writeMode.parse("read-only")).toBe("read-only");
    expect(writeMode.parse("confirm-destructive")).toBe("confirm-destructive");
    expect(writeMode.parse("unrestricted")).toBe("unrestricted");
    expect(() => writeMode.parse("nope")).toThrow();
  });

  it("pagesInput accepts list and rejects unknown action", () => {
    expect(pagesInput.parse({ action: "list" })).toBeDefined();
    expect(() => pagesInput.parse({ action: "bogus" })).toThrow();
  });

  it("pagesInput url must start with /", () => {
    expect(() => pagesInput.parse({ action: "get", url: "nope" })).toThrow();
    expect(pagesInput.parse({ action: "get", url: "/blog" })).toBeDefined();
  });

  it("mediaInput accepts list and rejects unknown action", () => {
    expect(mediaInput.parse({ action: "list" })).toBeDefined();
    expect(() => mediaInput.parse({ action: "delete" })).toThrow();
  });

  it("sharedInput accepts get", () => {
    expect(sharedInput.parse({ action: "get" })).toBeDefined();
  });

  it("configInput action enum is get|set", () => {
    expect(configInput.parse({ action: "get" })).toBeDefined();
    expect(() => configInput.parse({ action: "delete" })).toThrow();
  });

  it("siteInput action enum is info|search", () => {
    expect(siteInput.parse({ action: "info" })).toBeDefined();
    expect(() => siteInput.parse({ action: "backup" })).toThrow();
  });
});
