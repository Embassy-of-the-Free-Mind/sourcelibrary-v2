import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The batch routes spend on the paid Gemini API and write page text. `withAuth` defaults to minRole 'reader',
 * which every signed-up account has, so until 2026-11-11 any signed-in visitor could start a paid batch job.
 * The pipeline calls these routes with the cron bearer, which withAuth resolves to admin.
 */
const ROUTES = [
  'src/app/api/books/[id]/batch-ocr-async/route.ts',
  'src/app/api/[tenant]/books/[id]/batch-ocr-async/route.ts',
  'src/app/api/books/[id]/batch-translate-async/route.ts',
  'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts',
  'src/app/api/books/[id]/batch-ocr-multi/route.ts',
  'src/app/api/[tenant]/books/[id]/batch-ocr-multi/route.ts',
];

describe('batch routes are admin-only', () => {
  for (const rel of ROUTES) {
    it(rel, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
      const handlers = src.match(/export const (GET|POST|PUT|PATCH|DELETE) = withAuth\(/g) ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      expect((src.match(/\}, \{ minRole: 'admin' \}\);/g) ?? []).length).toBe(handlers.length);
    });
  }
});
