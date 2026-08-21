/**
 * Which text on a page is the quotable one? (#3939)
 *
 * The quote API used to answer this with `page.translation.data` or a 404. That
 * makes an ENGLISH-ORIGINAL page unquotable *by construction*: there is nothing
 * to translate, so `pages_translated` stays 0 forever and every call to the tool
 * whose description says "ALWAYS use before putting text in quotation marks"
 * returns `no_translation`. Dee's *Mathematicall Praeface* — findable by search,
 * one of the most-cited texts in the history of Renaissance mathematics — could
 * be located and never cited.
 *
 * So: translation when there is one, else the OCR transcription when the leaf is
 * already in the reader's language, else nothing. The `source` discriminator is
 * not decoration — a caller must be able to tell "this is our translation" from
 * "this is the page's own words, transcribed", because a quote is a claim about
 * who wrote the words (the same reason `translation_note` exists for translated
 * editions, `.claude/docs/invariants/quote-and-snippet-integrity.md`).
 *
 * A FOREIGN page with no translation still returns null here. Serving Latin
 * under a field a caller reaches for when it wants quotable English is how a
 * translator's words get attributed to an author; those callers keep the
 * `no_translation` answer, which tells them to read `get_book_text` instead.
 */
import type { Page } from '@/lib/types';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { markForExport } from '@/lib/provenance';
import { isEnglishOriginalPage } from '@/lib/english-page-language';
import { getTranslation } from '@/lib/page-translations';

export type QuoteTextSource = 'translation' | 'ocr_original' | 'source_column';

export interface QuotableText {
  /** Wrapper-stripped, verbatim, ready to be put inside quotation marks. */
  text: string;
  source: QuoteTextSource;
  /**
   * The ISO code of the language `text` is actually IN — not the one that was
   * asked for. A caller that requested `es` and received `en` must be able to
   * see that it happened; a quote is a claim about words, and a silent
   * substitution makes the caller assert something it never checked (#4095).
   */
  lang: string;
}

/**
 * What a caller has to be told when the quote is the page's own English rather
 * than a translation of it. Spelled out because agents act on these sentences.
 */
export const OCR_ORIGINAL_NOTE =
  'This page needs no translation: the text printed on the leaf is already English, which is why '
  + 'this book reports pages_translated: 0. The quotable text is served as `original` '
  + '(text_source: "ocr_original") — an AI transcription of the scan, uncorrected, preserving period '
  + 'spelling, long-s forms and printer marks, and any passage the page itself quotes in another '
  + 'language exactly as printed. Quote it as the source\'s own words and never describe it as a '
  + 'translation. Where the exact wording carries weight, check it against the leaf with '
  + 'include_image.';

/**
 * What a caller has to be told when the localized text is the leaf's OWN column
 * rather than a translation we made.
 *
 * A parallel-text manuscript carries two languages side by side, and where one
 * of them is the language asked for, the honest answer is that column — not a
 * machine pivot standing in front of it. But the two are indistinguishable once
 * they are in the same field, and the difference is the whole citation: these
 * words are Ximénez's of 1701 and Sahagún's of 1577, and their period spelling
 * ("ensuberbescas", "baxa la cabeça") is theirs, not OCR error to be tidied
 * away. Spelled out because agents act on these sentences.
 */
export const SOURCE_COLUMN_NOTE =
  'This text is not our translation. It is the column of the leaf that is already written in this '
  + 'language — a bilingual manuscript with the languages in parallel columns — transcribed from the '
  + 'scan by AI, uncorrected, preserving period spelling and scribal abbreviation. Attribute the '
  + 'wording to the historical translator or scribe named in the book record, never to Source '
  + 'Library, and do not modernise it when quoting. Where the exact wording carries weight, check it '
  + 'against the leaf with include_image.';

/**
 * `pages.translations.<iso>.source` written by
 * `scripts/maintenance/extract-source-columns.mjs`. Twin of
 * `SOURCE_COLUMN_PROVENANCE` in `scripts/lib/source-column.mjs` — a plain string
 * on both sides; the writer is a node script and cannot import this module.
 */
export const SOURCE_COLUMN_PROVENANCE = 'source-column';

/**
 * The quotable text of a page, or null when the page holds nothing citable.
 *
 * Emptiness is measured AFTER wrapper stripping on purpose: a page whose
 * `translation.data` is nothing but a `<meta>` block has no verbatim text in it,
 * and serving an empty string as a quote is worse than saying so.
 */
export function resolveQuoteText(page: Page, bookId: string, lang: string = 'en'): QuotableText | null {
  // A non-English edition is tried FIRST and falls back to English, reporting
  // which one it served. Never the other way round, and never silently: the
  // Spanish edition covers 103 books out of 22,000, so the fallback is the
  // common case and a caller that cannot see it has no way to know whether the
  // words it is about to quote are the ones a Spanish reader sees.
  if (lang && lang !== 'en') {
    const localized = getTranslation(page, lang);
    const cleaned = localized?.data ? stripEditorialWrappers(localized.data).trim() : '';
    if (cleaned) {
      // Same field, two different claims about authorship. `source-column` means
      // the words are the leaf's own — see SOURCE_COLUMN_NOTE.
      const source: QuoteTextSource =
        localized?.source === SOURCE_COLUMN_PROVENANCE ? 'source_column' : 'translation';
      return { text: markForExport(cleaned, bookId), source, lang };
    }
  }

  const translation = page.translation?.data
    ? stripEditorialWrappers(page.translation.data).trim()
    : '';
  if (translation) return { text: markForExport(translation, bookId), source: 'translation', lang: 'en' };

  const ocrRaw = page.ocr?.data || '';
  const ocr = ocrRaw ? stripEditorialWrappers(ocrRaw).trim() : '';
  // The leaf's own English. Its language is a property of the page, not of the
  // request — asking for Spanish cannot make a 1570 English leaf Spanish.
  if (ocr && isEnglishOriginalPage(ocrRaw)) return { text: ocr, source: 'ocr_original', lang: 'en' };

  return null;
}
