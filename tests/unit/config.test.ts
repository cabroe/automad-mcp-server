import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, API_BASE } from "../../src/config.js";

describe("loadConfig", () => {
  beforeEach(() => {
    for (const k of ["AUTOMAD_URL", "AUTOMAD_USER", "AUTOMAD_PASS", "AUTOMAD_TOKEN", "AUTOMAD_WRITE_MODE", "LOG_LEVEL"]) {
      delete process.env[k];
    }
  });

  it("loads the canonical v2 env", () => {
    process.env["AUTOMAD_URL"] = "https://blog.example.com";
    process.env["AUTOMAD_USER"] = "admin";
    process.env["AUTOMAD_PASS"] = "secret";
    const cfg = loadConfig();
    expect(cfg.url).toBe("https://blog.example.com");
    expect(cfg.username).toBe("admin");
    expect(cfg.password).toBe("secret");
    expect(cfg.writeMode).toBe("confirm-destructive");
    expect(cfg.logLevel).toBe("info");
  });

  it("respects AUTOMAD_WRITE_MODE", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    process.env["AUTOMAD_WRITE_MODE"] = "read-only";
    expect(loadConfig().writeMode).toBe("read-only");
  });

  it("rejects unknown write mode", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    process.env["AUTOMAD_WRITE_MODE"] = "nope";
    expect(() => loadConfig()).toThrow(/Invalid write mode/);
  });

  it("requires AUTOMAD_URL", () => {
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    expect(() => loadConfig()).toThrow(/AUTOMAD_URL/);
  });

  it("requires AUTOMAD_USER", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_PASS"] = "p";
    expect(() => loadConfig()).toThrow(/AUTOMAD_USER/);
  });

  it("requires AUTOMAD_PASS (no token in v2)", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    expect(() => loadConfig()).toThrow(/AUTOMAD_PASS/);
  });

  it("exports the v2 /_api base path", () => {
    expect(API_BASE).toBe("/_api");
  });

  it("ignores any leftover AUTOMAD_TOKEN (v2 has no bearer auth)", () => {
    process.env["AUTOMAD_URL"] = "https://x";
    process.env["AUTOMAD_USER"] = "u";
    process.env["AUTOMAD_PASS"] = "p";
    process.env["AUTOMAD_TOKEN"] = "ignored";
    const cfg = loadConfig();
    expect("token" in cfg).toBe(false);
  });
});
