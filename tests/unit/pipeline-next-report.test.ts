/**
 * The /admin/pipeline remaining-work table (#5480): pages left × the cited unit price, with the Chinese
 * OCR cohort split out at the Paddle (EUR) rate and the post-OCR translation as its own row.
 */
import { describe, it, expect } from 'vitest';
import { remainingWork, type PipelineNextReport, type Work } from '@/lib/pipeline-next-report';
// @ts-expect-error — scripts-side module, no types
import { UNIT_PRICES } from '../../scripts/lib/pipeline-unit-prices.mjs';

const w = (books: number, o: Partial<Work> = {}): Work => ({ books, pages: 0, archive_pages: 0, ocr_pages: 0, translate_pages: 0, ...o });

const report = {
  _id: 'pipeline-next-2026-10-02', day: '2026-10-02', generated_at: new Date(), generated_by: 'x',
  denominator: { rule: 'books with pages_count > 0', books: 100, live: 60, live_rule: 'visible: true' },
  verdict: { status: 'PASS', fails: [] },
  steps: [
    { step: 'translate', all: w(10), live: w(8, { translate_pages: 1000 }) },
    { step: 'ocr', all: w(40), live: w(30, { ocr_pages: 10000, translate_pages: 12000 }) },
    { step: 'archive', all: w(5), live: w(3, { archive_pages: 500 }) },
  ],
  step_reasons: [
    { step: 'translate', reason: 'body', all: w(6), live: w(5) },
    { step: 'translate', reason: 'tail', all: w(4), live: w(3) },
  ],
  step_languages_live: { ocr: [
    { language: 'Chinese', ...w(20, { ocr_pages: 7000, translate_pages: 7000 }) },
    { language: 'Classical Chinese', ...w(2, { ocr_pages: 500 }) },
    { language: 'Latin', ...w(8, { ocr_pages: 2500 }) },
  ] },
  held: [{ reason: 'tibetan', issue: 4523, all: w(7, { ocr_pages: 10, translate_pages: 900 }), live: w(6) }],
  shapes: {}, agreement: { compared: 100, disagree: 0, fresh: 0, stale: 0, stale_pct: 0, last_stamp_run: null },
} as unknown as PipelineNextReport;

describe('remainingWork', () => {
  const { rows, held } = remainingWork(report);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));

  it('prices translate pages at the cited low–high range', () => {
    expect(by.translate.pages).toBe(1000);
    expect(by.translate.costLow).toBeCloseTo(1000 * UNIT_PRICES.translate.low);
    expect(by.translate.costHigh).toBeCloseTo(1000 * UNIT_PRICES.translate.high);
    expect(by.translate.note).toContain('body 5');
  });
  it('splits Chinese OCR out at the Paddle EUR rate, every Chinese variant', () => {
    expect(by.ocr_zh).toMatchObject({ books: 22, pages: 7500 });
    expect(by.ocr_zh.price.currency).toBe('EUR');
    expect(by.ocr).toMatchObject({ books: 8, pages: 2500 });
    expect(by.ocr.price.currency).toBe('USD');
  });
  it('counts the translation OCR will make necessary as its own row', () => {
    expect(by.ocr_then_translate).toMatchObject({ books: 30, pages: 12000 });
  });
  it('archive is unmetered, a missing step is zero, and every rate has a dated source', () => {
    expect(by.archive.costHigh).toBe(0);
    expect(by.enrich.books).toBe(0);
    for (const r of rows) for (const s of r.price.sources) expect(s.where).toBeTruthy();
  });
  it('lists held cohorts without pricing them', () => {
    expect(held).toEqual([{ reason: 'tibetan', issue: 4523, books: 7, live: 6, ocr_pages: 10, translate_pages: 900 }]);
  });
});
