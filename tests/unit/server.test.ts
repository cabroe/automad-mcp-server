import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAutomadServer } from "../../src/server.js";
import type { HttpClient } from "../../src/client.js";
import { WriteGuard } from "../../src/write-guard.js";
import type { Config } from "../../src/config.js";

type MockFn = ReturnType<typeof vi.fn>;

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    uploadMultipart: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(): Config {
  return {
    url: "https://x",
    username: "u",
    password: "p",
    writeMode: "unrestricted",
    logLevel: "info",
  };
}

async function connect(client: HttpClient, guard: WriteGuard) {
  const server = createAutomadServer({ client, guard });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
  await mcp.connect(clientTransport);
  return { server, mcp };
}

const TOOL_NAMES = [
  "automad_pages",
  "automad_media",
  "automad_snippets",
  "automad_templates",
  "automad_config",
  "automad_theme",
  "automad_site",
];

describe("createAutomadServer", () => {
  it("registers all seven tools", async () => {
    const { server, mcp } = await connect(mockClient(), new WriteGuard(cfg()));
    const list = await mcp.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await mcp.close();
    await server.close();
  });

  it("dispatches a read tool and returns JSON text content", async () => {
    const client = mockClient();
    (client.get as MockFn).mockResolvedValueOnce({ pages: [{ path: "/x" }] });
    const { server, mcp } = await connect(client, new WriteGuard(cfg()));
    const res = await mcp.callTool({ name: "automad_pages", arguments: { action: "list" } });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text)).toEqual({ pages: [{ path: "/x" }] });
    await mcp.close();
    await server.close();
  });

  it("surfaces handler errors as structured isError results", async () => {
    const client = mockClient();
    (client.get as MockFn).mockRejectedValueOnce(new Error("boom"));
    const { server, mcp } = await connect(client, new WriteGuard(cfg()));
    const res = await mcp.callTool({ name: "automad_pages", arguments: { action: "list" } });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text).code).toBe("UNKNOWN");
    await mcp.close();
    await server.close();
  });
});
