import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TOOL_NAMES } from '../../src/capabilities/registry.js';
import { asRecord, e2eEnabled, startServer, uniqueName, type E2eServer } from './harness.js';

/**
 * Login, CSRF handling, and the advertised surface — checked against a real
 * Automad v2 instance.
 *
 * The tool list is asserted against the capability registry rather than a
 * hard-coded array: the previous version of this file pinned seven tool names
 * and silently rotted as the surface grew to thirteen.
 */
describe.skipIf(!e2eEnabled)('e2e: auth, CSRF and the advertised surface', () => {
  let server: E2eServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('logs in and reports a healthy, authenticated site', async () => {
    const data = asRecord(await server.callOk('automad_site', { action: 'health' }));
    expect(data).toMatchObject({ ok: true, reachable: true, authenticated: true });
    expect(typeof data['version']).toBe('string');
  });

  it('exposes exactly the tools the capability registry declares', async () => {
    const names = (await server.mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('gives every tool an action enum in its input schema', async () => {
    const tools = (await server.mcp.listTools()).tools;
    for (const tool of tools) {
      const properties = asRecord(asRecord(tool.inputSchema)['properties']);
      const action = asRecord(properties['action']);
      expect(Array.isArray(action['enum'])).toBe(true);
      expect((action['enum'] as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('reads site info from the live bootstrap endpoint', async () => {
    const data = asRecord(await server.callOk('automad_site', { action: 'info' }));
    expect(typeof data['version']).toBe('string');
    expect(data).toHaveProperty('sitename');
    expect(data).toHaveProperty('languages');
  });

  it('reuses the session and CSRF token across a read → write → read sequence', async () => {
    // Three authenticated POSTs on one session. If the CSRF token were not
    // scraped and replayed correctly, v2 answers 403 "CSRF token mismatch" —
    // the write in the middle is the one that would fail.
    const before = asRecord(await server.callOk('automad_shared', { action: 'get' }));
    const fields = asRecord(before['fields']);
    const marker = uniqueName('csrf');

    try {
      // Merge, don't replace: v2's shared/data write overwrites the whole record.
      await server.callOk('automad_shared', {
        action: 'set',
        fields: { ...fields, sitename: marker },
      });
      const after = asRecord(await server.callOk('automad_shared', { action: 'get' }));
      expect(asRecord(after['fields'])['sitename']).toBe(marker);
    } finally {
      await server.call('automad_shared', { action: 'set', fields });
    }
  });

  it('serves the offline docs and theme resources over the live connection', async () => {
    const uris = (await server.mcp.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain('automad://themes');
    expect(uris).toContain('automad://docs');

    const read = await server.mcp.readResource({ uri: 'automad://docs' });
    const first = read.contents[0];
    expect(first?.mimeType).toBe('application/json');
    expect(JSON.parse(String(first?.text))).toHaveProperty('pages');
  });

  it('registers the workflow prompts', async () => {
    const names = (await server.mcp.listPrompts()).prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'analyze_theme',
      'check_headless_setup',
      'create_blog_post',
      'find_docs',
      'scaffold_theme',
    ]);
  });

  it('surfaces bad credentials as a failed health check instead of crashing', async () => {
    const bad = await startServer({ env: { AUTOMAD_PASS: 'definitely-not-the-password' } });
    try {
      const data = asRecord(await bad.callOk('automad_site', { action: 'health' }));
      expect(data['ok']).toBe(false);
      expect(data['authenticated']).toBe(false);
    } finally {
      await bad.close();
    }
  });
});
