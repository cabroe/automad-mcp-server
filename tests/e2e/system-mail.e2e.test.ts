import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asRecord, e2eEnabled, startServer, type E2eServer } from './harness.js';

/**
 * Instance-level maintenance: update check, mail configuration, cache purge.
 *
 * `system.update` is deliberately not exercised — it replaces the running
 * Automad installation, which would make every later assertion in the run a
 * statement about a different version.
 */
describe.skipIf(!e2eEnabled)('e2e: system, mail and cache', () => {
  let server: E2eServer;

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted' });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('checks for an Automad update', async () => {
    const result = asRecord(await server.callOk('automad_system', { action: 'check_for_update' }));
    expect(typeof result['latest']).toBe('string');
    expect(typeof result['pending']).toBe('boolean');
  });

  it('saves and resets the mail configuration', async () => {
    await server.callOk('automad_mail', {
      action: 'save',
      transport: 'sendmail',
      from: 'e2e@example.invalid',
    });
    await server.callOk('automad_mail', { action: 'reset' });
  });

  it('reports a failing test mail instead of pretending it was sent', async () => {
    // The container has no working MTA, so this must surface as an error —
    // a silent success would be the dangerous outcome.
    const result = await server.call('automad_mail', {
      action: 'test',
      to: 'nobody@example.invalid',
    });
    expect(result.isError).toBe(true);
  });

  it('purges the cache directory', async () => {
    expect((await server.call('automad_config', { action: 'cache_purge' })).isError).toBe(false);
  });
});
