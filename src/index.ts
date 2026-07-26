#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AuthManager } from './auth.js';
import { HttpClient } from './client.js';
import { WriteGuard } from './write-guard.js';
import { logger } from './logger.js';
import { createAutomadServer } from './server.js';
import { startHttp } from './http.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  const auth = new AuthManager(cfg);
  const client = new HttpClient({ baseUrl: cfg.url, timeoutMs: cfg.requestTimeoutMs }, auth, {
    maxRetries: 2,
    retryDelayMs: 250,
  });

  const makeServer = () => createAutomadServer({ client, guard: new WriteGuard(cfg), config: cfg });

  let close: () => Promise<void>;

  if (cfg.http) {
    if (!process.env['AUTOMAD_HTTP_TOKEN']?.trim()) {
      logger.warn(
        { token: cfg.http.token },
        'AUTOMAD_HTTP_TOKEN not set — generated a token for this run; pass it as "Authorization: Bearer <token>"',
      );
    }
    const handle = await startHttp({ ...cfg.http, makeServer });
    logger.info(
      { mode: cfg.writeMode, host: cfg.http.host, port: handle.port },
      'Automad MCP server ready (http)',
    );
    close = () => handle.close();
  } else {
    const server = makeServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info({ mode: cfg.writeMode }, 'Automad MCP server listening on stdio');
    close = () => server.close();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'fatal startup error');
  process.exit(1);
});
