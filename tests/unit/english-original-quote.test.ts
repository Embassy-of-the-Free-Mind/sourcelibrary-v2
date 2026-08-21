import { describe, it, expect } from 'vitest';

import {
  declaredPageLanguage,
  declaresEnglish,
  englishFraction,
  isEnglishOriginalPage,
  textWords,
  ENGLISH_SOURCE_THRESHOLD,
} from '@/lib/english-page-language';
import { resolveQuoteText } from '@/lib/quote-text';
import type { Page } from '@/lib/types';
import * as mjs from '../../scripts/lib/english-source-detect.mjs';

/**
 * Quoting an ENGLISH-ORIGINAL page (#3939).
 *
 * Dee's *Mathematicall Praeface* sits inside Billingsley's 1570 Euclid, a book
 * catalogued `Latin`, and is English. `pages_translated` is 0 and always will
 * be — there is nothing to translate — so the old `translation`-or-404 rule made
 * one of the most-cited texts in Renaissance mathematics findable by search and
 * impossible to cite.
 *
 * Two things are pinned here: the per-page language signals must agree with the
 * scripts-side twin they were lifted from (`scripts/lib/english-source-detect.mjs`,
 * which screens whole books for first-translation claims), and the fallback must
 * fire ONLY on English leaves — serving a Latin page under a field a caller
 * reaches for when it wants quotable English is how a translator's words get
 * attributed to an author.
 */

// Verbatim from page 55 of book 69aebe88a103e42dc94145ad — the leaf carrying the
// Virgil quotation. Note the body opens in LATIN while the leaf is an English
// page: the model's declaration is the signal that gets this right, and a
// body-only frequency read would not.
const DEE_P55 = `<language>English</language>
<script>printed</script>
<page-type>preface</page-type>
<header>Iohn Dee his Mathematicall Præface.</header>
<sig>A.j.</sig>
<meta>catchword: Some</meta>

*opportunitateſq; temporum præſentire, non minus rei militari, quàm Agriculturæ, Nauigationiq; conuenit.* To foreſee the alterations and alterations of tymes, is conuenient, no leſſe to the *Art of Warre*, then to *Huſbandry* and *Nauigation*.`;

// Undeclared English prose, as the older ingests left it — frequency has to
// carry the decision here.
const UNDECLARED_ENGLISH = `Of the arts mathematicall, there are some which are of the
first degree, and some of the second: and those of the second degree do all of them
take their beginning from the first, as from the roote and ground of all that which
they do teach unto us in the world.`;

const LATIN_PAGE = `<language>Latin</language>
<meta>This page continues the discussion of mercury from the previous leaf, where the author described a perpetual-motion wheel.</meta>
Quod eſt inferius, eſt ſicut id quod eſt ſuperius, et quod eſt ſuperius, eſt ſicut id quod eſt inferius, ad perpetranda miracula rei unius.`;

const SCANNER_NOTICE = `This is a digital copy of a book that was preserved for generations on library
shelves before it was carefully scanned by Google as part of a project to make the
world's books discoverable online. A public domain book is one that was never subject
to copyright.`;

const page = (ocr?: string, translation?: string) =>
  ({
    ...(ocr === undefined ? {} : { ocr: { data: ocr } }),
    ...(translation === undefined ? {} : { translation: { data: translation } }),
  }) as unknown as Page;

describe('per-page language signals agree with the scripts-side twin', () => {
  const FIXTURES = [DEE_P55, UNDECLARED_ENGLISH, LATIN_PAGE, SCANNER_NOTICE, '', '<language>null</language>x'];

  it('declaredPageLanguage / declaresEnglish agree on every fixture', () => {
    for (const t of FIXTURES) {
      expect(declaredPageLanguage(t)).toEqual(mjs.declaredPageLanguage(t));
      expect(declaresEnglish(t)).toEqual(mjs.declaresEnglish(t));
    }
  });

  it('textWords / englishFraction agree on every fixture', () => {
    for (const t of FIXTURES) {
      expect(textWords(t)).toEqual(mjs.textWords(t));
      expect(englishFraction(t)).toEqual(mjs.englishFraction(t));
    }
  });

  it('shares the threshold', () => {
    expect(ENGLISH_SOURCE_THRESHOLD).toBe(mjs.ENGLISH_SOURCE_THRESHOLD);
  });
});

describe('isEnglishOriginalPage', () => {
  it('trusts the model\'s declaration over the language of the body text', () => {
    // The leaf declares English and quotes Virgil in Latin. Frequency over the
    // opening clause alone would not decide it; the declaration does.
    expect(isEnglishOriginalPage(DEE_P55)).toBe(true);
  });

  it('reads undeclared English prose by function-word frequency', () => {
    expect(isEnglishOriginalPage(UNDECLARED_ENGLISH)).toBe(true);
  });

  it('is false for a Latin page whose only English is our own editorial wrapper', () => {
    // The <meta> block is a paragraph of English about the page. Stripping the
    // TAG and keeping the prose is the #2232 bug class, and here it would also
    // make a Latin leaf quotable as though it were English.
    expect(isEnglishOriginalPage(LATIN_PAGE)).toBe(false);
    expect(declaresEnglish(LATIN_PAGE)).toBe(false);
  });

  it('is false for a page holding nothing but scanner boilerplate', () => {
    // English by construction, on books in every language, and bound into the
    // scan rather than printed in the book.
    expect(englishFraction(SCANNER_NOTICE)).toBeGreaterThan(ENGLISH_SOURCE_THRESHOLD);
    expect(isEnglishOriginalPage(SCANNER_NOTICE)).toBe(false);
  });

  it('lets frequency decide a bilingual declaration', () => {
    // `<language>english, latin</language>` is what the model writes for an
    // English leaf quoting its Latin source (page 58 of the Euclid). Read as
    // "not purely English" it would be refused; read as a mixed claim it defers
    // to the text, which is the honest answer for a leaf that is both.
    const bilingual = `<language>english, latin</language>\n${UNDECLARED_ENGLISH}`;
    expect(declaresEnglish(bilingual)).toBe(false); // the shared predicate is strict
    expect(isEnglishOriginalPage(bilingual)).toBe(true);

    const bilingualMostlyLatin = `<language>latin, english</language>\n${LATIN_PAGE.split('\n').pop()}`;
    expect(isEnglishOriginalPage(bilingualMostlyLatin)).toBe(false);
  });

  it('makes no claim on a page with too little text to judge', () => {
    expect(isEnglishOriginalPage('The Elements of Geometrie')).toBe(false);
    expect(isEnglishOriginalPage('')).toBe(false);
    expect(isEnglishOriginalPage(undefined)).toBe(false);
  });
});

describe('resolveQuoteText', () => {
  it('prefers a translation when one exists', () => {
    const r = resolveQuoteText(page(LATIN_PAGE, 'That which is below is as that which is above.'), 'bk');
    // `lang` names the edition the text is IN — English here, and stated
    // rather than assumed, because a page can now carry several (#4095).
    expect(r).toEqual({ text: 'That which is below is as that which is above.', source: 'translation', lang: 'en' });
  });

  it('falls back to the transcription on an English-original leaf', () => {
    const r = resolveQuoteText(page(DEE_P55), 'bk');
    expect(r?.source).toBe('ocr_original');
    expect(r?.text).toContain('To foreſee the alterations');
    // The metadata envelope describes the scan and is never quotable text; the
    // running head and signature ARE printed on the leaf and stay, per
    // `.claude/docs/invariants/quote-and-snippet-integrity.md`.
    expect(r?.text).not.toContain('<language>');
    expect(r?.text).not.toContain('catchword');
    expect(r?.text).toContain('Iohn Dee his Mathematicall Præface');
  });

  it('refuses to serve a foreign page with no translation', () => {
    expect(resolveQuoteText(page(LATIN_PAGE), 'bk')).toBeNull();
  });

  it('treats a translation that is nothing but an editorial block as no translation', () => {
    // Serving the empty string left after stripping would be a quote of nothing.
    const editorialOnly = '<meta>This leaf is blank apart from a printer\'s ornament.</meta>';
    expect(resolveQuoteText(page(LATIN_PAGE, editorialOnly), 'bk')).toBeNull();
    expect(resolveQuoteText(page(DEE_P55, editorialOnly), 'bk')?.source).toBe('ocr_original');
  });

  it('returns null when the page holds no text at all', () => {
    expect(resolveQuoteText(page(), 'bk')).toBeNull();
  });
});
