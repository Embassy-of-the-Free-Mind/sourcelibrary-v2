// PRIOR ART: vitest.config.ts (repo root) — runs tests/**; this one runs only the
// local-route harness beside it, and nothing in CI includes it.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/eval/search-recall/local/*.harness.ts'],
    testTimeout: 3_600_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../../../../src') } },
});
