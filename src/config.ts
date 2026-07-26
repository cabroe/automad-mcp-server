import { AutomadMcpError } from './errors.js';

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
  /** Path to the starter-kit template used by `theme.scaffold`. */
  starterKitPath?: string | undefined;
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

  const themesPath = optionalPath('AUTOMAD_THEMES_PATH');
  const starterKitPath = optionalPath('AUTOMAD_STARTER_KIT_PATH') ?? themesPath;

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

  let url = '';
  let username = '';
  let password = '';
  let liveEnabled = false;

  if (mode === 'full') {
    url = validateUrl(required('AUTOMAD_URL'));
    username = required('AUTOMAD_USER');
    password = required('AUTOMAD_PASS');
    liveEnabled = true;
  } else {
    // docs mode: credentials optional. If a URL is supplied, still validate it.
    const rawUrl = process.env['AUTOMAD_URL'];
    if (rawUrl) url = validateUrl(rawUrl);
    username = process.env['AUTOMAD_USER'] ?? '';
    password = process.env['AUTOMAD_PASS'] ?? '';
    liveEnabled = false;
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
    requestTimeoutMs: parsePositiveInt(process.env['AUTOMAD_REQUEST_TIMEOUT_MS'], 30_000),
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AutomadMcpError('VALIDATION', `Missing required environment variable: ${name}`);
  }
  return value;
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
