import { describe, it, expect } from 'vitest';
import { ocrMeasure } from '@/lib/ocr-measure';
import { getReaderStrings } from '@/lib/reader-strings';
import { NOT_READABLE_IN_ENGLISH_OR, READABLE_IN_ENGLISH_OR } from '@/lib/books-catalog';
import { READABLE_RUNGS, ENGLISH_ORIGINAL_READABLE_RUNGS } from '@/lib/page-counts';

// #6278 items 4 and 5: the /la "Nondum conversi" band and the reader's measured-accuracy line.

describe('ocrMeasure', () => {
  it('reads the production engine off the Latin chart /quality shows', () => {
    const m = ocrMeasure('latin');
    expect(m).not.toBeNull();
    expect(m!.accuracy).toBeGreaterThan(0.5);
    expect(m!.accuracy).toBeLessThanOrEqual(1);
    expect(m!.ci95[0]).toBeLessThanOrEqual(m!.accuracy);
    expect(m!.ci95[1]).toBeGreaterThanOrEqual(m!.accuracy);
    expect(m!.pages).toBeGreaterThanOrEqual(20);
    expect(m!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m!.href).toBe('/quality#pareto-latin');
  });

  it('says nothing for a chart that does not exist', () => {
    expect(ocrMeasure('no-such-chart')).toBeNull();
  });
});

describe('the Latin reader line', () => {
  const t = getReaderStrings('la').ocrMeasure!;
  const line = t.line({ percent: 96, low: 93, high: 98, pages: 44, date: '2026-10-12' });

  it('states n, the date and the interval, in Arabic numerals', () => {
    expect(line).toContain('44 paginis');
    expect(line).toContain('die 12 Octobris 2026');
    expect(line).toContain('96 litteras e centum');
    expect(line).toContain('inter 93 et 98');
    // No Roman numerals or macrons (#6278).
    expect(line).not.toMatch(/\b[MDCLXVI]{2,}\b/);
    expect(line).not.toMatch(/[āēīōūȳ]/i);
  });

  it('is shown on /la only', () => {
    for (const l of ['en', 'es', 'nl', 'zh'] as const) expect(getReaderStrings(l).ocrMeasure).toBeNull();
  });
});

describe('NOT_READABLE_IN_ENGLISH_OR', () => {
  it('is built from the same rung lists as READABLE_IN_ENGLISH_OR', () => {
    for (const r of [...READABLE_RUNGS, ...ENGLISH_ORIGINAL_READABLE_RUNGS]) {
      expect(READABLE_IN_ENGLISH_OR).toContain(r);
      expect(NOT_READABLE_IN_ENGLISH_OR).toContain(r);
    }
    // An unstamped book (scans-only, just published) is not readable in English.
    expect(NOT_READABLE_IN_ENGLISH_OR.startsWith('translation_rung.is.null,')).toBe(true);
  });
});
