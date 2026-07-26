import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp, type HttpHandle } from '../../src/http.js';
import { createAutomadServer } from '../../src/server.js';
import { WriteGuard } from '../../src/write-guard.js';
import type { HttpClient } from '../../src/client.js';
import type { Config } from '../../src/config.js';

const TOKEN = 'test-token-abc';

function mockClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as HttpClient;
}

function cfg(writeMode: Config['writeMode'] = 'unrestricted'): Config {
  return {
    mode: 'full',
    url: 'https://x',
    username: 'u',
    password: 'p',
    writeMode,
    logLevel: 'error',
    liveEnabled: true,
    themesPath: '/tmp/themes-x',
    starterKitPath: '/tmp/starter-x',
  };
}

let handle: HttpHandle | undefined;

async function serve(writeMode: Config['writeMode'] = 'unrestricted'): Promise<number> {
  handle = await startHttp({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    makeServer: () =>
      createAutomadServer({
        client: mockClient(),
        guard: new WriteGuard(cfg(writeMode)),
        config: cfg(writeMode),
      }),
  });
  return handle.port;
}

async function connect(port: number, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('startHttp (Streamable-HTTP + Bearer auth)', () => {
  it('rejects a connection with a missing or wrong token', async () => {
    const port = await serve();
    await expect(connect(port, 'wrong-token')).rejects.toThrow();
  });

  it('completes initialize with a valid token and lists all eight tools', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [
        'automad_components',
        'automad_config',
        'automad_discover',
        'automad_docs',
        'automad_file_meta',
        'automad_image',
        'automad_mail',
        'automad_media',
        'automad_pages',
        'automad_shared',
        'automad_site',
        'automad_system',
        'automad_theme',
      ].sort(),
    );
    await client.close();
  });

  it('round-trips a tool call over HTTP', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    const res = (await client.callTool({
      name: 'automad_discover',
      arguments: { action: 'list' },
    })) as { content: { type: string; text: string }[] };
    expect(res.content[0]?.text).toContain('automad_theme');
    await client.close();
  });

  it('isolates confirm tokens per session', async () => {
    const port = await serve('confirm-destructive');
    const a = await connect(port, TOKEN);
    const b = await connect(port, TOKEN);

    const resA = (await a.callTool({
      name: 'automad_pages',
      arguments: { action: 'delete', url: '/foo' },
    })) as { content: { text: string }[] };
    const permitA = JSON.parse(resA.content[0]!.text) as { allowed: string; confirmToken?: string };
    expect(permitA.allowed).toBe('pending');
    expect(permitA.confirmToken).toBeTruthy();

    // Replaying A's token in session B must be rejected — B's guard never minted it.
    const resB = (await b.callTool({
      name: 'automad_pages',
      arguments: { action: 'delete', url: '/foo', confirm_token: permitA.confirmToken },
    })) as { content: { text: string }[]; isError?: boolean };
    expect(resB.isError).toBe(true);
    expect(resB.content[0]!.text).toContain('unknown token');

    await a.close();
    await b.close();
  });

  it('tears a session down on client close / DELETE', async () => {
    const port = await serve();
    const client = await connect(port, TOKEN);
    await expect(client.close()).resolves.toBeUndefined();
    const client2 = await connect(port, TOKEN);
    const list = await client2.listTools();
    expect(list.tools.length).toBe(13);
    await client2.close();
  });
});
