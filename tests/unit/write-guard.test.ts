import { beforeEach, describe, expect, it } from "vitest";
import { WriteGuard } from "../../src/write-guard.js";
import type { Config } from "../../src/config.js";

describe("WriteGuard", () => {
  let guard: WriteGuard;

  beforeEach(() => {
    const cfg: Config = {
      url: "https://x",
      username: "u",
      password: "p",
      writeMode: "confirm-destructive",
      logLevel: "info",
    };
    guard = new WriteGuard(cfg);
  });

  it("blocks all writes in read-only mode", () => {
    guard = new WriteGuard({ ...emptyCfg(), writeMode: "read-only" });
    expect(guard.check("pages.create", "/x").allowed).toBe(false);
    expect(guard.check("pages.list", "/x").allowed).toBe(true);
  });

  it("permits non-destructive in confirm mode", () => {
    expect(guard.check("pages.create", "/x").allowed).toBe(true);
    expect(guard.check("pages.update", "/x").allowed).toBe(true);
    expect(guard.check("pages.list", "/x").allowed).toBe(true);
  });

  it("requires confirmation for destructive in confirm mode", () => {
    const r = guard.check("pages.delete", "/x");
    expect(r.allowed).toBe("pending");
    if (r.allowed === "pending") {
      expect(r.confirmToken).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("permits everything in unrestricted mode", () => {
    guard = new WriteGuard({ ...emptyCfg(), writeMode: "unrestricted" });
    expect(guard.check("pages.delete", "/x").allowed).toBe(true);
    expect(guard.check("config.set", "x").allowed).toBe(true);
  });

  it("confirm() validates token", () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    expect(guard.confirm(r.confirmToken)).toEqual({ allowed: true });
    expect(guard.confirm(r.confirmToken)).toEqual({
      allowed: false,
      reason: "unknown token",
    });
  });

  it("confirm() rejects unknown tokens", () => {
    expect(guard.confirm("not-a-token")).toEqual({
      allowed: false,
      reason: "unknown token",
    });
  });

  it("expired tokens are rejected", async () => {
    // NOTE: The brief's version of this test constructed a fresh WriteGuard
    // *after* creating the token, then called confirm() on that new instance.
    // A new guard has an empty pending map, so it can never observe expiry —
    // it would report "unknown token", and the original guard's TTL is never
    // exercised. This deterministic variant uses a short TTL on the SAME guard
    // so real expiry is tested. See task-8-report.md for details.
    const shortGuard = new WriteGuard(
      { ...emptyCfg(), writeMode: "confirm-destructive" },
      { ttlMs: 5 },
    );
    const r = shortGuard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    await new Promise((res) => setTimeout(res, 20));
    expect(shortGuard.confirm(r.confirmToken)).toEqual({
      allowed: false,
      reason: "expired",
    });
  });

  it("supports confirm via action input", () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    const out = guard.check("pages.delete", "/x", r.confirmToken);
    expect(out.allowed).toBe(true);
  });

  it("clear() drops pending confirmations", () => {
    const r = guard.check("pages.delete", "/x");
    if (r.allowed !== "pending") throw new Error("expected pending");
    guard.clear();
    expect(guard.confirm(r.confirmToken)).toEqual({
      allowed: false,
      reason: "unknown token",
    });
  });
  it("confirm token is bound to its target", () => {
    const pending = guard.check("pages.delete", "/a");
    if (pending.allowed !== "pending") throw new Error("expected pending");
    // replay against a different target must be rejected, token not consumed
    const wrong = guard.check("pages.delete", "/b", pending.confirmToken);
    expect(wrong.allowed).toBe(false);
    // replay against the original target succeeds
    const ok = guard.check("pages.delete", "/a", pending.confirmToken);
    expect(ok.allowed).toBe(true);
  });
});

function emptyCfg(): Config {
  return {
    url: "https://x",
    username: "u",
    password: "p",
    writeMode: "read-only",
    logLevel: "info",
  };
}
