import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

export interface BuildResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  command: string;
}

export interface BuildOptions {
  cwd: string;
  /** Hard timeout in ms. 0 = no timeout. */
  timeoutMs?: number;
  /** Custom env to add to the spawned process. */
  env?: Record<string, string>;
  /** Capture at most this many bytes of combined output (stdout+stderr). */
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT = 64 * 1024;

/** Run a shell command in `cwd`, returning a captured result. */
export async function runCommand(
  cmd: string,
  args: string[],
  opts: BuildOptions,
): Promise<BuildResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const start = Date.now();

  return new Promise<BuildResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdout = '';
    let stderr = '';
    const append = (target: 'stdout' | 'stderr', data: Buffer): void => {
      const bytes = data.toString('utf8');
      if (target === 'stdout') {
        stdoutBytes += bytes.length;
        if (stdoutBytes <= maxOutput) stdout += bytes;
      } else {
        stderrBytes += bytes.length;
        if (stderrBytes <= maxOutput) stderr += bytes;
      }
    };

    child.stdout.on('data', (d: Buffer) => append('stdout', d));
    child.stderr.on('data', (d: Buffer) => append('stderr', d));

    let killed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killed = true;
        logger.warn({ cmd, args, cwd: opts.cwd, timeoutMs }, 'build timeout, killing process');
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);
    }

    child.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timer);
      const isEnoent = err.code === 'ENOENT';
      const msg = isEnoent
        ? `Executable '${cmd}' was not found in PATH. Ensure '${cmd}' is installed, or set AUTOMAD_PACKAGE_MANAGER to an available package manager.`
        : err.message;
      resolve({
        ok: false,
        exitCode: -1,
        durationMs: Date.now() - start,
        stdout,
        stderr: stderr ? `${stderr}\n[spawn error] ${msg}` : `[spawn error] ${msg}`,
        command: `${cmd} ${args.join(' ')}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
        stdout,
        stderr,
        command: `${cmd} ${args.join(' ')}`,
      });
    });
  });
}

/** Run package install in `cwd` (`npm install` or configured package manager). */
export async function npmInstall(cwd: string, timeoutMs?: number): Promise<BuildResult> {
  const pm = process.env['AUTOMAD_PACKAGE_MANAGER'] ?? 'npm';
  const args =
    pm === 'bun'
      ? ['install']
      : pm === 'pnpm'
        ? ['install', '--no-fund']
        : ['install', '--no-audit', '--no-fund', '--loglevel=warn'];
  return runCommand(pm, args, {
    cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/** Run package build in `cwd` (`npm run build` or configured package manager). */
export async function npmBuild(cwd: string, timeoutMs?: number): Promise<BuildResult> {
  const pm = process.env['AUTOMAD_PACKAGE_MANAGER'] ?? 'npm';
  const args = pm === 'bun' ? ['run', 'build'] : ['run', 'build', '--loglevel=warn'];
  return runCommand(pm, args, {
    cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/** Run `composer install` in `cwd` (only call when composer.json exists). */
export async function composerInstall(cwd: string, timeoutMs?: number): Promise<BuildResult> {
  return runCommand('composer', ['install', '--no-interaction', '--no-progress'], {
    cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}
