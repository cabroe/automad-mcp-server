import { describe, expect, it, afterEach } from 'vitest';
import { runCommand, npmInstall, npmBuild } from '../../src/theme/build.js';

describe('theme build & package manager resolution', () => {
  const origEnv = process.env['AUTOMAD_PACKAGE_MANAGER'];

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env['AUTOMAD_PACKAGE_MANAGER'] = origEnv;
    } else {
      delete process.env['AUTOMAD_PACKAGE_MANAGER'];
    }
  });

  it('runCommand handles non-existent commands cleanly with ENOENT advice', async () => {
    const res = await runCommand('non_existent_binary_xyz_12345', [], { cwd: process.cwd() });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(-1);
    expect(res.stderr).toContain("Executable 'non_existent_binary_xyz_12345' was not found in PATH");
  });

  it('npmInstall uses default npm command when AUTOMAD_PACKAGE_MANAGER is unset', async () => {
    delete process.env['AUTOMAD_PACKAGE_MANAGER'];
    // We pass a non-existent cwd or test command behavior
    const res = await npmInstall('/non-existent-path-xyz', 100);
    expect(res.command).toContain('npm install');
  });

  it('npmInstall respects AUTOMAD_PACKAGE_MANAGER env var', async () => {
    process.env['AUTOMAD_PACKAGE_MANAGER'] = 'bun';
    const res = await npmInstall('/non-existent-path-xyz', 100);
    expect(res.command).toContain('bun install');
  });

  it('npmBuild respects AUTOMAD_PACKAGE_MANAGER env var', async () => {
    process.env['AUTOMAD_PACKAGE_MANAGER'] = 'pnpm';
    const res = await npmBuild('/non-existent-path-xyz', 100);
    expect(res.command).toContain('pnpm run build');
  });
});
