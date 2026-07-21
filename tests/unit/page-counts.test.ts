/**
 * Page-count convention guard (issue #3293).
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only —
 * they count pages with `page_number > 0`. Pages with `page_number <= 0` are
 * a deliberate soft-hide and never render, so "N scans", the ≥90%-readable
 * filter, and the <5% "not yet translated" gate all assume the counters
 * exclude them. Every counter writer (batch collectors, split worker,
 * realtime translate) routes through scripts/lib/page-counts.mjs so the
 * convention can't drift per-writer again.
 *
 * The damage this pins against: histoire-de-la-magie-...-constant stored
 * pages_translated: 20 (all-pages counter with hidden pages) while 581 of 620
 * visible pages were translated, wrongly banner-ing "not yet translated".
 */
import { describe, it, expect } from 'vitest';

import {
  VISIBLE_PAGE_MATCH,
  isVisiblePage,
  hasOcr,
  hasTranslation,
  buildVisiblePageCountPipeline,
  countVisiblePageStats,
} from '../../scripts/lib/page-counts.mjs';

describe('page-counts convention (#3293)', () => {
  it('VISIBLE_PAGE_MATCH selects only page_number > 0', () => {
    expect(VISIBLE_PAGE_MATCH).toEqual({ page_number: { $gt: 0 } });
  });

  it('isVisiblePage treats page_number <= 0 as hidden', () => {
    expect(isVisiblePage({ page_number: 1 })).toBe(true);
    expect(isVisiblePage({ page_number: 0 })).toBe(false);
    expect(isVisiblePage({ page_number: -3 })).toBe(false);
    expect(isVisiblePage({})).toBe(false);
    expect(isVisiblePage(null)).toBe(false);
  });

  it('hasOcr / hasTranslation require non-empty string data', () => {
    expect(hasOcr({ ocr: { data: 'text' } })).toBe(true);
    expect(hasOcr({ ocr: { data: '' } })).toBe(false);
    expect(hasOcr({ ocr: {} })).toBe(false);
    expect(hasOcr({})).toBe(false);
    expect(hasTranslation({ translation: { data: 'x' } })).toBe(true);
    expect(hasTranslation({ translation: { data: '' } })).toBe(false);
    expect(hasTranslation({})).toBe(false);
  });

  it('buildVisiblePageCountPipeline scopes the $match to book + visible pages', () => {
    const pipeline = buildVisiblePageCountPipeline('book-123');
    expect(pipeline[0]).toEqual({
      $match: { book_id: 'book-123', page_number: { $gt: 0 } },
    });
    // and it aggregates the three counters
    const group = pipeline[1].$group;
    expect(group.total).toEqual({ $sum: 1 });
    expect(group).toHaveProperty('with_ocr');
    expect(group).toHaveProperty('with_translation');
  });

  it('countVisiblePageStats excludes soft-hidden pages from every counter', () => {
    const pages = [
      { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
      { page_number: 2, ocr: { data: 'b' }, translation: { data: 'B' } },
      { page_number: 3, ocr: { data: 'c' } }, // ocr but no translation
      // soft-hidden pages: fully processed, but must NOT be counted
      { page_number: -1, ocr: { data: 'z' }, translation: { data: 'Z' } },
      { page_number: 0, ocr: { data: 'y' }, translation: { data: 'Y' } },
    ];
    expect(countVisiblePageStats(pages)).toEqual({
      total: 3,
      with_ocr: 3,
      with_translation: 2,
    });
  });

  it('regression: hidden translated pages do not fabricate a low translated count', () => {
    // Mirrors histoire-de-la-magie: many visible translated pages, plus hidden
    // pages. The all-pages counter would have produced the wrong totals; the
    // visible-only counter must report the visible truth.
    const pages = [];
    for (let n = 1; n <= 581; n++) {
      pages.push({ page_number: n, ocr: { data: 'o' }, translation: { data: 't' } });
    }
    for (let n = 582; n <= 620; n++) {
      pages.push({ page_number: n, ocr: { data: 'o' } }); // visible, untranslated
    }
    // soft-hidden trailing pages (front/back matter removed from the reader)
    for (let i = 1; i <= 309; i++) {
      pages.push({ page_number: -i, ocr: { data: 'o' }, translation: { data: 't' } });
    }
    const stats = countVisiblePageStats(pages);
    expect(stats.total).toBe(620); // "N scans" — visible only, not 929
    expect(stats.with_ocr).toBe(620);
    expect(stats.with_translation).toBe(581); // not 20, not 890
    // >90%-readable and >5% gates both see the visible truth
    expect(stats.with_translation / stats.total).toBeGreaterThan(0.9);
  });
});
