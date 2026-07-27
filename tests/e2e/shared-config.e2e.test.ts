import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asRecord, e2eEnabled, startServer, uniqueName, type E2eServer } from './harness.js';

/**
 * Site-wide data and runtime configuration.
 *
 * v2's `shared/data` write is a full overwrite and splits the stored record
 * into `fields` (declared by the active theme) and `unused` (everything else),
 * so every test here restores what it found.
 */
describe.skipIf(!e2eEnabled)('e2e: shared data and config', () => {
  let server: E2eServer;
  let original: Record<string, unknown> = {};

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
    const shared = asRecord(await server.callOk('automad_shared', { action: 'get' }));
    original = asRecord(shared['fields']);
  });

  afterAll(async () => {
    if (Object.keys(original).length > 0) {
      await server.call('automad_shared', { action: 'set', fields: original });
    }
    await server?.close();
  });

  it('reads shared data split into declared fields and unused values', async () => {
    const shared = asRecord(await server.callOk('automad_shared', { action: 'get' }));
    expect(shared).toHaveProperty('fields');
    expect(shared).toHaveProperty('unused');
    expect(typeof asRecord(shared['fields'])['sitename']).toBe('string');
  });

  it('writes a declared field and reads it back', async () => {
    const sitename = uniqueName('E2E Site');
    await server.callOk('automad_shared', {
      action: 'set',
      fields: { ...original, sitename },
    });
    const after = asRecord(await server.callOk('automad_shared', { action: 'get' }));
    expect(asRecord(after['fields'])['sitename']).toBe(sitename);
  });

  it('keeps custom keys, filed under `unused` by v2', async () => {
    const marker = uniqueName('marker');
    await server.callOk('automad_shared', {
      action: 'set',
      fields: { ...original, mcpE2eMarker: marker },
    });
    const after = asRecord(await server.callOk('automad_shared', { action: 'get' }));
    // The active theme does not declare `mcpE2eMarker`, so v2 stores it but
    // reports it under `unused` rather than `fields`.
    expect(asRecord(after['unused'])['mcpE2eMarker']).toBe(marker);
  });

  it('rejects an empty shared write with VALIDATION', async () => {
    const result = await server.call('automad_shared', { action: 'set', fields: {} });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('VALIDATION');
  });

  it('reads runtime config from the bootstrap endpoint', async () => {
    const config = asRecord(await server.callOk('automad_config', { action: 'get' }));
    expect(typeof config['version']).toBe('string');
    expect(config).toHaveProperty('envKeys');
    expect(config).toHaveProperty('dashboard');
  });

  it('updates a typed config value', async () => {
    try {
      await server.callOk('automad_config', {
        action: 'set',
        type: 'debug',
        payload: { debug: true },
      });
    } finally {
      await server.call('automad_config', {
        action: 'set',
        type: 'debug',
        payload: { debug: false },
      });
    }
  });

  it('rejects a config set without a payload', async () => {
    const result = await server.call('automad_config', { action: 'set', type: 'debug' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('VALIDATION');
  });

  it('clears the page cache', async () => {
    const result = await server.callOk('automad_config', { action: 'cache_clear' });
    expect(result).toBeTruthy();
  });

  it('runs a site-wide search without replacing anything', async () => {
    const found = await server.callOk('automad_site', { action: 'search', query: 'the' });
    expect(found).toBeTruthy();
  });
});
