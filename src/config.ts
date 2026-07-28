import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AutomadMcpError } from './errors.js';
import { BUNDLED_STARTER_KIT_PATH } from './theme/starter-kit.js';

export type WriteMode = 'read-only' | 'confirm-destructive' | 'unrestricted';

/**
 * Operating mode:
 * - `full` *(default)* — bridges to a live Automad v2 instance; requires
 *   `AUTOMAD_URL`/`AUTOMAD_USER`/`AUTOMAD_PASS`. All tools available.
 * - `docs` — standalone documentation + local theme tooling only. No live
 *   instance and no credentials required; the live-API tools return a clear
 *   `UNSUPPORTED` error.
 */
export type ServerMode = 'full' | 'docs';

export interface HttpConfig {
  /** TCP port for the Streamable-HTTP endpoint. */
  port: number;
  /** Bind host; defaults to loopback. */
  host: string;
  /** Static Bearer token required on every HTTP request. */
  token: string;
}

export interface Config {
  mode: ServerMode;
  /** Base URL of the live instance. Empty string in `docs` mode. */
  url: string;
  username: string;
  password: string;
  writeMode: WriteMode;
  logLevel: string;
  /** True when the live `/_api` tools are usable (mode=full with credentials). */
  liveEnabled: boolean;
  /**
   * Absolute path on the local filesystem where Automad theme packages live.
   * Optional — when unset, the `automad_theme` tool returns a clear error
   * for every action and the rest of the server works fine.
   */
  themesPath?: string | undefined;
  /**
   * Path to the starter-kit template used by `theme.scaffold`. Defaults to the
   * starter kit bundled with this package (`templates/starter-kit`), so
   * scaffolding works with no `AUTOMAD_STARTER_KIT_PATH` set. Override the env
   * var to scaffold from a custom local starter kit instead.
   */
  starterKitPath?: string | undefined;
  /**
   * Streamable-HTTP transport settings. Present only when `AUTOMAD_HTTP_PORT`
   * is set; otherwise the server runs on stdio (the zero-config default).
   */
  http?: HttpConfig | undefined;
  /** Per-request HTTP timeout in ms. Defaults to 30s. 0 disables. */
  requestTimeoutMs: number;
}

/** Automad v2 only: JSON API base path. */
export const API_BASE = '/_api';

const VALID_MODES: Record<WriteMode, true> = {
  'read-only': true,
  'confirm-destructive': true,
  unrestricted: true,
};

const VALID_SERVER_MODES: Record<ServerMode, true> = {
  full: true,
  docs: true,
};

export const VALID_LOG_LEVELS: Record<string, true> = {
  trace: true,
  debug: true,
  info: true,
  warn: true,
  error: true,
  fatal: true,
  silent: true,
};
export function loadConfig(): Config {
  const serverModeRaw = process.env['AUTOMAD_MODE'] ?? 'full';
  if (!(serverModeRaw in VALID_SERVER_MODES)) {
    throw new AutomadMcpError(
      'VALIDATION',
      `Invalid AUTOMAD_MODE: ${serverModeRaw}. Must be one of: ${Object.keys(VALID_SERVER_MODES).join(', ')}`,
    );
  }
  const mode = serverModeRaw as ServerMode;
  // The server always starts in `full` mode. The live API bridge is
  // gated by `liveEnabled`, which is true exactly when all three
  // credentials are present. A bare `npx -y automad-mcp-server` start
  // with no env vars boots cleanly: docs + theme tooling work, and the
  // live-API tools return a clear `UNSUPPORTED` error via
  // `assertLiveEnabled` until credentials are added.
  const writeModeRaw = process.env['AUTOMAD_WRITE_MODE'] ?? 'confirm-destructive';
  if (!(writeModeRaw in VALID_MODES)) {
    throw new AutomadMcpError(
      'VALIDATION',
      `Invalid write mode in AUTOMAD_WRITE_MODE: ${writeModeRaw}. Must be one of: ${Object.keys(VALID_MODES).join(', ')}`,
    );
  }
  const logLevel = process.env['LOG_LEVEL'] ?? 'info';
  if (!(logLevel in VALID_LOG_LEVELS)) {
    throw new AutomadMcpError(
      'VALIDATION',
      `Invalid LOG_LEVEL: ${logLevel}. Must be one of: ${Object.keys(VALID_LOG_LEVELS).join(', ')}`,
    );
  }
  // Theme tooling always works: fall back to `<cwd>/automad-themes` so
  // `theme.scaffold` needs zero config. Override with AUTOMAD_THEMES_PATH
  // to point at a live Automad install's `packages/` dir.
  const themesPath =
    optionalPath('AUTOMAD_THEMES_PATH') ?? path.resolve(process.cwd(), 'automad-themes');
  const starterKitPath = optionalPath('AUTOMAD_STARTER_KIT_PATH') ?? BUNDLED_STARTER_KIT_PATH;
  // Credentials are optional. If all three are present we bridge to the
  // live API; otherwise the live tools return UNSUPPORTED and the user
  // sees a one-line stderr note (only when AUTOMAD_MODE was set
  // explicitly — a totally bare `npx -y …` is silent).
  const rawUrl = process.env['AUTOMAD_URL']?.trim();
  const rawUser = process.env['AUTOMAD_USER']?.trim();
  const rawPass = process.env['AUTOMAD_PASS'];
  let url = '';
  let username = '';
  let password = '';
  if (rawUrl) url = validateUrl(rawUrl);
  if (rawUser) username = rawUser;
  if (rawPass) password = rawPass;
  const liveEnabled = Boolean(url && username && password);
  const userSetMode = process.env['AUTOMAD_MODE'] !== undefined;
  if (mode === 'full' && userSetMode && !liveEnabled) {
    process.stderr.write(
      '[automad-mcp] AUTOMAD_MODE=full but AUTOMAD_URL/USER/PASS are not set — ' +
        'the live API bridge stays disabled. Set the three credentials to enable it. ' +
        '(Live-API tools return UNSUPPORTED.)\n',
    );
  }
  const httpPortRaw = process.env['AUTOMAD_HTTP_PORT'];
  let http: HttpConfig | undefined;
  if (httpPortRaw !== undefined && httpPortRaw.trim() !== '') {
    const port = Number.parseInt(httpPortRaw, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new AutomadMcpError(
        'VALIDATION',
        `AUTOMAD_HTTP_PORT must be a TCP port 1-65535: ${httpPortRaw}`,
      );
    }
    const hostRaw = process.env['AUTOMAD_HTTP_HOST']?.trim();
    const host = hostRaw && hostRaw.length > 0 ? hostRaw : '127.0.0.1';
    const tokenRaw = process.env['AUTOMAD_HTTP_TOKEN']?.trim();
    const token = tokenRaw && tokenRaw.length > 0 ? tokenRaw : randomBytes(32).toString('hex');
    http = { port, host, token };
  }
  return {
    mode,
    url,
    username,
    password,
    writeMode: writeModeRaw as WriteMode,
    logLevel,
    liveEnabled,
    themesPath,
    starterKitPath,
    http,
    requestTimeoutMs: parsePositiveInt(process.env['AUTOMAD_REQUEST_TIMEOUT_MS'], 30_000),
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}


function optionalPath(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Validate an http(s) URL and strip a trailing slash for consistent joins. */
function validateUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AutomadMcpError('VALIDATION', `AUTOMAD_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AutomadMcpError('VALIDATION', `AUTOMAD_URL must use http or https: ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}
