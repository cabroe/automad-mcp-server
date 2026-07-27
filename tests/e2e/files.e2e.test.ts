import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Cleanup,
  TINY_PNG_BASE64,
  asRecord,
  e2eEnabled,
  startServer,
  stringField,
  uniqueName,
  type E2eServer,
} from './harness.js';

function fileNames(listing: unknown): string[] {
  const files = asRecord(listing)['files'];
  if (!Array.isArray(files)) return [];
  return files
    .map((entry) => (entry as Record<string, unknown>)['basename'])
    .filter((name): name is string => typeof name === 'string');
}

/** Image variants and file metadata. */
describe.skipIf(!e2eEnabled)('e2e: images and file metadata', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  it('lists rendered image variants', async () => {
    const listing = asRecord(await server.callOk('automad_image', { action: 'list' }));
    expect(Array.isArray(listing['images'])).toBe(true);
  });

  it('saves an image into the shared directory', async () => {
    const name = `e2e-img-${Date.now().toString(36)}`;
    const result = await server.call('automad_image', {
      action: 'save',
      name,
      extension: 'png',
      imageBase64: TINY_PNG_BASE64,
    });
    expect(result.isError).toBe(false);
    cleanup.add(`delete image ${name}`, () =>
      server.call('automad_media', { action: 'delete', url: '/', filename: `${name}.png` }),
    );
  });

  it('renames a file and sets its caption', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E File Meta'),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(server, url);

    await server.callOk('automad_media', {
      action: 'upload',
      url,
      source: { base64: TINY_PNG_BASE64, filename: 'vorher.png', mimeType: 'image/png' },
    });

    // Without `url` v2 resolves the file against the wrong directory and fails
    // with a misleading "Permissions denied" — this call could never succeed.
    await server.callOk('automad_file_meta', {
      action: 'edit_info',
      url,
      old_name: 'vorher.png',
      new_name: 'nachher',
      caption: 'Bildunterschrift',
    });

    const names = fileNames(await server.callOk('automad_media', { action: 'list', url }));
    expect(names).toContain('nachher.png');
    expect(names).not.toContain('vorher.png');
  });

  it('refuses to edit metadata without both names', async () => {
    const result = await server.call('automad_file_meta', {
      action: 'edit_info',
      old_name: 'only-old.png',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('VALIDATION');
  });
});
