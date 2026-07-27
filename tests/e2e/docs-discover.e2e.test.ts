import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asRecord, e2eEnabled, startServer, type E2eServer } from './harness.js';
import { TOOL_NAMES, advertisedActions } from '../../src/capabilities/registry.js';

/**
 * The two tools that need no instance. They are covered here anyway because
 * they ship in the same process as everything else: a registry change that
 * breaks discovery would otherwise only surface in unit tests.
 */
describe.skipIf(!e2eEnabled)('e2e: docs and discovery', () => {
  let server: E2eServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('lists and reads knowledge-base pages', async () => {
    const index = asRecord(await server.callOk('automad_docs', { action: 'list' }));
    const pages = index['pages'] as Array<Record<string, unknown>>;
    expect(pages.length).toBeGreaterThan(0);

    const slug = String(pages[0]?.['slug']);
    const page = asRecord(await server.callOk('automad_docs', { action: 'get', slug }));
    expect(page['slug']).toBe(slug);
    expect(String(page['body']).length).toBeGreaterThan(0);
  });

  it('searches the knowledge base', async () => {
    const found = asRecord(await server.callOk('automad_docs', { action: 'search', query: 'foreach' }));
    const results = found['results'] as unknown[];
    expect(results.length).toBeGreaterThan(0);
  });

  it('reports an unknown doc slug as NOT_FOUND', async () => {
    const result = await server.call('automad_docs', { action: 'get', slug: 'does-not-exist' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('NOT_FOUND');
  });

  it('advertises every registered tool through discover.list', async () => {
    const listed = asRecord(await server.callOk('automad_discover', { action: 'list' }));
    const tools = new Set(
      (listed['capabilities'] as Array<Record<string, unknown>>).map((entry) => String(entry['tool'])),
    );
    expect([...tools].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('describes a tool with exactly its advertised actions', async () => {
    const described = asRecord(
      await server.callOk('automad_discover', { action: 'describe', tool: 'automad_pages' }),
    );
    expect(Object.keys(asRecord(described['actions'])).sort()).toEqual(
      [...advertisedActions('automad_pages')].sort(),
    );
  });
});
