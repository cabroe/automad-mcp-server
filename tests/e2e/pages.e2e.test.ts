import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Cleanup,
  asRecord,
  e2eEnabled,
  startServer,
  stringField,
  uniqueName,
  type E2eServer,
} from './harness.js';

/**
 * The page lifecycle against a real v2 backend: create → get → update →
 * publish → duplicate → delete, plus the draft path and the trash.
 *
 * These are the paths where v2's contract bit us during implementation
 * (drafts aren't readable, renames happen during publish, `move` is a
 * reparent rather than a rename) — exactly the behaviour a mock cannot prove.
 */
describe.skipIf(!e2eEnabled)('e2e: pages', () => {
  let server: E2eServer;
  const cleanup = new Cleanup();

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await cleanup.run();
    await server?.close();
  });

  it('creates a published page and reads it back', async () => {
    const title = uniqueName('E2E Page');
    const created = asRecord(
      await server.callOk('automad_pages', { action: 'create', title, target_url: '/' }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(server, url);
    expect(url.startsWith('/')).toBe(true);

    const page = asRecord(await server.callOk('automad_pages', { action: 'get', url }));
    expect(JSON.stringify(page)).toContain(title);

    const state = asRecord(
      await server.callOk('automad_pages', { action: 'publication_state', url }),
    );
    expect(state).toBeTruthy();
  });

  it('updates content fields and keeps the page readable', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Update'),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(server, url);

    const body = `content written by the E2E suite at ${new Date().toISOString()}`;
    await server.callOk('automad_pages', { action: 'update', url, fields: { text: body } });

    const page = asRecord(await server.callOk('automad_pages', { action: 'get', url }));
    expect(JSON.stringify(page)).toContain(body);
  });

  it('renames a page through update and returns the new URL', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Rename Before'),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');

    // v2 performs the directory rename during `page/publish`, not during the
    // save — the MCP reports the resulting URL from the save response's slug.
    const renamed = uniqueName('E2E Rename After');
    const updated = asRecord(
      await server.callOk('automad_pages', { action: 'update', url, title: renamed }),
    );
    const newUrl = stringField(updated, 'url');
    cleanup.addPage(server, newUrl);
    cleanup.addPage(server, url); // in case the rename did not take

    const page = asRecord(await server.callOk('automad_pages', { action: 'get', url: newUrl }));
    expect(JSON.stringify(page)).toContain(renamed);
  });

  it('creates a draft that stays unpublished until pages.publish runs', async () => {
    const title = uniqueName('E2E Draft');
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title,
        target_url: '/',
        publish: false,
      }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(server, url);

    // `publish: false` must skip the auto-publish. The draft is editable and
    // readable through the dashboard API (v2 2.0.0-beta.51) — the difference
    // that matters is the publication state, not readability.
    const draft = asRecord(
      await server.callOk('automad_pages', { action: 'publication_state', url }),
    );
    expect(draft['isPublished']).toBe(false);
    expect(JSON.stringify(await server.callOk('automad_pages', { action: 'get', url }))).toContain(
      title,
    );

    await server.callOk('automad_pages', { action: 'publish', url });
    const published = asRecord(
      await server.callOk('automad_pages', { action: 'publication_state', url }),
    );
    expect(published['isPublished']).toBe(true);
  });

  it('duplicates a page', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Duplicate'),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(server, url);

    const duplicate = asRecord(await server.callOk('automad_pages', { action: 'duplicate', url }));
    expect(duplicate).toBeTruthy();

    const list = await server.callOk('automad_pages', { action: 'list' });
    expect(Array.isArray(list)).toBe(true);
  });

  it('lists recently edited pages with the fields the schema promises', async () => {
    const list = await server.callOk('automad_pages', { action: 'recent' });
    expect(Array.isArray(list)).toBe(true);
    const entries = list as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries.slice(0, 5)) {
      expect(typeof entry['url']).toBe('string');
    }
  });

  it('returns a breadcrumb trail for a nested page', async () => {
    const parent = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Parent'),
        target_url: '/',
      }),
    );
    const parentUrl = stringField(parent, 'url');
    const child = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Child'),
        target_url: parentUrl,
      }),
    );
    const childUrl = stringField(child, 'url');
    cleanup.addPage(server, parentUrl); // removing the parent removes the child
    expect(childUrl.startsWith(parentUrl)).toBe(true);

    const trail = await server.callOk('automad_pages', {
      action: 'breadcrumbs',
      url: childUrl,
    });
    expect(JSON.stringify(trail)).toContain(parentUrl);
  });

  it('deletes a page and moves it into the trash', async () => {
    const created = asRecord(
      await server.callOk('automad_pages', {
        action: 'create',
        title: uniqueName('E2E Delete'),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');

    await server.callOk('automad_pages', { action: 'delete', url });

    const afterDelete = await server.call('automad_pages', { action: 'get', url });
    expect(afterDelete.isError).toBe(true);

    const trash = await server.callOk('automad_pages', { action: 'trash_list' });
    expect(trash).toBeTruthy();
  });
});
