import { spawn as cpSpawn } from 'node:child_process';
import * as path from 'node:path';
import type { ThemeFs } from './fs.js';
import { runCommand } from './build.js';
import { AutomadMcpError } from '../errors.js';

export const REQUIRED_LAYOUT = [
  'theme.json',
  'components',
  'blocks',
  'client/index.ts',
  'esbuild.js',
] as const;

export const DEV_DIR = '.automad-mcp';
export const DEV_RECORD = 'dev.json';
export const DEV_LOG = 'dev.log';
export const LOG_CAP_BYTES = 1_048_576;
export const LOG_TAIL_KEEP = 256 * 1024;
export const PORT_REGEX = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{4,5})(?=\b|$)/;

const SIGTERM_DEADLINE_MS = 5_000;
const SIGKILL_DEADLINE_MS = 1_000;
const DEFAULT_PORT_TIMEOUT_MS = 20_000;
const DEFAULT_NPM_INSTALL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_LOG_TAIL_BYTES = 16 * 1024;

export interface DevRecord {
  pid: number;
  port: number | null;
  startedAt: string;
  logPath: string;
  url: string | null;
  running: boolean;
}

export interface DevStatus extends DevRecord {
  running: boolean;
}

export interface StartDevOptions {
  cwd: string;
  fs: ThemeFs;
  portHint?: number;
  portTimeoutMs?: number;
  logMaxBytes?: number;
  spawn?: SpawnFn;
  runInstall?: RunCommandFn;
  onLogChunk?: (chunk: string) => void;
  kill0?: (pid: number) => boolean;
}

export interface StartDevResult extends DevRecord {
  running: true;
}

export interface StopDevResult {
  stopped: boolean;
  signalUsed: 'SIGTERM' | 'SIGKILL' | null;
  wasLive: boolean;
}

export interface DevSpawnHandle {
  pid: number;
  unref(): void;
  kill(signal: NodeJS.Signals): boolean;
  exited(): Promise<void>;
  stdout?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; detached: boolean },
) => DevSpawnHandle;

export type RunCommandFn = typeof runCommand;

export function realSpawn(
  cmd: string,
  args: string[],
  opts: { cwd: string; detached: boolean },
): DevSpawnHandle {
  const child = cpSpawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  child.unref();
  return {
    pid: child.pid ?? 0,
    unref: () => child.unref(),
    kill: (sig) => child.kill(sig),
    exited: () => new Promise<void>((resolve) => child.once('exit', () => resolve())),
    stdout: child.stdout ?? undefined,
    stderr: child.stderr ?? undefined,
  };
}

export const detachSpawn = realSpawn;

export async function assertStarterKitLayout(starterKitPath: string, fs: ThemeFs): Promise<void> {
  const missing: string[] = [];
  for (const entry of REQUIRED_LAYOUT) {
    const p = path.join(starterKitPath, entry);
    if (!(await fs.exists(p))) {
      missing.push(entry);
      continue;
    }
    if ((entry === 'components' || entry === 'blocks') && !(await fs.isDirectory(p))) {
      missing.push(`${entry}/`);
    }
  }
  if (missing.length) {
    throw new AutomadMcpError(
      'VALIDATION',
      `starter kit at ${starterKitPath} is missing required layout entries: ${missing.join(', ')}. Expected the canonical layout from automadcms/automad-theme-starter-kit.`,
    );
  }
}

export function parseScriptsPort(devScript: string): number | null {
  if (!devScript) return null;
  const m = /(?:--port(?:=|\s+)(\d{1,5}))|(?:^|\s)PORT[=\s](\d{1,5})\b/.exec(devScript);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : null;
}

function recordPath(cwd: string): string {
  return path.join(cwd, DEV_DIR, DEV_RECORD);
}

function logPath(cwd: string): string {
  return path.join(cwd, DEV_DIR, DEV_LOG);
}

async function readRecord(fs: ThemeFs, cwd: string): Promise<DevRecord | null> {
  const p = recordPath(cwd);
  if (!(await fs.exists(p))) return null;
  return JSON.parse(await fs.readFile(p)) as DevRecord;
}

async function writeRecord(fs: ThemeFs, cwd: string, rec: DevRecord): Promise<void> {
  await fs.mkdirp(path.join(cwd, DEV_DIR));
  await fs.writeFile(recordPath(cwd), JSON.stringify(rec, null, 2) + '\n');
}

function defaultAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getDevStatus(
  cwd: string,
  fs: ThemeFs,
  deps: { alive?: (pid: number) => boolean } = {},
): Promise<DevStatus | null> {
  const rec = await readRecord(fs, cwd);
  if (!rec) return null;
  const probe = deps.alive ?? defaultAlive;
  return { ...rec, running: probe(rec.pid) };
}

export async function stopDev(
  cwd: string,
  fs: ThemeFs,
  deps: {
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    alive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<StopDevResult> {
  const rec = await readRecord(fs, cwd);
  if (!rec) return { stopped: false, signalUsed: null, wasLive: false };

  const kill = deps.kill ?? ((pid: number, sig: NodeJS.Signals) => process.kill(pid, sig));
  const alive = deps.alive ?? defaultAlive;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const waitForExited = async (ms: number): Promise<boolean> => {
    const stepMs = 100;
    for (let i = 0; i < Math.ceil(ms / stepMs); i++) {
      if (!alive(rec.pid)) return true;
      await sleep(stepMs);
    }
    return !alive(rec.pid);
  };

  kill(rec.pid, 'SIGTERM');
  let signalUsed: 'SIGTERM' | 'SIGKILL' = 'SIGTERM';
  if (!(await waitForExited(SIGTERM_DEADLINE_MS))) {
    kill(rec.pid, 'SIGKILL');
    signalUsed = 'SIGKILL';
    await waitForExited(SIGKILL_DEADLINE_MS);
  }
  await fs.remove(recordPath(cwd));
  return { stopped: true, signalUsed, wasLive: true };
}

export async function startDev(opts: StartDevOptions): Promise<StartDevResult> {
  const alive = opts.kill0 ?? defaultAlive;
  const existing = await readRecord(opts.fs, opts.cwd);
  const themeName = path.basename(opts.cwd);

  if (existing) {
    if (alive(existing.pid)) {
      throw new AutomadMcpError(
        'CONFLICT',
        `dev server already running for theme '${themeName}' (pid ${existing.pid}). Call dev_stop first.`,
      );
    }
    await opts.fs.remove(recordPath(opts.cwd));
  }

  // Pre-flight: refuse to spawn npm in a directory that isn't a theme. Without
  // this, a stub directory triggers "spawn npm ENOENT" (or a misleading npm
  // error) instead of a clear VALIDATION error pointing at the real cause.
  if (!(await opts.fs.exists(path.join(opts.cwd, 'package.json')))) {
    throw new AutomadMcpError(
      'VALIDATION',
      `theme '${themeName}' has no package.json — cannot run npm. Run \`theme.scaffold\` first to lay down a starter layout, or point \`theme\` at a directory with a package.json.`,
    );
  }

  if (!(await opts.fs.exists(path.join(opts.cwd, 'node_modules')))) {
    const res = await (opts.runInstall ?? runCommand)(
      'npm',
      ['install', '--no-audit', '--no-fund'],
      { cwd: opts.cwd, timeoutMs: DEFAULT_NPM_INSTALL_TIMEOUT_MS },
    );
    if (!res.ok) {
      throw new AutomadMcpError(
        'BUILD',
        `npm install failed (exit ${res.exitCode}): ${res.stderr.slice(-2048)}`,
      );
    }
  }

  let guess: number | null = opts.portHint ?? null;
  if (guess === null && (await opts.fs.exists(path.join(opts.cwd, 'package.json')))) {
    try {
      const pkg = JSON.parse(await opts.fs.readFile(path.join(opts.cwd, 'package.json'))) as {
        scripts?: { dev?: string };
      };
      guess = parseScriptsPort(pkg.scripts?.dev ?? '');
    } catch {
      // malformed package.json — ignore; port will be discovered from log
    }
  }

  const lp = logPath(opts.cwd);
  const rec: DevRecord = {
    pid: 0,
    port: guess,
    startedAt: new Date().toISOString(),
    logPath: lp,
    url: guess !== null ? `http://localhost:${guess}` : null,
    running: false,
  };
  await opts.fs.mkdirp(path.join(opts.cwd, DEV_DIR));

  const child = (opts.spawn ?? realSpawn)('npm', ['run', 'dev'], { cwd: opts.cwd, detached: true });
  child.unref();

  const emit = (d: Buffer | string): void => {
    const s = typeof d === 'string' ? d : d.toString();
    void opts.fs.appendLog(lp, s);
    opts.onLogChunk?.(s);
  };
  child.stdout?.on('data', emit);
  child.stderr?.on('data', emit);

  rec.pid = child.pid;
  rec.running = true;
  await writeRecord(opts.fs, opts.cwd, rec);

  const timeoutMs = opts.portTimeoutMs ?? DEFAULT_PORT_TIMEOUT_MS;
  const tailBytes = opts.logMaxBytes ?? DEFAULT_LOG_TAIL_BYTES;
  const start = Date.now();
  let exited = false;
  void child.exited().then(() => {
    exited = true;
  });

  while (rec.port === null && Date.now() - start < timeoutMs) {
    const text = await opts.fs.readLogTail(lp, tailBytes);
    const match = PORT_REGEX.exec(text);
    if (match) {
      rec.port = Number(match[1]);
      rec.url = `http://localhost:${rec.port}`;
      await writeRecord(opts.fs, opts.cwd, rec);
      break;
    }
    if (exited) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  return rec as StartDevResult;
}
