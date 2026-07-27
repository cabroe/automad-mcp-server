import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Cleanup, asRecord, e2eEnabled, startServer, stringField, uniqueName, type E2eServer } from './harness.js';

/**
 * Site-wide component fields.
 *
 * `data` is the reason this file exists: v2's `component/data` saves whatever
 * `components` array it receives and only reads when given none, so the "read"
 * action used to wipe the component store — in every write mode, because the
 * guard was told it was read-only.
 */
describe.skipIf(!e2eEnabled)('e2e: components', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();
  let pageUrl = '';

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Components'),
        target_url: '/',
      }),
    );
    pageUrl = stringField(created, 'url');
    cleanup.addPage(server, pageUrl);
  });

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  it('reads the component store without changing it', async () => {
    const before = asRecord(await server.callOk('automad_components', { action: 'data' }));
    expect(before).toHaveProperty('components');
    const after = asRecord(await server.callOk('automad_components', { action: 'data' }));
    // Reading twice must be a no-op. It was not: the first call emptied the
    // store, so the second returned something different.
    expect(after['components']).toEqual(before['components']);
  });

  it('leaves the store intact even in read-only mode', async () => {
    const readOnly = await startServer({ writeMode: 'read-only' });
    try {
      const before = asRecord(await server.callOk('automad_components', { action: 'data' }));
      await readOnly.callOk('automad_components', { action: 'data' });
      const after = asRecord(await server.callOk('automad_components', { action: 'data' }));
      expect(after['components']).toEqual(before['components']);
    } finally {
      await readOnly.close();
    }
  });

  it('reports the component publication state for a page', async () => {
    const state = asRecord(
      await server.callOk('automad_components', { action: 'publication_state', url: pageUrl }),
    );
    expect(typeof state['isPublished']).toBe('boolean');
  });

  it('publishes and discards component drafts', async () => {
    expect((await server.call('automad_components', { action: 'publish', url: pageUrl })).isError).toBe(false);
    expect(
      (await server.call('automad_components', { action: 'discard_draft', url: pageUrl })).isError,
    ).toBe(false);
  });
});
