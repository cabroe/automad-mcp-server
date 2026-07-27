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
 * The write guard against a live backend: what each mode actually lets through.
 *
 * The point of doing this end-to-end rather than in a unit test is that the
 * guard decision and the HTTP call are wired through the real binding layer —
 * a permit that says "pending" must mean *nothing reached Automad*, which only
 * a real backend can confirm.
 */
describe.skipIf(!e2eEnabled)('e2e: write modes', () => {
  /** Creates and later removes fixtures, regardless of the mode under test. */
  let admin: E2eServer;
  const cleanup = new Cleanup();

  beforeAll(async () => {
    admin = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await cleanup.run();
    await admin?.close();
  });

  async function createPage(label: string): Promise<string> {
    const created = asRecord(
      await admin.callOk('automad_pages', {
        action: 'create',
        title: uniqueName(label),
        target_url: '/',
      }),
    );
    const url = stringField(created, 'url');
    cleanup.addPage(admin, url);
    return url;
  }

  describe('read-only', () => {
    let server: E2eServer;

    beforeAll(async () => {
      server = await startServer({ writeMode: 'read-only' });
    });
    afterAll(async () => {
      await server?.close();
    });

    it('allows reads', async () => {
      const health = asRecord(await server.callOk('automad_site', { action: 'health' }));
      expect(health['ok']).toBe(true);
      expect(Array.isArray(await server.callOk('automad_pages', { action: 'list' }))).toBe(true);
    });

    it('refuses an ordinary write with FORBIDDEN', async () => {
      const result = await server.call('automad_pages', {
        action: 'create',
        title: uniqueName('E2E ReadOnly'),
        target_url: '/',
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('FORBIDDEN');
      expect(result.text).toContain('read-only');
    });

    it('refuses a destructive write with FORBIDDEN and leaves the page alone', async () => {
      const url = await createPage('E2E ReadOnly Target');
      const result = await server.call('automad_pages', { action: 'delete', url });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('FORBIDDEN');

      // The page must still be there — the guard ran before any HTTP call.
      const stillThere = await admin.call('automad_pages', { action: 'get', url });
      expect(stillThere.isError).toBe(false);
    });
  });

  describe('confirm-destructive (default)', () => {
    let server: E2eServer;

    beforeAll(async () => {
      server = await startServer({ writeMode: 'confirm-destructive' });
    });
    afterAll(async () => {
      await server?.close();
    });

    it('runs an ordinary write directly', async () => {
      const created = asRecord(
        await server.callOk('automad_pages', {
          action: 'create',
          title: uniqueName('E2E Confirm Create'),
          target_url: '/',
        }),
      );
      const url = stringField(created, 'url');
      cleanup.addPage(admin, url);
      expect((await admin.call('automad_pages', { action: 'get', url })).isError).toBe(false);
    });

    it('returns a confirm token for a delete and executes it on replay', async () => {
      const url = await createPage('E2E Confirm Delete');

      const permit = asRecord(await server.callOk('automad_pages', { action: 'delete', url }));
      expect(permit['allowed']).toBe('pending');
      expect(permit['action']).toBe('pages.delete');
      expect(permit['target']).toBe(url);
      const token = stringField(permit, 'confirmToken');

      // Nothing must have happened yet.
      expect((await admin.call('automad_pages', { action: 'get', url })).isError).toBe(false);

      await server.callOk('automad_pages', { action: 'delete', url, confirm_token: token });
      expect((await admin.call('automad_pages', { action: 'get', url })).isError).toBe(true);
    });

    it('binds a token to its target: replaying it elsewhere is refused', async () => {
      const victim = await createPage('E2E Token Victim');
      const other = await createPage('E2E Token Other');

      const permit = asRecord(
        await server.callOk('automad_pages', { action: 'delete', url: victim }),
      );
      const token = stringField(permit, 'confirmToken');

      const misuse = await server.call('automad_pages', {
        action: 'delete',
        url: other,
        confirm_token: token,
      });
      expect(misuse.isError).toBe(true);
      expect(misuse.text).toContain('different action or target');
      expect((await admin.call('automad_pages', { action: 'get', url: other })).isError).toBe(false);
    });

    it('rejects an unknown token', async () => {
      const url = await createPage('E2E Unknown Token');
      const result = await server.call('automad_pages', {
        action: 'delete',
        url,
        confirm_token: '00000000-0000-4000-8000-000000000000',
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('unknown token');
    });

    it('treats a title change inside update as a rename needing confirmation', async () => {
      const url = await createPage('E2E Rename Guard');

      const permit = asRecord(
        await server.callOk('automad_pages', {
          action: 'update',
          url,
          title: uniqueName('E2E Renamed'),
        }),
      );
      expect(permit['allowed']).toBe('pending');
      expect(permit['action']).toBe('pages.update_rename');

      // A field-only update on the same page is an ordinary write and runs.
      await server.callOk('automad_pages', { action: 'update', url, fields: { text: 'plain' } });
    });

    it('requires confirmation for a site-wide search *and* replace only', async () => {
      const readOnlySearch = await server.call('automad_site', { action: 'search', query: 'zzz' });
      expect(readOnlySearch.isError).toBe(false);

      const replace = asRecord(
        await server.callOk('automad_site', {
          action: 'search',
          query: 'zzz-nonexistent',
          replace: 'yyy',
        }),
      );
      expect(replace['allowed']).toBe('pending');
      expect(replace['action']).toBe('site.search_replace');
    });

    it('isolates confirm tokens between server processes', async () => {
      const url = await createPage('E2E Token Isolation');
      const permit = asRecord(await server.callOk('automad_pages', { action: 'delete', url }));
      const token = stringField(permit, 'confirmToken');

      const otherClient = await startServer({ writeMode: 'confirm-destructive' });
      try {
        const replay = await otherClient.call('automad_pages', {
          action: 'delete',
          url,
          confirm_token: token,
        });
        expect(replay.isError).toBe(true);
        expect(replay.text).toContain('unknown token');
      } finally {
        await otherClient.close();
      }
    });
  });

  describe('unrestricted', () => {
    it('deletes without any confirmation round-trip', async () => {
      const url = await createPage('E2E Unrestricted');
      const result = await admin.call('automad_pages', { action: 'delete', url });
      expect(result.isError).toBe(false);
      expect(result.text).not.toContain('pending');
      expect((await admin.call('automad_pages', { action: 'get', url })).isError).toBe(true);
    });
  });
});
