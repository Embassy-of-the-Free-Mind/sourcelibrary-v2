import { describe, it, expect } from 'vitest';
import { isTranslatablePage, isDegenerateSource, SOURCE_LOOP_REASON } from '../../scripts/lib/translate-core.mjs';

/**
 * The translation lane must refuse a looping SOURCE (#4765/#4850).
 *
 * Every fabrication the blind judge found in the #4759 observational read came from
 * one: handed a page of a single syllable repeated thousands of times, the model does
 * not decline — it writes fluent connected prose, and downstream nothing can tell that
 * translation from a real one. The refusal is pre-flight, so the call is never billed.
 *
 * The controls matter as much as the positive case: a litany and a spaceless-script
 * page are ordinary work this lane must keep doing.
 */

const LOOPING_OCR =
  '<language>Balinese</language>\n<page-type>text</page-type>\n' +
  'ᬧᬸᬦᬧᬦᭂᬫ᭄ᬧᬸᬳᬶᬗ᭄ᬓᬸᬯᬮᬦ᭄ᬢ᭄ᬭ '.repeat(60);

const REAL_OCR =
  '<language>Latin</language>\n<page-type>text</page-type>\n' +
  'Quod autem in hoc negotio de quo agimus non solum iuris sed etiam facti difficultas ' +
  'occurrat nemo est qui ambigat, nam etsi iuris ratio in promptu sit, tamen facti ' +
  'veritas quae ex circumstantiis pendet saepissime in dubium vocatur.';

const page = (ocr: string, extra: Record<string, unknown> = {}) => ({
  id: 'p1', page_number: 5, ocr: { data: ocr }, ...extra,
});

describe('isTranslatablePage — looping source', () => {
  it('refuses a page whose OCR is a repetition loop, with a countable reason', () => {
    const v = isTranslatablePage(page(LOOPING_OCR));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('ocr-loop');
  });

  it('still translates ordinary text', () => {
    expect(isTranslatablePage(page(REAL_OCR)).ok).toBe(true);
  });

  it('still translates a litany — repetition with variation is real text', () => {
    const litany = ['Sancta Maria', 'Sancta Dei Genitrix', 'Sancta Virgo virginum', 'Mater Christi',
      'Mater divinae gratiae', 'Mater purissima', 'Mater castissima', 'Mater inviolata',
      'Mater intemerata', 'Mater amabilis', 'Virgo prudentissima', 'Virgo veneranda',
      'Virgo praedicanda', 'Virgo potens', 'Virgo clemens', 'Virgo fidelis']
      .map(n => `${n}, ora pro nobis.`).join(' ');
    expect(isTranslatablePage(page(litany)).ok).toBe(true);
  });

  it('still translates a spaceless script — no word tokens to count', () => {
    const zh = '子曰學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎' +
      '其為人也孝弟而好犯上者鮮矣不好犯上而好作亂者未之有也君子務本本立而道生';
    expect(isTranslatablePage(page(zh)).ok).toBe(true);
  });

  it('the reasons stay distinguishable — a loop is not reported as "no OCR"', () => {
    expect(isTranslatablePage(page('')).reason).toBe('no-ocr');
    expect(isTranslatablePage(page(LOOPING_OCR)).reason).not.toBe('no-ocr');
  });
});

describe('isDegenerateSource', () => {
  it('is the predicate the workers share, and names its stamp', () => {
    expect(isDegenerateSource(LOOPING_OCR)).toBe(true);
    expect(isDegenerateSource(REAL_OCR)).toBe(false);
    expect(isDegenerateSource(undefined)).toBe(false);
    expect(SOURCE_LOOP_REASON).toBe('source_loop');
  });
});
