import { describe, it, expect } from "vitest";
import { parsePage, serializePage } from "../../src/page-format.js";

describe("parsePage", () => {
  it("parses variables only", () => {
    const raw = `title: Home\ntheme: starter\nhidden: on\n`;
    const p = parsePage(raw);
    expect(p.variables).toEqual({ title: "Home", theme: "starter", hidden: "on" });
    expect(p.blocks).toEqual([]);
  });

  it("parses variables + blocks", () => {
    const raw = `title: Post\n-\n+hero: {"type":"hero","data":{"title":"Hi"}}\n`;
    const p = parsePage(raw);
    expect(p.variables).toEqual({ title: "Post" });
    expect(p.blocks).toEqual([
      { name: "hero", data: { type: "hero", data: { title: "Hi" } } },
    ]);
  });

  it("handles empty input", () => {
    const p = parsePage("");
    expect(p.variables).toEqual({});
    expect(p.blocks).toEqual([]);
  });

  it("preserves block order", () => {
    const raw = `title: X\n-\n+a: {"type":"a"}\n-\n+b: {"type":"b"}\n`;
    const p = parsePage(raw);
    expect(p.blocks.map((b) => b.name)).toEqual(["a", "b"]);
  });
  it("parses booleans, null, numbers, and JSON values", () => {
    const raw = `active: true\narchived: false\ntag: null\ncount: 42\nmeta: {"k":"v"}\n`;
    const p = parsePage(raw);
    expect(p.variables).toEqual({
      active: true,
      archived: false,
      tag: null,
      count: 42,
      meta: { k: "v" },
    });
  });
});

describe("serializePage", () => {
  it("round-trips a simple page", () => {
    const raw = `title: Test\n-\n+hero: {"type":"hero"}\n`;
    const p = parsePage(raw);
    const out = serializePage(p);
    expect(parsePage(out)).toEqual(p);
  });

  it("writes variables before blocks", () => {
    const out = serializePage({
      variables: { title: "T" },
      blocks: [{ name: "hero", data: { type: "hero" } }],
    });
    expect(out).toMatch(/^title: T\n/);
    expect(out).toContain("-\n");
    expect(out).toContain('+hero: {"type":"hero"}');
  });

  it("omits separator when no blocks", () => {
    const out = serializePage({ variables: { title: "T" }, blocks: [] });
    expect(out).toBe("title: T\n");
  });
});
