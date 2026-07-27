/**
 * `theme.build` against a real Automad v2 instance.
 *
 * Isolated from `theme.e2e.test.ts` because it needs a fresh scaffolded theme
 * and its own unrestricted server (the build runs npm / composer). Each file
 * in this suite owns its own scaffold so the suite stays order-independent.
 *
 * Whether the build *succeeds* depends on the machine — Composer, npm and
 * network access are not the MCP's to guarantee. What must hold is that every
 * step is reported with an exit code and its output instead of throwing, so a
 * caller can see what failed.
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

describe.skipIf(!e2eEnabled)('e2e: theme.build', () => {
  let server: E2eServer;
  const themes = makeTempThemesDir();
  let slug = '';

  beforeAll(async () => {
    server = await startServer({ writeMode: 'unrestricted', themesPath: themes.path });
    const scaffolded = asRecord(
      await server.callOk('automad_theme', {
        action: 'scaffold',
        name: uniqueName('E2E Build'),
        author: 'E2E Suite',
      }),
    );
    slug = path.basename(stringField(scaffolded, 'path'));
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    themes.dispose();
  });

  it(
    'builds the scaffolded theme and reports each step structurally',
    async () => {
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
});
