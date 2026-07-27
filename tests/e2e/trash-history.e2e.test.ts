import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Cleanup, asRecord, e2eEnabled, startServer, stringField, uniqueName, type E2eServer } from './harness.js';

/** The `path` v2 reports for a trashed page, e.g. `/.trash/my-page`. */
function trashPathFor(listing: unknown, title: string): string | undefined {
  if (!Array.isArray(listing)) return undefined;
  for (const entry of listing) {
    const record = entry as Record<string, unknown>;
    if (record['title'] === title && typeof record['path'] === 'string') return record['path'];
  }
  return undefined;
}

/**
 * Trash and history — the recovery paths.
 *
 * Both trash writes address a page by its *trash path*, and both used to be
 * sent a page URL instead. v2 answers 200 either way (`permanently_delete`
 * returns early, `restore` moves an empty path), so mocks could never have
 * caught it: only a real backend shows that nothing happened.
 */
describe.skipIf(!e2eEnabled)('e2e: trash and history', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  async function createPage(label: string): Promise<{ url: string; title: string }> {
    const title = uniqueName(label);
    const created = asRecord(
      await server.callOk('automad_pages', { action: 'create', title, target_url: '/' }),
    );
    return { url: stringField(created, 'url'), title };
  }

  it('restores a deleted page from the trash', async () => {
    const { url, title } = await createPage('E2E Trash Restore');
    await server.callOk('automad_pages', { action: 'delete', url });
    expect((await server.call('automad_pages', { action: 'get', url })).isError).toBe(true);

    const listing = await server.callOk('automad_pages', { action: 'trash_list' });
    const path = trashPathFor(listing, title);
    expect(path, `no trash entry for "${title}"`).toBeTruthy();

    await server.callOk('automad_pages', { action: 'trash_restore', url: path! });
    // Restored pages land at the top level under their old slug.
    const restored = await server.call('automad_pages', { action: 'get', url });
    expect(restored.isError).toBe(false);
    cleanup.addPage(server, url);
  });

  it('refuses a former page URL where a trash path is required', async () => {
    // The mistake this guards against is silent on v2's side: it answers 200
    // and does nothing at all.
    const result = await server.call('automad_pages', {
      action: 'trash_restore',
      url: '/some-page-that-was-deleted',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('trash path');
  });

  it('permanently deletes a single trashed page', async () => {
    const { url, title } = await createPage('E2E Trash Purge');
    await server.callOk('automad_pages', { action: 'delete', url });

    const path = trashPathFor(
      await server.callOk('automad_pages', { action: 'trash_list' }),
      title,
    );
    expect(path).toBeTruthy();

    await server.callOk('automad_pages', { action: 'trash_permanently_delete', url: path! });
    const after = await server.callOk('automad_pages', { action: 'trash_list' });
    expect(trashPathFor(after, title)).toBeUndefined();
  });

  it('empties the trash', async () => {
    const { url } = await createPage('E2E Trash Clear');
    await server.callOk('automad_pages', { action: 'delete', url });
    expect((await server.callOk('automad_pages', { action: 'trash_list' })) as unknown[]).not.toHaveLength(0);

    await server.callOk('automad_pages', { action: 'trash_clear' });
    expect(await server.callOk('automad_pages', { action: 'trash_list' })).toEqual([]);
  });

  it('records history entries and restores an earlier revision', async () => {
    const { url } = await createPage('E2E History');
    cleanup.addPage(server, url);

    await server.callOk('automad_pages', { action: 'update', url, fields: { intro: 'erste Fassung' } });
    await server.callOk('automad_pages', { action: 'update', url, fields: { intro: 'zweite Fassung' } });

    const history = await server.callOk('automad_pages', { action: 'history', url });
    expect(Array.isArray(history)).toBe(true);
    const entries = history as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    const logId = entries[0]?.['hash'];
    expect(typeof logId).toBe('string');

    await server.callOk('automad_pages', {
      action: 'history_restore',
      url,
      history_id: String(logId),
    });
    const page = asRecord(await server.callOk('automad_pages', { action: 'get', url }));
    expect(JSON.stringify(page)).toContain('Fassung');
  });

  it('discards a draft', async () => {
    const { url } = await createPage('E2E Discard');
    cleanup.addPage(server, url);
    await server.callOk('automad_pages', {
      action: 'update',
      url,
      fields: { intro: 'nur ein Entwurf' },
      publish: false,
    });
    const discarded = await server.call('automad_pages', { action: 'discard_draft', url });
    expect(discarded.isError).toBe(false);
  });
});
