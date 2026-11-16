import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // CI on the shared self-hosted runners caps workers (unit-tests.yml sets VITEST_MAX_WORKERS).
    ...(process.env.VITEST_MAX_WORKERS ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) } : {}),
    globals: true,
    environment: 'node',
    // `.tsx` too: a component test added as .tsx used to be silently skipped —
    // vitest reports "No test files found", which reads as a filter typo rather
    // than a suite that never ran. A test that cannot run is worse than absent.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/smoke/**', 'tests/integration/**'],
    // On CI a time limit measures how busy the shared runner is, not the code: on 2026-11-12 five failed
    // runs each died on a different clock (30 s, 120 s, the 10 s Mongo launch) with every assertion
    // passing (#37). CI gets wide limits; a local run keeps the tight ones, where a slow test is a signal.
    testTimeout: process.env.CI ? 120_000 : 30_000,
    hookTimeout: process.env.CI ? 120_000 : 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
