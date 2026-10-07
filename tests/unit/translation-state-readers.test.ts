/**
 * Book-level readers read the stamped rung (#5287, translation-state step 3).
 *
 * One book per rung, plus an English original and an unstamped book, pushed
 * through every reader that used to do its own arithmetic: the shared verdict
 * (book page + collection card label), the first-translation badge gate, the
 * further-reading status, and the reader's translation-request CTA. The stamps
 * are produced by the real writer, `computeTranslationState()`, from counts —
 * not hand-written — so a fixture cannot claim a rung the writer would never
 * stamp.
 *
 * The preview-only case is the one the step exists for: De sensu rerum
 * (`6a24401a0f0e4f405e636f96`), 23 translated of 332 pages, OCR only on its
 * preview. Unstamped, the old gate's `ocr − blank` denominator passes it as
 * readable; stamped, it is `transcribing` and every reader must say so.
 */
import { describe, it, expect } from 'vitest';
import { computeTranslationState, type TranslationRung } from '@/lib/page-counts';
import {
  translationVerdict,
  isReadableInEnglish,
  storedRung,
  type TranslationVerdict,
} from '@/lib/translation-completeness';
import { isTranslationReadable } from '@/lib/first-translation/derive';
import { furtherReadingStatus, type FurtherReadingBook } from '@/lib/further-reading';
import { shouldShowTranslationRequestCta } from '@/lib/translation-request-cta';

interface Counts {
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
  pages_blank: number;
  pages_translatable?: number;
}

function stamped(counts: Counts, opts: { language?: string; content_type?: string } = {}): FurtherReadingBook {
  const { rung, english_original } = computeTranslationState(counts, opts);
  return {
    id: 'x',
    title: 'x',
    language: opts.language ?? 'Latin',
    ...counts,
    translation_state: { rung, english_original },
  };
}

const CASES: Array<{
  name: string;
  counts: Counts;
  language?: string;
  content_type?: string;
  rung: TranslationRung;
  verdict: TranslationVerdict;
  ftReadable: boolean;
  further: 'untranslated' | 'partial' | 'translated';
  furtherLabel?: string;
}> = [
  {
    name: 'artwork record', content_type: 'artwork',
    counts: { pages_count: 1, pages_ocr: 0, pages_translated: 0, pages_blank: 0 },
    rung: 'no_pages', verdict: 'none', ftReadable: false, further: 'untranslated',
  },
  {
    name: 'scans only',
    counts: { pages_count: 200, pages_ocr: 0, pages_translated: 0, pages_blank: 0 },
    rung: 'no_text', verdict: 'none', ftReadable: false, further: 'untranslated',
  },
  {
    name: 'De sensu rerum: preview OCR, preview translated (23/332)',
    counts: { pages_count: 332, pages_ocr: 25, pages_translated: 23, pages_blank: 2 },
    rung: 'transcribing', verdict: 'none', ftReadable: false, further: 'partial',
    furtherLabel: '23 of 332 pages translated',
  },
  {
    name: 'transcribed, nothing translated',
    counts: { pages_count: 100, pages_ocr: 100, pages_translated: 0, pages_blank: 0 },
    rung: 'transcribed', verdict: 'none', ftReadable: false, further: 'untranslated',
  },
  {
    name: 'translating (60%)',
    counts: { pages_count: 100, pages_ocr: 100, pages_translated: 60, pages_blank: 0 },
    rung: 'translating', verdict: 'none', ftReadable: false, further: 'partial',
    furtherLabel: '60 of 100 pages translated',
  },
  {
    name: 'readable (95 of 100)',
    counts: { pages_count: 100, pages_ocr: 100, pages_translated: 95, pages_blank: 0 },
    rung: 'readable', verdict: 'translated', ftReadable: true, further: 'translated',
    furtherLabel: 'Translated',
  },
  {
    name: 'complete (every translatable page, blanks and plates excluded)',
    counts: { pages_count: 120, pages_ocr: 118, pages_translated: 110, pages_blank: 4, pages_translatable: 110 },
    rung: 'complete', verdict: 'complete', ftReadable: true, further: 'translated',
    furtherLabel: 'Complete',
  },
];

describe('one book per rung, through every book-level reader', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const book = stamped(c.counts, { language: c.language, content_type: c.content_type });

      it(`is stamped ${c.rung}`, () => {
        expect(storedRung(book)).toBe(c.rung);
      });

      it(`shows verdict ${c.verdict} (book page + card label)`, () => {
        expect(translationVerdict(book)).toBe(c.verdict);
      });

      it(`${c.ftReadable ? 'passes' : 'fails'} the first-translation readable gate`, () => {
        expect(isTranslationReadable(book)).toBe(c.ftReadable);
      });

      it(`reads as ${c.further} in further reading`, () => {
        const s = furtherReadingStatus(book);
        expect(s.kind).toBe(c.further);
        expect(s.readable).toBe(c.further === 'translated');
        if (c.furtherLabel) expect(s.label).toBe(c.furtherLabel);
      });
    });
  }

  it('a `complete` book shows the same label on the card/book page and in further reading', () => {
    const book = stamped(CASES.find(c => c.rung === 'complete')!.counts);
    expect(translationVerdict(book)).toBe('complete');
    expect(furtherReadingStatus(book).label).toBe('Complete');
  });
});

describe('English originals', () => {
  const english = stamped(
    { pages_count: 100, pages_ocr: 100, pages_translated: 0, pages_blank: 0 },
    { language: 'English' },
  );

  it('are readable in English once transcribed, with no translation', () => {
    expect(storedRung(english)).toBe('transcribed');
    expect(isReadableInEnglish(english)).toBe(true);
    expect(translationVerdict(english)).toBe('english_original');
  });

  it('are not called "translated" by the first-translation gate', () => {
    expect(isTranslationReadable(english)).toBe(false);
  });

  it('are not readable in English while only a preview is transcribed', () => {
    const preview = stamped(
      { pages_count: 300, pages_ocr: 20, pages_translated: 0, pages_blank: 0 },
      { language: 'English' },
    );
    expect(isReadableInEnglish(preview)).toBe(false);
    expect(translationVerdict(preview)).toBe('none');
  });
});

describe('unstamped books keep the pre-ladder arithmetic', () => {
  const preview = { id: 'x', title: 'x', pages_count: 332, pages_ocr: 25, pages_translated: 23, pages_blank: 2 };

  it('has no stored rung and no verdict: absent is unstamped, never untranslated', () => {
    expect(storedRung(preview)).toBeNull();
    expect(translationVerdict(preview)).toBeNull();
    expect(isReadableInEnglish(preview)).toBeNull();
  });

  /**
   * Negative control for the whole step: the SAME counts, unstamped, still pass
   * the old gate (23 / (25 − 2) = 100%). Only the stamp makes the readers
   * refuse the preview — so if a reader stops consulting the rung, the
   * transcribing case above goes red while this one stays green.
   */
  it('the old gate still passes the preview-only book when it is unstamped', () => {
    expect(isTranslationReadable(preview)).toBe(true);
  });

  it('keeps "unknown coverage counts as readable" (#4653, visibility-and-stats.md)', () => {
    expect(isTranslationReadable({ pages_translated: 5 })).toBe(true);
  });

  it('ignores an unknown rung value instead of trusting it', () => {
    const odd = { ...preview, translation_state: { rung: 'mostly' } };
    expect(storedRung(odd)).toBeNull();
    expect(isTranslationReadable(odd)).toBe(true);
  });
});

describe('translation-request CTA reads the rung', () => {
  const page = { ocrText: 'Lorem ipsum dolor sit amet', bookLanguage: 'Latin' };

  it('hides the CTA on a page missing from a readable book', () => {
    expect(shouldShowTranslationRequestCta({
      ...page, bookPagesTranslated: 10, bookPagesCount: 100,
      bookTranslationState: { rung: 'readable' },
    })).toBe(false);
  });

  it('offers the CTA on a stamped book still below the bar, whatever the counters say', () => {
    expect(shouldShowTranslationRequestCta({
      ...page, bookPagesTranslated: 95, bookPagesCount: 100,
      bookTranslationState: { rung: 'transcribing' },
    })).toBe(true);
  });

  it('falls back to the counters when unstamped', () => {
    expect(shouldShowTranslationRequestCta({ ...page, bookPagesTranslated: 95, bookPagesCount: 100 })).toBe(false);
    expect(shouldShowTranslationRequestCta({ ...page, bookPagesTranslated: 10, bookPagesCount: 100 })).toBe(true);
  });
});
