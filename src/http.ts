import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from './logger.js';

const MCP_PATH = '/mcp';

export interface HttpTransportOptions {
  host: string;
  port: number;
  token: string;
  /** Build a fresh server (with its own WriteGuard) for each new session. */
  makeServer: () => McpServer;
}

export interface HttpHandle {
  /** Actual bound port (useful when the caller passed 0 for an ephemeral port). */
  readonly port: number;
  close(): Promise<void>;
}

/** Constant-time `Authorization: Bearer <token>` check. */
function tokenMatches(expected: string, header: string | undefined): boolean {
  if (header === undefined) return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw === '' ? undefined : JSON.parse(raw);
}

export async function startHttp(opts: HttpTransportOptions): Promise<HttpHandle> {
  const { host, port, token, makeServer } = opts;
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let allowedHosts: string[] = [];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== MCP_PATH) {
      sendError(res, 404, 'Not found');
      return;
    }
    const authHeader = req.headers['authorization'];
    if (!tokenMatches(token, Array.isArray(authHeader) ? authHeader[0] : authHeader)) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    const raw = req.headers['mcp-session-id'];
    const sid = Array.isArray(raw) ? raw[0] : raw;

    const existing = sid !== undefined ? transports.get(sid) : undefined;
    if (existing !== undefined) {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      await existing.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'POST' && sid === undefined) {
      const body = await readJsonBody(req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts,
        onsessioninitialized: (newId) => {
          transports.set(newId, transport);
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id !== undefined) transports.delete(id);
      };
      const server = makeServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendError(res, 400, 'Missing or invalid session');
  }

  const httpServer = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'http request failed',
      );
      if (!res.headersSent) sendError(res, 500, 'Internal error');
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  allowedHosts = [
    host,
    'localhost',
    '127.0.0.1',
    `${host}:${boundPort}`,
    `localhost:${boundPort}`,
    `127.0.0.1:${boundPort}`,
  ];
  logger.info({ host, port: boundPort, path: MCP_PATH }, 'Automad MCP server listening on http');

  return {
    port: boundPort,
    async close() {
      for (const transport of [...transports.values()]) await transport.close();
      transports.clear();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
