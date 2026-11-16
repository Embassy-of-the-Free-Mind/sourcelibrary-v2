import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gradeField, corroborate, needsCorroboration } from '../../scripts/audit/provenance-grades.mjs';
import { summarize, jobsByKey } from '../../scripts/audit/provenance-grade-summary.mjs';

/**
 * The per-book summary (sourcelibrary-v3 #201) folds the grader's output into counts. Fixtures are the
 * real page subdocuments and call-log rows of tests/fixtures/provenance-grades-201.json (PR #210).
 */
type Field = 'ocr' | 'translation';
type Fx = { pages: { _id: string; id: string; book_id: string; field: Field; sub: Record<string, unknown> | null }[]; batch_jobs: Record<string, any>[]; gemini_usage: Record<string, any>[] };
const fx: Fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/provenance-grades-201.json'), 'utf8'));
const jobs = jobsByKey(fx.batch_jobs);
const usageByJob = new Map();

describe('summarize', () => {
  const graded = fx.pages.flatMap((p) => {
    const g = gradeField(p.field, p.sub);
    if (!g) return [];
    const c = needsCorroboration(g) ? corroborate(p.field, p.sub, [p.id, p._id], { jobs, usage: fx.gemini_usage, usageByJob }) : null;
    return [{ g, c }];
  });
  const builtAt = new Date('2026-11-13T00:00:00Z');
  const rows = summarize('book-x', graded, { pagesInBook: 99, runId: 'pgs-test', builtAt });

  it('one row per field, counts adding up per grade and per month', () => {
    expect(rows.map((r) => r.field).sort()).toEqual(['ocr', 'translation']);
    for (const r of rows) {
      const mine = graded.filter((x) => x.g.field === r.field);
      expect(r.pages).toBe(mine.length);
      expect(Object.values(r.grades).reduce((a: number, b) => a + (b as number), 0)).toBe(r.pages);
      expect(Object.values(r.months).reduce((a: number, m: any) => a + m.n, 0)).toBe(r.pages);
      for (const g of Object.keys(r.grades)) expect(r.grades[g]).toBe(mine.filter((x) => x.g.grade === g).length);
      expect(r).toMatchObject({ book_id: 'book-x', pages_in_book: 99, run_id: 'pgs-test', grader: 'provenance-grade/1', built_at: builtAt });
    }
  });

  it('corroboration is counted for the checked grades only, and per month', () => {
    const ocr = rows.find((r) => r.field === 'ocr')!;
    const checked = graded.filter((x) => x.g.field === 'ocr' && x.c);
    const yes = checked.filter((x) => x.c!.corroborated);
    expect(Object.values(ocr.corroboration).reduce((a: number, k: any) => a + k.checked, 0)).toBe(checked.length);
    expect(Object.values(ocr.corroboration).reduce((a: number, k: any) => a + k.corroborated, 0)).toBe(yes.length);
    expect(yes.length).toBeGreaterThan(0);
    expect(ocr.corroboration.imported).toBeUndefined();
    // the realtime OCR page corroborated by its gemini_usage row lands in its month
    const m = String(fx.pages.find((p) => p._id === '6a4ae435f16f8258b8ade075')!.sub!.updated_at).slice(0, 7);
    expect(ocr.months[m].inferred_corroborated).toBeGreaterThanOrEqual(1);
  });

  it('a book with no text gives no rows', () => {
    expect(summarize('empty', [], { pagesInBook: 3, runId: 'r', builtAt })).toEqual([]);
  });
});
