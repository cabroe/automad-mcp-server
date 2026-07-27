/**
 * `theme.dev` / `theme.dev_status` / `theme.dev_stop` against a real Automad
 * v2 instance. The dev server is short-lived and the test cleans it up in
 * `afterAll` so the port and child process never outlive the run.
 *
 * The contract under test is the process bookkeeping: a detached child is
 * recorded, its state can be queried, and stopping it is answered
 * structurally. Whether the dev server actually keeps running depends on the
 * theme's installed dependencies — that's not what we're pinning here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import {
  asRecord,
  e2eEnabled,
  makeTempThemesDir,
  startServer,
  stringField,
  uniqueName,
  type E2eServer,
} from './harness.js';

describe.skipIf(!e2eEnabled)('e2e: theme.dev lifecycle', () => {
  let server: E2eServer;
  const themes = makeTempThemesDir();
  let slug = '';

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted', themesPath: themes.path });
    const scaffolded = asRecord(
      await server.callOk('automad_theme', {
        action: 'scaffold',
        name: uniqueName('E2E Dev'),
        author: 'E2E Suite',
      }),
    );
    slug = path.basename(stringField(scaffolded, 'path'));
  }, 120_000);

  afterAll(async () => {
    // Stop first: a dev server left running would keep its port and its child
    // process past the end of the run.
    if (slug) await server?.call('automad_theme', { action: 'dev_stop', theme: slug });
    await server?.close();
    themes.dispose();
  });

  it(
    'starts a dev server, reports its status, and stops it again',
    async () => {
      const started = asRecord(await server.callOk('automad_theme', { action: 'dev', theme: slug }));
      expect(typeof started['pid']).toBe('number');
      expect(started).toHaveProperty('logPath');

      const status = asRecord(
        await server.callOk('automad_theme', { action: 'dev_status', theme: slug }),
      );
      expect(status['pid']).toBe(started['pid']);
      expect(typeof status['running']).toBe('boolean');

      const stopped = asRecord(
        await server.callOk('automad_theme', { action: 'dev_stop', theme: slug }),
      );
      expect(typeof stopped['stopped']).toBe('boolean');

      const after = asRecord(
        await server.callOk('automad_theme', { action: 'dev_status', theme: slug }),
      );
      expect(after['running']).toBe(false);
    },
    600_000,
  );
});
