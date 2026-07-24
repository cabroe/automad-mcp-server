import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../src/logger.js";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("exports a pino-compatible logger", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("redacts password and token fields", () => {
    logger.info({ url: "https://x", password: "secret", token: "abc" }, "test");
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("abc");
    expect(output).toContain("https://x");
  });
});
