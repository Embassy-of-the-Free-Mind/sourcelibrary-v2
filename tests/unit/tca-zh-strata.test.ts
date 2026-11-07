/**
 * The Chinese strata of the translation corpus audit (#5274, 2026-11-03).
 *
 * The miss this pins: a 四庫全書薈要 copy of 子史精華 carries only `子部`, no 類-level class, and the first rule read it as
 * running prose; the by-eye check of 20 drawn pages caught it. Fixtures are the real catalogue subjects and titles of
 * books in the 2026-11-03 draw (scripts/eval/results/zh-translation-strata-5274/manifest.jsonl), and the real
 * ocr.model / translation.model values of the Chinese census.
 *
 * Also pinned: the engine and model split the strata are drawn on, and that allocation gives every non-empty stratum
 * its floor and spends exactly N books.
 */
import { describe, it, expect } from 'vitest';
import { zhKindOf, zhEngineOf, zhModelOf, zhHandOf, frameWeights, allocate } from '../../scripts/eval/translation-corpus-audit/zh-strata.mjs';

describe('zhKindOf', () => {
  it('reads the Siku class first', () => {
    expect(zhKindOf({ title: '古音駢字續編·卷三~卷四 (vol 2)', catalog_metadata: { subjects: ['四庫全書', '經部', '小學類', '清'] } }).kind).toBe('reference');
    expect(zhKindOf({ title: '御定子史精華·卷四十四~卷四十七 (vol 14)', catalog_metadata: { subjects: ['四庫全書', '子部', '類書類', '清'] } }).kind).toBe('reference');
    // a materia medica is entry-shaped but a treatise by class
    expect(zhKindOf({ title: '本草', catalog_metadata: { subjects: ['四庫全書', '子部', '醫家類', '清'] } }).kind).toBe('prose');
  });
  it('falls back to the title when the record has no 類-level class (the 薈要 copies)', () => {
    const k = zhKindOf({ title: '御定子史精華·卷六十一~卷六十四 (vol 121)', catalog_metadata: { subjects: ['四庫全書薈要', '子部', '清'] } });
    expect(k).toEqual({ kind: 'reference', by: 'title' });
    expect(zhKindOf({ title: '三才圖會(九十八)' }).kind).toBe('reference');
    expect(zhKindOf({ title: '續古尊宿語要 卷4 (vol 3 of 5)' }).kind).toBe('prose');
  });
});

describe('strata keys', () => {
  it('splits engines and models as the census found them', () => {
    expect(zhEngineOf({ model: 'PaddleOCR-VL-1.6-0.9B', source: 'paddle' })).toBe('paddle');
    expect(zhEngineOf({ model: 'gemini-3.1-flash-lite-preview', source: 'batch_api' })).toBe('gemini');
    expect(zhEngineOf({ model: 'claude-opus-5-5', source: 'ai' })).toBe('other');
    expect(zhEngineOf({ model: 'cbeta-xml-p5@dbdea41071', source: 'cbeta-xml-p5' })).toBe('other');
    expect(zhModelOf('gemini-3.1-flash-lite')).toBe('flash-lite');
    expect(zhModelOf('gemini-3.1-flash-lite-preview')).toBe('flash-lite');
    expect(zhModelOf('gemini-3.8-flash-low')).toBe('3.8-flash');
    expect(zhModelOf('manual')).toBeNull();
    expect(zhHandOf('handwritten')).toBe('manuscript');
    expect(zhHandOf(undefined)).toBe('untagged');
  });
});

describe('frameWeights + allocate', () => {
  // 30 books: 20 in A only, 9 split A/B, 1 with a few C pages (below the 12-book floor → dropped)
  const perBook: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 20; i++) perBook[`a${i}`] = { A: 100 };
  for (let i = 0; i < 9; i++) perBook[`s${i}`] = { A: 50, B: 50 };
  perBook.c0 = { C: 10 };
  const pages = { A: 20 * 100 + 9 * 50, B: 9 * 50, C: 10 };
  const fw = frameWeights({ perBook, pages }, { minBooks: 5, minShare: 0.01 });
  it('drops thin strata and gives both estimands', () => {
    expect(Object.keys(fw.strata).sort()).toEqual(['A', 'B']);
    expect(Object.keys(fw.dropped)).toEqual(['C']);
    expect(fw.strata.B.w_pages).toBeCloseTo(450 / 2910, 6);
    expect(fw.strata.B.w_books).toBeCloseTo(4.5 / 30, 6); // nine books, half their pages each
  });
  it('spends N books with a floor per stratum', () => {
    const a = allocate(fw.strata, 20, 6);
    expect(a.A + a.B).toBe(20);
    expect(a.B).toBeGreaterThanOrEqual(6);
    expect(a.A).toBeGreaterThan(a.B);
  });
});
