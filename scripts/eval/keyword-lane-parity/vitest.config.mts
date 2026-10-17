// PRIOR ART: scripts/eval/search-word-forms/vitest.config.mts — the same harness config for that
// directory's lane harness. Not in CI: it reads production data.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/eval/keyword-lane-parity/*.harness.ts'],
    testTimeout: 7_200_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../../../src') } },
});
