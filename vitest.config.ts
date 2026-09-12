import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `.tsx` too: a component test added as .tsx used to be silently skipped —
    // vitest reports "No test files found", which reads as a filter typo rather
    // than a suite that never ran. A test that cannot run is worse than absent.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/smoke/**', 'tests/integration/**'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
