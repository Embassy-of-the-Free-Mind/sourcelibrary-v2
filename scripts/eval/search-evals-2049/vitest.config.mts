// PRIOR ART: scripts/eval/keyword-lane-parity/vitest.config.mts — the same harness config for that
// directory's lane harnesses. Not in CI: these read production data.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/eval/search-evals-2049/*.harness.ts'],
    testTimeout: 7_200_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../../../src') } },
});
