import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readThemesList, readThemeSchema } from '../../src/resources/themes.js';

let root: string;
let themes: string;
let starter: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-resources-'));
  themes = path.join(root, 'themes');
  await fs.mkdir(themes);
  starter = path.join(themes, 'starter');
  await fs.mkdir(starter);
  await fs.writeFile(
    path.join(starter, 'theme.json'),
    JSON.stringify({ name: 'Starter', version: '0.1.0', author: 'Marc' }),
  );
  await fs.writeFile(path.join(starter, 'default.php'), '@{ textMain }');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('theme resources', () => {
  it('returns empty themes list when themesPath is unset', async () => {
    await expect(readThemesList({})).resolves.toEqual({ themesPath: null, themes: [] });
  });

  it('returns discovered themes with manifest metadata', async () => {
    await fs.mkdir(path.join(themes, 'alpha'));
    await fs.writeFile(
      path.join(themes, 'alpha', 'theme.json'),
      JSON.stringify({ name: 'Alpha', version: '2.0.0', author: 'Ada' }),
    );
    await fs.mkdir(path.join(themes, 'beta'));
    await fs.writeFile(path.join(themes, 'beta', 'theme.json'), JSON.stringify({ name: 'Beta' }));

    const result = await readThemesList({ themesPath: themes });
    expect(result.themesPath).toBe(themes);
    expect(result.themes.map((entry) => entry.slug).sort()).toEqual(['alpha', 'beta', 'starter']);
    expect(result.themes.find((entry) => entry.slug === 'alpha')?.manifest).toEqual({
      name: 'Alpha',
      version: '2.0.0',
      author: 'Ada',
    });
    expect(result.themes.find((entry) => entry.slug === 'beta')?.manifest.author).toBe('');
  });

  it('returns theme schema for a known theme', async () => {
    const result = await readThemeSchema({ themesPath: themes }, 'starter');
    expect(result).toMatchObject({
      theme: 'starter',
      fields: expect.any(Array),
      warnings: expect.any(Array),
    });
  });

  it('rejects invalid slugs and missing themes with NOT_FOUND', async () => {
    await expect(readThemeSchema({ themesPath: themes }, '../escape')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(readThemeSchema({ themesPath: themes }, 'with/slash')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(readThemeSchema({ themesPath: themes }, '')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(readThemeSchema({ themesPath: themes }, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects schema requests when themesPath is unset', async () => {
    await expect(readThemeSchema({}, 'starter')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
