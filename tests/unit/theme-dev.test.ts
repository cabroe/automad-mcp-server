import { describe, expect, it, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import {
  startDev,
  stopDev,
  getDevStatus,
  assertStarterKitLayout,
  REQUIRED_LAYOUT,
  PORT_REGEX,
  parseScriptsPort,
  LOG_CAP_BYTES,
  DEV_DIR,
  DEV_RECORD,
  DEV_LOG,
  type DevSpawnHandle,
  type DevRecord,
} from '../../src/theme/dev.js';
import type { ThemeFs } from '../../src/theme/fs.js';
import { AutomadMcpError } from '../../src/errors.js';

// ────────────────────────────────────────────────────────────────────────
// Fakes
// ────────────────────────────────────────────────────────────────────────

class FakeThemeFs implements ThemeFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  removals: string[] = [];
  mkdirCalls: string[] = [];
  copyDirCalls: { src: string; dest: string }[] = [];

  exists = async (p: string) => this.files.has(p) || this.dirs.has(p);
  isDirectory = async (p: string) => this.dirs.has(p);
  readFile = async (p: string) => this.files.get(p) ?? '';
  writeFile = async (p: string, c: string) => {
    this.files.set(p, c);
  };
  list = async () => [];
  mkdirp = async (p: string) => {
    this.mkdirCalls.push(p);
    this.dirs.add(p);
  };
  remove = async (p: string) => {
    this.removals.push(p);
    this.files.delete(p);
    this.dirs.delete(p);
  };
  copyDir = async (src: string, dest: string) => {
    this.copyDirCalls.push({ src, dest });
  };
  appendLog = async (p: string, c: string) => {
    this.files.set(p, (this.files.get(p) ?? '') + c);
  };
  readLogTail = async (p: string, n: number) => (this.files.get(p) ?? '').slice(-n);
}

class FakeStream extends EventEmitter {
  constructor() {
    super();
  }
  write(_c: string) {}
  end() {}
}

class FakeChildProcess extends EventEmitter {
  pid = 0;
  stdout = new FakeStream();
  stderr = new FakeStream();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  unref() {}
  kill(signal: NodeJS.Signals) {
    this.emit('kill', signal);
    return true;
  }
}

interface FakeCommandRunnerOptions {
  alive?: (pid: number) => boolean;
  chunks?: string[];
  /** synchronously emit chunks on the child stdout as soon as spawn returns */
  emitImmediately?: boolean;
}

class FakeCommandRunner {
  installCalls: { cmd: string; args: string[]; cwd: string }[] = [];
  spawnCalls: { cmd: string; args: string[]; cwd: string }[] = [];
  kills: { pid: number; signal: NodeJS.Signals }[] = [];
  alive = new Set<number>();
  started: FakeChildProcess[] = [];
  constructor(public opts: FakeCommandRunnerOptions = {}) {}
  spawnSpy: (
    cmd: string,
    args: string[],
    options: { cwd: string; detached: boolean },
  ) => DevSpawnHandle = (cmd, args, options) => {
    this.spawnCalls.push({ cmd, args, cwd: options.cwd });
    const pid = this.started.length + 9000;
    const cp = new FakeChildProcess(pid);
    this.started.push(cp);
    this.alive.add(cp.pid);
    const handle: DevSpawnHandle = {
      pid: cp.pid,
      unref: () => cp.unref(),
      kill: (signal: NodeJS.Signals) => {
        this.kills.push({ pid: cp.pid, signal });
        if (signal === 'SIGKILL' || signal === 'SIGTERM') this.alive.delete(cp.pid);
        return true;
      },
      exited: () => new Promise<void>((resolve) => cp.once('exit', () => resolve())),
      stdout: cp.stdout,
      stderr: cp.stderr,
    };
    return handle;
  };
  emit(chunk: string): void {
    if (this.started.length === 0) throw new Error('emit() before spawn()');
    const cp = this.started[this.started.length - 1]!;
    cp.stdout.emit('data', chunk);
  }
  runInstall = async (
    cmd: string,
    args: string[],
    options: { cwd: string },
  ): Promise<{
    ok: boolean;
    exitCode: number;
    durationMs: number;
    stdout: string;
    stderr: string;
    command: string;
  }> => {
    this.installCalls.push({ cmd, args, cwd: options.cwd });
    return {
      ok: true,
      exitCode: 0,
      durationMs: 0,
      stdout: '',
      stderr: '',
      command: `${cmd} ${args.join(' ')}`,
    };
  };
  probe(pid: number): boolean {
    return this.alive.has(pid);
  }
}

function repoWithLayout(fs: FakeThemeFs, root: string) {
  fs.files.set(`${root}/theme.json`, '{}');
  fs.dirs.add(`${root}/components`);
  fs.dirs.add(`${root}/blocks`);
  fs.files.set(`${root}/client/index.ts`, '');
  fs.files.set(`${root}/esbuild.js`, '');
}

function parseRecord(fs: FakeThemeFs, themePath: string): DevRecord {
  const p = path.join(themePath, DEV_DIR, DEV_RECORD);
  return JSON.parse(fs.files.get(p) ?? 'null') as DevRecord;
}

// ────────────────────────────────────────────────────────────────────────
// Constants / pure helpers
// ────────────────────────────────────────────────────────────────────────

describe('theme dev constants', () => {
  it('exports canonical layout', () => {
    expect(REQUIRED_LAYOUT).toHaveLength(5);
    expect(REQUIRED_LAYOUT).toContain('theme.json');
  });
  it('log cap is 1 MiB', () => {
    expect(LOG_CAP_BYTES).toBe(1_048_576);
  });
  it('DEV_DIR / DEV_RECORD / DEV_LOG names', () => {
    expect(DEV_DIR).toBe('.automad-mcp');
    expect(DEV_RECORD).toBe('dev.json');
    expect(DEV_LOG).toBe('dev.log');
  });
});

describe('parseScriptsPort', () => {
  it('finds --port=4321', () => expect(parseScriptsPort('vite --port=4321')).toBe(4321));
  it('finds PORT=4321', () => expect(parseScriptsPort('PORT=4321 node dev.js')).toBe(4321));
  it('finds PORT 4321', () => expect(parseScriptsPort('PORT 4321 node dev.js')).toBe(4321));
  it('finds PORT = 4321 (spaces around =)', () =>
    expect(parseScriptsPort('PORT = 4321 node dev.js')).toBe(4321));
  it('finds --port 4321 (space)', () =>
    expect(parseScriptsPort('node dev.js --port 4321')).toBe(4321));
  it('ignores out-of-range port', () => expect(parseScriptsPort('--port=9999999')).toBeNull());
  it('ignores non-numeric', () => expect(parseScriptsPort('--port=abc')).toBeNull());
  it('returns null on empty', () => expect(parseScriptsPort('')).toBeNull());
});

describe('PORT_REGEX', () => {
  it('matches http://localhost:8080', () => {
    const m = PORT_REGEX.exec('Server ready at http://localhost:8080');
    expect(m?.[1]).toBe('8080');
  });
  it('matches 0.0.0.0:8080', () => expect('Server at http://0.0.0.0:8080\n'.match(PORT_REGEX)?.[1]).toBe('8080'));
  it('matches [::1]:4321', () => expect('Server at http://[::1]:4321\n'.match(PORT_REGEX)?.[1]).toBe('4321'));
  it('matches 127.0.0.1:4321', () => {
    const m = PORT_REGEX.exec('listening on 127.0.0.1:4321');
    expect(m?.[1]).toBe('4321');
  });
});

describe('assertStarterKitLayout', () => {
  it('accepts the canonical layout', async () => {
    const fs = new FakeThemeFs();
    repoWithLayout(fs, '/starter');
    await expect(assertStarterKitLayout('/starter', fs)).resolves.toBeUndefined();
  });
  it('rejects a starter kit missing components/', async () => {
    const fs = new FakeThemeFs();
    fs.files.set('/starter/theme.json', '{}');
    fs.dirs.add('/starter/blocks');
    fs.files.set('/starter/client/index.ts', '');
    fs.files.set('/starter/esbuild.js', '');
    await expect(assertStarterKitLayout('/starter', fs)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
  it('rejects a starter kit missing theme.json', async () => {
    const fs = new FakeThemeFs();
    fs.dirs.add('/starter/components');
    fs.dirs.add('/starter/blocks');
    fs.files.set('/starter/client/index.ts', '');
    fs.files.set('/starter/esbuild.js', '');
    await expect(assertStarterKitLayout('/starter', fs)).rejects.toBeInstanceOf(AutomadMcpError);
  });
  it('rejects when blocks is a file, not a directory', async () => {
    const fs = new FakeThemeFs();
    fs.files.set('/starter/theme.json', '{}');
    fs.dirs.add('/starter/components');
    fs.files.set('/starter/blocks', 'not a dir');
    fs.files.set('/starter/client/index.ts', '');
    fs.files.set('/starter/esbuild.js', '');
    await expect(assertStarterKitLayout('/starter', fs)).rejects.toBeInstanceOf(AutomadMcpError);
  });
});

// ────────────────────────────────────────────────────────────────────────
// startDev lifecycle
// ────────────────────────────────────────────────────────────────────────

describe('startDev', () => {
  let fs: FakeThemeFs;
  let runner: FakeCommandRunner;
  const themePath = '/themes/blog';

  beforeEach(() => {
    fs = new FakeThemeFs();
    runner = new FakeCommandRunner({ chunks: ['Server ready at http://localhost:4321\n'] });
    fs.dirs.add(themePath);
    // package.json must exist for the pre-flight check in startDev
    fs.files.set(`${themePath}/package.json`, JSON.stringify({ scripts: { dev: 'vite' } }));
  });

  it('writes dev.json with the spawned pid and reports running:true', async () => {
    const res = await startDev({
      cwd: themePath,
      fs,
      runInstall: runner.runInstall,
      spawn: runner.spawnSpy,
      portTimeoutMs: 1000,
    });
    expect(res.pid).toBeGreaterThan(0);
    expect(res.running).toBe(true);
    const rec = parseRecord(fs, themePath);
    expect(rec.pid).toBe(res.pid);
    expect(rec.startedAt).toBeTruthy();
    expect(rec.logPath).toBe(path.join(themePath, DEV_DIR, DEV_LOG));
  });

  it('runs npm install only when node_modules is missing', async () => {
    // First startDev: no node_modules → install is called.
    await startDev({
      cwd: themePath,
      fs,
      runInstall: runner.runInstall,
      spawn: runner.spawnSpy,
      portTimeoutMs: 500,
    });
    expect(runner.installCalls).toHaveLength(1);
    expect(runner.installCalls[0]?.args).toEqual(['install', '--no-audit', '--no-fund']);

    // Second startDev: theme now has node_modules AND no live record.
    // Use a fresh fs so the previous dev.json doesn't block the second call.
    const fs2 = new FakeThemeFs();
    fs2.dirs.add(themePath);
    fs2.dirs.add(`${themePath}/node_modules`);
    fs2.files.set(`${themePath}/package.json`, JSON.stringify({ scripts: { dev: 'vite' } }));
    // Pre-seed the log so the second startDev can complete (we only care about install).
    await fs2.appendLog(path.join(themePath, DEV_DIR, DEV_LOG), 'ready http://localhost:4321\n');
    const runner2 = new FakeCommandRunner();
    await startDev({
      cwd: themePath,
      fs: fs2,
      runInstall: runner2.runInstall,
      spawn: runner2.spawnSpy,
      portTimeoutMs: 500,
    });
    expect(runner2.installCalls).toHaveLength(0);
  });

  it('discovers the port from a log chunk containing http://localhost:4321', async () => {
    // Pre-seed the dev.log so the poll loop finds the port marker on iteration 1.
    await fs.mkdirp(path.join(themePath, DEV_DIR));
    await fs.appendLog(
      path.join(themePath, DEV_DIR, DEV_LOG),
      'Server ready at http://localhost:4321\n',
    );
    const res = await startDev({
      cwd: themePath,
      fs,
      runInstall: runner.runInstall,
      spawn: runner.spawnSpy,
      portTimeoutMs: 2000,
    });
    expect(res.port).toBe(4321);
    expect(res.url).toBe('http://localhost:4321');
    const rec = parseRecord(fs, themePath);
    expect(rec.port).toBe(4321);
    expect(rec.url).toBe('http://localhost:4321');
  });

  it('returns port:null after portTimeoutMs when no marker appears', async () => {
    const silent = new FakeCommandRunner({ chunks: ['booting up but no port'] });
    const res = await startDev({
      cwd: themePath,
      fs,
      runInstall: silent.runInstall,
      spawn: silent.spawnSpy,
      portTimeoutMs: 300,
    });
    expect(res.port).toBeNull();
    expect(res.url).toBeNull();
  });

  it('rejects with CONFLICT when a live pid is already recorded', async () => {
    // write a record with a pid the alive probe says is alive
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 4242,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: true,
      }),
    );
    await expect(
      startDev({
        cwd: themePath,
        fs,
        runInstall: runner.runInstall,
        spawn: runner.spawnSpy,
        kill0: () => true, // probe says alive
        portTimeoutMs: 500,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(runner.spawnCalls).toHaveLength(0);
  });

  it('rejects with VALIDATION when package.json is missing (pre-flight)', async () => {
    const noPkgFs = new FakeThemeFs();
    noPkgFs.dirs.add(themePath);
    // No package.json file — should refuse before spawning anything.
    await expect(
      startDev({
        cwd: themePath,
        fs: noPkgFs,
        runInstall: runner.runInstall,
        spawn: runner.spawnSpy,
        portTimeoutMs: 500,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(runner.spawnCalls).toHaveLength(0);
    expect(runner.installCalls).toHaveLength(0);
  });

  it('clears a stale dev.json (dead pid) and proceeds', async () => {
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 1111,
        port: null,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: null,
        running: false,
      }),
    );
    fs.removals.length = 0; // reset
    await startDev({
      cwd: themePath,
      fs,
      runInstall: runner.runInstall,
      spawn: runner.spawnSpy,
      kill0: () => false, // probe says dead
      portTimeoutMs: 1000,
    });
    expect(fs.removals).toContain(path.join(themePath, DEV_DIR, DEV_RECORD));
    expect(runner.spawnCalls).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// stopDev
// ────────────────────────────────────────────────────────────────────────

describe('stopDev', () => {
  const themePath = '/themes/blog';

  it('returns stopped:false when no dev.json is present', async () => {
    const fs = new FakeThemeFs();
    const res = await stopDev(themePath, fs, {});
    expect(res.stopped).toBe(false);
  });

  it('sends SIGTERM and removes dev.json', async () => {
    const fs = new FakeThemeFs();
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 7777,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: true,
      }),
    );
    const kills: { pid: number; signal: NodeJS.Signals }[] = [];
    let aliveCount = 0;
    const res = await stopDev(themePath, fs, {
      kill: (pid, sig) => {
        kills.push({ pid, signal: sig });
      },
      alive: () => {
        aliveCount++;
        return aliveCount <= 1; // alive initially, dead after SIGTERM
      },
      sleep: async () => {},
    });
    expect(res.stopped).toBe(true);
    expect(kills).toHaveLength(1);
    expect(kills[0]?.signal).toBe('SIGTERM');
    expect(fs.files.has(path.join(themePath, DEV_DIR, DEV_RECORD))).toBe(false);
  });

  it('cleans up dev.json when process is already dead without throwing ESRCH', async () => {
    const fs = new FakeThemeFs();
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 7777,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: false,
      }),
    );
    const res = await stopDev(themePath, fs, {
      kill: () => {
        const err = new Error('kill ESRCH') as Error & { code: string };
        err.code = 'ESRCH';
        throw err;
      },
      alive: () => false,
      sleep: async () => {},
    });
    expect(res.stopped).toBe(false);
    expect(res.wasLive).toBe(false);
    expect(fs.files.has(path.join(themePath, DEV_DIR, DEV_RECORD))).toBe(false);
  });
  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const fs = new FakeThemeFs();
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 8888,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: true,
      }),
    );
    const kills: { pid: number; signal: NodeJS.Signals }[] = [];
    const res = await stopDev(themePath, fs, {
      kill: (pid, sig) => {
        kills.push({ pid, signal: sig });
      },
      alive: () => true, // never dies
      sleep: async () => {},
    });
    expect(kills.map((k) => k.signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(res.signalUsed).toBe('SIGKILL');
  });
});

// ────────────────────────────────────────────────────────────────────────
// getDevStatus
// ────────────────────────────────────────────────────────────────────────

describe('getDevStatus', () => {
  const themePath = '/themes/blog';

  it('returns null when no record exists', async () => {
    const fs = new FakeThemeFs();
    expect(await getDevStatus(themePath, fs, { alive: () => true })).toBeNull();
  });

  it('returns running:false when the pid is dead', async () => {
    const fs = new FakeThemeFs();
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 5555,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: true,
      }),
    );
    const res = await getDevStatus(themePath, fs, { alive: () => false });
    expect(res?.pid).toBe(5555);
    expect(res?.running).toBe(false);
  });

  it('returns running:true when the pid is alive', async () => {
    const fs = new FakeThemeFs();
    fs.mkdirp(path.join(themePath, DEV_DIR));
    fs.files.set(
      path.join(themePath, DEV_DIR, DEV_RECORD),
      JSON.stringify({
        pid: 5556,
        port: 4321,
        startedAt: new Date().toISOString(),
        logPath: 'x',
        url: 'http://localhost:4321',
        running: true,
      }),
    );
    const res = await getDevStatus(themePath, fs, { alive: () => true });
    expect(res?.running).toBe(true);
  });
});
