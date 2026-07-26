import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as nodeFs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalThemeFs } from '../../src/theme/fs.js';
import { scaffold, themeSlug } from '../../src/theme/scaffold.js';

let root: string;
let themes: string;
let starter: string;

beforeEach(async () => {
  root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'mcp-scaffold-'));
  themes = path.join(root, 'themes');
  starter = path.join(root, 'starter');
  await nodeFs.mkdir(themes);
  await nodeFs.mkdir(starter);
  await nodeFs.writeFile(
    path.join(starter, 'theme.json'),
    JSON.stringify({
      name: 'Starter Kit',
      description: 'starter desc',
      author: 'Marc',
      license: 'MIT',
      version: '0.1.0',
      masks: { page: [], shared: ['+main'] },
    }),
  );
  await nodeFs.writeFile(
    path.join(starter, 'package.json'),
    JSON.stringify({
      name: 'automad-theme-starter-kit',
      description: 'starter desc',
      scripts: { build: 'node esbuild.js' },
    }),
  );
  await nodeFs.writeFile(path.join(starter, 'pagelist.php'), '<@ foreach @>');
  await nodeFs.mkdir(path.join(starter, 'blocks'), { recursive: true });
  await nodeFs.writeFile(path.join(starter, 'blocks', 'grid.php'), '<?php');
  await nodeFs.mkdir(path.join(starter, 'components'), { recursive: true });
  await nodeFs.writeFile(path.join(starter, 'components', 'card.php'), '<?php');
  await nodeFs.mkdir(path.join(starter, 'client'), { recursive: true });
  await nodeFs.writeFile(path.join(starter, 'client', 'index.ts'), 'export {};');
  await nodeFs.writeFile(path.join(starter, 'esbuild.js'), '// build');
  await nodeFs.writeFile(path.join(starter, 'default.php'), '<@ components/page.php @>');
  await nodeFs.mkdir(path.join(starter, 'bin'), { recursive: true });
  await nodeFs.writeFile(path.join(starter, 'bin', 'dev.sh'), '#!/bin/bash');
  await nodeFs.writeFile(path.join(starter, 'bin', 'server.sh'), '#!/bin/bash');
});
afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

describe('themeSlug', () => {
  it('normalises to lowercase kebab', () => {
    expect(themeSlug('My Cool Theme')).toBe('my-cool-theme');
    expect(themeSlug('  spaces  ')).toBe('spaces');
    expect(themeSlug('UPPER_case-mix')).toBe('upper_case-mix');
    expect(themeSlug('')).toBe('new-theme');
  });
});

describe('scaffold', () => {
  it('copies starter kit, rewrites theme.json and package.json', async () => {
    const fs = new LocalThemeFs();
    const out = await scaffold(
      { name: 'My Theme', description: 'my desc', author: 'me', version: '1.0.0' },
      { fs, themesPath: themes, starterKitPath: starter },
    );
    expect(out.name).toBe('My Theme');
    expect(out.path).toBe(path.join(themes, 'my-theme'));
    expect(out.files).toBeGreaterThan(0);
    expect(out.manifest.name).toBe('My Theme');
    expect(out.manifest.description).toBe('my desc');
    expect(out.manifest.author).toBe('me');
    expect(out.manifest.version).toBe('1.0.0');
    // starter files copied
    expect(await fs.exists(path.join(out.path, 'pagelist.php'))).toBe(true);
    expect(await fs.exists(path.join(out.path, 'blocks', 'grid.php'))).toBe(true);
    // package.json name rewritten to slug
    const pkg = JSON.parse(await fs.readFile(path.join(out.path, 'package.json'))) as Record<
      string,
      unknown
    >;
    expect(pkg['name']).toBe('my-theme');
    expect(pkg['description']).toBe('my desc');
  });
  it('enforces the canonical build tooling in package.json', async () => {
    const fs = new LocalThemeFs();
    const out = await scaffold(
      { name: 'Kit Theme' },
      { fs, themesPath: themes, starterKitPath: starter },
    );
    const pkg = JSON.parse(await fs.readFile(path.join(out.path, 'package.json'))) as Record<
      string,
      unknown
    >;
    expect(pkg['type']).toBe('module');
    expect((pkg['scripts'] as Record<string, string>).build).toBe('node esbuild.js');
    expect((pkg['scripts'] as Record<string, string>).dev).toBe('bash bin/dev.sh');
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['esbuild']).toBeTruthy();
    expect(devDeps['typescript']).toBeTruthy();
    expect(devDeps['automad-theme-ui-kit']).toBeTruthy();
    expect(pkg['prettier']).toEqual({ trailingComma: 'es5' });
  });

  it('rejects when theme already exists', async () => {
    const fs = new LocalThemeFs();
    await nodeFs.mkdir(path.join(themes, 'my-theme'));
    await expect(
      scaffold({ name: 'My Theme' }, { fs, themesPath: themes, starterKitPath: starter }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects when starter kit is missing theme.json', async () => {
    const fs = new LocalThemeFs();
    const emptyStarter = path.join(root, 'empty');
    await nodeFs.mkdir(emptyStarter);
    await expect(
      scaffold({ name: 'x' }, { fs, themesPath: themes, starterKitPath: emptyStarter }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects when starter kit is missing required layout entries (drift)', async () => {
    const fs = new LocalThemeFs();
    const driftStarter = path.join(root, 'drift');
    await nodeFs.mkdir(driftStarter);
    // Provide theme.json + some files but omit components/ (a required entry).
    await nodeFs.writeFile(
      path.join(driftStarter, 'theme.json'),
      JSON.stringify({ name: 'Drift' }),
    );
    await nodeFs.writeFile(
      path.join(driftStarter, 'package.json'),
      JSON.stringify({ name: 'drift' }),
    );
    await nodeFs.mkdir(path.join(driftStarter, 'blocks'), { recursive: true });
    await nodeFs.mkdir(path.join(driftStarter, 'client'), { recursive: true });
    await nodeFs.writeFile(path.join(driftStarter, 'client', 'index.ts'), '');
    await nodeFs.writeFile(path.join(driftStarter, 'esbuild.js'), '');

    const copyDirSpy = vi.spyOn(fs, 'copyDir');
    await expect(
      scaffold({ name: 'Drift' }, { fs, themesPath: themes, starterKitPath: driftStarter }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(copyDirSpy).not.toHaveBeenCalled();
    expect(await fs.exists(path.join(themes, 'drift'))).toBe(false);
  });
});
