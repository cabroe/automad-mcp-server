import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAutomadServer } from "../../src/server.js";
import { WriteGuard } from "../../src/write-guard.js";
import type { HttpClient } from "../../src/client.js";
import type { Config } from "../../src/config.js";

const TOOL_NAMES = [
  "automad_config",
  "automad_media",
  "automad_pages",
  "automad_shared",
  "automad_site",
] as const;

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(): Config {
  return { url: "https://x", username: "u", password: "p", writeMode: "unrestricted", logLevel: "error" };
}

async function connect(client: HttpClient, guard: WriteGuard) {
  const server = createAutomadServer({ client, guard });
  const mcp = new Client({ name: "test", version: "0" }, { capabilities: {} });
  const [t1, t2] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(t1), mcp.connect(t2)]);
  return { server, mcp };
}

describe("createAutomadServer (v2)", () => {
  it("registers the five v2 tools", async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await mcp.close();
    await server.close();
  });

  it("every registered tool exposes an action enum", async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    for (const t of list.tools) {
      const actionEnum = (t.inputSchema as { properties?: { action?: { enum?: string[] } } })?.properties?.action?.enum;
      expect(Array.isArray(actionEnum) && actionEnum.length > 0).toBe(true);
    }
    await mcp.close();
    await server.close();
  });

  it("handler errors are surfaced as isError results, not thrown", async () => {
    const boom = (): HttpClient => {
      const c = mockClient();
      (c.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
      return c;
    };
    const { server, mcp } = await connect(boom(), new WriteGuard(cfg()));
    const result = await mcp.callTool({ name: "automad_site", arguments: { action: "info" } });
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.message).toMatch(/boom/);
    await mcp.close();
    await server.close();
  });
});
