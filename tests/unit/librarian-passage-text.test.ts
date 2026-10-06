import { describe, it, expect } from 'vitest';
import { passageText } from '@/lib/search/librarian-search';
import { resolveQuoteText } from '@/lib/quote-text';
import type { Page } from '@/lib/types';

// #5867: the semantic lanes hand the Librarian `page_translations.translation`,
// which is EMPTY for every page embedded without a translation — every
// English-original page, and pages embedded before their translation landed.
// The vector ranks, the passage arrives with no words, and the model is shown
// a citation it cannot quote. The fix reads the page from Mongo through
// resolveQuoteText; these pin both halves.

const birchOcr = '<language>English</language>\n<page-type>text</page-type>\n'
  + 'Dr. Kuffler gave an account of his new oven, in which the heat may be kept equal by the help of a '
  + 'register moved by a weather-glass, so that eggs might be hatched in it as by a hen.';

describe('resolveQuoteText for the Librarian', () => {
  it('serves the OCR of an English-original leaf, which has no translation', () => {
    const page = { ocr: { data: birchOcr } } as unknown as Page;
    const out = resolveQuoteText(page, 'birch', 'en', { mark: false });
    expect(out?.source).toBe('ocr_original');
    expect(out?.text).toContain('Kuffler gave an account of his new oven');
  });

  it('serves nothing for an untranslated foreign leaf, rather than its Latin', () => {
    const page = { ocr: { data: '<language>Latin</language>\nFurnus Drebbelianus calorem aequabilem servat per vitrum mercurio plenum.' } } as unknown as Page;
    expect(resolveQuoteText(page, 'x', 'en', { mark: false })).toBeNull();
  });

  it('leaves the text unstamped when mark is false', () => {
    const page = { translation: { data: 'Explanation of the Furnace. A Register.' } } as unknown as Page;
    expect(resolveQuoteText(page, 'monconys', 'en', { mark: false })?.text).toBe('Explanation of the Furnace. A Register.');
  });
});

describe('passageText', () => {
  const hit = { book_id: 'birch', page_number: 91, text: '' };

  it('prefers the Mongo text over the lane’s empty column', () => {
    const texts = new Map([['birch:91', 'Dr. Kuffler gave an account of his new oven']]);
    expect(passageText(hit, texts)).toBe('Dr. Kuffler gave an account of his new oven');
  });

  it('falls back to the lane text when Mongo had nothing quotable', () => {
    expect(passageText({ ...hit, text: '<note>Furnace for distillation</note> F. VI.' }, new Map())).toBe('Furnace for distillation F. VI.');
  });

  it('returns empty when neither side has words, so the caller can drop the hit', () => {
    expect(passageText(hit, new Map())).toBe('');
  });

  it('caps the passage at 1,200 characters', () => {
    const texts = new Map([['birch:91', 'x'.repeat(5000)]]);
    expect(passageText(hit, texts)).toHaveLength(1200);
  });
});
