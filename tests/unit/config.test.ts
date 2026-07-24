import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutomadMcpError } from "../../src/errors.js";
import { loadConfig, type Config } from "../../src/config.js";

describe("loadConfig", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTOMAD_URL;
    delete process.env.AUTOMAD_USER;
    delete process.env.AUTOMAD_PASS;
    delete process.env.AUTOMAD_TOKEN;
    delete process.env.AUTOMAD_WRITE_MODE;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("loads minimal config with defaults", () => {
    process.env.AUTOMAD_URL = "https://blog.example.com";
    process.env.AUTOMAD_USER = "admin";
    process.env.AUTOMAD_PASS = "secret";

    const cfg: Config = loadConfig();

    expect(cfg.url).toBe("https://blog.example.com");
    expect(cfg.username).toBe("admin");
    expect(cfg.password).toBe("secret");
    expect(cfg.writeMode).toBe("confirm-destructive");
    expect(cfg.logLevel).toBe("info");
  });

  it("accepts explicit unrestricted mode", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.AUTOMAD_WRITE_MODE = "unrestricted";

    expect(loadConfig().writeMode).toBe("unrestricted");
  });

  it("throws when AUTOMAD_URL is missing", () => {
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";

    expect(() => loadConfig()).toThrow(/AUTOMAD_URL/);
  });

  it("throws when AUTOMAD_USER is missing", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_PASS = "p";

    expect(() => loadConfig()).toThrow(/AUTOMAD_USER/);
  });

  it("throws validation errors for missing required variables", () => {
    expect.assertions(2);

    try {
      loadConfig();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AutomadMcpError);
      expect((error as AutomadMcpError).code).toBe("VALIDATION");
    }
  });

  it("throws when neither password nor token is given", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";

    expect(() => loadConfig()).toThrow(/AUTOMAD_PASS|AUTOMAD_TOKEN/);
  });

  it("accepts token instead of password", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_TOKEN = "tok";

    const cfg = loadConfig();

    expect(cfg.token).toBe("tok");
    expect(cfg.password).toBeUndefined();
  });

  it("includes both credentials when both are provided", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.AUTOMAD_TOKEN = "tok";

    const cfg = loadConfig();

    expect(cfg.password).toBe("p");
    expect(cfg.token).toBe("tok");
  });

  it("validates write mode values", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.AUTOMAD_WRITE_MODE = "garbage";

    expect(() => loadConfig()).toThrow(/write mode/i);
  });

  it("loads an explicit log level", () => {
    process.env.AUTOMAD_URL = "https://x";
    process.env.AUTOMAD_USER = "u";
    process.env.AUTOMAD_PASS = "p";
    process.env.LOG_LEVEL = "debug";

    expect(loadConfig().logLevel).toBe("debug");
  });
});
