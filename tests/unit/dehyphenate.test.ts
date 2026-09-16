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
