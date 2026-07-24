import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, API_BASE } from "../../src/config.js";

describe("loadConfig", () => {
  beforeEach(() => {
    for (const k of ["AUTOMAD_URL", "AUTOMAD_USER", "AUTOMAD_PASS", "AUTOMAD_WRITE_MODE", "LOG_LEVEL",
      "AUTOMAD_THEMES_PATH", "AUTOMAD_STARTER_KIT_PATH"]) {
      delete process.env[k];
    }
  });

  it("loads the canonical v2 env", () => {
    process.env["AUTOMAD_URL"] = "https://blog.example.com";
    process.env["AUTOMAD_USER"] = "admin";
    process.env["AUTOMAD_PASS"] = "secret";
    process.env["AUTOMAD_THEMES_PATH"] = "/app/packages";
    const cfg = loadConfig();
    expect(cfg.url).toBe("https://blog.example.com");
    expect(cfg.username).toBe("admin");
    expect(cfg.password).toBe("secret");
    expect(cfg.writeMode).toBe("confirm-destructive");
    expect(cfg.themesPath).toBe("/app/packages");
    expect(cfg.starterKitPath).toBe("/app/packages"); // default = themesPath
  });

  it("respects AUTOMAD_STARTER_KIT_PATH override", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    process.env["AUTOMAD_THEMES_PATH"] = "/themes";
    process.env["AUTOMAD_STARTER_KIT_PATH"] = "/templates/starter";
    const cfg = loadConfig();
    expect(cfg.themesPath).toBe("/themes");
    expect(cfg.starterKitPath).toBe("/templates/starter");
  });

  it("requires AUTOMAD_THEMES_PATH", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    expect(() => loadConfig()).toThrow(/AUTOMAD_THEMES_PATH/);
  });

  it("requires AUTOMAD_PASS", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_THEMES_PATH"] = "/themes";
    expect(() => loadConfig()).toThrow(/AUTOMAD_PASS/);
  });

  it("exports the v2 /_api base path", () => {
    expect(API_BASE).toBe("/_api");
  });
});
