/**
 * Shared plumbing for the live E2E suite.
 *
 * Every test file spawns the *built* server (`dist/index.js`) as a child
 * process and talks to it over stdio with the real MCP SDK client — the same
 * path an editor takes. Nothing is mocked: the server logs into the Automad v2
 * instance configured via `AUTOMAD_E2E_*` and issues real `/_api` calls.
 *
 * Enablement: `e2eEnabled` is false unless URL + user + password are all set,
 * which is what every `describe.skipIf(!e2eEnabled)` keys off. `npm run e2e:up`
 * writes them to `.env.e2e`; `tests/e2e/env.ts` loads that file.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const E2E_URL = process.env['AUTOMAD_E2E_URL'];
export const E2E_USER = process.env['AUTOMAD_E2E_USER'];
export const E2E_PASS = process.env['AUTOMAD_E2E_PASS'];

/** All three credentials present → the suite runs. Otherwise every file skips. */
export const e2eEnabled = Boolean(E2E_URL && E2E_USER && E2E_PASS);

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SERVER_ENTRY = path.resolve(ROOT, 'dist', 'index.js');

export type WriteModeName = 'read-only' | 'confirm-destructive' | 'unrestricted';

export interface StartServerOptions {
  /** Defaults to `unrestricted` so most tests don't have to dance the token flow. */
  writeMode?: WriteModeName;
  mode?: 'full' | 'docs';
  themesPath?: string;
  starterKitPath?: string;
  /** Extra env vars merged last — wins over everything above. */
  env?: Record<string, string>;
}

/** One tool call's result, already unwrapped from the MCP content envelope. */
export interface ToolResult {
  /** Parsed JSON payload, or the raw string when the server answered plain text. */
  data: unknown;
  isError: boolean;
  text: string;
}

export class E2eServer {
  constructor(private readonly client: Client) {}

  /** Call a tool and unwrap the result. Errors come back as `isError`, not throws. */
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const raw = (await this.client.callTool({ name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const first = raw.content?.[0];
    const text = first && first.type === 'text' ? (first.text ?? '') : '';
    let data: unknown = text;
    try {
      data = text === '' ? undefined : JSON.parse(text);
    } catch {
      /* v2 SDK validation errors arrive as plain text — keep the string */
    }
    return { data, isError: Boolean(raw.isError), text };
  }

  /** Call a tool and fail loudly (with the server's message) on an error result. */
  async callOk(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.call(name, args);
    if (result.isError) {
      throw new Error(
        `${name}(${String(args['action'])}) failed: ${result.text || '<empty result>'}`,
      );
    }
    return result.data;
  }

  get mcp(): Client {
    return this.client;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Spawn `dist/index.js` and complete the MCP handshake. The child gets an
 * explicit env (not the parent's) so a stray `AUTOMAD_*` in the shell can't
 * change what a test is actually exercising.
 */
export async function startServer(opts: StartServerOptions = {}): Promise<E2eServer> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} not found — run \`npm run build\` before the E2E suite`);
  }
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    AUTOMAD_MODE: opts.mode ?? 'full',
    AUTOMAD_URL: E2E_URL ?? '',
    AUTOMAD_USER: E2E_USER ?? '',
    AUTOMAD_PASS: E2E_PASS ?? '',
    AUTOMAD_WRITE_MODE: opts.writeMode ?? 'unrestricted',
    LOG_LEVEL: 'silent',
    ...(opts.themesPath ? { AUTOMAD_THEMES_PATH: opts.themesPath } : {}),
    ...(opts.starterKitPath ? { AUTOMAD_STARTER_KIT_PATH: opts.starterKitPath } : {}),
    ...opts.env,
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'automad-mcp-e2e', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  return new E2eServer(client);
}

/** Unique, filesystem-safe page/theme titles so reruns never collide. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Narrow an unknown tool payload to an object for property access. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected an object payload, got: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

export function stringField(value: unknown, field: string): string {
  const found = asRecord(value)[field];
  if (typeof found !== 'string') {
    throw new Error(`expected string field "${field}" in ${JSON.stringify(value)}`);
  }
  return found;
}

/**
 * Deferred cleanup that runs even when a test failed mid-way. Entries run in
 * reverse order (children before parents) and a failing entry is reported but
 * never masks the original test failure.
 */
export class Cleanup {
  private readonly tasks: Array<{ label: string; run: () => Promise<unknown> }> = [];

  add(label: string, run: () => Promise<unknown>): void {
    this.tasks.push({ label, run });
  }

  /** Convenience: remove a page with an unrestricted server once the test is done. */
  addPage(server: E2eServer, url: string): void {
    this.add(`delete page ${url}`, () =>
      server.call('automad_pages', { action: 'delete', url }),
    );
  }

  async run(): Promise<void> {
    const failures: string[] = [];
    for (const task of this.tasks.reverse()) {
      try {
        await task.run();
      } catch (err) {
        failures.push(`${task.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.tasks.length = 0;
    if (failures.length > 0) {
      // Surfaced, not thrown: a cleanup miss should not turn a green run red.
      // eslint-disable-next-line no-console
      console.warn(`e2e cleanup issues:\n  ${failures.join('\n  ')}`);
    }
  }
}

/**
 * Host directory that `docker-compose.e2e.yml` bind-mounts into the container
 * at `/app/packages/mcp`. A theme scaffolded here is immediately usable by the
 * running site — bind a page to `mcp/<slug>/<template>`. Tests that only need
 * theme *tooling* should use `makeTempThemesDir()` instead; this one is for the
 * tests that check what the visitor actually gets served.
 */
export const MOUNTED_THEMES_PATH = path.resolve(ROOT, 'automad-themes');

/** Vendor namespace the mount appears under inside v2's package tree. */
export const MOUNTED_THEMES_VENDOR = 'mcp';

/** Fetch a page from the site the way a visitor would — no session, no API. */
export async function fetchPublic(pageUrl: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${E2E_URL}${pageUrl}`, { redirect: 'follow' });
  return { status: res.status, html: await res.text() };
}

/** Throwaway themes directory for the theme tests; removed via the returned dispose. */
export function makeTempThemesDir(): { path: string; dispose: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'automad-e2e-themes-'));
  return { path: dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 1×1 transparent PNG — smallest thing that survives v2's image validation. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
