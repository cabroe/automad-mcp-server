#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { AuthManager } from "./auth.js";
import { HttpClient } from "./client.js";
import { WriteGuard } from "./write-guard.js";
import { logger } from "./logger.js";
import { createAutomadServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();

  const auth = new AuthManager(cfg);
  const client = new HttpClient({ baseUrl: cfg.url }, auth, {
    maxRetries: 2,
    retryDelayMs: 250,
  });
  const guard = new WriteGuard(cfg);
  const server = createAutomadServer({ client, guard, config: cfg });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ mode: cfg.writeMode }, "Automad MCP server listening on stdio");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "fatal startup error");
  process.exit(1);
});
