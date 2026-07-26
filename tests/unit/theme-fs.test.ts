import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as nodeFs, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalThemeFs, assertWithinRoot } from '../../src/theme/fs.js';

let tmp: string;

beforeEach(async () => {
  tmp = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'mcp-fs-'));
});
afterEach(async () => {
  await nodeFs.rm(tmp, { recursive: true, force: true });
});

describe('LocalThemeFs', () => {
  it('exists / isDirectory work for a real file and dir', async () => {
    const f = new LocalThemeFs();
    await nodeFs.writeFile(path.join(tmp, 'a.txt'), 'hi');
    await nodeFs.mkdir(path.join(tmp, 'sub'));
    expect(await f.exists(path.join(tmp, 'a.txt'))).toBe(true);
    expect(await f.isDirectory(path.join(tmp, 'a.txt'))).toBe(false);
    expect(await f.exists(path.join(tmp, 'sub'))).toBe(true);
    expect(await f.isDirectory(path.join(tmp, 'sub'))).toBe(true);
    expect(await f.exists(path.join(tmp, 'missing'))).toBe(false);
  });

  it('readFile + writeFile round-trip', async () => {
    const f = new LocalThemeFs();
    const p = path.join(tmp, 'x.txt');
    await f.writeFile(p, 'hello');
    expect(await f.readFile(p)).toBe('hello');
  });

  it('list recursive with extensions filter', async () => {
    const f = new LocalThemeFs();
    await f.writeFile(path.join(tmp, 'a.php'), '');
    await f.writeFile(path.join(tmp, 'b.json'), '');
    await f.writeFile(path.join(tmp, 'c.txt'), '');
    await f.mkdirp(path.join(tmp, 'sub'));
    await f.writeFile(path.join(tmp, 'sub', 'd.php'), '');
    const all = await f.list(tmp, { recursive: true });
    expect(all.length).toBe(4);
    const php = await f.list(tmp, { recursive: true, extensions: ['.php'] });
    expect(php.length).toBe(2);
    expect(php.every((p) => p.endsWith('.php'))).toBe(true);
  });

  it('mkdirp + remove + copyDir', async () => {
    const f = new LocalThemeFs();
    await f.mkdirp(path.join(tmp, 'deep', 'nested'));
    expect(await f.isDirectory(path.join(tmp, 'deep', 'nested'))).toBe(true);
    await f.writeFile(path.join(tmp, 'deep', 'a.txt'), 'x');
    await f.remove(path.join(tmp, 'deep', 'a.txt'));
    expect(await f.exists(path.join(tmp, 'deep', 'a.txt'))).toBe(false);

    // copy a subdir, not tmp into tmp (which would be a subdir of itself)
    const srcSub = path.join(tmp, 'src');
    await nodeFs.mkdir(srcSub);
    await nodeFs.writeFile(path.join(srcSub, 'hello.txt'), 'hi');
    await f.copyDir(srcSub, path.join(tmp, 'copy'));
    expect(await f.readFile(path.join(tmp, 'copy', 'hello.txt'))).toBe('hi');
  });

  it('appendLog creates the parent dir and writes content', async () => {
    const f = new LocalThemeFs();
    await f.appendLog(path.join(tmp, 'missing', 'x', 'dev.log'), 'hello\n');
    expect(await f.readLogTail(path.join(tmp, 'missing', 'x', 'dev.log'), 1_048_576)).toContain(
      'hello',
    );
  });

  it('appendLog rotates when size exceeds the cap (1 MiB)', async () => {
    const f = new LocalThemeFs();
    const p = path.join(tmp, 'rotate.log');
    const big = 'x'.repeat(700_000);
    await f.appendLog(p, big + 'A');
    await f.appendLog(p, big + 'B');
    const size = statSync(p).size;
    expect(size).toBeLessThanOrEqual(1_048_576 + 1_000);
    expect(await f.readLogTail(p, 1_048_576)).toContain('B');
  });

  it('readLogTail returns the last N bytes only', async () => {
    const f = new LocalThemeFs();
    const p = path.join(tmp, 'tail.log');
    await f.appendLog(p, 'first');
    await f.appendLog(p, 'second');
    expect(await f.readLogTail(p, 6)).toBe('second');
    expect(await f.readLogTail(p, 100)).toBe('firstsecond');
  });

  it('readLogTail returns empty string for missing file', async () => {
    const f = new LocalThemeFs();
    expect(await f.readLogTail(path.join(tmp, 'nope.log'), 100)).toBe('');
  });
});

describe('assertWithinRoot', () => {
  it('accepts paths inside the root', () => {
    expect(assertWithinRoot(tmp, path.join(tmp, 'sub', 'file.txt'))).toContain('sub');
  });

  it('rejects paths that escape the root', () => {
    expect(() => assertWithinRoot(tmp, '/etc/passwd')).toThrow(/escapes/);
    expect(() => assertWithinRoot(tmp, path.join(tmp, '..', '..', 'etc', 'passwd'))).toThrow(
      /escapes/,
    );
  });
});
