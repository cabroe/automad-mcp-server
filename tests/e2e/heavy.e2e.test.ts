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

/**
 * The actions the normal suite deliberately leaves alone, behind
 * `AUTOMAD_E2E_HEAVY=1`.
 *
 * They are excluded by default because of what they *do*, not because they are
 * unimportant: `build` and `dev` run a package manager (network access, a
 * minute or more, a background server holding a port), and `update` /
 * `update_all` ask Composer to change the installation the rest of the suite is
 * asserting against. Running them on every PR would trade a slow, flaky signal
 * for a fast, honest one.
 *
 * `system.update` is not here either, and not anywhere: it replaces the running
 * Automad with a different version, so every later assertion would describe a
 * different program. Verify it by hand on a throwaway instance if you touch it.
 *
 *   AUTOMAD_E2E_HEAVY=1 npm run e2e:run
 */
const heavy = process.env['AUTOMAD_E2E_HEAVY'] === '1';

describe.skipIf(!e2eEnabled || !heavy)('e2e: heavy theme operations (opt-in)', () => {
  let server: E2eServer;
  const themes = makeTempThemesDir();
  let slug = '';

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted', themesPath: themes.path });
    const scaffolded = asRecord(
      await server.callOk('automad_theme', {
        action: 'scaffold',
        name: uniqueName('E2E Heavy'),
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
    'builds the scaffolded theme and reports each step structurally',
    async () => {
      // Whether the build *succeeds* depends on the machine — Composer, npm and
      // network access are not the MCP's to guarantee. What must hold is that
      // every step is reported with an exit code and its output instead of
      // throwing, so a caller can see what failed.
      const result = asRecord(
        await server.callOk('automad_theme', { action: 'build', theme: slug, install: true }),
      );
      const build = asRecord(result['build']);
      expect(typeof build['ok']).toBe('boolean');
      expect(typeof build['exitCode']).toBe('number');
      expect(build).toHaveProperty('stderr');
    },
    600_000,
  );

  it(
    'starts a dev server and stops it again',
    async () => {
      // Same reasoning as the build: the dev server needs installed
      // dependencies to stay alive, which this suite does not require. The
      // contract under test is the process bookkeeping — a detached child is
      // recorded, its state can be queried, and stopping it is answered
      // structurally.
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

  it(
    'asks v2 to update a package and to update everything',
    async () => {
      // Both go through Composer on the Automad host. A failure here is a
      // legitimate answer (no network, nothing outdated); a crash is not.
      const single = await server.call('automad_theme', {
        action: 'update',
        package: 'automad/standard-lite',
      });
      expect(single.text.length).toBeGreaterThan(0);

      const all = await server.call('automad_theme', { action: 'update_all' });
      expect(all.text.length).toBeGreaterThan(0);
    },
    600_000,
  );
});
