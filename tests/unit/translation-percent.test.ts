import { describe, it, expect } from 'vitest';
import { translationPercent } from '@/lib/translation-percent';

// Every numeric case below is a real book from production (2026-08-05), taken
// from the measurement that motivated the fix — not invented shapes.
describe('translationPercent', () => {
  it('reports partial translation', () => {
    // "Académie de l'espée de Girard Thibault": 448 pages, 341 translated.
    expect(translationPercent({ pages_count: 448, pages_translated: 341 })).toBe(76);
  });

  it('reports a fully translated book as 100', () => {
    // 菌譜: 22 pages, all 22 translated.
    expect(translationPercent({ pages_count: 22, pages_translated: 22 })).toBe(100);
  });

  // THE property the old formulas lacked. Dividing by (pages_ocr − pages_blank)
  // assumes blank leaves are never translated; they frequently are (a stamp, a
  // plate caption, an inscription), which put 5,835 live books above 100% —
  // e.g. Marcianus graecus Z. 299: 401 translated, 432 ocr, 33 blank → 101%.
  it('can never exceed 100, even when the counters disagree', () => {
    expect(translationPercent({ pages_count: 399, pages_translated: 401 })).toBe(100);
    expect(translationPercent({ pages_count: 1, pages_translated: 9999 })).toBe(100);
  });

  it('never returns NaN or a negative when counters are missing or zero', () => {
    for (const book of [
      { pages_count: 0, pages_translated: 0 },
      { pages_count: 0, pages_translated: 50 },   // count not yet synced
      { pages_count: 100 },                        // translated absent
      { pages_translated: 100 },                   // count absent
      { pages_count: null, pages_translated: null },
      {},
    ]) {
      const v = translationPercent(book);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(translationPercent(null)).toBe(0);
    expect(translationPercent(undefined)).toBe(0);
  });

  // The reported symptom: 8,928 live books carry no stored translation_percent
  // at all because the writer was archived. A computed value must still produce
  // a usable number for them from the counters that ARE maintained.
  it('produces a real number for a book that never had a stored value', () => {
    // "Untersuchungen über die Brandpilze": 183 pages, 162 translated, no
    // translation_percent field in Mongo at all.
    expect(translationPercent({ pages_count: 183, pages_translated: 162 })).toBe(89);
  });
});
