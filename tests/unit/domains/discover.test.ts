import { describe, it, expect } from "vitest";
import { handleDiscover } from "../../../src/domains/discover.js";
import { WriteGuard } from "../../../src/write-guard.js";
import type { Config } from "../../../src/config.js";

function guard(writeMode: Config["writeMode"] = "confirm-destructive"): WriteGuard {
  return new WriteGuard({
    mode: "docs",
    url: "",
    username: "",
    password: "",
    writeMode,
    logLevel: "error",
    liveEnabled: false,
  });
}

describe("handleDiscover", () => {
  it("list returns every tool+action with flags and a summary", async () => {
    const out = (await handleDiscover({ action: "list" }, guard())) as { capabilities: unknown[] };
    expect(out.capabilities.length).toBeGreaterThan(30);
    expect(out.capabilities).toContainEqual({
      tool: "automad_pages",
      action: "delete",
      writeAction: "pages.delete",
      readOnly: false,
      destructive: true,
      requires: "live",
      summary: "Delete a page.",
    });
  });

  it("list can be filtered to one tool", async () => {
    const out = (await handleDiscover({ action: "list", tool: "automad_docs" }, guard())) as {
      capabilities: { tool: string }[];
    };
    expect(out.capabilities.length).toBeGreaterThan(0);
    expect(out.capabilities.every((c) => c.tool === "automad_docs")).toBe(true);
  });

  it("list rejects an unknown tool filter", async () => {
    await expect(handleDiscover({ action: "list", tool: "automad_nope" }, guard())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("describe requires a tool", async () => {
    await expect(handleDiscover({ action: "describe" }, guard())).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("describe returns the full tool schema and action metadata", async () => {
    const out = (await handleDiscover({ action: "describe", tool: "automad_docs" }, guard())) as {
      tool: string;
      actions: Record<string, unknown>;
      inputSchema: { properties: { action: unknown } };
    };
    expect(out.tool).toBe("automad_docs");
    expect(Object.keys(out.actions).sort()).toEqual(["get", "list", "search"]);
    expect(out.inputSchema.properties.action).toBeDefined();
  });

  it("describes itself — every registered tool has a schema", async () => {
    const out = (await handleDiscover({ action: "describe", tool: "automad_discover" }, guard())) as {
      tool: string;
      requires: string;
      inputSchema: { properties: { action: { enum: string[] } } };
    };
    expect(out.tool).toBe("automad_discover");
    expect(out.requires).toBe("none");
    expect(out.inputSchema.properties.action.enum).toEqual(["list", "describe"]);
  });

  it("describe can narrow to one action", async () => {
    const out = (await handleDiscover(
      { action: "describe", tool: "automad_docs", target_action: "search" },
      guard(),
    )) as { actions: Record<string, unknown> };
    expect(Object.keys(out.actions)).toEqual(["search"]);
  });

  it("describe rejects an unknown action within a known tool", async () => {
    await expect(
      handleDiscover({ action: "describe", tool: "automad_docs", target_action: "nope" }, guard()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stays available even in read-only write mode (all actions are reads)", async () => {
    const out = await handleDiscover({ action: "list" }, guard("read-only"));
    expect(out).toMatchObject({ capabilities: expect.any(Array) });
  });
});
