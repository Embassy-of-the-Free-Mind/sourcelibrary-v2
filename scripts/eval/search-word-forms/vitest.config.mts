// PRIOR ART: scripts/eval/search-recall/local/vitest.config.mts — includes only that
// directory's harness; this one runs the word-form lane harness beside it. Not in CI.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/eval/search-word-forms/*.harness.ts'],
    testTimeout: 3_600_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../../../src') } },
});
