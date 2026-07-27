import { defineConfig } from 'vitest/config';

/**
 * E2E config — separate from `vitest.config.ts` (which runs the offline unit
 * suite) because these tests drive a *real* Automad v2 instance:
 *
 *   - `tests/e2e/env.ts` loads `.env.e2e` (written by `npm run e2e:up`), so the
 *     suite opts itself in without any manual exports.
 *   - No parallelism at all: v2 races on concurrent writes to the same page
 *     tree (documented in CLAUDE.md), and every file shares one backend.
 *   - Generous timeouts: create/update publish-and-poll against real PHP.
 *   - No coverage thresholds — these tests exercise plumbing, not lines.
 *
 * Run: npm run e2e:run   (or `npm run e2e` to bring the stack up first)
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    setupFiles: ['tests/e2e/env.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
