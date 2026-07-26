import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BUNDLED_STARTER_KIT_PATH } from '../../../src/theme/starter-kit.js';
import { assertStarterKitLayout, REQUIRED_LAYOUT } from '../../../src/theme/dev.js';
import { LocalThemeFs } from '../../../src/theme/fs.js';

describe('bundled starter kit', () => {
  it('resolves to a real directory shipped with the package', async () => {
    const stat = await fs.stat(BUNDLED_STARTER_KIT_PATH);
    expect(stat.isDirectory()).toBe(true);
  });

  it('satisfies the canonical REQUIRED_LAYOUT', async () => {
    await expect(
      assertStarterKitLayout(BUNDLED_STARTER_KIT_PATH, new LocalThemeFs()),
    ).resolves.toBeUndefined();
    // Every required entry physically exists in the bundle.
    for (const entry of REQUIRED_LAYOUT) {
      await expect(fs.stat(path.join(BUNDLED_STARTER_KIT_PATH, entry))).resolves.toBeDefined();
    }
  });

  it('ships a package.json with the canonical build tooling', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(BUNDLED_STARTER_KIT_PATH, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.scripts?.build).toBe('node esbuild.js');
    expect(pkg.scripts?.dev).toBe('bash bin/dev.sh');
    expect(pkg.devDependencies?.esbuild).toBeTruthy();
    expect(pkg.devDependencies?.typescript).toBeTruthy();
  });

  it('ships a valid theme.json manifest', async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(BUNDLED_STARTER_KIT_PATH, 'theme.json'), 'utf8'),
    ) as { masks?: Record<string, unknown> };
    expect(manifest.masks).toBeDefined();
  });
});
