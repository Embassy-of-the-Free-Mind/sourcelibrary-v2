/**
 * v2#8590 (Derek, 2026-11-12): the batch OCR/translate routes are retired outright. Each picked its own engine on the
 * paid Gemini Batch API, outside the router; from 11-06 to 11-11 about 1,900 pages were written through them by hand
 * on a model the router no longer names. A hand request now queues the book for the lane its router cell names.
 * This fails if one of the route directories comes back, or if a live script or source file requests one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs
import { RETIRED_API_ROUTES } from '../../scripts/lib/lanes.mjs';

const ROOT = path.resolve(__dirname, '../..');
/**
 * A URL segment of a retired route, as a caller writes it. `bulk-reocr` alone would match bulk-reocr-local.mjs, and a
 * bare `import-batch` would match scripts/iiif-discovery/import-batch.mjs (a different thing), so those two segments
 * must end the path segment.
 */
const RETIRED_URL = /batch-ocr-async|batch-translate-async|batch-ocr-multi|admin\/bulk-reocr|admin\/bulk-ocr-new|api\/batch-save(?![\w.-])|\/import-batch(?![\w.-])|stitch-translations/;
/** A request to one: fetch/post/curl with the segment on the same line (a comment or a stored label is not a call). */
const CALLS_RETIRED = new RegExp(`(?:fetch|post|curl)[^\\n]*(?:${RETIRED_URL.source})`, 'i');

const SCANNED = ['src', 'scripts/batch', 'scripts/maintenance', 'scripts/workers', 'scripts/lib', 'scripts/import'];
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== '_archived' && e.name !== 'node_modules') sourceFiles(rel, out);
    } else if (/\.(ts|tsx|mjs|js|sh|py)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('the batch routes stay retired (v2#8590)', () => {
  it('lists all eleven', () => {
    expect(RETIRED_API_ROUTES).toHaveLength(11);
  });
  it.each(RETIRED_API_ROUTES as string[])('%s does not exist', (dir) => {
    expect(fs.existsSync(path.join(ROOT, dir))).toBe(false);
  });

  it('the caller probe fires on a call and not on a comment (controls)', () => {
    expect(CALLS_RETIRED.test("await fetch(`${BASE}/api/books/${id}/batch-ocr-async`, { method: 'POST' })")).toBe(true);
    expect(CALLS_RETIRED.test('curl -X POST https://sourcelibrary.org/api/admin/bulk-reocr?limit=5')).toBe(true);
    expect(CALLS_RETIRED.test(' * jobs the batch-ocr-async route submitted are still collected')).toBe(false);
    expect(CALLS_RETIRED.test('node scripts/batch/bulk-reocr-local.mjs --page-ids-file=pages.json')).toBe(false);
    // v3#212: batch-save, import-batch and stitch-translations.
    expect(CALLS_RETIRED.test("await fetch(`${BASE}/api/batch-save?limit=50`, { method: 'POST' })")).toBe(true);
    expect(CALLS_RETIRED.test('return await apiClient.post(getBookUrl(`/${id}/import-batch`), { pages });')).toBe(true);
    expect(CALLS_RETIRED.test('return await apiClient.post(getBookUrl(`/${id}/stitch-translations`));')).toBe(true);
    expect(CALLS_RETIRED.test('curl -X POST "$BASE/api/books/$ID/import-batch"')).toBe(true);
    expect(CALLS_RETIRED.test('node scripts/iiif-discovery/import-batch.mjs --post-to=staging')).toBe(false);
  });

  it('no live source file or script requests one', () => {
    const files = SCANNED.flatMap((d) => sourceFiles(d));
    expect(files.length).toBeGreaterThan(500);
    const callers = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').some((l) => CALLS_RETIRED.test(l)));
    expect(callers, 'these files request a retired batch route; queue the book for its router lane instead (.claude/docs/routing.md)').toEqual([]);
  });
});
