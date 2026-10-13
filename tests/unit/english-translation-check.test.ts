import { describe, it, expect } from 'vitest';
import {
  claimsEnglish,
  judgeTranslationPage,
  judgeTranslationSample,
} from '../../scripts/lib/english-translation-check.mjs';

/**
 * Guards for #4937: a page whose translation is labelled English must contain English.
 * The ORAEC paginate fallback wrote German as `language: en` for months (#4936). The
 * German fixture below is the shape it wrote; the detector must flag it.
 */

const ENGLISH = `<margin>vii</margin>
...to attain, so that your sons may remain with us eternally. From then on Raguel accepted
his wife Anna, and soon ordered a table to be prepared for his daughter while he led her. And
they came and entered where Raguel was, and Raguel received them with joy. And Tobias said to
his wife, "How similar is this young man to the son of my cousin." And when he had said this,
he asked them from where they came, and they said that they were from the tribe of Naphtali,
from the captivity of Nineveh. Raguel said to them, "Do you know Tobias, my brother?"`;

// ORAEC German translation of an Egyptian text, as written under `language: en` (#4936).
const GERMAN = `Der König von Ober- und Unterägypten, der Herr der beiden Länder, er hat es gemacht
als sein Denkmal für seinen Vater Amun, den Herrn der Throne der beiden Länder. Er hat ihm
einen großen Tempel aus weißem Kalkstein errichtet, damit er ewig lebe wie Re. Die Götter
sind zufrieden mit dem, was er für sie getan hat, und sie geben ihm die Ewigkeit als König
auf dem Thron des Horus. Es ist der Sohn des Re, der von ihm geliebt wird, der mit Leben
beschenkt ist wie Re in Ewigkeit. Und er sagt zu den Menschen, die nach ihm kommen werden:
Gebt Opfer für den Gott, der in seinem Haus ist, und für die Götter, die bei ihm sind.`;

// An English page that quotes its Latin source — legitimate, must not flag.
const ENGLISH_WITH_LATIN = `${ENGLISH}
As the author writes: "Et dixit ad eos quod non est in hoc loco, sed in alio."`;

const GREEK = 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος. '.repeat(6);

describe('claimsEnglish', () => {
  it('treats en / eng / English / absent as an English claim', () => {
    for (const l of ['en', 'EN', 'eng', 'English', ' english ', null, undefined, '']) expect(claimsEnglish(l)).toBe(true);
  });
  it('does not treat an explicit other language as an English claim', () => {
    for (const l of ['de', 'German', 'la', 'es']) expect(claimsEnglish(l)).toBe(false);
  });
});

describe('judgeTranslationPage', () => {
  it('passes real English', () => {
    expect(judgeTranslationPage(ENGLISH).verdict).toBe('english');
  });
  it('passes English that quotes its Latin source', () => {
    expect(judgeTranslationPage(ENGLISH_WITH_LATIN).verdict).toBe('english');
  });
  it('passes a lexicon page whose Greek headwords sit in <term> tags', () => {
    const lexicon = Array.from({ length: 8 }, () =>
      '<term>Ἀποκλαίω</term> <gloss>I bewail, as the one who weeps for the dead</gloss>. Future <term>αύσω</term>. '
      + '<term>Ἀποκλείω</term> <gloss>I shut up, I close the door of the house</gloss>, as in Luke.').join('\n');
    expect(judgeTranslationPage(lexicon).verdict).toBe('english');
  });
  it('flags the German the ORAEC fallback wrote as en (negative control)', () => {
    const r = judgeTranslationPage(GERMAN);
    expect(r.verdict).toBe('not-english');
    expect(r.detected).toBe('German');
  });
  it('flags a non-Latin-script page labelled English', () => {
    expect(judgeTranslationPage(GREEK).verdict).toBe('script');
  });
  it('does not judge a page too short to carry evidence', () => {
    expect(judgeTranslationPage('Der König.').verdict).toBe('thin');
    expect(judgeTranslationPage('').verdict).toBe('thin');
  });
});

describe('judgeTranslationSample', () => {
  it('flags a book whose sampled pages are German', () => {
    const r = judgeTranslationSample([GERMAN, GERMAN, ENGLISH, GERMAN]);
    expect(r.flagged).toBe(true);
    expect(r.detected).toEqual({ German: 3 });
  });
  it('does not flag a book with one incidental non-English page', () => {
    const r = judgeTranslationSample([ENGLISH, ENGLISH, ENGLISH, ENGLISH, ENGLISH, GERMAN]);
    expect(r.bad).toBe(1);
    expect(r.flagged).toBe(false);
  });
  it('does not flag an all-English book', () => {
    expect(judgeTranslationSample([ENGLISH, ENGLISH_WITH_LATIN, ENGLISH]).flagged).toBe(false);
  });
});
