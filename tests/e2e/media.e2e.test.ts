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

/**
 * An asset every Automad install serves, addressed the way the *Automad host*
 * sees itself — `import` is fetched server-side, so a host-side port mapping
 * would be the wrong address.
 */
const SELF_HOSTED_ASSET = 'http://localhost/automad/dist/build/admin/index.js';

/** Names of the files v2 reports for a directory listing. */
function fileNames(listing: unknown): string[] {
  const record = asRecord(listing);
  const files = record['files'];
  if (!Array.isArray(files)) return [];
  return files
    .map((entry) => (typeof entry === 'object' && entry !== null ? entry : {}))
    .map((entry) => (entry as Record<string, unknown>)['basename'])
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Media round-trip against the real Dropzone-style upload endpoint — the one
 * v2 wire format the MCP builds by hand (multipart with `url` instead of
 * `__json__`, single chunk). Mocks cannot prove that contract holds.
 */
describe.skipIf(!e2eEnabled)('e2e: media', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  it('lists the site-wide media directory', async () => {
    const listing = asRecord(await server.callOk('automad_media', { action: 'list' }));
    expect(listing).toHaveProperty('files');
  });

  it('uploads a file to a page, lists it, and deletes it again', async () => {
    // Uploads target a page directory, so the test owns one for the round-trip.
    const page = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Media'),
        target_url: '/',
      }),
    );
    const url = stringField(page, 'url');
    cleanup.addPage(server, url);

    const filename = `e2e-${Date.now().toString(36)}.png`;
    await server.callOk('automad_media', {
      action: 'upload',
      url,
      source: { base64: TINY_PNG_BASE64, filename, mimeType: 'image/png' },
    });
    cleanup.add(`delete media ${filename}`, () =>
      server.call('automad_media', { action: 'delete', url, filename }),
    );

    const listing = await server.callOk('automad_media', { action: 'list', url });
    expect(fileNames(listing)).toContain(filename);

    await server.callOk('automad_media', { action: 'delete', url, filename });
    const afterDelete = await server.callOk('automad_media', { action: 'list', url });
    expect(fileNames(afterDelete)).not.toContain(filename);
  });

  it('imports a file from a URL the Automad host can reach', async () => {
    const page = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Import'),
        target_url: '/',
      }),
    );
    const url = stringField(page, 'url');
    cleanup.addPage(server, url);

    // Sourced from the instance itself (`localhost` from *Automad's* point of
    // view), so the test needs no outbound network and no fixture host.
    const result = asRecord(
      await server.callOk('automad_media', {
        action: 'import',
        url,
        import_url: SELF_HOSTED_ASSET,
      }),
    );
    expect(result['ok']).toBe(true);

    // The stored name is Automad's business — it sanitizes without decoding —
    // so the check is that *something* arrived, read back through `list`.
    const listing = await server.callOk('automad_media', { action: 'list', url });
    expect(fileNames(listing).length).toBeGreaterThan(0);
  });

  it('reports an unreachable source as NETWORK, not as a generic failure', async () => {
    const result = await server.call('automad_media', {
      action: 'import',
      import_url: 'http://127.0.0.1:1/nothing.png',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('NETWORK');
  });

  it('reports a file type Automad refuses as VALIDATION', async () => {
    // No extension at all — Automad answers "Unsupported file type".
    const result = await server.call('automad_media', {
      action: 'import',
      import_url: 'http://localhost/',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('VALIDATION');
  });

  it('rejects a filename with path separators before touching the backend', async () => {
    const result = await server.call('automad_media', {
      action: 'delete',
      url: '/',
      filename: '../escape.png',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('VALIDATION');
  });
});
