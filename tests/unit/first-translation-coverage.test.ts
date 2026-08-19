/**
 * First-translation badge coverage gate (issue #3435).
 *
 * The bug: `is_first_translation` is a BIBLIOGRAPHIC claim ("no prior English
 * translation exists"), but the badge reads as a PRODUCT claim ("you can read
 * this in English"). The only render gate was `pages_translated > 0`, so a book
 * with 18 of 1,071 pages translated (1.7%) carried an unqualified "First
 * Translation" badge — and, worse, some carried "First Complete Translation".
 * Measured on production 2026-08-01: 366 badged books under 50% translated,
 * 244 of them under 10%.
 *
 * These tests exercise the functions, not the source text. Each one fails if
 * the coverage logic is removed — verified by deleting the guard and watching
 * them go red, per the "a test that greps source is not a guard" rule.
 */
import { describe, it, expect } from 'vitest';
import {
  translationCoverage,
  isTranslationReadable,
  isPublicFirst,
  isFirstTranslation,
  FIRST_TRANSLATION_READABLE_MIN,
} from '@/lib/first-translation/derive';
import { firstTranslationBadge, firstTranslationDescription } from '@/lib/first-translation-labels';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

/** A badged book with strong evidence — the only thing varying is coverage. */
function book(over: Partial<FirstTranslationBook> = {}): FirstTranslationBook {
  return {
    visible: true,
    first_translation: {
      verdict: 'first_no_prior',
      evidence_strength: 'strong',
      our_completeness: 'complete',
      resolver: 'tier2_agent',
    },
    pages_count: 100,
    pages_ocr: 100,
    pages_blank: 0,
    pages_translated: 100,
    ...over,
  } as FirstTranslationBook;
}

describe('translationCoverage', () => {
  it('uses pages_ocr minus blanks as the denominator, matching the homepage stat', () => {
    // 81 translated of (100 OCR - 10 blank) = 90 readable → 90%. Blanks must
    // leave the denominator, or a book padded with blank leaves scores low
    // for pages nobody could have translated.
    expect(translationCoverage(book({ pages_ocr: 100, pages_blank: 10, pages_translated: 81 })))
      .toBeCloseTo(0.9);
    // Same numerator against the un-adjusted count would be only 81%.
    expect(translationCoverage(book({ pages_ocr: 100, pages_blank: 0, pages_translated: 81 })))
      .toBeCloseTo(0.81);
  });

  it('falls back to pages_count when OCR counts are absent', () => {
    expect(translationCoverage(book({ pages_ocr: 0, pages_blank: 0, pages_count: 200, pages_translated: 50 })))
      .toBeCloseTo(0.25);
  });

  it('returns null — not zero — when no denominator can be established', () => {
    // Absent data is not evidence of thinness. Returning 0 here would demote
    // every book with missing page counts (the #17 hazard in miniature).
    expect(translationCoverage(book({ pages_ocr: 0, pages_blank: 0, pages_count: 0 }))).toBeNull();
  });

  it('clamps above 1 so the ratio is always a readable share', () => {
    expect(translationCoverage(book({ pages_ocr: 10, pages_translated: 40 }))).toBe(1);
  });
});

describe('isTranslationReadable', () => {
  it('accepts a fully translated book', () => {
    expect(isTranslationReadable(book())).toBe(true);
  });

  it('rejects the real production shape: 18 of 1,071 pages translated', () => {
    // Le Théâtre d'Agriculture — badged "First Translation" at 1.7%.
    expect(isTranslationReadable(book({ pages_ocr: 1071, pages_translated: 18 }))).toBe(false);
  });

  it('treats unknown coverage as readable rather than withdrawing the claim', () => {
    expect(isTranslationReadable(book({ pages_ocr: 0, pages_count: 0 }))).toBe(true);
  });

  it('sits exactly on the documented floor, not a hand-tuned neighbour', () => {
    const atFloor = book({ pages_ocr: 100, pages_translated: 100 * FIRST_TRANSLATION_READABLE_MIN });
    expect(isTranslationReadable(atFloor)).toBe(true);
    expect(isTranslationReadable(book({ pages_ocr: 100, pages_translated: 89 }))).toBe(false);
  });
});

describe('isPublicFirst excludes barely-translated books from the headline', () => {
  it('counts a complete, strongly-evidenced first', () => {
    expect(isPublicFirst(book())).toBe(true);
  });

  it('does NOT count a 2%-translated book, however strong the evidence', () => {
    const thin = book({ pages_ocr: 900, pages_translated: 20 });
    // The bibliographic claim survives — only the headline count is withheld.
    expect(isFirstTranslation(thin)).toBe(true);
    expect(isPublicFirst(thin)).toBe(false);
  });

  it('still excludes weak evidence at full coverage (the pre-existing rule)', () => {
    expect(isPublicFirst(book({
      first_translation: {
        verdict: 'first_no_prior',
        evidence_strength: 'weak',
        our_completeness: 'complete',
        resolver: 'tier1_catalog',
      },
    } as Partial<FirstTranslationBook>))).toBe(false);
  });
});

describe('firstTranslationBadge qualifies an in-progress translation', () => {
  it('reads plainly when the translation is done', () => {
    expect(firstTranslationBadge('confirmed_first', 'Latin', false, 'confirmed')).toBe('First Translation');
  });

  it('says so when it is not', () => {
    expect(firstTranslationBadge('confirmed_first', 'Latin', true, 'confirmed')).toBe('First Translation, in progress');
  });

  it('never calls a partly-translated book COMPLETE', () => {
    // The specific claim the gate exists to prevent: "First Complete
    // Translation" on a book that is 6% translated.
    expect(firstTranslationBadge('first_complete_translation', 'Latin', true, 'confirmed'))
      .not.toContain('Complete');
  });

  it('keeps the source-language wording when qualifying', () => {
    expect(firstTranslationBadge('first_from_source', 'Dutch', true, 'confirmed')).toBe('First from Dutch, in progress');
  });
});

describe('firstTranslationBadge speaks plain catalog voice in every register (2026-08-11)', () => {
  // Policy reversal, deliberate (Derek): a catalog says "first edition" without
  // an epistemology lecture. The claim register no longer changes the wording;
  // provenance lives in the data, one click away, not in the label.
  it('states the plain label regardless of claim register', () => {
    expect(firstTranslationBadge('confirmed_first', 'Latin', false, 'candidate'))
      .toBe('First Translation');
    expect(firstTranslationBadge('confirmed_first', 'Latin', false, 'confirmed'))
      .toBe('First Translation');
  });

  it('keeps the in-progress qualifier (reader service, not hedging)', () => {
    expect(firstTranslationBadge('confirmed_first', 'Latin', true, 'candidate'))
      .toBe('First Translation, in progress');
  });

  it('draws the disposition distinctions in every register', () => {
    expect(firstTranslationBadge('first_complete_translation', 'Dutch', false, 'candidate'))
      .toBe('First Complete Translation');
    expect(firstTranslationBadge('first_modern_translation', 'Dutch', false, 'candidate'))
      .toBe('First Modern Translation');
    expect(firstTranslationBadge('first_from_source', 'Dutch', false, 'candidate'))
      .toBe('First from Dutch');
  });

  it('description is plain and disclaimer-free', () => {
    const d = firstTranslationDescription('confirmed_first');
    expect(d).toBe('The first English translation of this text.');
    expect(d).not.toMatch(/not proof|coin flip|weaker evidence/);
  });
});
