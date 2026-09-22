import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { countVisiblePageStats } from '../../scripts/lib/page-counts.mjs';

/**
 * The DOI gate must measure translation against what CAN be translated.
 *
 * `batch-mint-doi.mjs` requires ≥90% translated before it will mint. It computed that
 * as `pages_translated / pages_ocr` — counting blank leaves in the denominator, which
 * have no text to translate and never will. That is the same numerator/denominator
 * mismatch `page-counts.mjs` was written to prevent (#4442: "a numerator must exclude
 * whatever its denominator excludes").
 *
 * Measured 2026-09-20 on Antoninus of Florence, *Confessionale "Defecerunt"*
 * (`6aa94d4098dd95a320803433`): 358 pages, 304 translated, **all 54 of the rest
 * `page_type: blank`**. The gate read 84.9% and silently withheld the DOI from a book
 * that is 100% translated. `translated_translatable / translatable` reads 100.0%.
 *
 * 20,447 of 41,920 readable books carry blank leaves, so this understated half the
 * corpus — and the failure is silent: an ineligible book simply never appears in the
 * candidate list. Nothing errors, so nobody looks.
 */

const REPO = path.resolve(__dirname, '../..');

describe('a translation percentage excludes what cannot be translated', () => {
  it('the exhibit: a book whose only untranslated pages are blank is 100%, not 85%', () => {
    // 358 pages: 304 ordinary text pages, all translated; 54 blank leaves with OCR
    // (the OCR records that the leaf is blank) and no translation.
    const pages = [
      ...Array.from({ length: 304 }, (_, i) => ({
        page_number: i + 1,
        ocr: { data: 'Textus...' },
        translation: { data: 'Text...' },
      })),
      ...Array.from({ length: 54 }, (_, i) => ({
        page_number: 305 + i,
        page_type: 'blank',
        ocr: { data: '<page-type>blank</page-type>' },
      })),
    ];

    const s = countVisiblePageStats(pages);
    expect(s.with_ocr).toBe(358);
    expect(s.with_translation).toBe(304);
    expect(s.blank).toBe(54);

    // What the gate used to measure — the wrong denominator.
    expect((s.with_translation / s.with_ocr) * 100).toBeCloseTo(84.9, 1);
    // What it measures now.
    expect(s.translated_translatable / s.translatable).toBe(1);
  });

  it('a genuinely unfinished book is still held back', () => {
    // Blank leaves must not become a way to pass the gate: a book with real
    // untranslated TEXT pages stays below it.
    const pages = [
      ...Array.from({ length: 50 }, (_, i) => ({ page_number: i + 1, ocr: { data: 'x' }, translation: { data: 'y' } })),
      ...Array.from({ length: 50 }, (_, i) => ({ page_number: 51 + i, ocr: { data: 'x' } })),
      ...Array.from({ length: 20 }, (_, i) => ({ page_number: 101 + i, page_type: 'blank', ocr: { data: 'x' } })),
    ];
    const s = countVisiblePageStats(pages);
    expect(s.translated_translatable / s.translatable).toBe(0.5);
  });
});

describe('the DOI gate uses that denominator', () => {
  it('batch-mint-doi.mjs does not divide by pages_ocr', () => {
    // A unit test of page-counts.mjs stays green while the gate keeps its own wrong
    // arithmetic — the gate is a separate expression in an aggregation, so pin it.
    const src = readFileSync(path.join(REPO, 'scripts/batch/batch-mint-doi.mjs'), 'utf8');
    expect(src, 'the DOI eligibility gate must subtract pages_blank before dividing').not.toMatch(
      /\$divide:\s*\[\s*'\$pages_translated',\s*'\$pages_ocr'\s*\]/,
    );
    expect(src).toMatch(/\$subtract:\s*\[\s*'\$pages_ocr',\s*\{\s*\$ifNull:\s*\['\$pages_blank'/);
  });
});
