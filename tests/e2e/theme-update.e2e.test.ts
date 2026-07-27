/**
 * `theme.update` / `theme.update_all` against a real Automad v2 instance.
 *
 * Both go through Composer on the Automad host. A failure here is a
 * legitimate answer (no network, nothing outdated); a crash is not. The test
 * pins the structural contract: every call returns a non-empty payload the
 * LLM can act on, regardless of whether Composer ends up doing anything.
 *
 * Note: `system.update` is intentionally not covered here — it replaces the
 * running Automad with a different version, so every later assertion would
 * describe a different program. Verify it by hand on a throwaway instance
 * if you touch it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  asRecord,
  e2eEnabled,
  makeTempThemesDir,
  startServer,
  type E2eServer,
} from './harness.js';

describe.skipIf(!e2eEnabled)('e2e: theme.update / update_all', () => {
  let server: E2eServer;
  const themes = makeTempThemesDir();

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted', themesPath: themes.path });
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    themes.dispose();
  });

  it(
    'asks v2 to update a single package and to update everything',
    async () => {
      const single = await server.call('automad_theme', {
        action: 'update',
        package: 'automad/standard-lite',
      });
      expect(single.text.length).toBeGreaterThan(0);
      // The payload must be a JSON object, not a throwaway string — downstream
      // tooling renders the result and crashes on malformed JSON.
      expect(asRecord(JSON.parse(single.text))).toBeTruthy();

      const all = await server.call('automad_theme', { action: 'update_all' });
      expect(all.text.length).toBeGreaterThan(0);
      expect(asRecord(JSON.parse(all.text))).toBeTruthy();
    },
    600_000,
  );
});
