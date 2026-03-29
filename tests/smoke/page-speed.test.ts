import { describe, it, expect } from 'vitest';

/**
 * Smoke tests that hit the production site and check for slow/broken pages.
 * Run manually: npx vitest run tests/smoke/page-speed.test.ts
 *
 * These test real response times against the live site. They're excluded from
 * the default test suite (see vitest.config) and meant for CI or manual checks.
 */

const BASE = process.env.SMOKE_BASE_URL || 'https://sourcelibrary.org';
const TIMEOUT_MS = 5000; // pages should respond well under this

// Sample of pages across different sizes and types
const PAGES = [
  { path: '/', label: 'Home' },
  { path: '/book/corpus-hermeticum', label: 'Medium book (slug)' },
  { path: '/book/the-zohar-sefer-ha-zohar-attributed', label: 'Large book - Zohar Cremona' },
  { path: '/book/the-zohar-sefer-ha-zohar-attributed-2', label: 'Large book - Zohar Mantua' },
  { path: '/collections', label: 'Collections index' },
  { path: '/gallery', label: 'Gallery' },
];

describe('Page speed smoke tests', () => {
  for (const { path, label } of PAGES) {
    it(`${label} (${path}) responds under ${TIMEOUT_MS}ms`, async () => {
      const url = `${BASE}${path}`;
      const start = Date.now();
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const elapsed = Date.now() - start;

      expect(res.status, `${url} returned ${res.status}`).toBeLessThan(500);
      expect(elapsed, `${url} took ${elapsed}ms`).toBeLessThan(TIMEOUT_MS);
    }, TIMEOUT_MS + 2000);
  }
});
