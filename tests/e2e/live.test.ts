import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

/**
 * Opt-in live E2E against a real Automad v2 instance. Skipped unless
 * AUTOMAD_E2E_URL / AUTOMAD_E2E_USER / AUTOMAD_E2E_PASS are set, so the default
 * `npm test` stays offline. Spawns the built server (`dist/index.js`) over
 * stdio via the MCP SDK client and exercises the full page lifecycle.
 *
 * Run:
 *   npm run build
 *   AUTOMAD_E2E_URL=http://localhost:8899 AUTOMAD_E2E_USER=admin \
 *     AUTOMAD_E2E_PASS=secret npm run test:e2e
 */
const URL = process.env["AUTOMAD_E2E_URL"];
const USER = process.env["AUTOMAD_E2E_USER"];
const PASS = process.env["AUTOMAD_E2E_PASS"];
const enabled = Boolean(URL && USER && PASS);

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, "../../dist/index.js");

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parse(result: unknown): { data: unknown; isError: boolean } {
  const r = result as ToolResult;
  const first = r.content[0];
  const text = first && first.type === "text" ? first.text : "";
  return { data: text ? JSON.parse(text) : undefined, isError: Boolean(r.isError) };
}

describe.skipIf(!enabled)("live E2E (real Automad v2)", () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        PATH: process.env["PATH"] ?? "",
        AUTOMAD_MODE: "full",
        AUTOMAD_URL: URL!,
        AUTOMAD_USER: USER!,
        AUTOMAD_PASS: PASS!,
        AUTOMAD_WRITE_MODE: "unrestricted",
        LOG_LEVEL: "silent",
      },
    });
    client = new Client({ name: "e2e", version: "0" }, { capabilities: {} });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists the seven tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "automad_config", "automad_docs", "automad_media", "automad_pages",
      "automad_shared", "automad_site", "automad_theme",
    ]);
  });

  it("reports a healthy site", async () => {
    const { data } = parse(await client.callTool({ name: "automad_site", arguments: { action: "health" } }));
    expect(data).toMatchObject({ ok: true, reachable: true, authenticated: true });
  });

  it("runs the full page lifecycle: create → get → delete", async () => {
    const title = `E2E ${Date.now()}`;
    const created = parse(await client.callTool({
      name: "automad_pages",
      arguments: { action: "create", title, target_url: "/" },
    }));
    expect(created.isError).toBe(false);
    const cd = created.data;
    let url: unknown;
    if (cd && typeof cd === "object" && "url" in cd) url = cd.url;
    expect(typeof url).toBe("string");

    const got = parse(await client.callTool({ name: "automad_pages", arguments: { action: "get", url } }));
    expect(got.isError).toBe(false);

    const deleted = parse(await client.callTool({ name: "automad_pages", arguments: { action: "delete", url } }));
    expect(deleted.isError).toBe(false);
  }, 20000);

  it("searches the offline docs regardless of the live backend", async () => {
    const { data } = parse(await client.callTool({
      name: "automad_docs",
      arguments: { action: "search", query: "foreach" },
    }));
    const results = data && typeof data === "object" && "results" in data ? data.results : undefined;
    expect(Array.isArray(results) && results.length > 0).toBe(true);
  });
});
