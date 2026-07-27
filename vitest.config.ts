import { defineConfig } from 'vitest/config';

/**
 * Offline unit suite. The live E2E tests live in their own config
 * (`vitest.e2e.config.ts`) because they need a real Automad v2 instance and
 * must not run in parallel — `npm test` stays fully offline.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        statements: 80,
        branches: 70,
      },
    },
  },
});
