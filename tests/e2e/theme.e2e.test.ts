import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  asRecord,
  e2eEnabled,
  makeTempThemesDir,
  startServer,
  uniqueName,
  type E2eServer,
} from './harness.js';

/**
 * Theme tooling. Unlike the other suites this one is filesystem-bound: the
 * server gets a throwaway themes directory, scaffolds into it from the bundled
 * starter kit, and analyses the result.
 *
 * `theme.build` is not exercised here — it shells out to npm/Composer and
 * needs network access, which would make the suite flaky for no extra
 * confidence in the MCP layer.
 */
describe.skipIf(!e2eEnabled)('e2e: theme tooling', () => {
  let server: E2eServer;
  const themes = makeTempThemesDir();
  const themeName = uniqueName('E2E Theme');
  let slug = '';

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted', themesPath: themes.path });
  });

  afterAll(async () => {
    await server?.close();
    themes.dispose();
  });

  it('starts with an empty themes directory', async () => {
    const list = await server.callOk('automad_theme', { action: 'list' });
    expect(Array.isArray(list) ? list : asRecord(list)['themes']).toEqual([]);
  });

  it('scaffolds a theme from the bundled starter kit', async () => {
    const scaffolded = asRecord(
      await server.callOk('automad_theme', {
        action: 'scaffold',
        name: themeName,
        author: 'E2E Suite',
      }),
    );
    // `scaffold` reports the absolute target path; its basename is the slug
    // every other theme action addresses the theme by.
    const target = String(scaffolded['path']);
    slug = target.slice(target.lastIndexOf('/') + 1);
    expect(slug).not.toBe('');
    expect(scaffolded['files']).toBeGreaterThan(0);

    const list = await server.callOk('automad_theme', { action: 'list' });
    expect(JSON.stringify(list)).toContain(slug);
  });

  it('lists and reads files inside the scaffolded theme', async () => {
    const files = await server.callOk('automad_theme', { action: 'files', theme: slug });
    expect(JSON.stringify(files)).toContain('theme.json');

    const manifest = asRecord(
      await server.callOk('automad_theme', {
        action: 'read',
        theme: slug,
        path: 'theme.json',
      }),
    );
    const parsed = asRecord(JSON.parse(String(manifest['content'])));
    expect(parsed['name']).toBeTruthy();
  });

  it('analyzes, validates and derives a schema for the theme', async () => {
    const analysis = asRecord(await server.callOk('automad_theme', { action: 'analyze', theme: slug }));
    expect(analysis).toBeTruthy();

    const validation = asRecord(
      await server.callOk('automad_theme', { action: 'validate', theme: slug }),
    );
    expect(typeof validation['ok']).toBe('boolean');
    expect(Array.isArray(validation['findings'])).toBe(true);
    expect(validation).toHaveProperty('summary');

    const schema = asRecord(await server.callOk('automad_theme', { action: 'schema', theme: slug }));
    expect(schema).toBeTruthy();
  });

  it('previews a write as a diff, then applies it', async () => {
    const path = 'e2e-snippet.php';
    const content = '<?php // written by the E2E suite\n';

    const diff = asRecord(
      await server.callOk('automad_theme', { action: 'diff', theme: slug, path, content }),
    );
    expect(JSON.stringify(diff)).toContain('e2e-snippet.php');

    await server.callOk('automad_theme', { action: 'write', theme: slug, path, content });
    const readBack = asRecord(
      await server.callOk('automad_theme', { action: 'read', theme: slug, path }),
    );
    expect(readBack['content']).toBe(content);
  });

  it('generates snippet content without touching the filesystem', async () => {
    const generated = asRecord(
      await server.callOk('automad_theme', { action: 'generate', kind: 'nav' }),
    );
    expect(JSON.stringify(generated).length).toBeGreaterThan(0);
  });

  it('refuses to escape the themes directory', async () => {
    const result = await server.call('automad_theme', {
      action: 'read',
      theme: '../../etc',
      path: 'passwd',
    });
    expect(result.isError).toBe(true);
  });

  it('reports the theme through the MCP resource as well', async () => {
    const read = await server.mcp.readResource({ uri: 'automad://themes' });
    expect(String(read.contents[0]?.text)).toContain(slug);
  });
});
