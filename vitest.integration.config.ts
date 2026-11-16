import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // CI on the shared self-hosted runners caps workers (unit-tests.yml sets VITEST_MAX_WORKERS).
    ...(process.env.VITEST_MAX_WORKERS ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) } : {}),
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Wide limits on CI only: there they measure runner load, not the code (#37; see vitest.config.ts).
    testTimeout: process.env.CI ? 120_000 : 30_000,
    hookTimeout: process.env.CI ? 120_000 : 30_000,
    // Isolate test files to prevent mongodb-memory-server port conflicts
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
