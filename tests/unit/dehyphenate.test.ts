/**
 * The line-break dehyphenation rule used on Internet Archive OCR at ingest and by the #4780
 * backfill. The rule is deliberately narrow — join only when the continuation starts lowercase —
 * and these pin BOTH halves: what it joins, and what it must leave alone (uppercase and digit
 * continuations, paragraph breaks, spaced dashes, text without line structure).
 *
 * The one documented false join (`self-\npreservation`) is asserted as such so a future
 * "fix" that adds a dictionary changes this test on purpose, not by accident.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { dehyphenateLineBreaks, countLineBreakHyphens } from '../../scripts/lib/dehyphenate.mjs';

describe('dehyphenateLineBreaks', () => {
  it('joins a word split at a line break when the next line starts lowercase', () => {
    expect(dehyphenateLineBreaks('a store of am-\nmunition and ex-\npositions')).toBe('a store of ammunition and expositions');
  });

  it('leaves a hyphen before an uppercase or digit continuation exactly as it is', () => {
    expect(dehyphenateLineBreaks('the Anglo-\nSaxon kings')).toBe('the Anglo-\nSaxon kings');
    expect(dehyphenateLineBreaks('pages 1-\n2 and 3')).toBe('pages 1-\n2 and 3');
  });

  it('never joins across a paragraph break', () => {
    expect(dehyphenateLineBreaks('the end-\n\nnext paragraph')).toBe('the end-\n\nnext paragraph');
  });

  it('leaves a spaced dash and an in-line hyphen alone', () => {
    expect(dehyphenateLineBreaks('one -\ntwo')).toBe('one -\ntwo');
    expect(dehyphenateLineBreaks('well-known\nfact')).toBe('well-known\nfact');
  });

  it('tolerates trailing blanks and CRLF at the break, and non-ASCII letters', () => {
    expect(dehyphenateLineBreaks('philo- \r\n sopher')).toBe('philosopher');
    expect(dehyphenateLineBreaks('ἀπο-\nδείξεις')).toBe('ἀποδείξεις');
    expect(dehyphenateLineBreaks('Erklä-\nrung')).toBe('Erklärung');
    // ABBYY's soft-hyphen marker on some Archive items is the NOT SIGN (U+00AC).
    expect(dehyphenateLineBreaks('non¬\ncommissioned')).toBe('noncommissioned');
  });

  it('KNOWN FALSE JOIN: a real compound whose second half is lowercase is joined too', () => {
    expect(dehyphenateLineBreaks('self-\npreservation')).toBe('selfpreservation');
  });

  it('is idempotent and safe on empty or structureless input', () => {
    const once = dehyphenateLineBreaks('am-\nmunition');
    expect(dehyphenateLineBreaks(once)).toBe(once);
    expect(dehyphenateLineBreaks('')).toBe('');
    expect(dehyphenateLineBreaks(null as unknown as string)).toBe('');
    expect(dehyphenateLineBreaks('no breaks here')).toBe('no breaks here');
  });
});

describe('countLineBreakHyphens', () => {
  it('counts exactly the joins the rule would make', () => {
    expect(countLineBreakHyphens('am-\nmunition, Anglo-\nSaxon, ex-\npositions')).toBe(2);
    expect(countLineBreakHyphens('')).toBe(0);
  });
});

// @ts-expect-error — plain .mjs helper, no types
import { stripDigitizerWatermark, bookVocabulary, rejoinHyphenlessSplits, countHyphenlessSplits, junkTokenCount } from '../../scripts/lib/dehyphenate.mjs';

describe('stripDigitizerWatermark (#4947)', () => {
  it('drops the Google watermark line as ABBYY reads it', () => {
    expect(stripDigitizerWatermark('the holy fire\nof the gods\n\nDigitized by VjOOQIC')).toBe('the holy fire\nof the gods');
    expect(stripDigitizerWatermark('text\nDigitizedbyLjOOQlC\n')).toBe('text');
    expect(stripDigitizerWatermark('text\n\nDigitized by Google')).toBe('text');
    expect(stripDigitizerWatermark('a\nDigitized by VjOOQ IC\nb')).toBe('a\nb');
    expect(stripDigitizerWatermark('a\nDigitized by VjOOQ I ^')).toBe('a');
  });

  it('keeps the Archive colophon and in-sentence uses', () => {
    const colophon = 'Digitized by the Internet Archive\nin 2007 with funding from\nMicrosoft Corporation';
    expect(stripDigitizerWatermark(colophon)).toBe(colophon);
    const prose = 'This manuscript was digitized by the library in 1998 and later lost.';
    expect(stripDigitizerWatermark(prose)).toBe(prose);
  });
});

describe('rejoinHyphenlessSplits (#4947)', () => {
  const book = [
    'we grow vegetables in the garden and eat them',
    'the knowledge of the ancients was great',
    'they kept ourselves and themselves apart',
    'the man comes home and the man goes out',
    'an intelligent reader will see it',
  ];
  const vocab = bookVocabulary(book);

  it('joins a split the book attests as one word and never as two', () => {
    expect(rejoinHyphenlessSplits('he ate vege\ntables. Then', vocab)).toBe('he ate vegetables. Then');
    expect(rejoinHyphenlessSplits('of know\nledge and', vocab)).toBe('of knowledge and');
    expect(rejoinHyphenlessSplits('an intelli\ngent man', vocab)).toBe('an intelligent man');
    expect(rejoinHyphenlessSplits('Our\nselves alone', vocab)).toBe('Ourselves alone');
    expect(countHyphenlessSplits('he ate vege\ntables and know\nledge', vocab)).toBe(2);
  });

  it('leaves an ordinary line break between two words alone', () => {
    expect(rejoinHyphenlessSplits('then the man\ncomes in', vocab)).toBe('then the man\ncomes in');
    // joined form unattested
    expect(rejoinHyphenlessSplits('a dark\nnight', vocab)).toBe('a dark\nnight');
  });

  it('refuses a pair the book prints as two words, short halves, and paragraph breaks', () => {
    const v = bookVocabulary(['a sometimes b and some times c', 'go into it now', 'x vegetables y']);
    expect(rejoinHyphenlessSplits('and some\ntimes more', v)).toBe('and some\ntimes more');
    expect(rejoinHyphenlessSplits('go in\nto it', v)).toBe('go in\nto it');
    expect(rejoinHyphenlessSplits('vege\n\ntables', v)).toBe('vege\n\ntables');
    expect(rejoinHyphenlessSplits('Vege\nTables', v)).toBe('Vege\nTables');
  });

  it('is a no-op with an empty vocabulary', () => {
    expect(rejoinHyphenlessSplits('vege\ntables', bookVocabulary([]))).toBe('vege\ntables');
  });
});

describe('junkTokenCount (#4947)', () => {
  it('counts tokens carrying an unread-ink character', () => {
    expect(junkTokenCount("HmTHRiEs ^''^^r-ated the rude features")).toBe(1);
    expect(junkTokenCount('fc^e nera^ went ^ort^ before him')).toBe(3);
    expect(junkTokenCount('a clean line of text')).toBe(0);
  });
});
